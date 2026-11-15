---
title: SOC 2 and ISO 27001 control mapping
seoTitle: "SOC 2 and ISO 27001 control mapping"
description: "Which 10xGraph features you can point to as evidence in a SOC 2 or ISO 27001 audit, what is on by default, and what stays with your organization."
section: "Platform"
order: 60
label: Control mapping
updated: "2026-11-15"
---

Built for teams going through SOC 2 and ISO 27001 audits.

10xGraph is software you run. An auditor examines your organization and your deployment, not the code you install. This page shows which 10xGraph features you can point to as evidence, what is on by default, and what stays yours. It does not say that 10xGraph, or anything built with it, is compliant, ready or certified. Those words apply to an organization after an audit.

The control descriptions below are short paraphrases, not the official text. Check each one against the AICPA Trust Services Criteria (2017, with the 2022 revised points of focus) and ISO/IEC 27001:2022 Annex A before you cite it in an audit.

## What the default Full setup turns on

`10xgraph init --mode full` with no other flags writes a `10xgraph.json` and a project with:

- Storage `memory`: the graph compiles with `InMemoryCheckpointer`. State is lost on restart.
- Auth `jwt`.
- A `memory` cache store.
- Rate limiting on: 100 requests per 60 seconds, by user, `fail_open: false`.
- Token revocation on (`token_revocation: true`).
- The audit log on, with `sinks: ["log"]` and `include_reads: true`.
- A `PromptInjectionValidator` registered on the graph.

Flags change this:

- `--storage postgres` gives `PgCheckpointer` and a Redis cache store. `--storage postgres-memory` adds `PgVectorStore`.
- `--storage sqlite` gives `SqliteCheckpointer` and keeps the memory cache store.
- `--worker` forces a Redis cache store.
- `--auth none` turns revocation off and rate limits by IP.

The Quick setup writes none of these settings.

### What holds across workers

With a memory cache store, these are kept per process: rate-limit counters, token revocations, the per-thread run lock and the per-user run caps. The image that `10xgraph build` generates runs 2 Gunicorn workers (`WEB_CONCURRENCY=2`), so each worker keeps its own copy and they are not shared. The server warns about this at boot. `10xgraph revoke` refuses to run against an in-memory cache store, because a CLI process cannot reach the server's memory.

These controls hold across all workers and replicas only with a Redis cache store, or a custom cache store that is shared. Durable thread state needs Postgres storage (`PgCheckpointer`). For a deployment with more than one worker, choose `--storage postgres` (or `postgres-memory`), or set both yourself.

Two more points:

- Once revocation is on, a token without a `jti` claim gets 401.
- If the cache store fails, the run lock falls back to a per-process lock.

### What `MODE=production` adds

`MODE=production` is a separate switch from the Full setup. The Dockerfile, Compose file and Kubernetes manifest that `10xgraph build` writes set `MODE=production` and `LOG_FORMAT=json`. In that mode the server refuses to start with:

- `ALLOWED_HOST=*` or `ORIGINS=*` (both are the defaults),
- API docs paths explicitly enabled,
- wildcard CORS with credentials,
- an HS secret under 32 bytes,
- tenant columns that do not match between the checkpointer, the store and `tenant_claims`,
- auth configuration errors.

The first two are the strict checks. They are on in production without any setting, and `STRICT_PRODUCTION_CHECKS=false` turns them into warnings. A generated image does not boot until you set `ALLOWED_HOST` and `ORIGINS`. Production mode also turns the API docs off, hides internal error details, requires a file owner and sets a 300-second run timeout.

## How to read the Default column

| Value | Meaning |
|---|---|
| on | Active without configuration, in any mode. |
| with auth | Active once `auth` is set (`jwt` or `custom`). Auth is off until you set it; the Full setup sets `jwt`. |
| Full setup | Written to `10xgraph.json` by `10xgraph init --mode full`. Absent otherwise until you add it. |
| `MODE=production` | Active when the server runs with `MODE=production`. The generated Dockerfile, Compose file and Kubernetes manifest set it. |
| generated deploy files | Set in the Dockerfile, Compose file or Kubernetes manifest that `10xgraph build` writes. |
| with Postgres storage | Needs `PgCheckpointer` (or `PgVectorStore`): `--storage postgres` or `postgres-memory`, or your own instance passed to `compile()`. |
| (shared cache store) | Added after another value. With the memory cache store it holds per process only. It holds across workers and replicas only with a Redis or custom shared cache store. |
| opt-in | Off until you enable it. |
| run by hand | A CLI command you run yourself. |
| n/a | No setting. The row describes a design property or your responsibility. |

