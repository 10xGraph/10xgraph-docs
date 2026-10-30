---
title: Checkpointers
seoTitle: "Checkpointers API reference (Python)"
description: Checkpointer implementations for state persistence. BaseCheckpointer, InMemoryCheckpointer, PgCheckpointer, SqliteCheckpointer.
section: Reference
group: "Python library"
order: 210
label: Checkpointers
updated: "2026-10-28"
---

A checkpointer persists graph state, messages and thread metadata between requests, so conversations survive restarts and multi-turn runs stay coherent. 10xGraph ships four: the `BaseCheckpointer` abstract class, plus `InMemoryCheckpointer`, `SqliteCheckpointer` and `PgCheckpointer`. Pass one to `graph.compile(checkpointer=...)`.

For choosing between them, see [Checkpointing and threads](/docs/concepts/checkpointing-and-threads) and [Set up checkpointing](/docs/guides/set-up-checkpointing).

## Import paths

All four classes are exported from one package. `PgCheckpointer` and `SqliteCheckpointer` raise `ImportError` on construction if their optional dependencies are missing.

```python
from tenxgraph.storage.checkpointer import BaseCheckpointer, InMemoryCheckpointer
# Optional: requires the pg_checkpoint extra (asyncpg and redis)
from tenxgraph.storage.checkpointer import PgCheckpointer
# Optional: requires the sqlite_checkpoint extra (aiosqlite)
from tenxgraph.storage.checkpointer import SqliteCheckpointer
```

---

## `BaseCheckpointer[StateT]`

Abstract base class for all checkpointer implementations. It declares async methods and a sync wrapper for each one, so a custom backend only implements the async side.

### Abstract async methods

The methods below are abstract and must be implemented by a subclass:

| Method | Signature | Description |
|---|---|---|
| `asetup` | `async () -> Any` | Initialise the storage backend (create tables, connect pools). |
| `aput_state` | `async (config, state) -> StateT` | Persist a state snapshot for the thread in `config["thread_id"]`. |
| `aget_state` | `async (config) -> StateT \| None` | Load the latest state snapshot for the thread. |
| `aclear_state` | `async (config) -> Any` | Delete all state for the thread. |
| `aput_state_cache` | `async (config, state) -> Any` | Write to the fast cache (Redis or in-memory). |
| `aget_state_cache` | `async (config) -> StateT \| None` | Read from the fast cache. |
| `aput_messages` | `async (config, messages, metadata=None) -> Any` | Append messages for the thread. |
| `aget_message` | `async (config, message_id) -> Message` | Fetch a single message by ID. |
| `alist_messages` | `async (config, search=None, offset=None, limit=None) -> list[Message]` | List messages. |
| `adelete_message` | `async (config, message_id) -> Any \| None` | Delete a single message. |
| `aput_thread` | `async (config, thread_info) -> Any \| None` | Store thread metadata. |
| `aget_thread` | `async (config) -> ThreadInfo \| None` | Get thread metadata. |
| `alist_threads` | `async (config, search=None, offset=None, limit=None) -> list[ThreadInfo]` | List threads. |
| `aclean_thread` | `async (config) -> Any \| None` | Delete a thread and its state and messages. |
| `arelease` | `async () -> Any \| None` | Release resources (close pools and connections). |

`alist_messages` and `alist_threads` apply `offset` and `limit` in the backend (in SQL on SQLite and Postgres). A negative `offset` or `limit` raises `ValueError`, and a `limit` above `MAX_LIST_LIMIT` (1000, in `tenxgraph.storage.checkpointer.base_checkpointer`) is lowered to it. With no `limit` (`None` or `0`) the whole list is returned, so code that reads a full thread, such as realtime history loading, still works.

### Sync wrappers

For every `async axxx()` method there is a sync `xxx()` wrapper that runs the async method to completion. Use these only from non-async contexts such as a management script:

```python
checkpointer.put_state(config, state)
checkpointer.get_state(config)
```

### Update message metadata

`aupdate_message_metadata` is not abstract. A backend overrides it to support feedback and other metadata updates.

| Method | Signature | Description |
|---|---|---|
| `aupdate_message_metadata` | `async (config, message_id, metadata) -> Message \| None` | Merge the keys of `metadata` into a stored message's metadata. A key that already exists is replaced. Returns the updated message, or `None` if the message is not in that thread. |
| `update_message_metadata` | `(config, message_id, metadata) -> Message \| None` | Sync wrapper. |

It applies the same owner isolation as `aget_message`. `PgCheckpointer`, `SqliteCheckpointer` and `InMemoryCheckpointer` implement it. A custom checkpointer that does not override it raises `NotImplementedError`. The REST route `PUT /v1/threads/{thread_id}/messages/{message_id}` calls it to store feedback, and returns `501` when the checkpointer lacks it. This method needs `10xgraph` 1.0 or later.

