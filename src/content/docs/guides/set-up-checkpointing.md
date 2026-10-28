---
title: Set up checkpointing
description: "Choose and configure a checkpointer for state persistence: InMemoryCheckpointer for development, SqliteCheckpointer for client agents, or PgCheckpointer for production."
section: "Build agents"
group: "State, memory and context"
order: 230
label: Set up checkpointing
updated: "2026-10-26"
---

A checkpointer persists your graph state after every node so that multi-turn conversations can resume across separate requests, and interrupted executions can pick up where they left off. Without a checkpointer, every `invoke()` call starts fresh with an empty state. This guide shows you how to choose the right checkpointer for your deployment and configure it completely.

## Why you need a checkpointer

Graph state is in-memory by default. That is fine for testing or stateless APIs where each request stands alone, but breaks down as soon as you need memory across requests. A checkpointer writes the state to durable storage after each node, so the next `invoke()` on the same `thread_id` resumes from the last checkpoint instead of starting over.

Three checkpointers ship with 10xGraph, each suited to a different scale:

| Scenario | Use | Key feature |
|---|---|---|
| Local development and testing | `InMemoryCheckpointer` | Fast, zero setup, state lost on restart |
| Client-side agents (Tauri, Electron, CLI) | `SqliteCheckpointer` | Single `.db` file per user, no server needed |
| Production APIs with multi-user state | `PgCheckpointer` | PostgreSQL + Redis, multi-user safe, horizontally scalable |

## InMemoryCheckpointer: development

`InMemoryCheckpointer` stores state in a Python dict and is the default when you pass no checkpointer to `compile()`. Use it for local development, unit tests, and single-process prototypes.

### Example

```python
from tenxgraph.core.graph import StateGraph
from tenxgraph.storage.checkpointer import InMemoryCheckpointer
from tenxgraph.core.state import Message

checkpointer = InMemoryCheckpointer()
app = graph.compile(checkpointer=checkpointer)

# First turn
app.invoke(
    {"messages": [Message.text_message("My name is Alice.")]},
    config={"thread_id": "user-1"},
)

# Second turn: same thread_id resumes the conversation
result = app.invoke(
    {"messages": [Message.text_message("What is my name?")]},
    config={"thread_id": "user-1"},
)
print(result["messages"][-1].content)
# Output: "Your name is Alice."
```

The state dict lives in the process and is lost when the process exits. For persistence across restarts, use `SqliteCheckpointer` or `PgCheckpointer`.

## SqliteCheckpointer: client-side agents

`SqliteCheckpointer` stores the entire graph state, message history, and thread metadata in a single local SQLite `.db` file. No PostgreSQL, no Redis. It is the right choice for agents that run embedded in a client app (desktop, mobile, or CLI) where each user has their own database file and there is exactly one writer.

### Install

```bash
pip install "10xgraph[sqlite_checkpoint]"
```

### Example

```python
import asyncio
from tenxgraph.core.graph import StateGraph
from tenxgraph.storage.checkpointer import SqliteCheckpointer
from tenxgraph.core.state import Message

# Path defaults to ~/.10xgraph/checkpointer.db if not provided
checkpointer = SqliteCheckpointer("agent_state.db")

graph = StateGraph()
# ... add nodes and edges ...
app = graph.compile(checkpointer=checkpointer)

async def main():
    await checkpointer.asetup()  # optional; tables are created lazily if omitted

    # First turn
    await app.ainvoke(
        {"messages": [Message.text_message("The deadline is Friday.")]},
        config={"thread_id": "project-1"},
    )

    # Second turn: resumes from the checkpoint
    result = await app.ainvoke(
        {"messages": [Message.text_message("When is the deadline?")]},
        config={"thread_id": "project-1"},
    )
    print(result["messages"][-1].content)

    await checkpointer.arelease()  # close the connection at shutdown

asyncio.run(main())
```

On POSIX systems, `SqliteCheckpointer` creates the database folder with mode `0700` and the file with `0600` before it connects, so only the owning user can read your threads. The `-wal` and `-shm` files take the mode of the database file. Existing files and folders keep their mode, and this has no effect on Windows.

The `.db` file persists between process restarts, so each user's agent resumes all threads from disk. Pass `":memory:"` as the path for a temporary, in-memory database (useful in tests).

### When to use

Use `SqliteCheckpointer` when:

- You are building a **client-side or desktop agent** (Tauri, Electron, PyInstaller, etc.) that ships a Python sidecar.
- Each user has a **dedicated process** with their own database file.
- You do not need to scale horizontally or share state across processes.

