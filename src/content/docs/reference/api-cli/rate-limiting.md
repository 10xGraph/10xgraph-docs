---
title: Rate Limiting
seoTitle: "rate_limit configuration reference"
description: "Complete reference for the rate_limit block in 10xgraph.json: the cache store, limits, and every option for throttling requests to the 10xGraph API server."
section: Reference
group: "CLI and configuration"
order: 450
updated: "2026-10-31"
---

The `rate_limit` block in `10xgraph.json` turns on a sliding-window limiter for the API server. It counts REST requests, WebSocket handshakes and WebSocket graph runs against one bucket per client. The limiter is off unless the block exists; this page lists every option, header and error.

## Configuration fields

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | `true` | Enable the rate limiter when the `rate_limit` block exists. Set to `false` to temporarily disable without removing the block. |
| `requests` | integer | `100` | Maximum requests allowed per window. Must be positive. |
| `window` | integer | `60` | Window size in seconds. Must be positive. |
| `by` | string | `"ip"` | Bucket key: `"ip"` (client address), `"user"` (authenticated user ID), or `"global"` (whole service). See [Bucket keys](#bucket-keys). |
| `exclude_paths` | array | `[]` | Exact request paths to exclude from rate limiting (no wildcards). The `/ping` health check is always exempt. |
| `trusted_proxy_headers` | boolean | `false` | Honor the `X-Forwarded-For` header to extract the client IP. Only enable behind a proxy you control. |
| `trusted_proxy_hops` | integer | `1` | Number of proxies (counted from the right of `X-Forwarded-For`) that your infrastructure operates. Requires `trusted_proxy_headers: true`. Must be >= 1. |
| `trusted_proxies` | array | `[]` | IP addresses or CIDR ranges your proxies connect from. When set, `X-Forwarded-For` is honored only for requests from these networks. |
| `fail_open` | boolean | `true` | When `true`, requests are allowed if the cache store raises an error (fail-open). When `false`, requests are denied with `503` `RATE_LIMIT_UNAVAILABLE` (fail-closed). |

The counters are kept in the API's cache store, not in this block. Set `redis` in `10xgraph.json` (or `REDIS_URL`) to share them between workers, or `cache_store` for your own store. The keys `backend` and `redis` inside `rate_limit` were removed in 1.0.0rc4: they stop the server with an error that names `cache_store`. The Redis keys moved to the `10xgraph:ratelimit2` namespace, so counters reset once at upgrade.

Config load validates all values. Invalid `by`, non-positive `requests` or `window`, `trusted_proxy_hops` < 1, invalid networks in `trusted_proxies` raise `ValueError` and prevent the server from starting. A `rate_limit` block with `enabled: false` behaves as if the block were absent.

## Bucket keys

The `by` field determines which bucket counts a request.

| Value | Behavior |
|---|---|
| `"ip"` | One bucket per client IP address (the default). The IP is resolved from the peer address or, if `trusted_proxy_headers` is enabled, from `X-Forwarded-For`. |
| `"user"` | One bucket per authenticated user (keyed as `user:<user_id>`). Falls back to the client IP (`ip:<address>`) for unauthenticated requests, so anonymous traffic is still rate-limited per caller. |
| `"global"` | One bucket for the entire service (`__global__`). All clients share the limit. |

Use `"user"` when authentication is enabled to tie the limit to identity rather than address. A user roaming between addresses is then fairly limited, and a NAT-sharing office is not penalized.

## Proxy hops and X-Forwarded-For

The `X-Forwarded-For` header is a comma-separated list where each proxy appends the client it observed. The caller's original value is on the left; entries on the right were added by your infrastructure.

`trusted_proxy_hops` specifies how many proxies of yours sit in front of the app. It counts entries from the **right** of the list. With the default of `1` (one proxy), the last entry is the true client address as seen by that proxy. If the header has fewer entries than configured hops, it is ignored entirely and the peer address is used instead, with a warning.

`trusted_proxy_hops` only applies when `trusted_proxy_headers` is `true`.

Example: your app is behind a reverse proxy (nginx). Set `trusted_proxy_headers: true` and `trusted_proxy_hops: 1`. A request reaching the app with `X-Forwarded-For: attacker-ip, nginx-ip` uses `nginx-ip` (the last entry), not `attacker-ip`.

When `trusted_proxies` is configured, `X-Forwarded-For` is honored only for requests whose peer address (the direct connection) is in one of the listed networks. This prevents a client that can reach the app directly (bypassing the proxy) from spoofing the `X-Forwarded-For` header to get a fresh bucket.

```json
"rate_limit": {
  "trusted_proxy_headers": true,
  "trusted_proxy_hops": 1,
  "trusted_proxies": ["10.0.0.0/8", "172.16.0.0/12"]
}
```

## Response headers and errors

Every HTTP response includes these headers:

| Header | Description |
|---|---|
| `X-RateLimit-Limit` | Configured request limit. |
| `X-RateLimit-Remaining` | Requests remaining in the current window. |
| `X-RateLimit-Reset` | Unix timestamp when the window resets. |
| `X-RateLimit-Reset-After` | Seconds until the window resets. |
| `Retry-After` | Present on `429` responses, equal to `X-RateLimit-Reset-After`, and on `503` `RATE_LIMIT_UNAVAILABLE` responses (`5`). |

When a client exceeds the limit, the server responds with status `429 Too Many Requests` and the following body:

```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests. Limit: 100 per 60s. Retry after 12s.",
    "limit": 100,
    "window_seconds": 60,
    "retry_after_seconds": 12
  },
  "metadata": {
    "request_id": "...",
    "status": "error"
  }
}
```

When the cache store raises an error and `fail_open` is `false`, the server responds with `503 Service Unavailable` and `Retry-After: 5` instead of 429. A real limit hit stays 429. Added in 1.0.0rc3.

```json
{
  "error": {
    "code": "RATE_LIMIT_UNAVAILABLE",
    "message": "Rate limiter unavailable: its backend could not be reached.",
    "retry_after_seconds": 5
  },
  "metadata": {
    "request_id": "...",
    "status": "error"
  }
}
```

## WebSocket handshakes and graph runs

WebSocket handshakes bypass HTTP middleware, so the server re-applies the same check when a client connects to `/v1/graph/ws` or `/v1/graph/live`. A handshake counts like an HTTP request against the same bucket and cache store. If the bucket is full, the handshake is rejected with close code `1013` (Try Again Later) and the reason `Rate limit exceeded`.

Each graph run sent over an open `/v1/graph/ws` connection also counts against the bucket. When the bucket is full, the connection stays open, the run is skipped, and the server sends an `error` stream event whose data holds `reason` (`Rate limit exceeded. Retry after <n>s.`) and `retry_after_seconds`.

The separate `websocket.max_connections` and `websocket.max_connections_per_user` caps (in the `websocket` block of `10xgraph.json`) are enforced by the same handshake guard and also reject with close code `1013`. They are shared by all workers when a shared cache store is configured and per process otherwise.

## Cache store

The limiter takes one slot per request from the API's cache store (`BaseCacheStore.acquire`); the slot is never released and expires after `window` seconds. A denied call adds nothing, so a client over its limit does not extend its own penalty.

| Cache store | Use case |
|---|---|
| `InMemoryCacheStore` | Development, tests, single-process deployments. Counters are in-process memory and reset when the worker restarts. With N workers, the effective limit is `requests x N`. It keeps at most 50,000 slot keys and evicts the least recently used. This is the default when no Redis URL or `cache_store` is set. |
| `RedisCacheStore` | Production multi-worker deployments (Gunicorn/Uvicorn), Docker, Kubernetes. Counters are shared across all workers. Chosen by `redis` in `10xgraph.json` or `REDIS_URL`. Valkey, Dragonfly and KeyDB work through the same URL. |
| Your own | A store that does not speak the Redis protocol. Implement `BaseCacheStore` and set `"cache_store": "module:attr"`. See [Bring your own backend](/docs/server/bring-your-own-backend). |

Removed in 1.0.0rc4: `BaseRateLimitBackend`, `MemoryRateLimitBackend`, `RedisRateLimitBackend`, and the `rate_limit.backend` and `rate_limit.redis` keys. A cache store signals an outage by raising; `fail_open` decides what happens next.

## Examples

Minimal configuration with the in-memory cache store and default limits:

```json
{
  "agent": "graph.react:app",
  "rate_limit": {
    "enabled": true,
    "requests": 100,
    "window": 60,
    "by": "ip",
    "exclude_paths": ["/ping", "/docs", "/redocs", "/openapi.json"]
  }
}
```

Production setup with a Redis cache store, user-based limiting, trusted proxies:

```json
{
  "agent": "graph.react:app",
  "redis": "${REDIS_URL}",
  "rate_limit": {
    "enabled": true,
    "requests": 1000,
    "window": 60,
    "by": "user",
    "trusted_proxy_headers": true,
    "trusted_proxy_hops": 1,
    "trusted_proxies": ["10.0.0.0/8"],
    "exclude_paths": ["/ping", "/docs", "/redocs"],
    "fail_open": false
  }
}
```

With the `.env` file:

```bash
REDIS_URL=redis://localhost:6379/0
```

The `${REDIS_URL}` value is expanded from the environment when the config loads. To use Redis, install the optional dependency:

```bash
pip install "10xgraph-api[redis]"
```

## See also

- [Rate limiting guide](/docs/server/rate-limiting): how to set up and troubleshoot
- [Configuration reference](/docs/reference/api-cli/configuration): all `10xgraph.json` keys
- [Environment variables](/docs/reference/api-cli/environment): server environment settings
