---
title: Configure Rate Limiting
description: How to enable and configure the built-in sliding-window rate limiter in the 10xGraph API.
section: "API server"
group: "Security"
order: 70
updated: "2026-10-27"
faq:
  - question: Do I need rate limiting in development?
    answer: "In development, you can run without limits. In any production environment, rate limiting protects your infrastructure from both accidental overuse and abuse."
  - question: How much does Redis add to the setup?
    answer: "The limiter reuses a Redis client already bound in the InjectQ container (under `redis`, `redis_client` or `Redis`). Otherwise it needs `rate_limit.redis.url` and opens its own connection."
  - question: What happens if Redis is unreachable?
    answer: "With `fail_open: true` (the default), requests pass through; with `fail_open: false`, requests are denied. Choose based on whether uptime matters more than protection."
---

Rate limiting protects your API from overuse and abuse by enforcing a ceiling on how many requests a client can make within a time window. Without it, a single user or malicious actor can consume all your infrastructure resources and degrade service for everyone. The 10xGraph API server includes a built-in sliding-window rate limiter that you enable with a few lines of configuration.

By default, the 10xGraph API accepts unlimited requests. This guide shows how to enable the rate limiter, choose a backend suitable for your deployment, and handle edge cases like proxy headers and WebSocket connections.

Rate limits and run caps are part of how the server scales safely; see [scaling and reliability](/docs/production/scaling) and the [security model](/docs/production/security-model).

## How it works

The rate limiter is HTTP middleware that executes before your graph logic runs on every request. It maintains a count of requests per client (or globally) inside a rolling time window and returns `429 Too Many Requests` when the limit is exceeded. The limit is never active until you add a `rate_limit` block to `10xgraph.json`.

The limiter uses a **sliding-window algorithm**, not fixed time buckets. This means the window rolls with each request: a client with a limit of 100 requests per 60 seconds can send 100 requests in the first 30 seconds, then nothing until 60 seconds have passed, then 100 more. This prevents bursts that would succeed with a simple bucket-based counter.

Three backends are available: **memory** for development, **Redis** for production deployments, and **custom** if you need to store counters somewhere else. Your choice depends on how many workers you run and whether you prioritize simplicity or distributed enforcement.

## Method 1: In-memory backend (development / single process)

The simplest setup stores counters in the process memory. It works with a single Uvicorn worker and requires no extra dependencies.

**Update `10xgraph.json`:**

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

Each client IP can make up to `100` requests every `60` seconds. Health-check and documentation paths are excluded so monitoring and browser access are not affected.

**Verify it works:** Start the server and make requests from the same IP until you exceed the limit.

```bash
10xgraph dev --no-open
```

In another terminal, test the limiter:

```bash
# First 100 requests succeed
for i in {1..100}; do
  curl -s http://localhost:8000/v1/graph/invoke \
    -H "Content-Type: application/json" \
    -d '{"messages": [{"role": "user", "content": [{"type": "text", "text": "test"}]}]}' > /dev/null
done

# Next request is rate-limited
curl -i http://localhost:8000/v1/graph/invoke \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": [{"type": "text", "text": "test"}]}]}'
# Returns: 429 Too Many Requests
```

<aside class="callout callout-warning" role="note"><p class="callout-title">The memory backend logs a warning, and it means it</p>

Selecting `"backend": "memory"` logs this at startup:

> Rate limiting uses the in-memory backend. It counts per process, so with N workers the real limit is requests x N and it resets on every worker restart.

Counters live in process memory. Run four workers and the real limit is `400` per window, not `100`, and a rolling restart resets everything. Use Redis for anything with more than one worker.

</aside>

## Method 2: Redis backend (production / multi-process)

When you run multiple Uvicorn workers, containers, or servers, each process would have its own in-memory counter. Use Redis to store counters centrally so the limit is enforced across the whole deployment.

### Install the Redis extra

```bash
pip install "10xgraph-api[redis]"
```

### Update `10xgraph.json`

```json
{
  "agent": "graph.react:app",
  "rate_limit": {
    "enabled": true,
    "backend": "redis",
    "requests": 1000,
    "window": 60,
    "by": "ip",
    "trusted_proxy_headers": true,
    "exclude_paths": ["/ping", "/metrics", "/docs", "/redocs", "/openapi.json"],
    "redis": {
      "url": "${RATE_LIMIT_REDIS_URL}",
      "prefix": "10xgraph:rate-limit"
    },
    "fail_open": true
  }
}
```

### Set the environment variable

```bash
# .env
RATE_LIMIT_REDIS_URL=redis://localhost:6379/0
```

The `${RATE_LIMIT_REDIS_URL}` placeholder is expanded from the environment at startup. Never commit Redis credentials into `10xgraph.json`.

**How it works:** The Redis backend uses a Lua script with sorted sets to atomically check and record a request in one operation. This prevents concurrent requests from slipping past the configured limit. Each request adds a timestamp to a sorted set; older entries are automatically cleaned up by the script, and Redis evicts idle keys using TTL.

**Verify it works:** Set up Redis, update your config, restart the server, and load-test from multiple processes:

