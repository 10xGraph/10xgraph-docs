---
title: "Runtime utilities"
description: "Shutdown, logging, async helpers, message conversion, tool metadata, and metrics instrumentation."
order: 180
group: "Python library"
section: Reference
updated: "2026-10-08"
---

The `tenxgraph.utils` package holds the small helpers that 10xGraph applications use around the graph: graceful shutdown on SIGINT and SIGTERM, secret redaction for logs, calling sync or async functions, converting state to LLM message dicts, reading `@tool` metadata, and in-process metrics with optional OpenTelemetry export.

## Graceful shutdown

Signal handling and controlled shutdown for asyncio applications. Use these helpers to finish in-flight work and clean up resources when the process receives SIGINT or SIGTERM.

### GracefulShutdownManager

Manager for coordinating graceful shutdown of asyncio applications. It registers SIGINT and SIGTERM handlers on the event loop that set `shutdown_requested` and run your callbacks, and it protects critical sections from interruption. On Windows, loop signal handlers are not supported, so registration logs a warning instead of failing.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `shutdown_timeout` | `float` | `30.0` | Default timeout for cleanup operations in seconds. |

| Method | Parameters | Returns | Description |
|---|---|---|---|
| `register_signal_handlers(loop)` | `loop`: `asyncio.AbstractEventLoop \| None` = `None` | `None` | Register SIGINT/SIGTERM handlers. If `loop` is `None`, uses the running loop. |
| `unregister_signal_handlers()` | | `None` | Restore original signal handlers. |
| `add_shutdown_callback(callback)` | `callback`: `Callable` | `None` | Add a synchronous callback invoked when a signal arrives. It should not block; exceptions are logged and do not stop other callbacks. |
| `protect_section()` | | `DelayedKeyboardInterrupt` | Return a context manager for protecting critical sections. |
| `wait_for_shutdown(check_interval)` | `check_interval`: `float` = `0.1` | Coroutine returning `None` | Poll every `check_interval` seconds until shutdown is requested. |

| Attribute | Type | Description |
|---|---|---|
| `shutdown_requested` | `bool` | Flag indicating if shutdown has been requested. |
| `shutdown_timeout` | `float` | Default timeout for cleanup operations in seconds. |

Example:

```python title="shutdown_demo.py"
import asyncio
from tenxgraph.utils import GracefulShutdownManager


async def main():
    manager = GracefulShutdownManager(shutdown_timeout=10.0)
    manager.add_shutdown_callback(lambda: print("Signal received"))
    manager.register_signal_handlers()

    try:
        # Protect initialization from interruption
        with manager.protect_section():
            await asyncio.sleep(0.1)  # stand-in for real setup

        # Run until SIGINT or SIGTERM sets shutdown_requested
        await manager.wait_for_shutdown()
        print("Shutting down")
    finally:
        manager.unregister_signal_handlers()
        # Protect cleanup from a second signal
        with manager.protect_section():
            await asyncio.sleep(0.1)  # stand-in for real cleanup


asyncio.run(main())
```

### DelayedKeyboardInterrupt

Context manager that delays SIGINT and SIGTERM handling. Use it to protect critical sections: the signal is recorded, and the original handler runs when the context exits. It installs handlers with `signal.signal`, so use it from the main thread only, and keep protected sections short.

Example:

```python
from tenxgraph.utils import DelayedKeyboardInterrupt

with DelayedKeyboardInterrupt():
    # Critical section, for example writing a file in two steps
    print("writing")
# If SIGINT/SIGTERM was received, it is handled here
```

### delayed_keyboard_interrupt()

Functional form of `DelayedKeyboardInterrupt`, built with `contextlib.contextmanager`. It takes no arguments and yields the `DelayedKeyboardInterrupt` instance.

Example:

```python
from tenxgraph.utils import delayed_keyboard_interrupt

with delayed_keyboard_interrupt():
    # Critical section
    print("writing")
```

### setup_exception_handler(loop)

Install an exception handler on the event loop that suppresses benign errors raised during shutdown (`ConnectionResetError`, and `OSError` with the Windows invalid-handle code). Any other exception is logged as an error with its traceback.

| Parameter | Type | Description |
|---|---|---|
| `loop` | `asyncio.AbstractEventLoop` | The asyncio event loop. |

Example:

