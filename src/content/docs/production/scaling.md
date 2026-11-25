---
title: Scaling and reliability
seoTitle: "Scaling and reliability for a 10xGraph agent"
description: What Redis shares across API workers, how workers and IDs scale, what is replay-safe, and how the server behaves when Redis or Postgres is down.
section: "Platform"
order: 40
updated: "2026-11-25"
faq:
  - q: "Do I need Redis to run more than one worker?"
    a: "You can run without it, but the per-thread run lock, the per-user run cap, WebSocket caps, idempotency, rate limits and token revocation then live in each process (the in-memory cache store). A cap of 10 across 4 workers becomes up to 40. Configure Redis, or your own cache store, for any multi-worker deployment."
  - q: "Is there a queue for long runs?"
    a: "An interactive run (invoke or stream) executes in the API worker that received the request, bounded by runs.timeout. For work that should outlive a request, enqueue a background job: the API sends it to a TaskIQ broker and a separate 10xgraph worker process runs it. Scale the job workers independently of the API."
---

You scale a served 10xGraph agent by running more stateless API workers behind a load balancer, with Postgres for durable state and a shared cache store (Redis, or a custom shared store) for the things workers must share: locks, caps, rate limits and caches. Work that should not hold a request open goes to a separately scaled job worker tier.

## What the cache store shares across workers

