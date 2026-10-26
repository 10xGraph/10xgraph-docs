---
title: Send media to models
seoTitle: "Send images, audio and documents to LLM models"
description: Send images, audio, and documents to your models from Python using content blocks, MediaRef, and storage backends.
section: "Build agents"
group: "Streaming, media and realtime"
order: 330
label: Send media
updated: "2026-10-26"
faq:
  - q: "When should I use each MediaRef kind?"
    a: "Use `url` for public or CDN-hosted media, and for `graph://media/{key}` references built with `media_store.to_media_ref()`. Use `data` for small payloads embedded directly in the message. Use `file_id` only for provider-managed file IDs."
  - q: "Do I need a media store for production?"
    a: "For single-server setups, LocalFileMediaStore works. For multi-worker or cloud deployments, use CloudMediaStore (S3/GCS) so all workers can access the same files."
  - q: "Can I send media over the REST API?"
    a: "Yes. Upload via POST /v1/files/upload, get a file_id, and reference it in your message. That flow is separate from Python; see /docs/server/files-and-multimodal."
---

10xGraph supports multimodal input natively: send images, audio, video, and documents directly alongside text in messages. Each content type is a typed block, and media is referenced via `MediaRef`, which decouples message structure from where bytes actually live. You choose the transport: external URLs, inline base64, or deduplicated references through a storage backend.

---

## Content blocks and MediaRef

Any message is a list of **content blocks**. 10xGraph provides typed blocks for each medium:

```python
from tenxgraph.core.state import (
    TextBlock,
    ImageBlock,
    AudioBlock,
    VideoBlock,
    DocumentBlock,
    DataBlock,
    Message,
    MediaRef,
)
```

Each block except `TextBlock` holds a `MediaRef` that tells 10xGraph where the bytes are. `MediaRef` has three `kind` values:

| Kind | Use case |
|---|---|
| `url` | External URL, or `graph://media/{key}` from a media store (use `media_store.to_media_ref(key, mime_type)` to build it) |
| `data` | Inline base64 (`data_base64`) for small payloads only |
| `file_id` | A provider-managed file ID, for example one returned by the OpenAI or Gemini file APIs |

An `Agent` only keeps media blocks when you pass it a `multimodal_config`. Without one, image, audio, video and document blocks are stripped before the model call. The examples below all pass `MultimodalConfig()`.

Install the provider extra for the model you use, for example `pip install "10xgraph[google-genai]"` for Gemini or `pip install "10xgraph[openai]"` for OpenAI.

---

## Example 1: Image from a public URL

Send an image directly from the web:

```python
from tenxgraph.core.graph import Agent, StateGraph
from tenxgraph.core.state import Message, TextBlock, ImageBlock, MediaRef
from tenxgraph.storage.media import MultimodalConfig
from tenxgraph.utils import END

agent = Agent(
    model="gemini-2.5-flash",
    provider="google",
    multimodal_config=MultimodalConfig(),
)

graph = StateGraph()
graph.add_node("MAIN", agent)
graph.set_entry_point("MAIN")
graph.add_edge("MAIN", END)
app = graph.compile()

messages = [
    Message(
        role="user",
        content=[
            TextBlock(text="What is in this image?"),
            ImageBlock(
                media=MediaRef(
                    kind="url",
                    url="https://example.com/photo.png",
                    mime_type="image/png",
                )
            ),
        ],
    )
]

result = app.invoke({"messages": messages})
print(result["messages"][-1].text())
```

This is the simplest approach: you give the model a URL and 10xGraph resolves it for the provider. `Agent` is a graph node, so run it through a compiled graph (`app`), which later examples reuse.

---

## Control which URLs the server downloads

A `kind="url"` block is untrusted input when it comes from a client. What happens to it depends on the provider path:

- **OpenAI and Anthropic** fetch the URL themselves. Your server only passes it on, and the policy below does not apply.
- **Google GenAI**, the Google File API and the inline-bytes transport make your server download the URL first. These downloads go through a `MediaFetchPolicy`.

