---
title: Cache store
seoTitle: "The 10xGraph cache store: locks, rate limits and revocation"
description: What the API server keeps in its cache store, when to use memory, Redis or a custom backend, what is shared between processes, and how each feature behaves when the store fails.
section: Concepts
group: "Serving"
order: 173
updated: "2026-11-10"
faq:
  - q: "Do I need Redis?"
    a: "Not for one process in development. The default memory store is per process. Use Redis when you run several workers or pods, or the worker for background jobs, so they share locks, counters and revocations."
  - q: "What happens if Redis goes down?"
    a: "It depends on the feature. Token revocation fails closed with 503, and an unreachable cache store refuses to boot when revocation is on. Rate limiting allows requests by default (fail_open true) and denies with 503 when you set it to false."
---

The API keeps everything it must share between its own processes in one object, the **cache store**. It is separate from the checkpointer and the long-term store: those hold your data, and the cache store holds short-lived coordination state.

## What it holds

- **Run locks and caps**: the per-thread run lock, and the limits on runs and WebSocket connections per user.
- **Idempotency**: the state the server uses to recognize a repeated request.
- **Token revocation**: revoked tokens and users, checked on every permission check and during long sessions.
- **Rate-limit counters**: one window per key (by IP, user or global).
- **Background task state**: status records, cancel flags and schedules for the [worker](/docs/concepts/background-jobs).

## Memory, Redis or custom

You pick the store with `cache_store.type`:

| Type | Use it for | Shared between processes |
| --- | --- | --- |
| `memory` (default) | Development and a single process | No, each process has its own |
| `redis` | Production with several workers or pods. Valkey, Dragonfly and KeyDB work through the URL. | Yes |
| `custom` | A backend that does not speak the Redis protocol; `path` points to a `BaseCacheStore` | Depends on your backend |

With `memory`, a lock taken in one process is invisible to another, a rate limit of 100 requests becomes 100 per process, and a revocation applies only where it was made. The Redis URL comes from `cache_store.url` or the `REDIS_URL` environment variable. `REDIS_URL` alone does not select Redis; set the type. The production template writes a Redis store with rate limiting and token revocation.

## When the store fails

- **Token revocation** fails closed: a store error answers 503, and a store that is unreachable at boot refuses to start.
- **Rate limiting** follows `cache_store.rate_limit.fail_open`. The default is `true`, which lets requests through during an outage. Set it to `false` to answer 503 instead.
- **A type `redis` without the `redis` package** refuses to boot.

Choose these on purpose: fail open favors availability, fail closed favors enforcement.

## Next steps

- [Configure the server](/docs/server/configure): the `cache_store` key, `rate_limit` and `token_revocation`.
- [Extension points](/docs/concepts/extensibility): the `BaseCacheStore` contract.
- [Serving agents](/docs/concepts/serving-agents): where rate limiting fits in the request path.
