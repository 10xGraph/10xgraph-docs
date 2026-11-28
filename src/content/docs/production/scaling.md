---
title: Scaling and reliability
seoTitle: "Scaling and reliability for a 10xGraph agent"
description: What Redis shares across API workers, how workers and IDs scale, what is replay-safe, and how the server behaves when Redis or Postgres is down.
section: "Platform"
order: 40
updated: "2026-11-28"
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

`10xgraph build` generates a Dockerfile that runs Gunicorn with Uvicorn workers, for the plain and `--docker-compose` builds. With `--k8s` the image runs one Uvicorn process instead (see below). For the Gunicorn image, the worker count comes from `WEB_CONCURRENCY`, set to `2` in the image; override it at deploy time, for example `-e WEB_CONCURRENCY=8`. `WEB_CONCURRENCY` does not apply to the `--k8s` image. The Gunicorn image runs `TenxGraphUvicornWorker` and sets a graceful timeout of 600 seconds and a worker timeout of 660 seconds, because an agent run can last minutes and the default 30 seconds would kill runs during a rolling deploy. With `--k8s`, the generated manifest sets `terminationGracePeriodSeconds` above that and a `preStop` sleep so the load balancer stops sending new traffic first.

On Kubernetes the generated image runs one Uvicorn process per pod, and you scale with replicas: see [Choosing the server process](#choosing-the-server-process).

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

## Measured capacity of one pod

We load-tested one small pod to give a starting point for sizing. Your numbers will differ: they depend on your graph, model latency, tools, state size, publishers and infrastructure. Load-test your own agent before you commit to a size.

**Setup.** The API ran with 1 CPU, 2 GB memory limit and one Gunicorn worker (`WEB_CONCURRENCY=1`). It used `MODE=production`, JWT auth, the rate limiter, the audit log, `PgCheckpointer` with the Redis cache, a Redis cache store and one `RabbitMQPublisher`. Postgres, Redis and RabbitMQ ran outside the pod without limits. The model was a mock with fixed delays: each request made two model calls of 2.0 s and one tool call of 0.3 s, so a request cannot finish in less than 4.3 s. Every request started a new thread on `/v1/graph/invoke`. Users sent their next request as soon as the last one returned.

| Concurrent users | Requests/s | p50 latency | p99 latency | Added by 10xGraph (p50) |
|---|---|---|---|---|
| 10 | 2.3 | 4.41 s | 4.49 s | 0.11 s |
| 100 | 20.3 | 4.51 s | 5.65 s | 0.21 s |
| 300 | 38.4 | 6.96 s | 9.68 s | 2.66 s |
| 500 | 40.6 | 10.74 s | 17.81 s | 6.44 s |

No request failed at any level, and memory stayed under 300 MiB. Throughput stops at about 40 requests per second because the pod's CPU is full from about 300 users. Past that point, more users only add waiting time. Doubling the Postgres pool from 20 to 40 did not change the result, because the limit is the CPU, not the database.

**Recommended starting size**

- Plan for about 100 concurrent runs per CPU, with one Gunicorn worker per CPU.
- 512 MiB to 1 GiB of memory per worker is enough for short threads. Long threads hold more state in memory, so measure with your own data.
- Add replicas for more users instead of making one pod bigger. Autoscale on concurrent runs or latency, not on CPU alone (see [Workers and sizing](#workers-and-sizing)).
- If you use a broker publisher, raise its `queue_size`. With the default 2048, the RabbitMQ publisher dropped events from 300 users per pod. With `queue_size` 16384 and `batch_size` 500 it dropped none up to 500 users. Runs are not affected by dropped events, but your consumers miss them. See [Batching](/docs/guides/use-publishers#batching).

## Performance tuning

Measured on the pod above. Your numbers will differ, so test your own graph.

**Postgres pool reset.** When a connection goes back to the pool, asyncpg by default sends `SELECT pg_advisory_unlock_all(); CLOSE ALL; UNLISTEN *; RESET ALL;`, one extra round trip per release. The pool that `PgCheckpointer` and `PgVectorStore` build from a DSN skips it (it also sets `command_timeout` 60 s and `timeout` 30 s). asyncpg still rolls back an open transaction first. 10xGraph's own code leaves no session state: row-level security values are set inside a transaction, and the setup lock is released by the setup code itself. Together with removing one duplicate state read, this halved Postgres transactions per run (about 27 to 13). On one pod it did not raise throughput, because the pod's CPU was the limit, but it lowers the load on a Postgres shared by many replicas.

A pool you pass in (`pg_pool=` for `PgCheckpointer`, `pool=` for `PgVectorStore`) keeps asyncpg's full reset. To skip it there, build the pool with a `reset` function (asyncpg 0.30.0 or later):

```python
import asyncpg

async def keep_session(conn):
    """Send nothing when a connection goes back to the pool."""

pool = await asyncpg.create_pool(dsn, reset=keep_session)
checkpointer = PgCheckpointer(pg_pool=pool, redis_url=redis_url)
```

If your own code uses the same pool and leaves session state behind (a session-level `SET`, `LISTEN`, session advisory locks, open cursors), restore the full reset on a pool 10xGraph builds with `pool_config={"reset": None}`.

**Event loop and HTTP parser.** `10xgraph-api` installs `uvloop` and `httptools`, and Uvicorn's default `auto` settings use them, so they are on by default. On the 1 CPU pod they raised peak throughput from about 36 to 41 requests/s and cut the added time at 100 users from about 1.0 s to 0.2 s, because each request costs less CPU. uvloop is skipped on Windows, Cygwin and PyPy, where Uvicorn uses asyncio.

To turn them off, set `TENXGRAPH_LOOP=asyncio` and/or `TENXGRAPH_HTTP=h11`. This applies to `10xgraph dev`, the Gunicorn image and the `--k8s` image. Do it if, for example, a uvloop bug affects your workload; Uvicorn falls back the same way on platforms without uvloop. The values are `auto` (default), `asyncio` or `uvloop` for the loop, and `auto`, `h11` or `httptools` for the parser. They are case-insensitive. Any other value refuses to start and the error names the variable and the allowed values. Uninstalling the packages also works, because `auto` falls back to asyncio and h11 when they are missing, but the environment variable is the simpler switch: the next install brings the packages back.

**Other tuning points**, each measured above:

- One Gunicorn worker per CPU.
- Postgres pool size was not the limit: 20 and 40 gave the same result.
- Broker publishers: raise `queue_size` (and `batch_size`) so events are not dropped.
- Server choice (Gunicorn, Uvicorn, Granian, Hypercorn) did not change throughput. See [Choosing the server process](#choosing-the-server-process).

## Choosing the server process

We ran the same load test against four server setups, to see whether the server changes throughput. The setup is the pod from [Measured capacity of one pod](#measured-capacity-of-one-pod): 1 CPU, 2 GB, one process or worker, the same app config and mock model (floor 4.3 s). The code was the same in all four runs, and uvloop 0.23.0 and httptools 0.9.0 were active in each. Load levels were 10, 25, 50, 100, 150, 200, 300, 400 and 500 concurrent users, 30 s per level, about 8,000 requests per run.

Versions: Uvicorn 0.54.0, Gunicorn 26.2.0, Granian 2.8.9 (`--interface asgi --loop uvloop`), Hypercorn 0.18.0 (`--worker-class uvloop`).

| Server | Requests/s at 100 / 300 / 400 / 500 users | p50 at 500 | p99 at 500 | Memory at 500 (mean) | Processes | Threads | Failed |
|---|---|---|---|---|---|---|---|
| Gunicorn with `TenxGraphUvicornWorker` (what plain and `--docker-compose` builds generate) | 20.3 / 38.9 / 41.7 / 41.2 | 10.63 s | 18.02 s | 267 MiB | 2 | 16 | 0 |
| Uvicorn alone, one process | 20.6 / 40.4 / 41.7 / 41.6 | 10.51 s | 18.12 s | 218 MiB | 1 | 13 | 2 of 8,114 at 400 users |
| Granian | 17.9 / 40.1 / 41.3 / 41.5 | 10.65 s | 18.09 s | 247 MiB | 2 | 18 | 0 |
| Hypercorn | 20.8 / 39.9 / 39.9 / 40.0 | 10.77 s | 18.42 s | 253 MiB | 3 | 15 | 0 |

The CPU was full (100%) from 300 users in every run. The two Uvicorn failures were requests where the client saw the connection close. Granian's 17.9 at 100 users was a one-off dip: earlier runs of the other setups showed similar dips at that level.

Throughput and latency are the same within noise. Nearly all the CPU per request goes to the app (graph, checkpointer, auth, publishers), not to the server, so a faster server does not raise throughput here. Uvicorn alone uses about 50 MiB less because there is no Gunicorn master process. These results are for this graph on one small pod. A graph that spends less CPU in the app per request, or many more short requests, may see a difference between servers, so load-test your own setup.

**What we recommend**

- **VM, Docker or Docker Compose:** Gunicorn with `TenxGraphUvicornWorker`, as `10xgraph build` generates. Gunicorn supervises the workers (it restarts a dead worker and runs `WEB_CONCURRENCY` workers on one machine), and the worker drains on SIGTERM.
- **Kubernetes:** one Uvicorn process per pod, and scale with replicas instead of workers. `10xgraph build --k8s` generates this image. Its start command is:

  ```bash
  python -m tenxgraph_api.src.app.serve --host 0.0.0.0 --port 8000
  ```

  Kubernetes already restarts the container and spreads the load across replicas, so the Gunicorn master adds nothing there and costs about 50 MiB per pod in our test. Throughput was the same.

- **Granian and Hypercorn:** we tested them and do not recommend them. They gave the same throughput with more memory and processes, and they run without the drain and stream interrupt described below.

**Use the serve module, not plain Uvicorn.** `tenxgraph_api.src.app.serve` runs one Uvicorn process with `DrainingServer`, the same server class the Gunicorn worker uses. On SIGTERM it does the same as the Gunicorn image:

- The app is marked as draining first, so `/health/ready` answers 503 on open keep-alive connections. The listener closes, so new connections are refused.
- Open NDJSON streams get the final "interrupted by shutdown" chunk 5 seconds before the deadline. The run's thread is saved, so the client can send a new request on the same `thread_id`.
- The deadline is `TENXGRAPH_GRACEFUL_SHUTDOWN_SECONDS` (540 by default). Keep-alive is 2 seconds, as in the Gunicorn image. `FORWARDED_ALLOW_IPS` is optional and defaults to `127.0.0.1,::1`, like Gunicorn.
- The process ends by signal 15 (exit code 143), which is normal for Kubernetes. An import error in your app exits with code 3.

A plain `uvicorn tenxgraph_api.src.app.main:app` command does not get this. It uses Uvicorn's own server: readiness turns 503 late, and streams cut at the deadline get no final chunk. Without `--timeout-graceful-shutdown`, it waits for open streams until SIGKILL and the graph close never runs. Use the serve module.

## Related

- [Architecture](/docs/production/architecture)
- [Production checklist](/docs/server/production-checklist)
- [Kubernetes](/docs/server/kubernetes)
- [Rate limiting](/docs/server/rate-limiting)
