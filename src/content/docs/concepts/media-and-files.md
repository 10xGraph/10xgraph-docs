---
title: Media and Files
seoTitle: "Multimodal messages: media and files"
description: "How 10xGraph handles media in multimodal messages: MediaRef decouples location from structure, storage backends serve files, and providers adapt automatically."
section: Concepts
order: 210
group: "Platform"
label: Media and Files
updated: "2026-11-25"
faq:
  - q: "What's the difference between file_id, url, and data?"
    a: "file_id stores media in a backend store and references it by key (best for production); url points to external media the provider fetches; data embeds bytes inline as base64 (only for small payloads)."
  - q: "Do I need to upload files myself?"
    a: "No. For Python, you can inline data or use external URLs directly. For the API server, use /v1/files/upload; the server manages the store. For the TypeScript client, use uploadFile()."
  - q: "Which approach is best for my use case?"
    a: "Inline data (base64) for small, one-off payloads. External URLs if the media is already hosted. file_id for multi-step flows or production systems where durability matters."
---

10xGraph has built-in multimodal support for messages containing text, images, audio, video, and documents. The design separates message structure from data location through **MediaRef**, allowing the same message to reference media from URLs, inline base64, or cloud storage without changing the block types. This page explains the architecture; task guides for sending media are in `/docs/guides/send-media` and `/docs/client/files-and-multimodal`.

## Why separate location from structure

Messages in 10xGraph are lightweight: a message does not hold binary data directly. Instead, blocks (ImageBlock, AudioBlock, DocumentBlock) reference media via `MediaRef`, which specifies where the bytes actually live. Messages stay small, and the same message shape works from Python, the REST API and the TypeScript client.

## Content block types

All block types live in `tenxgraph.core.state`. Multimodal blocks (Image, Audio, Video, Document, Data) all carry a `MediaRef` that points to the actual media.

| Class | Role |
|---|---|
| `TextBlock` | Plain text content |
| `ImageBlock` | Images referenced by MediaRef (PNG, JPEG, WebP, GIF) |
| `AudioBlock` | Audio referenced by MediaRef (WAV, MP3, OGG) |
| `VideoBlock` | Video referenced by MediaRef (MP4, WebM) |
| `DocumentBlock` | Documents referenced by MediaRef, with optional extracted text (PDFs, Word, plain text) |
| `DataBlock` | Any binary blob with a MIME type |

Other block types are listed in [State and messages](/docs/concepts/state-and-messages).

## MediaRef, how to reference media

`MediaRef` tells a block where to fetch the binary data. It has three `kind` values, each with different trade-offs:

```python
from tenxgraph.core.state import MediaRef

# 1. URL: external hosted media; provider fetches it
MediaRef(kind="url", url="https://example.com/photo.png", mime_type="image/png")

# 2. Inline base64: bytes embedded in the message (small payloads only)
MediaRef(kind="data", data_base64="iVBORw0KGg...", mime_type="image/png")

# 3. Store key: media uploaded to a MediaStore first, referenced by opaque key
MediaRef(kind="file_id", file_id="a1b2c3d4e5f6...", mime_type="image/png")
```

Besides `kind`, `url`, `file_id`, `data_base64` and `mime_type`, a `MediaRef` carries optional `size_bytes`, `sha256`, `filename`, `width`, `height`, `duration_ms` and `page`.

### When to use each kind

**kind="url"** is best when media is already hosted (CDN, public web link, or a signed URL from cloud storage). The provider fetches it over HTTPS. No upload step needed, but network access from the provider is required.

**kind="data"** is simplest for small files (icons, small images, short audio clips) but the bytes go over the wire with every message. Avoid for large media or when the same file is sent multiple times.

**kind="file_id"** is production best practice: upload once, reference forever. The file lives in a backend store (in-memory for tests, local filesystem or cloud storage for real systems). Ideal for multi-step flows or when the same document is analyzed by multiple agents.

## MediaStore, persistent storage backends

A `MediaStore` holds media bytes outside the message system. Each backend implements `BaseMediaStore` (`store`, `retrieve`, `delete`, `exists`, `get_metadata`, `update_metadata`).

`update_metadata` shallow-merges `updates` into the stored metadata (a value of `None` removes the key) and returns `False` when the object does not exist. The three built-in stores implement it. A custom store that does not override it raises `NotImplementedError`, and the API server then does not track which threads use a file.

