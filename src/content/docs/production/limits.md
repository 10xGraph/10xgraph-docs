---
title: What 10xGraph does not protect
seoTitle: "What 10xGraph does not protect"
description: "The limits of the 10xGraph server: open auth, secrets, TLS at your proxy, the per-process cache store, backups and tools that can run twice."
section: "Platform"
order: 50
label: What it does not protect
updated: "2026-11-25"
faq:
  - q: "Does the server refuse to start without auth?"
    a: "No. With auth set to null the server starts and accepts every request, including in production. Configure auth before you expose the server."
  - q: "Do streamed runs get replay-safe tool calls?"
    a: "Yes. The tool ledger is consulted on both the invoke and the streaming path. A crash in the short gap between a tool finishing and its record being written can still repeat the tool, so give side-effecting tools an idempotency key."
---

This page lists what the server does not do, and what to do instead. For the SOC 2 and ISO 27001 view, see the [control mapping](/docs/production/control-mapping).

## `auth: null` starts an open server

If `auth` is `null`, the server serves every route to anyone who can reach it. With `MODE=production` it still starts, with one warning in the log. Reach-scoped queries (own, tenant or all) need an identity, so with no auth there is nobody to own a thread.

What to do: set `"auth": "jwt"` with a strong `JWT_SECRET_KEY`, or a custom `BaseAuth` class, before the server is reachable. The `10xgraph init` Full setup does this for you. See [Auth](/docs/server/auth) and the [production checklist](/docs/server/production-checklist).

## Secrets management

10xGraph reads secrets from the environment and redacts known secret formats in its logs. It does not store, rotate or encrypt them.

What to do: inject provider keys, `JWT_SECRET_KEY` and database URLs from your secret manager, keep `.env` out of the image and the repository, and rotate keys on a schedule. See [Production checklist](/docs/server/production-checklist).

## TLS and network edge

TLS and mTLS end at your proxy or mesh. The container serves plain HTTP. The server sets security headers and can emit HSTS, but it does not terminate TLS, filter by network, or protect against volumetric attacks.

What to do: terminate TLS at your load balancer or ingress, set `ALLOWED_HOST` and `ORIGINS`, and if you use client IP rate limiting behind a proxy, set `cache_store.rate_limit.trusted_proxies`. See [CORS and security headers](/docs/server/cors-and-security-headers) and [Kubernetes](/docs/server/kubernetes).

## The default cache store is per process

Without a `cache_store` of type `redis` or `custom`, run locks, caps, idempotency, rate-limit counters and token revocations live in one process, so with several workers they do not add up.

What to do: set `cache_store.type` to `redis` for any multi-worker deployment, with `maxmemory-policy` `noeviction` or a `volatile-*` policy. See [Scaling and reliability](/docs/production/scaling#what-the-cache-store-shares-across-workers).

## Data retention and backups

Threads, messages and uploaded files stay until something deletes them. Deleting a thread or message also releases the files it referenced, but 10xGraph sets no retention period and does not back up your database. The same holds for audit and JSON log lines: 10xGraph writes them to stdout and stores nothing, so retention, access control and tamper protection for them belong to your log pipeline.

What to do: back up PostgreSQL, decide a retention policy for data and for logs, and delete threads when users ask. See [Backup and restore](/docs/server/backup-and-restore).

## Tools run at least once

Replay-safe tools record each finished call in the checkpointer and skip it on resume. The check runs on both the invoke and the streaming path. A crash before a tool returns, or in the short gap before its record is written, can repeat the tool. A tool that was running when a run was cancelled or crashed gets an error result on the next turn, and the model may call it again.

What to do: send an idempotency key derived from stable inputs (an order id, not a random value) to payment, email and ticket providers. See [Replay-safe tools](/docs/concepts/replay-safe-tools).
