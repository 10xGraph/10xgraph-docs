---
title: Observability
description: "Set up structured logging, metrics collection, error tracking with Sentry, and inspect runs via the observability API."
section: "Observability"
order: 10
label: Logs and server telemetry
updated: "2026-11-25"
---

The API server writes application logs to stdout with a request id. Metrics are off until you add a `metrics` block to `10xgraph.json`. The audit log, Sentry and tracing are optional.

## Logs

The API server writes its application logs to stdout, with secrets redacted. Each request gets an id, returned in the `X-Request-ID` response header and attached to the log lines of that request.

Set `LOG_FORMAT=json` to write every log line as one JSON object (`ts`, `level`, `logger`, `message`, plus `request_id`, `transport` and `user_id` when known and `exc_info` for an exception). The default is `text`. Use `json` in production so your log pipeline can parse and index the lines. `10xgraph build` sets `LOG_FORMAT=json` in the generated Dockerfile, Compose file and Kubernetes manifest.

```bash
LOG_FORMAT=json
LOG_LEVEL=INFO
```

Ship stdout to storage you retain and protect (Docker or Kubernetes logging, Fluent Bit, Vector, a SIEM). 10xGraph does not store logs. For a record of who accessed or changed which data, turn on the [audit log](/docs/server/audit-log).

To configure logging in your own process (outside the server), see [Logging and secret redaction](/docs/reference/python/runtime-utilities#logging-and-secret-redaction).

## Metrics

When `OTEL_ENABLED=true`, the API and the background worker do this for you: they install a `MeterProvider` that exports to `OTEL_EXPORTER_OTLP_ENDPOINT` (the console when it is unset outside production) and call `setup_otel_metrics()`, so the metrics below, and the task metrics in [background tasks](/docs/server/background-tasks), reach your collector along with the traces. To export metrics to Prometheus or Grafana without the legacy settings, use the `metrics` block instead. See [Metrics with Prometheus and Grafana](/docs/guides/metrics-prometheus-grafana). When the block is enabled, it owns metrics and this path sends traces only.

The in-process metrics API (`counter`, `timer`, `snapshot`, `setup_otel_metrics`) is in [Metrics instrumentation](/docs/reference/python/runtime-utilities#metrics-instrumentation).

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
| `tenxgraph.llm.duration` | timer | `provider`, `model`, `status` |
| `tenxgraph.llm.tokens` | counter | `provider`, `model`, `type` |
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
| `pg_checkpointer.save_state_cache.duration` | timer | - |
| `tenxgraph.publish.duration` | timer | `publisher` |
| `tenxgraph.publish.batches` | counter | `publisher` |
| `tenxgraph.publish.events` | counter | `publisher` |
| `tenxgraph.publish.dropped` | counter | `publisher` |

`pg_checkpointer.save_state.conflict` counts optimistic-concurrency rejections. `background_task_manager.tasks_dropped` counts events shed under backpressure.

`tenxgraph.publish.*` come from the Kafka, Redis and RabbitMQ publishers, which batch events. `tenxgraph.publish.dropped` counts events dropped because the publisher queue was full, so a rising value means the broker is slower than your event rate. `tenxgraph.publish.duration` times one batch for those publishers and one send for the others. `pg_checkpointer.save_state_cache.duration` times one state-cache write to Redis.

A trace backend that is down logs once, not once per batch: the `tenxgraph.trace_export` logger writes one WARNING naming the endpoint when exports start failing and one INFO when they recover. Other observability failures are logged at debug level and never propagate to the caller: a misconfigured exporter does not crash the API.

## Error tracking with Sentry

Sentry is optional. Install the extra:

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

When the API starts, Sentry initialization is best-effort: if the SDK is not installed or DSN is invalid, a warning is logged and the server continues. Only HTTP 5xx status codes are reported to Sentry; client errors (4xx) are not, preventing floods of validation error events. The error handlers log a 4xx as one WARNING line (method, path, status, error code) without a traceback, and a 5xx as ERROR with the traceback. Only ERROR logs become Sentry events; warnings and info lines stay breadcrumbs. Request bodies are never sent to Sentry (`max_request_body_size="never"`), nor are local variables or default PII.

## The observability API endpoint

`GET /v1/observability/{thread_id}` rebuilds a run trace for a thread. It backs the playground's Run trace page and records nothing with `MODE=production`.

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

This endpoint is a development tool built for the playground's Run trace page. The traces come from an in-memory, process-local store that the server creates only when `MODE` is not `production`. With `MODE=production`, which the generated Docker files set, the store is never created: nothing is recorded, and the endpoint returns an empty result with `enabled: false` and `reason: "disabled_in_production"`. Other reasons are `store_unavailable` and `no_runs`. Use OTEL, LangSmith, Logfire or another publisher for production tracing. When enabled, it keeps at most 200 threads, 20 runs per thread and 2000 records per run, and a restart clears it. It is not a durable tracing backend. When no run exists for a thread, `run` is `null` and the endpoint still returns 200. It requires the `graph:read` permission, and with auth on the thread is read through the caller's scope, so a user can read traces only for their own threads by default. See [authorization](/docs/server/auth) for how to set up access control.

The TypeScript client wraps this endpoint as `client.observability(threadId, runId?)`.

For spans sent to an OTLP endpoint, Phoenix, Logfire or LangSmith, see [Send AI traces](/docs/guides/send-traces). For Prometheus and Grafana, see [Metrics with Prometheus and Grafana](/docs/guides/metrics-prometheus-grafana).

## What is in your traces

Spans carry `user_id`, `thread_id` and `run_id`. Set `"observability": {"user_id_mode": "hash"}` (or `"mask"`) in `10xgraph.json` to change how the user id appears. It applies to the server's OTEL publisher, for the `observability` block and for `OTEL_ENABLED`. `observability.level` defaults to `full`, which puts prompts, completions, tool I/O and graph state on spans; `standard` keeps graph state but not prompts, completions or tool I/O, and `spans` carries neither. See [What is in your traces and events](/docs/concepts/events-and-observability#what-is-in-your-traces-and-events).

## Related docs

- [Send AI traces](/docs/guides/send-traces)
- [Authentication and authorization](/docs/server/auth)
- [Production checklist](/docs/server/production-checklist)
- [Logging utilities reference](/docs/reference/python/runtime-utilities)
- [Metrics and publishers reference](/docs/reference/python/publishers)
