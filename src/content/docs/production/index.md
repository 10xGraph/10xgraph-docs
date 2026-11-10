---
title: Platform overview
seoTitle: "10xGraph platform: what runs around your code"
description: "What 10xGraph provides as infrastructure for AI applications: what is on by default in 1.0, what is opt-in, what is not provided, and what you still own."
section: "Platform"
order: 0
label: Platform overview
updated: "2026-11-10"
faq:
  - q: "Is 10xGraph production ready?"
    a: "The server enforces reach-scoped thread access (own thread by default), permission checks, input limits, run limits and production-mode checks by default, and stores state durably with Postgres. It is at its 1.0 release candidate, and you still own auth configuration, secrets, TLS, backups and your tools' own authorization. The limits page lists what it does not protect."
  - q: "Do I have to write the API server myself?"
    a: "No. You write the graph and point 10xgraph.json at it. 10xgraph-api generates the REST and WebSocket server, and 10xgraph build generates the Dockerfile, compose file and Kubernetes manifest."
  - q: "What happens if I run in production without auth?"
    a: "The server starts and is open. Nothing refuses auth set to null, even with MODE=production. Set auth to jwt or a custom BaseAuth class before you expose the server."
---

10xGraph is open-source, self-hosted infrastructure for AI applications. You write the agents, tools and tasks; 10xGraph runs them behind an API server with authentication, role-based access, tenant isolation, durable state in Postgres and Redis, background jobs, metrics and tracing, and generates Docker and Kubernetes deploy files. MIT licensed, by 10xScale. Formerly Agentflow.

This page lists what the platform provides, what you switch on, and what it does not provide. It is at its 1.0 release candidate.

## Capabilities

"Available in 1.0" means it ships and, once the server is configured, runs without extra setup. "Opt-in" means the config key or install that turns it on. "Not provided" means 10xGraph does not do it; the [control mapping](/docs/production/control-mapping) lists every gap in full.

| Capability | Available in 1.0 | Opt-in (what turns it on) | Not provided |
|---|---|---|---|
| [API server and streaming](/docs/server) | REST, SSE streaming and WebSocket routes generated from your graph; liveness and readiness probes | Run with `10xgraph dev` or the image from `10xgraph build` | A hosted service |
| [Auth](/docs/server/auth) | JWT and custom `BaseAuth`; the `10xgraph init` production template turns it on | `auth` in `10xgraph.json` (it is off until you set it) | An identity provider, user management |
| [RBAC and reach](/docs/server/auth) | Permissions per route; reach `own`, `tenant` or `all` | `roles` and `tenant_claims` inside the `auth` object | Per-tool permissions (permissions apply per route) |
| [Tenant isolation](/docs/guides/multi-tenant-data) | Tenant columns you declare, filled from the verified identity | `tenant_columns` on `PgCheckpointer` and `PgVectorStore`; Postgres row-level security with `row_level_security` | Tenant isolation without declared tenant columns, or on SQLite and in-memory checkpointers |
| [Durable state](/docs/guides/set-up-checkpointing) | Versioned thread state in Postgres or SQLite; Redis as hot cache | Pass `PgCheckpointer` or the SQLite checkpointer to `compile()` | Backups and retention policy |
| [Long-term memory](/docs/guides/use-pgvector-store) | pgvector store in the same Postgres, or Qdrant, served at `/v1/store` | Pass the store to `compile()`; install the `pgvector` or `qdrant` extra | Embeddings hosting |
| [Cache store](/docs/server/bring-your-own-backend) | In-memory by default (per process) | `cache_store.type` `redis` or `custom` for run locks, caps, rate limits and revocation shared across workers | Eviction-safe Redis tuning |
| [Rate limiting](/docs/server/rate-limiting) | Sliding window by IP, user or global | `cache_store.rate_limit` | Network-edge or volumetric DDoS protection |
| [Replay-safe tools](/docs/concepts/replay-safe-tools) | Finished tool calls are recorded and skipped on resume | A ledger-capable checkpointer (`PgCheckpointer`) | Exactly-once for side effects; send idempotency keys |
| [Background jobs and scheduler](/docs/server/background-tasks) | TaskIQ broker, `10xgraph worker`, `10xgraph scheduler`, `/v1/tasks` routes | `worker` config and a broker (Redis Streams, RabbitMQ or Kafka); results and schedules live in Redis | Exactly-once delivery (it is at-least-once) |
| [Metrics (Prometheus)](/docs/guides/metrics-prometheus-grafana) | Scrape route or OTLP push for the API and the worker | `metrics` block in `10xgraph.json` | Dashboards and alert rules |
| [Tracing](/docs/server/observability) | OTLP, [Phoenix](/docs/guides/send-traces-to-phoenix), [Logfire and LangSmith](/docs/guides/send-traces-to-logfire-langsmith) through the OTEL publisher | `OTEL_ENABLED` and the `otel` extra, or a publisher | A trace backend |
| [Audit log and JSON logs](/docs/server/audit-log) | Metadata-only audit events and structured JSON log lines | `audit` block in `10xgraph.json` and `LOG_FORMAT=json`; the production template turns them on | Log storage, retention and tamper protection (your log pipeline does that) |
| [Deploy files](/docs/server/deploy) | Dockerfile, Compose and Kubernetes manifest from `10xgraph build` | `--docker-compose`, `--k8s` | Cluster, TLS, secrets and backups |
| [TypeScript client](/docs/client) | `10xgraph-client` covers the API: invoke, stream, threads, memory, files | `npm install 10xgraph-client` | React hooks |
| [Playground](/docs/server/playground) | Opens with `10xgraph dev` | Not for production; run trace is off in production mode | Use by end users |
| [Evals](/docs/testing) | `10xgraph eval` writes JSON and HTML reports | Eval sets and criteria you write | Eval endpoints in the API |

