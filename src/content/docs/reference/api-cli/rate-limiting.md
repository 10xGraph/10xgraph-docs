---
title: Rate Limiting
seoTitle: "rate_limit configuration reference"
description: "Complete reference for the rate_limit block in 10xgraph.json: the backends, limits, and every option for throttling requests to the 10xGraph API server."
section: Reference
group: "CLI and configuration"
order: 450
updated: "2026-10-27"
---

The `rate_limit` block in `10xgraph.json` turns on a sliding-window limiter for the API server. It counts REST requests, WebSocket handshakes and WebSocket graph runs against one bucket per client. The limiter is off unless the block exists; this page lists every option, header and error.

## Configuration fields

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | `true` | Enable the rate limiter when the `rate_limit` block exists. Set to `false` to temporarily disable without removing the block. |
| `backend` | string | `"memory"` | Counter storage: `"memory"`, `"redis"`, or `"custom"`. |
| `requests` | integer | `100` | Maximum requests allowed per window. Must be positive. |
| `window` | integer | `60` | Window size in seconds. Must be positive. |
| `by` | string | `"ip"` | Bucket key: `"ip"` (client address), `"user"` (authenticated user ID), or `"global"` (whole service). See [Bucket keys](#bucket-keys). |
| `exclude_paths` | array | `[]` | Exact request paths to exclude from rate limiting (no wildcards). The `/ping` health check is always exempt. |
| `trusted_proxy_headers` | boolean | `false` | Honor the `X-Forwarded-For` header to extract the client IP. Only enable behind a proxy you control. |
| `trusted_proxy_hops` | integer | `1` | Number of proxies (counted from the right of `X-Forwarded-For`) that your infrastructure operates. Requires `trusted_proxy_headers: true`. Must be >= 1. |
| `trusted_proxies` | array | `[]` | IP addresses or CIDR ranges your proxies connect from. When set, `X-Forwarded-For` is honored only for requests from these networks. |
| `redis` | object or string | `null` | Redis connection for the `"redis"` backend. Either `{"url": "...", "prefix": "..."}` or a bare URL string (uses default prefix). The URL supports `$ENV_VAR` and `${ENV_VAR}` expansion. |
| `redis.url` | string | `null` | Redis connection URL. Required for `"redis"` backend unless a Redis client is bound in InjectQ. |
| `redis.prefix` | string | `"10xgraph:rate-limit"` | Key prefix for all Redis entries. The default changed from `"agentflow:rate-limit"` in version 0.7.0, so counters restart once on upgrade. |
| `fail_open` | boolean | `true` | When `true`, requests are allowed if the Redis backend is unreachable (fail-open). When `false`, requests are denied with `503` `RATE_LIMIT_UNAVAILABLE` (fail-closed). Only applies to `"redis"` backend. |

Config load validates all values. Invalid `by`, `backend`, non-positive `requests` or `window`, `trusted_proxy_hops` < 1, invalid networks in `trusted_proxies`, or an unresolved `$ENV_VAR` in the Redis URL raise `ValueError` and prevent the server from starting. A `rate_limit` block with `enabled: false` behaves as if the block were absent.

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

When the Redis backend cannot be reached and `fail_open` is `false`, the server responds with `503 Service Unavailable` and `Retry-After: 5` instead of 429. A real limit hit stays 429. Added after 1.0.0rc2.

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

WebSocket handshakes bypass HTTP middleware, so the server re-applies the same check when a client connects to `/v1/graph/ws` or `/v1/graph/live`. A handshake counts like an HTTP request against the same bucket and backend. If the bucket is full, the handshake is rejected with close code `1013` (Try Again Later) and the reason `Rate limit exceeded`.

Each graph run sent over an open `/v1/graph/ws` connection also counts against the bucket. When the bucket is full, the connection stays open, the run is skipped, and the server sends an `error` stream event whose data holds `reason` (`Rate limit exceeded. Retry after <n>s.`) and `retry_after_seconds`.

The separate `websocket.max_connections` and `websocket.max_connections_per_user` caps (in the `websocket` block of `10xgraph.json`) are enforced by the same handshake guard and also reject with close code `1013`. They are shared by all workers when Redis is configured and per process otherwise.

## Backend comparison

| Backend | Use case |
|---|---|
| `memory` | Development, tests, single-process deployments. Counters are in-process memory and reset when the worker restarts. With N workers, the effective limit is `requests x N`. A startup warning is logged. |
| `redis` | Production multi-worker deployments (Gunicorn/Uvicorn), Docker, Kubernetes. Counters are shared across all workers. Respects `fail_open` for backend outages. |
| `custom` | Custom storage backends, external quota services, or non-standard enforcement logic. Implement `BaseRateLimitBackend` and bind an instance in InjectQ. Startup fails with `ValueError` if none is bound. |

## Custom backend

Subclass `BaseRateLimitBackend` when neither built-in backend fits, for example to call an external quota service. Both methods are abstract. `check` must atomically record the request and return a `RateLimitDecision` with `allowed`, `remaining` and `reset_after` (seconds). `close` releases resources at shutdown. A backend that cannot reach its store and must not let the request through returns `RateLimitDecision.backend_unavailable()` (optional `retry_after` seconds, default 5); the middleware answers it with the 503 above. Added after 1.0.0rc2.

```python title="my_backend.py"
import time

from tenxgraph_api.src.app.core.middleware.rate_limit import (
    BaseRateLimitBackend,
    RateLimitDecision,
)


class FixedWindowBackend(BaseRateLimitBackend):
    """Single-process fixed-window counter, shown as the smallest working example."""

    def __init__(self) -> None:
        self._windows: dict[str, tuple[float, int]] = {}

    async def check(self, key: str, *, limit: int, window: int) -> RateLimitDecision:
        now = time.monotonic()
        start, count = self._windows.get(key, (now, 0))
        if now - start >= window:
            start, count = now, 0  # window expired: start a new one
        count += 1
        self._windows[key] = (start, count)
        reset_after = max(1, int(start + window - now))
        return RateLimitDecision(
            allowed=count <= limit,
            remaining=max(0, limit - count),
            reset_after=reset_after,
        )

    async def close(self) -> None:
        self._windows.clear()
```

Set `"backend": "custom"` in `10xgraph.json`, then bind an instance under the `BaseRateLimitBackend` type in the InjectQ container the server uses (see the `injectq` key in the [configuration reference](/docs/reference/api-cli/configuration)).

```python title="container.py"
from injectq import InjectQ

from my_backend import FixedWindowBackend
from tenxgraph_api.src.app.core.middleware.rate_limit import BaseRateLimitBackend

container = InjectQ.get_instance()
# The server resolves the backend by this type at startup
container.bind_instance(BaseRateLimitBackend, FixedWindowBackend())
```

## Examples

Minimal configuration with in-memory backend and default limits:

```json
{
  "agent": "graph.react:app",
  "rate_limit": {
    "enabled": true,
    "backend": "memory",
    "requests": 100,
    "window": 60,
    "by": "ip",
    "exclude_paths": ["/ping", "/docs", "/redocs", "/openapi.json"]
  }
}
```

Production setup with Redis, user-based limiting, trusted proxies:

```json
{
  "agent": "graph.react:app",
  "rate_limit": {
    "enabled": true,
    "backend": "redis",
    "requests": 1000,
    "window": 60,
    "by": "user",
    "trusted_proxy_headers": true,
    "trusted_proxy_hops": 1,
    "trusted_proxies": ["10.0.0.0/8"],
    "exclude_paths": ["/ping", "/docs", "/redocs"],
    "redis": {
      "url": "${RATE_LIMIT_REDIS_URL}",
      "prefix": "10xgraph:rate-limit"
    },
    "fail_open": false
  }
}
```

With the `.env` file:

```bash
RATE_LIMIT_REDIS_URL=redis://localhost:6379/0
```

The `${RATE_LIMIT_REDIS_URL}` value is expanded from the environment when the config loads. To use the Redis backend, install the optional dependency:

```bash
pip install "10xgraph-api[redis]"
```

## See also

- [Rate limiting guide](/docs/server/rate-limiting): how to set up and troubleshoot
- [Configuration reference](/docs/reference/api-cli/configuration): all `10xgraph.json` keys
- [Environment variables](/docs/reference/api-cli/environment): server environment settings
