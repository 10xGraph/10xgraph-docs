---
title: Health check endpoint
description: "GET /ping and GET /health/ready are the unauthenticated liveness and readiness probes of the 10xGraph API server, for Kubernetes, Docker and load balancers."
section: Reference
group: "REST API"
order: 400
label: Ping
updated: "2026-10-27"
---

`GET /ping` is the health check of the 10xGraph API server. It needs no authentication, reads no state, and returns a constant `pong` inside the standard response envelope. Use it to confirm that the process is up and accepting HTTP requests. `GET /health/ready` is the readiness probe: it also checks the checkpointer, Redis and the store.

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

The envelope comes from the server's `success_response` helper. `data` holds the payload, and `metadata` carries the per-request `request_id` and `timestamp` set by the request middleware, plus a `message` that defaults to `OK`. See [Conventions](/docs/reference/rest-api/conventions) for the envelope shared by all endpoints.

| Status | Meaning |
| --- | --- |
| `200` | The server process is running and routing requests. |
| Connection refused, timeout or `5xx` | The server is not started yet, is shutting down, or has crashed. |

---

## GET /health/ready

The readiness probe. `/ping` says the process is alive; `/health/ready` says the server can do its job. It calls `aping()` on each component, concurrently and each with a 2 second limit:

- **checkpointer**: `aping()` of the checkpointer. For `PgCheckpointer` that is a `SELECT 1`, a check that the schema version is not older than the code expects, and a ping of its Redis cache. It never creates the schema.
- **store**: `aping()` of the store, when one is bound.
- **cache**: `aping()` of the API's cache store (Redis, or your own `BaseCacheStore`). It is reported always, but it fails readiness only when a fail-closed feature uses it: `token_revocation` is on, or `rate_limit` is on with `fail_open` set to `false`. For everything else (locks, caps, idempotency, the ownership cache) a cache store outage is reported and the server keeps taking traffic.

The key `cache` replaced `redis` in 1.0.0rc4.

A component that is not configured, or has nothing to check, is left out of the response. The endpoint is public, so it returns only `ok` or `fail` per component and logs the reason on the server. Results are cached for 3 seconds and concurrent callers share one check, so a flood of probes does not become a flood of database round trips.

```bash title="Call the readiness probe"
curl -i http://127.0.0.1:8000/health/ready
```

```json title="Response (200)"
{ "status": "ready", "checks": { "checkpointer": "ok", "cache": "ok" } }
```

| Status | Meaning |
| --- | --- |
| `200` | Every component is reachable (or only the cache store is down and no fail-closed feature uses it). `status` is `ready`. |
| `503` | A required check is `fail`. `status` is `not_ready`. The checkpointer check fails when the database schema version is below what the code expects (an upgrade whose migration has not run). |
| `503` | The server is shutting down. `status` is `draining` and `checks` is empty. No component is checked. |

The server runs the same checks once at boot (the [startup check](/docs/server/production-checklist#startup-check)). There an unreachable checkpointer or store stops the server from starting (so does the cache store, when a fail-closed feature uses it); here it only turns readiness to 503, so traffic stops until the backend returns. Added in 1.0.0rc3.

Once the process gets SIGTERM, the server marks itself as draining. Readiness answers `503` from then on, so the load balancer stops sending new requests while open runs finish. `/ping` stays `200` until the process exits.

The response is a plain JSON object, not the standard `data` and `metadata` envelope.

---

## Authentication and middleware

`/ping` and `/health/ready` are paths the route guard treats as public, so they have no `RequirePermission` dependency and no scope is checked. Every other route must be guarded, or the server refuses to start.

Three pieces of middleware also skip `/ping` and `/health/ready` on purpose, because orchestrator probes would otherwise restart healthy containers:

- **Trusted host check.** Probes call `localhost` or the pod IP, which are not in `ALLOWED_HOST`. The host check is skipped for these two probe paths only.
- **Rate limiting.** `/ping` and `/health/ready` are always excluded, so a cache store outage (for example Redis) does not fail the probe through the rate limiter. The production template also lists it in `rate_limit.exclude_paths`.
- **Authentication.** No token is needed.

---

## Liveness and readiness probes

`10xgraph build --k8s` generates a Deployment whose readiness probe calls `/health/ready` and whose liveness probe calls `/ping`. Readiness decides whether the pod receives traffic. Liveness is deliberately slack, so a worker busy with a long agent run is not mistaken for a hung one:

```yaml title="k8s.yaml (generated by 10xgraph build --k8s)"
readinessProbe:
  httpGet:
    path: /health/ready
    port: 8000
  initialDelaySeconds: 5
  periodSeconds: 10
livenessProbe:
  httpGet:
    path: /ping
    port: 8000
  initialDelaySeconds: 30
  periodSeconds: 30
  failureThreshold: 5
```

The port is the one you pass to `build`. For the rest of the manifest (grace period, `preStop` sleep) see [Kubernetes](/docs/server/kubernetes).

## Docker HEALTHCHECK

The generated Dockerfile checks `/ping` with Python's standard library, so it needs no `curl` in the image:

```dockerfile title="Dockerfile (generated)"
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/ping', timeout=5)" || exit 1
```

The generated Compose file does not include a healthcheck. If you want one, add this to the service (it needs `curl` in the image):

```yaml title="docker-compose.yml (add manually)"
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:8000/ping"]
  interval: 30s
  timeout: 5s
  retries: 3
```

---

## What it does not check

`/ping` proves the HTTP server is alive. It does not call the database, Redis, the checkpointer or the model provider. `/health/ready` checks the checkpointer, Redis and the store, but not the model provider, so a green probe does not mean a graph run will succeed. For that, run a smoke test that invokes the graph after each deploy.

## Related

- [Kubernetes deployment](/docs/server/kubernetes)
- [Deployment](/docs/server/deploy)
- [REST API conventions](/docs/reference/rest-api/conventions)