```python
message = await checkpointer.aupdate_message_metadata(
    {"thread_id": "t1"}, "msg-001", {"feedback": {"rating": "up"}}
)
```

Optional, non-abstract async methods also exist on the base class, for example `aput_checkpoint`, `aput_cache_value`, `aput_cache_value_if_absent` (set a cache value only if the key is missing: Redis `SET NX`, one SQLite statement, in-memory under its lock; the base class falls back to get-then-put), `aget_cache_value`, `arequest_stop` and `aget_thread_owner`. Backends override them as needed.

### Stop requests and active runs

A stop request belongs to the run it targets. The base class tracks which run is active on each thread, so a new run cannot erase a stop meant for a run that is still going. It uses the generic cache (`aput_cache_value`, `aget_cache_value`, `aclear_cache_value`), so it works on every backend with no schema change.

| Method | Description |
|---|---|
| `abegin_run(config)` | Registers `config["run_id"]` as the active run on the thread and drops a stale stop request: one that targets no run, or a run that is no longer active. A request that targets the run still marked active is kept. |
| `aend_run(config)` | Marks the run as finished. Clears the active-run marker if it is still this run's, and drops a stop request that targeted this run. |
| `aget_active_run(config)` | Returns the id of the run marked active on the thread, or `None`. |
| `arequest_stop(config)` | Records a stop request that names the run active on the thread (`None` when none is known). |
| `ais_stop_requested(config)` | `True` only for a request that targets `config["run_id"]`. A config with no `run_id`, or an old untargeted request, still matches. |

`ainvoke` and `astream` call `abegin_run` when a run starts and `aend_run` when it ends, so a stop request for a finished run does not linger until its TTL. A custom checkpointer that implements the cache methods gets all of this without changes. One that leaves them as the base class no-ops degrades to doing nothing, as stop requests did before. The existing method signatures are unchanged.

### Wiring into a graph

Pass the checkpointer to `compile`. The same call works for every backend.

```python
from tenxgraph.storage.checkpointer import InMemoryCheckpointer

app = graph.compile(checkpointer=InMemoryCheckpointer())
```

---

## `InMemoryCheckpointer`

In-process dictionary-based storage. Zero dependencies.

```python
from tenxgraph.storage.checkpointer import InMemoryCheckpointer

checkpointer = InMemoryCheckpointer()
app = graph.compile(checkpointer=checkpointer)
```

**When to use:**
- Unit tests and CI.
- Local development when you don't need state to survive a restart.
- Ephemeral single-process jobs.

**When NOT to use:**
- Any multi-process or multi-worker deployment.
- Production applications where conversation history must survive crashes.

### Storage behaviour

| Storage | Key | Data |
|---|---|---|
| `_states` | `thread_id` | Latest serialised state snapshot. |
| `_state_cache` | `thread_id` | Hot cache for the running execution. |
| `_messages` | `thread_id` | Ordered message list. |
| `_threads` | `thread_id` | Thread metadata (`name`, `created_at`, etc.). |

All access is guarded by per-bucket `asyncio.Lock` instances for safe concurrent use within a single process. The checkpointer stores and returns copies of the state, so changing a loaded state does not change the store until you save it. This costs one extra copy per state read and write.

---

## `PgCheckpointer`

PostgreSQL-backed checkpointer with a Redis cache for the hot state. Use it for production and multi-worker deployments. Both Postgres and Redis connection details are required.

<aside class="callout callout-note" role="note"><p class="callout-title">Optional dependency</p>

Requires both `asyncpg` and `redis`. Install them with the extra:

```bash
pip install "10xgraph[pg_checkpoint]"
```

</aside>

```python
from tenxgraph.storage.checkpointer import PgCheckpointer

checkpointer = PgCheckpointer(
    postgres_dsn="postgresql://user:pass@localhost:5432/mydb",
    redis_url="redis://localhost:6379/0",   # required unless redis or redis_pool is given
)

await checkpointer.asetup()   # creates tables if they don't exist
app = graph.compile(checkpointer=checkpointer)
```

### Constructor parameters