```bash
# Start Redis if needed
redis-server

# Run the server
10xgraph dev --no-open

# In another terminal, hammer it with concurrent requests
ab -n 2000 -c 50 http://localhost:8000/v1/graph/invoke
# Some requests will return 429
```

<aside class="callout callout-tip" role="note"><p class="callout-title">Atomic enforcement</p>

The Redis backend uses a Lua script with sorted sets. The check and the recording happen as one atomic Redis operation, which prevents concurrent requests from slipping past the configured limit. Even with thousands of concurrent clients, no request will leak through.

</aside>

## Method 3: Custom backend

Implement `BaseRateLimitBackend` when you want to store counters somewhere else: a SQL database, a distributed cache, or an external rate-limit service.

```python
# graph/rate_limit.py
from tenxgraph_api.src.app.core.middleware.rate_limit import (
    BaseRateLimitBackend,
    RateLimitDecision,
)

class MyRateLimitBackend(BaseRateLimitBackend):
    async def check(self, key: str, *, limit: int, window: int) -> RateLimitDecision:
        # Replace with your real logic
        # key: the client identifier (IP, user, or "global")
        # limit: the configured request limit
        # window: the time window in seconds
        allowed = True
        remaining = limit - 1
        reset_after = window
        return RateLimitDecision(
            allowed=allowed,
            remaining=remaining,
            reset_after=reset_after,
        )

    async def close(self) -> None:
        # Release any resources (connections, file handles)
        return None
```

Register it in your InjectQ container and set `backend` to `"custom"`:

```python
# graph/__init__.py
from injectq import InjectQ
from tenxgraph_api.src.app.core.middleware.rate_limit import BaseRateLimitBackend

from graph.rate_limit import MyRateLimitBackend

container = InjectQ()
container.bind_instance(BaseRateLimitBackend, MyRateLimitBackend())
```

