---
title: "Security and access"
description: "Authentication, roles, tenant isolation, rate limits, CORS, prompt-injection validators and audit logs for a 10xGraph server and its agents."
section: "Security and access"
order: 0
updated: "2026-11-10"
---

This section covers how to control access to a 10xGraph server and its agents: who can call it, what each role can see, how tenant data stays separate, and how requests are limited, screened and logged.

- [Authentication and roles](/docs/server/auth): Enable JWT or custom auth, map roles to permissions, set how far each role can see, and keep every user's data private in 10xGraph.
- [Permissions in tools](/docs/guides/authorization-scopes): Read the caller's identity and check permissions inside graph nodes and tools with get_identity, can and Identity.
- [Tenant isolation](/docs/guides/multi-tenant-data): Isolate organizations and projects in one Postgres with tenant columns on PgCheckpointer and PgVectorStore, set reach per role and filter your own columns.
- [Rate limiting](/docs/server/rate-limiting): How to enable and configure the built-in sliding-window rate limiter in the 10xGraph API.
- [CORS and security headers](/docs/server/cors-and-security-headers): Configure cross-origin requests, security headers, request size limits, and trusted proxies.
- [Prompt-injection validators](/docs/guides/protect-against-prompt-injection): How to validate and sanitize user input before it reaches your agent's LLM, protecting against prompt injection, jailbreaks, and other OWASP LLM01:2025 attacks.
- [Audit log](/docs/server/audit-log): Metadata-only JSON audit events for access, authentication failures and changes, how to configure sinks, ship the lines to storage, and what stays yours.