### Available implementations

| Class | Location | Best for |
|---|---|---|
| `InMemoryMediaStore` | `tenxgraph.storage.media` | Tests, development, single-process |
| `LocalFileMediaStore` | `tenxgraph.storage.media` | Development, single-server deployments |
| `CloudMediaStore` | `tenxgraph.storage.media` | Production with S3 / GCS |

**LocalFileMediaStore** shards files on disk under a base directory. Each file is stored as `{base_dir}/{key[:2]}/{key[2:4]}/{key}{ext}` with a `.meta.json` sidecar. The default `base_dir` is `./agentflow_media`. Suitable for single-server deployments or development environments with persistent storage.

On POSIX systems, `LocalFileMediaStore` creates its directories with mode `0o700` and its data and sidecar files with `0o600`. The sidecar holds the owner id and the original filename. Existing files keep their mode, and a stricter process umask wins. Other OS users or services that read these files, such as a web server serving uploads, lose access.

**CloudMediaStore** offloads to S3 or GCS via the cloud-storage-manager SDK. Requires the `cloud-storage` extra (`pip install "10xgraph[cloud-storage]"`). Generates signed URLs so providers can fetch media directly without re-downloading to your server.

## MultimodalConfig, opting an agent into media

An `Agent` only keeps media blocks (images, audio, video, documents) in its prompt when it has a `multimodal_config`. An agent without one strips them before calling the model, so a text-only agent downstream of a multimodal one never sees them.

```python
from tenxgraph.core.graph import Agent
from tenxgraph.storage.media import MultimodalConfig

agent = Agent(
    model="gemini-2.5-flash",
    provider="google",
    multimodal_config=MultimodalConfig(),
)
```

`MultimodalConfig` is a Pydantic model with these fields and defaults: `max_image_size_mb` (10.0), `max_image_dimension` (2048), `max_image_pixels` (50,000,000) and `supported_image_types` (JPEG, PNG, WebP, GIF). `image_handling`, `document_handling` and `supported_doc_types` are deprecated: nothing reads them, setting one to a non-default value emits a `DeprecationWarning`, and they are removed in 2.0. In the core agent path, the presence of the config is what enables media; transport is chosen by the capability matrix below.

## Provider capability matrix and fallback

10xGraph maintains an internal capability matrix (`tenxgraph.storage.media.capabilities`) that maps each provider and model to what it supports. When your agent sends media, the system tries transports from a per-model list (the order varies by model). The possible modes are:

1. **remote_url**: Send a public or signed HTTPS URL directly.
2. **provider_file**: Use the provider's native file upload API (e.g., Google Files API, OpenAI file search).
3. **inline_bytes**: Embed as base64 data URI.
4. **unsupported**: The provider does not support this media type.

The capability matrix lists a transport order per provider, model and media type, and the resolver tries each in turn, moving to the next when one fails.

## Which URLs the server downloads

A `kind="url"` reference is untrusted when a client sends it. OpenAI and Anthropic fetch the URL themselves, so the server only passes it on. On the Google GenAI path, the Google File API path and the inline-bytes transport, the server downloads it first, under a `MediaFetchPolicy`.

The default policy allows `http` and `https` to public hosts, accepts `image/*` and `application/pdf` responses, and caps a download at 20 MiB and 10 seconds. Cloud metadata addresses, private addresses (unless you opt in for listed hosts), unchecked redirects and other schemes are always refused. Set your own policy with `StateGraph.compile(media_policy=...)`.

A `gs://` URL is a special case. On Vertex AI it is read with the server's credentials, so the API rejects a client `gs://` URL unless its bucket is in `allowed_gcs_buckets`. The field list and a code example are in [Sending media from Python](/docs/guides/send-media#control-which-urls-the-server-downloads). The API server applies the policy before the run starts, as described in [Files and multimodal on the server](/docs/server/files-and-multimodal#external-media-urls).

## Related pages

- [Sending media from Python](/docs/guides/send-media): task guide with code examples for all reference types.
- [REST API files endpoint](/docs/server/files-and-multimodal): how the API server manages file upload and media serving.
- [TypeScript client files](/docs/client/files-and-multimodal): using the client SDK for multimodal requests.
- [State and messages](/docs/concepts/state-and-messages): the full message structure and block types.