`MediaFetchPolicy` is a frozen dataclass in `tenxgraph.storage.media`. The defaults are safe, so you only set the fields you want to change:

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `True` | `False` means the server never downloads an external URL. URLs a provider fetches itself are not affected. |
| `allowed_schemes` | `("https", "http")` | A subset of these two. No other scheme can be allowed. |
| `allowed_hosts` | `()` | Empty allows any public host. Entries are exact names or `"*.example.com"` (subdomains only). |
| `allow_private_for_allowed_hosts` | `False` | On-prem opt-in: hosts listed in `allowed_hosts` may resolve to private addresses. |
| `allowed_content_types` | `("image/*", "application/pdf")` | Response `Content-Type` values accepted. `"image/*"` style wildcards work. |
| `max_bytes` | 20 MiB | Largest download. |
| `timeout` | `10.0` | Seconds for the whole download, redirects included. |
| `allowed_gcs_buckets` | `()` | `gs://` buckets a client may reference. Empty rejects every `gs://` URL. |

These rules always apply and cannot be turned off:

- Only `http` and `https` are downloaded.
- Cloud metadata addresses are never reached, even with the private-host opt-in.
- A host name must resolve to public addresses, and the connection goes to the address that was checked.
- Every redirect is checked again, and at most 5 are followed.
- The size cap and the timeout always apply.

Pass the policy to `compile()`. The prebuilt agents take the same argument on their own `compile()`:

```python
from tenxgraph.storage.media import MediaFetchPolicy

policy = MediaFetchPolicy(
    allowed_hosts=("cdn.example.com", "*.example.org"),
    allowed_content_types=("image/*", "application/pdf", "audio/*"),
    max_bytes=10 * 1024 * 1024,
    timeout=5.0,
    allowed_gcs_buckets=("my-uploads",),
)
app = graph.compile(media_policy=policy)

app.media_policy.check_url("https://cdn.example.com/a.png")  # no network; raises MediaURLError if refused
```

