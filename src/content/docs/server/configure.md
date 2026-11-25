---
title: Configure 10xgraph.json
description: Task guide for setting the common 10xgraph.json keys, wiring a checkpointer, store and auth, and keeping separate configs per environment.
section: "API server"
group: "Basics"
order: 30
label: Configure 10xgraph.json
updated: "2026-11-25"
---

The `10xgraph.json` file tells the API server which graph to load, how to persist state, who can access it, and how to manage resources. This guide covers the keys you need to configure for a working deployment. For a complete list of every key, type and default, see the [configuration reference](/docs/reference/api-cli/configuration).

## Minimal configuration

Only the `agent` key is required. It is a `module:attribute` path that resolves to a compiled graph:

```json
{
  "agent": "graph.react:app",
  "env": ".env"
}
```

The module is imported when the server starts. The `app` variable must be the result of calling `state_graph.compile()`. If the import fails, the server refuses to start with a clear error. Test your module path by hand before deploying:

```bash
python -c "from graph.react import app; print(type(app))"
```

The `env` key names a dotenv file that the server loads before importing your graph module. Use it for local development secrets (API keys, database URLs). Never commit `.env` files to version control. In production, pass variables through your container or orchestration platform instead, so sensitive values never touch the filesystem.

## Enable thread persistence with a checkpointer

The API server persists conversation history in a checkpointer that you wire into your graph at compile time. Pass it to `compile()` in your graph module:

```python
# graph/dependencies.py
from tenxgraph.storage.checkpointer import PgCheckpointer

my_checkpointer = PgCheckpointer(
    postgres_dsn="postgresql://user:password@localhost/10xgraph",
    redis_url="redis://localhost:6379/0",
)
```

```python
# graph/react.py
from graph.dependencies import my_checkpointer

app = state_graph.compile(checkpointer=my_checkpointer)
```

The server uses the compiled graph's checkpointer. A `checkpointer` key in `10xgraph.json` was removed and is refused at startup, so delete it if it is present.

Without an explicit checkpointer, `compile()` falls back to `InMemoryCheckpointer`, which keeps threads in memory while the process runs. This is fine for local development and testing, but in production it means:

- Conversations are lost when the process restarts.
- Each replica maintains its own separate history; the same user hitting a different pod sees a different thread history.

For production, use `PgCheckpointer` (Postgres + Redis). It requires `pip install "10xgraph[pg_checkpoint]"` and maintains thread history durably in Postgres while using Redis as a fast cache layer. See [Set up checkpointing](/docs/guides/set-up-checkpointing) for the full setup, including SQLite for single-machine deployments.

## Set up the memory store

The `store` key points at a `BaseStore` instance (not a class). Without it, the `/v1/store/*` endpoints report that no store is configured. The store powers long-term memory for your agents:

```python
# graph/dependencies.py
from tenxgraph.storage.store import QdrantStore
from tenxgraph.storage.store.embedding import OpenAIEmbedding

# needs: pip install "10xgraph[qdrant,openai]"
my_store = QdrantStore(embedding=OpenAIEmbedding(), path="./qdrant_data")
```

```json
{
  "agent": "graph.react:app",
  "store": "graph.dependencies:my_store"
}
```

The loader validates that the attribute is a `BaseStore` instance and fails at startup with a clear error if not. For tests, use `tenxgraph.qa.testing.InMemoryStore`, which satisfies the same interface.

