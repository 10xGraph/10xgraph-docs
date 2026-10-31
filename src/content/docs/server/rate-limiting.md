---
title: Configure Rate Limiting
description: How to enable and configure the built-in sliding-window rate limiter in the 10xGraph API.
section: "API server"
group: "Security"
order: 70
updated: "2026-10-31"
faq:
  - question: Do I need rate limiting in development?
    answer: "In development, you can run without limits. In any production environment, rate limiting protects your infrastructure from both accidental overuse and abuse."
  - question: How much does Redis add to the setup?
    answer: "Set `redis` in `10xgraph.json` or `REDIS_URL` in the environment. The rate limiter then shares the API's cache store with the run locks and caps. There is no separate rate-limit Redis setting."
  - question: What happens if the cache store is unreachable?
    answer: "With `fail_open: true` (the default), requests pass through; with `fail_open: false`, requests are denied with 503 `RATE_LIMIT_UNAVAILABLE`. Choose based on whether uptime matters more than protection."
---

Rate limiting protects your API from overuse and abuse by enforcing a ceiling on how many requests a client can make within a time window. Without it, a single user or malicious actor can consume all your infrastructure resources and degrade service for everyone. The 10xGraph API server includes a built-in sliding-window rate limiter that you enable with a few lines of configuration.

By default, the 10xGraph API accepts unlimited requests. This guide shows how to enable the rate limiter, choose where the counters live, and handle edge cases like proxy headers and WebSocket connections.

Rate limits and run caps are part of how the server scales safely; see [scaling and reliability](/docs/production/scaling) and the [security model](/docs/production/security-model).

## How it works

The rate limiter is HTTP middleware that executes before your graph logic runs on every request. It maintains a count of requests per client (or globally) inside a rolling time window and returns `429 Too Many Requests` when the limit is exceeded. The limit is never active until you add a `rate_limit` block to `10xgraph.json`.

The limiter uses a **sliding-window algorithm**, not fixed time buckets. This means the window rolls with each request: a client with a limit of 100 requests per 60 seconds can send 100 requests in the first 30 seconds, then nothing until 60 seconds have passed, then 100 more. This prevents bursts that would succeed with a simple bucket-based counter.

The counters live in the API's **cache store**, the same one that holds the run locks and caps. There is no separate rate-limit backend. With a Redis URL set (`redis` in `10xgraph.json` or `REDIS_URL`) every worker shares the counters; without one they live in each process. To keep counters somewhere else, supply your own cache store (see [Bring your own backend](/docs/server/bring-your-own-backend)).

## Single process (development)

With no Redis URL the counters live in process memory. It works with a single Uvicorn worker and needs no extra dependencies.

**Update `10xgraph.json`:**

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

<aside class="callout callout-warning" role="note"><p class="callout-title">In-memory counters are per process</p>

With the in-memory cache store the counters live in process memory. Run four workers and the real limit is `400` per window, not `100`, and a rolling restart resets everything. Use a Redis cache store for anything with more than one worker.

</aside>

## Several workers or servers (production)

When you run multiple Uvicorn workers, containers, or servers, each process would have its own counter. Point the API at Redis so the limit is enforced across the whole deployment. The same Redis also shares the run locks, caps, idempotency state and token revocation.

### Install the Redis extra

```bash
pip install "10xgraph-api[redis]"
```

### Update `10xgraph.json`

```json
{
  "agent": "graph.react:app",
  "redis": "${REDIS_URL}",
  "rate_limit": {
    "enabled": true,
    "requests": 1000,
    "window": 60,
    "by": "ip",
    "trusted_proxy_headers": true,
    "exclude_paths": ["/ping", "/metrics", "/docs", "/redocs", "/openapi.json"],
    "fail_open": true
  }
}
```

### Set the environment variable

```bash
# .env
REDIS_URL=redis://localhost:6379/0
```

The `${REDIS_URL}` placeholder is expanded from the environment at startup. Never commit Redis credentials into `10xgraph.json`. You can also drop the `redis` key: the server reads `REDIS_URL` on its own. Valkey, Dragonfly and KeyDB work the same way, through the URL.

**How it works:** The Redis cache store uses a Lua script with sorted sets to atomically check and record a request in one operation. This prevents concurrent requests from slipping past the configured limit. Each request adds a slot that expires when the window ends; Redis evicts idle keys using TTL.

The rate-limit counters use their own Redis key namespace (`10xgraph:ratelimit2`). When you upgrade from an earlier release the counters reset once.

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

