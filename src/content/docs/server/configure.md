---
title: Configure 10xgraph.json
description: Task guide for setting the common 10xgraph.json keys, wiring a checkpointer, store and auth, and keeping separate configs per environment.
section: "API server"
group: "Basics"
order: 30
label: Configure 10xgraph.json
updated: "2026-10-27"
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

The server uses the compiled graph's checkpointer; the `checkpointer` key in `10xgraph.json` is recognized but not applied, so you can remove it if it is present.

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

The server loads your container at startup and makes it the global instance. Your services land in the same container as the server's internal bindings, so they integrate seamlessly. This is also where you bind a custom `BaseRateLimitBackend` if you use `"backend": "custom"` for rate limiting.

## Generate readable thread names

New threads are assigned UUIDs by default. To give them human-readable names instead, set `thread_name_generator` to a `module:ClassName` path. The server calls this generator when a new thread is created:

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

Thread names appear in logs, dashboards, and the `/v1/threads` API response, making it easier to identify conversations at a glance.

## Enable authentication and authorization

These features have their own guides and require coordination:

| Feature | Guide | What it controls |
|---|---|---|
| `auth` | [Authentication](/docs/server/auth) | Who can call the server (JWT, custom) |
| `authorization` | [Authentication](/docs/server/auth) | Who can access each thread (ownership, RBAC) |
| `rate_limit` | [Rate limiting](/docs/server/rate-limiting) | How many requests per window |

A minimally secured production config looks like this:

```json
{
  "agent": "graph.react:app",
  "auth": "jwt",
  "authorization": "ownership",
  "rate_limit": {
    "enabled": true,
    "backend": "redis",
    "requests": 100,
    "window": 60,
    "by": "user",
    "redis": { "url": "${REDIS_URL}" }
  }
}
```

