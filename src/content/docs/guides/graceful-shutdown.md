---
title: "Graceful shutdown"
description: "Handle agent shutdown cleanly with signal handlers, timeout coordination, and protected cleanup sections."
label: "Graceful shutdown"
updated: "2026-10-27"
order: 420
group: "Observability and operations"
section: "Build agents"
---

When you deploy an agent application to production, you need a way to shut it down cleanly without losing work in progress. 10xGraph provides `GracefulShutdownManager` and related utilities to intercept shutdown signals, protect critical sections from interruption, and orchestrate cleanup with timeouts.

## When you need graceful shutdown

Graceful shutdown matters when your agent performs long-running operations that should not be abandoned mid-way. Use it if you:

- Run agents in a container or on a VM where the OS sends shutdown signals (SIGINT/SIGTERM)
- Need to finish in-flight graph execution before the process exits
- Want to prevent the user from pressing Ctrl+C during critical initialization or cleanup
- Serve graphs over HTTP and need to drain requests before shutdown
- Use external services (databases, message queues, file systems) that benefit from explicit close

If you run agents with short timeouts or always expect to be killed abruptly, graceful shutdown may not be essential. For production deployments and long-running server processes, it is standard practice.

## How it works

The `GracefulShutdownManager` intercepts SIGINT (Ctrl+C) and SIGTERM (kill) signals and sets a flag instead of terminating immediately. Your code checks this flag in its main loop and shuts down voluntarily when it sees the request.

The manager registers its handlers on the asyncio event loop, so shutdown callbacks run inside the loop. The manager defers actual shutdown logic to your code, which can wait for tasks to complete, close connections, and log what happened.

The `DelayedKeyboardInterrupt` context manager protects sections of code (like initialization and cleanup) from being interrupted. If a signal arrives while the context is active, it is logged and deferred until the context exits, then triggered.

## Core components

### GracefulShutdownManager

The main class for managing shutdown. Create one instance per application.

```python
from tenxgraph.utils.shutdown import GracefulShutdownManager

manager = GracefulShutdownManager(shutdown_timeout=30.0)
```

**Constructor parameters:**
- `shutdown_timeout` (float, default 30.0): Default timeout in seconds for cleanup operations.

**Key methods:**

- `register_signal_handlers(loop=None)`: Set up SIGINT/SIGTERM handlers on the asyncio event loop. If `loop` is `None`, uses the running loop. On Windows, signal handler setup may fail gracefully (logged as a warning).

- `unregister_signal_handlers()`: Restore original signal handlers. Call this during cleanup.

- `add_shutdown_callback(callback)`: Register a callable to invoke when shutdown is requested. The callback should not block (it runs in the event loop as soon as the signal arrives). Useful for notifying tasks that shutdown has started.

- `protect_section()`: Returns a `DelayedKeyboardInterrupt` context manager for protecting critical code sections.

- `wait_for_shutdown(check_interval=0.1)`: An async coroutine that blocks until `shutdown_requested` is `True`. Used in your main loop to wait for a shutdown signal.

**Attributes:**

- `shutdown_requested` (bool): Becomes `True` when shutdown is requested.

### DelayedKeyboardInterrupt

A context manager (also available as the `delayed_keyboard_interrupt()` function) that catches SIGINT/SIGTERM and defers them until exit.

```python
from tenxgraph.utils.shutdown import delayed_keyboard_interrupt

with delayed_keyboard_interrupt():
    # Critical code that must not be interrupted
    initialize_resources()
```

Use sparingly. Deferring signals for too long makes your application unresponsive.

### Helper functions

**`setup_exception_handler(loop)`**: Configure the event loop to suppress benign exceptions that can occur during shutdown, particularly on Windows. These are `ConnectionResetError` and `OSError` with an invalid handle. Other exceptions are logged at error level.

**`shutdown_with_timeout(coro_or_task, timeout, task_name="task")`**: An async helper that waits for a coroutine or task to complete with a timeout. If the timeout expires, it cancels the task and returns a status dict.

Returns: `{"status": "completed", "duration": ...}`, `{"status": "timeout", "duration": ...}`, or `{"status": "error", "error": "...", "duration": ...}`.

## Complete example

This example shows a graph running in a server-like loop, protected initialization, signal handling, and clean shutdown with a timeout.

