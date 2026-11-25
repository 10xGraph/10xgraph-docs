---
title: Health check endpoint
description: "GET /ping and GET /health/ready are the unauthenticated liveness and readiness probes of the 10xGraph API server, for Kubernetes, Docker and load balancers."
section: Reference
group: "REST API"
order: 400
label: Ping
updated: "2026-11-25"
---

`GET /ping` is the liveness probe; `GET /health/ready` is the readiness probe. It also checks the checkpointer, the store and the cache store.

---

## GET /ping

**Request:** no body, no headers required.

```bash title="Call the health check"
curl -i http://127.0.0.1:8000/ping
```

**Response (200):**

```json
{
  "data": "pong",
  "metadata": {
    "request_id": "<uuid>",
    "timestamp": "<server timestamp>",
    "message": "OK"
  }
}
```

The envelope is described in [Conventions](/docs/reference/rest-api/conventions).

---

## GET /health/ready

The readiness probe. `/ping` says the process is alive; `/health/ready` says the server can do its job. It calls `aping()` on each component, concurrently and each with a 2 second limit:

- **checkpointer**: `aping()` of the checkpointer.
- **store**: `aping()` of the store, when one is bound.
- **cache**: `aping()` of the API's cache store (Redis, or your own `BaseCacheStore`). It is reported always, but it fails readiness only when a fail-closed feature uses it: `cache_store.token_revocation` is on (with auth), or `cache_store.rate_limit` is on with `fail_open` set to `false`. For everything else (locks, caps, idempotency) a cache store outage is reported and the server keeps taking traffic.

A component that is not configured, or has nothing to check, is left out of the response. The endpoint is public, so it returns only `ok` or `fail` per component and logs the reason on the server. Results are cached for 3 seconds.

```bash title="Call the readiness probe"
curl -i http://127.0.0.1:8000/health/ready
```

Response (200), not wrapped in the envelope:

```json title="Response (200)"
{ "status": "ready", "checks": { "checkpointer": "ok", "cache": "ok" } }
```

| Status | Meaning |
| --- | --- |
| `200` | Every component is reachable (or only the cache store is down and no fail-closed feature uses it). `status` is `ready`. |
| `503` | A required check is `fail`. `status` is `not_ready`. The checkpointer check fails when the database schema version is below what the code expects (an upgrade whose migration has not run). |
| `503` | The server is shutting down. `status` is `draining` and `checks` is empty. No component is checked. |

The same checks run once at boot; see [startup check](/docs/server/production-checklist#startup-check).

---

## Authentication and middleware

`/ping` and `/health/ready` need no token, skip the trusted-host check and are never rate limited.

`10xgraph build` points the Kubernetes readiness probe at `/health/ready` and the liveness probe and Docker HEALTHCHECK at `/ping`; see [Kubernetes](/docs/server/kubernetes).

Neither probe checks the model provider.

## Related

- [Kubernetes deployment](/docs/server/kubernetes)
- [Deployment](/docs/server/deploy)
- [REST API conventions](/docs/reference/rest-api/conventions)
