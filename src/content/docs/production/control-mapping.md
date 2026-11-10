---
title: SOC 2 and ISO 27001 control mapping
seoTitle: "SOC 2 and ISO 27001 control mapping"
description: "Which 10xGraph features you can point to as evidence in a SOC 2 or ISO 27001 audit, what is on by default, and what stays with your organization."
section: "Platform"
order: 60
label: Control mapping
updated: "2026-11-10"
---

Built for teams going through SOC 2 and ISO 27001 audits.

10xGraph is software you run. An auditor examines your organization and your deployment, not the code you install. This page shows which 10xGraph features you can point to as evidence, what is on by default, and what stays yours. It does not say that 10xGraph, or anything built with it, is compliant, ready or certified. Those words apply to an organization after an audit.

Every row names the default, so you can see what you must turn on:

- **on**: active without configuration.
- **production template**: written by `10xgraph init` with the Production template, or set by `MODE=production`.
- **opt-in**: you enable it.

Several rows need authentication. Auth is off in the library; the production template turns it on. See [Authentication and authorization](/docs/server/auth).

The control descriptions below are short paraphrases, not the official text. Check each one against the AICPA Trust Services Criteria (2017, with the 2022 revised points of focus) and ISO/IEC 27001:2022 Annex A before you cite it in an audit.

## SOC 2 trust services criteria

