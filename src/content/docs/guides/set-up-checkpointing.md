---
title: Set up checkpointing
description: "Choose and configure a checkpointer for state persistence: InMemoryCheckpointer for development, SqliteCheckpointer for client agents, or PgCheckpointer for production."
section: "Data and state"
group: "Threads and state"
order: 10
label: Set up checkpointing
updated: "2026-11-26"
---

A checkpointer persists your graph state after every node so that multi-turn conversations can resume across separate requests, and interrupted executions can pick up where they left off. This guide picks a checkpointer and configures it.

## Choose a checkpointer

| Scenario | Use | Key feature |
|---|---|---|
| Local development and testing | `InMemoryCheckpointer` | Fast, zero setup, state lost on restart |
| Client-side agents (Tauri, Electron, CLI) | `SqliteCheckpointer` | Single `.db` file per user, no server needed |
| Production APIs with multi-user state | `PgCheckpointer` | PostgreSQL + Redis, multi-user safe, horizontally scalable |

## InMemoryCheckpointer: development

`InMemoryCheckpointer` stores state in a Python dict and is the default when you pass no checkpointer to `compile()`. Use it for local development, unit tests, and single-process prototypes.

### Example

```python
from tenxgraph.storage.checkpointer import InMemoryCheckpointer
from tenxgraph.core.state import Message

checkpointer = InMemoryCheckpointer()
# graph: a StateGraph built as in Build a graph
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
print(result["messages"][-1].text())  # Your name is Alice.
```

State lives in the process and is lost when it exits. `compile()` with no checkpointer uses this one and logs a WARNING.

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
    print(result["messages"][-1].text())

    await checkpointer.arelease()  # close the connection at shutdown

asyncio.run(main())
```

The `.db` file persists between process restarts, so each user's agent resumes all threads from disk. Pass `":memory:"` as the path for a temporary, in-memory database (useful in tests).

`SqliteCheckpointer` also keeps the tool execution ledger, in the `af_tool_executions` table, and takes `record_tool_result=False` to turn it off. See [Replay-safe tools](/docs/concepts/replay-safe-tools).

Do not use it when multiple processes or users share one backend. SQLite serializes writes and is not designed for concurrent writers; use `PgCheckpointer` instead.

## PgCheckpointer: production

`PgCheckpointer` is a dual-layer checkpointer designed for production: Redis caches hot state in memory, and PostgreSQL provides durable persistence. Both are required. Use it when more than one process shares state.

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

### Configuration

Every constructor option (`cache_ttl`, `state_history_limit`, `ddl_lock_timeout`, `record_tool_result` and the rest) is in [Checkpointers](/docs/reference/python/checkpointers#pgcheckpointer). `id_type` is deprecated: the id type follows the id generator.

### Schema setup

`asetup()` (or the sync `setup()` outside a running event loop) creates the PostgreSQL tables and applies pending migrations. It is idempotent. Behind the API server you do not need to call it: the server calls `asetup()` at boot, and if that fails it logs the error and the checkpointer retries on first use, so a fresh Postgres works without a manual step. Call it yourself when you run the graph outside the API server and want errors at startup.

```python
import asyncio
from tenxgraph.storage.checkpointer import PgCheckpointer

checkpointer = PgCheckpointer(
    postgres_dsn="postgresql://user:pass@localhost:5432/mydb",
    redis_url="redis://localhost:6379/0",
)