The check and the recording happen as one atomic Redis operation, which prevents concurrent requests from slipping past the configured limit. A denied request adds nothing to the counter. Even with thousands of concurrent clients, no request will leak through.

</aside>

## Another store

The `rate_limit.backend` and `rate_limit.redis` keys and the `BaseRateLimitBackend` class were removed in 1.0.0rc4; a config that still sets them stops with an error that names `cache_store`. To keep the counters in something other than Redis, implement `BaseCacheStore` and select it with `"cache_store": "module:attr"`:

```json
{
  "cache_store": "graph.cache:store",
  "rate_limit": {
    "enabled": true,
    "requests": 200,
    "window": 60,
    "by": "ip"
  }
}
```

The rate limiter uses the store's timed slots: each request takes a slot that is never released and expires after the window. See [Bring your own backend](/docs/server/bring-your-own-backend) for the contract and the test suite.

When the store raises an error, the limiter follows `fail_open` (see [What clients see when the cache store is down](#what-clients-see-when-the-cache-store-is-down)).

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

Rate limiting is HTTP middleware, and Starlette runs middleware only for HTTP scopes. WebSocket handshakes would otherwise bypass the limiter entirely. The API server therefore re-applies the rate-limit check at WebSocket handshake time, against the **same cache store and the same bucket** as REST requests.

Opening a socket costs one request from the client's quota. When the quota is exhausted the handshake is refused before `accept()` with WebSocket close code `1013` (Try Again Later), not with an HTTP `429`.

Each graph run started over `/v1/graph/ws` also costs one request from the same bucket. A run over the limit is not executed: the server sends an `error` chunk with `retry_after_seconds` and keeps the socket open.

Budget for this when sizing limits for a streaming client. A browser that reconnects on every network blip spends a request each time, and every run on a long-lived socket spends one more.

Concurrent socket count is capped separately by `websocket.max_connections` (and `websocket.max_connections_per_user`), which use the same close code. See [10xgraph.json configuration](/docs/reference/api-cli/configuration#websocket-ag_ui-and-observability).

## Behind a reverse proxy

If your API runs behind nginx, a load balancer, or a cloud gateway, the real client IP is forwarded in the `X-Forwarded-For` header. Set `trusted_proxy_headers: true` to use that header instead of the direct connection IP.

```json
{
  "rate_limit": {
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

### What clients see when the cache store is down

With `fail_open: false`, a cache store outage (for example Redis) denies requests with `503 Service Unavailable`, not 429, so clients can tell an outage from a limit hit. The response carries `Retry-After: 5`:

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

A real limit hit stays `429 RATE_LIMIT_EXCEEDED`. With `fail_open: true` requests pass during the outage. The limiter logs a traceback for the first error of an outage and one line for each error after it. Clients that retried on 429 should retry on 503 too. Added in 1.0.0rc3.

Clients can check `X-RateLimit-Remaining` before sending the next request to avoid hitting the limit, and use `Retry-After` to back off intelligently.

## Troubleshooting

**I still get unlimited requests even though I configured a limit.**

Verify that `10xgraph.json` has a `rate_limit` block with `"enabled"` not set to `false` and that you restarted the server after editing the file. Check the startup logs for rate-limit configuration messages. If you use Redis, ensure the connection is working: a cache store error with `fail_open: true` allows all requests.

**Different workers seem to have different limits.**

You are using the in-memory cache store with multiple workers. Each process maintains its own counters, so the real limit is `requests × workers`. Set `redis` or `REDIS_URL` for consistent enforcement across workers.

**The proxy's real IP is not being recognized.**

Verify `trusted_proxy_headers: true` is set and `trusted_proxy_hops` matches your topology (1 for single proxy, 2 for CDN + load balancer). Check the server logs for warnings about mismatched hop counts. If the header has fewer entries than the hop count, it is ignored and the direct peer address is used instead.

**Rate-limit headers are not appearing in responses.**

They should appear on every response, including successful ones. If missing, check that rate limiting is enabled and the response is not being cached by a proxy. Middleware rate-limit headers are always fresh.

## See also

- [Rate Limiting reference](/docs/reference/api-cli/rate-limiting) for the full field reference
- [10xgraph.json configuration](/docs/reference/api-cli/configuration) for all configuration keys
- [Environment variables](/docs/reference/api-cli/environment) for how to set `REDIS_URL` and other settings
- [Authentication](/docs/server/auth) for how to enable user-based rate limiting
