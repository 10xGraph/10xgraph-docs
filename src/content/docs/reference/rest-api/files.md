---
title: File upload endpoints
description: "Reference for the 10xGraph REST endpoints that upload files and retrieve them, with request fields, responses, and authentication requirements."
section: Reference
group: "REST API"
order: 360
label: Files
updated: "2026-10-26"
---

The file endpoints upload images, audio and documents to the 10xGraph server and return a `file_id` you reference from graph messages. Each file belongs to the user who uploaded it, and every read checks that ownership. This page lists each route with its permission, request, response and errors.

Base path: `/v1/files`. Every route needs authentication when `auth` is configured (see [Authentication](/docs/server/auth)), and JSON responses use the standard envelope described in [REST API conventions](/docs/reference/rest-api/conventions). For task-oriented guidance see [Files and multimodal on the server](/docs/server/files-and-multimodal) and [Files and multimodal in the client](/docs/client/files-and-multimodal).

| Method and path | Permission | Purpose |
| --- | --- | --- |
| `POST /v1/files/upload` | `files:upload` | Upload a file, receive a `file_id`. |
| `GET /v1/files` | `files:read` | List your files, newest first. |
| `GET /v1/files/{file_id}` | `files:read` | Download the raw bytes. |
| `GET /v1/files/{file_id}/info` | `files:read` | Read metadata only. |
| `GET /v1/files/{file_id}/url` | `files:read` | Get a direct access URL. |
| `DELETE /v1/files/{file_id}` | `files:delete` | Delete a file you uploaded. |
| `GET /v1/config/multimodal` | `config:read` | Read the server's media settings. |

---

## POST /v1/files/upload

Uploads one file as `multipart/form-data` and returns its `file_id`, size and type. The response also carries extracted text for documents when text extraction is on.

**Request:** `Content-Type: multipart/form-data`

| Field | Type | Description |
| --- | --- | --- |
| `file` | binary | The file to upload (required, must have a filename) |

**Accepted types:**

The server accepts **any** content type by default. `MEDIA_ALLOWED_CONTENT_TYPES` is empty out of the box, and an empty allowlist means allow everything. Set it to restrict uploads:

```bash
MEDIA_ALLOWED_CONTENT_TYPES=image/*,application/pdf
```

Entries may be exact (`image/png`) or wildcard subtype (`image/*`). A rejected type returns `415`.

The server also compares the first bytes of the file with its declared type for PNG, JPEG, GIF, WebP, BMP, TIFF, ICO, PDF, Office (ZIP and OLE), MP3, WAV, OGG, FLAC, MP4 and WebM. A mismatch returns `415` with `file content does not match <type>`. Types with no known signature (plain text, JSON, CSV) are accepted.