- `"auth": "jwt"` requires `JWT_SECRET_KEY` (at least 32 characters; shorter keys are rejected in production) and `JWT_ALGORITHM` (for example `HS256`) in the environment. See [Authentication](/docs/server/auth) for custom auth.
- `"authorization": "ownership"` makes threads private to their creator. With the default `runs.thread_ids` of `"server"`, it also refuses thread ids the server did not create (see [`runs.thread_ids`](/docs/reference/api-cli/configuration#thread_ids)). With `allow_all`, any authenticated user who knows a thread ID can read it.
- The rate limit `backend: "redis"` shares the limit across all replicas. The `"memory"` backend counts per process, so three replicas allow three times the configured limit, making it unsuitable for production.

## Share a Redis connection for the thread cache

The top-level `redis` key is a URL string used by the optional shared thread-ownership cache. This is separate from `rate_limit.redis`:

```json
{
  "agent": "graph.react:app",
  "redis": "redis://localhost:6379/0",
  "rate_limit": { "backend": "redis", "redis": { "url": "redis://localhost:6379/1" } }
}
```

If the `redis` key is not set, the server falls back to the `REDIS_URL` environment variable. With neither, the ownership cache is per-process (an L1 cache with a 30 second TTL; with Redis, an L2 cache with a 1 hour TTL). Without a shared cache, each replica maintains its own view of which user owns each thread, leading to inconsistent access control across replicas.

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

When enabled, `POST /v1/ag-ui` streams AG-UI events. This feature requires `pip install "10xgraph-api[ag-ui]"`. Set `allow_client_tools` to `false` to accept only the tools you explicitly declare in `remote_tools` (tools the client sends in each request are rejected). By default, it is `true`, allowing clients to offer ad-hoc tools as long as they fit size limits.

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

When `redis` (or `REDIS_URL`) is configured, the connection caps are shared by all workers and replicas through Redis. Without Redis, each process counts its own connections, so the real cap is the limit times the number of workers. If a worker dies, its slots expire on their own. If Redis is unreachable, the server allows the connection and logs the error.

## Limit concurrent runs per user

`runs.max_concurrent_per_user` caps the graph runs (invoke, stream, AG-UI) one verified user can have in flight (default 10). Over the cap, the request gets `429`. Set it to `0` or `null` for no cap. Requests with no verified user (auth off) are not capped. Like the WebSocket caps, the count is shared across workers and replicas through Redis when `redis` or `REDIS_URL` is set, and per process otherwise.

```json
{
  "agent": "graph.react:app",
  "runs": { "max_concurrent_per_user": 10 }
}
```

## Control who can read the graph structure

`graph_introspection` decides who may call `GET /v1/graph`, `GET /v1/graph/tools` and `GET /v1/graph:StateSchema`, which expose node names, tool schemas and the state schema:

- `"open"`: any authenticated user.
- `"scoped"`: only identities that carry the `graph:read` scope (from JWT claims or an RBAC role). An identity with no scopes is refused with `403`.

The default is `"scoped"` when `MODE=production` and `"open"` otherwise. With auth off there is no identity, so these routes stay open in either mode.

```json
{
  "agent": "graph.react:app",
  "graph_introspection": "open"
}
```

## Keys the server owns in request config

A client can send a `config` object with a run, and your nodes and tools can read its keys. The server drops these keys from client config before the graph sees them (no error is returned): `authz`, `user`, `user_id`, `remote_tools`, `ag_ui`, `file_tool_root`, `workspace_root`, `tool_timeout`, `node_timeout`, `max_parallel_tool_calls`, `collection`, and any key that starts with `_`. Identity comes from the verified token, never from config. To narrow the rest, list allowed keys in `runs.config_keys` and `runs.state_keys`. See [Invoke and stream](/docs/server/invoke-and-stream).

## Environment variable expansion in Redis URLs

Only the `rate_limit.redis` configuration supports environment variable expansion. Both `$VAR` and `${VAR}` forms work:

```json
{
  "agent": "graph.react:app",
  "rate_limit": {
    "backend": "redis",
    "redis": { "url": "${REDIS_URL}" }
  }
}
```

If a variable is missing, the server fails at startup with an error rather than silently starting without rate limiting. This is deliberate: a misconfigured server is worse than one that refuses to start.

All other configuration keys in `10xgraph.json` are read literally. Keep credentials out of the file: use the environment, `.env` files, or your orchestration platform.

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

# Production-like local run: no reload, hardened settings
# (for real deployments use `10xgraph build`, see the deploy guide)
MODE=production 10xgraph dev --no-open --config config/prod.json --no-reload
```

A typical dev config:

```json
{
  "agent": "graph.agent:app",
  "env": ".env",
  "authorization": "allow_all"
}
```

A typical prod config (see production checklist below):

```json
{
  "agent": "graph.agent:app",
  "env": ".env",
  "auth": "jwt",
  "authorization": "ownership",
  "store": "graph.dependencies:store",
  "redis": "redis://redis:6379/0",
  "rate_limit": {
    "enabled": true,
    "backend": "redis",
    "requests": 100,
    "window": 60,
    "by": "user",
    "redis": { "url": "${REDIS_URL}", "prefix": "10xgraph:rate-limit" },
    "trusted_proxy_headers": true,
    "trusted_proxy_hops": 1,
    "fail_open": true
  }
}
```

## Production decisions checklist

Before deploying to production, make five explicit decisions:

### 1. Turn on authentication

With `auth` unset or `null`, every request is accepted. This is fine for internal development. In production, set `"auth": "jwt"` with `JWT_SECRET_KEY` (at least 32 characters) and `JWT_ALGORITHM` in the environment, or point at a custom `BaseAuth` subclass. See [Authentication](/docs/server/auth).

### 2. Set authorization policy

If `authorization` is unset, the server uses `ownership` whenever auth is configured or `MODE=production`, and `allow_all` only with auth off in development. With `allow_all`, any authenticated user who knows a thread ID can read that conversation. In production, set `"authorization": "ownership"` so threads are visible only to their creator. Alternatively, implement a custom `AuthorizationBackend` for role-based access control. A custom backend isolates users by default, because `isolation_scope()` returns `"owner"`. Return `"none"` from it only if users should share threads and memories. In development, `"allow_all"` is fine. Set it explicitly rather than relying on the `MODE` default.

### 3. Use a shared, durable checkpointer

`InMemoryCheckpointer` loses all threads on restart and is invisible to other replicas. In production, pass `PgCheckpointer` to `compile()` in your graph module. This ensures thread history survives restarts and is consistent across all replicas.

### 4. Set rate limit backend to Redis with multiple replicas

The `"memory"` backend counts per process, so with three workers you allow three times the configured limit. With multiple replicas, use `"backend": "redis"` and ensure all replicas point to the same Redis instance. Also set `trusted_proxy_hops` correctly: it counts from the right of the `X-Forwarded-For` header, so the value must match how many proxies sit in front of your server. Set it too high and a client can forge its own address to bypass limits.

### 5. Wire observability

A production agent you cannot trace is one you cannot debug. At minimum, set `MODE=production` in the environment (it turns debug off), and configure logging. See [Observability](/docs/server/observability).

## Verify before you deploy

Run the audit command to check your setup:

```bash
10xgraph audit
```

This checks the Python interpreter, the installed `10xgraph-api` and `10xgraph` packages, evaluation API compatibility, `10xgraph.json` (valid JSON, an `agent` value in `module:attribute` form, valid `remote_tools`), and whether port 8000 is free. It does not import your graph. It exits with status `0` if only warnings appear, or `1` if errors are found.

Then start the server and verify each control:

```bash
# 1. Config loads and graph imports
10xgraph dev --no-open --no-reload &

# 2. The health endpoint works
curl http://127.0.0.1:8000/ping

# 3. Auth is on: an unauthenticated call must be rejected (expect 401, not 200)
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:8000/v1/graph/invoke -d '{}'

# 4. Rate limiting is on: after 100 requests in 60 seconds, you get 429
for i in $(seq 1 120); do
  curl -s -o /dev/null -w "%{http_code} " http://127.0.0.1:8000/ping
done
```

Finally, verify that persistence survives a restart: start a thread by invoking without a `thread_id`, restart the server, and read the thread back via `/v1/threads/{thread_id}` using the id the server returned.

## Common configuration issues

| Symptom | Solution |
|---|---|
| `ModuleNotFoundError` or import fails | The module path is spelled correctly and exists in your project. Test with `python -c "from module import attr"`. |
| `AttributeError: module has no attribute` | `graph.react:app` expects an `app` variable in the `graph/react.py` file. Check the name and that it is a compiled graph. |
| Checkpointer connection fails | The Postgres DSN is correct and the database is reachable. Test: `psql <dsn>`. The Redis URL is reachable: `redis-cli -u <url> ping`. |
| `JWT_SECRET_KEY and JWT_ALGORITHM must be set` | Export both variables, or set `"env": ".env"` and add them there. The secret needs at least 32 characters. |
| Rate limiting not working on multi-replica setup | Set `rate_limit.backend` to `"redis"`, not `"memory"`. Ensure all replicas point to the same Redis instance. |
| Threads visible to users who did not create them | Set `"authorization": "ownership"` or implement a custom `AuthorizationBackend`. Check that all replicas use the same setting. |

For a complete list of configuration keys, defaults, and types, see the [configuration reference](/docs/reference/api-cli/configuration).
