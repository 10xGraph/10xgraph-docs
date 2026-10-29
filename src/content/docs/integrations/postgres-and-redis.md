---
title: "Postgres and Redis checkpointing"
description: "Set up PgCheckpointer for durable, resumable agent threads: Postgres as the source of truth, Redis as a cache, plus schema, pooling and operations."
seoTitle: "Postgres and Redis checkpointer"
section: Integrations
group: "Storage"
order: 80
label: "Postgres and Redis"
updated: "2026-10-08"
faq:
  - q: "Does PgCheckpointer work without Redis?"
    a: "No. The constructor raises a ValueError unless you pass redis_url, redis_pool or a redis client, and it raises an ImportError if the redis package is missing. Redis only holds a cache, so losing it does not lose data."
  - q: "What is the Postgres DSN format?"
    a: "Use a plain asyncpg-style DSN such as postgresql://user:password@host:5432/dbname. The value goes straight to asyncpg.create_pool, so SQLAlchemy driver suffixes like postgresql+asyncpg:// are not accepted."
  - q: "What happens if I do not pass a thread_id?"
    a: "The compiled graph generates a random thread_id and logs a warning. That run cannot be resumed or stopped later, because your code does not know the id."
---

`PgCheckpointer` stores every thread's graph state in Postgres, which is the durable source of truth, and caches the latest state in Redis for fast reads. Use it when conversations must survive restarts, deploys and multiple server processes. For a single process or local work, a lighter checkpointer is enough.

## How the two layers divide the work

Postgres holds all durable data: threads, state snapshots, messages and the tool execution ledger. Redis holds only a cached copy of the latest state per thread, with a time to live. If a Redis read fails or misses, the checkpointer reads from Postgres and refills the cache.

| Layer | Holds | Loss impact |
|---|---|---|
| Postgres | Threads, versioned state snapshots, messages, tool execution results | Thread history is lost unless restored from backup |
| Redis | Cached latest state, keyed `state_cache:<thread_id>:<user_id>`, TTL 86400 seconds by default | None; the next read falls back to Postgres |

Concurrent writers are serialized in Postgres, not Redis. Each durable write takes a row lock on the thread and checks a per-thread `version` number, so a stale run fails with `StaleStateError` instead of overwriting newer state. See [Durability and concurrency](/docs/guides/durability-and-concurrency) for that behavior.

## Install the extra

The `pg_checkpoint` extra installs the async Postgres driver and the Redis client.

```bash
# installs asyncpg>=0.29.0 and redis>=4.2
pip install "10xgraph[pg_checkpoint]"
```

Without the extra, constructing `PgCheckpointer` raises an `ImportError` that points back to this command. The example below also needs a model provider, so add one, for example `pip install "10xgraph[pg_checkpoint,google-genai]"`.

## Run Postgres and Redis locally

For development, run both services with Docker Compose.

```yaml
# docker-compose.yml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: tenx
      POSTGRES_PASSWORD: tenx
      POSTGRES_DB: tenx
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

volumes:
  pgdata:
```

Start them with `docker compose up -d`.

## Create a checkpointer and resume a thread

Pass the checkpointer to `compile`, then invoke the graph with the same `thread_id` to continue a conversation. The tables are created on first use, so no manual migration step is needed for a new database.

```python
# app.py
from dotenv import load_dotenv

from tenxgraph.core.state import AgentState, Message
from tenxgraph.prebuilt.agent import ReactAgent
from tenxgraph.storage.checkpointer import PgCheckpointer

load_dotenv()

checkpointer = PgCheckpointer(
    # Plain DSN: it is passed directly to asyncpg.create_pool
    postgres_dsn="postgresql://tenx:tenx@localhost:5432/tenx",
    redis_url="redis://localhost:6379/0",
)

agent = ReactAgent(
    model="google/gemini-2.5-flash",
    provider="google",
    system_prompt=[{"role": "system", "content": "You are a helpful assistant."}],
    tools=[],
)
app = agent.compile(checkpointer=checkpointer)

# First turn on thread "user-42"
app.invoke(
    {"messages": [Message.text_message("My name is Alex.")]},
    config={"thread_id": "user-42", "user_id": "alex"},
)

# Later turn, even from another process: same thread_id and user_id
result = app.invoke(
    {"messages": [Message.text_message("What is my name?")]},
    config={"thread_id": "user-42", "user_id": "alex"},
)
print(result["messages"][-1])
```

