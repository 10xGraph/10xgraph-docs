---
title: API server overview
seoTitle: "10xGraph API server"
description: "The 10xGraph API server handles FastAPI endpoints for graph invocation, streaming, threading, memory, media, and observability with auth, rate limiting, and WebSocket."
section: "API server"
order: 10
label: Overview
updated: "2026-10-27"
---

The 10xGraph API server is a FastAPI server that exposes your compiled graph as a production-ready REST and WebSocket API, handling graph invocation, streaming, thread state, media files, authentication, rate limiting, and observability. This section is the single source of truth for operating the 10xGraph API server.

## What the server does for you

Serving your graph with `10xgraph-api` gives you these guarantees without code in your agent. Each row links to the page that explains it.

| Guarantee | What it means | Details |
| --- | --- | --- |
| Authentication | JWT or your own `BaseAuth` on every route except `/ping` and `/health/ready`. You must configure it: `auth: null` is allowed, even in production. | [Authentication](/docs/server/auth) |
| Ownership isolation | In production (and whenever auth is on) a thread is readable and writable only by its creator; a foreign `invoke` is rejected with 403 before the model runs. | [Thread ownership](/docs/server/auth) |
| Scoped authorization | Per-route scopes, and a boot-time route guard that refuses to start if any non-public route has no permission check. | [Authorization scopes](/docs/guides/authorization-scopes) |
| Input rules | Request size limit, client messages limited to the `user` role, built-in state fields not writable, `current_node` and state values validated. | [Invoke and stream](/docs/server/invoke-and-stream), [CORS and security headers](/docs/server/cors-and-security-headers) |
| Rate limits and run caps | Sliding-window limits (memory or Redis) and a per-run timeout (300 s by default in production). | [Rate limiting](/docs/server/rate-limiting) |
| Production mode | `MODE=production` validates itself at startup, turns off `/docs`, and hides 5xx error text. | [Production checklist](/docs/server/production-checklist) |
| Durable state | Threads, state and messages go through your checkpointer; with `PgCheckpointer` they survive restarts and are shared across replicas. | [Backup and restore](/docs/server/backup-and-restore), [Kubernetes](/docs/server/kubernetes) |
| Deploy files | `10xgraph build` writes a hardened Dockerfile and optional Compose and Kubernetes files. | [Deploy](/docs/server/deploy) |
| Observability | Structured logs, metrics, Sentry and OpenTelemetry hooks, and per-thread run traces in development. | [Observability](/docs/server/observability) |

For the reasoning behind these and the limits of what the server protects, read [Production readiness](/docs/production), the [security model](/docs/production/security-model) and [what 10xGraph does not protect](/docs/production/limits).

## What the server does

Running `10xgraph dev` (add `--no-open` to skip the playground) starts a Uvicorn ASGI development server on port 8000 that exposes your compiled graph alongside infrastructure for real applications: stateful thread management, semantic memory, multimodal file handling, JWT or custom authentication, rate limiting, and structured logging and tracing. The server reads two inputs: your `10xgraph.json` configuration file (which graph to load, which auth backend, storage layer) and environment variables for secrets and runtime tunables. Your graph logic stays in Python; the server handles the transport layer, persistence, and cross-cutting concerns.

The server is mode-aware: development mode (`MODE=development`, the default) leaves CORS open; production mode (`MODE=production`) refuses wildcard CORS with credentials, turns off the `/docs` and `/redocs` pages unless you set their paths, and defaults to ownership-based thread isolation. A single codebase switches between modes via environment variables, so your Docker image works in both dev and production.

## API routes by function

The server organizes its endpoints into logical groups. Here is the complete route map:

| Group | Prefix | Auth required | What it does |
| --- | --- | --- | --- |
| **Health** | `/ping` | No | Unauthenticated health check; returns `200 OK` if the server is ready. Used by load balancers and orchestrators to route traffic. |
| **Graph** | `/v1/graph/*` | Yes | Invoke and stream the graph (`invoke`, `stream`), read its structure (`GET /v1/graph`, `GET /v1/graph/tools`), manage runs (`stop`, `fix`), and read the state schema (`GET /v1/graph:StateSchema`). Streaming returns NDJSON (one event per line). |
| **Threads** | `/v1/threads/*` | Yes | Manage thread state and history: list threads, read and update thread state, add, list, update and delete messages, and delete threads. Requires a checkpointer; without one, threads are not persisted. |
| **Store** | `/v1/store/*` | Yes | Semantic memory CRUD and search: save memories, list and retrieve them, forget specific entries, and search across all stored memories. Requires a store backend; see [Use memory store](/docs/guides/use-memory-store). |
| **WebSocket** | `/v1/graph/ws`, `/v1/graph/live` | Yes | Two WebSocket endpoints for streaming: `/ws` for traditional streaming (events as JSON frames), `/live` for realtime audio and bidirectional messaging. Choose based on your transport needs. |
| **AG-UI** | `/v1/ag-ui` | Yes | Run the graph over the AG-UI protocol for CopilotKit and other AG-UI-compatible clients. Off by default; enable with `ag_ui.enabled: true` in `10xgraph.json`. Requires the `ag-ui` SDK extra. |
| **Media/Files** | `/v1/files/*` | Yes | Upload, retrieve, and introspect multimodal files (images, audio, documents): `POST /v1/files/upload`, `GET /v1/files/{id}`, `GET /v1/files/{id}/info`, and `GET /v1/files/{id}/url` for signed URLs. |
| **Config** | `/v1/config/multimodal` | Yes | Read the server's multimodal configuration (supported MIME types, size limits, extraction settings). |
| **Observability** | `/v1/observability/{thread_id}` | Yes | Retrieve a reconstructed run trace for a thread (spans, events, token usage). Development only: returns empty in `MODE=production`. |

