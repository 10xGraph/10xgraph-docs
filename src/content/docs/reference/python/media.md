---
title: Media
seoTitle: "Media API reference (Python)"
description: "Handle images, audio, video, and documents in agent messages. Offload large blobs, validate content, process images, cache uploads."
section: Reference
group: "Python library"
order: 230
label: Media
updated: "2026-10-08"
faq:
  - q: "When should I offload media to a store?"
    a: "Use MediaOffloadPolicy.THRESHOLD (the default of ensure_media_offloaded) when messages may contain base64 blobs larger than 50,000 bytes. It replaces them with small references so messages and checkpoints stay lean."
  - q: "Does the framework validate MIME types?"
    a: "MediaProcessor.validate_image checks an image against the allowed MIME types and size limit in MultimodalConfig. It trusts the declared type, so use validate_magic_bytes to check that file content matches the claimed type."
  - q: "How do I avoid re-uploading the same image to Google?"
    a: "Pass a ProviderMediaCache to upload_to_google_file_api. The cache keys references by the SHA-256 hash of the file bytes, so identical content is uploaded once."
---

The `tenxgraph.storage.media` module handles images, audio, video, and documents in messages. It offloads large base64 blobs to a media store as `graph://media/{key}` references, validates and processes images with Pillow, caches provider file uploads, and checks uploads for safety. See [Send media to a model](/docs/guides/send-media) for a walkthrough.

## Import paths

Almost everything is exported from `tenxgraph.storage.media`. `upload_to_google_file_api` is not re-exported there and is imported from `tenxgraph.storage.media.provider_media`.

```python
from tenxgraph.storage.media import (
    # Offloading and storage
    MediaOffloadPolicy, ensure_media_offloaded, BaseMediaStore,
    InMemoryMediaStore, LocalFileMediaStore, CloudMediaStore,
    # Image processing (requires Pillow)
    MediaProcessor,
    # Provider helpers
    ProviderMediaCache, should_use_google_file_api, GOOGLE_INLINE_THRESHOLD,
    create_openai_file_attachment, create_openai_file_search_tool,
    # Resolving references
    MediaRefResolver,
    # Configuration
    MultimodalConfig, ImageHandling, DocumentHandling,
    # Security
    validate_magic_bytes, sanitize_filename, enforce_file_size,
)
from tenxgraph.storage.media.provider_media import upload_to_google_file_api
```

---

## `MediaOffloadPolicy`

A string enum that controls when inline base64 data is offloaded to a `BaseMediaStore`.

```python
from tenxgraph.storage.media import MediaOffloadPolicy

policy = MediaOffloadPolicy.THRESHOLD  # Default
```

| Value | Description |
|---|---|
| `NEVER` | Never offload. All `data_base64` content stays inline. Use for unit tests. |
| `THRESHOLD` | Offload only when decoded blob exceeds `max_inline_bytes`. Default and recommended for production. |
| `ALWAYS` | Always offload every inline `data_base64` blob, regardless of size. |

---

## `ensure_media_offloaded`

```python
async def ensure_media_offloaded(message, store, policy=MediaOffloadPolicy.THRESHOLD, max_inline_bytes=50_000) -> Message
```

```python
message = await ensure_media_offloaded(
    message=my_message,
    store=media_store,
    policy=MediaOffloadPolicy.THRESHOLD,
    max_inline_bytes=50_000,
)
```

Inspects `ImageBlock`, `AudioBlock`, `VideoBlock`, and `DocumentBlock` entries in a message. For any block with `media.kind == "data"` and `media.data_base64`, this function decodes the base64, uploads it to the store, and replaces the block's media with a `graph://media/{key}` reference that keeps `filename`, `width`, `height`, `duration_ms` and sets `size_bytes`. The decoded size is estimated from the base64 length. The message is mutated in place and also returned. With `NEVER` it returns immediately.

**Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `message` | `Message` | required | Message to inspect and modify. |
| `store` | `BaseMediaStore` | required | Store to upload offloaded blobs. |
| `policy` | `MediaOffloadPolicy` | `THRESHOLD` | When to offload. |
| `max_inline_bytes` | `int` | `50_000` | Decoded size threshold for `THRESHOLD` policy. |

**Returns:** The (possibly mutated) `Message`.

