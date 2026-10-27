---
title: Memory stores
seoTitle: "Memory stores API reference (Python)"
description: "Reference for BaseStore, QdrantStore, Mem0Store, embedding classes, MemoryConfig, the agent memory system prompt and store factories."
section: Reference
group: "Python library"
order: 220
label: Memory stores
updated: "2026-10-27"
---

A memory store keeps facts, preferences and past interactions across conversation threads, so an agent can recall them later. This page documents the `tenxgraph.storage.store` API: embeddings, `QdrantStore`, `Mem0Store`, memory configuration, retrieval helpers and factories. A checkpointer, by contrast, saves state within one thread.

For the concepts and a walkthrough, see [Long-term memory](/docs/concepts/memory-and-store) and [Use a memory store](/docs/guides/use-memory-store).

## Import paths

```python
from tenxgraph.storage.store import (
    BaseStore, QdrantStore, Mem0Store,
    MemoryConfig, AgentMemoryConfig, UserMemoryConfig,
    get_agent_memory_system_prompt,
)
from tenxgraph.storage.store.store_schema import (
    MemoryType, RetrievalStrategy, DistanceMetric,
    MemorySearchResult, MemoryRecord,
)  # MemoryType, DistanceMetric and MemorySearchResult are also exported from tenxgraph.storage.store
from tenxgraph.storage.store.embedding import (
    BaseEmbedding, OpenAIEmbedding, GoogleEmbedding,
)
from tenxgraph.storage.store.long_term_memory import ReadMode  # also exported from tenxgraph.storage.store
```

Install the dependencies for the backends you use:

```bash
pip install openai              # OpenAIEmbedding
pip install google-genai        # GoogleEmbedding
pip install "10xgraph[qdrant]"  # QdrantStore (qdrant-client >= 1.10)
pip install "10xgraph[mem0]"    # Mem0Store (mem0ai)
```

---

## Enums

### `MemoryType`

| Value | Use case |
|---|---|
| `EPISODIC` | Conversation memories: what happened in a past chat. |
| `SEMANTIC` | Facts and general knowledge, such as "the user prefers dark mode". |
| `PROCEDURAL` | How-to knowledge, such as "to reset the password, go to Settings > Security". |
| `ENTITY` | Named entities and their attributes. |
| `RELATIONSHIP` | Connections between entities. |
| `DECLARATIVE` | Explicit facts and events stated by the user. |
| `CUSTOM` | Application-defined memory categories. |

### `RetrievalStrategy`

| Value | Description |
|---|---|
| `SIMILARITY` | Vector similarity search. The default in `asearch`. |
| `TEMPORAL` | Time-ordered retrieval, most recent first. |
| `RELEVANCE` | Relevance scoring combining recency and similarity. |
| `HYBRID` | Combines similarity and temporal signals. |
| `GRAPH_TRAVERSAL` | Navigates a knowledge graph to find connected memories. |

### `DistanceMetric`

| Value | Description |
|---|---|
| `COSINE` | Cosine similarity. Best for normalised embeddings. |
| `EUCLIDEAN` | Euclidean (L2) distance. Sensitive to vector magnitude. |
| `DOT_PRODUCT` | Inner product. Fast; requires normalisation to equal cosine. |
| `MANHATTAN` | L1 distance. Robust to outliers. |

### `ReadMode`

`ReadMode` is a string enum that controls how an agent reads long-term memory. Strings such as `"preload"` are accepted wherever a `ReadMode` is expected.

