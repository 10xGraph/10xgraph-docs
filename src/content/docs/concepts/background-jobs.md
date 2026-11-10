---
title: Background jobs
seoTitle: "Background jobs and workers in 10xGraph"
description: When to use in-process background tasks and when to use the TaskIQ worker and scheduler, how tasks are started over HTTP, and how identity carries into each run.
section: Concepts
group: "Serving"
order: 172
updated: "2026-11-10"
faq:
  - q: "When do I need the worker instead of BackgroundTaskManager?"
    a: "Use the worker when work must survive a restart, run on a schedule, or run on a different machine than the API. BackgroundTaskManager runs fire-and-forget work inside the graph process and loses it when the process dies."
  - q: "Does a task run as the user who started it?"
    a: "Yes. With auth on, the stored identity is rebuilt with the current role config at the start of each run and checked for tasks:trigger. A task that no user started runs as a named system identity you configure."
---

10xGraph has two ways to run work outside the request that asked for it. They differ in what happens when the process dies.

## In-process background tasks

`BackgroundTaskManager` runs fire-and-forget work inside the graph process: send an email, warm a cache, write an audit note. It is simple and fast, and the work is lost if the process crashes or restarts. Use it for work you can afford to drop. See [Run work in the background](/docs/guides/run-background-tasks).

## The worker

For work that must survive a restart, run on a schedule, or scale separately, 10xGraph uses [TaskIQ](https://taskiq-python.github.io/) with three pieces:

- Your code defines tasks with `@broker.task`, where `broker` comes from `from tenxgraph_api.jobs import broker`.
- `10xgraph worker` runs them. It loads your graph, checkpointer, store and cache store the same way the API does, so a task can inject and run the graph.
- `10xgraph scheduler` sends scheduled tasks. Run exactly one.

The supported brokers are Redis Streams, RabbitMQ and Kafka. You configure them in the `worker` key of `10xgraph.json`. Status records, cancel flags and schedule records live in the [cache store](/docs/concepts/cache-store), so use `redis` there as well.

Delivery is at-least-once on Redis and RabbitMQ, so write tasks so a rerun is safe. Cancel is a signal: a queued task does not run, and a running task stops when it checks `await ctx.cancelled()`.

## Starting tasks

From Python, call `await my_task.kiq(...)`. Over HTTP, mark the task `http=True` and use the `/v1/tasks` routes: `POST /v1/tasks/{name}` runs it now or schedules it, `GET /v1/tasks/{id}` reads status and progress, `PATCH` changes a schedule, and `POST /v1/tasks/{id}/cancel` cancels. Callers set only the task's plain arguments; the server fills the run config. Permissions are `tasks:trigger`, `tasks:read` and `tasks:cancel`.

## Identity per run

A task belongs to the user who started it. `GET` and cancel follow the caller's reach, while starting a task and changing a schedule stay on the caller's own. Anything outside the reach answers 404.

When the worker picks up a run with auth on, it rebuilds the stored identity from its claims with the current `auth.roles`, then calls `authorize(identity, "tasks:trigger", task_name)` on your auth class. If that refuses, the run fails without executing. A role that loses `tasks:trigger` stops running at its next run. A task that no user started can run as a named system identity from `auth.system_identities`. See [Tenancy and access](/docs/concepts/tenancy-and-access).

## Next steps

- [Run background tasks with a worker](/docs/server/background-tasks): install, configure, write tasks, schedules and HTTP routes.
- [Run work in the background](/docs/guides/run-background-tasks): the in-process manager.