**Example:**

```python title="offload_example.py"
import asyncio
import base64

from tenxgraph.core.state import ImageBlock, MediaRef, Message, TextBlock
from tenxgraph.storage.media import LocalFileMediaStore, MediaOffloadPolicy, ensure_media_offloaded

store = LocalFileMediaStore(base_dir="./media")

# Create a message with inline image data
with open("photo.jpg", "rb") as f:
    b64_data = base64.b64encode(f.read()).decode()

msg = Message(
    role="user",
    content=[
        TextBlock(text="Describe this image"),
        ImageBlock(media=MediaRef(kind="data", data_base64=b64_data, mime_type="image/jpeg")),
    ],
)

# Offload the image if it is large
async def main() -> None:
    offloaded = await ensure_media_offloaded(msg, store, policy=MediaOffloadPolicy.THRESHOLD)
    # For a large image, offloaded.content[1].media is now a graph://media/{key} reference
    print(offloaded.content[1].media.kind, offloaded.content[1].media.url)


asyncio.run(main())
```

---

## `BaseMediaStore`

Abstract interface for media storage backends. Subclasses must implement four async methods. `get_metadata`, `get_direct_url` and `to_media_ref` have default implementations.

| Method | Abstract | Description |
|---|---|---|
| `store(data, mime_type, metadata=None) -> str` | yes | Store bytes and return an opaque storage key. |
| `retrieve(storage_key) -> tuple[bytes, str]` | yes | Return bytes and MIME type. Raises `KeyError` if missing. |
| `delete(storage_key) -> bool` | yes | Returns `True` if deleted. |
| `exists(storage_key) -> bool` | yes | Whether the key exists. |
| `get_metadata(storage_key) -> dict \| None` | no | Returns `mime_type` and `size_bytes`; the default reads the blob. |
| `get_direct_url(storage_key, mime_type=None, expiration=3600) -> str \| None` | no | Signed URL if the store supports it; default returns `None`. `CloudMediaStore` takes the file extension from the stored metadata and ignores the caller's `mime_type`. Its signed-URL downloads use a 10 s connect and 60 s idle timeout. |
| `modify_metadata(storage_key, fn) -> bool` | no | Reads the metadata, applies `fn` (a plain function that returns the `update_metadata` updates, or `None`) and writes the result as one step. Use it when the new value depends on the old one, such as appending a thread link. Atomic on the local and in-memory stores (the local store also holds a `flock` on `{base_dir}/.meta.lock`, POSIX only). The cloud store re-reads right before the upload and retries up to 5 times, which leaves a small window. The default is `get_metadata` plus `update_metadata` and is not atomic. Returns `False` when the key does not exist. |
| `list_keys_for_owner(owner_id) -> list[str]` | no | Keys whose metadata records `owner_id` as owner. The default filters `list_keys`. `CloudMediaStore` overrides it with a per-owner index object, so it works on S3 and GCS; files stored before 1.0 or with no owner are not in the index. |
| `to_media_ref(storage_key, mime_type, **kwargs) -> MediaRef` | no | Builds a `MediaRef` with a `graph://media/{key}` URL. |

```python
from tenxgraph.storage.media import BaseMediaStore, LocalFileMediaStore, InMemoryMediaStore, CloudMediaStore
```

### Implementations

| Class | Backend | Use case |
|---|---|---|
| `InMemoryMediaStore` | Process memory | Development and tests; data lost on restart. |
| `LocalFileMediaStore` | Local filesystem | Single-server setups. `LocalFileMediaStore(base_dir="./agentflow_media")` is the default directory. |
| `CloudMediaStore` | Cloud object storage via `cloud-storage-manager` | Production. `CloudMediaStore(storage, prefix="10xgraph-media")` takes a `BaseCloudStorage` instance; requires the `cloud-storage` extra. |

All three are re-exported from `tenxgraph.storage.media`.

### Wiring into a graph

```python
from tenxgraph.storage.media import LocalFileMediaStore

media_store = LocalFileMediaStore(base_dir="./media_uploads")

app = graph.compile(
    checkpointer=my_checkpointer,
    media_store=media_store,
)
```

