---
title: How to use the memory store
description: Guide to using PgVectorStore and QdrantStore for long-term memory, factory helpers, and enabling agent-level memory with MemoryConfig.
section: "Data and state"
group: "Long-term memory"
order: 30
label: Memory store
updated: "2026-11-26"
---

This guide sets up a long-term memory store, connects it to a graph and turns on agent memory with `MemoryConfig`. For what the store is and how it differs from the checkpointer, see [Long-term memory](/docs/concepts/memory-and-store).

---


## Choose a store

Both stores implement `BaseStore` and take the same `MemoryConfig`. Use `PgVectorStore` to keep memory in the Postgres you already run for checkpoints, with text and hybrid search and your own tenant columns. Use `QdrantStore` for a separate vector database (local file, server or Qdrant Cloud); it supports `SIMILARITY` search only, and `TEXT` and `HYBRID` raise.

---

## Setting up QdrantStore

### Install the package

```bash
pip install "10xgraph[qdrant,openai]"
```

The `qdrant` extra needs `qdrant-client` 1.10.0 or newer. If you run a Qdrant server or use Qdrant Cloud, it must be version 1.10 or newer.

You also need an embedding service to convert text to vectors. Both OpenAI and Google embeddings are built in; we show OpenAI here (use the `google-genai` extra for `GoogleEmbedding`).

### Local Qdrant (file-backed)

Best for development and single-machine deployments. No external server needed.

```python
from tenxgraph.storage.store import (
    QdrantStore,
    OpenAIEmbedding,
    create_local_qdrant_store,
)

# Create a local, file-backed Qdrant store
store = create_local_qdrant_store(
    path="./qdrant_data",
    embedding=OpenAIEmbedding(),  # uses OPENAI_API_KEY env var
    collection="my_agent_memory",
)

# The store is now ready to use
```

The store creates a `./qdrant_data` folder on your machine. Each collection is persisted there; when you restart your agent, the memories are still available.

### Remote Qdrant server

For a team or production environment running a shared Qdrant server.

```python
from tenxgraph.storage.store import (
    create_remote_qdrant_store,
    OpenAIEmbedding,
)

store = create_remote_qdrant_store(
    host="qdrant.example.com",
    port=6333,
    embedding=OpenAIEmbedding(),
    collection="my_agent_memory",
)
```

### Qdrant Cloud

For fully managed, serverless Qdrant.

```python
from tenxgraph.storage.store import (
    create_cloud_qdrant_store,
    GoogleEmbedding,
)

store = create_cloud_qdrant_store(
    url="https://abc123-ef45.qdrant.io",
    api_key="your-qdrant-cloud-api-key",
    embedding=GoogleEmbedding(),  # uses GOOGLE_API_KEY or GEMINI_API_KEY
    collection="my_agent_memory",
)
```

Get your Qdrant Cloud URL and API key from the Qdrant Cloud dashboard.

### Factory functions

The three factories above (`create_local_qdrant_store`, `create_remote_qdrant_store`, `create_cloud_qdrant_store`) all construct a `QdrantStore` internally. If you need fine-grained control, construct `QdrantStore` directly:

```python
from tenxgraph.storage.store import (
    QdrantStore,
    OpenAIEmbedding,
    DistanceMetric,
)

store = QdrantStore(
    embedding=OpenAIEmbedding(),
    path="./qdrant_data",                      # local: provide path
    # OR:
    # host="localhost",                        # remote: provide host + port
    # port=6333,
    # OR:
    # url="https://...",                       # cloud: provide url + api_key
    # api_key="...",
    collection="my_custom_collection",
    distance_metric=DistanceMetric.COSINE,     # COSINE | EUCLIDEAN | DOT_PRODUCT | MANHATTAN
)
```

---

## Setting up PgVectorStore

```bash
pip install "10xgraph[pgvector,openai]"
```

```python
from tenxgraph.storage.store import OpenAIEmbedding, PgVectorStore

store = PgVectorStore(
    embedding=OpenAIEmbedding(),  # uses OPENAI_API_KEY
    dsn="postgresql://user:pass@localhost:5432/app",
)
await store.asetup()  # creates the extension, table and indexes
```

Use the same DSN as your `PgCheckpointer` to keep everything in one database. Pass `embedding=None` for a text-only store that needs no embedding provider. Search strategies, per-level settings, embedding fallback and the table layout are in [How to use PgVectorStore](/docs/guides/use-pgvector-store). To isolate organizations or add your own columns, see [Multi-tenant data](/docs/guides/multi-tenant-data).

---

## Embeddings