For detailed route signatures and response shapes, see the [REST API reference](/docs/reference/rest-api/conventions).

## Authentication and authorization

All endpoints except `/ping` enforce an auth + authorization layer. Your choice at configuration time determines what credentials are required:

- **No auth** (`"auth": null` in `10xgraph.json`): All authenticated endpoints allow any request. Safe for internal networks or local development behind a firewall.
- **JWT** (`"auth": "jwt"`): Bearer token checked against a shared secret (`JWT_SECRET_KEY`). Standard, stateless, and suitable for mobile and SPAs.
- **Custom** (`"auth": {"method": "custom", "path": "module:attr"}`): Your own `BaseAuth` subclass; route requests to any identity provider (LDAP, OAuth2, SAML, API key validation).

Authorization (per-resource access control) is separate and optional:

- **Ownership** (default in production): A user can access only threads they created. Enforced on every thread operation (invoke, stream, read state, delete).
- **RBAC** (role-based access control): Custom `AuthorizationBackend` subclass for per-tool access, team scopes, or resource-level rules.
- **Allow all** (default in development): All authenticated users can access all resources.

WebSocket and HTTP endpoints both enforce authentication via the `Authorization: Bearer <token>` header. WebSocket also accepts the token in the `Sec-WebSocket-Protocol` header as `10xgraph-bearer, <token>` (the deprecated `agentflow-bearer` name still works), or as a `?token=` query parameter as a last resort. HTTP routes read only the `Authorization` header. See [Secure your server](/docs/server/auth) for setup and examples.

## Development vs. production modes

The `MODE` environment variable switches the server's security and logging posture:

- **`MODE=development`** (default): Unauthenticated `/ping` accessible, `ORIGINS="*"` (CORS allows any domain), `IS_DEBUG` defaults to true. Use for local development and testing.
- **`MODE=production`**: Only `/ping` is unauthenticated, a graph run is cancelled after 300 seconds unless you change `runs.timeout`, wildcard CORS with credentials is refused (set `ORIGINS` explicitly), and `/docs` and `/redocs` are disabled unless you set `DOCS_PATH` and `REDOCS_PATH`. `IS_DEBUG` is forced off, and `graph_introspection` defaults to `"scoped"` (see [Configure the server](/docs/server/configure#control-who-can-read-the-graph-structure)). Security headers (HSTS, X-Frame-Options and others) are on in every mode unless `SECURITY_HEADERS_ENABLED=false`. Use for deployments exposed to the internet.

Together with `JWT_SECRET_KEY` (a strong, randomly generated secret in production) and an explicit `ORIGINS` list, production mode refuses to start with wildcard CORS and credentials enabled. `STRICT_PRODUCTION_CHECKS` is on by default in production and also refuses a wildcard `ORIGINS`, a wildcard `ALLOWED_HOST` and enabled docs paths, so set `ORIGINS` and `ALLOWED_HOST` to your real values. Set `STRICT_PRODUCTION_CHECKS=false` to opt out.

`MODE` accepts `production` or `prod`, and `development`, `dev` or `local`, in any case. Unset means development. Any other value stops the server at startup, and `10xgraph dev` exits with code 2.

## Reading order for this section

This section is organized by task and layer:

**Basics** (how to run and configure):
1. [Run the server](/docs/server/run-the-server): start the server in dev and production, set the port, enable hot-reload
2. [Configure](/docs/server/configure): write your `10xgraph.json` file with your graph path, auth, store, and rate limiting (the checkpointer goes to `compile()` in your graph code)
3. [Project setup](/docs/server/project-setup): use `10xgraph init` to scaffold a project with templates
4. [CLI reference](/docs/server/cli): overview of all `10xgraph` commands

**Security** (auth, rate limits, headers):
1. [Authentication and authorization](/docs/server/auth): set up JWT or custom auth, define who can access what
2. [Rate limiting](/docs/server/rate-limiting): prevent abuse and manage resource usage
3. [CORS and security headers](/docs/server/cors-and-security-headers): restrict domains, set strict headers, trust proxies

**Interfaces** (how to call the server):
1. [Invoke and stream](/docs/server/invoke-and-stream): make REST calls with curl and code; invoke for single requests, stream for real-time event responses
2. [WebSocket](/docs/server/websockets): use `ws://` and `wss://` for streaming and realtime audio; when to choose `/ws` vs `/live`
3. [AG-UI](/docs/server/ag-ui): integrate with CopilotKit and other AG-UI frameworks
4. [Files and multimodal](/docs/server/files-and-multimodal): upload and manage images, audio, and documents
5. [Remote tools](/docs/server/remote-tools): let clients define tools that run on the server

**Operations** (deploy, monitor, maintain):
1. [Observability](/docs/server/observability): enable logging, metrics, and tracing; forward traces to Logfire or Sentry
2. [Deploy](/docs/server/deploy): generate Docker images with `10xgraph build`; deploy to Docker Compose, Kubernetes, or reverse-proxy setups
3. [Kubernetes](/docs/server/kubernetes): production checklist for Kubernetes deployments
4. [Production checklist](/docs/server/production-checklist): hardening steps before you go live (secrets, CORS, auth, persistence, rate limits)
5. [Backup and restore](/docs/server/backup-and-restore): back up thread state and restore from backups

**Tools** (playground and debugging):
1. [Playground](/docs/server/playground): test your graph interactively with the web UI

If you are new to 10xGraph, start with [Basics](#reading-order-for-this-section). If you are running in production or planning to, read [Security](#security-auth-rate-limits-headers) and [Operations](#operations-deploy-monitor-maintain) top-to-bottom. If you are integrating 10xGraph into an existing app, the [Interfaces](#interfaces-how-to-call-the-server) pages show you how to make requests from your code.
