---
title: Run background tasks with a worker
description: "Durable TaskIQ tasks with the 10xgraph worker and scheduler: start from Python or HTTP, schedule in UTC, cancel, track progress, retry and shut down safely."
section: "Background jobs"
order: 20
label: "Worker and scheduler"
updated: "2026-11-26"
faq:
  - question: How is this different from BackgroundTaskManager?
    answer: "BackgroundTaskManager runs fire-and-forget work inside the graph process and loses it on a crash. Tasks on this page go through a broker to a separate worker, survive a restart and can be scheduled. See [Run work in the background](/docs/guides/run-background-tasks) for the in-process one."
  - question: Why did my task run twice?
    answer: "On Redis and RabbitMQ delivery is at-least-once: if a worker dies, another worker runs the task again. A retry after an error is also a rerun. Write tasks so a rerun is safe. See [Delivery guarantees](#delivery-guarantees)."
  - question: Can I use Inject[...] in a task?
    answer: "No. Plain InjectQ `Inject[...]` passes the marker object instead of the value. Use `InjectTaskiq` from `injectq.integrations.taskiq`."
  - question: Can I schedule in my time zone?
    answer: "No. Schedules run in UTC only. A cron expression is always read as UTC, and a one-time `at` without an offset is UTC. Convert your local time to UTC before you send it."
  - question: Why does cancel not stop my running task?
    answer: "Cancel is a signal. A queued task is not run, but a running task stops only when it checks `await ctx.cancelled()` and returns."
---

