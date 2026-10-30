---
title: Scaling and reliability
seoTitle: "Scaling and reliability for a 10xGraph agent"
description: What Redis shares across API workers, how workers and IDs scale, what is replay-safe, how the server behaves when Redis or Postgres is down, and its honest limits.
section: Production
order: 30
updated: "2026-10-28"
faq:
  - q: "Do I need Redis to run more than one worker?"
    a: "You can run without it, but the per-thread run lock, the per-user run cap, WebSocket caps, rate limits and token revocation then count per process. A cap of 10 across 4 workers becomes up to 40. Configure Redis for any multi-worker deployment."
  - q: "What happens if Redis goes down?"
    a: "Rate limiting follows rate_limit.fail_open (default true: requests are allowed). The run lock, run cap and WebSocket caps fail open. Ownership lookups fall back to the database. Token revocation fails closed with a 503. The readiness probe reports Redis as failed."
  - q: "What happens if Postgres goes down?"
    a: "Runs that need the checkpointer fail, and GET /health/ready returns 503 so an orchestrator takes the pod out of rotation. Liveness (/ping) stays up."
  - q: "Is there a queue for long runs?"
    a: "No. A run executes in the worker that received the request, bounded by runs.timeout. Size workers and the graceful timeout for your longest run."
---

You scale a served 10xGraph agent by running more stateless API workers behind a load balancer, with Postgres for durable state and Redis for the things workers must share: locks, caps, rate limits and caches. Without Redis, those features still work but count per process. This page lists exactly what Redis shares, how reliability works under failure, and where the limits are. For the request path and state layers, read [Architecture](/docs/production/architecture) first.

## What Redis shares across workers

Set the `redis` key in `10xgraph.json` or `REDIS_URL`. The loader then binds a shared limiter for the run and WebSocket caps, and the ownership cache gets its second tier.

| Feature | With Redis | Without Redis (per process) |
|---|---|---|
| Thread ownership cache | L1 in each worker (30 s), L2 shared in Redis (1 h). Only known owners are cached, never "no owner". Deleting a thread evicts both and leaves a tombstone for 30 s so another user cannot claim the id while a worker still holds the old owner. | L1 only; the tombstone exists only on the worker that handled the delete. |
| Rate limit | `rate_limit.backend: "redis"`: one sliding window for all workers. | `memory` backend: each worker counts alone, so the real limit is `requests x workers`. |
| Per-thread run lock | One-slot lease shared by all workers. Renewed while the run is alive, expires if the worker dies. | Lock holds only for runs on the same worker. Two workers can run one thread at once, and the Postgres version check then rejects the later write with a 409. |
| Per-user run cap (`runs.max_concurrent_per_user`) | Leases shared by all workers. | Counted per process: up to `limit x workers`. |
| WebSocket caps (`websocket.max_connections`, `max_connections_per_user`) | Shared through the same lease limiter. | Counted per process. |
| Token revocation | `"token_revocation": "redis"`: a revoked token is refused on every worker. | `"memory"` revokes on one process only; use it for tests or a single worker. |

The leases expire on their own, so a crashed worker cannot hold a thread or a user's slots forever.

## Workers and sizing

`10xgraph build` generates a Dockerfile that runs Gunicorn with Uvicorn workers. The worker count comes from `WEB_CONCURRENCY`, set to `2` in the image; override it at deploy time, for example `-e WEB_CONCURRENCY=8`. The image runs `TenxGraphUvicornWorker` and sets a graceful timeout of 600 seconds and a worker timeout of 660 seconds, because an agent run can last minutes and the default 30 seconds would kill runs during a rolling deploy. With `--k8s`, the generated manifest sets `terminationGracePeriodSeconds` above that and a `preStop` sleep so the load balancer stops sending new traffic first.

Each in-flight run holds a connection open and waits on model calls, so size and autoscale on concurrent runs, not CPU alone. Choose the worker count and the per-user cap together: without Redis the cap is per worker.

## Snowflake IDs

By default the framework generates IDs with UUIDs. If you want time-ordered numeric IDs, pass a `SnowFlakeIdGenerator` (from `tenxgraph_api`, needs the `snowflakekit` package) to `StateGraph(id_generator=...)`. When several instances generate IDs, give each a unique `SNOWFLAKE_NODE_ID` and `SNOWFLAKE_WORKER_ID` so two instances never produce the same ID. See [Environment variables](/docs/reference/api-cli/environment).

## Events out: publishers

