---
slug: project/upgrade-to-1.0
title: Upgrade to 1.0
seoTitle: "Upgrade 10xGraph to 1.0: breaking changes"
description: Migration guide from 10xGraph 0.8 and 0.9 to 1.0, covering the four breaking changes and the new defaults that change runtime behaviour.
section: Project
order: 20
label: Upgrade to 1.0
updated: "2026-10-27"
---

1.0 is the first release covered by our deprecation policy. It contains four breaking changes and
several new defaults that change runtime behaviour without changing any API you
call. Work through this page before upgrading a running deployment.

```bash
pip install --upgrade 10xgraph 10xgraph-api
npm install 10xgraph-client@latest
```

---

## Breaking changes

### 1. The default `user_id` is now `"anonymous"`

Runs that do not pass a `user_id` previously filed themselves under
`"test-user-id"`. With [per-user isolation](#per-user-isolation) enabled, that
placeholder pooled every unauthenticated run into one identity that looked like a
real account.

**Who is affected:** anyone with existing threads, memories, or files written
without an explicit `user_id`.

**What to do:** those rows are still stored under `"test-user-id"` and are no
longer reachable from a default run. Either pass the old value explicitly:

```python
result = await app.ainvoke(
    {"messages": [Message.text_message("Hello")]},
    config={"thread_id": "thread-1", "user_id": "test-user-id"},
)
```

or migrate the rows once:

```sql
UPDATE threads  SET user_id = 'anonymous' WHERE user_id = 'test-user-id';
UPDATE states   SET user_id = 'anonymous' WHERE user_id = 'test-user-id';
UPDATE messages SET user_id = 'anonymous' WHERE user_id = 'test-user-id';
```

Take a backup first. See [backup and restore](/docs/server/backup-and-restore).

In production, pass a real `user_id` from your auth layer rather than relying on
either default.

### 2. A conditional edge that raises now fails the run

If a routing function raises, the run now stops with a `GraphError`
(`GRAPH_ROUTING_001`). Previously the exception was swallowed and execution fell
through to the first static edge or `END`, silently taking a path nobody chose.

**Who is affected:** graphs whose routing functions can raise: most often a
`KeyError` or `AttributeError` when reading a state field that is not set yet.

**What to do:** make the routing function total.

```python
def route(state: AgentState) -> str:
    last = state.context[-1] if state.context else None
    if last is None:
        return END
    return "tools" if last.tools_calls else END
```

If you were relying on the old fall-through, make it explicit by returning the
target node name from an `except` branch.

### 3. `injectq` is pinned to `>=0.4.0,<0.5`

`injectq` is pre-1.0, so an unbounded requirement could pick up a breaking `0.5`
and break fresh installs.

**What to do:** if you pin `injectq` yourself, move to a version inside that
range. If your lockfile resolved to something outside it, regenerate the lock.

### 4. Production refuses to start with wildcard CORS and credentials

Starting the API server with `MODE=production`, `ORIGINS=*`, and credentials
enabled is now a startup error rather than a silent security hole.

**What to do:** set explicit origins:

```bash
ORIGINS=https://app.example.com,https://admin.example.com
```

or, if you genuinely serve a public API with no cookie or `Authorization`
credentials, set `CORS_ALLOW_CREDENTIALS=false`.

---

## New defaults that change behaviour

These are not API changes, but they change how a deployment behaves.

| Setting | Where | Default | Effect |
| --- | --- | --- | --- |
| `enforce_user_isolation` | `PgCheckpointer(...)` | `True` | State, messages, and threads are scoped per user. A read with a different `user_id` returns nothing rather than another tenant's data. Set `False` for a single-tenant app or when there is no real user identity. |
| `durable_checkpoint_every_step` | run `config` | `True` | A checkpoint is written after each node instead of once per run, so a crash replays one node. Slightly more write traffic. |
| `node_timeout` | run `config` | `900.0` seconds | A node that hangs is cancelled. Set to `None` or `0` to disable. |
| `tool_timeout` | run `config` | `300.0` seconds | A tool call that hangs is cancelled. Set to `None` or `0` to disable. |
| `max_pending_tasks` | `BackgroundTaskManager(...)` | `1000` | Background task submission applies backpressure instead of growing unbounded when a publisher sink is slow or dead. |

Both timeouts are backstops against hangs, not latency budgets. The node default
sits above the LLM client timeout (600s) so a slow model call fails with its own
error rather than being masked by the node deadline.

### Per-user isolation

Uploaded files now record an owner, and a read by another user returns 404.
If your application shares files across users, pass a consistent owner id rather
than turning isolation off.

### Concurrency: handle `StaleStateError`

Durable state now uses optimistic concurrency. Two runs writing to the same
thread no longer silently lose one of the updates: the loser raises
`StaleStateError`, surfaced as HTTP 409 at the API.

```python
from tenxgraph.core.exceptions import StaleStateError

try:
    result = await app.ainvoke(payload, config=config)
except StaleStateError:
    # Another run updated this thread first. Re-read and retry, or surface
    # a conflict to the caller.
    ...
```

Clients that fan out concurrent requests against one `thread_id` should either
serialise them or retry on 409.

---

## Database migration

Schema v3 adds the `tool_executions` ledger and the `version` column on `states`.
Migrations run stepwise and are idempotent, and take a `pg_advisory_xact_lock` so
concurrent workers cannot race the DDL.

```bash
# Back up first.
pg_dump "$DATABASE_URL" > 10xgraph-pre-1.0.sql

# Migrations apply on first startup of the upgraded server.
10xgraph dev --no-reload
```

Roll out one instance first and confirm the schema version before scaling up.

---

## Verification checklist

After upgrading, before sending production traffic:

1. `10xgraph version` reports the expected core and CLI versions.
2. The server starts with `MODE=production` and no CORS warning.
3. An existing thread can still be read by its owner and returns 404 for anyone
   else.
4. A run that stops mid-node is actually cancelled (`stop` returns and the node
   does not keep writing).
5. Two concurrent writes to one thread produce one success and one 409, not two
   silent successes.
6. Your dashboards receive the new node and tool metrics if you enabled
   `setup_otel_metrics()`.

## Related

- [Production checklist](/docs/server/production-checklist)
- [Deployment](/docs/server/deploy)
