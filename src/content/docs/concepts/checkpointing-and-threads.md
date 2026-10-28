---
title: Checkpointing and Threads
description: How checkpointers save and restore conversation state across calls using thread IDs.
section: Concepts
order: 100
group: "Memory and reliability"
updated: "2026-10-27"
---

A **checkpointer** saves state as the graph runs and reloads it at the start of the next call for the same **thread**. `compile()` creates an `InMemoryCheckpointer` when you pass none, so state persists within one process but is lost on restart. Pass a durable checkpointer for anything that must survive. This enables multi-turn conversations where the agent remembers what happened before.

## Why checkpointing matters

Agent conversations typically span multiple requests: a user sends a message, the agent responds, the user asks a follow-up, and so on. Without a checkpointer, each invoke call has no access to the history. With one, the agent can recall prior messages, carry forward context, and maintain coherence across turns. This is essential for any real application.

Checkpointing also enables advanced workflows: pausing a run for human review (see [interrupts](/docs/concepts/interrupts)), replaying a conversation from a checkpoint, or auditing the exact state at each step.

## Threads and the config dict

A **thread** is a persistent conversation identified by a unique `thread_id`. Every checkpointer method accepts a `config` dict that identifies which thread to operate on:

```python
config = {
    "thread_id": "conv-abc123",   # required, identifies the conversation
    "user_id": "user-42",         # required by PgCheckpointer, scopes thread ownership
}
```