## SOC 2 trust services criteria

| Criterion | What it asks | 10xGraph feature | Default | You own | Docs |
|---|---|---|---|---|---|
| CC6.1 | Logical access controls protect information assets. | Bearer JWT verification: an algorithm allowlist (HS, RS, ES, PS and EdDSA), `none` refused, `exp` required. Issuer, audience and max age checks are optional. Custom `BaseAuth`. A route guard refuses to boot if any non-public route lacks a permission guard. Storage reads are scoped to the caller's owner and reach. Client `filters` that name tenant columns or `user_id` are rejected. Tenant scoping and row-level security exist only in Postgres storage. | Route guard: on. JWT rules, owner scoping, filter checks: with auth. Issuer, audience, max age: opt-in. Tenant scoping: with Postgres storage. Row-level security: opt-in, with Postgres storage. | Identity provider, token issuing, MFA, secret storage, database roles. | [Auth](/docs/server/auth), [Multi-tenant data](/docs/guides/multi-tenant-data) |
| CC6.2 | Users are authorized before access and access is removed when no longer needed. | 10xGraph is a resource server with no user registry. Token revocation per token or per user, from code or `10xgraph revoke`. Revocation fails closed. Once it is on, a token without `jti` gets 401. `10xgraph revoke` refuses an in-memory cache store. | Full setup (shared cache store). | Joiner, mover and leaver process, deprovisioning in your identity provider, calling revoke on offboarding. | [Auth](/docs/server/auth), [Auth reference](/docs/reference/api-cli/auth) |
| CC6.3 | Access is granted by role with least privilege. | Role-based access with permissions from one registry, role inheritance, a required reach per role (own, tenant, all), token scopes that only narrow. `admin:*` is excluded from the default set. Without roles, every user gets the default permissions with reach own. With `permissions_claim` set and no roles, permissions come from that claim instead (reach stays own). Reach `all` roles are logged at boot. `GET /v1/me` shows a caller's resolved access. | with auth. | Role design, role assignment, periodic access reviews. | [Auth](/docs/server/auth), [Authorization scopes](/docs/guides/authorization-scopes) |
| CC6.6 | Systems are protected against threats from outside the boundary. | Rate limiting (by IP, user or global, with a fail-closed option). Per-user run cap. Security headers and a 10 MB request size limit. Trusted-host check and CORS, which check nothing until you set `ALLOWED_HOST` and `ORIGINS`. Client input rules: clients may send only user messages, `state_keys` deny by default, message ids are assigned by the server, and thread ids are picked by the server (`runs.thread_ids: "server"`). An optional `config_keys` allowlist. SSRF policy for media URL fetches. A prompt-injection validator. Strict boot checks. | Rate limit: Full setup (shared cache store). Run cap: with auth (shared cache store). Headers, size limit, input rules, SSRF policy: on. `config_keys`: opt-in. Validator: Full setup. Host and CORS values: opt-in, and required by `MODE=production`. Strict checks: `MODE=production`. | Firewall, WAF, DDoS protection, TLS termination, `ORIGINS` and `ALLOWED_HOST` values. | [Rate limiting](/docs/server/rate-limiting), [CORS and security headers](/docs/server/cors-and-security-headers), [Protect against prompt injection](/docs/guides/protect-against-prompt-injection), [Security model](/docs/production/security-model) |
| CC6.7 | Information is protected in transmission. | HSTS, sent only on HTTPS requests (scheme `https`, or `X-Forwarded-Proto: https`, which is trusted from any client). The WebSocket bearer is carried in a subprotocol. No token in the URL: `?token=` is not accepted. File reads are checked against owner and reach. | HSTS, no token in URL: on. File checks: with auth. | TLS everywhere (proxy, Postgres, Redis, brokers), certificate management, stripping `X-Forwarded-Proto` from clients at your proxy. | [CORS and security headers](/docs/server/cors-and-security-headers), [WebSockets](/docs/server/websockets), [Files and multimodal](/docs/server/files-and-multimodal) |
| CC6.8 | Unauthorized or malicious software is prevented or detected. | Upload checks: a leading-byte signature check (for types that have one), a type allowlist (`MEDIA_ALLOWED_CONTENT_TYPES`; empty allows all types), a 25 MB cap and filename cleaning. The generated image runs as non-root, with pip and the CLI's own libraries removed. The generated Kubernetes manifest sets `runAsNonRoot`, a read-only root filesystem, `allowPrivilegeEscalation: false`, drops all capabilities, uses the `RuntimeDefault` seccomp profile and sets `automountServiceAccountToken: false`. | Upload checks: on. Type allowlist: opt-in. Image and manifest settings: generated deploy files. | Malware and image scanning, runtime protection. | [Files and multimodal](/docs/server/files-and-multimodal), [Kubernetes](/docs/server/kubernetes) |
| CC7.1 | Configuration and vulnerabilities are monitored. | `10xgraph audit` checks the environment and `10xgraph.json`. `10xgraph config` and `10xgraph build` warn when settings are not production ready. The server refuses unsafe production settings at boot. | CLI checks: run by hand. Boot checks: `MODE=production`. | Scans, patching and dependency updates in your own project. | [CLI](/docs/server/cli), [Production checklist](/docs/server/production-checklist) |
| CC7.2 | Components are monitored for anomalies that may indicate attacks or errors. | The audit log records each access decision, authentication failure and change as metadata-only JSON lines. HTTP responses carry `X-Request-ID`; a WebSocket gets a request id in its context, not a header. Application logs carry request and user ids only in JSON format. OpenTelemetry tracing, Prometheus or OTLP metrics and Sentry are available. | Audit log: Full setup. JSON logs: generated deploy files (`LOG_FORMAT=json`). Request ids: on. Tracing, metrics, Sentry: opt-in. | Log collection, storage, alert rules, on-call. | [Audit log](/docs/server/audit-log), [Observability](/docs/observability) |
| CC7.3 | Security events are evaluated to decide whether they are incidents. | Supporting only. Request ids help correlate events. Token revocation helps contain a leaked token. | Request ids: on. Revocation: Full setup (shared cache store). | The incident process. | [Audit log](/docs/server/audit-log), [Auth](/docs/server/auth) |
| CC8.1 | Changes are authorized, tested and implemented in a controlled way. | `10xgraph test` and `10xgraph eval` for testing your own changes. A versioned Postgres schema with advisory-lock migrations. `10xgraph build` for the image. | Test, eval, build: run by hand. Schema migrations: with Postgres storage. | Change approval, code review, deployment pipeline, rollback (a schema upgrade needs stop, migrate, start; rollback needs a restore). | [CLI](/docs/server/cli), [Upgrade to 1.0](/docs/project/upgrade-to-1.0) |
| A1.1 | Current processing capacity and use are monitored so capacity can be added. | Rate limits, per-user run cap, WebSocket connection caps (when the WebSocket routes are enabled), run timeout and metrics. Media quotas are off by default. | Rate limit: Full setup (shared cache store). Run cap: with auth (shared cache store). WebSocket caps: on. Run timeout: `MODE=production`. Metrics, media quotas: opt-in. | Capacity planning, scaling and alerts. | [Limits](/docs/production/limits), [Prometheus and Grafana](/docs/guides/metrics-prometheus-grafana) |
| A1.2 | Environmental protection, backup and recovery support availability. | Durable Postgres checkpointer. Graceful shutdown. Run locks and caps held as leases that expire if a worker dies. Liveness `/ping` and readiness `/health/ready`. Docker `HEALTHCHECK` and Kubernetes probes. Startup backend checks with retry. | Durable state: with Postgres storage. Shutdown, health endpoints, startup checks: on. Leases: on (shared cache store). Healthcheck and probes: generated deploy files. | Backups, restore tests, disaster recovery, database high availability, capacity. | [Graceful shutdown](/docs/guides/graceful-shutdown), [Durability and concurrency](/docs/guides/durability-and-concurrency), [Backup and restore](/docs/server/backup-and-restore) |
| C1.1 | Confidential information is identified and kept confidential. | Per-owner scoping. Per-tenant scoping and row-level security in Postgres storage only. A required file owner. A log sanitizer for secrets. Hidden error details in production. Tracing is off by default, but once enabled, `OTEL_LEVEL` defaults to `full`: message content, tool input and output and system prompts are sent. `standard` still puts graph state on node spans. Only `spans` keeps content out. | Owner scoping: with auth. Tenant scoping: with Postgres storage. Row-level security: opt-in. File owner required, hidden errors: `MODE=production`. Sanitizer: on. Tracing: opt-in, and at level `full` once on. | Data classification, the trace level, what you send to model providers, trace backends and publishers. | [Multi-tenant data](/docs/guides/multi-tenant-data), [Security model](/docs/production/security-model), [Observability](/docs/server/observability) |
| C1.2 | Confidential information is disposed of when no longer needed. | Thread delete releases the thread, its files and traces and reports any step that did not finish. Message delete, memory delete and forget by filter, file delete. State snapshot pruning (`state_history_limit`, default 20) in `PgCheckpointer` only. Cache TTLs. | Delete endpoints, cache TTLs: on. Pruning: with Postgres storage. | The retention schedule and running it, backup expiry. See not provided below. | [Threads API](/docs/reference/rest-api/threads), [Memory store API](/docs/reference/rest-api/memory-store), [Set up checkpointing](/docs/guides/set-up-checkpointing) |
| PI1.3 | Processing is complete, accurate and timely. | One run per thread through a lease lock. `Idempotency-Key` on invoke, stream, AG-UI and WebSocket. A tool ledger in the checkpointer so a resumed run does not repeat a finished tool call; it is durable with Postgres or SQLite storage. A run timeout. | Lock: on (shared cache store). Idempotency: opt-in, per request. Ledger: on. Timeout: `MODE=production`. | Correctness of your tools and prompts. | [Replay-safe tools](/docs/concepts/replay-safe-tools), [Durability and concurrency](/docs/guides/durability-and-concurrency) |
| P5.1, P5.2 | Individuals can access and correct their personal information. | A user can list and read their own threads, messages, memories and files, and update thread state and memories. This supports a request; it does not handle it. There is no one-call export. | with auth. | Request handling, identity verification. | [Threads API](/docs/reference/rest-api/threads), [Memory store API](/docs/reference/rest-api/memory-store) |

