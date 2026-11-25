---
title: "Graceful shutdown"
description: "Shut a graph down cleanly with aclose() and install_shutdown_signals, what happens to cut-off runs, and how the API server drains on SIGTERM."
label: "Graceful shutdown"
updated: "2026-11-26"
order: 30
section: "Deploy"
---

Shut a graph down with `await graph.aclose()`: it refuses new runs, lets active runs finish, stops or cancels the rest with their threads saved, and releases the checkpointer, publisher and store. Under the API server this happens for you on SIGTERM.

## Close the graph with aclose()

`await graph.aclose()` ends active runs in phases, then releases the graph's resources. You can pass `grace`, `stop_timeout` and `timeout` (seconds):

```python
stats = await graph.aclose(grace=10, stop_timeout=5, timeout=5)
```

1. New runs are refused. They raise `GraphClosedError` (`GRAPH_CLOSED_001`).
2. Active runs get `grace` seconds to finish on their own.
3. Runs still going get a stop request. Each saves its thread as INTERRUPTED (reason `stop_requested`). It waits up to `stop_timeout`.
4. Runs still going after that are cancelled. The cancel saves the thread as INTERRUPTED (reason `shutdown`).
5. Background tasks (publisher events, memory writes) are drained for the rest of `timeout`, then cancelled.
6. The checkpointer, publisher and store are released, following the resource ownership rules (`compile(owns_resources=...)`).

Without arguments, the times split `compile(shutdown_timeout=...)` (default 30 seconds): 50% for `grace`, 25% for `stop_timeout`, 25% for `timeout`. The result is a stats dict with `runs` (`active`, `finished`, `stopped`, `cancelled`), `background_tasks`, `cleanup_tasks` (cancel saves and run-marker releases that outlived their run, waited for within the drain budget) and one entry per released component. A second call returns `{"status": "already_closed"}`. `async with graph:` calls `aclose()` on exit.

### Signals

10xGraph never installs signal handlers on its own. To close the graph on SIGTERM and SIGINT, call `install_shutdown_signals` once, from the main thread, inside the running event loop:

```python
from tenxgraph.utils.shutdown import install_shutdown_signals

shutdown = install_shutdown_signals(graph, grace=20, stop_timeout=5, timeout=5)
try:
    await serve(graph)
finally:
    shutdown.uninstall()
```

The first signal starts `aclose()`. Later signals are ignored. `await shutdown.wait()` returns the stats of that close. The helper replaces the default Ctrl+C behavior while it is installed, and it is not available on Windows event loops. If a server such as Uvicorn or Gunicorn already handles SIGTERM, call `graph.aclose()` from its shutdown hook instead.

### Lower-level helpers

`tenxgraph.utils.shutdown` also has `GracefulShutdownManager` (a signal flag for your own main loop), `delayed_keyboard_interrupt()` (defers Ctrl+C around a critical block) and `shutdown_with_timeout(coro, timeout)`. You rarely need them with `aclose()` and `install_shutdown_signals`; see the [runtime utilities reference](/docs/reference/python/runtime-utilities).

## Cancelled and crashed runs

A run can end early: the client disconnects, the process is stopped by `aclose()`, or the process is killed. The thread stays usable.

- **Cancel or shutdown.** The cancel saves the thread as INTERRUPTED, with the user message and any completed steps. Unfinished tool calls are closed: a call with a recorded result in the tool ledger gets that result, and any other gets an error result saying the tool call did not finish.
- **Crash (SIGKILL, out of memory).** No code runs at the moment of the crash. The next request on the thread finds a RUNNING state with no live run behind it and repairs it from the cached state: it closes unfinished tool calls, marks the thread INTERRUPTED with reason `crashed`, and saves it durably. If Redis was lost too, that one turn is lost.
- **The next call.** A new user message after a cut-off run starts a new turn on the repaired context. A call with no new input resumes at the saved node.

### Known limits

A tool that was running when the run was cut off may have finished its side effect without a recorded result. On the next turn the model sees an error result for it and may call it again. Make tools with side effects safe to repeat with an idempotency key. See [Replay-safe tools](/docs/concepts/replay-safe-tools).

### Background work at exit