The model's reply varies, but it can answer from the earlier turn because the state was loaded from the checkpointer. Thread ids survive process restarts and deploys because the data lives in Postgres.

A graph built directly with `StateGraph` takes the same argument: `graph.compile(checkpointer=checkpointer)`.

### Constructor parameters

You must supply one Postgres source (`postgres_dsn` or `pg_pool`) and one Redis source (`redis_url`, `redis_pool` or `redis`), otherwise a `ValueError` is raised.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `postgres_dsn` | `str` | `None` | Postgres connection string for a pool the checkpointer creates |
| `pg_pool` | asyncpg `Pool` | `None` | Existing pool to use instead |
| `pool_config` | `dict` | `None` | Extra keyword arguments for `asyncpg.create_pool` (for example `min_size`, `max_size`) |
| `redis_url` | `str` | `None` | Redis URL for a pool the checkpointer creates |
| `redis` | Redis client | `None` | Existing `redis.asyncio.Redis` instance |
| `redis_pool` | `ConnectionPool` | `None` | Existing Redis connection pool |
| `redis_pool_config` | `dict` | `None` | Extra keyword arguments for the Redis pool, merged over the defaults. The pool is capped at `max_connections=50`, and a caller past the cap waits up to `timeout=5.0` seconds for a free connection. Override either key. |
| `schema` | `str` | `"public"` | Postgres schema for the tables. Must match `^[a-zA-Z_][a-zA-Z0-9_]*$` |
| `cache_ttl` | `int` (kwarg) | `86400` | Redis cache lifetime in seconds |
| `state_history_limit` | `int` (kwarg) | `20` | State snapshots kept per thread; older ones are pruned on each durable write |
| `enforce_user_isolation` | `bool` (kwarg) | `True` | Scope threads, state and messages to the `user_id` in the config |
| `user_id_type` | `str` (kwarg) | `"string"` | Column type for `user_id`: `string`, `int` or `bigint` |
| `release_resources` | `bool` (kwarg) | `False` | Also close pools you passed in when `arelease()` runs |

## Schema

The checkpointer creates five tables in the configured schema and records the schema version in `schema_version`. Schema creation and upgrades run under a Postgres advisory lock, so several processes starting at once are safe, and the DDL is idempotent.

| Table | Purpose | Main columns |
|---|---|---|
| `threads` | One row per thread | `thread_id` (primary key), `thread_name`, `user_id`, `created_at`, `updated_at`, `meta` (jsonb) |
| `states` | Versioned state snapshots | `state_id`, `thread_id`, `version` (bigint), `state_data` (jsonb), `created_at`, `updated_at`, `meta` |
| `messages` | Messages per thread | `message_id`, `thread_id`, `role` (enum), `content`, `tool_calls` (jsonb), `tool_call_id`, `reasoning`, `total_tokens`, `usages` (jsonb), `meta` |
| `tool_executions` | Tool results keyed by `(thread_id, tool_call_id)`, so a replayed node does not re-run finished tools | `thread_id`, `tool_call_id`, `result` (jsonb), `created_at` |
| `schema_version` | Applied schema versions (currently 3) | `version`, `applied_at` |

Notes on the types:

- `states` has a unique index on `(thread_id, version)`. That index is what makes concurrent appends collide instead of duplicating a version.
- `messages.role` is a Postgres enum `message_role` with the values `user`, `assistant`, `system` and `tool`.
- `thread_id` is `VARCHAR(255)` by default. The id type follows the `generated_id_type` setting (`string`, `int` or `bigint`).
- `states` and `messages` reference `threads` with `ON DELETE CASCADE`, so deleting a thread row deletes its history.

## Sizing

These figures are planning estimates for your own load tests, not measured limits. State is stored as JSON, so row size follows your messages and custom state.

| Resource | Rule of thumb |
|---|---|
| Postgres storage | Rows per thread grow with turns, but `state_history_limit` caps snapshots at 20 per thread by default. Messages are not pruned. |
| Postgres connections | Pool size near `workers * concurrent_invokes_per_worker`, then adjust from observed queueing |
| Redis memory | One cached state document per active thread, expiring after `cache_ttl`. Multiply your typical serialized state size by active threads. |

Watch p95 write latency and connection wait time rather than relying on a fixed instance size.

## Pooling and concurrency

By default the checkpointer builds its own asyncpg pool lazily on first use from `postgres_dsn`. Tune it with `pool_config`, whose keys are passed to `asyncpg.create_pool`.

