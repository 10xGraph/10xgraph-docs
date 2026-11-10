---
title: Run background tasks with a worker
description: Durable tasks on TaskIQ with the 10xgraph worker and scheduler, started from Python or over HTTP, with schedules, cancel and progress.
section: "Background jobs"
order: 20
label: "Worker and scheduler"
updated: "2026-11-07"
faq:
  - question: How is this different from BackgroundTaskManager?
    answer: "BackgroundTaskManager runs fire-and-forget work inside the graph process and loses it on a crash. Tasks on this page go through a broker to a separate worker, survive a restart and can be scheduled. See [Run work in the background](/docs/guides/run-background-tasks) for the in-process one."
  - question: Why did my task run twice?
    answer: "On Redis and RabbitMQ delivery is at-least-once: if a worker dies, another worker runs the task again. Write tasks so a rerun is safe."
  - question: Can I use Inject[...] in a task?
    answer: "No. Plain InjectQ `Inject[...]` passes the marker object instead of the value. Use `InjectTaskiq` from `injectq.integrations.taskiq`."
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
| `broker.options` | `{}` | Extra constructor arguments, for example `{"idle_timeout": 600000}` for Redis or `{"qos": 10}` for RabbitMQ. For Kafka, `consumer` and `producer` hold aiokafka client settings; the consumer group defaults to `10xgraph`. |
| `result_backend` | Redis | `{"type": "redis", "url": ..., "options": {}}` or `{"type": "memory"}`. The URL defaults to the broker URL for a Redis broker, else `REDIS_URL`. |
| `tasks` | `[]` | Module names (`app.tasks`) or file globs (`app/**/*_tasks.py`) the worker imports. |
| `result_ttl` | `86400` | Seconds status, progress and results are kept. |
| `retries` | `3` | Cap for retries. Retries are off per task unless you set `retry_on_error=True`. |

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

Both read `10xgraph.json` from the current folder (`--config` to change it), refuse to start without a `worker` key, and import the entries in `worker.tasks`. Every other flag goes to TaskIQ unchanged (`--workers`, `--ack-type`, `--log-level`). `10xgraph worker` refuses `--use-process-pool`. `10xgraph scheduler` adds `--update-interval 10` unless you pass one, which is how soon it sees changed schedules.

Run exactly one scheduler. Two would send every scheduled task twice. Run as many workers as you need.

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

For dynamic schedules use TaskIQ's `schedule_by_cron`, `schedule_by_time` or `schedule_by_interval` with the source from `tenxgraph_api.jobs.scheduler`:

```python
from tenxgraph_api.jobs.scheduler import sources

await make_report.kicker().schedule_by_cron(sources[-1], "0 2 * * *", "sales")
```

`sources[-1]` is the Redis source. It uses the result backend's Redis, so it exists with every broker except `memory`. The same schedules are available over HTTP, below.

## Start a task over HTTP

Only tasks marked `http=True` can be started over HTTP; any other task answers 404. The routes use the same auth as the graph routes.

| Route | Does | Scope |
| --- | --- | --- |
| `POST /v1/tasks/{name}` | Run now (`{task_id}`), or schedule when the body has `schedule` (`{schedule_id}`). | `tasks:trigger` |
| `GET /v1/tasks/{id}` | Task: `status`, `progress`, `result`, `error`. Schedule: its task, time and arguments. | `tasks:read` |
| `PATCH /v1/tasks/{schedule_id}` | Change a schedule's time. | `tasks:trigger` |
| `POST /v1/tasks/{id}/cancel` | Cancel a task, or delete a schedule. | `tasks:cancel` |

```bash
# run now; answers 202 with {"data": {"task_id": "..."}}
curl -X POST http://localhost:8000/v1/tasks/make_report \
  -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"kwargs": {"topic": "sales"}}'

# read it
curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/v1/tasks/$TASK_ID

# schedule it: exactly one of cron, at (ISO time, once) or every (seconds)
curl -X POST http://localhost:8000/v1/tasks/make_report \
  -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"kwargs": {"topic": "sales"}, "schedule": {"cron": "0 2 * * *"}}'

# change the time
curl -X PATCH http://localhost:8000/v1/tasks/$SCHEDULE_ID \
  -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"schedule": {"every": 3600}}'
```

The status is `queued`, `running`, `success`, `failure` or `cancelled`. Rules:

- The body is `{"args": [], "kwargs": {}, "schedule": ...}`.
- Callers set only the task's plain arguments. `config`, `user`, `user_id`, injected parameters, unknown names and extra positional arguments are refused with 422. The server fills the run config from the caller.
- Tasks and schedules belong to the user who started them. `GET` and cancel follow the caller's reach (`own`, `tenant` or `all`); starting a task and `PATCH` stay on the caller's own. Anything outside the caller's reach gets 404, the same as for an unknown id.
- There is no list route. Keep the ids you get back.
- A schedule runs as the user who created it, with that user's roles as they are when each run starts. It lives until you cancel it; a one-time `at` schedule expires after its run result does.
- Scheduling needs the Redis result backend; with the `memory` broker or result backend the answer is 501.
- In production the `error` field is the exception class name only.
- Grant `tasks:trigger`, `tasks:read` and `tasks:cancel` to the roles that need them, in `auth.roles`. There is no `tasks:pause`. See [API authentication](/docs/server/auth).

