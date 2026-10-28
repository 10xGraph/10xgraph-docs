---
title: Observability
description: "Set up structured logging, metrics collection, error tracking with Sentry, and inspect runs via the observability API."
section: "API server"
group: "Operate"
order: 140
label: Observability
updated: "2026-10-27"
---

10xGraph provides multiple observability surfaces to monitor agent execution, debug issues, and track performance in production. Logs and metrics are built in; Sentry integration and tracing are optional. This page covers logs, metrics, secret redaction, Sentry setup, and the REST API endpoint to inspect run traces. For per-node spans in Logfire or LangSmith, see the link at the end.

Logs and metrics are independent of each other and of tracing: you can enable any combination, and a failure in one does not affect the others.

## Structured logging

The library never configures logging by default, so nothing changes until you opt in. Call `setup_structured_logging()` once at startup before the graph handles its first request.

```python
import logging
from tenxgraph.utils.logging import setup_structured_logging

setup_structured_logging(
    level=logging.INFO,
    json_format=True,
    redact_secrets=True,
    logger_name="tenxgraph",
)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `level` | `int` | `logging.INFO` | Minimum level for both the logger and handler. |
| `json_format` | `bool` | `True` | Emit JSON objects, one per line. If `False`, emits plain text with the same correlation fields. |
| `redact_secrets` | `bool` | `True` | Install the secret redaction filter on the handler to mask credentials. |
| `logger_name` | `str` | `"tenxgraph"` | Name of the logger to configure. |

The function returns the installed `logging.Handler` so you can attach custom filters or swap the output stream.

### Correlation fields

Every log record includes four optional fields that correlate logs to execution context:

```json
{
  "timestamp": "2026-10-08 14:33:02,421",
  "level": "INFO",
  "logger": "tenxgraph.agent",
  "message": "Node 'respond' completed",
  "run_id": "run_01ARZ3NDEKTSV4RRFFQ69G5FAV",
  "thread_id": "thread-42",
  "user_id": "user-alice",
  "node": "respond"
}
```

The correlation fields (`run_id`, `thread_id`, `user_id`, `node`) make logs queryable by filtering rather than grepping. They are only included when in scope. The 10xGraph execution loop binds them automatically at the start of each run and when entering a node.

To log from outside a graph run, bind the fields manually:

```python
from tenxgraph.utils.logging import set_log_context, get_log_context

set_log_context(run_id="my_run", thread_id="my_thread", user_id="alice")
# or set individual fields:
set_log_context(node="background_worker")

get_log_context()  # -> {"run_id": "my_run", "thread_id": "my_thread", "user_id": "alice"}
```

Context variables are per-async-context, so concurrent requests do not leak fields.

### Adding custom data to logs

Pass extra fields through the `extra` dict:

```python
import logging
logger = logging.getLogger("tenxgraph")

logger.info("Processed order", extra={"order_id": "ORD-123", "amount_cents": 4900})
```

The fields are merged into the same JSON object, provided they are JSON-serializable. Exceptions logged with `exc_info=True` appear under an `exception` key.

### Secret redaction

`SecretRedactionFilter` scrubs credentials from log messages. It masks OpenAI, Google, GitHub, Slack, and AWS key formats, `Bearer` tokens, `key=value` patterns, and credential query parameters in signed URLs.

Install it on a handler, not a logger. Logger-level filters only see records emitted directly on that logger, missing all child loggers:

```python
from tenxgraph.utils.logging import SecretRedactionFilter, install_secret_redaction, mask_secrets

handler.addFilter(SecretRedactionFilter())   # covers all child loggers
install_secret_redaction("tenxgraph")        # convenience wrapper
mask_secrets(some_string)                    # redact an arbitrary string
```

`setup_structured_logging(redact_secrets=True)` already installs the filter on the handler.

This is a heuristic and best-effort. It will not catch every possible secret and can over-redact. Do not rely on it alone; always avoid logging sensitive values.

## Metrics

The `tenxgraph.utils.metrics` module is a zero-dependency, thread-safe in-process metrics registry. The 10xGraph framework automatically instruments node executions, tool calls, background tasks, and checkpointer operations.

```python
from tenxgraph.utils.metrics import counter, timer, snapshot

counter("orders.processed").inc()
counter("orders.processed").inc(5, attributes={"channel": "web"})

with timer("database.write"):
    await db.save()
```

| Callable | Returns / Type | Description |
|---|---|---|
| `counter(name)` | `Counter` | Get or create a named counter. Call `.inc(amount=1, attributes=None)` to increment. |
| `timer(name, attributes=None)` | context manager | Records elapsed milliseconds of a code block with `outcome` (ok/error) attribute. |
| `snapshot()` | `dict` | Thread-safe point-in-time copy of all counters and timers. |
| `enable_metrics(value)` | - | Global on/off switch; calls return immediately when disabled. |
| `setup_otel_metrics(meter=None)` | `bool` | Bridge the registry to OpenTelemetry for export. |

`Counter` has an `inc(amount, attributes)` method and a `value` property. `TimerMetric` has `observe(duration_ms, attributes)` and read-only properties: `count`, `total_ms`, `max_ms`, `avg_ms`.

Timers automatically tag observations with an `outcome` of `"ok"` or `"error"` when exceptions occur. This separation is critical: a p99 latency mixing success and failure is not actionable.

### Reading metrics locally

```python
from tenxgraph.utils.metrics import snapshot