`compile(media_store=...)` registers the store in the graph's dependency container as `BaseMediaStore`, so nodes and the API server can retrieve it. Offloading itself is done by calling `ensure_media_offloaded()` (shown above) on the messages you want to slim down. Once a message holds a `graph://media/{key}` reference, the checkpointer stores that small reference instead of the binary blob.

---

## `MediaProcessor`

Validates and optionally resizes images before they enter the pipeline. Requires Pillow (`pip install "10xgraph[images]"`) for resizing, orientation, thumbnails and format conversion; validation works without it.

```python
from tenxgraph.storage.media import MediaProcessor, MultimodalConfig
from tenxgraph.core.state import ImageBlock

config = MultimodalConfig(
    max_image_size_mb=10.0,
    max_image_dimension=2048,
    supported_image_types={"image/jpeg", "image/png", "image/webp", "image/gif"},
)
processor = MediaProcessor(config=config)
```

**Constructor:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `config` | `MultimodalConfig \| None` | `None` | Configuration for size, dimension, and type limits. Defaults to `MultimodalConfig()`. |

**Methods:**

### `validate_image(block: ImageBlock) -> None`

Validate an `ImageBlock` against the allowed MIME types (a missing MIME type is treated as `image/png`) and the size limit, using `size_bytes` when set and the approximate decoded size for inline data. Raises `ValueError` if validation fails.

```python
try:
    processor.validate_image(block)
except ValueError as e:
    print(f"Invalid image: {e}")
```

### `resize_image(block: ImageBlock) -> ImageBlock`

Resize an inline base64 image if either dimension exceeds `max_image_dimension`. Returns the original block unchanged if Pillow is unavailable, the image is a URL/file_id reference, or dimensions are within limits. Requires Pillow.

```python
resized_block = processor.resize_image(block)
```

### `process(block: ImageBlock) -> ImageBlock`

Validate and resize in one call. Convenience method equivalent to `validate_image()` then `resize_image()`.

```python
block = processor.process(block)
```

### `fix_orientation(block: ImageBlock) -> ImageBlock`

Apply EXIF orientation to an inline image (common with phone camera uploads). Reads the EXIF Orientation tag and transposes the pixel data, then strips the tag. Only JPEG and TIFF images are checked. Returns the original block if Pillow is unavailable, the image is not inline, or there is no EXIF rotation. Requires Pillow.

```python
block = processor.fix_orientation(block)
```

### `full_process(block: ImageBlock) -> ImageBlock`

Full pipeline: validate, fix EXIF orientation, then resize. Use this when incoming images may have rotation metadata.

```python
block = processor.full_process(block)
```

### `generate_thumbnail(block: ImageBlock, max_dim: int = 256) -> ImageBlock`

Create a JPEG thumbnail (quality 80) of an inline image. Returns the original block if Pillow is unavailable, the image is a URL/file_id reference, or both sides are already within `max_dim`.

```python
thumb = processor.generate_thumbnail(block, max_dim=128)
```

### `optimize_image(block: ImageBlock, target_format: str = "JPEG", quality: int = 85) -> ImageBlock`

Convert and compress an inline image to a target format. Useful for normalising uploads to a single format. `target_format` is a Pillow format name such as `"JPEG"`, `"PNG"` or `"WEBP"`; `quality` (1-100) affects lossy formats. Returns the original block if Pillow is unavailable.

```python
optimized = processor.optimize_image(block, target_format="WEBP", quality=80)
```

---

## `ProviderMediaCache`

Content-addressed cache mapping file hashes to provider file references. Prevents re-uploading identical binary content to Google, OpenAI, or other providers. Reads are safe from multiple threads; writes use a plain in-memory dict and are not synchronized.

```python
from tenxgraph.storage.media import ProviderMediaCache

cache = ProviderMediaCache(max_entries=1000)
key = ProviderMediaCache.content_key(b"example bytes")
cache.put("google", key, "files/abc123")  # any reference object
print(cache.get("google", key))  # files/abc123
```

**Constructor:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `max_entries` | `int` | `1000` | Maximum entries per provider before simple eviction. |

**Methods:**

### `content_key(data: bytes) -> str` (static)

Compute a content-addressed key using SHA-256 hex digest.

```python
key = ProviderMediaCache.content_key(file_bytes)
```

### `get(provider: str, key: str) -> Any | None`

