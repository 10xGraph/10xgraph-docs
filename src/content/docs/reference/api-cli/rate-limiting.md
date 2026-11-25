---
title: Rate Limiting
seoTitle: "cache_store.rate_limit reference"
description: "Fields, headers and errors of the cache_store.rate_limit block in 10xgraph.json."
section: Reference
group: "CLI and configuration"
order: 450
updated: "2026-11-25"
---

The `rate_limit` object inside `cache_store` in `10xgraph.json` turns on a sliding-window limiter for the API server. It counts REST requests, WebSocket handshakes and WebSocket graph runs against one bucket per client.

## Configuration fields

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | `true` | Enable the rate limiter when the `cache_store.rate_limit` block exists. Set to `false` to temporarily disable without removing the block. |
| `requests` | integer | `100` | Maximum requests allowed per window. Must be positive. |
| `window` | integer | `60` | Window size in seconds. Must be positive. |
| `by` | string | `"ip"` | Bucket key: `"ip"` (client address), `"user"` (authenticated user ID), or `"global"` (whole service). See [Bucket keys](#bucket-keys). |
| `exclude_paths` | array | `[]` | Exact request paths to exclude from rate limiting (no wildcards). `/ping` and `/health/ready` are always exempt. |
| `trusted_proxy_headers` | boolean | `false` | Honor the `X-Forwarded-For` header to extract the client IP. Only enable behind a proxy you control. |
| `trusted_proxy_hops` | integer | `1` | Number of proxies (counted from the right of `X-Forwarded-For`) that your infrastructure operates. Requires `trusted_proxy_headers: true`. Must be >= 1. |
| `trusted_proxies` | array | `[]` | IP addresses or CIDR ranges your proxies connect from. `[]` means loopback and private networks only (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, link-local, CGNAT and IPv6 equivalents). `X-Forwarded-For` is honored only from the listed networks. `0.0.0.0/0` and `::/0` trust every peer. |
| `fail_open` | boolean | `true` | When `true`, requests are allowed if the cache store raises an error (fail-open). When `false`, requests are denied with `503` `RATE_LIMIT_UNAVAILABLE` (fail-closed). |

The `rate_limit` object sits inside `cache_store`, and the counters are kept in that cache store. Set `cache_store.type` to `redis` to share them between workers, or `custom` with a `path` for your own store. An unknown key inside `rate_limit` stops the server with an error that lists the valid ones.

Invalid values stop the server at startup.

## Bucket keys

The `by` field determines which bucket counts a request.

| Value | Behavior |
|---|---|
| `"ip"` | One bucket per client IP address (the default). The IP is resolved from the peer address or, if `trusted_proxy_headers` is enabled, from `X-Forwarded-For`. |
| `"user"` | One bucket per authenticated user (keyed as `user:<user_id>`). Falls back to the client IP (`ip:<address>`) for unauthenticated requests, so anonymous traffic is still rate-limited per caller. |
| `"global"` | One bucket for the entire service (`__global__`). All clients share the limit. |

## Proxy hops and X-Forwarded-For

The `X-Forwarded-For` header is a comma-separated list where each proxy appends the client it observed. The caller's original value is on the left; entries on the right were added by your infrastructure.

`trusted_proxy_hops` specifies how many proxies of yours sit in front of the app. It counts entries from the **right** of the list. With the default of `1` (one proxy), the last entry is the true client address as seen by that proxy. If the header has fewer entries than configured hops, it is ignored entirely and the peer address is used instead, with a warning.

See [Behind a reverse proxy](/docs/server/rate-limiting#behind-a-reverse-proxy).

## Response headers and errors

Every response to a rate-limited path includes these headers:

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

When the cache store raises an error and `fail_open` is `false`, the server responds with `503 Service Unavailable` and `Retry-After: 5` instead of 429. A real limit hit stays 429.

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

## Cache store

Counters live in the API's `cache_store` (one slot per request, never released, expires after `window`). See [BaseCacheStore](/docs/reference/api-cli/cache-store).

## See also

- [Rate limiting guide](/docs/server/rate-limiting): how to set up and troubleshoot
- [Configuration reference](/docs/reference/api-cli/configuration): all `10xgraph.json` keys
- [Environment variables](/docs/reference/api-cli/environment): server environment settings