```python
import asyncio
import logging

from tenxgraph import StateGraph
from tenxgraph.core.state import Message
from tenxgraph.utils.constants import END
from tenxgraph.utils.shutdown import (
    GracefulShutdownManager,
    setup_exception_handler,
    shutdown_with_timeout,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Define a simple graph with one node (no model call, so no provider extra is needed)
def create_graph():
    graph = StateGraph()

    async def agent_node(state):
        # Simulate a long-running operation
        await asyncio.sleep(2)
        return Message.text_message("Agent response", role="assistant")

    graph.add_node("agent", agent_node)
    graph.set_entry_point("agent")
    graph.add_edge("agent", END)
    
    return graph.compile()


async def run_agent_loop(graph, manager):
    """Main loop that processes requests until shutdown is requested."""
    request_count = 0
    
    while not manager.shutdown_requested:
        try:
            request_count += 1
            logger.info("Processing request %d", request_count)
            
            # Run a graph invocation
            result = await graph.ainvoke(
                {"messages": [Message.text_message("hello")]},
                config={"thread_id": f"thread-{request_count}"}
            )
            logger.info("Request %d completed", request_count)
            
            # Simulate work interval (checks shutdown_requested frequently)
            for _ in range(10):
                if manager.shutdown_requested:
                    break
                await asyncio.sleep(0.1)
                
        except asyncio.CancelledError:
            logger.info("Request processing cancelled")
            break
        except Exception as e:
            logger.exception("Error processing request: %s", e)
    
    logger.info("Agent loop exiting after %d requests", request_count)


async def cleanup_resources(graph):
    """Clean up resources (e.g., close database connections)."""
    logger.info("Starting cleanup...")
    
    # Close the graph (background tasks, checkpointer, publisher, store)
    await graph.aclose()
    
    logger.info("Cleanup complete")


async def main():
    """Main entry point with graceful shutdown setup."""
    manager = GracefulShutdownManager(shutdown_timeout=10.0)
    graph = None

    # Set up exception handler for the event loop
    loop = asyncio.get_running_loop()
    setup_exception_handler(loop)
    
    try:
        # Protect initialization from interruption
        with manager.protect_section():
            logger.info("Initializing application...")
            graph = create_graph()
            logger.info("Initialization complete, ready for requests")

        # Register after the protected block: leaving it restores the previous
        # signal handlers, which would undo handlers registered inside it.
        manager.register_signal_handlers(loop)
        
        # Add a callback to log when shutdown is requested
        def on_shutdown():
            logger.info("Shutdown initiated, stopping new requests...")
        
        manager.add_shutdown_callback(on_shutdown)
        
        # Run the main loop (can be interrupted via signals)
        await run_agent_loop(graph, manager)
        
    except KeyboardInterrupt:
        logger.info("Keyboard interrupt received")
    finally:
        # Protect cleanup from interruption
        logger.info("Shutting down...")
        manager.unregister_signal_handlers()

        if graph is not None:
            with manager.protect_section():
                # Wait for cleanup with a timeout
                result = await shutdown_with_timeout(
                    cleanup_resources(graph),
                    timeout=manager.shutdown_timeout,
                    task_name="cleanup",
                )

            if result["status"] == "timeout":
                logger.warning("Cleanup did not complete within timeout")
            elif result["status"] == "error":
                logger.error("Cleanup failed: %s", result["error"])

        logger.info("Application shutdown complete")


if __name__ == "__main__":
    asyncio.run(main())
```

To run this example:

```bash
pip install 10xgraph
python example.py
```

The output shows initialization, request processing, and clean shutdown:

```
INFO:__main__:Initializing application...
INFO:__main__:Initialization complete, ready for requests
INFO:__main__:Processing request 1
INFO:__main__:Request 1 completed
INFO:__main__:Processing request 2
...
```

Press Ctrl+C to trigger shutdown. The manager catches the signal and waits for current work to finish.

## Integration with the API server

If you deploy your graph with the API server (Gunicorn in the `10xgraph build` image, Uvicorn under `10xgraph dev`), the server process handles shutdown signals. You do not need to call `GracefulShutdownManager` directly in most cases. However, if you embed a 10xGraph in your own FastAPI application, you can use graceful shutdown to coordinate graph cleanup with the server shutdown lifecycle. See `/docs/integrations/fastapi` for details on embedding a graph.

## Best practices

- **Register signals early.** Call `register_signal_handlers()` after your app is initialized but before entering the main loop.
- **Protect short, critical sections only.** Deferring signals for extended periods makes your app unresponsive.
- **Set a reasonable shutdown timeout.** The default 30 seconds suits most graphs; adjust based on your slowest cleanup operation.
- **Log what you are doing.** Graceful shutdown logs signal reception and callback execution at info/warning level; add your own logs so operators know the app is shutting down cleanly.
- **Close resources explicitly.** Call `.aclose()` on your compiled graph and any external connections (databases, caches) in the finally block.
- **Test shutdown behavior.** Kill the process with `kill -TERM` and verify that in-flight work completes and resources are freed.

## Run it in production

The image from `10xgraph build` already sets the shutdown behavior this guide describes: the Compose file uses `stop_grace_period: 600s` and the Kubernetes manifest adds a `preStop` delay so the load balancer stops sending new requests first. Match your orchestrator's grace period to your longest run. See [Deploy](/docs/server/deploy) and [Scaling and reliability](/docs/production/scaling).

## Related pages

- `/docs/guides/stream-graph`: streaming responses from a running graph
- `/docs/server/run-the-server`: starting and stopping the API server
- `/docs/integrations/fastapi`: embedding a graph in your own FastAPI app