Look up a cached provider file reference. Returns `None` if not found.

```python
ref = cache.get("google", key)
```

### `put(provider: str, key: str, reference: Any) -> None`

Store a provider file reference. If the provider bucket holds `max_entries`, the oldest entry is evicted first.

```python
cache.put("google", key, upload_result)
```

### `clear(provider: str | None = None) -> None`

Clear cached references for a specific provider (or all if `provider=None`).

```python
cache.clear("google")  # Clear Google cache
cache.clear()  # Clear all
```

---

## `upload_to_google_file_api`

Upload a file to Google's File API and return a `types.Part` reference built from the uploaded file URI. If `cache` already holds the content, returns the cached reference without uploading. Requires the `google-genai` extra. All arguments after `mime_type` are keyword-only.

```python title="google_upload.py"
import asyncio

from tenxgraph.storage.media import ProviderMediaCache
from tenxgraph.storage.media.provider_media import upload_to_google_file_api

cache = ProviderMediaCache()


async def main() -> None:
    with open("photo.jpg", "rb") as f:
        file_bytes = f.read()
    # Requires Google credentials in the environment for google.genai.Client()
    part = await upload_to_google_file_api(
        file_bytes,
        "image/jpeg",
        display_name="photo.jpg",
        cache=cache,
    )
    # part is a google.genai.types.Part referencing the uploaded file
    print(part)


asyncio.run(main())
```

**Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `data` | `bytes` | required | Raw file bytes. |
| `mime_type` | `str` | required | MIME type of the file. |
| `display_name` | `str \| None` | `None` | Display name for the upload. `"upload"` is used when omitted. |
| `cache` | `ProviderMediaCache \| None` | `None` | Optional cache to avoid re-uploading the same content. |
| `client` | `Any \| None` | `None` | Optional `google.genai.Client` instance; a default is created if omitted. |

**Returns:** A `google.genai.types.Part` referencing the uploaded file.

---

## `should_use_google_file_api`

Check whether a file size exceeds `GOOGLE_INLINE_THRESHOLD` (20 MB, exported from the same module). Returns `True` if the file should be uploaded via the File API instead of sent inline.

```python
from tenxgraph.storage.media import should_use_google_file_api

print(should_use_google_file_api(25 * 1024 * 1024))  # True
print(should_use_google_file_api(1024))  # False
```

**Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `data_size` | `int` | required | File size in bytes. |

**Returns:** `True` if size is greater than 20 MB (20 * 1024 * 1024 bytes), `False` otherwise.

---

## OpenAI file helpers

Build request fragments for OpenAI's Files API and file_search tool.

### `create_openai_file_search_tool`

Create a `file_search` tool dict for OpenAI.

```python
from tenxgraph.storage.media import create_openai_file_search_tool

tool = create_openai_file_search_tool(["file-abc123", "file-xyz789"])
print(tool)
# {"type": "file_search", "file_search": {"vector_store_ids": []}}
```

**Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `file_ids` | `list[str]` | required | OpenAI file IDs (from `client.files.create()`). |

**Returns:** A tool dict for OpenAI's `tools` parameter. The current implementation does not use `file_ids`: it always returns an empty `vector_store_ids` list.

### `create_openai_file_attachment`

Create a message attachment referencing an uploaded OpenAI file.

```python
from tenxgraph.storage.media import create_openai_file_attachment

attachment = create_openai_file_attachment("file-abc123", tools=["file_search"])
print(attachment)
# {"file_id": "file-abc123", "tools": [{"type": "file_search"}]}
```

**Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `file_id` | `str` | required | The OpenAI file ID. |
| `tools` | `list[str] \| None` | `["file_search"]` | Tools to associate with this file. |

**Returns:** An attachment dict for OpenAI's `attachments` parameter.

---

## `MultimodalConfig`

Per-agent configuration for how media is validated and delivered to the provider.

```python
from tenxgraph.core.graph import Agent
from tenxgraph.storage.media import DocumentHandling, ImageHandling, MultimodalConfig

config = MultimodalConfig(
    image_handling=ImageHandling.BASE64,
    document_handling=DocumentHandling.EXTRACT_TEXT,
    max_image_dimension=2048,
    max_image_size_mb=10.0,
)
agent = Agent(model="gpt-4o", multimodal_config=config)
```

