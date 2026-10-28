---
title: Files
seoTitle: "File upload and media in the TS client"
description: "Upload, retrieve, and manage multimodal files with the 10xGraph TypeScript client."
section: Reference
group: "TypeScript client"
order: 540
label: Files
updated: "2026-10-26"
---

The file methods on `TenxGraphClient` upload binary files to the server, then fetch the file, its metadata or a usable access URL. An upload returns a `file_id` and a `url` that you place in a `MediaRef` inside an `ImageBlock`, `AudioBlock` or `DocumentBlock`. For the task-oriented walkthrough, see [Files and multimodal](/docs/client/files-and-multimodal).

**Package:** `10xgraph-client`  
**Import:** `import { TenxGraphClient } from '10xgraph-client';`

---

## Upload flow

1. Call `uploadFile(file)` with a `File`, `Blob`, or `{ data: Blob; filename: string }` object.
2. Receive a `file_id` and a `url` in the response.
3. Embed the access URL (or `file_id`) inside a `MediaRef` in the appropriate content block.
4. Send the message containing the block via `invoke()` or `stream()`.

---

## `uploadFile(file)`

Upload a file to the server.

**Endpoint:** `POST /v1/files/upload`

```ts
// From a browser file input
const input = document.querySelector<HTMLInputElement>('input[type=file]')!;
const file = input.files![0];
const response = await client.uploadFile(file);

// From a Blob with a custom filename
const blob = new Blob([imageBytes], { type: 'image/png' });
const response = await client.uploadFile({ data: blob, filename: 'screenshot.png' });
```

### Accepted input types

| Type | How file is named |
|---|---|
| `File` | Uses `file.name` automatically. |
| `Blob` | Fallback filename `'upload'` is used. Specify `{ data: blob, filename: '...' }` if the name matters. |
| `{ data: Blob; filename: string }` | Uses the `filename` field. |

### `FileUploadResponse`

```ts
interface FileUploadResponse {
  data: {
    file_id: string;           // Unique identifier for the uploaded file
    mime_type: string;         // Detected MIME type (e.g. 'image/jpeg')
    size_bytes: number;        // File size in bytes
    filename: string;          // Name as stored on the server
    extracted_text: string | null; // Text extracted from documents, or null
    url: string;               // Access URL, use this in MediaRef
    direct_url?: string | null;       // Direct URL (e.g. S3 presigned URL) if cloud-backed
    direct_url_expires_at?: number | null; // Unix timestamp (seconds) when direct_url expires
  };
  metadata?: {
    request_id: string;
    timestamp: string;
    message: string;
  };
}
```

**Use the response in a message:**

```ts
const upload = await client.uploadFile(imageFile);

// Reference by URL (simplest)
const imageBlock = new ImageBlock(
  new MediaRef('url', upload.data.url),
  'Uploaded image'
);

// Reference by file_id (more portable; the server resolves the URL)
const mediaRef = new MediaRef('file_id');
mediaRef.file_id = upload.data.file_id;
mediaRef.mime_type = upload.data.mime_type;

const imageMsg = new Message('user', [
  new TextBlock('What is in this image?'),
  new ImageBlock(mediaRef),
]);

const result = await client.invoke([imageMsg]);
```

---

## `getFile(fileId)`

Download a file by its `file_id`. Returns a raw `Blob`.

**Endpoint:** `GET /v1/files/{fileId}`

```ts
const blob = await client.getFile('file-abc123');
const url = URL.createObjectURL(blob);
// Render in an <img> tag or download
```

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `fileId` | `string` | The file ID returned by `uploadFile()`. |

---

## `deleteFile(fileId)`

Delete a stored file and its metadata. Only the user who uploaded the file can delete it. The call needs the `files:delete` scope.

**Endpoint:** `DELETE /v1/files/{fileId}`

```ts
const res = await client.deleteFile('file-abc123');
console.log(res.data.deleted); // true
```

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `fileId` | `string` | The file ID returned by `uploadFile()`. |

### `DeleteFileResponse`

```ts
interface DeleteFileResponse {
  data: { file_id: string; deleted: boolean };
  metadata: ResponseMetadata;
}
```

