---
title: Background Task Manager
description: "Reference for BackgroundTaskManager: create, track, wait for, cancel and shut down fire-and-forget asyncio tasks from node functions."
section: Reference
group: "Python library"
order: 160
label: Background Task Manager
updated: "2026-11-26"
---

`BackgroundTaskManager` launches fire-and-forget async operations from inside a node without blocking the graph response. It tracks each task, applies an optional timeout, logs failures, caps the number of in-flight tasks, and cancels everything on shutdown. Use it for slow I/O such as webhook posts or telemetry flushes. For worked examples, see [Run background tasks](/docs/guides/run-background-tasks).

## Import path

```python
from tenxgraph.utils.background_task_manager import BackgroundTaskManager, TaskMetadata
# also available from:
from tenxgraph.utils import BackgroundTaskManager
```

## Getting the instance

`StateGraph` creates one `BackgroundTaskManager` and binds it in the dependency container, so you receive it by declaring a parameter with an `Inject[BackgroundTaskManager]` default in any node function:

```python
import asyncio

from injectq import Inject
from tenxgraph.utils.background_task_manager import BackgroundTaskManager
from tenxgraph.utils.injection import fresh


async def send_webhook(user_id: str | None) -> None:
    # Stand-in for slow I/O such as an HTTP POST
    await asyncio.sleep(2)


async def my_node(
    state,
    config: dict,
    task_manager: BackgroundTaskManager = Inject[BackgroundTaskManager],
):
    task_manager = fresh(task_manager)
    # Fire and forget: the node returns without waiting for the webhook
    task_manager.create_task(
        send_webhook(config.get("user_id")),
        name="send_webhook",
        timeout=15.0,
    )
    return state
```

---

## `BackgroundTaskManager`

### Constructor

```python
manager = BackgroundTaskManager(
    default_shutdown_timeout=30.0,
    max_pending_tasks=1000,
)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `default_shutdown_timeout` | `float` | `30.0` | Seconds to wait when draining tasks during `shutdown()`. |
| `max_pending_tasks` | `int` | `1000` | Cap on in-flight tasks. Beyond this, new tasks are dropped rather than queued. Set to `0` to disable the cap (unbounded). |

### Properties

| Property | Type | Description |
|---|---|---|
| `pending_count` | `int` | Number of tasks currently in flight. |
| `dropped_count` | `int` | Number of tasks dropped so far because of backpressure. |

### `create_task`

```python
task = manager.create_task(
    coro,
    name="my_task",
    timeout=None,
    context=None,
)
```

Create and track an async task. Returns the created `asyncio.Task`, or `None` if dropped due to backpressure. `name`, `timeout` and `context` are keyword-only. Call it from a running event loop.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `coro` | `Coroutine` | required | The coroutine to execute in the background. Must be a coroutine object, not a function. |
| `name` | `str` | `"background_task"` | Human-readable label appearing in logs and task info. |
| `timeout` | `float or None` | `None` | Cancel the task after this many seconds. `None` (or `0`) means no timeout. A warning is logged on timeout. |
| `context` | `dict or None` | `None` | Extra key/value pairs attached to debug logs and returned by `get_task_info()`. |

#### Backpressure and task dropping

Background tasks are fire-and-forget, so an unbounded queue can grow until the process runs out of memory if the sink is slow. `max_pending_tasks` bounds this. Once that limit is reached, `create_task` drops the newest task and returns `None`. The coroutine is closed to avoid a "coroutine was never awaited" warning.

Treat the return value as optional:

```python
task = manager.create_task(send_webhook(user_id), name="send_webhook")
if task is None:
    ...  # task was dropped due to backpressure
