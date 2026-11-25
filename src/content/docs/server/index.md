---
title: API server overview
seoTitle: "10xGraph API server"
description: "The 10xGraph API server handles FastAPI endpoints for graph invocation, streaming, threading, memory, media, and observability with auth, rate limiting, and WebSocket."
section: "API server"
order: 10
label: Overview
updated: "2026-11-25"
---

The 10xGraph API server runs your compiled graph behind authentication, role-based access, per-user data isolation, durable thread state, rate limits, metrics and logs. Your graph code stays free of infrastructure code.

## What the server does for you

Running your graph behind `10xgraph-api` gives you these guarantees without code in your agent. Each row links to the page that explains it.

| Guarantee | What it means | Details |
| --- | --- | --- |
| Authentication | JWT or your own `BaseAuth` on every route except `/ping` and `/health/ready`. You must configure it: `auth: null` is allowed, even in production. | [Authentication](/docs/server/auth) |
| Ownership isolation | With auth on, every query is filtered by the caller's role reach (`own` by default, or `tenant` / `all` if you configure it). A thread outside the caller's reach answers 404 before the model runs. Runs and state writes always stay on the caller's own threads. | [Thread ownership](/docs/server/auth) |
| Scoped authorization | Per-route scopes, and a boot-time route guard that refuses to start if any non-public route has no permission check. | [Authorization scopes](/docs/guides/authorization-scopes) |
| Input rules | Request size limit, client messages limited to the `user` role, built-in state fields not writable, `current_node` and state values validated. | [Invoke and stream](/docs/server/invoke-and-stream), [CORS and security headers](/docs/server/cors-and-security-headers) |
| Rate limits and run caps | Sliding-window limits (counters in the cache store: memory or Redis) and a per-run timeout (300 s by default in production). | [Rate limiting](/docs/server/rate-limiting) |
| Production mode | `MODE=production` validates itself at startup, turns off `/docs`, and hides 5xx error text. | [Production checklist](/docs/server/production-checklist) |
| Durable state | Threads, state and messages go through your checkpointer; with `PgCheckpointer` they survive restarts and are shared across replicas. | [Backup and restore](/docs/server/backup-and-restore), [Kubernetes](/docs/server/kubernetes) |
| Deploy files | `10xgraph build` writes a non-root Dockerfile and optional Compose and Kubernetes files. | [Deploy](/docs/server/deploy) |
| Observability | Metrics (off until you configure `metrics`), JSON logs with `LOG_FORMAT=json`, an optional audit log, Sentry and OpenTelemetry hooks, and per-thread run traces in development. | [Observability](/docs/server/observability) |

For the reasoning behind these and the limits of what the server protects, read [Production readiness](/docs/production), the [security model](/docs/production/security-model) and [what 10xGraph does not protect](/docs/production/limits).

## API routes by function

The server organizes its endpoints into logical groups. Here is the complete route map:

| Group | Prefix | Auth required | What it does |
| --- | --- | --- | --- |
| **Health** | `/ping` | No | Unauthenticated liveness check (the Prometheus scrape path, when on, is also public); returns `200 OK` while the process is up. `/health/ready` (also unauthenticated) checks the backends and returns 200 or 503. Used by load balancers and orchestrators. |
| **Graph** | `/v1/graph/*` | Yes | Invoke and stream the graph (`invoke`, `stream`), read its structure (`GET /v1/graph`, `GET /v1/graph/tools`), manage runs (`stop`, `fix`), and read the state schema (`GET /v1/graph:StateSchema`). Streaming returns NDJSON (one event per line). |
| **Threads** | `/v1/threads/*` | Yes | List and delete threads; read, update and clear thread state; list, read and delete messages, and set message feedback. Requires a checkpointer; without one, threads are not persisted. |
| **Tasks** | `/v1/tasks/*` | Yes | Start, schedule, read and cancel background tasks run by `10xgraph worker`. Only on with a `worker` key in `10xgraph.json`; see [Background tasks](/docs/server/background-tasks). |
| **Store** | `/v1/store/*` | Yes | Semantic memory CRUD and search: save memories, list and retrieve them, forget specific entries, and search across all stored memories. Requires a store backend; see [Use memory store](/docs/guides/use-memory-store). |
| **WebSocket** | `/v1/graph/ws`, `/v1/graph/live` | Yes | Two WebSocket endpoints for streaming: `/ws` for traditional streaming (events as JSON frames), `/live` for realtime audio and bidirectional messaging. Choose based on your transport needs. |
| **AG-UI** | `/v1/ag-ui` | Yes | Run the graph over the AG-UI protocol for CopilotKit and other AG-UI-compatible clients. Off by default; enable with `ag_ui.enabled: true` in `10xgraph.json`. Requires the `ag-ui` SDK extra. |
| **Media/Files** | `/v1/files/*` | Yes | Upload, retrieve, and introspect multimodal files (images, audio, documents): `POST /v1/files/upload`, `GET /v1/files`, `GET /v1/files/{id}`, `/info`, `/url` (signed URL) and `DELETE /v1/files/{id}`. |
| **Config** | `/v1/config/multimodal` | Yes | Read the server's multimodal configuration (supported MIME types, size limits, extraction settings). |
| **Observability** | `/v1/observability/{thread_id}` | Yes | Retrieve a reconstructed run trace for a thread (spans, events, token usage). Development only: returns empty in `MODE=production`. |

For detailed route signatures and response shapes, see the [REST API reference](/docs/reference/rest-api/conventions).

What `MODE=production` changes is listed in the [production checklist](/docs/server/production-checklist#already-done-by-the-server-in-production).