| Value | Description |
|---|---|
| `NO_RETRIEVAL` | Value `"no_retrieval"`. The model cannot read past memories and no memory tools are registered. |
| `PRELOAD` | Value `"preload"`. Relevant memories are searched once per graph invocation and added to the latest user message, for that request only. Every model call in the run reuses the same block. See [Why memories are not system text](/docs/concepts/memory-and-store#why-memories-are-not-system-text). |
| `POSTLOAD` | Value `"postload"`. The model decides when to search by calling `user_memory_tool` or `agent_memory_tool`. |

---

## Embeddings

`QdrantStore` requires an embedding service to turn text into vectors for similarity search. Use a built-in class or subclass `BaseEmbedding`. Provider errors surface as `RuntimeError`.

### `BaseEmbedding`

Abstract base class for all embedding implementations. Subclasses must implement `aembed_batch`, `aembed` and the `dimension` property. The example below is a toy deterministic embedding that runs without any API key, useful for tests only.

```python title="custom_embedding.py"
import hashlib

from tenxgraph.storage.store.embedding import BaseEmbedding


class HashEmbedding(BaseEmbedding):
    """Toy embedding for tests: hashes text into a fixed-size vector."""

    async def aembed(self, text: str) -> list[float]:
        digest = hashlib.sha256(text.encode()).digest()
        return [b / 255 for b in digest]  # 32 floats

    async def aembed_batch(self, texts: list[str]) -> list[list[float]]:
        return [await self.aembed(t) for t in texts]

    @property
    def dimension(self) -> int:
        return 32


print(HashEmbedding().embed("hello")[:3])  # sync wrapper
```

| Member | Abstract | Description |
|---|---|---|
| `aembed_batch(texts)` | Yes | Async: embed a list of texts. Returns one vector per text. |
| `aembed(text)` | Yes | Async: embed one text. Returns a vector. |
| `dimension` | Yes (property) | Embedding size as an integer. The collection is created with this size. |
| `embed_batch(texts)` | No | Sync wrapper around `aembed_batch`. |
| `embed(text)` | No | Sync wrapper around `aembed`. |

### `OpenAIEmbedding`

Embedding service using OpenAI embedding models.

Requires: `pip install openai`

```python
from tenxgraph.storage.store.embedding import OpenAIEmbedding

# Uses text-embedding-3-small by default; reads OPENAI_API_KEY
embedding = OpenAIEmbedding()

# Or pass the model and key explicitly
embedding = OpenAIEmbedding(
    model="text-embedding-3-large",
    api_key="<your-openai-key>",
)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `model` | `str` | `"text-embedding-3-small"` | OpenAI embedding model to use. |
| `api_key` | `str \| None` | None | OpenAI API key. If not provided, reads from `OPENAI_API_KEY` env var. |

**Raises:** `ImportError` if `openai` is not installed. `ValueError` if no key is found. The `dimension` property raises `ValueError` for a model name it does not know (known: `text-embedding-3-small`, `text-embedding-3-large`, `text-embedding-3-xl`, `text-embedding-4-base`, `text-embedding-4-large`), so wrap an unknown model in a custom `BaseEmbedding` subclass.

### `GoogleEmbedding`

Embedding service using Google Gemini embedding models.

Requires: `pip install google-genai`

```python
from tenxgraph.storage.store.embedding import GoogleEmbedding

# Uses gemini-embedding-001 by default; reads GOOGLE_API_KEY or GEMINI_API_KEY
embedding = GoogleEmbedding()

# Or pass the model, key and a reduced output size explicitly
embedding = GoogleEmbedding(
    model="gemini-embedding-001",
    api_key="<your-google-key>",
    output_dimensionality=768,  # optional
)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `model` | `str` | `"gemini-embedding-001"` | Google embedding model to use. |
| `api_key` | `str \| None` | None | Google API key. Reads from `GOOGLE_API_KEY` or `GEMINI_API_KEY` env vars if not provided. |
| `output_dimensionality` | `int \| None` | None | Optional: reduce output dimension. Some models support this. |

**Raises:** `ImportError` if `google-genai` is not installed. `ValueError` if no key is found. `dimension` returns `output_dimensionality` when set, `3072` for `gemini-embedding-001`, and `768` for other models.

---

## Memory configuration

`MemoryConfig` is the object you pass to `Agent(..., memory=...)`. It sets the store, the retrieval mode and two optional scopes: user memory (the model can search and write) and agent memory (the model can only search). All three are pydantic models.

### `MemoryConfig`

Primary configuration object for `Agent(..., memory=...)`. A `str` retrieval mode is converted to `ReadMode`. `limit` must be at least 1 and `score_threshold` must not be negative, otherwise validation raises.

| Field | Type | Default | Description |
|---|---|---|---|
| `store` | `BaseStore \| None` | None | The memory store (QdrantStore, Mem0Store, etc.). Required if memory is enabled. |
| `retrieval_mode` | `ReadMode \| str` | `ReadMode.POSTLOAD` | How memories are retrieved: `NO_RETRIEVAL`, `PRELOAD`, or `POSTLOAD`. |
| `limit` | `int` | 5 | Maximum number of memories to retrieve per search. |
| `score_threshold` | `float` | 0.0 | Minimum similarity score for a memory to be returned. 0.0 = no threshold. |
| `max_tokens` | `int \| None` | None | Optional token budget for retrieved memory context. |
| `inject_system_prompt` | `bool` | True | Whether to include memory system instructions in the model's system prompt. |
| `config` | `dict[str, Any]` | {} | Application-defined config passed to store methods. |
| `user_memory` | `UserMemoryConfig \| None` | UserMemoryConfig() | Config for user-scoped memory (searchable and writable by model). |
| `agent_memory` | `AgentMemoryConfig \| None` | AgentMemoryConfig() | Config for agent/app-scoped memory (searchable but not writable by model). |

```python title="memory_config.py"
from tenxgraph.core import Agent
from tenxgraph.storage.store import MemoryConfig, OpenAIEmbedding, QdrantStore, ReadMode

store = QdrantStore(embedding=OpenAIEmbedding(), path="./qdrant_data")

memory = MemoryConfig(
    store=store,
    retrieval_mode=ReadMode.PRELOAD,  # search once per invocation, inject into the user message
    limit=5,
    score_threshold=0.5,
    max_tokens=2000,
)

agent = Agent(model="gpt-4o", memory=memory)
```

<aside class="callout callout-warning" role="warning"><p class="callout-title">POSTLOAD needs a ToolNode</p>

With `ReadMode.POSTLOAD` (the default) the agent registers `user_memory_tool` and `agent_memory_tool` on its tool node. If the `Agent` has no `tool_node`, construction raises `RuntimeError`. Pass `tool_node=` or use `PRELOAD`.

</aside>

### `UserMemoryConfig`

Configuration for user-scoped long-term memory. The model can both search and write to user memories. `memory_type` and `category` must not be empty, and `limit` must be at least 1 when set.

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | `bool` | True | Whether user memory is enabled. |
| `store` | `BaseStore \| None` | None | The store instance (if different from the parent MemoryConfig). |
| `memory_type` | `str` | `"episodic"` | Default memory type when storing. One of the MemoryType enum values. |
| `category` | `str` | `"general"` | Default memory category when storing. |
| `limit` | `int \| None` | None | Max memories to retrieve. If None, uses the parent config limit. |
| `score_threshold` | `float \| None` | None | Min similarity score, must not be negative. If None, uses the parent config threshold. |
| `config` | `dict[str, Any]` | {} | Optional config dict passed to store calls. |
| `collection` | `str \| Callable[[dict], str] \| None` | None | Collection for this scope: a name, or a function of the run config. Always wins over any other collection. See [Collections](#collections). |
| `user_id` | `str \| None` | None | User identifier for scoping. Blank strings are rejected. |

### `AgentMemoryConfig`

Configuration for agent/app-scoped long-term memory. The model can search but not write to agent memories.

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | `bool` | False | Whether agent memory is enabled (disabled by default). |
| `store` | `BaseStore \| None` | None | The store instance (if different from the parent MemoryConfig). |
| `memory_type` | `str` | `"episodic"` | Default memory type. |
| `category` | `str` | `"general"` | Default memory category. |
| `limit` | `int \| None` | None | Max memories to retrieve. |
| `score_threshold` | `float \| None` | None | Min similarity score. |
| `collection` | `str \| Callable[[dict], str] \| None` | None | Collection for this scope: a name, or a function of the run config. Always wins. See [Collections](#collections). |
| `config` | `dict[str, Any]` | {} | Optional config dict. |
| `agent_id` | `str \| None` | None | Agent identifier for scoping. |
| `app_id` | `str \| None` | None | App identifier for scoping. |

Agent memory is shared data. `agent_memory_tool` and the preload block always search it as the reserved owner `system_user_id(agent_id)` (or `system_user_id(app_id)` when `agent_id` is not set), whatever user is running, so every user of an agent sees the same agent memory. Each agent has its own owner, so two agents never see each other's shared memory, even in one Qdrant collection. Enabling `AgentMemoryConfig` with neither `agent_id` nor `app_id` raises `ValueError` when the Agent sets up its memory:

```text
ValueError: MemoryConfig.agent_memory is enabled but has neither agent_id nor app_id; set one so shared agent memory has its own owner
```

To write shared agent memory from your own code, store under the same owner. The tool searches with `user_id` set to the owner, plus `agent_id` and `thread_id` (both set to your `agent_id`) and `app_id` when set, so write with the same keys:

```python
from tenxgraph.storage import system_user_id

await store.astore(
    config={
        "user_id": system_user_id("customer-support-v2"),
        "agent_id": "customer-support-v2",
        "thread_id": "customer-support-v2",
    },
    content="Error E42 means the license expired.",
    category="workarounds",
)
```

With only an `app_id`, use `{"user_id": system_user_id(app_id), "app_id": app_id}`. `QdrantStore` filters search by `user_id`, `memory_type` and `category` and ignores `agent_id`, `app_id` and `thread_id`; the per-agent owner is what keeps agents apart. `Mem0Store` also scopes by `app_id`.

---

### Collections

`UserMemoryConfig` and `AgentMemoryConfig` share the `collection` field. A string is stripped and must not be empty (a blank name raises `ValueError` at validation). A function receives the run config and must return a non-empty string.

`resolve_collection(run_config) -> str | None` returns the scope's collection: `None` when `collection` is not set, the string as is, or the function's result (stripped). A function that returns a non-string or a blank string raises `ValueError`. Memory tools and the preload block call it with the merged config when they build each scope's config, and write the result to `cfg["collection"]`.

**Precedence.** The first of these that sets a collection wins:

1. The scope's `collection` (`UserMemoryConfig` / `AgentMemoryConfig`). It overrides any `collection` in the merged config, including one in the run config.
2. A `collection` in the merged config: `MemoryConfig.config`, the scope's `config`, or a run config built by your own code.
3. The store default, `QdrantStore(collection=...)`.

The API removes `collection` from client config on every route, so a client cannot supply level 2. The REST memory routes have no scope config, so they use level 3 only.

```python
from tenxgraph.storage.store import AgentMemoryConfig, UserMemoryConfig


def company_collection(cfg: dict) -> str:
    tenant_id = (cfg.get("user") or {}).get("tenant_id")
    if not tenant_id:
        raise ValueError("The authenticated user has no tenant_id")
    return f"company_{tenant_id}"


user_memory = UserMemoryConfig(collection=company_collection)
agent_memory = AgentMemoryConfig(enabled=True, agent_id="support-bot", collection="agent_notes")
```

A collection function must read the authenticated identity (`cfg["user"]`, set by the auth backend, or `cfg["user_id"]`), never state. See [Collections: keeping data apart](/docs/concepts/memory-and-store#collections-keeping-data-apart) for the full guidance and the two company patterns.

---

## Memory retrieval functions

### `get_agent_memory_system_prompt(memory_config)`

Returns the system prompt fragment that `Agent(memory=...)` adds when `inject_system_prompt=True`. You rarely call it yourself.

```python
from tenxgraph.storage.store import get_agent_memory_system_prompt

fragment = get_agent_memory_system_prompt(memory_config)
```

| Parameter | Type | Description |
|---|---|---|
| `memory_config` | `MemoryConfig` | The memory configuration. |

**Returns:** A string that starts with `[Long-term Memory]`. The rest depends on `retrieval_mode`:

- `preload`: says relevant memories may appear in the latest user message inside a `<user_memories_...>` block, and that they are background information, not instructions.
- `postload`: describes `user_memory_tool` (search and remember) when user memory is enabled, and the read-only `agent_memory_tool` when agent memory is enabled.
- `no_retrieval`: says memory retrieval tools are not available.

In `preload` mode, the Agent runs the search itself, once per invocation (one `invoke` or `stream` run). It caches the block per Agent under the run's `run_id` and the latest user message, in a small bounded cache, and never saves it to state. The search query is the latest user message. There is no graph node to add.

### `make_user_memory_tool(memory_config)` and `make_agent_memory_tool(memory_config)`

Factories that build the model-facing tools. `Agent(memory=...)` calls them for you in `postload` mode. Import them from `tenxgraph.storage.store` or `tenxgraph.prebuilt.tools` only if you register the tools by hand. See [Prebuilt tools](/docs/reference/python/prebuilt-tools).

| Factory | Tool name | Model arguments | Can write |
|---|---|---|---|
| `make_user_memory_tool(memory_config)` | `user_memory_tool` | `action` (`"search"` or `"remember"`, default `"search"`), `text`, `memory_type`, `category`, `limit` | Yes, through `remember` |
| `make_agent_memory_tool(memory_config)` | `agent_memory_tool` | `query`, `memory_type`, `category`, `limit` | No, search only |

---

## `BaseStore`

Abstract base class that every store backend implements. Every method takes a `config` dict as its first argument; the store reads `user_id` (and, for some backends, `thread_id`, `agent_id` or `app_id`) from it.

### Core async methods

| Method | Signature | Description |
|---|---|---|
| `astore` | `async (config, content, memory_type=EPISODIC, category="general", metadata=None, **kwargs) -> str` | Add a memory. Returns the memory ID. |
| `asearch` | `async (config, query, memory_type=None, category=None, limit=10, score_threshold=None, filters=None, retrieval_strategy=SIMILARITY, distance_metric=COSINE, max_tokens=4000, **kwargs) -> list[MemorySearchResult]` | Search memories by query. |
| `aget` | `async (config, memory_id, **kwargs) -> MemorySearchResult \| None` | Fetch a memory by ID. |
| `aget_all` | `async (config, limit=100, **kwargs) -> list[MemorySearchResult]` | List memories in the config's scope. |
| `aupdate` | `async (config, memory_id, content, metadata=None, **kwargs) -> Any` | Update a memory's content. |
| `adelete` | `async (config, memory_id, **kwargs) -> Any` | Delete a memory by ID. |
| `aforget_memory` | `async (config, **kwargs) -> Any` | Delete memories for the `user_id` in `config`. `thread_id` is an optional extra filter. `QdrantStore` also narrows by the keyword arguments `memory_type`, `category` and `filters` (combined with AND; a `filters` value that is not a string, integer or boolean raises `ValueError`). `Mem0Store` can delete only by user, so it raises `ValueError` when any of the three is passed. |
| `asetup` | `async () -> Any` | Create the collection or other backing resources. Implemented by `QdrantStore`; the base class raises `NotImplementedError`. |
| `arelease` | `async () -> None` | Release connections. Not abstract, but the base implementation raises `NotImplementedError`; `Mem0Store` overrides it. |

There is no bulk `abatch_store`; call `astore` in a loop or with `asyncio.gather`.

### Sync wrappers

```python
store.store(config, content)
store.search(config, query)
```

Each async method has a sync wrapper named without the `a` prefix (`store`, `search`, `get`, `get_all`, `update`, `delete`, `forget_memory`, `setup`, `release`). Use the async variants in async code.

### Config dictionary

```python
config = {
    "user_id": "alice",      # required by every store operation
    "thread_id": "thread-1", # optional; QdrantStore reads it
}
```

### The `user_id` rule and `system_user_id`

Every long-term memory operation needs a non-empty `user_id`, taken from the `config` dict. A missing, `None`, empty or blank value raises:

```text
ValueError: user_id is required for memory operations; use system_user_id(name) for shared data
```

This applies to `astore`, `asearch`, `aget`, `aget_all`, `aupdate`, `adelete` and `aforget_memory` on both `QdrantStore` and `Mem0Store`. A store never falls back to searching or deleting across all users.

Two rules refine this:

- **Admin reads.** When the authz policy scope is `"none"` (admin or `allow_all`), reads and updates (`asearch`, `aget`, `aget_all`, `aupdate`, `adelete`) skip the user filter and see every user's memories. Writes (`astore`) and `aforget_memory` still need a concrete `user_id` under this policy.
- **`aforget_memory`** always filters by `user_id`. `thread_id` is an optional extra filter, never a replacement. A narrowing argument is never dropped silently: it is applied or the call raises, so a narrow forget cannot delete everything.

Data that belongs to no person, such as agent/app memory and RAG knowledge bases, is owned by a reserved system id. Three names are exported from `tenxgraph.storage.store` and `tenxgraph.storage`:

| Name | Description |
|---|---|
| `SYSTEM_USER_PREFIX` | The constant `"__system__"`. Every system owner starts with it. |
| `system_user_id(name)` | Returns `"__system__:<name>"`. Raises `ValueError` when `name` is empty. Each name is its own owner, so shared data sets stay separate. |
| `is_system_user_id(user_id)` | Returns `True` for any `str` that starts with `__system__`. |

```python
from tenxgraph.storage import system_user_id, is_system_user_id
# also available as: from tenxgraph.storage.store import system_user_id

owner = system_user_id("knowledge_base")  # "__system__:knowledge_base"
await store.astore(config={"user_id": owner}, content="Refunds take 5 days.")
is_system_user_id(owner)  # True
```

Agent and app memory use `system_user_id(agent_id)` (or `system_user_id(app_id)`); `RAGAgent` searches `system_user_id("knowledge_base")` by default. The 10xGraph API refuses any authenticated identity whose `user_id` starts with `__system__` (HTTP 401 "This user id is reserved", WebSocket close code 1008), so no caller can act as a shared owner. Records written earlier with an empty owner are not found by any user-scoped read; re-index them under the intended owner.

---

## `MemorySearchResult`

Returned by `asearch`, `aget` and `aget_all`. Each result represents a matching memory.

| Field | Type | Description |
|---|---|---|
| `id` | `str` | Memory ID. |
| `content` | `str` | The memory text. |
| `score` | `float` | Similarity or relevance score, at least 0.0. |
| `memory_type` | `MemoryType` | Categorisation. |
| `metadata` | `dict` | Application-defined metadata. |
| `vector` | `list[float] \| None` | Embedding vector (if returned by backend). |
| `user_id` | `str \| None` | User scope. |
| `thread_id` | `str \| None` | Thread where this memory was created. |
| `timestamp` | `datetime \| None` | Creation time. |

---

## `QdrantStore`

Vector store backed by [Qdrant](https://qdrant.tech). Production-ready for similarity search.

<aside class="callout callout-note" role="note"><p class="callout-title">Optional dependency</p>

Install with `pip install "10xgraph[qdrant]"`. This needs `qdrant-client` 1.10.0 or newer and, for a server or Qdrant Cloud, Qdrant server 1.10 or newer.

</aside>

```python title="qdrant_store.py"
import asyncio

from tenxgraph.storage.store import OpenAIEmbedding, QdrantStore

# Local Qdrant (persisted to disk)
store = QdrantStore(
    embedding=OpenAIEmbedding(),
    path="./qdrant_data",
)

# Remote Qdrant
store = QdrantStore(
    embedding=OpenAIEmbedding(),
    host="localhost",
    port=6333,
)

# Qdrant Cloud
store = QdrantStore(
    embedding=OpenAIEmbedding(),
    url="https://xyz.qdrant.io",
    api_key="<your-qdrant-api-key>",
)

asyncio.run(store.asetup())  # creates the collection; pass the store to graph.compile(store=store)
```

`path`, `url` and `host`/`port` are checked in that order: `path` wins, then `url`, otherwise `host` (default `localhost`) and `port` (default `6333`). Extra keyword arguments go to `AsyncQdrantClient`.

### Constructor parameters

| Parameter | Type | Description |
|---|---|---|
| `embedding` | `BaseEmbedding` | Embedding service used to vectorise text before storage and search. |
| `path` | `str \| None` | Local path for embedded Qdrant server. |
| `host` | `str \| None` | Remote Qdrant host. |
| `port` | `int \| None` | Remote Qdrant port (default: `6333`). |
| `url` | `str \| None` | Qdrant Cloud URL. |
| `api_key` | `str \| None` | Qdrant Cloud API key. |
| `collection` | `str \| Callable[[dict], str] \| None` | Default collection: a name, or a function `(config) -> name` called with the config of each operation. Used when the config has no `collection`. Defaults to `DEFAULT_COLLECTION`, which is `"agentflow_memories"`. A function must return a non-empty string (otherwise `ValueError`) and must read identity from `config["user"]` or `config["user_id"]`, never state. |
| `distance_metric` | `DistanceMetric` | Distance metric for the collection. Default: `COSINE`. |
| `**kwargs` | `Any` | Passed to `AsyncQdrantClient`. |

**`asetup()` and the default collection.** With a name as the default, `asetup()` creates that collection. With a function, `asetup()` creates nothing, because there is no fixed name; each collection is created, with its payload indexes, by the first write or search that uses it. A collection named by `config["collection"]` is created the same way.


---

## `Mem0Store`

Managed long-term memory using the [mem0](https://mem0.ai) library. Delegates all vector storage and memory management to Mem0.

<aside class="callout callout-note" role="note"><p class="callout-title">Optional dependency</p>

Install with `pip install "10xgraph[mem0]"`.

</aside>

```python title="mem0_store.py"
from tenxgraph.storage.store import Mem0Store

store = Mem0Store(config={
    "llm": {"provider": "openai", "config": {"model": "gpt-4o-mini"}},
    "embedder": {"provider": "openai", "config": {"model": "text-embedding-3-small"}},
    "vector_store": {"provider": "qdrant", "config": {"host": "localhost", "port": 6333}},
})
# pass the store to graph.compile(store=store); no asetup() call is needed
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `config` | `mem0 MemoryConfig \| dict` | Required | Mem0 configuration. A dict goes through `AsyncMemory.from_config`. |
| `app_id` | `str \| None` | `"agentflow_app"` | App identifier. A per-call `config["app_id"]` overrides it. |

`Mem0Store` delegates to Mem0's `AsyncMemory` client, created lazily on first use. Every call needs `user_id` in the `config` dict, otherwise it raises the same `ValueError` as `QdrantStore`. `asetup` is not implemented for `Mem0Store`, so do not call it. `aforget_memory` deletes all memories for the user.

---

## Store factory functions

Convenience functions to create and configure store instances with common patterns.

### `create_local_qdrant_store(path, embedding, collection=...)`

Create a `QdrantStore` with a local embedded Qdrant server.

```python
from tenxgraph.storage.store import create_local_qdrant_store, OpenAIEmbedding

store = create_local_qdrant_store(
    embedding=OpenAIEmbedding(),
    path="./qdrant_data",
)
```

| Parameter | Type | Description |
|---|---|---|
| `embedding` | `BaseEmbedding` | The embedding service. |
| `path` | `str` | Local directory path for Qdrant persistence. |
| `collection` | `str \| Callable[[dict], str]` | Default collection: a name or a function of the config. Default `"agentflow_memories"`. |
| `**kwargs` | `Any` | Passed to `QdrantStore`. |

**Returns:** A configured `QdrantStore` instance.

### `create_remote_qdrant_store(host, port, embedding, collection=...)`

Create a `QdrantStore` connected to a remote Qdrant server.

```python
from tenxgraph.storage.store import create_remote_qdrant_store, OpenAIEmbedding

store = create_remote_qdrant_store(
    embedding=OpenAIEmbedding(),
    host="localhost",
    port=6333,
)
```

| Parameter | Type | Description |
|---|---|---|
| `embedding` | `BaseEmbedding` | The embedding service. |
| `host` | `str` | Remote host address. |
| `port` | `int` | Remote server port. Required (typically 6333). |
| `collection` | `str \| Callable[[dict], str]` | Default collection: a name or a function of the config. Default `"agentflow_memories"`. |
| `**kwargs` | `Any` | Passed to `QdrantStore`. |

**Returns:** A configured `QdrantStore` instance.

### `create_cloud_qdrant_store(url, api_key, embedding, collection=...)`

Create a `QdrantStore` connected to Qdrant Cloud.

```python
from tenxgraph.storage.store import create_cloud_qdrant_store, OpenAIEmbedding

store = create_cloud_qdrant_store(
    embedding=OpenAIEmbedding(),
    url="https://xyz.qdrant.io",
    api_key="<your-qdrant-api-key>",
)
```

| Parameter | Type | Description |
|---|---|---|
| `embedding` | `BaseEmbedding` | The embedding service. |
| `url` | `str` | Qdrant Cloud cluster URL. |
| `api_key` | `str` | Qdrant Cloud API key. |
| `collection` | `str \| Callable[[dict], str]` | Default collection: a name or a function of the config. Default `"agentflow_memories"`. |
| `**kwargs` | `Any` | Passed to `QdrantStore`. |

**Returns:** A configured `QdrantStore` instance.

### `create_mem0_store(config, user_id="default_user", app_id="agentflow_app")`

Create a `Mem0Store` with custom configuration.

```python
from tenxgraph.storage.store import create_mem0_store

store = create_mem0_store(config={
    "llm": {"provider": "openai", "config": {"model": "gpt-4o-mini"}},
    "embedder": {"provider": "openai", "config": {"model": "text-embedding-3-small"}},
    "vector_store": {"provider": "qdrant", "config": {"host": "localhost", "port": 6333}},
})
```

| Parameter | Type | Description |
|---|---|---|
| `config` | `dict` | Mem0 configuration with llm, embedder, and vector_store sections. |
| `user_id` | `str` | Accepted but not used by `Mem0Store`; pass `user_id` in each call's `config`. |
| `app_id` | `str` | Default app identifier. |

**Returns:** A configured `Mem0Store` instance.

### `create_mem0_store_with_qdrant(qdrant_url, ...)`

Create a `Mem0Store` backed by a Qdrant server, with OpenAI as the default LLM and embedder provider.

```python title="mem0_qdrant.py"
from tenxgraph.storage.store import create_mem0_store_with_qdrant

store = create_mem0_store_with_qdrant(
    qdrant_url="http://localhost:6333",
    llm_model="gpt-4o-mini",
)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `qdrant_url` | `str` | Required | Qdrant server URL. |
| `qdrant_api_key` | `str \| None` | None | Qdrant API key. |
| `collection_name` | `str` | `"agentflow_memories"` | Qdrant collection used by Mem0. |
| `embedding_model` | `str` | `"text-embedding-ada-002"` | Embedder model name. |
| `llm_model` | `str` | `"gpt-4o-mini"` | LLM model name. |
| `app_id` | `str` | `"agentflow_app"` | App identifier. |
| `**kwargs` | `Any` | | Optional `vector_store_config`, `embedder_provider`, `embedder_config`, `llm_provider`, `llm_config`. |

**Returns:** A configured `Mem0Store` instance.

---|---|---|
| `embedding` | `BaseEmbedding` | The embedding service. |
| `llm_model` | `str` | OpenAI model to use for Mem0. |
| `qdrant_path` | `str` | Local path for the embedded Qdrant server. |

**Returns:** A configured `Mem0Store` instance.

---

## Wiring into Agent memory

Pass a `MemoryConfig` to the `Agent` and the same store to `graph.compile`. With `PRELOAD` the agent searches memory itself before each call; with `POSTLOAD` it needs a `ToolNode` so the memory tools can be registered.

```python title="agent_with_memory.py"
from tenxgraph.core import Agent, StateGraph
from tenxgraph.core.state import AgentState
from tenxgraph.storage.store import MemoryConfig, OpenAIEmbedding, QdrantStore, ReadMode
from tenxgraph.utils.constants import END

store = QdrantStore(embedding=OpenAIEmbedding(), path="./qdrant_data")

agent = Agent(
    model="gpt-4o",
    memory=MemoryConfig(store=store, retrieval_mode=ReadMode.PRELOAD, limit=5),
)

graph = StateGraph(AgentState)
graph.add_node("MAIN", agent)
graph.set_entry_point("MAIN")
graph.add_edge("MAIN", END)

app = graph.compile(store=store)  # the store is injected into memory tools and nodes
```

Memory is scoped by the `user_id` you pass in the invoke `config`. See [Use a memory store](/docs/guides/use-memory-store) for a full run.

---

## Direct store usage in nodes

A node can call the store directly through dependency injection, for example to write custom memory logic.

```python title="remember_node.py"
from injectq import Inject

from tenxgraph.core.state import AgentState
from tenxgraph.storage.store import BaseStore
from tenxgraph.storage.store.store_schema import MemoryType, RetrievalStrategy

async def remember_node(
    state: AgentState,
    config: dict,
    store: BaseStore = Inject[BaseStore],
) -> list:
    text = state.context[-1].text()

    # Retrieve relevant memories
    memories = await store.asearch(
        config={"user_id": config.get("user_id")},
        query=text,
        memory_type=MemoryType.EPISODIC,
        retrieval_strategy=RetrievalStrategy.SIMILARITY,
        limit=5,
    )
    context = "\n".join(m.content for m in memories)  # use this in a prompt or state

    # Store the user's latest message as a memory
    await store.astore(
        config={"user_id": config.get("user_id")},
        content=text,
        memory_type=MemoryType.EPISODIC,
    )

    return []   # no new messages; state enriched by memories above
```

The `store` parameter is injected when you pass `store=` to `graph.compile()`.

---

## Common errors

| Error | Cause | Fix |
|---|---|---|
| `ImportError: qdrant-client package is required for QdrantStore` | `qdrant-client` is not installed. | `pip install "10xgraph[qdrant]"`. |
| `ImportError: mem0 package is required for Mem0Store` | `mem0ai` is not installed. | `pip install "10xgraph[mem0]"`. |
| `ValueError: OpenAI API key must be provided...` | No `api_key` and no `OPENAI_API_KEY`. | Set the variable or pass `api_key`. |
| `ValueError: user_id is required for memory operations; use system_user_id(name) for shared data` | A store call has a missing, `None`, empty or blank `user_id`. | Put the user's id in the `config` dict, or `system_user_id(name)` for shared data. See [The `user_id` rule](#the-user_id-rule-and-system_user_id). |
| `RuntimeError: Memory requires an existing ToolNode...` | `Agent(memory=...)` in `POSTLOAD` mode without a tool node. | Pass `tool_node=` or use `PRELOAD`. |
| `NotImplementedError` from `asetup` | Called `asetup()` on `Mem0Store`. | Only `QdrantStore` implements it. |