```python
import asyncio
from tenxgraph.utils import setup_exception_handler

async def main():
    setup_exception_handler(asyncio.get_running_loop())
    await asyncio.sleep(0.1)


asyncio.run(main())
```

### shutdown_with_timeout(coro_or_task, timeout, task_name)

Await a coroutine, task, or future for at most `timeout` seconds. A coroutine is wrapped in a task. On timeout the task is cancelled. The function never raises for these outcomes: it reports them in the returned dict.

| Parameter | Type | Description |
|---|---|---|
| `coro_or_task` | Coroutine, Task, or Future | Required. The awaitable to wait for. |
| `timeout` | `float` | Required. Maximum time to wait in seconds. |
| `task_name` | `str` | `"task"`. Name used in log messages. |

Returns: `dict[str, Any]` with `status` (`"completed"`, `"timeout"` or `"error"`) and `duration` in seconds. The `"error"` result also has an `error` string.

Example:

```python
import asyncio
from tenxgraph.utils import shutdown_with_timeout

async def cleanup():
    await asyncio.sleep(0.5)


async def main():
    result = await shutdown_with_timeout(cleanup(), timeout=10.0, task_name="cleanup")
    print(result)  # for example {'status': 'completed', 'duration': 0.5}


asyncio.run(main())
```

### install_shutdown_signals(graph, ...)

Connect SIGTERM and SIGINT to `graph.aclose()` on the running event loop. It is opt-in: 10xGraph never installs signal handlers by itself.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `graph` | `CompiledGraph` | Required | The graph to close. |
| `loop` | `asyncio.AbstractEventLoop \| None` | `None` | The running loop. `None` uses the running loop. |
| `signals` | `tuple[int, ...]` | `(SIGTERM, SIGINT)` | Signals to handle. |
| `grace` | `float \| None` | `None` | Passed to `aclose()`. |
| `stop_timeout` | `float \| None` | `None` | Passed to `aclose()`. |
| `timeout` | `float \| None` | `None` | Passed to `aclose()`. |

Returns a `SignalShutdown` with `uninstall()` to remove the handlers, `wait()` to await the stats dict of the close that a signal started (`None` if none ran), and the `close_task` attribute (`None` until a signal arrives).

Call it once, from the main thread, inside the running loop. From another thread it raises `RuntimeError`. It is not available on Windows event loops (the signal is skipped and a log line is written). It replaces the default Ctrl+C behavior while installed. The first signal starts `aclose()`; later signals are ignored. A server that already handles SIGTERM, such as Uvicorn or Gunicorn, should call `graph.aclose()` from its shutdown hook instead.

Example:

```python
from tenxgraph.utils import install_shutdown_signals

async def main():
    graph = build_graph().compile(checkpointer=checkpointer, shutdown_timeout=30)
    shutdown = install_shutdown_signals(graph)
    try:
        await serve(graph)
    finally:
        shutdown.uninstall()
```

## Logging and secret redaction

Redact credentials from log output. Redaction is heuristic, so treat it as a safety net and avoid logging secrets in the first place.

### mask_secrets(text)

Redact common credential formats from a string. Masks OpenAI/Google/GitHub/Slack/AWS keys, `Bearer` tokens, `key=value` secrets, and signed-URL credential query parameters.

| Parameter | Type | Description |
|---|---|---|
| `text` | `str` | The string to redact. |

Returns: `str` with secrets replaced by `***REDACTED***`. Empty input is returned unchanged. The `Bearer` scheme and `key=value` names are kept; only the value is replaced.

Example:

```python
from tenxgraph.utils import mask_secrets

text = "Authorization: Bearer sk-proj-abc123xyz"
masked = mask_secrets(text)
print(masked)  # "Authorization: Bearer ***REDACTED***"
```

### SecretRedactionFilter

`logging.Filter` subclass that redacts secrets from a record's formatted message and always lets the record through. Add it to a handler to cover every logger that propagates to that handler. Adding it to a logger only covers records emitted directly on that logger, not its children.

Example:

```python
import logging
from tenxgraph.utils import SecretRedactionFilter

handler = logging.StreamHandler()
handler.addFilter(SecretRedactionFilter())
logger = logging.getLogger("myapp")
logger.setLevel(logging.INFO)
logger.addHandler(handler)

logger.info("Token: sk-1234567890abcdef")  # Token: ***REDACTED***
```