snapshot()
# {
#   "counters": {"tenxgraph.node.executions": 128, "tenxgraph.tool.errors": 2},
#   "timers": {
#     "tenxgraph.node.duration": {"count": 128, "avg_ms": 412.7, "max_ms": 2891.0}
#   }
# }
```

This is sufficient for a debug `/metrics` endpoint or a health check. Metrics are process-local and are not persisted or aggregated across replicas.

### Exporting to OpenTelemetry

Install the OTEL extra:

```bash
pip install "10xgraph-api[otel]"
```

Call `setup_otel_metrics()` once at startup, after your application has configured an OTEL `MeterProvider` with an exporter:

```python
from tenxgraph.utils.metrics import setup_otel_metrics

setup_otel_metrics()  # meter named "10xgraph" is taken from the global MeterProvider
# or use a specific meter:
setup_otel_metrics(meter=my_meter)
```

From that point on, every call to `counter()` and `timer()` automatically exports: counters become OTEL counters, timers become histograms with unit `ms`, and attributes become dimensions.

`setup_otel_metrics()` returns `False` and logs a warning if OpenTelemetry is not installed. The in-process registry keeps working, so it is safe to call unconditionally.

### Framework-instrumented metrics

The 10xGraph framework automatically records these:

The `tool` attribute is the tool name only when the node can run that tool. A name the model made up is recorded as `"unknown"`, so unknown names cannot create new series.

| Metric | Type | Attributes |
|---|---|---|
| `tenxgraph.node.executions` | counter | `node` |
| `tenxgraph.node.errors` | counter | `node` |
| `tenxgraph.node.timeouts` | counter | `node` |
| `tenxgraph.node.stopped` | counter | `node` |
| `tenxgraph.node.duration` | timer | `node`, `outcome` |
| `tenxgraph.tool.calls` | counter | `node`, `tool` |
| `tenxgraph.tool.errors` | counter | `node`, `tool` |
| `tenxgraph.tool.timeouts` | counter | `node`, `tool` |
| `tenxgraph.tool.duration` | timer | `node`, `tool`, `outcome` |
| `background_task_manager.tasks_created` | counter | - |
| `background_task_manager.tasks_completed` | counter | - |
| `background_task_manager.tasks_failed` | counter | - |
| `background_task_manager.tasks_dropped` | counter | - |
| `background_task_manager.tasks_cancelled` | counter | - |
| `background_task_manager.tasks_timed_out` | counter | - |
| `pg_checkpointer.save_state.attempts` | counter | - |
| `pg_checkpointer.save_state.success` | counter | - |
| `pg_checkpointer.save_state.error` | counter | - |
| `pg_checkpointer.save_state.conflict` | counter | - |
| `pg_checkpointer.save_state.duration` | timer | - |
| `pg_checkpointer.save_checkpoint.attempts` | counter | - |
| `pg_checkpointer.save_checkpoint.success` | counter | - |
| `pg_checkpointer.save_checkpoint.error` | counter | - |
| `pg_checkpointer.save_checkpoint.conflict` | counter | - |
| `pg_checkpointer.save_checkpoint.duration` | timer | - |

`pg_checkpointer.save_state.conflict` counts optimistic-concurrency rejections. `background_task_manager.tasks_dropped` counts events shed under backpressure. Both are good alert candidates: a rising trend indicates concurrent writers contending for state, or a publisher unable to keep up.

Observability failures are logged at debug level and never propagate to the caller: a misconfigured exporter does not crash the API.

## Error tracking with Sentry

The API server supports Sentry for error tracking and performance monitoring. Install the optional extra:

```bash
pip install "10xgraph-api[sentry]"
```

Configure Sentry via environment variables:

| Variable | Default | Description |
|---|---|---|
| `SENTRY_DSN` | (none) | Sentry DSN. When unset or empty, Sentry is disabled. |
| `SENTRY_TRACES_SAMPLE_RATE` | 0.1 | Share of requests to trace (0.0 to 1.0). Higher rates incur tracing costs. |
| `SENTRY_PROFILES_SAMPLE_RATE` | 0.0 | Share of traces to profile (0.0 to 1.0). Profiling is expensive; 0.0 disables it. |

Example `.env` file:

```bash
SENTRY_DSN="https://key@sentry.io/project-id"
SENTRY_TRACES_SAMPLE_RATE=0.1
SENTRY_PROFILES_SAMPLE_RATE=0.01
```

Sentry is only initialized when `MODE` (default `development`) is `production`, `staging` or `development`, case-insensitive. When the API starts, Sentry initialization is best-effort: if the SDK is not installed or DSN is invalid, a warning is logged and the server continues. Only HTTP 5xx status codes are reported to Sentry; client errors (4xx) are not, preventing floods of validation error events.

## The observability API endpoint

The `/v1/observability/{thread_id}` endpoint reconstructs a trace for a thread from captured run events. This lets you inspect execution flow, token usage, and timing without a separate tracing backend.

Query the latest run in a thread:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/v1/observability/thread-42
```