Reference: [BaseStore](/docs/reference/python/memory-stores) · Source: [base_store.py](https://github.com/10xGraph/10xGraph/blob/main/tenxgraph/storage/store/base_store.py)

## Wire up dependency injection

The `injectq` key points at an InjectQ container. Use it to inject services at startup that your nodes and tools need, such as a database session factory, an HTTP client, or configuration objects:

```python
# graph/dependencies.py
import os

from injectq import InjectQ


class MyDatabase:
    def __init__(self, dsn: str) -> None:
        self.dsn = dsn


container = InjectQ()
container.bind_instance(MyDatabase, MyDatabase(dsn=os.environ["DATABASE_URL"]))
```

```json
{
  "agent": "graph.react:app",
  "injectq": "graph.dependencies:container"
}
```

The server loads your container at startup and uses it as its own. Build the graph with the same container, `StateGraph(container=container)`, or leave both `injectq` and `container=` unset to use the global container: the server refuses to start when the graph's container is a different one. Your services land in the same container as the server's internal bindings.

## Generate readable thread names

`thread_name_generator` takes `none` (the default, also when the key is unset or `null`; threads stay unnamed but are saved), `random` (a random name), `first_message` (the user's first message, whitespace collapsed, cut to at most 60 characters on a word boundary) or a `module:attr` path to your own generator. The server saves every generated name after the run. To write your own, subclass `ThreadNameGenerator`. It gets the user's messages first, then the replies:

```python
# graph/thread_name_generator.py
from tenxgraph_api.src.app.utils.thread_name_generator import ThreadNameGenerator

class MyThreadNameGenerator(ThreadNameGenerator):
    async def generate_name(self, messages: list[str]) -> str:
        # Generate a name based on the first message, an LLM call, or your own logic.
        return "thoughtful-conversation"
```

```json
{
  "agent": "graph.react:app",
  "thread_name_generator": "graph.thread_name_generator:MyThreadNameGenerator"
}
```

To pick a built-in choice, set `"thread_name_generator": "first_message"`.

Thread names appear in the `/v1/threads` response.

## Enable authentication and authorization

These features have their own guides and require coordination:

| Feature | Guide | What it controls |
|---|---|---|
| `auth` | [Authentication](/docs/server/auth) | Who can call the server (JWT, custom), what each role may do, and how far each role sees (`own`, `tenant`, `all`) |
| `cache_store.rate_limit` | [Rate limiting](/docs/server/rate-limiting) | How many requests per window |
| `cache_store.token_revocation` | [Authentication](/docs/server/auth) | Refuse tokens you revoked |

A minimally secured production config looks like this:

```json
{
  "agent": "graph.react:app",
  "auth": "jwt",
  "cache_store": {
    "type": "redis",
    "rate_limit": {
      "enabled": true,
      "requests": 100,
      "window": 60,
      "by": "user"
    },
    "token_revocation": true
  }
}
```

- `"auth": "jwt"` needs `JWT_SECRET_KEY` (32+ bytes for HS*; shorter keys stop boot in production). `JWT_ALGORITHM` defaults to `HS256`.
- With auth on, threads, memories and files are private to their owner (reach `own`). See [Authentication](/docs/server/auth).
- `"cache_store": {"type": "redis"}` gives the API a Redis cache store, which shares the rate limit (and the run locks, caps and revocations) across all replicas. Without it the counters live in each process, so three replicas allow three times the configured limit, which is unsuitable for production.

## Choose the cache store (rate limits, run locks, token revocation)

The API keeps everything it shares between workers in one **cache store**: the per-thread run lock, run and WebSocket caps, idempotency state, token revocation and rate-limit counters. One `cache_store` object picks it and also holds the two settings the store backs, `rate_limit` and `token_revocation`:

| Key | Meaning |
|---|---|
| `type` | `memory` (default, also when `cache_store` or `type` is absent), `redis` or `custom`. |
| `url` | Type `redis` only, optional. Empty uses the `REDIS_URL` environment variable. A value you set wins, as a literal or `$VAR` / `${VAR}`; an unset variable stops startup. |
| `path` | Type `custom` only, required. A `module:attr` path to your `BaseCacheStore` (an instance or a zero-argument factory). See [Bring your own backend](/docs/server/bring-your-own-backend). |
| `rate_limit` | The rate limit object. See [Rate limiting](/docs/server/rate-limiting). |
| `token_revocation` | `true`, `false` or an object. See [Authentication](/docs/server/auth). |

Reference: [BaseCacheStore](/docs/reference/api-cli/cache-store) · Source: [base.py](https://github.com/10xGraph/10xgraph-api/blob/main/tenxgraph_api/src/app/core/cache_store/base.py)

```json
{
  "agent": "graph.react:app",
  "cache_store": {
    "type": "redis",
    "url": "${CACHE_REDIS_URL}"
  }
}
```

Leave out `url` to read `REDIS_URL`. `REDIS_URL` alone never selects Redis: a setup with no `cache_store` uses the in-memory store even when the variable is set. Top-level `redis`, `rate_limit` and `token_revocation` keys do not exist; a config that has one stops at load with an error that says where the setting goes.

The server logs one INFO line at boot that names the store and the config key it came from. Valkey, Dragonfly and KeyDB work through the Redis URL. With an in-memory store, each replica keeps its own locks, caps, rate-limit counters and token revocations, so use a shared store once you run more than one worker.

## What is on by default

This table shows what each setting does when its key is absent from `10xgraph.json`, and what `10xgraph init` writes for each setup.

| Setting | Key absent | Quick setup | Full setup |
|---|---|---|---|
| Auth | Off: every request is accepted | `null` (off) | `jwt` |
| Roles and reach | Default permission set (all but `admin:*`), reach `own`, when auth is on. Nothing when auth is off | not written | not written (default set, reach `own`) |
| Cache store | In-memory, per process | not written (in-memory) | `memory` with Memory or SQLite storage, `redis` (URL from `REDIS_URL`) with Postgres storage or a worker |
| Rate limiting | Off | off | on: 100 requests per 60 seconds, by user (by IP with auth none), `fail_open` false |
| Token revocation | Off | off | on |
| ID generator | The graph's own generator | not written | not written |
| Thread naming | `none`: threads are saved without a name | not written (none) | `first_message` |
| WebSocket | Routes `/v1/graph/ws` and `/v1/graph/live` mounted; a warning if no WebSocket library is installed | `enabled: false` | `enabled: false` unless you pass `--websocket` |
| AG-UI | Off | `enabled: false` | `enabled: false` |
| Startup checks | On: checkpointer and store are fatal if unreachable; the cache store is fatal only with token revocation on (and auth set) or a rate limit with `fail_open` false, otherwise one warning | same | same |

Set `STARTUP_CHECKS=false` to skip the startup check. `10xgraph config` edits every row. See the [production checklist](/docs/server/production-checklist#startup-check) for the startup check and `/health/ready`.

## Set test and evaluation defaults

The optional `test` and `evaluation` blocks supply defaults for the `10xgraph test` and `10xgraph eval` commands. CLI flags always override these defaults:

```json
{
  "agent": "graph.react:app",
  "test": {
    "path": "tests",
    "coverage": true,
    "coverage_threshold": 80
  },
  "evaluation": {
    "directory": "evals",
    "output_dir": "eval_reports",
    "threshold": 0.9
  }
}
```

With this configuration, `10xgraph test` runs tests from `tests/` with coverage reporting. Pass a different path to override:

```bash
10xgraph test tests/unit/            # uses tests/unit/ instead
10xgraph test --coverage             # enables coverage (default is on here)
10xgraph eval --output ci_reports/   # overrides output_dir
10xgraph eval --threshold 0.95       # overrides threshold
```

Test criteria come from your test files. Evaluation criteria come from a `confeval.py` file in your evals directory. See [Run evals](/docs/testing/run-evals) for details.

## Enable AG-UI for client-side agents

The `ag_ui` key exposes an AG-UI endpoint so frameworks like CopilotKit can run your agent in a browser or desktop context:

```json
{
  "agent": "graph.react:app",
  "ag_ui": {
    "enabled": true,
    "allow_client_tools": true
  }
}
```

This needs `pip install "10xgraph-api[ag-ui]"`. See [Serve over AG-UI](/docs/server/ag-ui) for `allow_client_tools` and the rest.

## Control WebSocket connections

The `websocket` key manages connection limits for `/v1/graph/ws` (streaming) and `/v1/graph/live` (realtime):

```json
{
  "agent": "graph.react:app",
  "websocket": {
    "max_connections": 1000,
    "max_connections_per_user": 10,
    "realtime_models": ["gemini-3.8-live"],
    "realtime_client_overrides": ["voice", "modalities", "vad"]
  }
}
```

- `max_connections` caps the concurrent WebSocket connections (default 1000).
- `max_connections_per_user` prevents a single authenticated user from hogging all slots (default 10). Set to `0` or `null` for unlimited.
- `realtime_models` lists the models a `/v1/graph/live` client may request (empty by default, meaning clients cannot choose).
- `realtime_client_overrides` lists the session options a `/v1/graph/live` client may set in its init frame: any of `voice`, `modalities`, `vad` and `system_prompt`. The default is `["voice", "modalities", "vad"]`. `system_prompt` replaces the agent's instructions, so list it only when every caller is trusted to rewrite them.
- `enabled` set to `false` leaves `/v1/graph/ws` and `/v1/graph/live` out of the app.

When a shared cache store is configured (`cache_store` of type `redis` or `custom`), the connection caps are shared by all workers and replicas. Without one, each process counts its own connections, so the real cap is the limit times the number of workers. If a worker dies, its slots expire on their own. If the cache store is unreachable, each process counts its own connections until it is back.

## Limit concurrent runs per user

`runs.max_concurrent_per_user` caps the graph runs (invoke, stream, AG-UI) one verified user can have in flight (default 10). Over the cap, the request gets `429`. Set it to `0` or `null` for no cap. Requests with no verified user (auth off) are not capped. Like the WebSocket caps, the count is shared across workers and replicas through the cache store when a shared one is configured, and per process otherwise.

```json
{
  "agent": "graph.react:app",
  "runs": { "max_concurrent_per_user": 10 }
}
```

## Control who can read the graph structure

`GET /v1/graph`, `GET /v1/graph/tools` and `GET /v1/graph:StateSchema` expose node names, tool schemas and the state schema. They need the `graph:read` permission. The default permission set includes it. To hide the graph structure from a role, leave `graph:read` out of that role's `permissions` in `auth.roles`; a refusal is `403`. With auth off there is no identity, so these routes stay open.

The old `graph_introspection` key refuses to boot.

## Keys the server owns in request config

A client can send a `config` object with a run, and your nodes and tools can read its keys. The server drops the keys it owns, such as `user`, `credential` and `remote_tools`, and identity comes from the verified token, never from config. Which other keys a client may send in `config` and in state is set by `runs.config_keys` and `runs.state_keys`; see [runs](/docs/reference/api-cli/configuration#runs).

## Configure per environment

Use separate config files and select one at startup:

```
config/
  dev.json
  staging.json
  prod.json
```

```bash
# Development: auto-reload, all features open
10xgraph dev --no-open --config config/dev.json

# Production-like local run: no reload, production checks on
# (for real deployments use `10xgraph build`, see the deploy guide)
MODE=production 10xgraph dev --no-open --config config/prod.json --no-reload
```

A typical dev config:

```json
{
  "agent": "graph.agent:app",
  "env": ".env"
}
```

A typical prod config:

```json
{
  "agent": "graph.agent:app",
  "env": ".env",
  "auth": "jwt",
  "store": "graph.dependencies:store",
  "cache_store": {
    "type": "redis",
    "rate_limit": {
      "enabled": true,
      "requests": 100,
      "window": 60,
      "by": "user",
      "trusted_proxy_headers": true,
      "trusted_proxy_hops": 1,
      "fail_open": true
    },
    "token_revocation": true
  }
}
```

Before you deploy, go through the [production checklist](/docs/server/production-checklist).

## Common configuration issues

| Symptom | Solution |
|---|---|
| `ModuleNotFoundError` or import fails | The module path is spelled correctly and exists in your project. Test with `python -c "from module import attr"`. |
| `AttributeError: module has no attribute` | `graph.react:app` expects an `app` variable in the `graph/react.py` file. Check the name and that it is a compiled graph. |
| Checkpointer connection fails | The Postgres DSN is correct and the database is reachable. Test: `psql <dsn>`. The Redis URL is reachable: `redis-cli -u <url> ping`. |
| 500 `JWT_SETTINGS_NOT_CONFIGURED` on requests | `JWT_SECRET_KEY` is not set. Export it, or set `"env": ".env"` and add it there. |
| Rate limiting not working on multi-replica setup | Set `"cache_store": {"type": "redis"}` (with `REDIS_URL` set, or a `url`) so the cache store is shared. Ensure all replicas point to the same Redis instance. |
| Threads visible to users who did not create them | Check that `auth` is on and that no role has reach `tenant` or `all` for them. `GET /v1/me` shows the resolved reach. Check that all replicas use the same config. |
| Refuses to boot naming `authorization` | The key is removed. See [Upgrade to 1.0](/docs/project/upgrade-to-1.0#auth-roles-and-reach). |

For a complete list of configuration keys, defaults, and types, see the [configuration reference](/docs/reference/api-cli/configuration).
