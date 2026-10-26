---
title: "Work with files and multimodal messages"
description: "Upload images, documents, and audio; reference them in messages with file_id for secure, efficient multimodal input."
section: "TypeScript client"
group: "Features"
order: 70
label: "Files and multimodal"
updated: "2026-10-26"
---

The 10xGraph client supports multimodal messages: you upload files once, then reference them by `file_id` in as many messages as you need. The server handles access control and media resolution, so you never expose public URLs or inline base64.

Vision and document input work identically across `invoke()`, `stream()`, and `wsStream()`.

## Prerequisites

- A configured `TenxGraphClient`. See [create-client](/docs/client/create-client).
- The API server running with media storage configured. You can check with `getMultimodalConfig()` before uploading.
- A model that supports the media type you send (e.g., GPT-4V for images, Gemini for audio).

---

## The upload-once, reference-many pattern

The path for any multimodal interaction is:

1. Upload the file with `client.uploadFile()` and capture the returned `file_id`.
2. Build a message with a media block that references that `file_id`.
3. Send the message like any other message.

The server translates each `file_id` reference into an internal `graph://media/{file_id}` URL at request time, then resolves it to real bytes or a provider URL when calling the LLM. You never inline base64 or expose a public URL.

---

## Step 1: Check the server's configuration first

Before uploading, read the server's limits and media handling mode:

```ts
const config = await client.getMultimodalConfig();

const {
  media_storage_type,   // 'memory' | 'local' | 'cloud'
  media_max_size_mb,    // server default is 25
  document_handling,    // 'extract_text' | 'pass_raw' | 'skip'
} = config.data;
```

`document_handling` controls what happens to non-image files:

| Value | Effect |
|---|---|
| `extract_text` | The server extracts the document's text at upload time and exposes it as `extracted_text`. A `DocumentBlock` carrying that `file_id` is replaced with the extracted text before the graph runs. This is the server default. |
| `pass_raw` | The document is passed to the model as a media reference. Only useful with models that accept documents natively. |
| `skip` | Documents are not sent to the model. Image attachments only. |

Use these settings to validate user input and show appropriate UI:

```ts
const acceptsDocuments = config.data.document_handling !== 'skip';
const maxBytes = config.data.media_max_size_mb * 1024 * 1024;

if (!acceptsDocuments && file.type.startsWith('application/')) {
  // Show "images only" message to the user
}

if (file.size > maxBytes) {
  // Show "file too large" message
}
```

---

## Step 2: Upload a file

`uploadFile()` accepts a `File`, a `Blob`, or `{ data: Blob; filename: string }`. There are no options, no purpose parameter, no MIME type override. The server infers the type from the upload.

### From a browser file input

```ts
const input = document.querySelector<HTMLInputElement>('input[type=file]')!;
const file = input.files![0];

const upload = await client.uploadFile(file);
console.log('File ID:', upload.data.file_id);
```

### From a Blob (Node.js or programmatic)

```ts
import { readFileSync } from 'fs';

const buffer = readFileSync('./diagram.png');
const blob = new Blob([buffer], { type: 'image/png' });

const upload = await client.uploadFile({ data: blob, filename: 'diagram.png' });
```

### From a URL (fetch first)

```ts
const imageResponse = await fetch('https://example.com/photo.jpg');
const blob = await imageResponse.blob();

const upload = await client.uploadFile({ data: blob, filename: 'photo.jpg' });
```

The response nests everything under `data`:

```ts
upload.data.file_id;         // the id you put in messages (string)
upload.data.mime_type;       // e.g. 'image/png'
upload.data.size_bytes;      // (number)
upload.data.filename;        // (string)
upload.data.extracted_text;  // string for docs under extract_text, otherwise null
upload.data.url;             // access URL for rendering a preview in your own UI
```

**Always read `upload.data.file_id`, not `upload.file_id`.** The response structure nests the actual data under the `data` key.

---

## Step 3: Build a message with media

Use the `file_id` from the upload in a media block. There are several ways to do this.

### The simplest: one image or document with `Message.withFile()`

```ts
import { Message } from '10xgraph-client';

const msg = Message.withFile(
  'What is shown in this image?',
  upload.data.file_id,
  upload.data.mime_type,   // 'image/png' → ImageBlock, 'application/pdf' → DocumentBlock
);
```

`Message.withFile()` picks the block type from the MIME type: `image/*` becomes an `ImageBlock`, `audio/*` an `AudioBlock`, `video/*` a `VideoBlock`, and anything else a `DocumentBlock`. **Always pass `upload.data.mime_type`** so the helper creates the right block. Omitting it produces a `DocumentBlock`, which may confuse vision models expecting an image.