`check_url` needs no network, so it is cheap to call on input. The API server calls it on every client media URL before the run (see [Files and multimodal on the server](/docs/server/files-and-multimodal#external-media-urls)). Host names are resolved, and their addresses checked, only at download time.

A URL the policy refuses, or that fails to download, becomes a `[Failed to load image]` or `[Failed to load media]` text part in the prompt. The warning in the log shows the URL without its query string.

The default content types cover images and PDFs only, so audio and video links on Google graphs are not downloaded until you add those types.

### `gs://` URLs

On Vertex AI, a `gs://` URL is read with the server's own credentials, not the client's. A client could point it at any bucket the server can read. For that reason the API rejects a client `gs://` URL unless its bucket is in `allowed_gcs_buckets`. The converters pass `gs://` through unchanged, and your own code may still use any `gs://` URL, because `check_url` is the only place the list is enforced.

---

## Example 2: Inline base64 for small media

Embed bytes directly in the message for small payloads:

```python
import base64
from tenxgraph.core.state import Message, TextBlock, ImageBlock, MediaRef

# Read a local image
with open("photo.jpg", "rb") as f:
    image_bytes = f.read()

b64 = base64.b64encode(image_bytes).decode()

messages = [
    Message(
        role="user",
        content=[
            TextBlock(text="Describe this photo in one sentence."),
            ImageBlock(
                media=MediaRef(
                    kind="data",
                    data_base64=b64,
                    mime_type="image/jpeg",
                )
            ),
        ],
    )
]

result = app.invoke({"messages": messages})
```

This works well for development and testing. For production or repeated references, use a media store instead.

---

## Example 3: Media store for reusable references

Store media once, reference it many times:

```python
import asyncio
from tenxgraph.core.state import Message, TextBlock, ImageBlock, MediaRef
from tenxgraph.storage.media import InMemoryMediaStore

media_store = InMemoryMediaStore()

# Bind the store to the graph so graph://media/ references can be resolved
app = graph.compile(media_store=media_store)

# Upload and get a storage key
async def setup():
    with open("chart.png", "rb") as f:
        key = await media_store.store(data=f.read(), mime_type="image/png")
    return key

key = asyncio.run(setup())

# Reference by key in a message (builds a graph://media/{key} URL)
messages = [
    Message(
        role="user",
        content=[
            TextBlock(text="Analyze this chart and extract the numbers."),
            ImageBlock(media=media_store.to_media_ref(key, "image/png")),
        ],
    )
]

result = app.invoke({"messages": messages})
```

The store returns an opaque key. You can reference that key in unlimited messages without re-uploading the file. This is recommended for production.

---

## Audio and documents

Audio blocks work the same way as images:

```python
import base64
from tenxgraph.core.state import AudioBlock

with open("clip.wav", "rb") as f:
    audio_bytes = f.read()

messages = [
    Message(
        role="user",
        content=[
            TextBlock(text="Transcribe this audio."),
            AudioBlock(
                media=MediaRef(
                    kind="data",
                    data_base64=base64.b64encode(audio_bytes).decode(),
                    mime_type="audio/wav",
                ),
                sample_rate=16000,
                channels=1,
            ),
        ],
    )
]
```

Document blocks can include both extracted text and the raw file. Most models take text, so provide the text when you have it:

```python
from tenxgraph.core.state import DocumentBlock

messages = [
    Message(
        role="user",
        content=[
            TextBlock(text="Summarize this contract."),
            DocumentBlock(
                text="Optional: pre-extracted text if you have it already.",
                media=MediaRef(
                    kind="url",
                    url="https://example.com/contract.pdf",
                    mime_type="application/pdf",
                ),
            ),
        ],
    )
]
```

---

## Configure media with MultimodalConfig

Pass `MultimodalConfig` to `Agent` to enable media for that agent. Agents without it strip media blocks, which keeps text-only agents in a multi-agent graph from receiving images added by an earlier agent.

```python
from tenxgraph.core.graph import Agent
from tenxgraph.storage.media import (
    ImageHandling,
    DocumentHandling,
    MultimodalConfig,
)

agent = Agent(
    model="gpt-4o",
    provider="openai",
    multimodal_config=MultimodalConfig(
        image_handling=ImageHandling.BASE64,
        document_handling=DocumentHandling.EXTRACT_TEXT,
        max_image_size_mb=10.0,
        max_image_dimension=2048,
        supported_image_types={"image/jpeg", "image/png", "image/webp"},
        supported_doc_types={"application/pdf"},
    ),
)
```

The fields and defaults are:

| Field | Default |
|---|---|
| `image_handling` | `ImageHandling.BASE64` (also `URL`, `FILE_ID`) |
| `document_handling` | `DocumentHandling.EXTRACT_TEXT` (also `FORWARD_RAW`, `SKIP`) |
| `max_image_size_mb` | `10.0` |
| `max_image_dimension` | `2048` |
| `supported_image_types` | JPEG, PNG, WebP, GIF |
| `supported_doc_types` | PDF, DOCX |

The size, dimension and type limits are enforced by `MediaProcessor` (`tenxgraph.storage.media`), which you call yourself to validate or resize images before sending. The `Agent` does not apply them automatically. Document text extraction is not part of the core library; it lives in the API server, so pass pre-extracted text in `DocumentBlock(text=...)` when you need it.

---

## Complete graph with media store

Here is an example that combines a graph, checkpointer, and media store:

```python
import asyncio
from tenxgraph.core.graph import Agent, StateGraph
from tenxgraph.core.state import (
    ImageBlock,
    Message,
    TextBlock,
)
from tenxgraph.storage.checkpointer import InMemoryCheckpointer
from tenxgraph.storage.media import (
    ImageHandling,
    InMemoryMediaStore,
    MultimodalConfig,
)
from tenxgraph.utils import END

async def main():
    checkpointer = InMemoryCheckpointer()
    media_store = InMemoryMediaStore()

    agent = Agent(
        model="gemini-2.5-flash",
        provider="google",
        system_prompt=[{"role": "system", "content": "You are a helpful image analyst."}],
        multimodal_config=MultimodalConfig(
            image_handling=ImageHandling.BASE64,
        ),
    )

    graph = StateGraph()
    graph.add_node("agent", agent)
    graph.set_entry_point("agent")
    graph.add_edge("agent", END)

    app = graph.compile(checkpointer=checkpointer, media_store=media_store)

    # Upload an image
    with open("sample.jpg", "rb") as f:
        image_key = await media_store.store(
            data=f.read(),
            mime_type="image/jpeg",
        )

    # Create a message referencing the stored image
    messages = [
        Message(
            role="user",
            content=[
                TextBlock(text="What objects do you see?"),
                ImageBlock(media=media_store.to_media_ref(image_key, "image/jpeg")),
            ],
        )
    ]

    # Invoke
    result = await app.ainvoke(
        {"messages": messages},
        config={"thread_id": "image-analysis-1"},
    )

    # Print the response
    print(result["messages"][-1].text())

asyncio.run(main())
```

---

## Media store backends

10xGraph provides three storage backends. Choose based on your deployment model:

**InMemoryMediaStore**: Development and testing. Data is lost on process restart.

```python
from tenxgraph.storage.media import InMemoryMediaStore

store = InMemoryMediaStore()
key = await store.store(data=image_bytes, mime_type="image/png")
bytes_back, mime = await store.retrieve(key)
```

**LocalFileMediaStore**: Single-server deployments. Stores files on disk with sharding.

```python
from tenxgraph.storage.media import LocalFileMediaStore

store = LocalFileMediaStore(base_dir="./media")
key = await store.store(data=pdf_bytes, mime_type="application/pdf")
```

Files are sharded as `{base_dir}/{key[:2]}/{key[2:4]}/{key}.{ext}` with a `.meta.json` sidecar for metadata.

**CloudMediaStore**: Multi-worker and cloud deployments. Stores in S3 or GCS.

```bash
pip install "10xgraph[cloud-storage]"
```

```python
from cloud_storage_manager import CloudStorageFactory, StorageProvider, StorageConfig, AwsConfig
from tenxgraph.storage.media import CloudMediaStore

config = StorageConfig(
    aws=AwsConfig(bucket_name="my-bucket", access_key_id="...", secret_access_key="...")
)
storage = CloudStorageFactory.get_storage(StorageProvider.AWS, config)
store = CloudMediaStore(storage, prefix="10xgraph-media")
```

All stores expose the same async interface: `store()`, `retrieve()`, `delete()`, `exists()`, and `get_metadata()`, plus `to_media_ref()` to build a message reference.

---

## Common patterns and pitfalls

**Don't re-encode for every message.** If you send the same image multiple times, store it once and reference the key. This saves bandwidth and encoding overhead.

**Provide MIME types.** Always include `mime_type` in `MediaRef`. The provider needs it to interpret the bytes correctly.

**Size limits are configurable.** When running behind the API server, check `MEDIA_MAX_SIZE_MB` and `MEDIA_ALLOWED_CONTENT_TYPES` environment variables. For Python graphs, `MultimodalConfig.max_image_size_mb` is enforced only when you use `MediaProcessor`.

**Pre-extract text when possible.** Document blocks can carry both raw bytes and pre-extracted text. If you have text extracted already (e.g. from a PDF parser), include it via the `text` parameter so the model has text to work with even if it cannot process the raw file.

**Video is supported.** You can send video via `VideoBlock` the same way you send images and audio. Whether the model processes it depends on provider capabilities.

---

## What you learned

- Message content is a list of typed blocks: `TextBlock`, `ImageBlock`, `AudioBlock`, `DocumentBlock`, etc.
- `MediaRef` decouples message structure from media transport: `kind="url"` for public URLs, `kind="data"` for inline base64, `kind="file_id"` for provider file IDs; use `media_store.to_media_ref()` for storage references.
- Use `InMemoryMediaStore` for development, `LocalFileMediaStore` for single servers, `CloudMediaStore` for multi-worker setups.
- `MultimodalConfig` on the `Agent` enables media for that agent; without it, media blocks are stripped.
- Always provide MIME types and respect size limits.

---

## Related pages

- [Concepts: Media and files](/docs/concepts/media-and-files): The reference concept for media types and provider capabilities.
- [Concepts: State and messages](/docs/concepts/state-and-messages): Content block details and message structure.
- [Server: Files and multimodal](/docs/server/files-and-multimodal): File upload via the REST API and media configuration.
- [Reference: Media](/docs/reference/python/media): Full API for media stores and configuration classes.