| Field | Type | Default | Description |
|---|---|---|---|
| `image_handling` | `ImageHandling` | `BASE64` | How images are sent to the provider (`BASE64`, `URL`, `FILE_ID`). |
| `document_handling` | `DocumentHandling` | `EXTRACT_TEXT` | How documents are processed (`EXTRACT_TEXT`, `FORWARD_RAW`, `SKIP`). |
| `max_image_size_mb` | `float` | `10.0` | Maximum accepted image size in megabytes. |
| `max_image_dimension` | `int` | `2048` | Images are resized when either dimension exceeds this. |
| `supported_image_types` | `set[str]` | `{"image/jpeg", "image/png", "image/webp", "image/gif"}` | Allowed image MIME types. |
| `supported_doc_types` | `set[str]` | `{"application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}` | Allowed document MIME types. |

Offload behavior is not configured here. It is driven by `MediaOffloadPolicy` and the `media_store` passed to `graph.compile()`.

---

## `MediaRefResolver`

Resolves `MediaRef` objects into concrete content parts that providers expect. Fetches `graph://media/{key}` references from the media store and can generate signed direct URLs instead of re-uploading bytes on every turn.

```python
from tenxgraph.storage.media import MediaRefResolver

resolver = MediaRefResolver(media_store=media_store)

# Optional: cache signed URLs in a shared backend (any cache object you provide)
resolver = resolver.with_cache(
    cache_backend=my_cache,
    expiration_seconds=3600,
    refresh_buffer_seconds=60,
)

part = await resolver.resolve_for_openai(media_ref, model="gpt-4o")
```

**Constructor:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `media_store` | `BaseMediaStore \| None` | `None` | Store to resolve `graph://media/{key}` references. Required for internal references. |
| `cache_backend` | `Any \| None` | `None` | Optional cache (e.g., Redis) for generated signed URLs. |
| `direct_url_expiration_seconds` | `int` | `3600` | Lifetime of a generated signed URL in seconds. |
| `direct_url_refresh_buffer_seconds` | `int` | `60` | Regenerate a cached URL this many seconds before it expires. |

**Methods:**

### `with_cache(cache_backend: Any, expiration_seconds: int = 3600, refresh_buffer_seconds: int = 60) -> MediaRefResolver`

Attach or update a shared cache backend for signed URLs. Mutates the resolver and returns `self` for chaining.

```python
resolver = resolver.with_cache(my_cache, expiration_seconds=7200)
```

### `resolve_for_openai(ref: MediaRef, model: str | None = None) -> dict[str, Any]`

Convert a `MediaRef` to an OpenAI-style content part. If `model` is provided, checks the capability matrix and raises `UnsupportedMediaInputError` for text-only models.

**Returns:** A dict like `{"type": "image_url", "image_url": {"url": "..."}}`

### `resolve_for_google(ref: MediaRef, model: str | None = None) -> Any`

Convert a `MediaRef` to a `google.genai.types.Part`. Same capability check as `resolve_for_openai` when `model` is given. Requires the `google-genai` extra.

---

## Security helpers

Validate file content, sanitize filenames, and enforce size limits.

### `validate_magic_bytes`

Check that raw file bytes match the claimed MIME type using magic bytes (file signatures). Known types are `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/bmp`, `image/tiff`, `application/pdf` and `application/zip`.

```python
from tenxgraph.storage.media import validate_magic_bytes

with open("photo.jpg", "rb") as f:
    data = f.read()

if not validate_magic_bytes(data, "image/jpeg"):
    raise ValueError("File is not actually a JPEG")
```

**Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `data` | `bytes` | required | Raw file bytes (at least first 12 bytes needed). |
| `claimed_mime` | `str` | required | The MIME type the uploader claims. |

**Returns:** `True` if magic bytes match or MIME type is unknown (unknown types pass by default); `False` if data is empty or bytes contradict the claim.

### `sanitize_filename`

Sanitize a user-provided filename for safe filesystem storage. It normalizes Unicode (NFC), keeps only the basename, removes `..`, characters such as `<>:"/\|?*` and control characters, strips surrounding spaces and dots, truncates to 255 characters keeping the extension, and returns `"unnamed"` for empty results.

