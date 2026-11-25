---
title: Send AI traces
description: Send 10xGraph graph, node, LLM and tool spans to an OTLP endpoint, Arize Phoenix, Pydantic Logfire or LangSmith, from Python or the API server.
section: "Observability"
group: "Tracing"
order: 30
label: AI tracing
updated: "2026-11-26"
---

10xGraph turns graph, node, LLM and tool events into OpenTelemetry spans. A tracing publisher sends them to one backend: `OtelPublisher` to any OTLP HTTP receiver (an OpenTelemetry Collector, Tempo, Jaeger, Grafana Cloud), `PhoenixPublisher` to Arize Phoenix, `LogfirePublisher` to Pydantic Logfire and `LangsmithPublisher` to LangSmith. The last three add the keys their backend reads; a plain `OtelPublisher` writes only `gen_ai.*` and `tenxgraph.*` attributes.

Tracing publishers receive AI spans only, not task lifecycle events or API errors. See [Publishers, AI tracing and metrics](/docs/concepts/events-and-observability#publishers-ai-tracing-and-metrics). For request and task metrics, see [Metrics with Prometheus and Grafana](/docs/guides/metrics-prometheus-grafana).

## Install

```bash
pip install '10xgraph[otlp]'           # any OTLP endpoint
pip install '10xgraph[phoenix]'        # Arize Phoenix
pip install '10xgraph[logfire]'        # Logfire
pip install '10xgraph[langsmith]'      # LangSmith
pip install '10xgraph[observability]'  # all of the above
```

The `phoenix`, `langsmith` and `otlp` extras install the OpenTelemetry SDK and the OTLP HTTP exporter, not the vendor SDKs. The `logfire` extra installs the Logfire SDK.

## Choose what the spans carry

Every tracing publisher takes `level` and `user_id_mode`, and so does the `observability` block of `10xgraph.json`.

`level` is `FULL` by default: prompts, completions, tool input and output and the system prompt reach the backend. `STANDARD` keeps token counts, model and request parameters; with `PhoenixPublisher` it also puts the graph state on node spans, which can contain the conversation. `SPANS` records structure and timing only. Log redaction (`install_secret_redaction()`) does not scrub spans. See [Observability levels](/docs/concepts/events-and-observability#observability-levels).

### Hide the user id in traces

Spans carry `user_id`, `thread_id` and `run_id`. `user_id_mode` changes how the user id appears:

| Mode | What the span carries |
|---|---|
| `raw` (default) | The id, unchanged. |
| `hash` | First 16 hex characters of SHA-256 of the id, so one user's spans still group together. With `TENXGRAPH_TRACE_USER_ID_KEY` set, HMAC-SHA256 with that key, which cannot be reversed by guessing short ids. |
| `mask` | Ids of 4 characters or fewer: `***`. 5 to 7 characters: `a***e`. 8 or more: `al***42`. |

An invalid value raises `ValueError`. Redis, RabbitMQ, Kafka and console events keep the raw id.

## Send to an OTLP endpoint

Set up the OpenTelemetry `TracerProvider` and exporter yourself, then pass an `OtelPublisher` to the graph:

```python
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

from tenxgraph.core.graph import Agent, StateGraph
from tenxgraph.runtime.publisher import ObservabilityLevel, OtelPublisher
from tenxgraph.utils import END

provider = TracerProvider()
provider.add_span_processor(
    BatchSpanProcessor(OTLPSpanExporter(endpoint="http://collector:4318/v1/traces"))
)
trace.set_tracer_provider(provider)

graph = StateGraph(publisher=OtelPublisher(level=ObservabilityLevel.STANDARD))
graph.add_node("MAIN", Agent(model="gpt-4o"))
graph.set_entry_point("MAIN")
graph.add_edge("MAIN", END)
app = graph.compile()
```

The receiver must accept traces; Prometheus takes metrics only. Credentials go in the standard OpenTelemetry variable, not in code or config:

```bash
export OTEL_EXPORTER_OTLP_HEADERS="authorization=Bearer your-token"
```

`OTEL_EXPORTER_OTLP_TRACES_HEADERS` applies to traces only. To add the keys of another backend, subclass `OtelPublisher` and override `span_attributes(role, phase, name, event, attrs)`: it runs once after a span starts and once before it ends, and returns `attrs` with your keys added.

## Send to Arize Phoenix

Run Phoenix locally (the UI is at `http://localhost:6006`, and a local Phoenix needs no key):

```bash
docker run -p 6006:6006 arizephoenix/phoenix:latest
```

Pass `PhoenixPublisher` to the graph:

```python
from tenxgraph.runtime.publisher import ObservabilityLevel, PhoenixPublisher

graph = StateGraph(
    publisher=PhoenixPublisher(project="my-agent", level=ObservabilityLevel.STANDARD)
)
```

It sends to `http://localhost:6006` unless you pass `endpoint` or set `PHOENIX_COLLECTOR_ENDPOINT`, and adds the OpenInference keys Phoenix reads (`session.id` for the thread, `user.id`, and `metadata` with `thread_id` and `run_id`). For Phoenix Cloud, use your space URL and a key:

```bash
export PHOENIX_COLLECTOR_ENDPOINT="https://app.phoenix.arize.com/s/<your-space>"
export PHOENIX_API_KEY="your-phoenix-api-key"
```

The project (`project=`, else `PHOENIX_PROJECT` or `PHOENIX_PROJECT_NAME`) is the resource attribute `openinference.project.name`, set only when 10xGraph creates the `TracerProvider`. If you pass your own `tracer_provider`, set `OTEL_RESOURCE_ATTRIBUTES="openinference.project.name=my-agent"` before that provider is created.

## Send to Logfire

Set `LOGFIRE_TOKEN`, then pass `LogfirePublisher`. It calls `logfire.configure(...)`, which installs the global `TracerProvider`; extra keyword arguments go to `logfire.configure()`.

```python
from tenxgraph.runtime.publisher import LogfirePublisher, ObservabilityLevel

graph = StateGraph(
    publisher=LogfirePublisher(service_name="my-agent", level=ObservabilityLevel.STANDARD)
)
```

To check spans locally without sending them, pass `send_to_logfire=False` and `console=logfire.ConsoleOptions()`: the spans print to the console as the graph runs.

## Send to LangSmith

Set `LANGSMITH_API_KEY`, then pass `LangsmithPublisher`. The project is sent as the `Langsmith-Project` header.

```python
from tenxgraph.runtime.publisher import LangsmithPublisher, ObservabilityLevel

graph = StateGraph(
    publisher=LangsmithPublisher(project="my-agent", level=ObservabilityLevel.STANDARD)
)
```

For another region, pass the base OTEL endpoint, for example `endpoint="https://eu.api.smith.langchain.com/otel"`; `/v1/traces` is appended.

All constructor arguments are in the [publishers reference](/docs/reference/python/publishers#otelpublisher).

## Send traces from the API server

On the server you do not create a publisher. Add an `observability` block to `10xgraph.json` with any mix of backends:

```json
{
  "observability": {
    "level": "standard",
    "user_id_mode": "hash",
    "otlp": { "enabled": true, "endpoint": "http://collector:4318" },
    "phoenix": { "enabled": true, "project": "my-agent" },
    "logfire": { "enabled": true, "service_name": "my-agent", "console": false },
    "langsmith": { "enabled": true, "project": "my-agent" }
  }
}
```

- The enabled backends share one `TracerProvider`, and each span is created once with the keys of every enabled backend.
- `level` defaults to `"full"`. If the graph already has a tracing publisher, the server reuses it, logs a warning and ignores the whole block, `level` included.
- Keep `LOGFIRE_TOKEN`, `LANGSMITH_API_KEY`, `PHOENIX_API_KEY` and OTLP headers in `.env`, never in `10xgraph.json`. A backend whose package or key is missing is skipped with a warning; the server still starts.
- `otlp.endpoint` `null` needs `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`. With an endpoint that takes traces and metrics (an OpenTelemetry Collector, Grafana Alloy), set `"use_metrics_endpoint": true` instead of an endpoint to reuse `metrics.otlp.endpoint`; it needs `metrics` enabled with `"export": "otlp"`.
- With Logfire enabled, the Phoenix project reaches Logfire's provider only on logfire 5 or newer; on older versions set `OTEL_RESOURCE_ATTRIBUTES` as above.
- HTTP request spans do not go to these backends (only the legacy `OTEL_ENABLED` path sends them). HTTP timing is in the metrics.

The same settings are on the Observability page of the `10xgraph config` editor. All keys are in the [configuration reference](/docs/reference/api-cli/configuration#observability).

## Several backends from Python

`StateGraph(publisher=[PhoenixPublisher(...), LogfirePublisher(...)])` works, but each tracing publisher builds its own span, once per backend. For several tracing backends, prefer the server's `observability` block. A list is the right tool to pair one tracing publisher with event publishers:

```python
from tenxgraph.runtime.publisher import ConsolePublisher, PhoenixPublisher

graph = StateGraph(publisher=[PhoenixPublisher(project="my-agent"), ConsolePublisher()])
```

## Troubleshooting

**Nothing arrives.** Check that the endpoint is reachable and that the publisher was passed to `StateGraph(publisher=...)`. Spans are exported in batches, so allow a few seconds and let the process exit cleanly. A backend that is down logs one `tenxgraph.trace_export` warning naming the endpoint.

**401 or 403.** The key or token is missing or wrong: `PHOENIX_API_KEY` (Phoenix Cloud only), `LOGFIRE_TOKEN`, `LANGSMITH_API_KEY`, or `OTEL_EXPORTER_OTLP_HEADERS` for OTLP.

**`ImportError`.** Install the extra for that backend from [Install](#install).

**`ValueError: A LangSmith API key is required`.** Set `LANGSMITH_API_KEY` or pass `api_key=`.

**Server log "Observability setup skipped".** An enabled backend has no endpoint or key; the message names it.