Reference: [BaseAuth](/docs/reference/api-cli/auth) · Source: [base_auth.py](https://github.com/10xGraph/10xgraph-api/blob/main/tenxgraph_api/src/app/core/auth/base_auth.py)

## What the server does by default, and what you configure

| Concern | What the server does by default | What you configure | Read more |
|---|---|---|---|
| Authentication | Nothing is authenticated until you choose a method. With `auth` set, every non-public route requires a valid identity. A JWT must carry a non-empty `user_id`, else 401. | `auth`: `"jwt"` (needs `JWT_SECRET_KEY`, `JWT_ALGORITHM`) or `{"method": "custom", "path": "module:attr"}` for your own `BaseAuth`. Optional `cache_store.token_revocation`. | [Auth](/docs/server/auth) |
| Thread ownership and user isolation | With auth on, every storage query is scoped to the caller (reach `own` by default). By default only a thread's owner can read, run or delete it. A role with reach `tenant` or `all` can also read, list and delete other users' threads (runs and writes stay on the caller's own); a thread outside the caller's reach answers 404 before the graph runs. Threads and memories are scoped per user. | Pass a checkpointer to `graph.compile(checkpointer=...)`. `enforce_user_isolation` on `PgCheckpointer` is on by default; turn it off only for a single-tenant app. | [Auth](/docs/server/auth), [Checkpointing and threads](/docs/concepts/checkpointing-and-threads) |
| Scoped authorization | Routes check `resource:action` permissions (for example `graph:invoke`). With no roles configured every caller gets the default set (all but `admin:*`); a token `scope` or `scopes` claim can only narrow it. At startup a route guard refuses to boot if any non-public route has no permission guard; only `/ping` and `/health/ready` are public. Graph introspection routes need `graph:read`. | Add `roles` to the `auth` object, or override `BaseAuth.authorize`. | [Auth](/docs/server/auth) |
| What clients may send | Reserved config keys (`user`, `user_id`, `remote_tools`, `file_tool_root`, `tool_timeout`, `max_parallel_tool_calls` and others) are rejected. `context_summary` and `execution_meta` are never client-writable. Client messages must have the `user` role; a `tool` message is accepted only as the answer to a pending remote tool call. Server-side thread ids are the default: a client cannot invent one. | `runs.config_keys` and `runs.state_keys` allow-lists (422 on other keys). `runs.thread_ids`: `server` (default) or `client`. | [Configure](/docs/server/configure) |
| Rate limits and per-user run cap | Each user may have 10 HTTP runs in flight (`runs.max_concurrent_per_user`); over that is 429. Rate limiting is off until `cache_store.rate_limit` is set. | `cache_store.rate_limit` with `by` (`ip`, `user`, `global`), `requests`, `window`, `backend`. `runs.max_concurrent_per_user`, `websocket.max_connections_per_user`. | [Rate limiting](/docs/server/rate-limiting) |
| Request size and run timeouts | Request bodies are capped at 10 MB (`MAX_REQUEST_SIZE`). In production a run that exceeds 300 seconds is stopped (invoke returns 504, a stream ends with an error chunk). | `MAX_REQUEST_SIZE`. `runs.timeout` in seconds, or `null` for no limit. | [Configure](/docs/server/configure) |
| One run per thread | A thread runs one request at a time. A second request waits up to 30 seconds, then gets 409 "thread is busy". The lock is shared through Redis when configured. | `on_busy` in the request: `wait` (default) or `cancel` (stops the active run). | [Durability and concurrency](/docs/guides/durability-and-concurrency) |
| Production mode | `MODE=production` is validated: an unknown value refuses to start. It turns on strict checks (wildcard `ORIGINS` or `ALLOWED_HOST` refuses to start), turns API docs off, hides 5xx error details and the text of error chunks, and turns debug mode off. | `MODE=production`, `ORIGINS`, `ALLOWED_HOST`, `STRICT_PRODUCTION_CHECKS`. | [Production checklist](/docs/server/production-checklist), [CORS and headers](/docs/server/cors-and-security-headers) |
| Outbound safety | External media URLs in client input are checked by the graph's `MediaFetchPolicy` before the run; the policy blocks private and cloud-metadata addresses and limits download size, type and time. The prebuilt `fetch_url` tool blocks private and local hosts. The prebuilt file tools are confined to a root you set in code and have deny rules. | `media_policy` on `compile()`, `create_file_tools(root=...)`. | [Web tools](/docs/guides/prebuilt/web-tools), [File tools](/docs/guides/prebuilt/file-tools), [Media and files](/docs/concepts/media-and-files) |
| Durable state | With `PgCheckpointer`, state lives in PostgreSQL, with Redis as a hot cache. Writes are versioned per thread (compare-and-swap), and a stale run cannot move the cache backwards. | `PgCheckpointer` passed to `compile()`, `DATABASE_URL`, `REDIS_URL`. | [Set up checkpointing](/docs/guides/set-up-checkpointing) |
| Replay-safe tools | A tool call that finished before a crash is recorded in a ledger and not run again on resume (invoke path, with a ledger-capable checkpointer). | `PgCheckpointer`; send an idempotency key to external services as a second layer. | [Replay-safe tools](/docs/concepts/replay-safe-tools) |
| Observability | OpenTelemetry traces and metrics when enabled. Sentry reports only 5xx server faults and does not send default PII. Core log output redacts known secret formats. | `OTEL_ENABLED`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `SENTRY_DSN`, `LOG_LEVEL`. | [Observability](/docs/server/observability) |
| Deployment | `10xgraph build` writes a Dockerfile that runs Gunicorn, with optional `docker-compose.yml` and `k8s.yaml`. `GET /ping` is liveness and `GET /health/ready` is readiness (checkpointer, store, cache store). | `10xgraph build --docker-compose --k8s`. | [Deploy](/docs/server/deploy), [Kubernetes](/docs/server/kubernetes) |
| Scaling | Workers hold no conversation state; it lives in the checkpointer. With a shared cache store configured (Redis), run caps, thread locks and token revocations are shared across workers. | `cache_store.type` `redis` (or `custom`), two or more instances. | [Scaling and reliability](/docs/production/scaling) |

The first three rows decide who can reach what. If you only do one thing beyond the quickstart, configure `auth`.

## What you still own

The server cannot do these for you.

- **Auth must be set.** `auth: null` starts an open server, also in production. Nothing refuses it.
- **Secrets.** `JWT_SECRET_KEY` (32 or more random characters), provider API keys and database URLs come from your secret store, not from the repository.
- **Origins and hosts.** Set `ORIGINS` and `ALLOWED_HOST` to your real values.
- **Your tools' own authorization.** A tool that reads a customer record must check that the caller may see it. The server authorizes the request, not the business logic inside your tool.
- **Prompts and model behavior.** Validators, approval steps and tool allow-lists bound what a model can be talked into. They do not remove prompt injection.
- **Backups and retention.** Back up PostgreSQL and decide how long threads live.
- **TLS.** Terminate it at your load balancer or ingress.

The [limits page](/docs/production/limits) explains each of these and what to do.

## The path to production

1. **Start from the production template.** Run `10xgraph init --template production`. It scaffolds the graph, an auth class, evals and tests, and a `10xgraph.json` with auth and rate limiting.
2. **Configure.** Set `auth`, pass a `PgCheckpointer` to `compile()`, set `MODE=production`, `ORIGINS`, `JWT_SECRET_KEY`, `DATABASE_URL` and `REDIS_URL`. Read [Security in five minutes](/docs/get-started/security-in-five-minutes), then the [security model](/docs/production/security-model), and test with [Test before production](/docs/testing/before-production).
3. **Build and deploy.** Run `10xgraph build --docker-compose --k8s`, then follow the [production checklist](/docs/server/production-checklist) and the [scaling guide](/docs/production/scaling). For how the pieces fit, see the [architecture](/docs/production/architecture). To see what teams build with it, browse [/build](/build).