`thread_id` is the primary key for all state, message, and metadata operations. `user_id` scopes thread ownership in a multi-tenant deployment. `PgCheckpointer` enforces it by default (`enforce_user_isolation=True`), so one user cannot read another's threads; the other checkpointers enforce owner-only access only when the API server's authorization policy asks for it. Each user can have many threads; each thread persists independently until explicitly deleted. When you call the compiled graph from Python, you choose the `thread_id`. Behind the API server, the server picks the id of a new thread (see [`runs.thread_ids`](/docs/reference/api-cli/configuration#thread_ids)), and clients send it back to continue.

## How checkpointing works

When you invoke a graph with a `config` containing a `thread_id`, the checkpointer follows this lifecycle:

```mermaid
flowchart LR
  NewCall["invoke with config<br/>(thread_id)"] --> Check{Thread exists?}
  Check -->|no| CreateState["Create fresh<br/>AgentState"]
  Check -->|yes| LoadState["Load saved<br/>AgentState"]
  CreateState --> RunGraph["Run graph nodes<br/>(node outputs update state)"]
  LoadState --> RunGraph
  RunGraph --> SaveState["Save updated<br/>AgentState"]
  SaveState --> Return["Return result to caller"]
```

On the first invoke for a thread, a fresh `AgentState` is created. On subsequent invokes with the same `thread_id`, the prior state is loaded and the new input (e.g., a new user message) is merged in. After the graph finishes, the updated state is persisted. This happens automatically, you only pass the `thread_id` in the config.

## Attaching a checkpointer

Pass the checkpointer to `graph.compile()`:

```python
from tenxgraph.storage.checkpointer import InMemoryCheckpointer
from tenxgraph.core.state import AgentState, Message

checkpointer = InMemoryCheckpointer()
app = graph.compile(checkpointer=checkpointer)
```

Then provide `thread_id` in every call:

```python
config = {"thread_id": "session-1"}

# Turn 1
res = app.invoke(
    {"messages": [Message.text_message("What is 2 + 2?")]},
    config=config,
)

# Turn 2, same thread_id, resumes from saved state
res = app.invoke(
    {"messages": [Message.text_message("Now multiply that by 3.")]},
    config=config,
)
```

The checkpointer automatically loads the state from turn 1, appends the new message, runs the graph, and saves the result. You write no explicit load or save code.

## The three checkpointer implementations

10xGraph provides three checkpointer implementations, each with different persistence and scaling characteristics.

### InMemoryCheckpointer

`InMemoryCheckpointer` stores all state, messages, and metadata in Python dicts, protected by `asyncio.Lock` for thread safety. It is the simplest and fastest for a single process:

```python
from tenxgraph.storage.checkpointer import InMemoryCheckpointer

checkpointer = InMemoryCheckpointer()
app = graph.compile(checkpointer=checkpointer)
```

All data is lost when the process exits. Owner-only access applies only when the API server's authorization policy requests it.

**Pros:** Zero setup, no external dependencies, fast for development.

**Cons:** State lost on restart, cannot be shared across multiple workers or processes.

**Best for:** development, unit tests, short-lived single-process deployments, prototyping.

### SqliteCheckpointer

`SqliteCheckpointer` stores everything in a single SQLite `.db` file: state, messages, threads, and metadata. I/O is fully async via `aiosqlite`, with a persistent WAL-mode connection:

```python
from tenxgraph.storage.checkpointer import SqliteCheckpointer

# Defaults to ~/.10xgraph/checkpointer.db; ":memory:" for ephemeral
checkpointer = SqliteCheckpointer("agent_state.db")
app = graph.compile(checkpointer=checkpointer)
```

Data survives process restarts because it is written to disk. However, SQLite serializes writes, only one writer can be active at a time, so it does not scale to multiple workers or servers.

**Pros:** Durable, zero external dependencies (just a file), simple to deploy with a Python sidecar.

**Cons:** Single-writer serialization, owner-only access only under an authorization policy, scales poorly across workers.

**Best for:** client-side agents (desktop apps with Electron or Tauri), single-user CLI agents, edge deployments where each user has their own process and database.

Install the extra with:

```bash
pip install "10xgraph[sqlite_checkpoint]"
```

Call `await checkpointer.arelease()` at shutdown to clean up the connection.

### PgCheckpointer

`PgCheckpointer` uses a **dual-layer architecture**: PostgreSQL for durable state and message history, and Redis for a low-latency read cache. This design enables multi-worker production deployments:

```python
from tenxgraph.storage.checkpointer import PgCheckpointer

checkpointer = PgCheckpointer(
    postgres_dsn="postgresql://user:pass@localhost/mydb",
    redis_url="redis://localhost:6379/0",
)
await checkpointer.asetup()  # Migrate schema on first run
app = graph.compile(checkpointer=checkpointer)
```

On each read, the cache (Redis) is checked first. If missed, PostgreSQL is queried and the result is cached. Writes always go to both layers. The cache TTL (default 24 hours) is configurable with the `cache_ttl` keyword argument, in seconds.

Why two layers? Postgres alone would be too slow for high-frequency reads (e.g., a user repeatedly invoking the same agent over microseconds). Redis caches hot threads, avoiding Postgres round-trips. Cold threads (those not accessed recently) are still available in Postgres.

**Pros:** Durable, multi-worker and multi-tenant, cache layer for performance, handles concurrent writes gracefully.

**Cons:** Requires Postgres and Redis, more complex setup, external dependencies.

**Best for:** production multi-user SaaS, scaled-out deployments with multiple workers, any application needing durability and concurrency.

Install with:

```bash
pip install "10xgraph[pg_checkpoint]"
```

The schema is created automatically on the first call to `await checkpointer.asetup()`. See [guides/set-up-checkpointing](/docs/guides/set-up-checkpointing) for full configuration.

## Trade-offs and decision guide

Choosing the right checkpointer is a scaling decision:

| Criterion | InMemoryCheckpointer | SqliteCheckpointer | PgCheckpointer |
|---|---|---|---|
| State survives restart | No | Yes | Yes |
| Shared across multiple workers | No | No | Yes |
| Multi-tenant user scoping | Only under an API authorization policy | Only under an API authorization policy | Yes (via `user_id`, on by default) |
| External dependencies | None | None (single file) | PostgreSQL + Redis |
| Setup required | No | No | Yes (`asetup()`) |
| Read latency (cache-hit) | Fastest (in process) | Local disk | Redis round trip |
| Write throughput | Single-process | Single-writer | Multi-writer |
| Best for | Dev, tests | Client-side sidecar | Production multi-user |

**Start with InMemoryCheckpointer** while developing locally. When you need state to survive restarts, move to `SqliteCheckpointer` if you have a single process or a Python sidecar (e.g., desktop app). When you scale to multiple workers or need multi-tenant isolation, migrate to `PgCheckpointer`. The API is identical across all three, so this migration is straightforward.

## Checkpointing beyond the graph

Beyond automatic use during `invoke` and `stream`, you can interact with a checkpointer directly to query, modify, or clean thread data. This is useful for admin operations, migrations, or custom REST endpoints. The detailed method signatures and examples live in [reference/python/checkpointers](/docs/reference/python/checkpointers).

For API server users, thread data is also exposed over HTTP via the `/v1/threads` routes. See [server/invoke-and-stream](/docs/server/invoke-and-stream) and [reference/rest-api/threads](/docs/reference/rest-api/threads) for details.

## Checkpointing and the API server

When running your graph behind the 10xGraph API server, pass the checkpointer to `compile()` in the module that `agent` points at:

```python
# graph/react.py
from tenxgraph.storage.checkpointer import PgCheckpointer

checkpointer = PgCheckpointer(postgres_dsn="...", redis_url="...")
# Create the schema once from an async context: await checkpointer.asetup()

app = state_graph.compile(checkpointer=checkpointer)
```

The server uses the compiled graph's checkpointer for all requests. See [server/configure](/docs/server/configure) for details.

## Related concepts

- [Interrupts](/docs/concepts/interrupts): pause a run for human review, saved in a checkpoint
- [Memory and store](/docs/concepts/memory-and-store): long-term memory vs. short-term thread state
- [State and messages](/docs/concepts/state-and-messages): what is stored in a checkpoint
- [Durability and concurrency](/docs/guides/durability-and-concurrency): thread isolation and optimistic locking
- [Reference: checkpointers](/docs/reference/python/checkpointers): full API reference for all methods