```python
from tenxgraph.storage.checkpointer import PgCheckpointer

checkpointer = PgCheckpointer(
    postgres_dsn="postgresql://tenx:tenx@localhost:5432/tenx",
    redis_url="redis://localhost:6379/0",
    pool_config={"min_size": 5, "max_size": 20},  # asyncpg pool bounds
)
```

If your application already owns a pool, pass it as `pg_pool`. The checkpointer uses it and does not close it on `arelease()` unless you set `release_resources=True`.

```python
import asyncio

import asyncpg

from tenxgraph.storage.checkpointer import PgCheckpointer


async def main() -> None:
    # Shared pool owned by the application
    pool = await asyncpg.create_pool(
        "postgresql://tenx:tenx@localhost:5432/tenx", min_size=5, max_size=20
    )
    checkpointer = PgCheckpointer(pg_pool=pool, redis_url="redis://localhost:6379/0")
    try:
        ...  # compile a graph with this checkpointer and run it
    finally:
        await checkpointer.arelease()  # closes only what the checkpointer created (Redis here)
        await pool.close()


asyncio.run(main())
```

Replace the `...` line with your own graph run.

## Multi-tenant scoping

`enforce_user_isolation` is on by default, so every query is scoped to the `user_id` in the config. Knowing another user's `thread_id` is not enough to read or delete their thread. Put the tenant in the thread id or the user id so tenants stay separate.

```python
config = {
    "thread_id": f"tenant-{tenant_id}:session-{session_id}",
    "user_id": f"{tenant_id}:{user_id}",  # ownership boundary enforced by the checkpointer
}
```

If you omit `user_id`, the compiled graph substitutes a shared anonymous id and logs a warning, so every caller without a user id shares one identity. Enable auth, or pass `user_id` yourself, for any multi-user deployment. Set `enforce_user_isolation=False` only for single-tenant apps with no real user identity. Then queries key on `thread_id` alone and the id must be treated as a secret.

## Backups and recovery

Back up Postgres; do not back up Redis. Use your managed service's automated backups with point-in-time recovery. If Postgres is lost, thread history is lost to the extent of your backup window.

Redis is a cache. If it restarts or evicts keys, reads fall through to Postgres and repopulate the cache. After restoring Postgres from a backup, flush the cached `state_cache:*` keys so Redis cannot serve state newer than the restored data.

## Maintenance and cleanup

Snapshots are pruned automatically, but threads and messages accumulate. Delete old threads in SQL; the cascade removes their states, messages and tool executions.

```sql
-- Remove threads idle for 90 days (cascades to states, messages, tool_executions)
DELETE FROM "public"."threads"
WHERE updated_at < NOW() - INTERVAL '90 days';
```

SQL deletes do not touch Redis. Cached entries expire on their own after `cache_ttl`. To remove one thread cleanly, including its cache key, call `await checkpointer.aclean_thread({"thread_id": "user-42", "user_id": "alex"})`.

Run autovacuum or a periodic `VACUUM` to reclaim space after large deletes.

## Common issues

| Symptom | Cause and fix |
|---|---|
| `ValueError: Either redis_url, redis_pool or redis instance must be provided.` | Redis is mandatory. Add a Redis source. |
| `ValueError: Either postgres_dsn or pg_pool must be provided.` | Pass a DSN or an asyncpg pool. |
| `ImportError` mentioning `asyncpg` or `redis` | Run `pip install "10xgraph[pg_checkpoint]"`. |
| Connection error with a `postgresql+asyncpg://` URL | Use `postgresql://`. The DSN goes directly to asyncpg. |
| Every call starts a fresh conversation | You did not pass a stable `thread_id`; a random one is generated per call. |
| Thread not found for a user who knows the id | Working as intended with `enforce_user_isolation=True`; the `user_id` must match the owner. |
| Large database | Messages are stored in full. Trim long outputs or keep large files in the media store. See [state and messages](/docs/concepts/state-and-messages). |
| `ValueError: Invalid schema name` | `schema` must match `^[a-zA-Z_][a-zA-Z0-9_]*$`. |

## Related pages

- [Checkpointing and threads](/docs/concepts/checkpointing-and-threads)
- [Long-term memory](/docs/concepts/memory-and-store)
- [Set up checkpointing](/docs/guides/set-up-checkpointing)
- [Durability and concurrency](/docs/guides/durability-and-concurrency)
- [Production checklist](/docs/server/production-checklist)