| Criterion | What it asks | 10xGraph feature | Default | You own | Docs |
|---|---|---|---|---|---|
| CC6.1 | Logical access controls protect information assets. | Bearer JWT verification (algorithm allowlist, `none` refused, minimum secret length in production, `exp` required, optional issuer, audience and max age), custom `BaseAuth`, owner and tenant scoping of every storage read, optional Postgres row-level security. | Auth: production template. Row-level security: opt-in. | Identity provider, token issuing, MFA, secret storage, database roles. | [Auth](/docs/server/auth), [Multi-tenant data](/docs/guides/multi-tenant-data) |
| CC6.2 | Users are authorized before access and access is removed when no longer needed. | 10xGraph is a resource server with no user registry. Token revocation per token or per user, from code or `10xgraph revoke`; revocation fails closed. | Production template. | Joiner, mover and leaver process, deprovisioning in your identity provider, calling revoke on offboarding. | [Auth](/docs/server/auth), [Auth reference](/docs/reference/api-cli/auth) |
| CC6.3 | Access is granted by role with least privilege. | Role-based access with permissions from one registry, role inheritance, a required reach per role (own, tenant, all), token scopes that only narrow. `admin:*` is excluded from the default set. Reach `all` roles are logged at boot. `GET /v1/me` shows a caller's resolved access. | Without roles every user gets the default permissions with reach own. | Role design, role assignment, periodic access reviews. | [Auth](/docs/server/auth), [Authorization scopes](/docs/guides/authorization-scopes) |
| CC6.6 | Systems are protected against threats from outside the boundary. | Rate limiting (by IP, user or global, fail-closed option), trusted-host check, CORS, security headers, request size limit, SSRF policy for media URL fetches, per-user run cap, strict production boot checks. | Rate limit: production template. Headers and size limit: on. Strict checks: `MODE=production`. | Firewall, WAF, DDoS protection, TLS termination, `ORIGINS` and `ALLOWED_HOST` values. | [Rate limiting](/docs/server/rate-limiting), [CORS and security headers](/docs/server/cors-and-security-headers), [Security model](/docs/production/security-model) |
| CC6.7 | Information is protected in transmission. | HSTS sent over HTTPS, WebSocket bearer carried in a subprotocol rather than the URL, `?token=` redacted from access logs, file reads checked against owner and reach. | HSTS: on. | TLS everywhere (proxy, Postgres, Redis, brokers) and certificate management. | [CORS and security headers](/docs/server/cors-and-security-headers), [WebSockets](/docs/server/websockets), [Files and multimodal](/docs/server/files-and-multimodal) |
| CC6.8 | Unauthorized or malicious software is prevented or detected. | Upload checks (leading-byte signature, optional type allowlist, size caps, filename sanitizing). Opt-in prompt-injection validator. The generated image runs as non-root and the Kubernetes manifest sets `runAsNonRoot` and a read-only root filesystem. | Upload checks: on. Validator: production template. | Malware and image scanning, runtime protection. | [Files and multimodal](/docs/server/files-and-multimodal), [Protect against prompt injection](/docs/guides/protect-against-prompt-injection), [Kubernetes](/docs/server/kubernetes) |
| CC7.1 | Configuration and vulnerabilities are monitored. | `10xgraph audit` checks the environment and `10xgraph.json`, `10xgraph config` and `10xgraph build` warn when settings are not production ready, and the server refuses unsafe production settings at boot. | CLI checks: run by hand. Boot checks: `MODE=production`. | Scans, patching and dependency updates in your own project. | [CLI](/docs/server/cli), [Production checklist](/docs/server/production-checklist) |
| CC7.2 | Components are monitored for anomalies that may indicate attacks or errors. | The audit log records each access decision, authentication failure and change as metadata-only JSON lines. JSON application logs carry request and user ids. OpenTelemetry tracing, Prometheus or OTLP metrics and Sentry are available. Both audit log and JSON logs are 1.0 features. | Audit log: production template. JSON logs: generated deploy files set `LOG_FORMAT=json`. Tracing, metrics, Sentry: opt-in. | Log collection, storage, alert rules, on-call. | [Audit log](/docs/server/audit-log), [Observability](/docs/observability) |
| CC7.3 | Security events are evaluated to decide whether they are incidents. | Supporting only: request ids on every response and token revocation for containment. | on | The incident process. | [Audit log](/docs/server/audit-log), [Auth](/docs/server/auth) |
| CC8.1 | Changes are authorized, tested and implemented in a controlled way. | `10xgraph test` and `10xgraph eval` for your own change testing, a versioned Postgres schema with advisory-lock migrations, and `10xgraph build` for the image. | on | Change approval, code review, deployment pipeline, rollback (a schema upgrade needs stop, migrate, start; rollback needs a restore). | [CLI](/docs/server/cli), [Upgrade to 1.0](/docs/project/upgrade-to-1.0) |
| A1.2 | Environmental protection, backup and recovery support availability. | Durable Postgres checkpointer, graceful shutdown, run locks and caps held as leases that expire if a worker dies, liveness `/ping` and readiness `/health/ready`, Docker `HEALTHCHECK` and Kubernetes probes, startup backend checks with retry. | on | Backups, restore tests, disaster recovery, database high availability, capacity. | [Graceful shutdown](/docs/guides/graceful-shutdown), [Durability and concurrency](/docs/guides/durability-and-concurrency), [Backup and restore](/docs/server/backup-and-restore) |
| C1.1 | Confidential information is identified and kept confidential. | Per-owner and per-tenant scoping, optional row-level security, required file owner, a log sanitizer for secrets, hidden error details in production, trace content off unless level `full`. | Scoping: with auth. File owner required: `MODE=production`. Sanitizer: on. | Data classification, what you send to model providers and publishers. | [Multi-tenant data](/docs/guides/multi-tenant-data), [Security model](/docs/production/security-model) |
| C1.2 | Confidential information is disposed of when no longer needed. | Thread delete releases the thread, its files and traces and reports any step that did not finish. Message delete, memory delete and forget by filter, file delete, state snapshot pruning (`state_history_limit`), cache TTLs. | Delete on demand. Pruning: on. | The retention schedule and running it, backup expiry. See not provided below. | [Threads API](/docs/reference/rest-api/threads), [Memory store API](/docs/reference/rest-api/memory-store), [Set up checkpointing](/docs/guides/set-up-checkpointing) |
| PI1.3 | Processing is complete, accurate and timely. | One run per thread through a lease lock, opt-in `Idempotency-Key`, a durable tool ledger so a resumed run does not repeat a finished tool call, a run timeout. | Lock: on. Idempotency: opt-in per request. Timeout: `MODE=production`. | Correctness of your tools and prompts. | [Replay-safe tools](/docs/concepts/replay-safe-tools), [Durability and concurrency](/docs/guides/durability-and-concurrency) |
| P5.1, P5.2 | Individuals can access and correct their personal information. | A user can list and read their own threads, messages, memories and files, and delete messages or update thread state and memories. This supports the request, it does not handle it: there is no one-call export. | With auth. | Request handling, identity verification. | [Threads API](/docs/reference/rest-api/threads), [Memory store API](/docs/reference/rest-api/memory-store) |