Do not use it when multiple processes or users share one backend. SQLite serializes writes and is not designed for concurrent writers; use `PgCheckpointer` instead.

## PgCheckpointer: production

`PgCheckpointer` is a dual-layer checkpointer designed for production: Redis caches hot state in memory, and PostgreSQL provides durable persistence. Both are required. It is the only choice for multi-user, multi-process deployments and enables interrupt-and-resume workflows, optimistic concurrency control, and tool call idempotency.

### Install

```bash
pip install "10xgraph[pg_checkpoint]"
```

### Minimal setup

```python
from tenxgraph.storage.checkpointer import PgCheckpointer

checkpointer = PgCheckpointer(
    postgres_dsn="postgresql://user:pass@localhost:5432/mydb",
    redis_url="redis://localhost:6379/0",
)
```

`PgCheckpointer` keys state by `user_id` as well as `thread_id`. If you omit `user_id` from the config, 10xGraph fills in `"anonymous"`, so pass a real one in multi-user apps.

### Configuration reference

```python
PgCheckpointer(
    # PostgreSQL connection
    postgres_dsn: str | None = None,        # DSN, or provide pg_pool below
    pg_pool: Any | None = None,             # Existing asyncpg.Pool
    pool_config: dict | None = None,        # Extra asyncpg.create_pool() kwargs

    # Redis connection
    redis_url: str | None = None,           # Redis URL, or provide redis below
    redis: Any | None = None,               # Existing redis.asyncio.Redis
    redis_pool: Any | None = None,          # Existing redis.asyncio.ConnectionPool
    redis_pool_config: dict | None = None,  # Extra pool kwargs

    # Schema
    schema: str = "public",                 # PostgreSQL schema name

    # Tuning (passed as **kwargs)
    cache_ttl: int = 86400,                 # Redis cache TTL in seconds (default: 24h)
    user_id_type: str = "string",           # Type for user_id column: "string" | "int" | "bigint"
    id_type: str = "string",                # Type for thread_id / message_id: "string" | "int" | "bigint"
    state_history_limit: int = 20,          # How many prior state snapshots to keep per thread
    enforce_user_isolation: bool = True,    # Scope state by user_id (multi-tenant safety)
    release_resources: bool = False,        # Close pools/clients on release()
)
```

### Schema setup

For production deployments, call `asetup()` (or the sync `setup()` outside a running event loop) before your first request to create the PostgreSQL tables. `PgCheckpointer` does not create them on first use.

```python
import asyncio
from tenxgraph.storage.checkpointer import PgCheckpointer

checkpointer = PgCheckpointer(
    postgres_dsn="postgresql://user:pass@localhost:5432/mydb",
    redis_url="redis://localhost:6379/0",
)

asyncio.run(checkpointer.asetup())
```

In a FastAPI lifespan handler:

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI

@asynccontextmanager
async def lifespan(app: FastAPI):
    await checkpointer.asetup()
    yield
    # Optional: await checkpointer.arelease()

app = FastAPI(lifespan=lifespan)
```

### Multi-user isolation

By default, `PgCheckpointer` treats `user_id` as an **ownership boundary**. Threads, state, messages, and the [tool ledger](/docs/concepts/replay-safe-tools) are scoped to the authenticated user, so even if an attacker knows another user's `thread_id`, they cannot read, write, or delete it. This is critical in multi-tenant deployments.

```python
# Multi-tenant deployment (recommended default)
checkpointer = PgCheckpointer(
    postgres_dsn="...",
    redis_url="...",
    enforce_user_isolation=True,  # default
)
```

If you run single-tenant (one user, or an internal service with no real user identity), you can disable it to skip the ownership check and save a database join per query:

```python
# Single-tenant deployment
checkpointer = PgCheckpointer(
    postgres_dsn="...",
    redis_url="...",
    enforce_user_isolation=False,
)
```

<aside class="callout callout-note" role="note"><p class="callout-title">Interaction with authentication</p>

Isolation is only meaningful if a real `user_id` reaches the checkpointer. The API server derives `user_id` from the authenticated caller and falls back to `"anonymous"` when no auth is configured. To enable per-user isolation on the server, set [`"auth": "jwt"`](/docs/server/auth) (or another auth backend) in your `10xgraph.json`. The checkpointer's `enforce_user_isolation` and the server's `authorization` backend (RBAC, ownership, etc.) are independent and complementary: the first controls *whose rows* a caller can touch; the second controls *whether* they may act at all.

</aside>

### State history retention

The checkpointer keeps multiple versioned snapshots of each thread's state to support debugging, manual recovery, and optimistic concurrency control. By default it retains the current state plus 19 prior snapshots (`state_history_limit: 20`) and prunes older rows on each write to keep the table bounded.

```python
checkpointer = PgCheckpointer(
    postgres_dsn="...",
    redis_url="...",
    state_history_limit=20,  # keep this many versions per thread
)
```

Higher values retain more audit trail but use more storage; `1` keeps only the current state; `0` or `None` disables pruning entirely (not recommended for long-running systems).

### Complete production example

```python
import asyncio
import os
from tenxgraph.core.graph import StateGraph
from tenxgraph.storage.checkpointer import PgCheckpointer
from tenxgraph.core.state import Message