The API keeps shared state in its cache store. Set `cache_store.type` to `redis` (or `custom`) to share it; the default is per process and `REDIS_URL` alone does not select Redis. See [cache_store](/docs/reference/api-cli/configuration#cache_store).

| Feature | With Redis | Without Redis (per process) |
|---|---|---|
| Rate limit | One sliding window for all workers. | Each worker counts alone, so the real limit is `requests x workers`. |
| Per-thread run lock | One-slot lease shared by all workers. Renewed while the run is alive, expires if the worker dies. | Lock holds only for runs on the same worker. Two workers can run one thread at once, and the Postgres version check then rejects the later write with a 409. |
| Per-user run cap (`runs.max_concurrent_per_user`) | Leases shared by all workers. | Counted per process: up to `limit x workers`. |
| WebSocket caps (`websocket.max_connections`, `max_connections_per_user`) | Shared through the same lease limiter. | Counted per process. |
| Idempotency (running lease and stored records) | Shared, so a retry on another worker sees the first request. | Seen only by the worker that handled the first request. |
| Token revocation | `cache_store.token_revocation: true`: a revoked token is refused on every worker. | A revocation reaches only the process that holds it, and the server warns about it in production or when `WEB_CONCURRENCY` is above 1. |

The leases expire on their own, so a crashed worker cannot hold a thread or a user's slots forever.

## Workers and sizing

`10xgraph build` generates a Dockerfile that runs Gunicorn with Uvicorn workers. The worker count comes from `WEB_CONCURRENCY`, set to `2` in the image; override it at deploy time, for example `-e WEB_CONCURRENCY=8`. The image runs `TenxGraphUvicornWorker` and sets a graceful timeout of 600 seconds and a worker timeout of 660 seconds, because an agent run can last minutes and the default 30 seconds would kill runs during a rolling deploy. With `--k8s`, the generated manifest sets `terminationGracePeriodSeconds` above that and a `preStop` sleep so the load balancer stops sending new traffic first.

Each in-flight run holds a connection open and waits on model calls, so size and autoscale on concurrent runs, not CPU alone. Choose the worker count and the per-user cap together: without a shared cache store the cap is per worker.

## Job workers

If you use [background jobs](/docs/server/background-tasks), run `10xgraph worker` as its own deployment next to the API workers, and one `10xgraph scheduler` process if you use schedules. Job workers are stateless like the API workers: they load the same graph, checkpointer, store and cache store, and take tasks from the TaskIQ broker (Redis Streams, RabbitMQ or Kafka). Scale them on queue depth and task duration, not on request rate, and size their count and the API's count separately. Delivery is at least once, so a task whose worker dies can run again on another worker; write tasks so a rerun is safe. The `worker` key in `10xgraph.json` sets the broker and options. `10xgraph build` can generate the worker and scheduler as their own Compose services or Kubernetes Deployments (`--worker`, `--scheduler`).

## Snowflake IDs

For time-ordered numeric ids set `"id_generator": "snowflake"` in `10xgraph.json` (needs the `snowflakekit` extra) and give each instance its own `SNOWFLAKE_NODE_ID` and `SNOWFLAKE_WORKER_ID`. See [ID generators](/docs/guides/configure-id-generator).

## Reliability mechanisms

| Mechanism | What it guarantees |
|---|---|
| Replay-safe tool ledger | A tool call recorded in the checkpointer's ledger is not executed again when a run resumes after a crash. A crash between the tool finishing and its record being written can still repeat it, so pass idempotency keys to payment and email providers. [Details](/docs/concepts/replay-safe-tools) |
| Versioned state writes | With `PgCheckpointer`, each write is a new version under a row lock. A write based on a stale version is rejected, and the API returns 409 `state_conflict` instead of silently discarding another run's work. |
| Per-thread run lock | One run per thread, so a double click or a second tab does not interleave history. |
| Timeouts | `runs.timeout` bounds a whole run. Set `node_timeout` and `tool_timeout` (no default) so one stuck tool cannot hold a run forever. |
| Parallel tool cap | Tools run in parallel up to 10 by default. Change it with `runs.max_parallel_tool_calls` or `TENXGRAPH_MAX_PARALLEL_TOOL_CALLS`. |
| Graceful shutdown | On SIGTERM the worker marks the app as draining, so `/health/ready` answers 503 and the load balancer stops sending new requests. Open runs get up to `TENXGRAPH_GRACEFUL_SHUTDOWN_SECONDS` (540 by default) to finish. Open streams then end with a final "interrupted" chunk. The app calls `graph.aclose()` with `SHUTDOWN_GRACE_SECONDS`, `SHUTDOWN_STOP_SECONDS` and `SHUTDOWN_TIMEOUT_SECONDS` (10, 10 and 30 seconds by default), which also drains background work, and closes limiters and revocation. A run that was cut off leaves a thread the next message can use. See [Graceful shutdown](/docs/guides/graceful-shutdown). |
| Readiness probe | `GET /health/ready` returns 503 while a required backend is down or the worker is draining; `/ping` is liveness. See [Health API](/docs/reference/rest-api/ping). |

## Failure behaviour

| Failure | What happens |
|---|---|
| Redis down: rate limit | Follows `cache_store.rate_limit.fail_open`. Default `true` allows the request; set `false` to answer `503` `RATE_LIMIT_UNAVAILABLE` with `Retry-After: 5`. |
| Redis down: run lock, run cap, WebSocket caps, idempotency | Fail open. The request proceeds and the error is logged, because refusing every request would be an outage of its own. The Postgres version check still protects state. |
| Redis clock | Lease expiry for the run cap uses the Redis clock (`TIME`), not each pod's own, so clock skew between pods cannot trim a live lease. |
| Redis not answering | Every call fails after `REDIS_SOCKET_TIMEOUT` (5 seconds by default) instead of hanging the request. See [environment variables](/docs/reference/api-cli/environment#redis-variables). |
| Redis down: token revocation | Fails closed: a 503, not a possibly revoked token served. |
| Redis down: readiness | `/health/ready` reports `cache: fail`. It returns 503 only when token revocation or a fail-closed rate limit uses the cache store; otherwise the pod stays in rotation. |
| Postgres down | Runs that need the checkpointer fail. `/health/ready` returns 503, so Kubernetes stops routing to the pod. `/ping` stays 200 so the pod is not restarted for a dependency outage. |
| Worker dies mid-run | Locks and caps held in Redis expire. Resume by sending the thread another request; finished tool calls are skipped. |

There are no published throughput or latency benchmarks; load-test your own graph, model and tools.

## Related

- [Architecture](/docs/production/architecture)
- [Production checklist](/docs/server/production-checklist)
- [Kubernetes](/docs/server/kubernetes)
- [Rate limiting](/docs/server/rate-limiting)