`OpenAIEmbedding()` (default `text-embedding-3-small`, reads `OPENAI_API_KEY`) and `GoogleEmbedding()` (default `gemini-embedding-001`, reads `GOOGLE_API_KEY` or `GEMINI_API_KEY`) are built in. Pass `model=` or `api_key=` to override them, and `base_url=` for a compatible endpoint. Use the same model for writing and searching a collection. See [Embeddings](/docs/reference/python/memory-stores#embeddings).

---

## Connecting the store to your graph

Once you've created your store, pass it to `graph.compile()`:

```python
from tenxgraph.core.graph import StateGraph, Agent

# ... build your graph ...

app = graph.compile(
    checkpointer=checkpointer,
    store=store,  # <-- pass the store here
)
```

Inside your nodes and tools, access the store via dependency injection:

```python
from tenxgraph.storage.store import BaseStore
from tenxgraph.utils import tool

@tool
async def my_tool(config: dict, store: BaseStore):
    """Access memories within a tool."""
    results = await store.asearch(config, "user preferences", limit=3)
    for result in results:
        print(result.content)
```

The `store` and `config` parameters are injected by name and hidden from the model; no manual wiring needed. `asearch` takes the run `config` first (it carries `user_id`), then the query.

Every store call needs a non-empty `user_id` in `config`. A missing or blank one raises `ValueError`. Reads by an identity with reach `all` skip the user filter; writes and `aforget_memory` never do. For shared data with no user, use `system_user_id(name)` from `tenxgraph.storage`. See the [Memory stores reference](/docs/reference/python/memory-stores#the-user_id-rule-and-system_user_id).

---

## Agent-level memory with MemoryConfig

For the most common case, automatically retrieving and writing user-specific memories during LLM calls, use `MemoryConfig` on the `Agent` node.

### Minimal setup

```python
from tenxgraph.core.graph import Agent, ToolNode
from tenxgraph.storage.store import (
    MemoryConfig,
    create_local_qdrant_store,
    OpenAIEmbedding,
)

# Create a store
store = create_local_qdrant_store("./qdrant_data", OpenAIEmbedding())

# Create an agent with memory. The default POSTLOAD mode registers memory tools,
# so the Agent needs a ToolNode (route to it as in "Build a graph").
tool_node = ToolNode([])
agent = Agent(
    model="gpt-4o",
    tool_node=tool_node,
    memory=MemoryConfig(store=store),
)
```

The agent now gets a `user_memory_tool` it can call to search and save user facts, and a short memory instruction is added to its system prompt. With `ReadMode.PRELOAD` the search runs before the call, but the model still gets `user_memory_tool` to remember and forget, so it needs a ToolNode too. Only `ReadMode.NO_RETRIEVAL` adds no tools.

### Configure each scope

Each scope takes its own settings, which win over the `MemoryConfig` values:

```python
from tenxgraph.storage.store import AgentMemoryConfig, MemoryConfig, UserMemoryConfig

memory = MemoryConfig(
    store=store,
    user_memory=UserMemoryConfig(category="preferences", score_threshold=0.6),
    agent_memory=AgentMemoryConfig(enabled=True, agent_id="support-bot"),
)
agent = Agent(model="gpt-4o", tool_node=ToolNode([]), memory=memory)
```

Every field and default is in the [MemoryConfig reference](/docs/reference/python/memory-stores#memoryconfig).

`retrieval_mode` picks when memories reach the model: `POSTLOAD` (default, the model searches with a tool), `PRELOAD` (searched once per invocation and added to the user message) or `NO_RETRIEVAL`. See [Retrieval modes](/docs/concepts/memory-and-store#retrieval-modes-when-do-memories-reach-the-llm).

### Seed shared agent memory

`AgentMemoryConfig` data is shared. It is always read under `system_user_id(agent_id)` (or `system_user_id(app_id)` when there is no `agent_id`), so seed it with `await store.astore({"user_id": system_user_id("my-agent")}, "...")` (`from tenxgraph.storage import system_user_id`). Enabling it with neither `agent_id` nor `app_id` raises `ValueError`.

### Keep kinds of data in separate collections

Both configs take a `collection` (a name, or a function of the run config) that always wins over any other setting, and the `QdrantStore` default can be a name or a function too. A client can never pick a collection: the API ignores `collection` in client config. For example, keep agent memory in its own collection:

```python
AgentMemoryConfig(enabled=True, agent_id="support-bot", collection="agent_notes")
```

For the precedence rules and a collection per company, see [Collections: keeping data apart](/docs/concepts/memory-and-store#collections-keeping-data-apart).

### Trusted-only retrieval and expiry

```python
from datetime import timedelta

from tenxgraph.storage.store import TRUSTED_ORIGINS

memory = MemoryConfig(store=store, origins=list(TRUSTED_ORIGINS), ttl=timedelta(days=90))
```

`origins` reads back only memories written by the user or the system, not the ones the model saved itself. `ttl` expires what the model remembers after 90 days. See [Memory origin and expiry](/docs/concepts/memory-and-store#memory-origin-and-expiry).

---

## Complete example: memory-aware customer support agent

Install with `pip install "10xgraph[qdrant,openai]"` and set `OPENAI_API_KEY`. Here's a runnable example that builds a customer support agent, talks to a customer twice (with different threads), and shows how memories persist across threads:

```python
import asyncio
from tenxgraph.core.graph import StateGraph, Agent, ToolNode
from tenxgraph.core.state import Message
from tenxgraph.storage.checkpointer import InMemoryCheckpointer
from tenxgraph.storage.store import (
    MemoryConfig,
    UserMemoryConfig,
    create_local_qdrant_store,
    OpenAIEmbedding,
    MemoryType,
)
from tenxgraph.utils import END

# Step 1: Create the memory store
store = create_local_qdrant_store(
    "./qdrant_data",
    OpenAIEmbedding(),
)

# Step 2: Configure agent-level memory for user preferences
memory = MemoryConfig(
    store=store,
    user_memory=UserMemoryConfig(
        enabled=True,
        memory_type="semantic",
        category="customer_preferences",
        limit=5,
        score_threshold=0.6,
    ),
)

# Step 3: Create an agent that uses memory
system_prompt = [
    {
        "role": "system",
        "content": (
            "You are a helpful customer support agent. "
            "Use the memory tool to look up and save customer preferences."
        ),
    }
]

tool_node = ToolNode([])  # the memory tool is registered here
agent = Agent(
    model="gpt-4o",
    system_prompt=system_prompt,
    tool_node=tool_node,
    memory=memory,
)

# Step 4: Build the graph (agent <-> tools loop)
def route(state) -> str:
    last = state.context[-1] if state.context else None
    if last and last.role == "assistant" and getattr(last, "tools_calls", None):
        return "tools"
    return END

graph = StateGraph()
graph.add_node("support", agent)
graph.add_node("tools", tool_node)
graph.add_conditional_edges("support", route, {"tools": "tools", END: END})
graph.add_edge("tools", "support")
graph.set_entry_point("support")

# Step 5: Compile with the store
app = graph.compile(
    checkpointer=InMemoryCheckpointer(),
    store=store,
)

async def main():
    # First interaction: customer shares a preference
    print("=== First conversation ===")
    result1 = await app.ainvoke(
        {
            "messages": [
                Message.text_message(
                    "Hi, I need help with my order. Also, I prefer email support over phone calls."
                )
            ]
        },
        config={
            "thread_id": "customer-123-session-1",
            "user_id": "customer-123",
        },
    )
    print("Agent:", result1["messages"][-1].text()[:200])

    # Second interaction: different thread, same user
    # The agent should remember the email preference without being told again
    print("\n=== Second conversation (different thread, same user) ===")
    result2 = await app.ainvoke(
        {
            "messages": [
                Message.text_message("It's me again. Can you help with another issue?")
            ]
        },
        config={
            "thread_id": "customer-123-session-2",  # <-- different thread
            "user_id": "customer-123",              # <-- same user
        },
    )
    print("Agent:", result2["messages"][-1].text()[:200])
    print("\nThe agent should have remembered the email preference from session 1.")

asyncio.run(main())
```

**Expected behavior:**
1. In the first interaction, the customer states a preference. In the default POSTLOAD mode the model decides whether to save it by calling the memory tool, so saving is not guaranteed.
2. In the second interaction (different thread, same user), the model can search user memory with the same `user_id` and use the preference.

---

## How to verify it worked

After running your agent with `MemoryConfig`, check that memories were stored:

1. **Search for a specific memory:** Verify that a memory you expect is retrievable.

```python
results = await store.asearch(
    {"user_id": "customer-123"},
    "email preference",
    limit=3,
)
for result in results:
    print(f"Score: {result.score:.2f}, Content: {result.content}")
```

---

## Run it in production

Pass the store the server should use through the `store` key in `10xgraph.json`. Scope every memory to the authenticated `user_id`: an empty `user_id` raises `ValueError`, and the reserved `system_user_id` namespaces are for your own shared data. See [Configure the server](/docs/server/configure) and the [Security model](/docs/production/security-model).

## Next steps

- [How to use PgVectorStore](/docs/guides/use-pgvector-store) for search strategies, embedding fallback and the table layout.
- [Multi-tenant data](/docs/guides/multi-tenant-data) to isolate organizations and add your own columns.
- [Set up checkpointing](/docs/guides/set-up-checkpointing) to persist conversation history across threads.
- [Use dependency injection](/docs/guides/use-dependency-injection) to access the store in custom nodes and tools.
- [Configure the Agent](/docs/guides/configure-agent) for the full list of `Agent` constructor options.
- [Use prebuilt agents](/docs/guides/prebuilt-agents) for ready-made agents that support `memory` out of the box.