## ISO/IEC 27001:2022 Annex A

| Control | What it asks | 10xGraph feature | Default | You own | Docs |
|---|---|---|---|---|---|
| 5.15 Access control | Access rules based on business need. | Role-based access, permission registry, reach, per-route permission checks. The route guard refuses to boot if a non-public route has no permission guard. | Route guard: on. Roles and checks: with auth. | The access policy. | [Auth](/docs/server/auth) |
| 5.16 Identity management | Manage the identity lifecycle. | Resource server only: identity comes from token claims, and reserved system ids are refused. | n/a | The identity provider and its lifecycle. | [Auth](/docs/server/auth) |
| 5.17 Authentication information | Manage secrets and credentials. | JWT secret strength check for HS algorithms: under 32 bytes refuses boot in production and warns in development. RS and ES keys have no length check. Verification key rotation with `JWT_SECRET_KEYS` and `kid`. Secrets read from the environment. | Strength check: `MODE=production`. Rotation: opt-in. | Secret manager, rotation schedule. | [Auth reference](/docs/reference/api-cli/auth), [Environment variables](/docs/reference/api-cli/environment) |
| 5.18 Access rights | Grant, review, change and remove access rights. | Role-to-permission configuration, revocation, a boot warning for reach `all`. | Roles, boot warning: with auth. Revocation: Full setup (shared cache store). | Reviews and the removal process. | [Auth](/docs/server/auth) |
| 8.2 Privileged access rights | Restrict and manage privileged access. | `admin:*` is excluded from defaults. Reach `all` must be declared per role and is logged at boot. | with auth. | Who holds privileged roles, database and infrastructure admin. | [Auth](/docs/server/auth) |
| 8.3 Information access restriction | Restrict access to information per policy. | Owner scoping in every storage backend, from the identity in the run config. Without an identity (auth off, or direct SDK use without `config["user"]`), checkpointers fall back to their `enforce_user_isolation` setting: on by default in `PgCheckpointer`, off in the in-memory and SQLite checkpointers. Tenant scoping only in `PgCheckpointer`, `PgVectorStore`, and media when the checkpointer has tenant columns. `InMemoryCheckpointer` and `SqliteCheckpointer` reject `tenant_columns`; `QdrantStore` has no tenant support. Client `filters` naming tenant columns or `user_id` are rejected. File ownership. | Owner scoping, filter checks: with auth. Tenant scoping: with Postgres storage. Tenant-column mismatch refusal: `MODE=production`. Row-level security: opt-in. | Tenant claim design, choice of backend. | [Multi-tenant data](/docs/guides/multi-tenant-data), [Tenancy and access](/docs/concepts/tenancy-and-access) |
| 8.5 Secure authentication | Secure authentication technology and procedures. | JWT verification rules. Optional issuer, audience and max age (`JWT_ISSUER`, `JWT_AUDIENCE`, `JWT_MAX_TOKEN_AGE_SECONDS`, unset by default). Fail-closed revocation. No tokens in WebSocket URLs. | JWT rules: with auth. Issuer, audience, max age: opt-in. Revocation: Full setup (shared cache store). No token in URL: on. | MFA and the login flow (identity provider). | [Auth](/docs/server/auth), [WebSockets](/docs/server/websockets) |
| 8.6 Capacity management | Monitor and adjust resource use. | As A1.1: rate limits, per-user run cap, WebSocket connection caps, run timeout, metrics. Media quotas are off by default. | As A1.1. | Scaling and alerts. | [Limits](/docs/production/limits), [Rate limiting](/docs/server/rate-limiting), [Prometheus and Grafana](/docs/guides/metrics-prometheus-grafana) |
| 8.7 Protection against malware | Implement protection against malware. | As CC6.8: upload signature, type and size checks and filename cleaning; a non-root, slimmed image and a hardened Kubernetes manifest. There is no malware scanning. | As CC6.8. | Malware scanning of uploads and images, endpoint protection. | [Files and multimodal](/docs/server/files-and-multimodal), [Kubernetes](/docs/server/kubernetes) |
| 8.9 Configuration management | Establish, document and monitor secure configurations. | The Full setup. Strict boot checks. API docs and OpenAPI off in production. `10xgraph audit` and `10xgraph config` warnings. Config schema validation. The generated deploy files set `MODE=production` and the hardening listed under CC6.8. | Full setup: Full setup. Boot checks, docs off: `MODE=production`. CLI warnings: run by hand. Schema validation: on. | Config in version control, drift detection. | [Production checklist](/docs/server/production-checklist), [CLI](/docs/server/cli) |
| 8.10 Information deletion | Delete information when no longer required. | As C1.2: per-thread delete with cleanup, memory and file delete, snapshot pruning in `PgCheckpointer`. | Delete endpoints: on. Pruning: with Postgres storage. | Schedules. See not provided below. | [Threads API](/docs/reference/rest-api/threads) |
| 8.11 Data masking | Mask data per policy. | Secrets masked in logs (bearer tokens, JWTs, common API key shapes, sensitive key names). This covers secret masking only; there is no PII masking. | on | PII masking. | [Observability](/docs/observability) |
| 8.12 Data leakage prevention | Prevent unauthorized disclosure. | Partial. Owner scoping, tenant scoping in Postgres storage, sanitized production errors, SSRF guard. Traces carry message content at the default level `full` once tracing is enabled; set `OTEL_LEVEL=spans` to keep content out. | Owner scoping: with auth. Sanitized errors: `MODE=production`. SSRF guard: on. Tracing: opt-in. | DLP tooling, egress control, the trace level. | [Security model](/docs/production/security-model), [Observability](/docs/server/observability) |
| 8.15 Logging | Produce, store, protect and analyze logs of activity and events. | The audit log (metadata-only JSON lines for access, authentication and change events). Application logs carry request and user ids in JSON format. 10xGraph produces the logs; it does not store or protect them. | Audit log: Full setup. JSON logs: generated deploy files. | Storage, protection, retention and analysis. | [Audit log](/docs/server/audit-log), [Observability](/docs/observability) |
| 8.16 Monitoring activities | Monitor for anomalous behaviour. | OpenTelemetry traces, metrics, Sentry, readiness checks. | Traces, metrics, Sentry: opt-in. Readiness: on. | Monitoring and response. | [Observability](/docs/observability), [Send traces to OTLP](/docs/guides/send-traces-to-otlp) |
| 8.20 Networks security | Secure, manage and control networks and network devices. | Supporting only. 10xGraph has no network controls. The trusted-host and CORS settings are application settings and are listed under 8.26. | n/a | Network design, segmentation, firewalls, TLS. | [CORS and security headers](/docs/server/cors-and-security-headers) |
| 8.24 Use of cryptography | Rules for cryptography and keys. | JWT algorithm allowlist and HS key length check. HSTS. No encryption at rest in the app. | Allowlist: with auth. Key length refusal: `MODE=production`. HSTS: on. | TLS, disk, database and bucket encryption, key management. | [Auth](/docs/server/auth) |
| 8.26 Application security requirements | Identify security requirements for applications. | The Full setup and its warnings define a baseline. Trusted-host check (`ALLOWED_HOST`) and CORS (`ORIGINS`), both `*` by default. Client input rules and `filters` validation, as CC6.6 and 8.3. | Baseline: Full setup. Host and CORS values: opt-in, and required by `MODE=production`. Input rules: on. | Your own requirements and the host and origin values. | [Production checklist](/docs/server/production-checklist), [Security model](/docs/production/security-model), [CORS and security headers](/docs/server/cors-and-security-headers) |
| 8.32 Change management | Subject changes to change management. | As CC8.1. | As CC8.1. | As CC8.1. | [CLI](/docs/server/cli) |

