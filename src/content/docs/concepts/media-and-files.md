---
title: Media and Files
seoTitle: "Multimodal messages: media and files"
description: "How 10xGraph handles media in multimodal messages: MediaRef decouples location from structure, storage backends serve files, and providers adapt automatically."
section: Concepts
order: 200
group: "Serving"
label: Media and Files
updated: "2026-10-26"
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

Messages in 10xGraph are lightweight: a message does not hold binary data directly. Instead, blocks (ImageBlock, AudioBlock, DocumentBlock) reference media via `MediaRef`, which specifies where the bytes actually live. This design buys three things: messages stay small and copy fast over the network, media can be deduplicated across runs on the same backend store, and different contexts (Python, REST API, TypeScript) handle media differently without changing your message structure.

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
| `ToolCallBlock` | Tool invocation request from the model |
| `ToolResultBlock` | Result returned from a tool execution |
| `ReasoningBlock` | Chain-of-thought reasoning traces |
| `AnnotationBlock` | Citations and structured references |
| `ErrorBlock` | Error information from failed operations |

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

### Full MediaRef fields

```python
class MediaRef(BaseModel):
    kind: Literal["url", "file_id", "data"] = "url"
    url: str | None = None              # http(s), data: URL, or graph://media/<key>
    file_id: str | None = None          # storage key from MediaStore.store(), or a provider file ID
    data_base64: str | None = None      # small payloads only
    mime_type: str | None = None
    size_bytes: int | None = None       # optional size hint
    sha256: str | None = None           # optional checksum
    filename: str | None = None         # original filename if applicable
    # Media-specific metadata
    width: int | None = None            # image width
    height: int | None = None           # image height
    duration_ms: int | None = None      # audio/video duration
    page: int | None = None             # document page number
```

### When to use each kind

**kind="url"** is best when media is already hosted (CDN, public web link, or a signed URL from cloud storage). The provider fetches it over HTTPS. No upload step needed, but network access from the provider is required.

**kind="data"** is simplest for small files (icons, small images, short audio clips) but the bytes go over the wire with every message. Avoid for large media or when the same file is sent multiple times.

**kind="file_id"** is production best practice: upload once, reference forever. The file lives in a backend store (in-memory for tests, local filesystem or cloud storage for real systems). Ideal for multi-step flows or when the same document is analyzed by multiple agents.

## MediaStore, persistent storage backends

A `MediaStore` holds media bytes outside the message system. Each backend is a class implementing `BaseMediaStore`:

```python
class BaseMediaStore(ABC):
    async def store(data: bytes, mime_type: str, metadata: dict | None) -> str
    async def retrieve(storage_key: str) -> tuple[bytes, str]
    async def delete(storage_key: str) -> bool
    async def exists(storage_key: str) -> bool
    async def get_metadata(storage_key: str) -> dict | None
    async def update_metadata(storage_key: str, updates: dict) -> bool
```

`update_metadata` shallow-merges `updates` into the stored metadata (a value of `None` removes the key) and returns `False` when the object does not exist. The three built-in stores implement it. A custom store that does not override it raises `NotImplementedError`, and the API server then does not track which threads use a file.

All methods are async; they are safe to call from agent nodes and tools via normal `await`.

### Available implementations

| Class | Location | Best for |
|---|---|---|
| `InMemoryMediaStore` | `tenxgraph.storage.media` | Tests, development, single-process |
| `LocalFileMediaStore` | `tenxgraph.storage.media` | Development, single-server deployments |
| `CloudMediaStore` | `tenxgraph.storage.media` | Production with S3 / GCS |

**InMemoryMediaStore** stores files in RAM. Data is lost on process restart and is not shared across workers. Use it for testing and local development.

**LocalFileMediaStore** shards files on disk under a base directory. Each file is stored as `{base_dir}/{key[:2]}/{key[2:4]}/{key}{ext}` with a `.meta.json` sidecar. The default `base_dir` is `./agentflow_media`. Suitable for single-server deployments or development environments with persistent storage.