### install_secret_redaction(logger_name)

Attach one `SecretRedactionFilter` to a logger and to each handler that logger has at call time. Call it after configuring handlers. For child loggers, add the filter to your handlers directly.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `logger_name` | `str` | `"tenxgraph"` | Name of the logger to configure. |

Returns: `SecretRedactionFilter` instance.

Example:

```python
import logging
from tenxgraph.utils import install_secret_redaction

# Configure your logging first
logging.basicConfig(level=logging.INFO)

# Install redaction on the root logger and its handlers
install_secret_redaction("")
logging.getLogger("myapp").info("password=hunter2hunter2")  # password=***REDACTED***
```

## Async and sync calling

Helpers for crossing the sync and async boundary. `call_sync_or_async` is for code already inside an event loop, and `run_coroutine` is for plain synchronous code.

### call_sync_or_async(func, *args, **kwargs)

Call a function that may be sync or async and return its result. Async functions are awaited directly. Sync functions run in a worker thread through `asyncio.to_thread`, so they do not block the event loop, and an awaitable result is awaited before it is returned. This is an `async def`, so you must `await` it.

| Parameter | Type | Description |
|---|---|---|
| `func` | `Callable` | The function to call (sync or async). |
| `*args` | | Positional arguments for the function. |
| `**kwargs` | | Keyword arguments for the function. |

Returns: The result of the function call.

Example:

```python
import asyncio
from tenxgraph.utils import call_sync_or_async

def sync_work(x: int) -> int:
    return x * 2

async def async_work(x: int) -> int:
    await asyncio.sleep(0.1)
    return x * 3

async def main():
    a = await call_sync_or_async(sync_work, 5)
    b = await call_sync_or_async(async_work, 5)
    print(a, b)  # 10 15

asyncio.run(main())
```

### run_coroutine(func)

Run a coroutine from synchronous code and return its result. With no running loop it uses `asyncio.run()`. If a loop is already running in this thread it uses `asyncio.run_coroutine_threadsafe()` and blocks on the result, which deadlocks when called from the loop's own thread, so call it from a different thread or a plain script.

| Parameter | Type | Description |
|---|---|---|
| `func` | `Coroutine` | The coroutine to run. |

Returns: The result of the coroutine.

Example:

```python
import asyncio
from tenxgraph.utils import run_coroutine

async def async_task():
    await asyncio.sleep(0.1)
    return "done"

result = run_coroutine(async_task())
print(result)  # "done"
```

## Message conversion

Build the list of message dicts you send to an LLM from system prompts, the state's context, and any extra messages.

### convert_messages(system_prompts, state, extra_messages)

Convert system prompts, agent state, and extra messages into one list of dicts. The order is: system prompts, then `state.context_summary` (as an `assistant` message) if set, then each message in `state.context`, then `extra_messages`. System prompt strings may use `{field}` placeholders, filled from `state.model_dump()`. If a placeholder names a field the state lacks, the original prompt is used and a warning is logged. Messages with multimodal content get OpenAI-style content parts.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `system_prompts` | `list[dict[str, Any]]` | Required | List of system prompt dicts with `role` and `content`. |
| `state` | `AgentState \| None` | `None` | Agent state containing context and summary. |
| `extra_messages` | `list[Message] \| None` | `None` | Extra messages to include. |

Returns: `list[dict[str, Any]]` of message dicts ready for an LLM API.

Raises: `ValueError` if `system_prompts` is `None`.

Example:

```python
from tenxgraph.core.state import AgentState, Message
from tenxgraph.utils import convert_messages

state = AgentState(context=[Message.text_message("Hello")])
messages = convert_messages(
    system_prompts=[{"role": "system", "content": "You are helpful."}],
    state=state,
)
print(len(messages))  # 2 (system prompt + the context message)
```

## Tool metadata

Read back the metadata that the `@tool` decorator attaches to a function. Both helpers are importable from `tenxgraph.utils`, as is `tool` itself.

### get_tool_metadata(func)

Return the tool metadata stored on a function as a dict. It works on any callable: an undecorated function yields `None` values and an empty `tags` set.

| Parameter | Type | Description |
|---|---|---|
| `func` | `Callable` | A function that may have been decorated with `@tool`. |

Returns: `dict` with keys `name`, `description`, `tags`, `provider`, `capabilities`, `metadata` and `parameters`. `tags` is a `set` (empty when unset). The other values are `None` when unset.