Publisher events are best-effort background work. Sync `invoke()` and `stream()` wait up to `shutdown_timeout` (default 30 s) for pending events, memory writes and thread naming before they return. The async `ainvoke()` and `astream()` do not wait: call `await graph.aclose()` before the process exits. See [Publishers](/docs/reference/python/publishers#delivery-guarantees).

## Complete example

```python
import asyncio

from tenxgraph.core.graph import StateGraph
from tenxgraph.core.state import Message
from tenxgraph.utils import END
from tenxgraph.utils.shutdown import install_shutdown_signals


async def slow(state):
    await asyncio.sleep(2)
    return Message.text_message("done", role="assistant")


graph = StateGraph()
graph.add_node("slow", slow)
graph.set_entry_point("slow")
graph.add_edge("slow", END)
app = graph.compile()


async def main():
    shutdown = install_shutdown_signals(app, grace=5, stop_timeout=2, timeout=2)
    try:
        n = 0
        while True:  # stands in for your server loop
            n += 1
            await app.ainvoke({"messages": [Message.text_message("hi")]}, {"thread_id": f"t-{n}"})
    except Exception:  # GraphClosedError once the signal starts aclose()
        pass
    finally:
        print(await shutdown.wait())  # stats of the close
        shutdown.uninstall()


asyncio.run(main())
```

Press Ctrl+C: the first signal starts `aclose()`, the next run raises `GraphClosedError`, and the stats show how runs ended.

## Integration with the API server

If you deploy your graph with the API server (Gunicorn in the `10xgraph build` image, Uvicorn under `10xgraph dev`), the server process handles shutdown signals. Do not call `install_shutdown_signals` there.

The image runs Gunicorn with `TenxGraphUvicornWorker`. On SIGTERM it does this, in order:

1. The app is marked as draining. `GET /health/ready` answers `503` with `status: draining`, so the load balancer stops sending new requests. `/ping` stays `200`. See [Health check endpoint](/docs/reference/rest-api/ping).
2. Open responses get up to `TENXGRAPH_GRACEFUL_SHUTDOWN_SECONDS` (540 by default) to finish. Five seconds before that deadline, open streams end with a final chunk saying the run was interrupted. The thread is saved, so the client can send a new request on the same `thread_id`.
3. The lifespan stops the media sweeper, then calls `graph.aclose(grace, stop_timeout, timeout)` once, with `SHUTDOWN_GRACE_SECONDS` (10), `SHUTDOWN_STOP_SECONDS` (10) and `SHUTDOWN_TIMEOUT_SECONDS` (30). Active runs finish, are stopped and saved, or are cancelled and saved; the graph drains its own background work and releases the checkpointer, publisher and store. Then the API waits for pending lease releases and closes its cache store.
   A run that starts on this replica after `aclose()` begins is refused with `503` `SERVICE_UNAVAILABLE` and `Retry-After: 5`, so the client retries on another replica.
4. Open WebSockets are closed with code `1012` (service restart). The run is saved INTERRUPTED and the client reconnects. A run refused while the graph is closing sends a terminal `error` chunk (stream) or frame (WebSocket) with `data.code = "SERVICE_UNAVAILABLE"` and `retry_after_seconds`, and no `done` chunk. On a WebSocket the server then closes with 1012.

The timers nest. Gunicorn's `--graceful-timeout` is 600 seconds in the generated image, and the Kubernetes `terminationGracePeriodSeconds` is 675 seconds (600 plus the 15 second `preStop` sleep plus a 60 second margin). The Compose `stop_grace_period` is 660 seconds. Keep each outer timer longer than the inner one.

If you embed the graph in your own FastAPI app, call `await graph.aclose()` from its lifespan shutdown; see [FastAPI](/docs/integrations/fastapi).

## Run it in production

The image from `10xgraph build` already sets the shutdown behavior this guide describes: the Compose file uses `stop_grace_period: 660s` and the Kubernetes manifest adds a `preStop` delay so the load balancer stops sending new requests first. Match your orchestrator's grace period to your longest run. See [Deploy](/docs/server/deploy) and [Scaling and reliability](/docs/production/scaling).

## Related pages

- [Stream a graph](/docs/guides/stream-graph)
- [Run the server](/docs/server/run-the-server)
- [FastAPI](/docs/integrations/fastapi)
- [Replay-safe tools](/docs/concepts/replay-safe-tools)
