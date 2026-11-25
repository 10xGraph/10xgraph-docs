---
title: "Security and access"
description: "The layers that protect a 10xGraph server and its agents in request order, what each one does by default, and what the Full setup turns on."
section: "Security and access"
order: 0
updated: "2026-11-25"
---

10xGraph checks a request in layers. Each layer has one job, and a request must pass all of them before a tool runs. This page lists the layers in the order a request meets them, with the default of each. Most are off or open until you set them, so read the table below before you go live.

## The layers, in request order

1. **TLS and mutual TLS.** The server speaks plain HTTP. Your proxy, load balancer or mesh ends TLS and, if you want it, mTLS. For the links the app opens (Postgres, Redis, the model provider, MCP) you give the client a certificate. Default: none, you provide it. See [Use mutual TLS](/docs/security/use-mutual-tls).
2. **CORS, host check and security headers.** `ORIGINS` and `ALLOWED_HOST` default to `*`. Security headers (HSTS on HTTPS only, `nosniff`, `X-Frame-Options: DENY`, a Content-Security-Policy, and others) are on by default. Requests over 10 MB are refused (`MAX_REQUEST_SIZE`). In production, a wildcard origin or host stops startup.
3. **Rate limit.** A sliding-window limiter in `cache_store.rate_limit`, by IP, user or global. Default: off. It counts 100 requests per 60 seconds when enabled, and it allows requests if the cache store fails unless you set `fail_open: false`.
4. **Authentication.** `none`, `jwt` or a custom `BaseAuth` class. Default: `auth: null`, so the server starts open, also in production. JWT checks the algorithm, requires `exp` and rejects `none`. Token revocation is opt-in.
5. **RBAC permissions and reach.** Each route needs a permission such as `threads:read`. Each role has a reach (`own`, `tenant` or `all`) that widens reads, lists, deletes and stop. Default with auth on and no roles: every permission except `admin:*`, reach `own`. The server refuses to boot if a non-public route has no permission guard.
6. **Tenant isolation in storage.** Every query filters by the caller's owner and reach, so a foreign thread, file or memory answers 404. Tenant columns and optional row-level security work only in Postgres storage (`PgCheckpointer`, `PgVectorStore`). Default: owner scoping with auth, no tenant columns until you declare them.
7. **Input rules and prompt-injection validators.** Clients may send only user messages, `state_keys` deny by default, thread ids come from the server, and the server assigns message ids. `PromptInjectionValidator` and the message validators run before the model reads input and are registered on the graph's `CallbackManager`. Default: not registered unless you add them.
8. **ToolGuard.** A `before_invoke` check on every local and MCP tool call: allow list, permissions (`tools:<name>`), an argument check, then optional human approval. Default: no guard until you register one. A denied call returns "Denied by policy" to the model and the tool does not run. See [Zero-trust agents](/docs/security/zero-trust-agents).
9. **Audit log.** One metadata-only JSON line per access decision, authentication failure, change, rejected input and rate-limit refusal. No prompts, answers or tokens. Default: off (`audit.enabled`). Your log pipeline stores the lines.

## What the Full setup turns on

`10xgraph init --mode full` writes the first column. The Quick setup writes none of these.

| Layer | Full setup | You turn on |
|---|---|---|
| TLS and mTLS | Nothing | Proxy TLS, client certificates |
| CORS, host, headers | Headers and size limit are on in any mode | `ORIGINS` and `ALLOWED_HOST` (required with `MODE=production`) |
| Rate limit | On: 100 per 60 s, by user, `fail_open: false` | Redis cache store for shared counters |
| Authentication | `jwt` | `JWT_SECRET_KEY`, issuer and audience checks, custom auth |
| Token revocation | On | Redis cache store to share it across workers |
| RBAC | Default permissions, reach `own` | `roles`, `tenant_claims`, reach `tenant` or `all` |
| Tenant isolation | Owner scoping | `--storage postgres`, tenant columns, row-level security |
| Prompt-injection validator | `PromptInjectionValidator` registered on the graph | Custom validators, other patterns |
| ToolGuard | Not added | `ToolGuard` on the `CallbackManager` |
| Audit log | On: `log` sink, reads included | A `publisher` or custom sink, shipping to storage |

With the memory cache store, rate limits and revocations hold per process only. The generated deploy files set `MODE=production`, which adds the strict boot checks.

## SOC 2, ISO 27001 and GDPR

Most of the technical controls a SOC 2, ISO 27001 or GDPR review asks for are built in. The [control mapping](/docs/production/control-mapping) lists each control, its default and what stays with your organization.

## Pages in this section

- [Authentication and roles](/docs/server/auth): Enable JWT or custom auth, map roles to permissions and set each role's reach.
- [Permissions in tools](/docs/guides/authorization-scopes): Read the caller's identity and check permissions inside graph nodes and tools with get_identity, can and Identity.
- [Tenant isolation](/docs/guides/multi-tenant-data): Isolate organizations and projects in one Postgres with tenant columns on PgCheckpointer and PgVectorStore, set reach per role and filter your own columns.
- [Rate limiting](/docs/server/rate-limiting): How to enable and configure the built-in sliding-window rate limiter in the 10xGraph API.
- [CORS and security headers](/docs/server/cors-and-security-headers): Configure cross-origin requests, security headers, request size limits, and trusted proxies.
- [Prompt-injection validators](/docs/guides/protect-against-prompt-injection): Validate user input and tool output before the model reads it.
- [Zero-trust agents](/docs/security/zero-trust-agents): Check every tool call against the caller with ToolGuard, ask a human before risky tools, fence tool output, use mTLS on each link and see what stays your job.
- [Use mutual TLS](/docs/security/use-mutual-tls): Run the client to API, Postgres, Redis, LLM and MCP links over mutual TLS, with a tested snippet for each and what is not covered.
- [Audit log](/docs/server/audit-log): Metadata-only JSON audit events for access, authentication failures and changes, how to configure sinks, ship the lines to storage, and what stays yours.