```python
from tenxgraph.storage.media import sanitize_filename

print(sanitize_filename("../../etc/passwd"))  # passwd
print(sanitize_filename("photo (1).jpg"))  # photo (1).jpg
print(sanitize_filename(""))  # unnamed
```

**Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `filename` | `str` | required | Raw filename from user upload. |

**Returns:** A safe filename string.

### `enforce_file_size`

Raise `ValueError` if data exceeds the size limit.

```python
from tenxgraph.storage.media import enforce_file_size

with open("large_file.zip", "rb") as f:
    data = f.read()

try:
    enforce_file_size(data, max_mb=100.0)
except ValueError as e:
    print(f"File too large: {e}")
```

**Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `data` | `bytes` | required | Raw file bytes. |
| `max_mb` | `float` | required | Maximum allowed size in megabytes. |

**Raises:** `ValueError` if data size exceeds the limit.

---

## Common patterns

### Validate and offload an image message

Validate each image block, then offload large blobs to a store so the message stays small.

```python title="validate_and_offload.py"
from tenxgraph.core.state import ImageBlock, Message
from tenxgraph.storage.media import (
    LocalFileMediaStore,
    MediaOffloadPolicy,
    MediaProcessor,
    MultimodalConfig,
    ensure_media_offloaded,
)

processor = MediaProcessor(config=MultimodalConfig())
store = LocalFileMediaStore(base_dir="./media")


async def prepare(msg: Message) -> Message:
    # Raises ValueError for unsupported types or oversized images
    for block in msg.content:
        if isinstance(block, ImageBlock):
            processor.validate_image(block)
    return await ensure_media_offloaded(msg, store, policy=MediaOffloadPolicy.THRESHOLD)
```

### Cache Google uploads

`upload_to_google_file_api` checks the cache itself, so passing `cache=` is enough.

```python title="cached_google_upload.py"
from tenxgraph.storage.media import ProviderMediaCache, should_use_google_file_api
from tenxgraph.storage.media.provider_media import upload_to_google_file_api

cache = ProviderMediaCache()


async def google_part(file_bytes: bytes, mime_type: str):
    if should_use_google_file_api(len(file_bytes)):
        # Large file: upload once, reuse the reference for identical bytes
        return await upload_to_google_file_api(file_bytes, mime_type, cache=cache)
    return None  # small file: send inline instead
```

### Validate and sanitize uploads

Check content type, size and filename before storing an upload.

```python title="safe_upload.py"
from tenxgraph.storage.media import (
    BaseMediaStore,
    enforce_file_size,
    sanitize_filename,
    validate_magic_bytes,
)


async def safe_upload(store: BaseMediaStore, filename: str, data: bytes, claimed_mime: str) -> str:
    if not validate_magic_bytes(data, claimed_mime):
        raise ValueError(f"Magic bytes do not match {claimed_mime}")
    enforce_file_size(data, max_mb=50.0)
    safe_name = sanitize_filename(filename)
    # Returns the storage key; keep the sanitized name in metadata
    return await store.store(data, claimed_mime, metadata={"filename": safe_name})
```

---

## Common errors

| Error | Cause | Fix |
|---|---|---|
| `graph://media/...` reference not resolved | A client or provider received the internal URI. | Resolve it with `MediaRefResolver(media_store=...)`, or serve it through an API server configured with a media store. |
| `validate_image` raises `ValueError` | Image MIME type or size is outside `MultimodalConfig` limits. | Adjust `supported_image_types` or `max_image_size_mb`, or reject the upload. |
| `validate_magic_bytes` returns `False` | File content does not match the claimed MIME type, or the data is empty. | Check the upload and the MIME type the client declared. |
| Resize, thumbnail or conversion does nothing | Pillow is not installed, or the image is a URL or file_id reference. These methods return the original block. | Install with `pip install "10xgraph[images]"` and use inline `data` images. |
| Messages are still large | `ensure_media_offloaded` was not called, or the policy is `NEVER`, or the blob is below `max_inline_bytes` under `THRESHOLD`. | Call it on the message, and use `ALWAYS` or a lower `max_inline_bytes`. |
| `ImportError` for `upload_to_google_file_api` | It is not exported from `tenxgraph.storage.media`. | Import it from `tenxgraph.storage.media.provider_media`. |