## ISO/IEC 27001:2022 Annex A

| Control | What it asks | 10xGraph feature | Default | You own | Docs |
|---|---|---|---|---|---|
| 5.15 Access control | Access rules based on business need. | Role-based access, permission registry, reach, per-route permission checks. | With auth. | The access policy. | [Auth](/docs/server/auth) |
| 5.16 Identity management | Manage the identity lifecycle. | Resource server only: identity comes from token claims, reserved system ids are refused. | n/a | The identity provider and its lifecycle. | [Auth](/docs/server/auth) |
| 5.17 Authentication information | Manage secrets and credentials. | JWT secret strength check, verification key rotation with `JWT_SECRET_KEYS` and `kid`, secrets read from the environment. | Strength check: `MODE=production`. | Secret manager, rotation schedule. | [Auth reference](/docs/reference/api-cli/auth), [Environment variables](/docs/reference/api-cli/environment) |
| 5.18 Access rights | Grant, review, change and remove access rights. | Role-to-permission configuration, revocation, boot warning for reach `all`. | Production template. | Reviews and the removal process. | [Auth](/docs/server/auth) |
| 8.2 Privileged access rights | Restrict and manage privileged access. | `admin:*` is excluded from defaults; reach `all` must be declared per role and is logged at boot. | With roles. | Who holds privileged roles, database and infrastructure admin. | [Auth](/docs/server/auth) |
| 8.3 Information access restriction | Restrict access to information per policy. | Owner and tenant filters in every storage backend, optional row-level security, file ownership. | With auth. | Tenant claim design. | [Multi-tenant data](/docs/guides/multi-tenant-data) |
| 8.5 Secure authentication | Secure authentication technology and procedures. | JWT verification rules, token max age, fail-closed revocation, no tokens in WebSocket URLs. | With auth. | MFA and the login flow (identity provider). | [Auth](/docs/server/auth), [WebSockets](/docs/server/websockets) |
| 8.6 Capacity management | Monitor and adjust resource use. | Rate limits, per-user run cap, WebSocket connection caps, run timeout, metrics. Media quotas are off by default. | Mixed. | Scaling and alerts. | [Limits](/docs/production/limits), [Rate limiting](/docs/server/rate-limiting), [Prometheus and Grafana](/docs/guides/metrics-prometheus-grafana) |
| 8.9 Configuration management | Establish, document and monitor secure configurations. | The Production template, strict boot checks, `10xgraph audit` and `10xgraph config` warnings, config schema validation. | Production template. | Config in version control, drift detection. | [Production checklist](/docs/server/production-checklist), [CLI](/docs/server/cli) |
| 8.10 Information deletion | Delete information when no longer required. | As C1.2: per-thread delete with cleanup, memory and file delete, snapshot pruning. | Delete on demand. | Schedules. See not provided below. | [Threads API](/docs/reference/rest-api/threads) |
| 8.11 Data masking | Mask data per policy. | Secrets masked in logs (bearer tokens, JWTs, common API key shapes, sensitive key names). Supports secret masking only; there is no PII masking. | on | PII masking. | [Observability](/docs/observability) |
| 8.12 Data leakage prevention | Prevent unauthorized disclosure. | Owner and tenant isolation, sanitized production errors, trace content off by default, SSRF guard. Partial. | Partial. | DLP tooling, egress control. | [Security model](/docs/production/security-model) |
| 8.15 Logging | Produce, store, protect and analyze logs of activity and events. | The audit log (metadata-only JSON lines for access, authentication and change events) and JSON application logs with request and user ids. 10xGraph produces the logs; it does not store or protect them. | Audit log: production template. JSON logs: generated deploy files. | Storage, protection, retention and analysis. | [Audit log](/docs/server/audit-log), [Observability](/docs/observability) |
| 8.16 Monitoring activities | Monitor for anomalous behaviour. | OpenTelemetry traces, metrics, Sentry, readiness checks. | opt-in | Monitoring and response. | [Observability](/docs/observability), [Send traces to OTLP](/docs/guides/send-traces-to-otlp) |
| 8.20 Network security | Secure and manage networks. | Trusted hosts and CORS. | `MODE=production`. | Network design and segmentation. | [CORS and security headers](/docs/server/cors-and-security-headers) |
| 8.24 Use of cryptography | Rules for cryptography and keys. | JWT algorithm allowlist and key length, HSTS. No encryption at rest in the app. | on | TLS, disk, database and bucket encryption, key management. | [Auth](/docs/server/auth) |
| 8.26 Application security requirements | Identify security requirements for applications. | The Production template and its warnings define a secure baseline. | Production template. | Your own requirements. | [Production checklist](/docs/server/production-checklist), [Security model](/docs/production/security-model) |
| 8.32 Change management | Subject changes to change management. | As CC8.1. | n/a | As CC8.1. | [CLI](/docs/server/cli) |

