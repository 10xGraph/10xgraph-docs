---
title: What 10xGraph does not protect
seoTitle: "What 10xGraph does not protect"
description: "The limits of the 10xGraph server: prompt injection, tool logic, open auth, secrets, TLS, backups, streaming replay, release-candidate status and Python 3.12+."
section: "Production"
order: 40
label: What it does not protect
updated: "2026-10-28"
faq:
  - q: "Does 10xGraph stop prompt injection?"
    a: "No. Validators, approval through interrupt() and tool allow-lists bound what an injected instruction can do, but a model can still be talked into using the tools you gave it. Give it only the tools it needs and require approval for tools with side effects."
  - q: "Does the server refuse to start without auth?"
    a: "No. With auth set to null the server starts and accepts every request, including in production. Configure auth before you expose the server."
  - q: "Do streamed runs get replay-safe tool calls?"
    a: "No. The tool ledger is consulted only on the invoke path. A streamed run that crashes and resumes can run a finished tool again, so give side-effecting tools an idempotency key."
---

10xGraph enforces a lot at the server, and the [readiness table](/docs/production) says which. This page lists what it does not do, so you can plan for it. Each item says what to do.

## Prompt injection is bounded, not removed

A model reads untrusted text: user messages, web pages, documents, tool output. Any of it can contain instructions. 10xGraph cannot make a model ignore them.

What it gives you is a smaller blast radius:

- **Validators** check input and output around the model.
- **Approval through `interrupt()`** pauses a run before a risky tool, so a person decides.
- **Tool allow-lists** limit which tools a node can call at all.
- **Server-side rules** mean a caller cannot set identity, the file tool root or the tool limits from the request.

What to do: give each agent only the tools it needs, put an approval step in front of tools that spend money, send messages or change data, and treat tool output as untrusted. See [Protect against prompt injection](/docs/guides/protect-against-prompt-injection), [Security and validators](/docs/concepts/security-and-validators) and [Add human approval](/docs/guides/add-human-approval).

## Your tools' business logic and authorization

The server decides whether a caller may start a run on a thread. It does not know what your `refund_order` or `get_customer` tool should allow. If a tool takes an id from the model, nothing stops the model from passing someone else's id unless the tool checks.

What to do: inside each tool, check that the authenticated user may touch the object. The user id comes from the verified config, never from state or model output. See [Dependency injection](/docs/guides/use-dependency-injection) and [Authorization scopes](/docs/guides/authorization-scopes).

## `auth: null` starts an open server

If `auth` is `null`, the server serves every route to anyone who can reach it. With `MODE=production` it still starts. Nothing refuses it. Ownership checks need an identity, so with no auth there is nobody to own a thread.

What to do: set `"auth": "jwt"` with a strong `JWT_SECRET_KEY`, or a custom `BaseAuth` class, before the server is reachable. The `10xgraph init` production template does this for you. See [Auth](/docs/server/auth) and the [production checklist](/docs/server/production-checklist).

## Secrets management

10xGraph reads secrets from the environment and redacts known secret formats in its logs. It does not store, rotate or encrypt them. Provider keys, `JWT_SECRET_KEY` and database URLs are yours to manage.

What to do: use your platform's secret store, keep `.env` out of the image and the repository, and rotate keys on a schedule. See [Production checklist](/docs/server/production-checklist).

## TLS and network edge

The container serves plain HTTP. The server sets security headers and can emit HSTS, but it does not terminate TLS, filter by network, or protect against volumetric attacks.

What to do: terminate TLS at your load balancer or ingress, set `ALLOWED_HOST` and `ORIGINS`, and if you use client IP rate limiting behind a proxy, set `rate_limit.trusted_proxies`. See [CORS and security headers](/docs/server/cors-and-security-headers) and [Kubernetes](/docs/server/kubernetes).

## Data retention and backups

Threads, messages and uploaded files stay until something deletes them. Deleting a thread or message also releases the files it referenced, but 10xGraph sets no retention period and does not back up your database.

What to do: back up PostgreSQL, decide a retention policy, and delete threads when users ask. See [Backup and restore](/docs/server/backup-and-restore).

## Streaming runs have no tool ledger

Replay-safe tools record each finished call in the checkpointer and skip it on resume. That check is in the invoke path only. The streaming tool path does not read or write the ledger, so a streamed run that crashes mid-node can run a finished tool again. A crash before a tool returns, or in the short gap before its record is written, can also repeat it.

What to do: send an idempotency key derived from stable inputs (an order id, not a random value) to payment, email and ticket providers. See [Replay-safe tools](/docs/concepts/replay-safe-tools).

## Versioning

10xGraph 1.0 is a release candidate until the final ships. From 1.0 the public API is stable under a deprecation policy: breaking changes only in a major release, after at least one minor of deprecation. The deprecated `agentflow` aliases stay until 2.0. The community is smaller than the older frameworks'.

What to do: pin exact versions, read the changelog before each upgrade, and run your tests and evals in CI first. See [Test before production](/docs/testing/before-production) and the [upgrade guides](/docs/project).

## Python 3.12 or newer

The core and the API server require Python 3.12 or newer. Other runtimes can call a served agent through the REST API or the TypeScript client, but the graph itself is Python.

What to do: run the image from `10xgraph build`, which defaults to Python 3.13. See [Installation](/docs/get-started/installation).