On POSIX systems, `LocalFileMediaStore` creates its directories with mode `0o700` and its data and sidecar files with `0o600`. The sidecar holds the owner id and the original filename. Existing files keep their mode, and a stricter process umask wins. Other OS users or services that read these files, such as a web server serving uploads, lose access.

**CloudMediaStore** offloads to S3 or GCS via the cloud-storage-manager SDK. Requires the `cloud-storage` extra (`pip install "10xgraph[cloud-storage]"`). Generates signed URLs so providers can fetch media directly without re-downloading to your server. The right choice for distributed systems and production deployments.

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

`MultimodalConfig` is a Pydantic model with these fields and defaults: `image_handling` (`ImageHandling.BASE64`), `document_handling` (`DocumentHandling.EXTRACT_TEXT`), `max_image_size_mb` (10.0), `max_image_dimension` (2048), `supported_image_types` (JPEG, PNG, WebP, GIF) and `supported_doc_types` (PDF, DOCX). The enums are `ImageHandling` (`BASE64`, `URL`, `FILE_ID`) and `DocumentHandling` (`EXTRACT_TEXT`, `FORWARD_RAW`, `SKIP`). In the core agent path, the presence of the config is what enables media; transport is chosen by the capability matrix below.

## Provider capability matrix and fallback

10xGraph maintains an internal capability matrix (`tenxgraph.storage.media.capabilities`) that maps each provider and model to what it supports. When your agent sends media, the system tries transports from a per-model list (the order varies by model). The possible modes are:

1. **remote_url**: Send a public or signed HTTPS URL directly.
2. **provider_file**: Use the provider's native file upload API (e.g., Google Files API, OpenAI file search).
3. **inline_bytes**: Embed as base64 data URI.
4. **unsupported**: The provider does not support this media type.

You do not manually manage this chain. The capability matrix lists a transport order per provider, model and media type, and the resolver tries each in turn, moving to the next when one fails.

## Which URLs the server downloads

A `kind="url"` reference is untrusted when a client sends it. OpenAI and Anthropic fetch the URL themselves, so the server only passes it on. On the Google GenAI path, the Google File API path and the inline-bytes transport, the server downloads it first, under a `MediaFetchPolicy`.

The default policy allows `http` and `https` to public hosts, accepts `image/*` and `application/pdf` responses, and caps a download at 20 MiB and 10 seconds. Cloud metadata addresses, private addresses (unless you opt in for listed hosts), unchecked redirects and other schemes are always refused. Set your own policy with `StateGraph.compile(media_policy=...)`.

A `gs://` URL is a special case. On Vertex AI it is read with the server's credentials, so the API rejects a client `gs://` URL unless its bucket is in `allowed_gcs_buckets`. The field list and a code example are in [Sending media from Python](/docs/guides/send-media#control-which-urls-the-server-downloads). The API server applies the policy before the run starts, as described in [Files and multimodal on the server](/docs/server/files-and-multimodal#external-media-urls).

## Trade-offs and design decisions

**Inline (base64) vs. URL vs. file_id:**
- Inline is easiest to reason about (everything is in the message) but wastes bandwidth and memory for large or repeated files.
- URL is fast if media is already hosted and the provider has network access, but introduces an external dependency.
- file_id decouples the message from storage and enables deduplication, but requires infrastructure (a MediaStore backend).

**Per-agent opt-in:**
`multimodal_config` is per-agent, so a vision agent can receive media while a text-only agent in the same graph has it stripped.

**Messages stay lightweight:**
By never storing raw bytes in messages, 10xGraph keeps state snapshots small, thread history fast to retrieve, and checkpoints cheap to store. Media bytes live in specialized stores where they belong.

## Related pages

- [Sending media from Python](/docs/guides/send-media): task guide with code examples for all reference types.
- [REST API files endpoint](/docs/server/files-and-multimodal): how the API server manages file upload and media serving.
- [TypeScript client files](/docs/client/files-and-multimodal): using the client SDK for multimodal requests.
- [State and messages](/docs/concepts/state-and-messages): the full message structure and block types.
