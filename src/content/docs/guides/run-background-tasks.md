---
title: Run work in the background
description: Launch fire-and-forget async tasks from a node without blocking the response using BackgroundTaskManager.
section: "Background jobs"
order: 30
label: "In-process tasks"
updated: "2026-11-26"
faq:
  - q: What happens to background tasks when the graph shuts down?
    a: "`aclose()` lets outstanding background tasks finish within what is left of `shutdown_timeout` (default 30 seconds), then cancels the ones still running. Call `await task_manager.wait_for_all(timeout=...)` first if a task needs longer."
---

> This guide covers the in-process `BackgroundTaskManager`. For durable tasks that run in a separate worker, survive restarts and can be scheduled, see [Background tasks with a worker](/docs/server/background-tasks).

`BackgroundTaskManager` starts work from inside a node without holding up the response: notifications, webhooks, slow writes that nothing later in the run reads. If the response or a later node needs the result, or a failure must stop the run, do the work in the node instead.

## Quick start

Declare `task_manager: BackgroundTaskManager = Inject[BackgroundTaskManager]` as a parameter in your node function. The framework injects it automatically at runtime.

```python
import asyncio
from tenxgraph.core import StateGraph
from tenxgraph.core.state import AgentState, Message
from tenxgraph.utils import END
from tenxgraph.utils.background_task_manager import BackgroundTaskManager
from injectq import Inject

async def send_notification(user_id: str, text: str) -> None:
    """Simulate sending a push notification (slow I/O)."""
    await asyncio.sleep(0.5)
    print(f"Notification sent to {user_id}: {text}")

async def my_node(
    state: AgentState,
    config: dict,
    task_manager: BackgroundTaskManager = Inject[BackgroundTaskManager],
) -> Message:
    # Do main work and return immediately
    reply = Message.text_message(
        "Your report is being processed in the background.", role="assistant"
    )

    # Fire-and-forget: doesn't block the response
    task_manager.create_task(
        send_notification(config.get("user_id", "anon"), "Report ready soon"),
        name="send_notification",
        timeout=10.0,
    )

    return reply

graph = StateGraph()
graph.add_node("MAIN", my_node)
graph.set_entry_point("MAIN")
graph.add_edge("MAIN", END)

app = graph.compile()
```

`ainvoke` and `astream` return without waiting for the task, which keeps running for up to 10 seconds. Sync `invoke` and `stream` wait for background tasks (up to `shutdown_timeout`) before they return, because their event loop ends with the call.

## Verify it worked

Run the graph and observe the output:

```bash
python -m asyncio << 'EOF'
import asyncio
from tenxgraph.core.state import Message
from my_agent import app  # import your compiled graph

result = await app.ainvoke(
    {"messages": [Message.text_message("Start the report")]},
    config={"thread_id": "t1", "user_id": "alice"},
)
print(result["messages"][-1].text())
# Your report is being processed in the background.

await asyncio.sleep(1)  # keep the loop alive so the background task can finish
# Notification sent to alice: Report ready soon
EOF
```

The key indicator: the graph returns and delivers the response *before* the background task prints its output.

## Set a timeout

Always set a `timeout` for tasks that do I/O. Without one, a hanging task could leak resources until process shutdown. Timeouts protect against slow or unresponsive external services.

```python
task_manager.create_task(
    upload_to_s3(data),
    name="s3_upload",
    timeout=30.0,          # cancel after 30 seconds
    context={"run_id": config.get("run_id")},  # context for error logs
)
```

If the task exceeds `timeout`, it is cancelled and a warning is logged. The cancellation does not affect the graph or the response; it is handled gracefully.

## Track task status

`task_manager.get_task_count()` returns the number of running tasks, and `get_task_info()` a dict per task (`name`, `age_seconds`, `timeout`, `context`, `done`, `cancelled`). See [get_task_info](/docs/reference/python/background-tasks#get_task_info).

## Wait for all tasks before shutdown

If you need to drain the queue before the process exits, call `wait_for_all`:

```python
await task_manager.wait_for_all(timeout=30.0)
```

This waits up to 30 seconds for all outstanding tasks to complete. If they do not complete in time, a warning is logged but no exception is raised.

To cancel everything immediately without waiting:

```python
await task_manager.cancel_all()
```

Use `cancel_all` when shutting down urgently, or `wait_for_all` when graceful draining is preferred.

## Graceful shutdown integration

The compiled graph shuts the task manager down when it is closed. The `shutdown_timeout` parameter on `compile()` controls how long to wait:

```python
app = graph.compile(shutdown_timeout=30.0)

# Later, during process teardown:
await app.aclose()
```

`aclose()` calls the task manager's `shutdown()` with what is left of `shutdown_timeout`: running tasks get that long to finish, and the rest are cancelled. If a task must complete and may take longer, call `wait_for_all()` first. See [Graceful shutdown](/docs/guides/graceful-shutdown).

## Common errors

| Error | Cause | Fix |
|---|---|---|
| `task_manager` is `None` | Not injected or node outside compiled graph. | Ensure the parameter default is `Inject[BackgroundTaskManager]` and the node is inside a compiled graph. |
| Task never runs, or a `TypeError` | Coroutine function passed instead of coroutine object. | Pass the result of calling the function: `create_task(send_notification(...))` not `create_task(send_notification)`. |
| Background tasks are cut off at exit | `aclose()` cancels tasks still running when its budget ends, and a process that exits without `aclose()` drops them. | Call `await task_manager.wait_for_all(timeout=...)` before `aclose()` if they must finish. |
| Timeout warnings in logs | Task takes longer than the `timeout`. | Increase the timeout value if the external service is expected to be slow, or investigate why the service is slow. |
| Task dropped, queue full | 1000 or more tasks in flight (backpressure). `create_task` returns `None` and logs a warning. | Reduce the rate at which you create background tasks, or handle backpressure upstream. |

## Run it in production

Background tasks live in the worker process that started them, so a restart or a different worker does not carry them over. Put anything that must finish into a node that the checkpointer records, and give workers time to drain on shutdown. See [Scaling and reliability](/docs/production/scaling) and [Graceful shutdown](/docs/guides/graceful-shutdown).

## Related pages

- [Dependency injection](/docs/guides/use-dependency-injection) to learn about other injectable parameters available in nodes.
- [Production checklist](/docs/server/production-checklist) for shutdown timeout settings in production.