## Not provided by 10xGraph

An auditor may ask for these. They are not features of the server, or only partly. Each row says what to do.

| Evidence asked for | Status | What to do |
|---|---|---|
| Automatic retention (delete threads, messages, memories and files older than N days) | Not provided | Run your own job. Threads carry `created_at` and `updated_at` columns, so deployer SQL or a scheduled [background task](/docs/guides/run-background-tasks) can select old threads. Delete through the thread delete path rather than raw SQL so files and traces are released too. `state_history_limit` prunes snapshots only. |
| Erase everything for one user or tenant in one call | Partial | Per-thread delete with file and trace cleanup, memory forget by filter and file delete exist. A full erase means listing and deleting each thread, then memories and files. Script it against the [REST API](/docs/reference/rest-api/threads). |
| Export of one user's data | Partial | List and read endpoints cover threads, messages, memories and files. There is no single export call; script it. |
| JWKS URL fetch for identity provider keys | Not provided | JWT verification keys rotate with `JWT_SECRET_KEYS` and `kid`. A custom `BaseAuth` can fetch asymmetric keys. See [Auth](/docs/server/auth). |
| Encryption at rest | Your infrastructure | Use Postgres, disk and bucket encryption and your key management. The app does no field encryption. |
| PII redaction in logs and telemetry | Not provided | Only secrets are masked. A custom publisher can filter events before they leave. See [Use publishers](/docs/guides/use-publishers). |
| Malware scanning of uploads | Not provided | Uploads get signature, type, size and page checks. Add a scanner in front of storage or in your upload path. |
| Backup and restore | Your infrastructure | Back up Postgres, Redis and object storage. See [Backup and restore](/docs/server/backup-and-restore). |
| MFA, user provisioning, access reviews | Your identity provider | 10xGraph verifies tokens and does not issue them. `GET /v1/me` shows the resolved access of a caller to support a review. |
| Per-tool authorization enforced by the framework | Partial | A tool can call the core `can` check on the run config. See [Authorization scopes](/docs/guides/authorization-scopes). |
| Per-run usage and cost record | Partial | OpenTelemetry spans and metrics carry usage. See [Observability](/docs/observability). |

## Project practices

These are practices of the 10xGraph project itself, relevant to SDLC questions in vendor reviews. They are not controls of your deployment.

- A security policy with private vulnerability reporting through GitHub advisories and email. See [Security policy](/docs/project/security).
- Dependabot for dependencies and GitHub Actions in all three repositories.
- CodeQL scanning on the API server and the TypeScript client.
- `bandit`, `ruff`, `mypy` and a private-key detection hook in pre-commit for the Python packages.
- CI that runs lint, type checks and tests, including integration tests against real Postgres and Redis in the core and API repositories.
- A changelog in each repository, and a deprecation policy for the public API from 1.0.

What is not there yet: signed releases, build provenance, PyPI trusted publishing, npm provenance and an SBOM. CodeQL is not enabled on the core repository, and CI does not yet run dependency vulnerability audits. If your auditor requires these, plan for your own scanning of the packages you install.

## See also

- [Audit log](/docs/server/audit-log)
- [Security model](/docs/production/security-model)
- [Production checklist](/docs/server/production-checklist)
- [Observability](/docs/observability)