The constructor takes the connection arguments below as named parameters; the remaining options are read from keyword arguments. It raises `ValueError` if neither `postgres_dsn` nor `pg_pool` is given, or if none of `redis_url`, `redis_pool` or `redis` is given.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `postgres_dsn` | `str \| None` | `None` | PostgreSQL DSN. Required unless `pg_pool` is provided. |
| `pg_pool` | `asyncpg.Pool \| None` | `None` | Pre-created asyncpg connection pool. |
| `pool_config` | `dict \| None` | `None` | Config passed to `asyncpg.create_pool()` (`min_size`, `max_size`, etc.). |
| `redis_url` | `str \| None` | `None` | Redis URL for caching. One of `redis_url`, `redis` or `redis_pool` is required. |
| `redis` | `Redis \| None` | `None` | Pre-created Redis instance. |
| `redis_pool` | `ConnectionPool \| None` | `None` | Pre-created Redis connection pool. |
| `redis_pool_config` | `dict \| None` | `None` | Config passed to the Redis pool if creating a new one. Merged over the defaults: a bounded `BlockingConnectionPool` with `max_connections=50` and `timeout=5.0` (seconds a caller waits for a free connection), plus Redis socket timeouts (5 s connect, 10 s read). Override any key. |
| `schema` | `str` | `"public"` | PostgreSQL schema name where checkpointer tables live. Must match `^[a-zA-Z_][a-zA-Z0-9_]*$`, otherwise `ValueError`. |
| `redis_breaker_cooldown` (kwarg) | `float` | `5.0` | Seconds to skip Redis after a Redis connection failure. During the cool-down `PgCheckpointer` takes its usual fallback (Postgres, or no cache) at once instead of waiting for the connect timeout on every Redis call. `0` disables the circuit breaker. A cache entry whose invalidation was skipped is deleted when Redis is reachable again. |
| `cache_ttl` (kwarg) | `int` | `86400` | Redis cache TTL in seconds (24 hours). |
| `state_history_limit` (kwarg) | `int` | `20` | Number of historical state snapshots to retain per thread. |
| `release_resources` (kwarg) | `bool` | `False` | On `arelease()`, close the Postgres and Redis resources even if you passed them in. By default only resources the checkpointer created itself are closed. |
| `enforce_user_isolation` (kwarg) | `bool` | `True` | Treat `user_id` as an ownership boundary. When enabled, threads and state are scoped to the requesting user. Set to `False` for single-tenant apps or when there is no real user identity. |

### ID types

`PgCheckpointer` adapts its schema to the thread and message ID type:

| `id_type` | SQL column type |
|---|---|
| `string` | `VARCHAR(255)` |
| `int` | `SERIAL` |
| `bigint` | `BIGSERIAL` |

The value comes from the `generated_id_type` registered with InjectQ by the compiled graph, defaulting to `string`. You can override it with the `id_type` keyword argument. The `user_id` column type follows the `user_id_type` keyword argument (default `string`).

### Message ids and `thread_id`

Message ids are unique per thread. The primary key of the messages table is `(thread_id, message_id)`, so two threads can hold the same id. Saving a message again inside one thread still updates it. Because of this, `aget_message` and `adelete_message` need `thread_id` in the config. Without it they raise `ValueError`.

### Schema migration

`asetup()` creates the required tables if they do not exist and applies pending schema migrations. It is idempotent and safe to call on every startup. A failed migration raises `SchemaVersionError`, a subclass of `StorageError`.

Schema version 4 changes the messages primary key to `(thread_id, message_id)`. The migration runs automatically the first time `asetup()` runs on an older schema, under the existing advisory lock. It needs `10xgraph` 1.0 or later.

---

## `SqliteCheckpointer`

Single-file SQLite checkpointer. Stores everything in one local `.db` file: durable state, the hot "realtime" state cache, generic TTL cache, messages, and threads. No Postgres, no Redis. Fully async via `aiosqlite`.

<aside class="callout callout-note" role="note"><p class="callout-title">Optional dependency</p>

Requires `aiosqlite`. Install with:

```bash
pip install "10xgraph[sqlite_checkpoint]"
```

</aside>

```python
from tenxgraph.storage.checkpointer import SqliteCheckpointer

# Defaults to ~/.10xgraph/checkpointer.db; pass a path to override.
checkpointer = SqliteCheckpointer("agent_state.db")

await checkpointer.asetup()   # creates tables (also runs lazily on first use)
app = graph.compile(checkpointer=checkpointer)
```

### Constructor parameters

| Parameter | Type | Description |
|---|---|---|
| `db_path` | `str \| Path \| None` | Path to the SQLite database file. Defaults to `~/.10xgraph/checkpointer.db`. Parent directories are created on setup. Pass `":memory:"` for an ephemeral in-process database (useful for tests). |

**When to use:**
- **Client-side / embedded agents.** A desktop app that ships a Python sidecar (Tauri, Electron, PyInstaller) or a local CLI agent. The checkpointer runs entirely on the user's machine, right next to the app.
- **Dedicated-room deployments.** Each user (or tenant, or session) has their own process and their own `.db` file, so there is exactly one writer per database.