When your backend cannot reach its store and the request must not pass, return `RateLimitDecision.backend_unavailable()` instead of a plain denial. The middleware then answers `503` with `RATE_LIMIT_UNAVAILABLE` (see [What clients see when the backend is down](#what-clients-see-when-the-backend-is-down)). It takes an optional `retry_after` in seconds (default 5). Backends that return only allow or deny keep working unchanged. Added after 1.0.0rc2.

Bind the instance under `BaseRateLimitBackend`: that is the key the server looks up. If `backend` is `"custom"` and nothing is bound there, startup fails.

Then in `10xgraph.json`:

```json
{
  "injectq": "graph:container",
  "rate_limit": {
    "enabled": true,
    "backend": "custom",
    "requests": 200,
    "window": 60,
    "by": "ip"
  }
}
```

## Identity modes

### Per-IP (recommended for most public APIs)

```json
{
  "rate_limit": { "requests": 100, "window": 60, "by": "ip" }
}
```

Limits requests by client IP address. This is the default and works well when you do not have authentication. Anonymous users, scripts, and browser clients are each limited individually.

### Per-user (recommended once auth is enabled)

```json
{
  "rate_limit": { "requests": 100, "window": 60, "by": "user" }
}
```

Limits requests by authenticated `user_id`. This is the right choice as soon as you have auth: limiting purely by IP gives a single user roaming between addresses (mobile, corporate proxy) an effectively unlimited budget, while a NAT'd office sharing one address gets throttled as though it were one caller.

Requests with no authenticated user fall back to an `ip:<address>` bucket, so anonymous traffic is still limited per caller rather than sharing one bucket any single client could exhaust for everyone.

### Global (one shared quota for all clients)

```json
{
  "rate_limit": { "requests": 5000, "window": 60, "by": "global" }
}
```

Enforces a single limit for the entire service. Use this when you want to control total throughput rather than per-client fairness. This is rare; per-IP or per-user is almost always better.

## WebSocket handshakes count too

Rate limiting is HTTP middleware, and Starlette runs middleware only for HTTP scopes. WebSocket handshakes would otherwise bypass the limiter entirely. The API server therefore re-applies the rate-limit check at WebSocket handshake time, against the **same backend and the same bucket** as REST requests.

Opening a socket costs one request from the client's quota. When the quota is exhausted the handshake is refused before `accept()` with WebSocket close code `1013` (Try Again Later), not with an HTTP `429`.

Each graph run started over `/v1/graph/ws` also costs one request from the same bucket. A run over the limit is not executed: the server sends an `error` chunk with `retry_after_seconds` and keeps the socket open.

Budget for this when sizing limits for a streaming client. A browser that reconnects on every network blip spends a request each time, and every run on a long-lived socket spends one more.

Concurrent socket count is capped separately by `websocket.max_connections` (and `websocket.max_connections_per_user`), which use the same close code. See [10xgraph.json configuration](/docs/reference/api-cli/configuration#websocket-ag_ui-and-observability).

## Behind a reverse proxy

If your API runs behind nginx, a load balancer, or a cloud gateway, the real client IP is forwarded in the `X-Forwarded-For` header. Set `trusted_proxy_headers: true` to use that header instead of the direct connection IP.

```json
{
  "rate_limit": {
    "backend": "redis",
    "requests": 1000,
    "window": 60,
    "by": "ip",
    "trusted_proxy_headers": true,
    "trusted_proxy_hops": 1
  }
}
```

### Set `trusted_proxy_hops` to match your topology

`X-Forwarded-For` is a list that each proxy **appends** to. Whatever the caller sent arrives at the left; only the entries your own proxies appended, on the right, are trustworthy.

`trusted_proxy_hops` is how many entries, counted from the right, your own infrastructure appended. It defaults to `1`, which is correct for a single proxy in front of the app.

| Topology | `trusted_proxy_hops` |
| --- | --- |
| One nginx or one load balancer | `1` |
| CDN in front of a load balancer, both yours | `2` |
| No proxy at all | leave `trusted_proxy_headers` off |

To honor `X-Forwarded-For` only for connections that come from your proxies, also set `trusted_proxies` to a list of IPs or CIDR ranges. A client that reaches the app directly is then keyed by its own address.

<aside class="callout callout-warning" role="note"><p class="callout-title">Getting the hop count wrong defeats the limiter</p>

Reading the leftmost entry, or counting from the wrong end, takes a value the caller fully controls. An attacker sends a different `X-Forwarded-For` on every request, lands in a fresh bucket each time, and is never limited at all.

If the header carries fewer entries than the configured hop count, the header is not shaped the way the server expects, so it is ignored entirely and the peer address is used instead. Watch the logs for the warning about mismatched hop counts after any change to your proxy layer.

</aside>

## Excluding paths

Add monitoring, health-check, and documentation paths to `exclude_paths` so they never count against the rate limit:

```json
{
  "rate_limit": {
    "exclude_paths": ["/ping", "/metrics", "/docs", "/redocs", "/openapi.json"]
  }
}
```

Health checks (`/ping`) are excluded automatically and do not need to be listed. Other status endpoints, readiness checks, and documentation paths should be added here so your monitoring and developers do not trigger limits. The ReDoc page is served at `/redocs`, not `/redoc`, so listing `/redoc` excludes nothing.

## Disabling rate limiting

Remove the `rate_limit` block (or set it to `null`) to disable the middleware entirely:

```json
{
  "agent": "graph.react:app",
  "rate_limit": null
}
```

## What clients see when limited

When the limit is exceeded, the API returns `429 Too Many Requests`:

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
    "request_id": "abc123",
    "status": "error"
  }
}
```

Every response also includes these headers so clients can track their quota:

| Header | Description |
| --- | --- |
| `X-RateLimit-Limit` | Configured request limit |
| `X-RateLimit-Remaining` | Requests remaining in the current window |
| `X-RateLimit-Reset` | Unix timestamp for the window reset |
| `X-RateLimit-Reset-After` | Seconds until the window resets |
| `Retry-After` | Seconds to wait before retrying (only on `429` and `503`) |

### What clients see when the backend is down

With the Redis backend and `fail_open: false`, a Redis outage denies requests with `503 Service Unavailable`, not 429, so clients can tell an outage from a limit hit. The response carries `Retry-After: 5`:

```json
{
  "error": {
    "code": "RATE_LIMIT_UNAVAILABLE",
    "message": "Rate limiter unavailable: its backend could not be reached.",
    "retry_after_seconds": 5
  },
  "metadata": {
    "request_id": "abc123",
    "status": "error"
  }
}
```

A real limit hit stays `429 RATE_LIMIT_EXCEEDED`. With `fail_open: true` requests pass during the outage. The Redis backend logs a traceback for the first error of an outage and one line for each error after it. Clients that retried on 429 should retry on 503 too. Added after 1.0.0rc2.

Clients can check `X-RateLimit-Remaining` before sending the next request to avoid hitting the limit, and use `Retry-After` to back off intelligently.

## Troubleshooting

**I still get unlimited requests even though I configured a limit.**

Verify that `10xgraph.json` has a `rate_limit` block with `"enabled"` not set to `false` and that you restarted the server after editing the file. Check the startup logs for rate-limit configuration messages. If the backend is Redis, ensure the connection is working: a backend error with `fail_open: true` allows all requests.

**Different workers seem to have different limits.**

You are using the memory backend with multiple workers. Each process maintains its own counters, so the real limit is `requests × workers`. Switch to Redis backend for consistent enforcement across workers.

**The proxy's real IP is not being recognized.**

Verify `trusted_proxy_headers: true` is set and `trusted_proxy_hops` matches your topology (1 for single proxy, 2 for CDN + load balancer). Check the server logs for warnings about mismatched hop counts. If the header has fewer entries than the hop count, it is ignored and the direct peer address is used instead.

**Rate-limit headers are not appearing in responses.**

They should appear on every response, including successful ones. If missing, check that rate limiting is enabled and the response is not being cached by a proxy. Middleware rate-limit headers are always fresh.

## See also

- [Rate Limiting reference](/docs/reference/api-cli/rate-limiting) for the full field reference and backend comparison table
- [10xgraph.json configuration](/docs/reference/api-cli/configuration) for all configuration keys
- [Environment variables](/docs/reference/api-cli/environment) for how to set Redis URLs and other settings
- [Authentication](/docs/server/auth) for how to enable user-based rate limiting
