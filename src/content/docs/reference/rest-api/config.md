---
title: Configuration endpoints
description: "Reference for the 10xGraph REST config endpoint GET /v1/config/multimodal: permission, response fields, defaults, errors and a curl example."
section: Reference
group: "REST API"
order: 370
label: Config
updated: "2026-11-25"
---

`GET /v1/config/multimodal` returns the server's media settings. It needs the `config:read` permission.

## Get the multimodal configuration

```bash
# Read the media configuration (replace $TOKEN with a valid bearer token)
curl http://127.0.0.1:8000/v1/config/multimodal \
  -H "Authorization: Bearer $TOKEN"
```

```json
{
  "data": {
    "media_storage_type": "local",
    "media_max_size_mb": 25.0,
    "document_handling": "extract_text"
  },
  "metadata": {
    "request_id": "<request id>",
    "timestamp": "<timestamp>",
    "message": "OK"
  }
}
```

## Response fields

Each field in `data` maps to one environment variable on the server. The defaults apply when the variable is unset.

| Field | Type | Env var | Default | Description |
| --- | --- | --- | --- | --- |
| `media_storage_type` | string | `MEDIA_STORAGE_TYPE` | `local` | Where uploaded files are stored: `memory` (in process, lost on restart), `local` (filesystem, path set by `MEDIA_STORAGE_PATH`) or `cloud` (configured with the `MEDIA_CLOUD_*` variables). |
| `media_max_size_mb` | number | `MEDIA_MAX_SIZE_MB` | `25.0` | Maximum upload size in megabytes. Larger uploads are rejected with `413`. |
| `document_handling` | string | `DOCUMENT_HANDLING` | `extract_text` | How uploaded documents are handled. One of `extract_text`, `pass_raw`, `skip`; returned as set, not validated. |

## Related

- [File upload endpoints](/docs/reference/rest-api/files): upload files and fetch them by ID
- [Files and multimodal on the server](/docs/server/files-and-multimodal): storage backends, size limits and signed URLs
- [Environment variables](/docs/reference/api-cli/environment): every server setting
