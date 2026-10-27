---
title: How to use the memory store
description: Guide to using QdrantStore and Mem0Store for long-term vector memory, factory helpers, and enabling agent-level memory with MemoryConfig.
section: "Build agents"
group: "State, memory and context"
order: 250
label: Memory store
updated: "2026-10-27"
---

## What the memory store solves

As your agent runs across many threads and user sessions, it accumulates conversation history in a checkpointer. But conversation history alone doesn't retain knowledge that should persist across all future interactions: user preferences, learned facts, domain expertise, or semantic relationships between entities.

The memory store is a separate, persistent vector database that holds this long-term knowledge independently of any single thread or conversation. Unlike the checkpointer (which preserves conversation history per thread), the memory store is **global**: facts written to it are accessible in future conversations with the same user, across different topics, and over weeks or months.

This guide shows you how to set up a memory store, integrate it with your agent, and use it to deliver personalized, contextually aware experiences.

## Memory store vs. checkpointer

These two components work together but serve different purposes:

| Component | Scope | Lifetime | Use case |
|---|---|---|---|
| **Checkpointer** | Per-thread | Conversation duration | Remembers conversation history within a single chat session; enables resuming interrupted runs. |
| **Memory store** | Global | Cross-thread, persistent | Stores user preferences, facts, and learned knowledge that should inform future conversations. |

Example: a customer support agent uses the checkpointer to recall "we discussed issue X earlier in this chat," and the memory store to recall "this customer always prefers phone support over email."

---

## Choosing a store implementation

10xGraph provides two production-ready memory store implementations. Both implement the `BaseStore` interface and work with the same `MemoryConfig` API.

### QdrantStore

**Best for:** Self-hosted or cloud vector database deployments, full control over infrastructure, hybrid retrieval strategies.

Qdrant is an open-source, high-performance vector database optimized for similarity search. You can run it locally (file-backed), self-hosted (server), or on Qdrant Cloud.

**Trade-offs:**
- More operational overhead (Qdrant server management)
- More flexible configuration (distance metrics, retrieval strategies, chunking)
- Excellent performance at scale
- No vendor lock-in

### Mem0Store

**Best for:** Managed, serverless memory experiences, minimal operations, batteries-included setup.

Mem0 is a managed memory platform that abstracts away vector database operations. It provides automatic memory consolidation, deduplication, and retrieval.

**Trade-offs:**
- Third-party dependency and service terms
- Less control over vector search internals
- Easier to start and maintain
- Built-in memory cleanup and optimization

Choose based on your infrastructure preferences. For this guide, we'll show both; they are interchangeable in your agent code.

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

The three factories above (`create_local_qdrant_store`, `create_remote_qdrant_store`, `create_cloud_qdrant_store`) all construct a `QdrantStore` internally. Use them for clarity and because they provide sensible defaults. If you need fine-grained control, construct `QdrantStore` directly:

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

## Setting up Mem0Store

### Install the package

```bash
pip install "10xgraph[mem0]"
```

The Mem0 examples below use OpenAI models, so set `OPENAI_API_KEY`.

### Mem0 with OpenAI LLM

Mem0 uses its own configuration format to specify the LLM and vector store.

```python
from tenxgraph.storage.store import (
    Mem0Store,
    create_mem0_store,
)

store = create_mem0_store(
    config={
        "llm": {
            "provider": "openai",
            "config": {"model": "gpt-4o-mini"}
        }
    },
    user_id="default_user",
    app_id="support_app",
)
```

### Mem0 backed by your own Qdrant

You can combine Mem0's memory consolidation with your own Qdrant infrastructure.

```python
from tenxgraph.storage.store import create_mem0_store_with_qdrant

store = create_mem0_store_with_qdrant(
    qdrant_url="https://abc123-ef45.qdrant.io",
    qdrant_api_key="your-api-key",
    collection_name="mem0_collection",
    app_id="support_app",
)
```

---

## Embedding options

Both `QdrantStore` and `Mem0Store` need an embedding function to convert text to vectors. Choose based on your API keys and preferences.

| Class | Provider | Model | Env var required |
|---|---|---|---|
| `OpenAIEmbedding` | OpenAI | `text-embedding-3-small` | `OPENAI_API_KEY` |
| `GoogleEmbedding` | Google | `gemini-embedding-001` | `GOOGLE_API_KEY` or `GEMINI_API_KEY` |