A publisher sends run events (node start and end, tool calls, errors) to systems outside the worker, so you can build dashboards, audit logs and alerts without touching the graph. Core ships Redis Pub/Sub, Kafka, RabbitMQ and console publishers, plus an OpenTelemetry publisher for traces (also Logfire and LangSmith through it). Several can run at once through a composite publisher. On shutdown the server waits up to 30 seconds for in-flight background work, such as event publishing, then exits. See [Events and observability](/docs/concepts/events-and-observability).

## Reliability mechanisms

| Mechanism | What it guarantees |
|---|---|
| Replay-safe tool ledger | A tool call recorded in the checkpointer's ledger is not executed again when a run resumes after a crash. A crash between the tool finishing and its record being written can still repeat it, so pass idempotency keys to payment and email providers. [Details](/docs/concepts/replay-safe-tools) |
| Versioned state writes | With `PgCheckpointer`, each write is a new version under a row lock. A write based on a stale version is rejected, and the API returns 409 `state_conflict` instead of silently discarding another run's work. |
| Per-thread run lock | One run per thread, so a double click or a second tab does not interleave history. |
| Timeouts | `runs.timeout` bounds a whole run. Set `node_timeout` and `tool_timeout` (no default) so one stuck tool cannot hold a run forever. |
| Parallel tool cap | Tools run in parallel up to 10 by default. Change it with `runs.max_parallel_tool_calls` or `TENXGRAPH_MAX_PARALLEL_TOOL_CALLS`. |
| Graceful shutdown | On SIGTERM the worker marks the app as draining, so `/health/ready` answers 503 and the load balancer stops sending new requests. Open runs get up to `TENXGRAPH_GRACEFUL_SHUTDOWN_SECONDS` (540 by default) to finish. Open streams then end with a final "interrupted" chunk. The app calls `graph.aclose()` with `SHUTDOWN_GRACE_SECONDS`, `SHUTDOWN_STOP_SECONDS` and `SHUTDOWN_TIMEOUT_SECONDS` (10, 10 and 30 seconds by default), which also drains background work, and closes limiters, revocation and authorization backends. A run that was cut off leaves a thread the next message can use. See [Graceful shutdown](/docs/guides/graceful-shutdown). |
| Readiness probe | `GET /health/ready` checks the checkpointer, Redis and store (each time-boxed to 2 s, cached for 3 s) and returns 200 or 503. It is public and returns only `ok` or `fail` per component. `/ping` is the liveness probe. |

## Failure behaviour

| Failure | What happens |
|---|---|
| Redis down: rate limit | Follows `rate_limit.fail_open`. Default `true` allows the request; set `false` to deny. |
| Redis down: run lock, run cap, WebSocket caps | Fail open. The request proceeds and the error is logged, because refusing every request would be an outage of its own. The Postgres version check still protects state. |
| Redis down: ownership | Falls back to the checkpointer lookup in the database. A request is never failed by the cache. |
| Redis clock | Lease expiry for the run cap uses the Redis clock (`TIME`), not each pod's own, so clock skew between pods cannot trim a live lease. |
| Redis not answering | Every call fails after `REDIS_SOCKET_TIMEOUT` (5 seconds by default) instead of hanging the request. See [environment variables](/docs/reference/api-cli/environment#redis-variables). |
| Redis down: token revocation | Fails closed: a 503, not a possibly revoked token served. |
| Redis down: readiness | `/health/ready` reports `redis: fail` and returns 503. |
| Postgres down | Runs that need the checkpointer fail. `/health/ready` returns 503, so Kubernetes stops routing to the pod. `/ping` stays 200 so the pod is not restarted for a dependency outage. |
| Worker dies mid-run | Locks and caps held in Redis expire. Resume by sending the thread another request; finished tool calls are skipped. |

## Honest limits

- Runs execute in the worker that received the request. There is no separate queue or worker tier, so a long run ties up that worker's connection and a deploy waits on the graceful timeout.
- A tool can still run twice if a run crashes in the short gap between the tool finishing and its ledger record being written, or if the run was cut off while the tool was running. Use idempotency keys for tools with side effects.
- Without Redis, every cap and lock in the table above is per process.
- There are no published benchmarks for throughput or latency. Load-test your own graph, model and tools.
- Pin versions and read the changelog before upgrading. 1.0 is a release candidate until the final ships; from 1.0 breaking changes come only in a major release.

## Related

- [Architecture](/docs/production/architecture)
- [Production checklist](/docs/server/production-checklist)
- [Kubernetes](/docs/server/kubernetes)
- [Rate limiting](/docs/server/rate-limiting)