Example:

```python
from tenxgraph.utils import tool, get_tool_metadata

@tool(name="calculator", tags=["math"])
def add(a: int, b: int) -> int:
    """Add two numbers."""
    return a + b

metadata = get_tool_metadata(add)
print(metadata["name"])      # "calculator"
print(metadata["tags"])      # {'math'}
print(metadata["description"])  # Add two numbers.
```

### has_tool_decorator(func)

Return whether a function carries `@tool` metadata. Use it to separate decorated tools from plain callables.

| Parameter | Type | Description |
|---|---|---|
| `func` | `Callable` | The function to check. |

Returns: `bool`.

Example:

```python
from tenxgraph.utils import tool, has_tool_decorator

@tool
def decorated():
    """A tool."""
    pass

def not_decorated():
    pass

print(has_tool_decorator(decorated))      # True
print(has_tool_decorator(not_decorated))  # False
```

## Metrics instrumentation

An in-process metrics registry with no required dependencies. Counters and timers live in a thread-safe module-level registry and can be exported through OpenTelemetry when you call `setup_otel_metrics`. These functions live in `tenxgraph.utils.metrics`, not `tenxgraph.utils`.

### counter(name)

Get or create the counter registered under `name`. Repeated calls with the same name return the same object. Increment it with `.inc(amount=1, attributes=None)`; `attributes` are used only for OpenTelemetry export.

| Parameter | Type | Description |
|---|---|---|
| `name` | `str` | Unique name for the counter (e.g., `"requests_total"`). |

Returns: `Counter` instance.

Example:

```python
from tenxgraph.utils.metrics import counter

requests = counter("requests_total")
requests.inc()
requests.inc(5, attributes={"endpoint": "/api"})
```

### timer(name, attributes)

Return a context manager that times a block in milliseconds. Attributes become OpenTelemetry histogram dimensions, and an `outcome` attribute (`"ok"` or `"error"`) is added automatically. Exceptions raised in the block are not suppressed.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `name` | `str` | Required | Unique name for the timer (e.g., `"db_query_ms"`). |
| `attributes` | `dict[str, Any] \| None` | `None` | OTEL histogram dimensions. |

Returns: Context manager.

Example:

```python
from tenxgraph.utils.metrics import timer

with timer("db_query_ms", attributes={"table": "users"}):
    total = sum(range(1000))  # stand-in for a real query
```

### setup_otel_metrics(meter)

Bridge the registry to OpenTelemetry. Call it once at startup to export counters and timers through your configured MeterProvider. Install the `otel` extra to get OpenTelemetry.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `meter` | `Any` | `None` | An OTEL Meter. If `None`, one named `10xgraph` is obtained from the global MeterProvider. |

Returns: `bool`. `True` if the bridge was installed; `False` if OpenTelemetry is not installed.

Example:

```python
from tenxgraph.utils.metrics import counter, timer, setup_otel_metrics

# Enable OTEL export (returns False if OpenTelemetry is not installed)
installed = setup_otel_metrics()

# All counter/timer calls now export
counter("events_total").inc()
with timer("latency_ms"):
    total = sum(range(1000))  # stand-in for real work
```

### snapshot()

Return a thread-safe copy of every registered metric.

Returns: `dict` with `counters` (name to integer value) and `timers` (name to a dict with `count`, `avg_ms` and `max_ms`).

Example:

```python
from tenxgraph.utils.metrics import counter, snapshot

counter("total").inc(10)
print(snapshot())
# {'counters': {'total': 10}, 'timers': {}}
```

## Import paths

All utilities are exported from `tenxgraph.utils`:

```python
from tenxgraph.utils import (
    # Shutdown
    GracefulShutdownManager,
    DelayedKeyboardInterrupt,
    delayed_keyboard_interrupt,
    setup_exception_handler,
    shutdown_with_timeout,
    # Logging
    SecretRedactionFilter,
    install_secret_redaction,
    mask_secrets,
    # Async/sync
    call_sync_or_async,
    run_coroutine,
    # Messages
    convert_messages,
    # Tool metadata
    get_tool_metadata,
    has_tool_decorator,
)
from tenxgraph.utils.metrics import (
    counter,
    timer,
    setup_otel_metrics,
    snapshot,
)
```