The server returns `404` ("File not found") when the file does not exist or belongs to someone else, and the client throws. You rarely need this call: the server also deletes uploaded files when the last message or thread that references them is deleted (see [Delete a file and file lifecycle](/docs/server/files-and-multimodal#delete-a-file-and-file-lifecycle)).

---

## `getFileInfo(fileId)`

Fetch metadata about a stored file without downloading its contents.

**Endpoint:** `GET /v1/files/{fileId}/info`

```ts
const info = await client.getFileInfo('file-abc123');
console.log(info.data.mime_type);       // 'application/pdf'
console.log(info.data.size_bytes);      // 204800
console.log(info.data.extracted_text);  // Extracted text, or null
```

### `FileInfoResponse`

```ts
interface FileInfoResponse {
  data: {
    file_id: string;
    mime_type: string;
    size_bytes: number;
    filename?: string | null;
    extracted_text: string | null;
    direct_url?: string | null;
    direct_url_expires_at?: number | null;
  };
  metadata?: ResponseMetadata;
}
```

---

## `getFileAccessUrl(fileId)`

Get the best access URL for a file. For cloud-backed storage (S3, GCS, Azure) this returns a time-limited signed URL. For local or memory-backed storage it returns the normal API file route.

**Endpoint:** `GET /v1/files/{fileId}/url`

```ts
const result = await client.getFileAccessUrl('file-abc123');
console.log(result.data.url);             // The best URL to use right now
console.log(result.data.expires_at);      // Unix timestamp (seconds), or null if permanent
console.log(result.data.mime_type);
```

### `FileAccessUrlResponse`

```ts
interface FileAccessUrlResponse {
  data: {
    file_id: string;
    url: string;
    expires_at?: number | null;  // Unix timestamp in seconds; null = no expiry
    mime_type: string;
  };
  metadata?: ResponseMetadata;
}
```

<aside class="callout callout-tip" role="note"><p class="callout-title">Refreshing signed URLs</p>

If you display a file in the UI and the user might have the page open for a long time, poll `getFileAccessUrl()` before rendering to ensure the URL has not expired. The expires_at field is a Unix timestamp in seconds, so compare it with `Math.floor(Date.now() / 1000)`.

</aside>

---

## `getMultimodalConfig()`

Fetch the server's multimodal configuration: which storage backend is active, the max upload size, and how documents are handled.

**Endpoint:** `GET /v1/config/multimodal`

```ts
const config = await client.getMultimodalConfig();
console.log(config.data.media_storage_type);  // 'memory' | 'local' | 'cloud'
console.log(config.data.media_max_size_mb);   // 25 by default (MEDIA_MAX_SIZE_MB)
console.log(config.data.document_handling);   // 'extract_text' | 'pass_raw' | 'skip'
```

### `MultimodalConfigResponse`

```ts
interface MultimodalConfigResponse {
  data: {
    media_storage_type: string;   // Storage backend identifier
    media_max_size_mb: number;    // Maximum file size in megabytes
    document_handling: string;    // 'extract_text' | 'pass_raw' | 'skip'
  };
  metadata?: ResponseMetadata;
}
```

---

## Supported MIME types

By default the server accepts any content type. An operator can restrict uploads with the `MEDIA_ALLOWED_CONTENT_TYPES` setting (comma-separated entries such as `image/*,application/pdf`); a rejected type returns status `415`. Separately, the graph can only use types that the underlying LLM supports. Typical choices:

| Category | MIME types |
|---|---|
| Images | `image/jpeg`, `image/png`, `image/gif`, `image/webp` |
| Audio | `audio/mpeg`, `audio/wav`, `audio/ogg`, `audio/webm` |
| Video | `video/mp4`, `video/webm` |
| Documents | `application/pdf`, `text/plain`, `text/markdown` |

Call `getMultimodalConfig()` to confirm the active storage settings and size limit before uploading.

---

## Complete example: image Q&A

```ts
import {
  TenxGraphClient,
  Message,
  ImageBlock,
  TextBlock,
  MediaRef,
} from '10xgraph-client';

const client = new TenxGraphClient({ baseUrl: 'http://localhost:8000' });

async function askAboutImage(imageFile: File, question: string) {
  // 1. Upload the image
  const upload = await client.uploadFile(imageFile);

  // 2. Build a multimodal message
  const userMsg = new Message('user', [
    new TextBlock(question),
    new ImageBlock(
      new MediaRef('url', upload.data.url),
      imageFile.name
    ),
  ]);

  // 3. Invoke and return the answer
  const result = await client.invoke([userMsg]);
  const answer = result.messages
    .filter(m => m.role === 'assistant')
    .flatMap(m => m.content)
    .filter(b => b.type === 'text')
    .map(b => (b as any).text)
    .join('');

  return answer;
}
```

---

## Common errors

| Error | Cause | Fix |
|---|---|---|
| `TenxGraphError` with `statusCode` `413` | File exceeds `media_max_size_mb`. | Check `getMultimodalConfig()` and reduce file size. |
| `TenxGraphError` with `statusCode` `415` | The server restricts content types and yours is not allowed, or the file's bytes do not match its declared type. | Upload an allowed type with the right `Content-Type`, or ask the operator to adjust `MEDIA_ALLOWED_CONTENT_TYPES`. |
| `NotFoundError` (`statusCode` `404`) | `file_id` not found, or not visible to the current user. | Re-upload the file or check the ID. |
| `TenxGraphError` with `statusCode` `403` on `deleteFile()` | The token lacks the `files:delete` scope. | Ask the operator to grant it. |
| Signed URL expired | `expires_at` is in the past. | Call `getFileAccessUrl()` to refresh the URL. |

---

## What you learned

- `uploadFile()` accepts `File`, `Blob`, or `{ data, filename }`. It returns a `file_id` and `url`.
- Reference uploaded files in messages via `MediaRef('url', url)` or `MediaRef('file_id')` with `file_id` set.
- `getFileAccessUrl()` refreshes cloud-backed signed URLs; the expiry is a Unix timestamp in seconds.
- `getMultimodalConfig()` tells you the storage backend and max file size.

## Next step

See [`reference/client/auth`](/docs/reference/client/auth) to learn how to configure authentication for the client.
