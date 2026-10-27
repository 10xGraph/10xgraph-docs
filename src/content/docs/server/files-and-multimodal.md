---
title: Handle files and multimodal input
description: Enable clients to upload images, audio, and documents to your agent via the file API.
section: API server
group: Interfaces
order: 120
label: Files and multimodal
updated: "2026-10-27"
faq:
  - q: How do I restrict which file types my agent accepts?
    a: Set MEDIA_ALLOWED_CONTENT_TYPES to a comma-separated list of MIME types or wildcards (e.g., image/*,application/pdf). Empty (the default) accepts all types.
  - q: What happens to documents when they are uploaded?
    a: If DOCUMENT_HANDLING=extract_text (the default), the server extracts plain text at upload time and caches it. When the client later references that file, the document block is replaced with the cached text before your graph runs.
  - q: Should I use local or cloud storage?
    a: Use cloud storage (S3 or GCS) for any multi-worker deployment. Local storage assumes a shared filesystem and loses data on restart; memory storage loses everything on every restart.
---

The 10xGraph API server accepts file uploads from clients and injects the media into your graph's execution. Upload once, reference by ID, and rely on the server to resolve the reference before model calls. This works the same way across REST (`/v1/graph/invoke`, `POST /v1/graph/stream`) and WebSocket (`WS /v1/graph/ws`), with built-in ownership enforcement so users cannot reference each other's files.

## How it works

The file pipeline flows in four steps:

1. **Upload**: Client calls `POST /v1/files/upload` with binary data; the server stores it and returns a `file_id`.
2. **Reference**: Client includes the `file_id` in a content block (image, audio, or document) on a message sent to the graph.
3. **Rewrite**: Before execution, the server resolves the reference:
   - **Images and audio** → converted to `graph://media/{file_id}` URLs, resolved by model adapters at call time.
   - **Documents** → replaced with extracted plain text if extraction was cached at upload; otherwise the block is rewritten to a `graph://media/{file_id}` reference like images and audio.
4. **Execute**: Your graph receives the rewritten messages with fully resolved media.

This rewrite happens in the same input-preparation step for all three endpoints, so behavior is identical whether the client sends over REST, WebSocket, or the server-to-server AG-UI protocol. Ownership is checked at every step: when user B downloads or inspects a file uploaded by user A, the API returns `404`, never `403`. When user B references it in a message, the request fails with a "File not found" error (`422` on invoke). Either way the API never confirms that a foreign `file_id` exists.

The rewrite is a no-op when no media service is configured, so development without file uploads requires no extra setup.

**Note:** WebSocket live streaming (`WS /v1/graph/live`) is audio-only and does not use the file upload API; see [its documentation](/docs/server/websockets#realtime-audio-v1graphlive).

## Upload a file

To upload a file, send a multipart POST to `/v1/files/upload` with the binary data:

```bash
curl -X POST http://127.0.0.1:8000/v1/files/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@invoice.png"
```

The server responds with metadata and a unique `file_id`:

```json
{
  "data": {
    "file_id": "a8f2k9x1m5p3",
    "mime_type": "image/png",
    "size_bytes": 184320,
    "filename": "invoice.png",
    "extracted_text": null,
    "url": "/v1/files/a8f2k9x1m5p3",
    "direct_url": null,
    "direct_url_expires_at": null
  },
  "metadata": {"request_id": "...", "timestamp": "...", "message": "OK"}
}
```

### Permissions and ownership

The uploading user is automatically recorded as the file's owner. Every read operation, including retrieval, metadata queries, and message rewriting, checks ownership and rejects requests from other users (`404` on the file routes, a "File not found" error on message references). This owner recording is immutable and survives as long as the file does.

The server reads uploads in 1 MiB chunks, so oversized files are rejected before the entire body is buffered in memory. Two HTTP status codes signal problems:

| Status | Meaning |
|---|---|
| `415 Unsupported Media Type` | The file's MIME type is not in `MEDIA_ALLOWED_CONTENT_TYPES`. |
| `415 Unsupported Media Type` (content check) | The first bytes of the file do not match its declared type. The detail is `file content does not match <type>`. |
| `413 Payload Too Large` | The file exceeds `MEDIA_MAX_SIZE_MB`. The limit is checked during streaming, so rejection occurs before the full body is loaded. |

### Content check on upload

The type of an upload comes from the client's `Content-Type` header, so the server also compares the first bytes of the file with that type. A file labelled `image/png` must start like a PNG. The check covers PNG, JPEG, GIF, WebP, BMP, TIFF, ICO, PDF, Office files (ZIP-based and legacy OLE formats), MP3, WAV, OGG, FLAC, MP4 and WebM. A mismatch returns `415`. Types with no reliable signature, such as plain text, JSON and CSV, are accepted as before. EXIF data in images is kept.

### Content-type restrictions

By default, all MIME types are allowed. Before exposing the upload endpoint to untrusted callers, set `MEDIA_ALLOWED_CONTENT_TYPES` to restrict what can be uploaded:

```bash
# Exact types
MEDIA_ALLOWED_CONTENT_TYPES=image/png,image/jpeg,application/pdf

# Wildcard subtypes
MEDIA_ALLOWED_CONTENT_TYPES=image/*,application/pdf

# Any image type
MEDIA_ALLOWED_CONTENT_TYPES=image/*
```

Matching is case-insensitive and ignores charset parameters in the Content-Type header. A rejected upload returns `415 Content type not allowed: <mime>`.

## Reference a file in a message

Once uploaded, use the `file_id` in a content block. Send the message to the graph with `/v1/graph/invoke`, `/v1/graph/stream`, or over `WS /v1/graph/ws`:

```json
{
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "What is the total on this invoice?"
        },
        {
          "type": "image",
          "media": {
            "kind": "file_id",
            "file_id": "a8f2k9x1m5p3"
          }
        }
      ]
    }
  ]
}
```

The server rewrites this block to `graph://media/a8f2k9x1m5p3` before execution. Your graph receives the rewritten reference, and the model adapter resolves it when needed.

If you resend a message that already contains a `graph://media/` URL, it is left untouched, so retries are safe.

### Block types

You can reference files in image, audio, or document blocks:

```json
{
  "type": "image",
  "media": {"kind": "file_id", "file_id": "..."}
}
```

```json
{
  "type": "audio",
  "media": {"kind": "file_id", "file_id": "..."}
}
```

```json
{
  "type": "document",
  "media": {"kind": "file_id", "file_id": "..."}
}
```

## Document extraction and caching

Documents (PDFs, Word files, HTML, etc.) are handled differently from images and audio because most models expect text input, not binary files.

### Extraction at upload time

When you upload a document and `DOCUMENT_HANDLING=extract_text` (the default), the server extracts plain text immediately and returns it in the `extracted_text` field of the upload response. This extraction is cached:

- **In-process cache** (per worker): immediate lookups for the same file.
- **Checkpointer cache** (if configured): shared across workers with a 24-hour TTL in the `media:extraction` namespace.

Extractable MIME types are listed below. HTML, XML, CSV, Markdown, JSON and plain-text files over 5 MiB are not parsed: they are stored without extracted text, so `extracted_text` is `null` and a warning is logged. The upload still succeeds. At most 2 extractions run at the same time.

Extractable MIME types:

- `application/pdf` (PDF documents)
- `application/msword` (legacy Word .doc)
- `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (Word .docx)
- `text/html`, `text/xml`, `application/xml` (markup)
- `text/markdown`, `text/csv`, `application/json`, `text/plain` (text formats)

Document extraction requires the `media` extra:

```bash
pip install "10xgraph-api[media]"
```

### Document handling modes

Three modes control what happens to document blocks when referenced:

| Mode | Behavior |
|---|---|
| `extract_text` | Extract text at upload and replace the document block with the cached text on reference. Default. |
| `pass_raw` | No extraction at upload; the document block stays a media reference for your graph or model adapter to handle. |
| `skip` | No extraction at upload; documents are not turned into text. |

Set the mode via the `DOCUMENT_HANDLING` environment variable.

### Multi-worker extraction

If you run multiple workers without a checkpointer, each worker maintains its own in-process extraction cache. A document uploaded through worker A may be re-extracted on worker B, wasting CPU. Configure a checkpointer (PostgreSQL + Redis recommended for production) to share the extraction cache across workers.

## External media URLs

A client can send a media block with a URL instead of a `file_id`. Before the run starts, the server checks every external URL (`http(s)://`, `gs://` and so on) in client input against the graph's media fetch policy. This covers invoke, stream, WebSocket, AG-UI, `POST /v1/threads/{thread_id}/messages` and `PUT /v1/threads/{thread_id}/state`. A blocked URL returns `400` with the policy's message. On the WebSocket it comes back as an error chunk. The check touches no network.

The policy is `MediaFetchPolicy` from core. You set it in code with `graph.compile(media_policy=...)`, and the API has no setting for it. Without one, the default policy applies: `http` and `https` to public hosts only. A client `gs://` URL is refused unless its bucket is listed in `allowed_gcs_buckets`, because on Vertex AI the server reads `gs://` with its own credentials. Your own graph code may still pass any `gs://` URL. All fields, the rules that cannot be disabled and an example are in [Sending media from Python](/docs/guides/send-media#control-which-urls-the-server-downloads).

The check needs a core release that ships `MediaFetchPolicy`. On older cores it is skipped.

## Delete a file and file lifecycle

`DELETE /v1/files/{file_id}` deletes a file and its metadata. Only the uploader can delete it. A missing file, or a file that belongs to someone else, returns `404`, never `403`. The route needs the `files:delete` scope, which roles granted `"*"` have.

```bash
curl -X DELETE http://127.0.0.1:8000/v1/files/a8f2k9x1m5p3 \
  -H "Authorization: Bearer $TOKEN"
```

```json
{
  "data": {"file_id": "a8f2k9x1m5p3", "deleted": true},
  "metadata": {"request_id": "...", "timestamp": "...", "message": "OK"}
}
```

You rarely need it, because uploaded files are cleaned up with the conversations that use them:

- When an accepted message references `graph://media/<key>`, the server adds the thread id to the file's `threads` metadata. Only files the caller owns are tracked.
- Deleting a message removes the link, but only when no other message in that thread still uses the file. Deleting a thread removes its links.
- A file with no thread left is deleted.
- A file shared by two threads stays until both are gone.
- Files uploaded before this tracking existed have no `threads` record and are never deleted automatically.
- With auth off, uploads have no owner and nothing is tracked, so nothing is deleted automatically.
- A cleanup failure is logged. It never fails the delete of the message or thread.

Tracking needs a core release with `BaseMediaStore.update_metadata`. On older cores, nothing is tracked or deleted automatically.

To keep files after their messages and threads are gone, set `media.delete_with_thread` to `false` in `10xgraph.json`. The server still records the links but never deletes a file automatically. The default is `true`. You can also edit it in `10xgraph config`.

```json
{
  "media": {
    "delete_with_thread": false
  }
}
```

Where the bytes live is your choice: set `MEDIA_STORAGE_TYPE` to `memory`, `local` or `cloud` (see [Storage backends](#storage-backends)).

## Query the server's media configuration

Clients can call `GET /v1/config/multimodal` to discover what the server accepts without hard-coding assumptions:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:8000/v1/config/multimodal
```

```json
{
  "data": {
    "media_storage_type": "local",
    "media_max_size_mb": 25.0,
    "document_handling": "extract_text"
  },
  "metadata": {"request_id": "...", "timestamp": "...", "message": "OK"}
}
```

This requires the `config:read` permission. The response intentionally omits the content-type allowlist; treat HTTP `415` as the signal that a type is refused.

## Storage backends

Configure where and how uploaded files are stored via environment variables. Three backends are available: in-memory (development only), local filesystem (single-server), and cloud (S3 or GCS, recommended for production).

### Memory storage

```bash
MEDIA_STORAGE_TYPE=memory
```

All files are held in RAM and lost on restart. Use only for local development and testing. A worker restart or crash loses all uploads.

### Local filesystem storage

```bash
MEDIA_STORAGE_TYPE=local
MEDIA_STORAGE_PATH=./uploads
```

Files are written to the configured directory. The default is `./uploads` relative to the working directory. Directories are created with mode `0700` and files with `0600`, so only the user running the server can read them. A different OS user or service that serves or reads uploads (for example a web server) loses access, so run it as the same user or share the files another way. Existing files and folders keep their mode, and this has no effect on Windows. This backend assumes a shared filesystem across workers (e.g., NFS or attached storage), so each worker can read files uploaded by any other worker. Without shared storage, files uploaded to one worker are not visible to the others.

### Cloud storage (AWS S3 or Google Cloud Storage)

```bash
MEDIA_STORAGE_TYPE=cloud
MEDIA_CLOUD_PROVIDER=aws
MEDIA_CLOUD_BUCKET=my-bucket
MEDIA_CLOUD_REGION=us-east-1
MEDIA_CLOUD_PREFIX=10xgraph-media
```

Files are uploaded to S3 or GCS, accessible to all workers instantly. This is the recommended setup for multi-worker deployments. The cloud backend is stateless and horizontally scalable.

#### AWS S3 credentials

Provide credentials one of three ways:

**Via environment variables:**

```bash
MEDIA_CLOUD_ACCESS_KEY_ID=AKIA...
MEDIA_CLOUD_SECRET_ACCESS_KEY=...
```

**Via temporary AWS session token:**

```bash
MEDIA_CLOUD_ACCESS_KEY_ID=ASIA...
MEDIA_CLOUD_SECRET_ACCESS_KEY=...
MEDIA_CLOUD_SESSION_TOKEN=...
```

**Via IAM role (recommended):** Omit credentials and rely on the instance's attached IAM role.

#### Google Cloud credentials

Provide a service account JSON key:

```bash
MEDIA_CLOUD_PROVIDER=gcp
MEDIA_CLOUD_PROJECT_ID=my-project
MEDIA_CLOUD_CREDENTIALS_JSON='{"type": "service_account", ...}'
```

Or set `GOOGLE_APPLICATION_CREDENTIALS` and omit `MEDIA_CLOUD_CREDENTIALS_JSON`.

## Signed URLs and direct access

With a cloud storage backend, clients can request signed direct URLs to bypass the API server. With `local` or `memory` storage there is no direct URL, and `url` is the API path `/v1/files/{file_id}`. `expires_at` is a Unix timestamp in seconds.

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:8000/v1/files/{file_id}/url
```

```json
{
  "data": {
    "url": "https://s3.amazonaws.com/bucket/10xgraph-media/abc123?X-Amz-Algorithm=...",
    "file_id": "a8f2k9x1m5p3",
    "expires_at": 1791470000,
    "mime_type": "image/png"
  },
  "metadata": {"request_id": "...", "timestamp": "...", "message": "OK"}
}
```

Signed URLs are useful for large files or direct browser downloads. Ownership is checked before issuing a URL, but the signed URL itself is a bearer link: anyone who holds it can download the file until it expires.

### Signed URL configuration

| Variable | Default | Purpose |
|---|---|---|
| `MEDIA_SIGNED_URL_TTL_SECONDS` | `3600` | Lifetime of a signed URL (1 hour). |
| `MEDIA_SIGNED_URL_REFRESH_BUFFER_SECONDS` | `60` | Re-sign this many seconds before expiry instead of handing out a URL about to die. |

The server caches the signed URL and reuses it until fewer than `MEDIA_SIGNED_URL_REFRESH_BUFFER_SECONDS` remain, then signs a new one. With the defaults, a client always receives a URL with at least 60 seconds of validity left.

## Production deployment checklist

Before shipping to production, configure the following:

- **Content types**: Set `MEDIA_ALLOWED_CONTENT_TYPES` to only the types your agent handles. Do not leave it empty.
- **File size**: Set `MEDIA_MAX_SIZE_MB` to the smallest value that works for your use case. This is independent of `MAX_REQUEST_SIZE` (10 MB by default), which applies to entire HTTP request bodies.
- **Storage backend**: Use `cloud` storage (S3 or GCS) for any deployment with multiple workers. The `local` backend requires a shared filesystem and is not suitable for containerized deployments. Memory storage is development-only.
- **Extraction cache**: Configure a checkpointer (PostgreSQL + Redis recommended) to share document extraction cache across workers. Without it, the same document is extracted per worker per process, wasting CPU.
- **Ownership enforcement**: Set `MEDIA_REQUIRE_OWNER=true` if you need absolute certainty that no file without a recorded owner can be accessed. Files uploaded before ownership tracking was enabled have no owner and are otherwise allowed with a warning.
- **Signed URL TTL**: Adjust `MEDIA_SIGNED_URL_TTL_SECONDS` based on how long clients hold URLs (longer for downloads from slow connections, shorter for security).

## See also

- [REST API: Files reference](/docs/reference/rest-api/files)
- [REST API: Graph endpoints](/docs/reference/rest-api/graph) (invoke, stream, stop, fix)
- [Environment variables](/docs/reference/api-cli/environment)
- [Media concepts](/docs/concepts/media-and-files) (sender side)
- [Production checklist](/docs/server/production-checklist) (full hardening guide)