### A public URL with `Message.withImage()`

If the image is already on a URL the server can fetch, skip the upload:

```ts
const msg = Message.withImage('Describe this', 'https://example.com/photo.jpg');
```

`Message.withImage()` also accepts `data:` URIs. Prefer `uploadFile()` plus `withFile()` for anything user-supplied: it keeps the request small and gives the server a stable file_id to enforce access control against.

### Multiple files or custom block order with `Message.multimodal()`

For fine-grained control over the blocks and their order:

```ts
import { Message, TextBlock, ImageBlock, MediaRef } from '10xgraph-client';

const imageRef = (fileId: string, mime: string) => {
  const media = new MediaRef('file_id');
  media.file_id = fileId;
  media.mime_type = mime;
  return new ImageBlock(media);
};

const msg = Message.multimodal([
  new TextBlock('Which of these floor plans has more storage?'),
  imageRef(first.data.file_id, first.data.mime_type),
  imageRef(second.data.file_id, second.data.mime_type),
  new TextBlock('Answer with A or B.'),
]);
```

The `MediaRef` constructor is positional, `(kind, url, file_id, data_base64, mime_type, ...)`, so building it by field name is far less error-prone than positional arguments.

### Adding media to an existing message with `attach_media()`

```ts
const msg = Message.text_message('Compare these screenshots');

for (const up of uploads) {
  const media = new MediaRef('file_id');
  media.file_id = up.data.file_id;
  media.mime_type = up.data.mime_type;
  msg.attach_media(media, 'image');   // 'image' | 'audio' | 'video' | 'document'
}
```

Any `as_type` outside those four values throws `Unsupported media type: <value>`.

---

## Step 4: Send the message

The message works unchanged across all three call methods:

### With `invoke()`

```ts
const result = await client.invoke([msg], {
  config: { thread_id: 'vision-demo-1' },
});

const last = result.messages.at(-1);
const text = (last?.content ?? [])
  .filter((b) => b.type === 'text')
  .map((b) => (b as { text: string }).text)
  .join('');
console.log(text);
```

### With `stream()`

```ts
import { StreamEventType } from '10xgraph-client';

const stream = client.stream([msg], {
  config: { thread_id: 'vision-demo-1' },
  response_granularity: 'low',
});

for await (const chunk of stream) {
  if (chunk.event === StreamEventType.MESSAGE && chunk.message?.delta) {
    const text = chunk.message.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { text: string }).text)
      .join('');
    process.stdout.write(text);
  }
}
```

### With `wsStream()`

`wsStream()` accepts the same message and options.

---

## Step 5: Reuse files across turns

A `file_id` stays valid for as long as the server keeps the stored file, so a follow-up question about the same image does not need a re-upload:

```ts
const followUp = Message.withFile(
  'Now read the numbers along the bottom axis.',
  upload.data.file_id,
  upload.data.mime_type,
);

await client.invoke([followUp], { config: { thread_id: 'vision-demo-1' } });
```

Because the thread is checkpointed, the earlier turn is already in context. Re-attaching the file ensures the model can look at the pixels again rather than relying on its own earlier description.

---

## Step 6: Fetch file metadata and refresh URLs

### Get file info

```ts
const info = await client.getFileInfo(upload.data.file_id);

console.log(info.data.mime_type);
console.log(info.data.size_bytes);
console.log(info.data.extracted_text);  // Non-null for documents with text extraction
```

### Refresh the access URL

With cloud storage, the direct URL is signed and expires (`expires_at` is set). With local storage, `url` is a server path such as `/v1/files/{file_id}` and `expires_at` is empty. Before rendering files long after upload, fetch a fresh URL:

```ts
const urlInfo = await client.getFileAccessUrl(upload.data.file_id);

// Check if the URL is still valid. expires_at is a UNIX timestamp in seconds.
const isExpired = urlInfo.data.expires_at
  ? Date.now() / 1000 > urlInfo.data.expires_at
  : false;

const freshUrl = isExpired
  ? (await client.getFileAccessUrl(upload.data.file_id)).data.url
  : urlInfo.data.url;

renderImage(freshUrl);
```

---

## Step 7: Download a file

Retrieve the raw file bytes as a `Blob`:

```ts
const blob = await client.getFile(upload.data.file_id);

// Create a download link in the browser
const objUrl = URL.createObjectURL(blob);
const link = document.createElement('a');
link.href = objUrl;
link.download = 'downloaded-file';
link.click();
URL.revokeObjectURL(objUrl);
```