asyncio.run(checkpointer.asetup())
```
Each setup DDL statement waits at most `ddl_lock_timeout` seconds (default 10) for a table lock and then raises `SetupLockTimeoutError`; retry once the other transaction ends. Details are in [Multi-tenant data](/docs/guides/multi-tenant-data).


### Check that the checkpointer is reachable

`await checkpointer.aping()` returns when the backends answer and raises when they do not. It never creates the schema, so call `asetup()` first. The server calls it at startup and on `/health/ready`. See [Checkpointers](/docs/reference/python/checkpointers#aping).

Reference: [BaseCheckpointer](/docs/reference/python/checkpointers) · Source: [base_checkpointer.py](https://github.com/10xGraph/10xGraph/blob/main/tenxgraph/storage/checkpointer/base_checkpointer.py)

### Multi-user isolation

By default, `PgCheckpointer` treats `user_id` as an **ownership boundary**. Threads, state, messages, and the [tool ledger](/docs/concepts/replay-safe-tools) are scoped to the authenticated user, so even if an attacker knows another user's `thread_id`, they cannot read, write, or delete it.

If you run single-tenant (one user, or an internal service with no real user identity), you can set `enforce_user_isolation=False` to skip the ownership check and save a database join per query:

```python
# Single-tenant deployment
checkpointer = PgCheckpointer(
    postgres_dsn="...",
    redis_url="...",
    enforce_user_isolation=False,
)
```

<aside class="callout callout-note" role="note"><p class="callout-title">Interaction with authentication</p>

Isolation is only meaningful if a real `user_id` reaches the checkpointer. The API server derives `user_id` from the authenticated caller and falls back to `"anonymous"` when no auth is configured. To enable per-user isolation on the server, set [`"auth": "jwt"`](/docs/server/auth) (or another auth backend) in your `10xgraph.json`. With auth on, the server scopes every thread query to the caller's reach regardless.

</aside>

### Tenant and extra columns

For several organizations or projects in one database, declare columns on the `threads` table that you own:

```python
checkpointer = PgCheckpointer(
    postgres_dsn="...",
    redis_url="...",
    tenant_columns={"org_id": "uuid", "project_id": "text"},
    extra_columns={"plan": "text"},
)
```

- **Tenant columns** isolate data like `user_id` does. The caller's reach (`own`, `tenant` or `all`, set by the caller's role) decides which of `user_id` and the tenant columns a thread must match. Required on thread creation by default; types are `text`, `bigint`, `integer` or `uuid`.
- **Extra columns** carry your own data (any Postgres type) and can be filtered with `alist_threads(config, filters=...)` and `GET /v1/threads?filters=`.
- Values are set when the thread is created, never change, and come **only from `config["user"]`**, which your auth class fills. Never read them from request config, metadata, state or model output.
- Declare the same tenant columns on `PgVectorStore`. `compile()` refuses a mismatch under `MODE=production` unless you pass `allow_tenant_mismatch=True`.
- `InMemoryCheckpointer` and `SqliteCheckpointer` raise if you pass these options.

Native row-level security, the full `BaseAuth` example, isolation scopes and the filter reference are in [Multi-tenant data](/docs/guides/multi-tenant-data).

Reference: [BaseAuth](/docs/reference/api-cli/auth) · Source: [base_auth.py](https://github.com/10xGraph/10xgraph-api/blob/main/tenxgraph_api/src/app/core/auth/base_auth.py)

### State history retention

`state_history_limit` (default 20) is how many state versions a thread keeps; older ones are pruned on each write.

### Tool results

Finished tool calls are kept in a ledger so a replay does not run them twice ([Replay-safe tools](/docs/concepts/replay-safe-tools)). Clear or prune it:

```python
await checkpointer.aclear_tool_results(config)                         # one thread
await checkpointer.aprune_tool_results(older_than=timedelta(days=7))   # all threads, returns the count
```

10xGraph never calls `aprune_tool_results`. Schedule it for runs that stopped and were never resumed. With `row_level_security=True`, use a database role that bypasses RLS. To turn recording off, set `record_tool_result=False` here or on a single `@tool`; a tool can then run twice after a crash or on resume. The full example, the worker job and the rules are in [Replay-safe tools](/docs/concepts/replay-safe-tools#prune-old-ledger-rows).

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
    print(result["messages"][-1].text())

asyncio.run(main())
```

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
assert "Alice" in result2["messages"][-1].text()
```

## Run it in production

The server uses the checkpointer you pass to `graph.compile(checkpointer=...)`. `10xgraph.json` has no `checkpointer` key; the server refuses to start when one is set. `compile()` with no checkpointer falls back to `InMemoryCheckpointer` and logs a WARNING. A graph logs one WARNING per graph on its first run with no `user_id`. Behind the API server in production, or with `WEB_CONCURRENCY` above 1, an in-memory or SQLite checkpointer (or no Redis) also logs a WARNING that threads and limits are per process. Use `PgCheckpointer` when you run more than one worker, since workers share state only through it. Run one graph per process or container. See [Scaling and reliability](/docs/production/scaling) and [Backup and restore](/docs/server/backup-and-restore).

## Next steps

- [Durability and concurrency](/docs/guides/durability-and-concurrency): concurrency, history and the tool ledger.
- [Add human approval](/docs/guides/add-human-approval): pause and resume.
- [Server production checklist](/docs/server/production-checklist).