Types commonly sent to an agent: `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `audio/mpeg`, `audio/wav`, `audio/ogg`, `application/pdf`, `text/plain`.

**Size limit:** `MEDIA_MAX_SIZE_MB` (environment variable, default `25.0` MB). Exceeding it returns `413`. The body is read in 1 MiB chunks with a running size cap, so an oversized or chunked upload is rejected before it is buffered whole.

**Example:**

```bash
curl -X POST http://127.0.0.1:8000/v1/files/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@photo.jpg"
```

**Response:**

```json
{
  "data": {
    "file_id": "f_abc123",
    "mime_type": "image/jpeg",
    "size_bytes": 24576,
    "filename": "photo.jpg",
    "extracted_text": null,
    "url": "/v1/files/f_abc123",
    "direct_url": null,
    "direct_url_expires_at": null
  },
  "metadata": {"request_id": "...", "timestamp": "...", "message": "OK"}
}
```

| Field | Description |
| --- | --- |
| `file_id` | Opaque storage key. Reference this from message content blocks. |
| `mime_type` | The content type the server recorded. |
| `size_bytes` | Stored size in bytes. |
| `filename` | Original filename from the upload. |
| `extracted_text` | Extracted document text, when `DOCUMENT_HANDLING=extract_text` and the type is extractable. `null` otherwise, and also `null` for HTML, XML, CSV, Markdown, JSON and plain-text files over 5 MiB, which are stored without extraction. |
| `url` | API-relative retrieval path. |
| `direct_url` | Signed direct URL, when the storage backend can produce one. |
| `direct_url_expires_at` | Expiry of the signed URL as a Unix timestamp. |

The uploader is recorded as the file's owner. Every read path checks it, and a file owned by another user returns `404`, not `403`, so the API never confirms that a foreign `file_id` exists.

---

## GET /v1/files

Lists the files the caller uploaded, newest first. Files with no recorded owner are not listed. With auth off there is no user, so every file is listed.

| Query parameter | Default | Description |
| --- | --- | --- |
| `limit` | `50` | Page size, 1 to 200. |
| `offset` | `0` | Files to skip. |

The response `data` has `files` (each with `file_id`, `filename`, `mime_type`, `size_bytes`, `url`, `created_at`), `has_more`, `offset` and `limit`.

It works on every store, cloud (S3, GCS) included. A cloud store keeps a per-owner index, so files stored before `10xgraph` 1.0, or stored with no owner, are not listed. Listing with auth off on a cloud store, and any custom store that cannot enumerate its keys, answers `501`. The same index serves the per-user quotas and the release of a thread's files when the thread is deleted.

---

## GET /v1/files/{file_id}

Returns the raw bytes of a stored file with its recorded `Content-Type`. Types that could run script in a browser (HTML, XML, SVG, JavaScript) are served as `application/octet-stream` downloads with `Content-Disposition: attachment`, and every response carries `X-Content-Type-Options: nosniff`.

**Inline types** (served with `Content-Disposition: inline`): `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/avif`, `image/bmp`, `application/pdf`, `text/plain`, and any `audio/*` or `video/*` type. Other types are sent as attachments.

**Example:**

```bash
curl http://127.0.0.1:8000/v1/files/f_abc123 --output photo.jpg
```

**Errors:** `404` if the file does not exist or is owned by another user.

---

## GET /v1/files/{file_id}/info

Returns the metadata of a file without downloading its bytes.

**Response:**

```json
{
  "data": {
    "file_id": "f_abc123",
    "mime_type": "image/jpeg",
    "size_bytes": 24576,
    "filename": "photo.jpg",
    "extracted_text": null,
    "direct_url": null,
    "direct_url_expires_at": null
  },
  "metadata": {"request_id": "...", "timestamp": "...", "message": "OK"}
}
```

| Field | Description |
| --- | --- |
| `file_id` | The requested file ID. |
| `mime_type` | The content type the server recorded. |
| `size_bytes` | Stored size in bytes. |
| `filename` | Original filename. |
| `extracted_text` | Extracted document text if enabled, otherwise `null`. |
| `direct_url` | Signed direct URL for the storage backend, if available. |
| `direct_url_expires_at` | Expiry of the signed URL as a Unix timestamp. |

**Errors:** `404` if the file does not exist or is owned by another user.

---

## GET /v1/files/{file_id}/url

Returns a URL for fetching the file. With a cloud storage backend this is a signed URL that bypasses the API server; otherwise it is the API-relative path `/v1/files/{file_id}`. Use it when a consumer needs a URL instead of a `file_id`.

**Response:**

```json
{
  "data": {
    "file_id": "f_abc123",
    "url": "https://storage.example.com/10xgraph-media/f_abc123?...",
    "expires_at": 1728427200,
    "mime_type": "image/jpeg"
  },
  "metadata": {"request_id": "...", "timestamp": "...", "message": "OK"}
}
```

| Field | Description |
| --- | --- |
| `file_id` | The requested file ID. |
| `url` | Direct URL to the file (signed if cloud storage, API-relative if local). |
| `expires_at` | Expiry of the signed URL as a Unix timestamp in seconds. `null` when no signed URL exists. Signed URLs live `MEDIA_SIGNED_URL_TTL_SECONDS` (default 3600). |
| `mime_type` | The content type of the file. |

**Errors:** `404` if the file does not exist or is owned by another user.

---

## Using a file_id in a message

Send the `file_id` inside a media block in the message content array. The block holds a `media` reference of kind `file_id`, not a bare `file_id` field:

```json
{
  "messages": [
    {
      "role": "user",
      "content": [
        {"type": "text", "text": "What is in this image?"},
        {"type": "image", "media": {"kind": "file_id", "file_id": "f_abc123", "mime_type": "image/jpeg"}}
      ]
    }
  ],
  "config": {"thread_id": "media-thread"}
}
```

Use `audio`, `video` or `document` as the block `type` for other files. The graph receives an `ImageBlock` (or the matching block type) whose `media` points at the uploaded file, ready to send to a model that supports that input. See [Send media to a model](/docs/guides/send-media) for the Python side.

---

## Error responses

Uploads fail with `400`, `413` or `415`; reads fail with `404`. A missing permission returns the standard authorization error (see [Authentication](/docs/server/auth)).

| Status | Description |
| --- | --- |
| `400` | Missing filename or empty file. |
| `422` | The multipart body has no `file` part. Auth is checked before the body is parsed, so an unauthenticated request never gets this far. |
| `413` | File exceeds `MEDIA_MAX_SIZE_MB` (or the media service rejects its size). The limit is checked as data arrives in 1 MiB chunks, so uploads are rejected before the whole file is buffered. The same status answers an image over `MEDIA_MAX_IMAGE_PIXELS`, a PDF over `MEDIA_MAX_PDF_MB` or `MEDIA_MAX_PDF_PAGES`, and an upload past the per-user quota (`MEDIA_MAX_FILES_PER_USER`, `MEDIA_MAX_USER_STORAGE_MB`). |
| `415` | Content type not allowed by `MEDIA_ALLOWED_CONTENT_TYPES`. |
| `404` | `file_id` not found or owned by another user. |

---

## DELETE /v1/files/{file_id}

Deletes a stored file and its metadata. Only the uploader can delete a file.

**Example:**

```bash
curl -X DELETE http://127.0.0.1:8000/v1/files/f_abc123 \
  -H "Authorization: Bearer $TOKEN"
```

**Response:**

```json
{
  "data": {"file_id": "f_abc123", "deleted": true},
  "metadata": {"request_id": "...", "timestamp": "...", "message": "OK"}
}
```

**Errors:** `404` if the file does not exist or is owned by another user. The permission is `files:delete`, which roles granted `"*"` have.

Files are also deleted for you when the last message or thread that references them is deleted. See [Delete a file and file lifecycle](/docs/server/files-and-multimodal#delete-a-file-and-file-lifecycle).

---

## GET /v1/config/multimodal

Returns the media settings the server runs with, so a client can check limits before uploading. It requires `config:read`.

```bash
curl http://127.0.0.1:8000/v1/config/multimodal -H "Authorization: Bearer $TOKEN"
```

| Field | Description |
| --- | --- |
| `media_storage_type` | `memory`, `local` or `cloud`. |
| `media_max_size_mb` | Upload size limit in MB (`MEDIA_MAX_SIZE_MB`). |
| `document_handling` | `extract_text`, `pass_raw` or `skip` (`DOCUMENT_HANDLING`, default `extract_text`). |

---

## Permissions

Uploads require `files:upload`. Downloads, info and URL requests require `files:read`. Settings are described in [Environment variables](/docs/reference/api-cli/environment). Setting `MEDIA_REQUIRE_OWNER=true` also denies files that have no recorded owner.