```python
from tenxgraph.storage.store import OpenAIEmbedding, GoogleEmbedding

openai_embed = OpenAIEmbedding()
google_embed = GoogleEmbedding()

# Then pass to your store:
# store = QdrantStore(embedding=openai_embed, path="./qdrant_data")
```

Pass `model=` and `api_key=` to either class to override the default model or the environment variable. Use the same embedding model for writing and searching a collection.

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

Every store call needs a non-empty `user_id` in `config`. A missing or blank one raises `ValueError`. Reads under the admin authz scope `"none"` skip the user filter; writes and `aforget_memory` never do. For shared data with no user, use `system_user_id(name)` from `tenxgraph.storage`. See the [Memory stores reference](/docs/reference/python/memory-stores#the-user_id-rule-and-system_user_id).

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

The agent now gets a `user_memory_tool` it can call to search and save user facts, and a short memory instruction is added to its system prompt. With `ReadMode.PRELOAD` no tools are added, so no ToolNode is needed.

### Full MemoryConfig reference

For finer control, configure each memory scope separately:

```python
from tenxgraph.storage.store import (
    MemoryConfig,
    UserMemoryConfig,
    AgentMemoryConfig,
    ReadMode,
)

memory = MemoryConfig(
    store=store,                              # required: BaseStore instance
    retrieval_mode=ReadMode.POSTLOAD,         # POSTLOAD (default) | PRELOAD | NO_RETRIEVAL
    limit=5,                                  # max memories to retrieve per search
    score_threshold=0.0,                      # minimum similarity score (must be >= 0)
    max_tokens=None,                          # cap total tokens across all memories
    inject_system_prompt=True,                # add memory instructions to the system prompt

    user_memory=UserMemoryConfig(
        enabled=True,
        memory_type="semantic",               # EPISODIC | SEMANTIC | PROCEDURAL | ENTITY | RELATIONSHIP | DECLARATIVE | CUSTOM
        category="preferences",               # arbitrary label for grouping
        user_id=None,                         # override; falls back to config["user_id"]
        limit=5,
        score_threshold=0.6,
    ),

    agent_memory=AgentMemoryConfig(
        enabled=False,                        # disabled by default
        memory_type="semantic",
        category="knowledge",
        agent_id="my-agent",                  # groups memories by agent
        app_id="my-app",                      # groups memories by application
    ),
)

agent = Agent(model="gpt-4o", tool_node=ToolNode([]), memory=memory)
```

### ReadMode: how the agent uses memories

| Mode | Behaviour |
|---|---|
| `ReadMode.POSTLOAD` (default) | Memories are fetched on-demand via injected tools that the LLM can call. The model decides **when** and **what** to retrieve. Gives the model more agency but requires the model to recognize when memories are relevant. |
| `ReadMode.PRELOAD` | Memories are retrieved automatically once per invocation (not on every model call; a tool loop reuses the same block), using the latest user message as the query, and added to the latest user message as a fenced `<user_memories_...>` block for that request only (it is not saved in the thread). See [Why memories are not system text](/docs/concepts/memory-and-store#why-memories-are-not-system-text). The model always has relevant context but uses more tokens. No memory tools are exposed, so the model cannot save new memories in this mode. |
| `ReadMode.NO_RETRIEVAL` | No automatic retrieval. |

### UserMemoryConfig vs. AgentMemoryConfig

- **AgentMemoryConfig data is shared.** It is always read under `system_user_id(agent_id)` (or `system_user_id(app_id)` when there is no `agent_id`), so seed it with `await store.astore({"user_id": system_user_id("my-agent")}, "...")` (`from tenxgraph.storage import system_user_id`). Enabling it with neither `agent_id` nor `app_id` raises `ValueError`.
- **UserMemoryConfig:** Scoped to a single user (`user_id`). The agent can both **read and write** user memories. Use this for user preferences, learned facts about the user, and conversation summaries.
- **AgentMemoryConfig:** Scoped to the agent/application. The agent can **only read** agent memories. Use this for shared domain knowledge, FAQs, and system facts that should not be modified by user interactions.

### Keep kinds of data in separate collections

Both configs take a `collection` (a name, or a function of the run config) that always wins over any other setting, and the `QdrantStore` default can be a name or a function too. A client can never pick a collection: the API ignores `collection` in client config. For example, keep agent memory in its own collection:

```python
AgentMemoryConfig(enabled=True, agent_id="support-bot", collection="agent_notes")
```

For the precedence rules and a collection per company, see [Collections: keeping data apart](/docs/concepts/memory-and-store#collections-keeping-data-apart).

---

## MemoryType and DistanceMetric enums

When configuring `UserMemoryConfig` or `AgentMemoryConfig`, specify the `memory_type` to categorize what kind of knowledge you're storing. Similarly, `DistanceMetric` controls how vector similarity is calculated.

### MemoryType values

```python
from tenxgraph.storage.store import MemoryType

MemoryType.EPISODIC       # Conversation events, session notes, "what happened"
MemoryType.SEMANTIC       # Facts, user preferences, "what is true"
MemoryType.PROCEDURAL     # How-to knowledge, step-by-step processes, "how to do it"
MemoryType.ENTITY         # Information about people, places, organizations
MemoryType.RELATIONSHIP   # How entities relate to each other
MemoryType.DECLARATIVE    # Explicit stated facts and declarations
MemoryType.CUSTOM         # Domain-specific memory types
```

### DistanceMetric values

```python
from tenxgraph.storage.store import DistanceMetric

DistanceMetric.COSINE        # Default; best for text embeddings
DistanceMetric.EUCLIDEAN     # Absolute vector distances; good for dense, normalized embeddings
DistanceMetric.DOT_PRODUCT   # Normalized vectors in high-dimensional spaces
DistanceMetric.MANHATTAN     # L1 distance; rarely used for embeddings
```

Use `DistanceMetric.COSINE` unless you have a specific reason to use another metric.

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
    print("Agent:", result1["messages"][-1].content[:200])

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
    print("Agent:", result2["messages"][-1].content[:200])
    print("\nThe agent should have remembered the email preference from session 1.")

asyncio.run(main())
```

**Expected behavior:**
1. In the first interaction, the customer states a preference. In the default POSTLOAD mode the model decides whether to save it by calling the memory tool, so saving is not guaranteed.
2. In the second interaction (different thread, same user), the model can search user memory with the same `user_id` and use the preference.

---

## How to verify it worked

After running your agent with `MemoryConfig`, check that memories were stored:

1. **Check memory count:** Query the store directly to see how many memories are stored (stop the agent first, since local Qdrant allows one client per folder).

```python
# With Qdrant, you can inspect the collection
import qdrant_client

client = qdrant_client.QdrantClient(path="./qdrant_data")
collection = client.get_collection(collection_name="agentflow_memories")
print(f"Total vectors in store: {collection.points_count}")
```

2. **Search for a specific memory:** Verify that a memory you expect is retrievable.

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

## Common decisions and patterns

### When to use POSTLOAD vs. PRELOAD

- **POSTLOAD (default):** Use when the model should decide whether memories are relevant. Better for reasoning; the model calls memory tools when it needs them. Best for most agents.
- **PRELOAD:** Use when the model must always be aware of user context. Better for task-specific agents (e.g., a chatbot that always needs current preferences). Uses more tokens.

### Should I use UserMemoryConfig, AgentMemoryConfig, or both?

- **UserMemoryConfig only:** For user-centric systems (customer support, personal assistants, tutors). The agent learns and remembers about each user.
- **AgentMemoryConfig only:** For knowledge-centric systems (FAQ bots, knowledge bases). The agent has read-only access to shared facts.
- **Both:** Hybrid systems where the agent personalizes responses based on shared knowledge + user history. The agent reads both scopes but only writes to user memory.

### Choosing memory_type

Map your use case to a memory type:

- **EPISODIC:** "Customer mentioned they work in finance", a specific event or conversation fact.
- **SEMANTIC:** "Customer prefers email over phone", a persistent fact about preferences.
- **PROCEDURAL:** "Steps to reset a password", domain processes.
- **ENTITY:** "John Smith, VP of Engineering at Acme Corp", structured facts about people/organizations.
- **DECLARATIVE:** "Our return policy is 30 days", company policies or rules.

---

## Run it in production

Pass the store the server should use through the `store` key in `10xgraph.json`. Scope every memory to the authenticated `user_id`: an empty `user_id` raises `ValueError`, and the reserved `system_user_id` namespaces are for your own shared data. See [Configure the server](/docs/server/configure) and the [Security model](/docs/production/security-model).

## Next steps

- [Set up checkpointing](/docs/guides/set-up-checkpointing) to persist conversation history across threads.
- [Use dependency injection](/docs/guides/use-dependency-injection) to access the store in custom nodes and tools.
- [Configure the Agent](/docs/guides/configure-agent) for the full list of `Agent` constructor options.
- [Use prebuilt agents](/docs/guides/prebuilt-agents) for ready-made agents that support `memory` out of the box.
