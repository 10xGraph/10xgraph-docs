---
title: Background jobs
description: "Run work outside the request that started it: durable TaskIQ tasks on a worker and scheduler, or fire-and-forget tasks in the graph process."
section: "Background jobs"
order: 0
updated: "2026-11-25"
---

Background jobs run work outside the request that asked for it. 10xGraph has two ways to do it. They differ in what happens when the process dies.

## Pick one

| | In-process tasks | TaskIQ worker and scheduler |
|---|---|---|
| Runs in | The graph process, through `BackgroundTaskManager` | A separate `10xgraph worker` process |
| Survives a restart | No | Yes, the task stays on the broker |
| Schedules | No | Yes (`cron`, `at`, `every`), sent by one `10xgraph scheduler` |
| Scales separately | No | Yes, add workers |
| Status, progress, cancel | Counts and task info in process | `/v1/tasks` routes and `tracker.set_progress` |
| Identity | No stored identity: it is plain code in your node | The identity of the user who started it |
| Guide | [Run work in the background](/docs/guides/run-background-tasks) | [Worker and scheduler](/docs/server/background-tasks) |

Decision rules:

- The work can be dropped on a crash (a notification, a cache warm-up): in-process.
- The work must finish, must run on a schedule, or takes long enough that a deploy would cut it off: worker.
- The user or the next graph step must wait for the result: neither. Do it in a node.

## How the worker side fits together

- You define tasks with `@broker.task`, where `broker` comes from `tenxgraph_api.jobs`.
- The `worker` key in `10xgraph.json` sets the broker (Redis Streams, RabbitMQ or Kafka) and lists the task modules. With the `memory` broker, tasks run inside the API process.
- `10xgraph dev` or the API starts and schedules tasks but does not run them. `10xgraph worker` runs them. Run exactly one `10xgraph scheduler`.
- Start a task with `await my_task.kiq(...)` from Python, or over HTTP with `POST /v1/tasks/{name}` when the task is marked `http=True`.
- Status records, cancel flags and schedule records live in the [cache store](/docs/concepts/cache-store), so use `redis` there too.

## Identity in a run

A task belongs to the user who started it. Reads and cancel follow the caller's reach, and anything outside it answers 404. When the worker picks up a run with auth on, it rebuilds the stored identity with the current `auth.roles` and calls `authorize(identity, "tasks:trigger", task_name)`. If that refuses, the run fails without executing. A task no user started runs as a named identity from `auth.system_identities`. Token expiry and revocation are not checked, because a queued run has no live token. See [Tenancy and access](/docs/concepts/tenancy-and-access).

## What survives a restart

| Event | Result |
|---|---|
| API restart | Queued and scheduled tasks are unaffected. In-process tasks are lost. |
| Worker dies mid-task | Redis Streams and RabbitMQ run it again on another worker (at least once). Kafka may run it again or lose it. Write tasks so a rerun is safe. |
| Worker shutdown | The generated services wait up to 600 seconds for running tasks. |
| Cancel | A queued task does not run. A running task stops only when it checks `await ctx.cancelled()`. |
| Role loses `tasks:trigger` | Its tasks stop running at their next run. Restart workers after changing `auth.roles`. |

## Pages in this section

- [How jobs work](/docs/concepts/background-jobs): the two models and identity per run.
- [Worker and scheduler](/docs/server/background-tasks): install, configure, write tasks, schedules, HTTP routes, delivery guarantees.
- [In-process tasks](/docs/guides/run-background-tasks): `BackgroundTaskManager` from a node.
- [Scaling and reliability](/docs/production/scaling#job-workers): sizing the job worker tier.