Or request a specific run:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8000/v1/observability/thread-42?run_id=run_01ARZ3NDEKTSV4RRFFQ69G5FAV"
```

The response is wrapped in the standard envelope; `data` holds the thread's run list and the selected run's trace:

```json
{
  "data": {
    "thread_id": "thread-42",
    "run_count": 3,
    "run_ids": ["run_a", "run_b", "run_c"],
    "run": {
      "run_id": "run_c",
      "thread_id": "thread-42",
      "status": "done",
      "started_at": 1791469982.421,
      "finished_at": 1791469983.944,
      "duration_ms": 1523.0,
      "spans": [
        {
          "id": "s1",
          "name": "node: agent",
          "kind": "node",
          "parent": "root",
          "start_ms": 0.0,
          "duration_ms": 1420.0,
          "model": null,
          "input_tokens": null,
          "output_tokens": null
        }
      ],
      "events": [
        {
          "id": "e1",
          "type": "message",
          "node": "agent",
          "offset_ms": 1400.0,
          "summary": "assistant message"
        }
      ],
      "usage": {
        "prompt_tokens": 250,
        "completion_tokens": 89,
        "reasoning_tokens": 0,
        "total_tokens": 339
      },
      "llm_calls": 1,
      "tool_calls": 0,
      "iterations": 1
    }
  },
  "metadata": {}
}
```

`status` is one of `running`, `done`, `error` or `stopped`. Span `kind` is `root`, `node`, `llm` or `tool`. Event `type` is `message`, `updates`, `state`, `error` or `result`.

The traces come from an in-memory, process-local store that the server binds only outside production. With `MODE=production`, which the generated Docker files set, the store is disabled and the endpoint returns an empty result (`run_count` 0, `run` null); use OTEL or a publisher there. When enabled, it keeps at most 200 threads, 20 runs per thread and 2000 records per run, and a restart clears it. It is not a durable tracing backend. When no run exists for a thread, `run` is `null` and the endpoint still returns 200. It requires the `graph:read` permission. See [authorization](/docs/server/auth) for how to set up access control.

The TypeScript client wraps this endpoint as `client.observability(threadId, runId?)`.

## Complete setup example

Here is a self-contained example that configures logging, metrics, and Sentry:

```python
import logging
import os

from tenxgraph.utils.logging import setup_structured_logging
from tenxgraph.utils.metrics import setup_otel_metrics

def setup_observability() -> None:
    """Configure all observability surfaces at startup."""
    
    # Structured logging with secret redaction
    setup_structured_logging(
        level=logging.INFO,
        json_format=True,
        redact_secrets=True,
        logger_name="tenxgraph",
    )
    
    # Metrics with optional OTEL export
    setup_otel_metrics()
    
    # Sentry is initialized automatically by the API server
    # (no code needed here; configure via SENTRY_DSN env var)

# Call this at app startup:
setup_observability()
```

The API server does not call these functions for you. Put `setup_observability()` in the module your `10xgraph.json` `agent` key points to, so it runs when the graph is loaded at startup:

```python
import logging

from tenxgraph.utils.logging import setup_structured_logging

setup_structured_logging()
logger = logging.getLogger("tenxgraph")

# ... build your StateGraph here and export the compiled graph as `app`
```

For per-node spans sent to Logfire or LangSmith, see [Send traces to Logfire or LangSmith](/docs/guides/send-traces-to-logfire-langsmith).

## What is in your traces

Spans carry `user_id`, `thread_id` and `run_id`. Set `"observability": {"user_id_mode": "hash"}` (or `"mask"`) in `10xgraph.json` to change how the user id appears. It applies to the server's OTEL publisher, for the `observability` block and for `OTEL_ENABLED`. Prompts and tool I/O appear only at `observability.level` `full`. See [What is in your traces and events](/docs/concepts/events-and-observability#what-is-in-your-traces-and-events).

## Related docs

- [Send traces to Logfire or LangSmith](/docs/guides/send-traces-to-logfire-langsmith)
- [Authentication and authorization](/docs/server/auth)
- [Production checklist](/docs/server/production-checklist)
- [Logging utilities reference](/docs/reference/python/runtime-utilities)
- [Metrics and publishers reference](/docs/reference/python/publishers)