# Read credentials from environment (set before starting the app)
checkpointer = PgCheckpointer(
    postgres_dsn=os.environ["DATABASE_URL"],
    redis_url=os.environ["REDIS_URL"],
    state_history_limit=20,
    enforce_user_isolation=True,
)

graph = StateGraph()
# ... add nodes and edges ...
app = graph.compile(checkpointer=checkpointer)

async def main():
    await checkpointer.asetup()

    # First user's request
    await app.ainvoke(
        {"messages": [Message.text_message("Deadline: Friday.")]},
        config={"thread_id": "alice-proj-1", "user_id": "alice"},
    )

    # Alice's second turn resumes her thread
    result = await app.ainvoke(
        {"messages": [Message.text_message("When is it?")]},
        config={"thread_id": "alice-proj-1", "user_id": "alice"},
    )
    print(result["messages"][-1].content)

asyncio.run(main())
```

Set the environment variables before starting:

```bash
export DATABASE_URL="postgresql://user:pass@localhost:5432/mydb"
export REDIS_URL="redis://localhost:6379/0"
python app.py
```

## Using with 10xgraph api

When serving your graph via `10xgraph api`, the checkpointer is part of your compiled graph, not configured via `10xgraph.json`. Build it in the module that `10xgraph.json`'s `agent` field points to:

```python
# graph.py
from tenxgraph.storage.checkpointer import PgCheckpointer
import os

checkpointer = PgCheckpointer(
    postgres_dsn=os.environ["DATABASE_URL"],
    redis_url=os.environ["REDIS_URL"],
)

app = graph.compile(checkpointer=checkpointer)
```

```json
{
  "agent": "graph:app"
}
```

The server loads the compiled `app` and uses its checkpointer for all requests.

## Choosing a checkpointer: decision table

Use this table to pick the right one for your scenario:

| Scenario | Checkpointer | Why |
|---|---|---|
| Local development, testing | `InMemoryCheckpointer` | No setup, fast, suitable for short-lived processes |
| Single-server stateless API (no resume needed) | `InMemoryCheckpointer` | State not required across requests |
| Client-side / desktop agent (Tauri, Electron, CLI) | `SqliteCheckpointer` | Single `.db` file, no external databases, user has their own copy |
| Dedicated process per user with own DB file | `SqliteCheckpointer` | Exactly one writer per database |
| Production multi-turn chat API | `PgCheckpointer` | Horizontal scaling, multi-user, durable, concurrent-safe |
| Interrupt-and-resume workflows | `PgCheckpointer` | Requires durable persistence and optimistic concurrency |
| Multiple server instances on same database | `PgCheckpointer` | Only option for safe, horizontally scalable deployments |

## Verify it works

After setting up a checkpointer, verify it by running two consecutive `invoke()` calls on the same `thread_id`. The second should recall information from the first.

```python
# First request
result1 = app.invoke(
    {"messages": [Message.text_message("Store: name = Alice")]},
    config={"thread_id": "test-thread"},
)

# Second request: should recall Alice
result2 = app.invoke(
    {"messages": [Message.text_message("What name was stored?")]},
    config={"thread_id": "test-thread"},
)

# Verify the agent has memory
assert "Alice" in result2["messages"][-1].content
```

## Next steps

This guide covers configuration only. For details on durability, concurrency, thread isolation, and the tool call idempotency ledger in `PgCheckpointer`, see [Durability and concurrency](/docs/guides/durability-and-concurrency).

To learn how to resume interrupted executions with `interrupt()` and resume, see [Add human approval](/docs/guides/add-human-approval).

For production hardening, including schema creation, backups, and scaling, see [Server production checklist](/docs/server/production-checklist).
