---
title: Memory Tools
seoTitle: "Memory tools for long-term agent memory"
description: user_memory_tool and agent_memory_tool give an Agent long-term memory to search and remember facts across conversations, enabled with MemoryConfig.
section: "Build agents"
group: "Tools and MCP"
order: 200
label: Memory Tools
updated: "2026-10-27"
---

10xGraph memory tools give agents long-term memory: facts and preferences that persist across conversations and threads. Your agent can search what it has learned about users and save new observations. Both tools use semantic search, so the agent finds relevant information by meaning, not by keyword.

There is one way to turn memory on: pass `memory=MemoryConfig(...)` to the `Agent` (or `ReactAgent`). The Agent creates the tools for you. The older general-purpose `memory_tool` and the graph-level `MemoryIntegration` were removed.

**Import path:** `tenxgraph.storage.store` for `MemoryConfig`, `UserMemoryConfig` and `AgentMemoryConfig`.

## Which tool to use

| Tool | When to use | Enabled by | Operations |
|---|---|---|---|
| `user_memory_tool` | Memory scoped to individual users | `MemoryConfig(user_memory=...)`; on by default | search, remember |
| `agent_memory_tool` | Read-only, application-wide memory (for example a knowledge base or policies) | `MemoryConfig(agent_memory=AgentMemoryConfig(enabled=True, ...))` | search only |

