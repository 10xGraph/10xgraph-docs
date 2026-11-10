---
title: Send traces to Arize Phoenix
description: Send 10xGraph spans to Arize Phoenix over OpenTelemetry using a helper, a publisher, or API server configuration.
section: "Observability"
group: "Tracing"
order: 40
label: Phoenix tracing
updated: "2026-11-09"
---

[Arize Phoenix](https://arize.com/docs/phoenix) is an open-source observability platform for AI applications that accepts OpenTelemetry traces. 10xGraph sends its spans (graph execution, node transitions, LLM calls, token usage, tool execution) to Phoenix over OTLP HTTP. Spans carry the GenAI semantic convention attributes, such as model and token usage. Phoenix converts these to its own format when it ingests them, so traces arrive with model and token attributes.

For Logfire or LangSmith, see [Send traces to Logfire and LangSmith](/docs/guides/send-traces-to-logfire-langsmith). The observability levels and `user_id_mode` options described there apply to Phoenix too. For any other OTLP backend, see [Send traces to an OTLP endpoint](/docs/guides/send-traces-to-otlp). For request and task metrics, see [Metrics with Prometheus and Grafana](/docs/guides/metrics-prometheus-grafana).

Phoenix is an observability publisher. It receives graph, node, LLM and tool spans, AI errors included. It does not receive task lifecycle events or API and worker errors: those are in metrics and logs. See [Publishers, AI tracing and metrics](/docs/concepts/events-and-observability#publishers-ai-tracing-and-metrics).

## Install

```bash
pip install '10xgraph[phoenix]'
```

The `phoenix` extra installs the OpenTelemetry SDK and the OTLP HTTP exporter. It does not install the Phoenix SDK. `10xgraph[observability]` includes Phoenix, Logfire and LangSmith.

## Run Phoenix locally

```bash
docker run -p 6006:6006 -p 4317:4317 arizephoenix/phoenix:latest
```

Open the UI at `http://localhost:6006`. Without Docker, run `pip install arize-phoenix && phoenix serve`. A local Phoenix needs no API key, and 10xGraph sends to `http://localhost:6006` by default.

## Option 1: Use the helper

Call `setup_phoenix()` **before** `graph.compile()`:

```python
from tenxgraph.core.graph import StateGraph, Agent
from tenxgraph.runtime.publisher import setup_phoenix, ObservabilityLevel
from tenxgraph.utils import END

graph = StateGraph()
graph.add_node("MAIN", Agent(model="gpt-4o"))
graph.set_entry_point("MAIN")
graph.add_edge("MAIN", END)

setup_phoenix(graph, project="my-agent", level=ObservabilityLevel.STANDARD)

app = graph.compile()
```

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `graph` | StateGraph or None | `None` | Graph to instrument. `None` configures the provider only (API server use). |
| `api_key` | str | `PHOENIX_API_KEY` | Optional. Sent as `authorization: Bearer <key>`. |
| `project` | str | None | Falls back to `PHOENIX_PROJECT`, then `PHOENIX_PROJECT_NAME`. See [Project names](#project-names). |
| `endpoint` | str | `PHOENIX_COLLECTOR_ENDPOINT` | Base URL. Defaults to `http://localhost:6006`. `/v1/traces` is appended unless present. |
| `level` | ObservabilityLevel | `STANDARD` | `SPANS`, `STANDARD` or `FULL`. `FULL` records prompts and completions. |
| `tracer_provider` | TracerProvider | None | Attach to your own provider instead of creating one. |
| `user_id_mode` | str | `"raw"` | `"raw"`, `"hash"` or `"mask"`. |

## Option 2: Use the publisher

To assign the publisher yourself, for example next to other publishers, use `PhoenixPublisher`. It is an `OtelPublisher` subclass and is assigned the same way as `LangsmithPublisher`:

```python
from tenxgraph.runtime.publisher import PhoenixPublisher, ObservabilityLevel

publisher = PhoenixPublisher(project="my-agent", level=ObservabilityLevel.STANDARD)
graph._publisher = publisher

app = graph.compile()
```

It accepts `api_key`, `project`, `endpoint`, `level` and `tracer_provider`, as `setup_phoenix()` does.

## Option 3: Configure the API server

In `10xgraph.json`:

```json
{
  "observability": {
    "level": "standard",
    "phoenix": {
      "enabled": true,
      "project": "my-agent",
      "endpoint": null
    }
  }
}
```

Keep `PHOENIX_API_KEY` in `.env`, never in the config file. If the exporter package is missing, the server logs a warning and continues without it. See [configuration](/docs/reference/api-cli/configuration) for all keys.

## Phoenix Cloud

Use your space URL as the endpoint and set the key:

```bash
export PHOENIX_COLLECTOR_ENDPOINT="https://app.phoenix.arize.com/s/<your-space>"
export PHOENIX_API_KEY="your-phoenix-api-key"
```

Or pass them in code:

```python
setup_phoenix(
    graph,
    endpoint="https://app.phoenix.arize.com/s/<your-space>",
    api_key="your-phoenix-api-key",
)
```

## Project names

The project is sent as the OpenTelemetry resource attribute `openinference.project.name`. It applies only when 10xGraph creates the `TracerProvider`. If you pass your own `tracer_provider`, set the attribute before that provider is created:

```bash
export OTEL_RESOURCE_ATTRIBUTES="openinference.project.name=my-agent"
```

## Combine with Logfire or LangSmith

Any mix of `logfire`, `langsmith` and `phoenix` in the `observability` block shares one `TracerProvider`:

```json
{
  "observability": {
    "logfire": { "enabled": true },
    "phoenix": { "enabled": true, "project": "my-agent" }
  }
}
```

The same works in code with `setup_observability(graph, {...})`. With Logfire enabled, the Phoenix project is forwarded to Logfire's provider only on logfire 5 or newer. On older versions a warning is logged and spans go to Phoenix's default project; set `OTEL_RESOURCE_ATTRIBUTES` as shown above instead.

## Troubleshooting

**Nothing arrives in Phoenix.** Check that Phoenix is reachable at the endpoint (port 6006 for the default local setup) and that `setup_phoenix()` or the publisher ran before `graph.compile()`. Spans are exported in batches, so allow a few seconds, and make sure the process exits cleanly or stays alive long enough to flush.

**401 Unauthorized.** The API key is missing or wrong. Set `PHOENIX_API_KEY` or pass `api_key=`. Phoenix Cloud requires a key; a local Phoenix does not.

**ImportError: opentelemetry-exporter-otlp-proto-http is required.** Run `pip install '10xgraph[phoenix]'`.
