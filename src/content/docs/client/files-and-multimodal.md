---
title: "Work with files and multimodal messages"
description: "Upload images, documents, and audio; reference them in messages with file_id for secure, efficient multimodal input."
section: "TypeScript client"
group: "Features"
order: 70
label: "Files and multimodal"
updated: "2026-11-26"
---

Upload a file once, then reference it by `file_id` in as many messages as you need. The server checks access on every use and resolves the file when it calls the model.

## Prerequisites

- A configured `TenxGraphClient`. See [create-client](/docs/client/create-client).
- The API server running with media storage configured. You can check with `getMultimodalConfig()` before uploading.
- A model that supports the media type you send.

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

What each `document_handling` value does is in [Document handling modes](/docs/server/files-and-multimodal#document-handling-modes).

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

The response nests everything under `data`:

```ts
upload.data.file_id;         // the id you put in messages (string)
upload.data.mime_type;       // e.g. 'image/png'
upload.data.size_bytes;      // (number)
upload.data.filename;        // (string)
upload.data.extracted_text;  // string for docs under extract_text, otherwise null
upload.data.url;             // access URL for rendering a preview in your own UI
```

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

---

## Step 4: Send the message

The message works unchanged across all three call methods:

### With `invoke()`

```ts
// No thread_id: the server starts a thread. Keep result.thread_id to continue it.
const result = await client.invoke([msg]);
const threadId = result.thread_id;

console.log(result.messages.at(-1)?.text() ?? '');
```

`stream()` and `wsStream()` take the same message; see [Stream responses](/docs/client/stream-responses).

---

## Step 5: Reuse files across turns

A `file_id` stays valid for as long as the server keeps the stored file, so a follow-up question about the same image does not need a re-upload:

```ts
const followUp = Message.withFile(
  'Now read the numbers along the bottom axis.',
  upload.data.file_id,
  upload.data.mime_type,
);

await client.invoke([followUp], { config: { thread_id: threadId } });
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
const { data } = await client.getFileAccessUrl(upload.data.file_id);
renderImage(data.url); // expires_at: UNIX seconds for a signed URL, else null
```

### List your files

```ts
const { data } = await client.listFiles({ limit: 50, offset: 0 });
for (const f of data.files) console.log(f.file_id, f.filename, f.size_bytes);
// data.has_more is true when another page follows
```

A media store that cannot list its files (for example cloud storage) answers 501.

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

It needs the `files:delete` permission. The uploader can delete a file, and so can a caller whose reach (`tenant` or `all`) covers it; any other file answers `404`. You usually do not need this, because the server deletes uploaded files when the last message or thread that references them is deleted.

---

## Supported file types

The server accepts any MIME type unless `MEDIA_ALLOWED_CONTENT_TYPES` restricts it (exact types or wildcards such as `image/*`). Configuration: [Content-type restrictions](/docs/server/files-and-multimodal#content-type-restrictions). Which types a model reads depends on the provider.

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
| `TenxGraphError` with `statusCode` 415 | MIME type not allowed by the server's `MEDIA_ALLOWED_CONTENT_TYPES`, or the file's first bytes do not match the type you declared (for example a text file labelled `image/png`). | Use a type the server allows (see [content-type restrictions](/docs/server/files-and-multimodal#content-type-restrictions)). |
| `NotFoundError` (404) on download | `file_id` not found, or outside the caller's reach. | Re-upload the file. |

---

## Next steps

See [`reference/client/message`](/docs/reference/client/message) for every block type and factory signature, or [`reference/client/files`](/docs/reference/client/files) for the full files API. For sending media from Python, see [`guides/send-media`](/docs/guides/send-media).