Both tools need a store (for example Qdrant or Mem0) that supports semantic search. Pass it to `MemoryConfig(store=...)` or to `compile(store=...)`. The Agent registers the tools on its `ToolNode` only when `MemoryConfig.retrieval_mode` is `postload` (the default for `MemoryConfig`). With `preload`, there are no memory tools: the Agent searches once per invocation and adds the memories to the latest user message as a fenced block (see [Why memories are not system text](/docs/concepts/memory-and-store#why-memories-are-not-system-text)). With `no_retrieval`, the model has no memory tools and nothing is injected.

## How memory works

Writes run asynchronously in the background. When the agent calls `remember`, the tool returns `{"status": "scheduled", "action": "remember"}` immediately, and the write happens later without blocking the conversation. Searches flush any pending writes first, so results reflect the latest data.

Deduplication is by similarity: if the new text is nearly identical to an existing memory (score 0.95 or higher), the write is skipped. The model never provides memory ids or keys.

Both tools return JSON. A search returns a list of results, for example `[{"id": "...", "content": "...", "score": 0.95, "memory_type": "episodic", "metadata": {}}]`. Errors look like `{"error": "..."}`, for example "user memory is disabled", "no user memory store configured" or "text is required".

---

## `user_memory_tool`, user-scoped memory via Agent config

When you enable user memory in an Agent, the `user_memory_tool` is registered automatically. You do not need to instantiate it yourself. The tool enforces one scope (one user) and one permission model: the LLM can search and write, but not update or delete. User memory is enabled by default in `MemoryConfig`.

### Operations

| Action | Required parameters | Description |
|---|---|---|
| `search` | `text` | Search for user-scoped memories. Returns up to `limit` results. |
| `remember` | `text` | Save a new user fact or preference. Near-identical text is skipped by the similarity check. |

### Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `action` | `str` | `"search"` | One of `search` or `remember`. |
| `text` | `str` | `""` (required in practice) | For `search`, the query text. For `remember`, the text to save. Supports natural language. |
| `memory_type` | `str` | inherited | Override the configured memory type (e.g. `"episodic"`, `"semantic"`). If not set, uses the type from `UserMemoryConfig`. |
| `category` | `str` | inherited | Override the configured category. If not set, uses the category from `UserMemoryConfig`. |
| `limit` | `int` | inherited | Override the configured result limit. If not set, uses the limit from `UserMemoryConfig`. |

### Setup

Enable user memory in an Agent by passing a `MemoryConfig` with `user_memory` enabled:

```python
# pip install "10xgraph[openai,qdrant]"
from tenxgraph.prebuilt.agent import ReactAgent
from tenxgraph.storage.store.memory_config import MemoryConfig, UserMemoryConfig
from tenxgraph.storage import create_local_qdrant_store
from tenxgraph.storage.store.embedding import OpenAIEmbedding

store = create_local_qdrant_store(
    path="./memory_db",
    embedding=OpenAIEmbedding(model="text-embedding-3-small"),
)

agent = ReactAgent(
    model="gpt-4o-mini",
    memory=MemoryConfig(
        store=store,
        user_memory=UserMemoryConfig(
            enabled=True,
            memory_type="semantic",  # e.g. facts and preferences
            category="user_profile",
            limit=10,  # return up to 10 results per search
        ),
    ),
    system_prompt=[{
        "role": "system",
        "content": "You remember details about each user. Use user_memory_tool to search and remember key facts.",
    }],
)

app = agent.compile(store=store)
```

Import `Message` from `tenxgraph.core.state` for the invoke call below. The `user_memory_tool` is now available to the LLM. It is scoped to the `user_id` from the run config at invocation (unless you set `UserMemoryConfig(user_id=...)`, which overrides it):

```python
result = await app.ainvoke(
    {"messages": [Message.text_message("What do you know about my preferences?")]},
    config={"thread_id": "t1", "user_id": "alice"},  # user_id determines memory scope
)
```

---

## `agent_memory_tool`, read-only application-wide memory

Agent memory is read-only and scoped to the agent or the entire application. Use it for policies, knowledge bases, or shared context that many users should be able to read but not modify.

### Operations

| Action | Parameters | Description |
|---|---|---|
| `search` | `query`, optional overrides | Semantic search over agent-scoped or app-scoped memories. Read-only; the LLM cannot write, update, or delete. |

### Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `query` | `str` | required | The search query. Supports natural language. |
| `memory_type` | `str` | inherited | Override the configured memory type. |
| `category` | `str` | inherited | Override the configured category. |
| `limit` | `int` | inherited | Override the configured result limit. |

### Setup

Agent memory is disabled by default. Enable it in an Agent by passing a `MemoryConfig` with `agent_memory=AgentMemoryConfig(enabled=True, ...)`. Specify either `agent_id` (memories shared across all instances of this agent) or `app_id` (memories shared across the entire application):

```python
# pip install "10xgraph[openai,qdrant]"
from tenxgraph.prebuilt.agent import ReactAgent
from tenxgraph.storage.store.memory_config import MemoryConfig, AgentMemoryConfig
from tenxgraph.storage import create_local_qdrant_store
from tenxgraph.storage.store.embedding import OpenAIEmbedding

store = create_local_qdrant_store(
    path="./memory_db",
    embedding=OpenAIEmbedding(model="text-embedding-3-small"),
)

agent = ReactAgent(
    model="gpt-4o-mini",
    memory=MemoryConfig(
        store=store,
        agent_memory=AgentMemoryConfig(
            enabled=True,
            agent_id="customer-support-v2",  # all instances of this agent share this memory
            memory_type="semantic",
            category="policies",
            limit=5,
        ),
    ),
    system_prompt=[{
        "role": "system",
        "content": "You have access to company policies. Use agent_memory_tool to look them up when answering customer questions.",
    }],
)

app = agent.compile(store=store)
```

The `agent_memory_tool` is now available to the LLM in read-only form. It searches shared memory, not a per-user scope. It always runs as the reserved owner `system_user_id(agent_id)` (here `"__system__:customer-support-v2"`; with no `agent_id` it uses the `app_id`), whichever user is chatting, so every user finds the same records and other agents do not.

Your own code writes that shared memory under the same owner:

```python
from tenxgraph.storage import system_user_id

await store.astore(
    config={"user_id": system_user_id("customer-support-v2"), "agent_id": "customer-support-v2", "thread_id": "customer-support-v2"},
    content="Refunds are accepted within 30 days with a receipt.",
    category="policies",
)
```

Records written under a real user's id are not found by `agent_memory_tool`. With `QdrantStore`, search filters by owner, `memory_type` and `category`. Each agent has its own owner, so agents with different `agent_id` values stay apart even in one collection. See the [Memory stores reference](/docs/reference/python/memory-stores#the-user_id-rule-and-system_user_id) for the full `user_id` rule.

```python
result = await app.ainvoke(
    {"messages": [Message.text_message("What is your return policy?")]},
    config={"thread_id": "t1", "user_id": "alice"},
)
# The agent can search agent memory (policies) but cannot modify it.
# "alice" does not matter here: agent memory is read as system_user_id("customer-support-v2").
```

---

## Setting up a vector store

Both memory tools require a vector store that supports semantic search. 10xGraph supports several backends.

**Qdrant (local or cloud):**

```python
from tenxgraph.storage import create_local_qdrant_store
from tenxgraph.storage.store.embedding import OpenAIEmbedding

store = create_local_qdrant_store(
    path="./memory_db",
    embedding=OpenAIEmbedding(model="text-embedding-3-small"),
)
```

Qdrant works offline in local mode. For production, `QdrantStore` also accepts `host`/`port` or `url` and `api_key` for a server or Qdrant Cloud. Install with `pip install "10xgraph[qdrant]"`.

**Mem0 (enterprise multi-agent memory):**

```python
from tenxgraph.storage import Mem0Store

store = Mem0Store(config=mem0_config)  # a mem0 MemoryConfig or an equivalent dict
```

`Mem0Store` takes a Mem0 configuration (`config`, plus an optional `app_id`) and delegates memory storage and embeddings to Mem0. Install with `pip install "10xgraph[mem0]"`.

Choose the embedding model based on your provider and token budget. `OpenAIEmbedding` defaults to `text-embedding-3-small`, and its `model` argument selects another OpenAI embedding model.

---

## Design patterns

**Search before write:** Your system prompt should encourage the agent to search memory at the start of a conversation and write important facts at the end. This gives continuity across threads.

**Scope memory by use case:** User memory (personal preferences, history) is separate from agent memory (policies, FAQs). Mix them when both types are relevant.

**Background writes don't block:** Write operations return immediately. If the agent asks "did you save that?", you can safely say yes; the actual persistence happens asynchronously. Your system prompt can reinforce this behavior.

---

## Related pages

- **Concept:** Long-term memory and how it complements thread checkpoints, see `/docs/concepts/memory-and-store`
- **Setup guide:** Choose and configure a vector store, see `/docs/guides/use-memory-store`
- **Reference:** Full API for `MemoryConfig` and store classes, see `/docs/reference/python/memory-stores`
