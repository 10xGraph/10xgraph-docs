---
title: File upload endpoints
description: "Reference for the 10xGraph REST endpoints that upload files and retrieve them, with request fields, responses, and authentication requirements."
section: Reference
group: "REST API"
order: 360
label: Files
updated: "2026-11-25"
---

The file endpoints upload images, audio and documents to the 10xGraph server and return a `file_id` you reference from graph messages. Each file belongs to its uploader; reads check the caller's reach.

Base path: `/v1/files`. Every route needs authentication when `auth` is configured (see [Authentication](/docs/server/auth)), and JSON responses use the standard envelope described in [REST API conventions](/docs/reference/rest-api/conventions). For task-oriented guidance see [Files and multimodal on the server](/docs/server/files-and-multimodal) and [Files and multimodal in the client](/docs/client/files-and-multimodal).

| Method and path | Permission | Purpose |
| --- | --- | --- |
| `POST /v1/files/upload` | `files:upload` | Upload a file, receive a `file_id`. |
| `GET /v1/files` | `files:read` | List your files, newest first. |
| `GET /v1/files/{file_id}` | `files:read` | Download the raw bytes. |
| `GET /v1/files/{file_id}/info` | `files:read` | Read metadata only. |
| `GET /v1/files/{file_id}/url` | `files:read` | Get a direct access URL. |
| `DELETE /v1/files/{file_id}` | `files:delete` | Delete a file. |
| `GET /v1/config/multimodal` | `config:read` | Read the server's media settings; see [Config](/docs/reference/rest-api/config). |

---

## POST /v1/files/upload

Uploads one file as `multipart/form-data` and returns its `file_id`, size and type.

**Request:** `Content-Type: multipart/form-data`

| Field | Type | Description |
| --- | --- | --- |
| `file` | binary | The file to upload (required, must have a filename) |

**Accepted types:** types are restricted by `MEDIA_ALLOWED_CONTENT_TYPES` (empty allows all; a rejected type is `415`). The first bytes are checked against the declared type for common image, audio, video, PDF and Office formats (`415` `file content does not match <type>`).

**Size limit:** `MEDIA_MAX_SIZE_MB` (environment variable, default `25.0` MB). Exceeding it returns `413`.

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
| `filename` | The uploaded filename, cleaned to a safe base name (at most 255 characters, `unnamed` if nothing is left). |
| `extracted_text` | Extracted document text, when `DOCUMENT_HANDLING=extract_text` and the type is extractable. `null` otherwise. |
| `url` | API-relative retrieval path. |
| `direct_url` | Signed direct URL, when the storage backend can produce one. |
| `direct_url_expires_at` | Expiry of the signed URL as a Unix timestamp. |

The uploader is recorded as the file's owner. A file outside the caller's reach returns `404`.

---

## GET /v1/files

Lists the files the caller uploaded, newest first. Files with no recorded owner are not listed. With auth off there is no user, so every file is listed.

| Query parameter | Default | Description |
| --- | --- | --- |
| `limit` | `50` | Page size, 1 to 200. |
| `offset` | `0` | Files to skip. |

The response `data` has `files` (each with `file_id`, `filename`, `mime_type`, `size_bytes`, `url`, `created_at`), `has_more`, `offset` and `limit`.

Answers `501` when the media store cannot enumerate its files. Files with no recorded owner are not listed.

---

## GET /v1/files/{file_id}

Returns the raw bytes of a stored file with its recorded `Content-Type`. Types that could run script in a browser (HTML, XML, SVG, JavaScript) are served as `application/octet-stream` downloads with `Content-Disposition: attachment`.

**Inline types** (served with `Content-Disposition: inline`): `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/avif`, `image/bmp`, `application/pdf`, `text/plain`, and any `audio/*` or `video/*` type. Other types are sent as attachments.

**Example:**

```bash
curl http://127.0.0.1:8000/v1/files/f_abc123 --output photo.jpg
```

**Errors:** `404` if the file does not exist or is outside the caller's reach.

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

**Errors:** `404` if the file does not exist or is outside the caller's reach.

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

**Errors:** `404` if the file does not exist or is outside the caller's reach.

---

## Using a file_id in a message

Reference an uploaded file in a message with `{"type": "image", "media": {"kind": "file_id", "file_id": "...", "mime_type": "..."}}`; see [Files and multimodal](/docs/server/files-and-multimodal).

---

## Error responses

Uploads fail with `400`, `403`, `413`, `415` or `422`; reads fail with `404`. A missing permission returns the standard authorization error (see [Authentication](/docs/server/auth)).

| Status | Description |
| --- | --- |
| `400` | Missing filename or empty file. |
| `403` | The authenticated user has no tenant value for files (checkpointer declares tenant columns). |
| `422` | The multipart body has no `file` part, or more than one. Auth is checked before the body is parsed, so an unauthenticated request never gets this far. |
| `422` | With `DOCUMENT_HANDLING=extract_text` (the default), the server lacks the `media` extra. The message names it (`pip install "10xgraph-api[media]"`) and says to set `DOCUMENT_HANDLING` to `pass_raw` or `skip` instead. |
| `413` | File exceeds `MEDIA_MAX_SIZE_MB` (or the media service rejects its size). The same status answers an image over `MEDIA_MAX_IMAGE_PIXELS`, a PDF over `MEDIA_MAX_PDF_MB` or `MEDIA_MAX_PDF_PAGES`, and an upload past the per-user quota (`MEDIA_MAX_FILES_PER_USER`, `MEDIA_MAX_USER_STORAGE_MB`). |
| `415` | Content type not allowed by `MEDIA_ALLOWED_CONTENT_TYPES`. |
| `404` | `file_id` not found or outside the caller's reach. |
| `501` | `GET /v1/files` on a media store that cannot list its files. |

---

## DELETE /v1/files/{file_id}

Deletes a stored file and its metadata. The uploader, or a caller whose reach (`tenant` or `all`) covers the file, can delete it.

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

**Errors:** `404` if the file does not exist or is outside the caller's reach.

---

## Permissions

`MEDIA_REQUIRE_OWNER=true` (default on in production) also denies files that have no recorded owner. See [Environment variables](/docs/reference/api-cli/environment).