## Not provided by 10xGraph

An auditor may ask for these. They are not features of the server, or only partly. Each row says what to do.

| Evidence asked for | Status | What to do |
|---|---|---|
| Automatic retention (delete threads, messages, memories and files older than N days) | Not provided | Run your own job. The `PgCheckpointer` threads table has `created_at` and `updated_at`; SQLite has only `updated_at`; the in-memory checkpointer has neither. Deployer SQL or a scheduled [background task](/docs/guides/run-background-tasks) can select old threads. Delete through the thread delete path rather than raw SQL so files and traces are released too. `state_history_limit` prunes snapshots only, and only in `PgCheckpointer`. |
| Erase everything for one user or tenant in one call | Partial | Per-thread delete with file and trace cleanup, memory forget by filter and file delete exist. A full erase means listing and deleting each thread, then memories and files. Script it against the [REST API](/docs/reference/rest-api/threads). |
| Export of one user's data | Partial | List and read endpoints cover threads, messages, memories and files. There is no single export call; script it. |
| JWKS URL fetch for identity provider keys | Not provided | Built-in `JwtAuth` verifies RS, ES, PS and EdDSA tokens with a static public key in `JWT_SECRET_KEY` or `JWT_SECRET_KEYS`. The `jwt` extra installs bare PyJWT, so install `cryptography` too. Keys rotate with `JWT_SECRET_KEYS` and `kid`. Only fetching keys from a JWKS URL is missing; a custom `BaseAuth` can do it. See [Auth](/docs/server/auth). |
| Encryption at rest | Your infrastructure | Use Postgres, disk and bucket encryption and your key management. The app does no field encryption. |
| PII redaction in logs and telemetry | Not provided | Only secrets are masked. Set the trace level to `spans` to keep content out of traces. A custom publisher can filter events before they leave. See [Use publishers](/docs/guides/use-publishers). |
| Malware scanning of uploads | Not provided | Uploads get signature, type and size checks. PDFs get a 10 MB and 500-page limit while `DOCUMENT_HANDLING=extract_text` (the default). Add a scanner in front of storage or in your upload path. |
| Backup and restore | Your infrastructure | Back up Postgres, Redis and object storage. See [Backup and restore](/docs/server/backup-and-restore). |
| MFA, user provisioning, access reviews | Your identity provider | 10xGraph verifies tokens and does not issue them. `GET /v1/me` shows the resolved access of a caller to support a review. |
| Per-tool authorization enforced by the framework | Partial | A tool can call `tenxgraph.core.authz.can(config, permission)`. It checks only the fixed registry permissions, and it returns true when there is no identity (auth off). Per-tool permissions cannot be declared. See [Authorization scopes](/docs/guides/authorization-scopes). |
| Per-run usage and cost record | Partial | Spans carry token counts at trace level `standard` or higher, and a `tenxgraph.llm.tokens` counter exists. Neither is a per-run record. See [Observability](/docs/observability). |

## Project practices

These are practices of the 10xGraph project itself, relevant to SDLC questions in vendor reviews. They are not controls of your deployment.

- A security policy with private vulnerability reporting through GitHub advisories and email. See [Security policy](/docs/project/security).
- Dependabot for dependencies and GitHub Actions in all three repositories.
- CodeQL scanning on the API server and the TypeScript client.
- Pre-commit hooks for the Python packages: the core runs `bandit`, `ruff`, `mypy` and a private-key detection hook; the API server runs `bandit`, `ruff` and a private-key detection hook, and runs `mypy` in CI.
- CI that runs lint, type checks and tests. Core integration tests run against real Postgres and Redis; API integration tests run against real Redis.
- A changelog in each repository, and a deprecation policy for the public API from 1.0.

What is not there yet: signed releases, build provenance, PyPI trusted publishing, npm provenance and an SBOM. CodeQL is not enabled on the core repository, and CI does not run dependency vulnerability audits. If your auditor requires these, plan for your own scanning of the packages you install.

## See also

- [Audit log](/docs/server/audit-log)
- [Security model](/docs/production/security-model)
- [Production checklist](/docs/server/production-checklist)
- [Observability](/docs/observability)
