---
title: Platform overview
seoTitle: "10xGraph platform: what runs around your code"
description: "What 10xGraph provides as infrastructure for AI applications: what is on by default in 1.0, what is opt-in, what is not provided, and what you still own."
section: "Platform"
order: 0
label: Platform overview
updated: "2026-11-25"
faq:
  - q: "Is 10xGraph production ready?"
    a: "The server enforces reach-scoped thread access (own thread by default), permission checks, input limits, run limits and production-mode checks by default, and stores state durably when you use `PgCheckpointer` (Postgres). You still own auth configuration, secrets, TLS, backups and the checks inside your tools. The limits page lists what it does not protect."
  - q: "Do I have to write the API server myself?"
    a: "No. You write the graph and point 10xgraph.json at it. 10xgraph-api generates the REST and WebSocket server, and 10xgraph build generates the Dockerfile, compose file and Kubernetes manifest."
---

10xGraph is open-source, self-hosted infrastructure for AI applications. You write the agents, tools and tasks; 10xGraph runs them behind an API server with authentication, role-based access, tenant isolation, durable state in Postgres and Redis, background jobs, metrics and tracing, and generates Docker and Kubernetes deploy files. MIT licensed, by 10xScale.

## Capabilities

"Available in 1.0" means it ships and, once the server is configured, runs without extra setup. "Opt-in" means the config key or install that turns it on. "Not provided" means 10xGraph does not do it; the [control mapping](/docs/production/control-mapping) lists every gap in full.

| Capability | Available in 1.0 | Opt-in (what turns it on) | Not provided |
|---|---|---|---|
| [API server and streaming](/docs/server) | REST, SSE streaming and WebSocket routes generated from your graph; liveness and readiness probes | Run with `10xgraph dev` or the image from `10xgraph build` | A hosted service |
| [Auth](/docs/server/auth) | JWT and custom `BaseAuth`; the `10xgraph init` Full setup turns it on | `auth` in `10xgraph.json` (it is off until you set it) | An identity provider, user management |
| [RBAC and reach](/docs/server/auth) | Permissions per route; reach `own`, `tenant` or `all` | `roles` and `tenant_claims` inside the `auth` object | Role design and assignment |
| [Tenant isolation](/docs/guides/multi-tenant-data) | Tenant columns you declare, filled from the verified identity | `tenant_columns` on `PgCheckpointer` and `PgVectorStore`; Postgres row-level security with `row_level_security` | Tenant isolation without declared tenant columns, or on SQLite and in-memory checkpointers |
| [Durable state](/docs/guides/set-up-checkpointing) | Versioned thread state in Postgres or SQLite; Redis as hot cache | Pass `PgCheckpointer` or the SQLite checkpointer to `compile()` | Backups and retention policy |
| [Long-term memory](/docs/guides/use-pgvector-store) | pgvector store in the same Postgres, or Qdrant, served at `/v1/store` | Pass the store to `compile()`; install the `pgvector` or `qdrant` extra | Embeddings hosting |
| [Cache store](/docs/server/bring-your-own-backend) | In-memory by default (per process) | `cache_store.type` `redis` or `custom` for run locks, caps, rate limits and revocation shared across workers | Eviction-safe Redis tuning |
| [Rate limiting](/docs/server/rate-limiting) | Sliding window by IP, user or global | `cache_store.rate_limit` | Network-edge or volumetric DDoS protection |
| [Replay-safe tools](/docs/concepts/replay-safe-tools) | Finished tool calls are recorded and skipped on resume | A ledger-capable checkpointer (`PgCheckpointer`) | Exactly-once for side effects; send idempotency keys |
| [Background jobs and scheduler](/docs/server/background-tasks) | TaskIQ broker, `10xgraph worker`, `10xgraph scheduler`, `/v1/tasks` routes | `worker` config and a broker (Redis Streams, RabbitMQ or Kafka); results and schedules live in Redis | Exactly-once delivery (it is at-least-once) |
| [Metrics (Prometheus)](/docs/guides/metrics-prometheus-grafana) | Scrape route or OTLP push for the API and the worker | `metrics` block in `10xgraph.json` | Dashboards and alert rules |
| [Tracing](/docs/server/observability) | OTLP, [Phoenix](/docs/guides/send-traces-to-phoenix), [Logfire and LangSmith](/docs/guides/send-traces-to-logfire-langsmith) through the OTEL publisher | `OTEL_ENABLED` and the `otel` extra, or a publisher | A trace backend |
| [Audit log and JSON logs](/docs/server/audit-log) | Metadata-only audit events and structured JSON log lines | `audit` block in `10xgraph.json` and `LOG_FORMAT=json`; the Full setup turns them on | Log storage, retention and [tamper protection](/docs/server/audit-log#tamper-protection) (your log pipeline or sink does that) |
| [Deploy files](/docs/server/deploy) | Dockerfile, Compose and Kubernetes manifest from `10xgraph build` | `--docker-compose`, `--k8s` | Cluster, TLS, secrets and backups |
| [TypeScript client](/docs/client) | `10xgraph-client` covers the API: invoke, stream, threads, memory, files | `npm install 10xgraph-client` | React hooks |
| [Playground](/docs/server/playground) | Opens with `10xgraph dev` | Not for production; run trace is off in production mode | Use by end users |
| [Evals](/docs/testing) | `10xgraph eval` writes JSON and HTML reports | Eval sets and criteria you write | Eval endpoints in the API |

For what the server enforces by default, see the [security model](/docs/production/security-model); for the request path, see [architecture](/docs/production/architecture).

What the server does not do for you (auth off, secrets, TLS, backups, prompt injection) is listed in [What 10xGraph does not protect](/docs/production/limits).

## The path to production

1. **Start from the Full setup.** Run `10xgraph init --mode full`. It scaffolds the graph, an auth class, evals and tests, and a `10xgraph.json` with auth and rate limiting.
2. **Configure.** Set `auth`, pass a `PgCheckpointer` to `compile()`, set `MODE=production`, `ORIGINS`, `JWT_SECRET_KEY`, `DATABASE_URL` and `REDIS_URL`. Read [Security in five minutes](/docs/get-started/security-in-five-minutes), then the [security model](/docs/production/security-model), and test with [Test before production](/docs/testing/before-production).
3. **Build and deploy.** Run `10xgraph build --docker-compose --k8s`, then follow the [production checklist](/docs/server/production-checklist) and the [scaling guide](/docs/production/scaling). For how the pieces fit, see the [architecture](/docs/production/architecture).