**When NOT to use:**
- **Multi-user servers where many users share one backend.** SQLite serializes writers and does not scale horizontally. Reach for [`PgCheckpointer`](#pgcheckpointer) (Postgres + optional Redis) instead.

### Design notes

- **One file, no external services.** The realtime state cache lives in a separate SQLite table (`af_state_cache`) rather than Redis; durable state lives in `af_states`. Reads check the cache table first, then fall back to durable state. This is the same two-layer read path as `PgCheckpointer`, collapsed into one file.
- **Custom state is preserved.** State is serialized with an embedded `__class_path__` and reconstructed into its exact `AgentState` subclass on read, matching `PgCheckpointer`.
- **Concurrency.** A single persistent connection is opened lazily with `PRAGMA journal_mode=WAL`; writes are serialized behind an `asyncio.Lock`. Call `await checkpointer.arelease()` (or `checkpointer.release()`) at shutdown to close it.
- **Isolation.** Data is keyed purely by `thread_id`; `user_id` is not required. `alist_threads` returns every thread in the file, which matches the one-database-per-user model.

---

## Writing a custom checkpointer

```python
from typing import Any
from tenxgraph.storage.checkpointer import BaseCheckpointer
from tenxgraph.core.state import AgentState, Message
from tenxgraph.utils.thread_info import ThreadInfo

class DynamoDBCheckpointer(BaseCheckpointer):

    async def asetup(self) -> Any:
        # Create DynamoDB tables
        ...

    async def aput_state(self, config: dict, state: AgentState) -> AgentState:
        thread_id = config["thread_id"]
        # Serialise and PUT to DynamoDB
        ...
        return state

    async def aget_state(self, config: dict) -> AgentState | None:
        thread_id = config["thread_id"]
        # GET from DynamoDB and deserialise
        ...

    async def aclear_state(self, config: dict) -> Any:
        ...

    async def aput_state_cache(self, config: dict, state: AgentState) -> Any:
        ...  # in-memory dict, no external call

    async def aget_state_cache(self, config: dict) -> AgentState | None:
        ...

    async def aput_messages(
        self, config: dict, messages: list[Message], metadata: dict | None = None
    ) -> Any:
        ...

    async def aget_message(self, config: dict, message_id: str | int) -> Message:
        ...

    async def alist_messages(
        self,
        config: dict,
        search: str | None = None,
        offset: int | None = None,
        limit: int | None = None,
    ) -> list[Message]:
        ...

    async def adelete_message(self, config: dict, message_id: str | int) -> Any | None:
        ...

    # Optional: support message feedback over the REST API
    async def aupdate_message_metadata(
        self, config: dict, message_id: str | int, metadata: dict
    ) -> Message | None:
        ...  # merge metadata into the stored message; None if not found

    async def aput_thread(self, config: dict, thread_info: ThreadInfo) -> Any | None:
        ...

    async def aget_thread(self, config: dict) -> ThreadInfo | None:
        ...

    async def alist_threads(
        self,
        config: dict,
        search: str | None = None,
        offset: int | None = None,
        limit: int | None = None,
    ) -> list[ThreadInfo]:
        ...

    async def aclean_thread(self, config: dict) -> Any | None:
        ...

    async def arelease(self) -> Any | None:
        ...  # close connections
```

---

## Config dictionary

All checkpointer methods accept a `config` dict. The required key is:

```python
config = {"thread_id": "session-abc123"}
```

Optional keys:
- `user_id`: scopes message searches by user.
- `run_id`: tracks a specific invocation.

---

## Common errors

| Error | Cause | Fix |
|---|---|---|
| `StorageError` | Unrecoverable PostgreSQL error. | Check Postgres logs and DSN config. |
| `TransientStorageError` | Temporary Postgres failure. | Retry the call. |
| `ImportError: PgCheckpointer requires 'asyncpg'` or `'redis'` | `PgCheckpointer` used without both packages installed. | Run `pip install "10xgraph[pg_checkpoint]"`. |
| `ValueError: Either redis_url, redis_pool or redis instance must be provided.` | `PgCheckpointer` created without Redis details. | Pass `redis_url`, `redis` or `redis_pool`. |
| `SchemaVersionError` | A schema migration failed during `asetup()`. | Check database permissions and the `schema` name. |
| `ImportError: SqliteCheckpointer requires 'aiosqlite'` | `SqliteCheckpointer` used without `aiosqlite` installed. | Run `pip install "10xgraph[sqlite_checkpoint]"`. |
| State lost between requests | Using `InMemoryCheckpointer` with multiple workers. | Switch to `PgCheckpointer` or ensure a single-process deployment. |
