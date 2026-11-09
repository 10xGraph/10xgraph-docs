---
title: Send traces to an OTLP endpoint
description: Send 10xGraph spans to any OTLP HTTP trace receiver, such as a collector, Tempo, Jaeger or Grafana Cloud.
section: "Build agents"
group: "Observability and operations"
order: 402
label: OTLP tracing
updated: "2026-11-09"
---

If your tracing backend speaks OTLP over HTTP, you do not need a vendor-specific destination. 10xGraph sends its spans (graph execution, node transitions, LLM calls, token usage, tool execution) to any OTLP HTTP trace receiver: an OpenTelemetry Collector, Grafana Tempo, Jaeger, Grafana Cloud and others.

The receiver must accept traces. Prometheus does not: it takes metrics only. For metrics, see [Metrics with Prometheus and Grafana](/docs/guides/metrics-prometheus-grafana).

The observability levels and `user_id_mode` options in [Send traces to Logfire and LangSmith](/docs/guides/send-traces-to-logfire-langsmith) apply here too.

An OTLP destination is an observability publisher. It receives graph, node, LLM and tool spans, AI errors included. It does not receive task lifecycle events or API and worker errors: those are in metrics and logs. See [Publishers, AI tracing and metrics](/docs/concepts/events-and-observability#publishers-ai-tracing-and-metrics).

## Install

```bash
pip install '10xgraph[otlp]'
```

The `otlp` extra installs the OpenTelemetry API, the SDK and the OTLP HTTP exporter. `10xgraph[observability]` includes it.

## Use the helper

Call `setup_otlp()` **before** `graph.compile()`:

```python
from tenxgraph.core.graph import StateGraph, Agent
from tenxgraph.runtime.publisher import setup_otlp, ObservabilityLevel
from tenxgraph.utils import END

graph = StateGraph()
graph.add_node("MAIN", Agent(model="gpt-4o"))
graph.set_entry_point("MAIN")
graph.add_edge("MAIN", END)

setup_otlp(graph, endpoint="http://collector:4318", level=ObservabilityLevel.STANDARD)

app = graph.compile()
```

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `graph` | StateGraph or None | `None` | Graph to instrument. `None` configures the provider only (API server use). |
| `endpoint` | str | `None` | OTLP HTTP base URL. `/v1/traces` is appended unless present. When omitted, `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` must be set. |
| `level` | ObservabilityLevel | `STANDARD` | `SPANS`, `STANDARD` or `FULL`. `FULL` records prompts and completions. |
| `tracer_provider` | TracerProvider | None | Attach to your own provider instead of creating one. |
| `user_id_mode` | str | `"raw"` | `"raw"`, `"hash"` or `"mask"`. |

`setup_otlp()` raises `ValueError` when it has no endpoint and `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` is unset. `OTEL_EXPORTER_OTLP_ENDPOINT` is not used as a fallback, because it often points at a gRPC port (4317), which this HTTP exporter cannot use.

## Authentication headers

Headers are not a function argument and not a config key. Set the standard OpenTelemetry variable:

```bash
export OTEL_EXPORTER_OTLP_HEADERS="authorization=Bearer your-token"
```

`OTEL_EXPORTER_OTLP_TRACES_HEADERS` also works and applies to traces only.

## Configure the API server

In `10xgraph.json`:

```json
{
  "observability": {
    "level": "standard",
    "otlp": {
      "enabled": true,
      "endpoint": "http://collector:4318"
    }
  }
}
```

| Key | Type | Default | Purpose |
|---|---|---|---|
| `observability.otlp.enabled` | boolean | `false` | Turn the destination on |
| `observability.otlp.endpoint` | string or null | `null` | OTLP HTTP base URL. With `null`, `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` must be set |
| `observability.otlp.use_metrics_endpoint` | boolean | `false` | Send traces to the same base URL as the metrics (`metrics.otlp.endpoint`, else `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` or `OTEL_EXPORTER_OTLP_ENDPOINT`) |

If the exporter package is missing or no endpoint is set, the server logs a warning ("Observability setup skipped") and starts without AI tracing. Put tokens in `.env`, never in the config file. See [configuration](/docs/reference/api-cli/configuration) for all keys.

### Share the endpoint with metrics

When one endpoint takes both signals, such as an OpenTelemetry Collector, Grafana Alloy or Grafana Cloud, set `use_metrics_endpoint` to `true` instead of repeating the URL:

```json
{
  "observability": { "otlp": { "enabled": true, "use_metrics_endpoint": true } },
  "metrics": { "enabled": true, "export": "otlp", "otlp": { "endpoint": "http://collector:4318" } }
}
```

This needs `metrics.enabled` with `export` set to `otlp` and `metrics.otlp.endpoint` set. Without them the server logs a warning and turns the OTLP trace destination off. If the shared URL contains `/api/v1/otlp` (a Prometheus OTLP receiver), the server logs a warning that trace exports will fail, because Prometheus accepts metrics only.

## HTTP requests are not AI traces

AI tracing carries graph, node, LLM and tool spans only. Spans for HTTP requests never go to the OTLP destination or to any other AI tracing destination: the server turns FastAPI's own telemetry off. With the API and the worker both pointed at one collector, only graph and node spans arrive from either. HTTP timing is available as metrics instead. See [Metrics with Prometheus and Grafana](/docs/guides/metrics-prometheus-grafana).

## Combine with other destinations

`logfire`, `langsmith`, `phoenix` and `otlp` in the `observability` block share one `TracerProvider`. In code, use `setup_observability(graph, {...})` with an `"otlp"` entry.

## Troubleshooting

**Nothing arrives.** Check the endpoint is reachable and accepts traces on `/v1/traces`. Spans are exported in batches, so allow a few seconds and let the process exit cleanly.

**401 or 403.** Set `OTEL_EXPORTER_OTLP_HEADERS` with the credentials your backend expects.

**ValueError: OTLP tracing needs an endpoint.** Pass `endpoint=` or set `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`.

**ImportError for opentelemetry-exporter-otlp-proto-http.** Run `pip install '10xgraph[otlp]'`.