10xGraph runs durable background work on [TaskIQ](https://taskiq-python.github.io/). You write tasks with `@broker.task`, the API sends them, a `10xgraph worker` process runs them, and a `10xgraph scheduler` process fires scheduled ones. The worker loads your graph, checkpointer, store and cache store the same way the API does, so a task can inject and run the graph.

For fire-and-forget work inside a node, use [BackgroundTaskManager](/docs/guides/run-background-tasks) instead.

## Install

```bash
pip install "10xgraph-api[jobs]"           # Redis
pip install "10xgraph-api[jobs-rabbitmq]"  # RabbitMQ, results on Redis
pip install "10xgraph-api[jobs-kafka]"     # Kafka, results on Redis
```

The supported brokers are Redis Streams, RabbitMQ and Kafka. Results, progress and dynamic schedules always live in Redis. Without the extra, the worker refuses to start and prints the command.

## Configure

Add a `worker` key to `10xgraph.json`. Status records, cancel flags and schedule records live in the API's cache store, so set `cache_store.type` to `redis` too.

```json
{
  "agent": "app.graph:app",
  "cache_store": {"type": "redis", "url": "${REDIS_URL}"},
  "worker": {
    "broker": {"type": "redis_stream", "url": "${REDIS_URL}"},
    "tasks": ["app.tasks"],
    "result_ttl": 86400,
    "retries": 3
  }
}
```

| Key | Default | Meaning |
| --- | --- | --- |
| `broker.type` | `redis_stream` | `redis_stream`, `rabbitmq`, `kafka` or `memory` (tests and local runs; it runs tasks inside the API). Other brokers are not supported yet. |
| `broker.url` | `REDIS_URL` for Redis | Redis URL, AMQP URL (`amqp://user:pass@host:5672/`) or Kafka bootstrap servers (`k1:9092,k2:9092`). `${VAR}` is expanded. Required for RabbitMQ and Kafka. |
| `broker.options` | `{}` | Extra constructor arguments, for example `{"idle_timeout": 600000}` for Redis or `{"qos": 10}` for RabbitMQ. For Kafka, `consumer` and `producer` hold aiokafka client settings; the consumer group defaults to `10xgraph`. Redis Streams only: `max_deliveries` (default `5`) caps redeliveries of one message, see [Delivery guarantees](#delivery-guarantees). `xread_count` and `unacknowledged_batch_size` are fixed at 1, and any other value refuses to start. |
| `result_backend` | Redis | `{"type": "redis", "url": ..., "options": {}}` or `{"type": "memory"}`. The URL defaults to the broker URL for a Redis broker, else `REDIS_URL`. |
| `tasks` | `[]` | Module names (`app.tasks`) or file globs (`app/**/*_tasks.py`) the worker imports. |
| `result_ttl` | `86400` | Seconds status, progress and results are kept. |
| `retries` | `3` | Retries after the first run: `3` means up to 4 runs. Retries are off per task unless you set `retry_on_error=True`. See [Retries](#retries). |

With a broker other than `memory`, set `cache_store.type` and `worker.result_backend.type` to `redis` (the result backend is Redis unless you change it). If either one is `memory`, the API and the worker log a warning at boot, because they no longer share task status, results or cancel flags: status stays `queued` and a cancel never reaches a running task. For the Redis layout and what happens when Redis is down, see [Redis keys and outages](#redis-keys-and-outages).

## Write a task

```python
# app/tasks.py
from typing import Annotated

from injectq.integrations.taskiq import InjectTaskiq
from taskiq import TaskiqDepends
from taskiq.depends.progress_tracker import ProgressTracker, TaskState
from tenxgraph.core.graph import CompiledGraph
from tenxgraph_api.jobs import TaskContext, broker


@broker.task(task_name="make_report", http=True)  # http=True lets the API start it; the default is False
async def make_report(
    topic: str,                                                    # set by the caller
    config: dict,                                                  # filled by the server
    ctx: Annotated[TaskContext, TaskiqDepends()],
    tracker: Annotated[ProgressTracker, TaskiqDepends()],
    graph: Annotated[CompiledGraph, InjectTaskiq(CompiledGraph)],  # InjectQ value
) -> dict:
    await tracker.set_progress(TaskState.STARTED, {"step": 1})
    if await ctx.cancelled():
        return {"cancelled": True}
    ...
```

Tasks are TaskIQ tasks, so everything in TaskIQ works. What 10xGraph adds:

- `ctx: Annotated[TaskContext, TaskiqDepends()]` gives `task_id`, `task_name`, `config` and `await ctx.cancelled()`.
- A `config` parameter gets the run config (`user_id`, `user` and `task_id`) only if you declare it. `user` is the caller's `Identity` as a dict. Pass it to `graph.ainvoke(..., config=config)` to run as the caller. Without a label it is `{"task_id": ...}` only.
- Inject values with `InjectTaskiq`. Plain `Inject[...]` does not work in tasks.
- Progress is TaskIQ's `ProgressTracker`.
- `TaskCancelled` is the error a task cancelled before it started returns to the caller.

An argument typed as a pydantic model is not guaranteed to arrive as one. TaskIQ parses each argument against its type hint, and when parsing fails it logs a warning and passes the raw value (a dict) to your task, which then fails later, for example with `AttributeError`. Tip: call `Model.model_validate(arg)` at the top of the task to fail fast with a clear error.

The task name is the `task_name` you set, here `make_report`. Without it TaskIQ uses `<module>:<function>` (`app.tasks:make_report`).

## Run the worker and the scheduler

```bash
10xgraph dev        # the API: starts and schedules tasks, does not run them
10xgraph worker     # runs tasks
10xgraph scheduler  # sends scheduled tasks
```

Both read `10xgraph.json` from the current folder (`--config` to change it), refuse to start without a `worker` key, and import the entries in `worker.tasks`. Every other flag goes to TaskIQ unchanged (`--workers`, `--ack-type`, `--log-level`). `10xgraph worker` refuses `--use-process-pool`. `10xgraph scheduler` refuses the `memory` broker, because that broker runs tasks inside the API.

Each command adds these flags unless you pass your own:

| Command | Flag | Default | Meaning |
| --- | --- | --- | --- |
| `10xgraph worker` | `--wait-tasks-timeout` | `600` | Seconds to wait for running tasks after SIGTERM. |
| `10xgraph worker` | `--shutdown-timeout` | `60` | Seconds for the shutdown hook after that wait: the graph close and the telemetry flush. |
| `10xgraph scheduler` | `--update-interval` | `10` | Seconds between reads of the schedule sources, so how soon it sees a changed schedule. |
| `10xgraph scheduler` | `--skip-first-run` | on | Nothing runs at start. See [Schedules](#schedules). |
| `10xgraph scheduler` | `--send-timeout` | `30` | A send to the broker that takes longer is logged and skipped. |

Run as many workers as you need, and exactly one scheduler. The scheduler holds a lease in Redis (`10xgraph:scheduler:lease`, 30 seconds, renewed every 10, released on shutdown). A second scheduler logs a warning, sends nothing and waits as a standby. It takes over within about 30 seconds when the first one stops or dies, so a restart or a rolling deploy needs no extra step. Without Redis there is no lease and the scheduler logs a warning: two would send every task twice.

`10xgraph build` generates both processes for you. With `--docker-compose` it adds a `worker` service and, if you ask for it, a `scheduler` service built from the same image as the API. With `--k8s` it adds a `<service>-worker` and a `<service>-scheduler` Deployment (the scheduler has one replica and `strategy: Recreate`, so a rollout never runs two). The generated worker uses the same 600 and 60 second waits, and its kill grace (`stop_grace_period` in Compose, `terminationGracePeriodSeconds` in Kubernetes) is 720 seconds: both waits plus a 60 second margin. Use `--worker` and `--scheduler` to choose, or answer the questions when `build` asks. With the `memory` broker no worker is generated, because tasks run inside the API. See [Deploy with Docker and Kubernetes](/docs/server/deploy).

## Start a task from Python

Use TaskIQ's own call:

```python
await make_report.kiq("sales")
```

The run config is then `{"task_id": ...}` only. To pass one, set the `tenxgraph_config` label (a JSON string):

```python
import json

await make_report.kicker().with_labels(
    tenxgraph_config=json.dumps({"user_id": "u1"})
).kiq("sales")
```

## Schedules

A fixed schedule goes on the task and is sent by `10xgraph scheduler`:

```python
@broker.task(schedule=[{"cron": "0 2 * * *"}])
async def nightly_cleanup() -> None: ...
```

A common use is maintenance work, such as pruning old tool execution ledger rows. See the [prune job example](/docs/concepts/replay-safe-tools#prune-old-ledger-rows).

For dynamic schedules use TaskIQ's `schedule_by_cron`, `schedule_by_time` or `schedule_by_interval` with the source from `tenxgraph_api.jobs.scheduler`:

```python
from tenxgraph_api.jobs.scheduler import sources

await make_report.kicker().schedule_by_cron(sources[-1], "0 2 * * *", "sales")
```

`sources[-1]` is the Redis source. It uses the result backend's Redis, so it exists with every broker except `memory`. The same schedules are available over HTTP, below.

### Time zones

Schedules run in UTC only. Other time zones are not supported.

- A cron expression is always read as UTC. `0 2 * * *` fires at 02:00 UTC, whatever the server's local time zone is.
- A one-time `at` with an offset (`2026-12-01T09:00:00+02:00`) is converted to UTC. An `at` without an offset is read as UTC.
- Convert your local time to UTC before you send it. There is no time zone field.

### Rules for schedules over HTTP

The HTTP routes check every schedule when it is created or changed, and answer 422 when it is not valid:

- **Cron** has 5 fields (minute, hour, day of month, month, day of week), each in range. Steps start at 1. A field can use `*`, `*/n`, `a`, `a-b`, `a-b/n` or a comma list of those. Day names (`mon`) work only in the day-of-week field, and not with a step. `61 * * * *`, `*/0 * * * *` and `0 abc * * *` are refused.
- **`every`** is a whole number of seconds from 10 to 31536000 (one year).
- **`at`** is an ISO time. Exactly one of `cron`, `at` and `every` is allowed.
- One user can have at most 100 schedules. The 101st answers 429: cancel one first. A one-time schedule counts until its record expires.

Records saved by an older version still read, change and cancel, even if they would not pass these rules now.

### What runs at start

`10xgraph scheduler` runs nothing at start. An `every` schedule first runs one interval after the scheduler starts, and a cron schedule does not fire twice when the scheduler restarts inside its minute. A daily `every` job therefore does not rerun at each deploy. A schedule that you create while the scheduler is running runs when the scheduler first sees it. To run something at start, call the task once yourself.

## Start a task over HTTP

Only tasks marked `http=True` can be started over HTTP; any other task answers 404. The routes use the same auth as the graph routes.

| Route | Does | Scope |
| --- | --- | --- |
| `POST /v1/tasks/{name}` | Run now (`{task_id}`), or schedule when the body has `schedule` (`{schedule_id}`). | `tasks:trigger` |
| `GET /v1/tasks/{id}` | Task: `status`, `progress`, `result`, `error`. Schedule: its task, time, arguments, `status` and `runs`. | `tasks:read` |
| `PATCH /v1/tasks/{schedule_id}` | Change a schedule's time. | `tasks:trigger` |
| `POST /v1/tasks/{id}/cancel` | Cancel a task, or delete a schedule. | `tasks:cancel` |

```bash
# run now; answers 202 with {"data": {"task_id": "..."}}
curl -X POST http://localhost:8000/v1/tasks/make_report \
  -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"kwargs": {"topic": "sales"}}'

# read it
curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/v1/tasks/$TASK_ID

# schedule it: exactly one of cron (UTC), at (ISO time, once) or every (seconds, 10 to 31536000)
curl -X POST http://localhost:8000/v1/tasks/make_report \
  -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"kwargs": {"topic": "sales"}, "schedule": {"cron": "0 2 * * *"}}'

# change the time
curl -X PATCH http://localhost:8000/v1/tasks/$SCHEDULE_ID \
  -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"schedule": {"every": 3600}}'
```

The status of a task is `queued`, `running`, `success`, `failure` or `cancelled`. The status of a schedule is `scheduled`, or `sent` for a one-time schedule the scheduler has already sent. Rules:

- The body is `{"args": [], "kwargs": {}, "schedule": ...}`.
- Callers set only the task's plain arguments. The call must fit the task's signature, for run and for schedule: `config`, `user`, `user_id`, injected parameters, unknown names, missing arguments, repeated arguments and extra positional arguments are refused with 422 before anything is queued. The server fills the run config from the caller.
- A schedule that is not valid (see [Rules for schedules over HTTP](#rules-for-schedules-over-http)) is 422.
- Codes: 202 started or scheduled, 404 unknown task, unknown id or outside your reach, 422 bad arguments or schedule, 429 more than 100 schedules for the user, 409 for PATCH of a one-time schedule that already ran or of a schedule that another PATCH or cancel is changing (try again), 501 no Redis for schedules.
- Tasks and schedules belong to the user who started them. `GET` and cancel follow the caller's reach (`own`, `tenant` or `all`); starting a task and `PATCH` stay on the caller's own. Anything outside the caller's reach gets 404, the same as for an unknown id.
- There is no list route. Keep the ids you get back.
- A schedule runs as the user who created it, with that user's roles as they are when each run starts. It lives until you cancel it; a one-time `at` schedule expires after its run result does.
- `GET /v1/tasks/{schedule_id}` has a `runs` list: the task ids of the last 20 runs the scheduler sent, newest first. Each id works with `GET /v1/tasks/{id}` and `POST /v1/tasks/{id}/cancel` like a run you started yourself, with the same owner and reach checks. Cancelling the schedule drops the list, not the runs' own records.
- A task that loses `http=True` can no longer be changed over HTTP (PATCH answers 404), and the scheduler stops sending its HTTP schedules and logs it. Cancel them.
- `authorize` on your `BaseAuth` class gets the task name as the resource on these routes (from the path on `POST`, from the stored task or schedule on the others). A custom rule can allow or refuse per task. Audit events carry `task/<name>` or `task/<name>/<id>`.
- Scheduling needs the Redis result backend; with the `memory` broker or result backend the answer is 501.
- In production the `error` field is the exception class name only.
- Grant `tasks:trigger`, `tasks:read` and `tasks:cancel` to the roles that need them, in `auth.roles`. There is no `tasks:pause`. See [API authentication](/docs/server/auth).

## Auth in the worker

With auth on, the worker checks every run again before it executes, because the role table may have changed since the task was queued:

1. The stored identity is rebuilt from its claims with the **current** `auth.roles` the worker booted with. A `__system__` user id is refused.
2. The worker calls `authorize(identity, "tasks:trigger", task_name)` on your `BaseAuth` class. If it refuses, the stored identity is invalid, or the check raises, the run does not execute and its status is `failure` (fail closed).
3. The rebuilt identity goes into `config["user"]` and `TaskContext.config`.

Token expiry and revocation are not checked, because a queued run has no live token. A user whose role loses `tasks:trigger` stops running at the next run, and a revoked user's already queued tasks still run until their role changes. Restart workers after you change `auth.roles`.

### Audit in the worker

With the `audit` block enabled in `10xgraph.json`, the worker writes the audit log like the API does:

- Each run's `tasks:trigger` decision is an `access` event, `allowed` or `denied`. The resource is `task/<name>/<task id>`. A `denied` event has the reason `invalid_identity` (the stored identity cannot be rebuilt) or `error` (`authorize` raised).
- Tool calls and approvals of a graph run inside a task are recorded as on `/v1/graph/invoke` (`tool:call`, `tool:approve`).

Tasks that run in the API on the `memory` broker are not covered. See [Audit log](/docs/server/audit-log).

### System identities

A task that no user started (a cron schedule on the task, or a call from your own code) has no caller. Give it a name and the identity it runs as:

```json title="10xgraph.json"
{
  "auth": {
    "method": "jwt",
    "roles": {"member": {"permissions": ["graph:*", "threads:*", "tasks:trigger"], "reach": "own"}},
    "system_identities": {"nightly": {"roles": ["member"], "tenant": {"org_id": "acme"}}}
  }
}
```

```python
@broker.task(schedule=[{"cron": "0 2 * * *"}], identity="nightly")
async def nightly_cleanup(config: dict) -> None: ...
```

The run executes as `Identity(kind="system", user_id="__system__:nightly")` with the roles and tenant of that entry, resolved like a token holding them. Rules:

- The `identity` label never overrides a caller. A task started by a user runs as that user.
- An unknown name with auth on aborts the run. With auth off the task runs without an identity and logs one warning.
- The system identity still needs `tasks:trigger` through its roles, and its reach comes from its roles.
- HTTP callers cannot set labels.

## Monitoring and errors

The worker logs every task and sends the same steps as events to the event publishers bound in your container (Kafka, Redis, RabbitMQ, console or custom). AI tracing backends (Phoenix, Logfire, LangSmith, OTEL) do not receive them, because a task is not a graph run. A failed task is not published at all (`metadata.source` is `task`, `metadata.phase` names the TaskIQ hook):

| Hook | Event type | Phase | Notes |
| --- | --- | --- | --- |
| `post_send` | `update` | `queued` | Sent from the process that queued the task (the API). |
| `pre_execute` | `start` | `started` | |
| `on_error` | `interrupted` | `cancelled` | A cancelled task (`TaskCancelled`). Logged as info, not as an error. |
| `post_execute` | `end` | `finished` | Success only, with `duration`. |
| `post_save` | `result` | `saved` | No return value in the event. |

`on_error` logs it at ERROR level with the traceback and counts it in `tenxgraph.task.runs` with `status="failure"`. See [Publishers, AI tracing and metrics](/docs/concepts/events-and-observability).

Metrics and traces come through OpenTelemetry, set up like the API (one setup shared by the API and the worker): `OTEL_ENABLED=true`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`, `OTEL_LEVEL`. Each task becomes a span, and two metrics are exported:

| Metric | Type | Attributes | Recorded by |
|---|---|---|---|
| `tenxgraph.task.runs` | counter | `task`, `status` (`queued`, `success`, `failure`, `cancelled`) | `queued` by the process that sends the task (the API for HTTP calls), the rest by the worker. A retried task counts one `failure` per attempt. |
| `tenxgraph.task.duration` | histogram | `task` | The worker, once per attempt, whatever the outcome. |

With the `metrics` block in `10xgraph.json` enabled, the worker exports these metrics itself, by OTLP push or a Prometheus scrape port (`metrics.prometheus.worker_port`). See [Metrics with Prometheus and Grafana](/docs/guides/metrics-prometheus-grafana). Without the block, the metrics go to the same endpoint as the traces (OTLP gRPC), or to the console when no endpoint is set outside production; point that endpoint at an OpenTelemetry collector and export from the collector to Prometheus. `OTEL_METRIC_EXPORT_INTERVAL` (milliseconds, default 60000) sets how often metrics are pushed.

## Cancel and progress

`POST /v1/tasks/{id}/cancel` sets a flag. A queued task is then not run and ends as `cancelled`. A running task is not killed: it stops when it checks `await ctx.cancelled()` and returns, and then ends as `success` with whatever it returned. Check it between steps of long work. A task that is cancelled before it starts does not set up its dependencies.

Progress is what the task passes to `tracker.set_progress(state, meta)`. `GET /v1/tasks/{id}` shows it under `progress`, for example `{"state": "STARTED", "meta": {"step": 2}}`.

## Status and results

- The final status is written after the result is saved. If the result cannot be saved (a return value that is not JSON-serialisable, or a result backend that is down), the task ends as `failure`, `result` is `null` and `error` says `The result could not be saved (TypeError); see the worker log`. It never shows `success` with an empty result.
- A status only moves forward. A late `queued` does not replace `running`, and cancel changes only a task that is still `queued`: it does not overwrite `running` or a final status.
- A task that raises TaskIQ's `NoResultError` ends as `success`.

## Retries

Retries are off unless the task sets `retry_on_error=True`:

```python
@broker.task(task_name="make_report", http=True, retry_on_error=True)
async def make_report(topic: str) -> dict: ...
```

- `worker.retries` is the number of retries after the first run. `"retries": 3` gives up to 4 runs, and `"retries": 1` gives one retry. (In 1.0 it gave one run fewer than that.)
- A per-task `max_retries` label keeps TaskIQ's meaning: the number of runs minus one.
- The status stays `running` between attempts and ends when the last attempt ends.
- These are never retried, because the task body did not run or would fail the same way: a task cancelled before it started, a run the worker refused (no permission, or an identity that cannot be rebuilt), a call whose arguments do not fit the task, and a message over the delivery limit.

## Delivery guarantees

What happens when a worker dies in the middle of a task depends on the broker:

| Broker | If a worker dies |
| --- | --- |
| Redis Streams | At-least-once. The worker acknowledges after the task ends. A live worker renews its claim every `idle_timeout / 3`, so a running task is not taken by another worker. Another worker takes a dead worker's message after `idle_timeout` (milliseconds, default 600000), also on an idle queue. |
| RabbitMQ | At-least-once. The worker acknowledges after the task ends. RabbitMQ requeues the message as soon as the dead worker's connection drops, and another worker runs it within a second. RabbitMQ also gives up on a delivery that stays unacknowledged longer than its `consumer_timeout` (30 minutes by default) and requeues it, so raise that for longer tasks. |
| Kafka | At-most-once in practice. Kafka has no per-message acknowledgement: the consumer commits its read position every 5 seconds. If the worker dies before that commit, the group takes over after about 10 seconds and the task runs again. If it dies later, the task is lost and its status stays `running` until `result_ttl`. |

Write tasks so a rerun is safe. A task can also run again when its worker is alive: on Redis Streams, if Redis stays unreachable for longer than `idle_timeout` (the claim is not renewed), or if the acknowledgement cannot be sent after four tries (see [Redis keys and outages](#redis-keys-and-outages)).

### How the Redis Streams worker reads

- It reads and claims one message at a time, and only when it has a free slot. A busy worker does not hold the rest of the queue while other workers sit idle. `xread_count` and `unacknowledged_batch_size` are fixed at 1.
- A message whose handler ends without an acknowledgement (for example a failing shutdown hook) is logged and released for redelivery. Before, its claim was renewed for ever and the status stayed `running`.
- On shutdown, messages the worker still holds are released at once, so another worker takes them without waiting for `idle_timeout`.

### Poison messages

A task that kills its worker every time (an out-of-memory crash, for example) would be taken and run again for ever. `worker.broker.options.max_deliveries` (default `5`, Redis Streams only) stops that:

```json
"broker": {"type": "redis_stream", "options": {"max_deliveries": 5}}
```

A message delivered more often than that is not run. The task ends as `failure` with a `DeliveryLimitError` as its error, the error is saved as the result, and the message is acknowledged. It is not retried.

## Shutdown

On SIGTERM `10xgraph worker` stops reading, waits up to `--wait-tasks-timeout` (default 600 seconds) for running tasks, then runs the shutdown hook within `--shutdown-timeout` (default 60 seconds). The hook closes the graph, the cache store and the auth class, then flushes the last metrics and traces, in the same order as the API server. A task still running when the first wait ends is cut, and its message is released for another worker. Set your orchestrator's kill timer above both waits: the files from `10xgraph build` use 720 seconds. If you start the worker yourself, give it the same margin. See [Graceful shutdown](/docs/guides/graceful-shutdown).

## Redis keys and outages

### Key names

Everything the jobs layer keeps in Redis uses `REDIS_KEY_PREFIX` when you set it, so two deployments on one Redis do not read each other's queues or schedules. Without a prefix, the names in the left column are used. With `REDIS_KEY_PREFIX=P`, `P:` goes in front of each.

| What | Key |
| --- | --- |
| Task stream and consumer group (Redis Streams) | `taskiq` |
| Task result | `<task id>` |
| Task progress | `<task id>__progress` |
| Dynamic schedules | `schedule:cron`, `schedule:interval`, `schedule:time:*`, `schedule:data:<id>` |
| Scheduler lease | `10xgraph:scheduler:lease` |
| Task status | `10xgraph:cache:jobs:status:<task id>` |
| Cancel flag | `10xgraph:cache:jobs:cancel:<task id>` |
| Schedule record | `10xgraph:cache:jobs:schedule:<schedule id>` |
| Schedule count per user | `10xgraph:cache:jobs:schedules:<owner>` |
| Last runs of a schedule | `10xgraph:cache:jobs:schedule-runs:<schedule id>` |

A `queue_name` or `consumer_group_name` you set in `worker.broker.options`, or a `prefix_str` in `worker.result_backend.options`, still wins over the prefix.

If you already set `REDIS_KEY_PREFIX` before this change, the stream, results, schedules and lease used to have no prefix. After the upgrade the new keys are read and the old ones are not. To move over:

1. Stop the API from sending tasks, and wait until the workers are idle so the queue is empty.
2. Deploy the new version.
3. Rename each existing HTTP schedule key (`schedule:cron`, `schedule:interval`, `schedule:time:*` and `schedule:data:*`) to `<prefix>:schedule:...` with Redis `RENAME`, or cancel the schedules and create them again.

Results of runs that finished before the upgrade are no longer shown. Without a prefix, nothing changes. The core graph's own cache keys have their own `redis_key_prefix` option (see [Production checklist](/docs/server/production-checklist)).

### When Redis is down

The worker keeps running when the broker Redis drops. It logs the error, reads again with a back-off (1 second, doubling up to 30), recreates the consumer group if Redis restarted without its data, and does not touch running tasks. A finished task's acknowledgement is retried (four tries, 1, 2 and 4 seconds apart). In a live check, a 120 second task survived a Redis restart and ran once. A queue that Redis lost without persistence is gone, so turn on persistence for the broker Redis.

While Redis is down:

- The API cannot send new tasks.
- A running task cannot save progress or its result. Its status cannot be written either: the write fails and is only logged (`status not saved`). The task is not marked `failure` for that.
- A task whose acknowledgement could not be sent is delivered again when Redis is back, and runs again.

Run the broker and the cache store on separate Redis instances. The broker Redis holds the queue, results, progress and dynamic schedules; the cache store holds status, cancel flags, schedule records and the other state the API shares (run locks, rate limits, token revocation). When both live on one Redis, one outage stops queueing and also stops status updates, so a failed task cannot report why. With two instances:

| Down | Effect |
| --- | --- |
| Broker Redis only | No new tasks and no new results. Status and cancel keep working for what is already stored. |
| Cache store only | Tasks still run and results are saved. Status, cancel flags and schedule records cannot be read or written: status updates are only logged, so a task can keep an old status until it runs again. The API's own cache-store features fail too. |
| Both | Nothing works. The worker waits and retries, and queued tasks resume when the broker is back. |

## Limits

- Kafka: a task lost when its worker dies (see above). The default topic `taskiq_topic` has one partition, so only one worker in the group reads it; create the topic with more partitions to spread work. A new consumer group starts at the latest offset, so tasks sent before the first worker ever joined are skipped. Building the Kafka broker connects to Kafka at once, so the API and worker need it reachable at startup.
- The cancel check and the argument guard do not reach process-pool workers, so the worker refuses that mode.
