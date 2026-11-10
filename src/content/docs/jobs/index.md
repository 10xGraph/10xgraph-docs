---
title: Background jobs
description: "Run work outside the request that started it: durable TaskIQ tasks on a worker and scheduler, or fire-and-forget tasks in the graph process."
section: "Background jobs"
order: 0
updated: "2026-11-10"
---

Background jobs cover work that runs outside the request that asked for it. Use in-process tasks for work you can afford to lose on a restart. Use the TaskIQ worker and scheduler for work that must survive a restart, runs on a schedule, or scales separately.

- [How jobs work](/docs/concepts/background-jobs): When to use in-process tasks versus the TaskIQ worker and scheduler, and how identity carries into each run.
- [Worker and scheduler](/docs/server/background-tasks): Durable TaskIQ tasks run by the 10xgraph worker and scheduler, started from Python or over HTTP, with schedules, cancel and progress.
- [In-process tasks](/docs/guides/run-background-tasks): Fire-and-forget async tasks launched from a node with BackgroundTaskManager, without blocking the response.