```

Drops are counted on the `background_task_manager.tasks_dropped` metric and logged at warning level, at most once every 5 seconds. The newest task is dropped on purpose: cancelling running tasks would lose work already in progress.

### `get_task_count`

```python
n = manager.get_task_count()  # returns int
```

Number of tracked tasks still in flight. Same value as `pending_count`.

### `get_task_info`

```python
infos = manager.get_task_info()  # returns list[dict]
```

Information about all active tasks. Each dict contains:

| Key | Type | Description |
|---|---|---|
| `name` | `str` | Task name. |
| `age_seconds` | `float` | Seconds elapsed since creation. |
| `timeout` | `float or None` | Configured timeout. |
| `context` | `dict` | Context passed at creation. |
| `done` | `bool` | Whether the task has finished. |
| `cancelled` | `bool` | Whether the task was cancelled (meaningful only when `done=True`). |

### `wait_for_all`

```python
await manager.wait_for_all(timeout=30.0, return_exceptions=False)
```

Wait for all tracked tasks to complete. Returns `None`. If the timeout is exceeded, it logs a warning and returns without raising; the tasks keep running.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `timeout` | `float or None` | `None` | Max seconds to wait, or `None` to wait forever. |
| `return_exceptions` | `bool` | `False` | If `True`, a task's exception does not propagate out of the wait. If `False`, the first exception is raised to the caller. |

### `cancel_all`

```python
await manager.cancel_all()
```

Request cancellation of every tracked task, then sleep 0.1 seconds so cancellations can start to propagate. It does not wait for the tasks to finish.

### `shutdown`

```python
stats = await manager.shutdown(timeout=30.0)
```

Shut the manager down: cancels all tasks, waits up to `timeout` seconds (default `default_shutdown_timeout`), then cancels any that remain. Only the first call does work. Returns a stats dict:

| Key | Type | Description |
|---|---|---|
| `status` | `str` | `"completed"`, `"timeout"`, or `"already_shutdown"`. |
| `initial_tasks` | `int` | Number of tasks at shutdown start. |
| `completed_tasks` | `int` | Tasks that finished cleanly. |
| `remaining_tasks` | `int` | Tasks still in flight after timeout. |
| `duration_seconds` | `float` | Total shutdown duration. |

A repeat call returns only `{"status": "already_shutdown", "tasks_remaining": 0}`.

### Async context manager

The manager supports `async with`. On exit it calls `shutdown()` and does not suppress exceptions.

```python
import asyncio

from tenxgraph.utils.background_task_manager import BackgroundTaskManager


async def main() -> None:
    async with BackgroundTaskManager(max_pending_tasks=10) as manager:
        manager.create_task(asyncio.sleep(1), name="demo")
        print(manager.get_task_count())  # 1
    # shutdown() has run here


asyncio.run(main())
```

---

## `TaskMetadata`

Dataclass holding per-task tracking info. The manager stores one per task; `get_task_info()` exposes its values as dicts.

| Field | Type | Description |
|---|---|---|
| `name` | `str` | Task name. |
| `created_at` | `float` | Unix timestamp of creation. |
| `timeout` | `float or None` | Configured timeout. |
| `context` | `dict or None` | Extra context. Defaults to `None`; the manager stores `{}` when none is given. |

---

## Lifecycle and shutdown

`BackgroundTaskManager` is created once per `StateGraph` and passed to the compiled graph at `compile()`. When you call `aclose()`, the first step of the shutdown sequence is `task_manager.shutdown(timeout=shutdown_timeout)`, which cancels outstanding background tasks and waits for them. Tasks are cancelled, not drained, so do not rely on a pending task finishing during shutdown. Use `wait_for_all()` first if it must complete.

```python
app = graph.compile(shutdown_timeout=30.0)

# In your process teardown:
stats = await app.aclose()  # cancels background tasks, waits up to 30 s
# stats["background_tasks"] holds the shutdown stats dict from above
```

---

## Common errors and fixes

| Error | Cause | Fix |
|---|---|---|
| Background task never starts | Coroutine function passed instead of coroutine object. | Use `create_task(send(x))` not `create_task(send)`. |
| Task fails and nothing seems to happen | Exceptions in fire-and-forget tasks are not raised to your node. | Look for `ERROR` log lines from the `tenxgraph.utils` logger and the `background_task_manager.tasks_failed` metric. |
| `create_task` returns `None` | The `max_pending_tasks` cap was reached and the task was dropped. | Check `dropped_count`, speed up the sink, or raise the cap. |
| Tasks still running at process exit | `aclose()` was not called. | Call `await app.aclose()` during process exit. |