---

## Step 8: Delete a file

Remove a file you uploaded with `deleteFile()`:

```ts
await client.deleteFile(upload.data.file_id);
```

It needs the `files:delete` scope, and only the uploader can delete a file. A missing file, or one that belongs to someone else, gives a `404`. You usually do not need this, because the server deletes uploaded files when the last message or thread that references them is deleted.

---

## Complete end-to-end example

```ts
import {
  TenxGraphClient,
  Message,
  ImageBlock,
  TextBlock,
  MediaRef,
} from '10xgraph-client';

const client = new TenxGraphClient({ baseUrl: 'http://localhost:8000' });

async function describeImage(imageFile: File): Promise<string> {
  // 1. Check server config
  const config = await client.getMultimodalConfig();
  if (imageFile.size > config.data.media_max_size_mb * 1024 * 1024) {
    throw new Error(`File exceeds the server limit of ${config.data.media_max_size_mb} MB`);
  }

  // 2. Upload
  const upload = await client.uploadFile(imageFile);

  // 3. Build message using file_id
  const msg = Message.withFile('Describe this image in detail.', upload.data.file_id, upload.data.mime_type);

  // 4. Invoke
  const result = await client.invoke([msg]);

  // 5. Extract text response
  return result.messages
    .filter(m => m.role === 'assistant')
    .flatMap(m => m.content)
    .filter(b => b.type === 'text')
    .map(b => (b as any).text as string)
    .join('');
}
```

---

## Supported file types

The server accepts any MIME type unless `MEDIA_ALLOWED_CONTENT_TYPES` restricts it (exact types or wildcards such as `image/*`). Common types:

| Category | MIME types |
|---|---|
| Images | `image/jpeg`, `image/png`, `image/gif`, `image/webp` |
| Audio | `audio/mpeg`, `audio/wav`, `audio/ogg`, `audio/webm` |
| Video | `video/mp4`, `video/webm` |
| Documents | `application/pdf`, `text/plain`, `text/markdown` |

The underlying LLM determines which types it can process. Check your model's documentation for supported media types.

---

## Common errors

| Symptom | Cause | Fix |
|---|---|---|
| `file_id` is `undefined` | Reading `upload.file_id` instead of `upload.data.file_id`. | The upload response nests everything under `data`. |
| The model answers as if there were no image | `Message.withFile()` was called without `mimeType`, so the image became a `DocumentBlock`. | Pass `upload.data.mime_type`. |
| The document's content never reaches the model | `document_handling` is `skip` on the server. | Change the server setting, or send the text yourself in a `TextBlock`. |
| `extracted_text` is `null` on a PDF | `document_handling` is `pass_raw` or `skip`, or the PDF is scanned images with no text layer. | Use `extract_text` with a text-bearing PDF, or run OCR before uploading. |
| A rendered preview 403s after a while | The signed URL expired. | Fetch a fresh one with `getFileAccessUrl(file_id)`. |
| `TenxGraphError` with `statusCode` 413 | The file is larger than `media_max_size_mb`. | Compress it, or raise the limit on the server. |
| `TenxGraphError` with `statusCode` 415 | MIME type not allowed by the server's `MEDIA_ALLOWED_CONTENT_TYPES`, or the file's first bytes do not match the type you declared (for example a text file labelled `image/png`). | Use a supported file type (see table above). |
| `TenxGraphError` with `statusCode` 404 on download | `file_id` not found, or not owned by the caller. | Re-upload the file. |

---

## What you learned

- Upload files with `uploadFile()`, which accepts `File`, `Blob`, or `{ data: Blob; filename: string }`.
- The `file_id` is always nested under `response.data.file_id`, not `response.file_id`.
- Reference uploaded files in messages via `Message.withFile(text, fileId, mimeType)` or `Message.withImage()` for public URLs.
- For multiple files or custom ordering, use `Message.multimodal()` or `attach_media()`.
- The same message works unchanged across `invoke()`, `stream()`, and `wsStream()`.
- Read `getMultimodalConfig()` for the size limit and `document_handling` instead of hardcoding them.
- For cloud storage, refresh signed URLs with `getFileAccessUrl()` before rendering (expires_at is in UNIX seconds, not milliseconds).

## Next steps

See [`reference/client/message`](/docs/reference/client/message) for every block type and factory signature, or [`reference/client/files`](/docs/reference/client/files) for the full files API. For sending media from Python, see [`guides/send-media`](/docs/guides/send-media).
