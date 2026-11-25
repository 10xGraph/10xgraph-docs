---
title: "Security and access"
description: "Authentication, roles, tenant isolation, rate limits, CORS, prompt-injection validators and audit logs for a 10xGraph server and its agents."
section: "Security and access"
order: 0
updated: "2026-11-25"
---

- [Authentication and roles](/docs/server/auth): Enable JWT or custom auth, map roles to permissions and set each role's reach.
- [Permissions in tools](/docs/guides/authorization-scopes): Read the caller's identity and check permissions inside graph nodes and tools with get_identity, can and Identity.
- [Tenant isolation](/docs/guides/multi-tenant-data): Isolate organizations and projects in one Postgres with tenant columns on PgCheckpointer and PgVectorStore, set reach per role and filter your own columns.
- [Rate limiting](/docs/server/rate-limiting): How to enable and configure the built-in sliding-window rate limiter in the 10xGraph API.
- [CORS and security headers](/docs/server/cors-and-security-headers): Configure cross-origin requests, security headers, request size limits, and trusted proxies.
- [Prompt-injection validators](/docs/guides/protect-against-prompt-injection): Validate user input and tool output before the model reads it.
- [Zero-trust agents](/docs/security/zero-trust-agents): Check every tool call against the caller with ToolGuard, ask a human before risky tools, fence tool output, use mTLS on each link and see what stays your job.
- [Use mutual TLS](/docs/security/use-mutual-tls): Run the client to API, Postgres, Redis, LLM and MCP links over mutual TLS, with a tested snippet for each and what is not covered.
- [Audit log](/docs/server/audit-log): Metadata-only JSON audit events for access, authentication failures and changes, how to configure sinks, ship the lines to storage, and what stays yours.