## Auth in the worker

With auth on, the worker checks every run again before it executes, because the role table may have changed since the task was queued:

1. The stored identity is rebuilt from its claims with the **current** `auth.roles` the worker booted with. A `__system__` user id is refused.
2. The worker calls `authorize(identity, "tasks:trigger", task_name)` on your `BaseAuth` class. If it refuses, the stored identity is invalid, or the check raises, the run does not execute and its status is `failure` (fail closed).
3. The rebuilt identity goes into `config["user"]` and `TaskContext.config`.

Token expiry and revocation are not checked, because a queued run has no live token. A user whose role loses `tasks:trigger` stops running at the next run, and a revoked user's already queued tasks still run until their role changes. Restart workers after you change `auth.roles`.

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

A failed task sends no event. `on_error` logs it at ERROR level with the traceback and counts it in `tenxgraph.task.runs` with `status="failure"`. See [Publishers, AI tracing and metrics](/docs/concepts/events-and-observability).

Metrics and traces come through OpenTelemetry, set up like the API (one setup shared by the API and the worker): `OTEL_ENABLED=true`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`, `OTEL_LEVEL`. Each task becomes a span, and two metrics are exported:

| Metric | Type | Attributes | Recorded by |
|---|---|---|---|
| `tenxgraph.task.runs` | counter | `task`, `status` (`queued`, `success`, `failure`, `cancelled`) | `queued` by the process that sends the task (the API for HTTP calls), the rest by the worker. A retried task counts one `failure` per attempt. |
| `tenxgraph.task.duration` | histogram | `task` | The worker, once per attempt, whatever the outcome. |

With the `metrics` block in `10xgraph.json` enabled, the worker exports these metrics itself, by OTLP push or a Prometheus scrape port (`metrics.prometheus.worker_port`). See [Metrics with Prometheus and Grafana](/docs/guides/metrics-prometheus-grafana). Without the block, the metrics go to the same endpoint as the traces (OTLP gRPC), or to the console when no endpoint is set outside production; point that endpoint at an OpenTelemetry collector and export from the collector to Prometheus. `OTEL_METRIC_EXPORT_INTERVAL` (milliseconds, default 60000) sets how often metrics are pushed.

## Cancel and progress

`POST /v1/tasks/{id}/cancel` sets a flag. A queued task is then not run and ends as `cancelled`. A running task is not killed: it stops when it checks `await ctx.cancelled()` and returns, and then ends as `success` with whatever it returned. Check it between steps of long work.

Progress is what the task passes to `tracker.set_progress(state, meta)`. `GET /v1/tasks/{id}` shows it under `progress`, for example `{"state": "STARTED", "meta": {"step": 2}}`.

## Delivery guarantees

What happens when a worker dies in the middle of a task depends on the broker:

| Broker | If a worker dies |
| --- | --- |
| Redis Streams | At-least-once. The worker acknowledges after the task ends. Another worker takes the message after `idle_timeout` (milliseconds, default 600000), also on an idle queue. A live worker renews its claim, so a long task is not run twice. |
| RabbitMQ | At-least-once. The worker acknowledges after the task ends. RabbitMQ requeues the message as soon as the dead worker's connection drops, and another worker runs it within a second. RabbitMQ also gives up on a delivery that stays unacknowledged longer than its `consumer_timeout` (30 minutes by default) and requeues it, so raise that for longer tasks. |
| Kafka | At-most-once in practice. Kafka has no per-message acknowledgement: the consumer commits its read position every 5 seconds. If the worker dies before that commit, the group takes over after about 10 seconds and the task runs again. If it dies later, the task is lost and its status stays `running` until `result_ttl`. |

Write tasks so a rerun is safe. Retries after an error are opt-in: `@broker.task(retry_on_error=True)`, up to `retries`.

## Limits

- Brokers: Redis Streams, RabbitMQ and Kafka. Results and schedules: Redis. Nothing else for now.
- Kafka: a task lost when its worker dies (see above). The default topic `taskiq_topic` has one partition, so only one worker in the group reads it; create the topic with more partitions to spread work. A new consumer group starts at the latest offset, so tasks sent before the first worker ever joined are skipped. Building the Kafka broker connects to Kafka at once, so the API and worker need it reachable at startup.
- The cancel check and the argument guard do not reach process-pool workers, so the worker refuses that mode.
- One scheduler.
- No list route and no way to kill a running task.
