---
title: Send traces to Logfire and LangSmith
description: Send 10xGraph spans to Pydantic Logfire or LangSmith over OpenTelemetry using publishers or configuration.
section: "Observability"
group: "Tracing"
order: 50
label: Logfire and LangSmith tracing
updated: "2026-10-27"
---

[Pydantic Logfire](https://pydantic.dev/logfire) and [LangSmith](https://docs.langchain.com/langsmith/) are production-grade observability platforms for monitoring AI applications. Both implement OpenTelemetry, the industry-standard protocol for distributed tracing. 10xGraph automatically instruments your graphs with spans at every layer, graph execution, node transitions, LLM invocations, token usage, and tool execution, including GenAI semantic conventions (`gen_ai.usage.input_tokens`, `gen_ai.request.model`, and more). `LogfirePublisher` and `LangsmithPublisher` route these spans through an OpenTelemetry `TracerProvider` to your chosen backend and add the keys that backend reads (`logfire.msg` for Logfire, `langsmith.*` for LangSmith). No vendor-specific instrumentation is required.

Using Arize Phoenix? See [Send traces to Arize Phoenix](/docs/guides/send-traces-to-phoenix). Using a collector, Tempo or Jaeger? See [Send traces to an OTLP endpoint](/docs/guides/send-traces-to-otlp). For request and task metrics, see [Metrics with Prometheus and Grafana](/docs/guides/metrics-prometheus-grafana).

Logfire and LangSmith are observability publishers. They receive graph, node, LLM and tool spans, AI errors included. They do not receive task lifecycle events or API and worker errors: those are in metrics and logs. See [Publishers, AI tracing and metrics](/docs/concepts/events-and-observability#publishers-ai-tracing-and-metrics).

## Prerequisites and installation

Install 10xGraph with the observability extra you need:

```bash
pip install '10xgraph[logfire]'        # Logfire only
pip install '10xgraph[langsmith]'      # LangSmith
pip install '10xgraph[observability]'  # Logfire, LangSmith and Phoenix, plus OTEL
pip install '10xgraph[openai]'         # Provider used by the Agent in the examples
```

The `langsmith` extra includes the OpenTelemetry OTLP HTTP exporter (not the LangSmith SDK), because 10xGraph sends traces over the standard OTLP protocol. This approach works with any OTLP-compatible backend.

Set your API credentials in environment variables:

```bash
export LOGFIRE_TOKEN="your-logfire-write-token"       # Logfire
export LANGSMITH_API_KEY="your-langsmith-api-key"     # LangSmith
```

Both publishers and the API server configuration read from these variables when credentials are not passed explicitly.

## Option 1: Logfire publisher

Pass `LogfirePublisher` to the graph when you create it:

```python
from tenxgraph.core.graph import StateGraph, Agent
from tenxgraph.runtime.publisher import LogfirePublisher, ObservabilityLevel
from tenxgraph.utils import END

publisher = LogfirePublisher(service_name="my-agent", level=ObservabilityLevel.STANDARD)

graph = StateGraph(publisher=publisher)
graph.add_node("MAIN", Agent(model="gpt-4o"))
graph.set_entry_point("MAIN")
graph.add_edge("MAIN", END)

app = graph.compile()
```

`LogfirePublisher` is an `OtelPublisher` subclass. It calls `logfire.configure(...)` when you create it, which installs the global `TracerProvider`, and it adds `logfire.msg` to each span.

### Options for LogfirePublisher

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `token` | str | `LOGFIRE_TOKEN` | Logfire write token. Falls back to the env var if not passed. |
| `service_name` | str | None | Service name shown in the Logfire UI. |
| `send_to_logfire` | bool | `True` | Set `False` to emit to console only (for local testing). |
| `console` | bool or ConsoleOptions | None | Control local console output. Pass `False` to silence it. |
| `level` | ObservabilityLevel | `FULL` | Verbosity: `SPANS` (timing only), `STANDARD` (tokens, model, params, graph state), or `FULL` (adds prompt/completion text and tool I/O). See details below. |
| `additional_span_processors` | list | None | Extra `SpanProcessor`s attached alongside the Logfire one. |
| `user_id_mode` | str | `"raw"` | `"raw"`, `"hash"` or `"mask"`. See [Hide the user id in traces](#hide-the-user-id-in-traces). |
| `**configure_kwargs` | dict | - | Extra keyword arguments passed to `logfire.configure()` (e.g., `environment="staging"`). |

## Option 2: LangSmith publisher

```python
from tenxgraph.runtime.publisher import LangsmithPublisher, ObservabilityLevel

publisher = LangsmithPublisher(
    project="my-agent",              # Sent as the Langsmith-Project header
    level=ObservabilityLevel.STANDARD,
)

graph = StateGraph(publisher=publisher)
# ... add nodes and edges ...
app = graph.compile()
```

`LangsmithPublisher` adds the `langsmith.*` keys to each span. For deployments in other regions, pass the full OTEL endpoint (10xGraph appends `/v1/traces` automatically):

```python
publisher = LangsmithPublisher(
    project="my-agent",
    endpoint="https://eu.api.smith.langchain.com/otel",
)
```

### Options for LangsmithPublisher

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `api_key` | str | `LANGSMITH_API_KEY` | LangSmith API key. Falls back to env var if not passed. |
| `project` | str | None | LangSmith project name, sent as the `Langsmith-Project` header. |
| `endpoint` | str | `https://api.smith.langchain.com/otel` | Base OTEL endpoint URL. `/v1/traces` is appended automatically. Override for regional deployments. |
| `level` | ObservabilityLevel | `FULL` | Verbosity: `SPANS`, `STANDARD`, or `FULL`. See details below. |
| `tracer_provider` | TracerProvider | None | Existing `TracerProvider` to attach to. Creates a new global one if not supplied. |
| `user_id_mode` | str | `"raw"` | `"raw"`, `"hash"` or `"mask"`. See [Hide the user id in traces](#hide-the-user-id-in-traces). |

## Option 3: Several backends at once

For Logfire and LangSmith together, use the `observability` block of `10xgraph.json` (see [Serve with declarative configuration](#serve-with-declarative-configuration)). There the server creates each span once, shares one `TracerProvider`, and writes the keys of every enabled backend on that span.

In Python, `StateGraph(publisher=[LogfirePublisher(...), LangsmithPublisher(...)])` (or a `CompositePublisher`) works, but each publisher creates its own span, so every span is built once per backend. Prefer the `observability` block when you want more than one tracing backend. To combine one tracing publisher with event publishers such as Redis or Kafka, use a list or `CompositePublisher`:

```python
from tenxgraph.runtime.publisher import CompositePublisher, ConsolePublisher, LogfirePublisher

publisher = CompositePublisher([LogfirePublisher(service_name="my-agent"), ConsolePublisher({})])
graph = StateGraph(publisher=publisher)
```

## Understanding observability levels

The `level` parameter controls how much detail lands on each span and whether sensitive information is included. This is critical for PII and cost management:

| Level | What is included | PII risk | Use case |
|---|---|---|---|
| `SPANS` | Graph/node/LLM/tool structure and timing only | None | Performance profiling; production baseline. |
| `STANDARD` | + token counts, model name, LLM parameters (temperature, max_tokens), and the graph state on node spans (`input.value` is the state going in; `output.value` is the state after, the messages produced and the next node). No prompts, completions or tool I/O, but the state can contain the conversation. | Medium | Production when you want token and cost data without prompts and tool results. |
| `FULL` (default) | + user messages, LLM prompts, completions, tool inputs and results, on top of everything in `STANDARD` | High | Development, debugging, and production backends you trust with this data. |

`FULL` is the default. It sends message content and graph state to the trace backend. Set `level` to `STANDARD` or `SPANS` to reduce that; note that `STANDARD` still includes graph state, which can contain the conversation, so only `SPANS` leaves message content out entirely. The framework's built-in log redaction (`install_secret_redaction()`) does **not** scrub span content, so treat `FULL` and `STANDARD` traces as sensitive and restrict who can view them in Logfire or LangSmith.

## Hide the user id in traces

Spans always carry `user_id`, `thread_id` and `run_id`. By default the user id is sent as is. Set `user_id_mode` to change that for every span, including those sent to Logfire and LangSmith:

| Mode | What the span carries |
|---|---|
| `raw` (default) | The id, unchanged. |
| `hash` | First 16 hex characters of SHA-256 of the id. The same id always gives the same value, so one user's spans still group together. |
| `mask` | Ids of 4 characters or fewer: `***`. 5 to 7 characters: `a***e`. 8 or more: `al***42`. |

Plain SHA-256 of a short id, such as an email or a small integer, can be recovered by guessing. Set the environment variable `TENXGRAPH_TRACE_USER_ID_KEY` and `hash` uses HMAC-SHA256 with that key instead.

```python
publisher = LogfirePublisher(service_name="my-agent", user_id_mode="hash")
```

`OtelPublisher`, `PhoenixPublisher`, `LangsmithPublisher` and `LogfirePublisher` take the same option, and so does `observability.user_id_mode` in `10xgraph.json`. An invalid value raises `ValueError`.

This changes spans only. Redis, RabbitMQ, Kafka and Console events keep the raw id. Prompts and tool I/O still appear at `FULL`. See [What is in your traces and events](/docs/concepts/events-and-observability#what-is-in-your-traces-and-events).

## Serve with declarative configuration

When serving a graph through the 10xGraph API server using `10xgraph dev`, you do not create a publisher yourself. Instead, add an `observability` block to your `10xgraph.json` config file, and the server wires everything up during startup:

```json
{
  "agent": "graph.react:app",
  "observability": {
    "level": "standard",
    "user_id_mode": "hash",
    "logfire": {
      "enabled": true,
      "service_name": "my-agent",
      "send_to_logfire": true,
      "console": false
    },
    "langsmith": {
      "enabled": true,
      "project": "my-agent",
      "endpoint": null
    }
  }
}
```

Keep `LOGFIRE_TOKEN` and `LANGSMITH_API_KEY` in your `.env` file, never in `10xgraph.json`. If a backend is enabled but its package is missing or its API key is not set, the server logs a warning and continues without that exporter rather than failing to start.

`observability.user_id_mode` is also in the `10xgraph config` editor (Observability page, "User id in traces"). The same page has "Send AI traces to" (None first) for the destinations and "Export metrics" for the `metrics` block. It applies to the server's OTEL publisher both for the `observability` block and for `OTEL_ENABLED`. If the installed core is too old to support it, the server keeps raw ids and logs a warning.

All config keys are optional. You can enable just Logfire, just LangSmith, or both. The default `level` is `"full"` if not specified, which sends message content and graph state; the example above sets `"standard"` to send less. If the graph already has an observability publisher (for example a `PhoenixPublisher`), the server reuses it, logs a warning and does not apply this block, including its `level`.

## Verifying traces are flowing

### Local development with console output

When `send_to_logfire=False` or during local testing, you can verify tracing is working by enabling console output:

```python
import logfire
from tenxgraph.core.state import Message

publisher = LogfirePublisher(
    service_name="my-agent",
    send_to_logfire=False,
    console=logfire.ConsoleOptions(),  # Print spans to the console
    level=ObservabilityLevel.STANDARD,
)

graph = StateGraph(publisher=publisher)
# ... add nodes and edges ...
app = graph.compile()
app.invoke(
    {"messages": [Message.text_message("Hello")]},
    config={"thread_id": "test-1"},
)
```

You will see formatted span events printed as your graph executes.

### Check the backend UI

Once traces are flowing, visit your observability platform to inspect them:

- **Logfire**: Log into [logfire.pydantic.dev](https://logfire.pydantic.dev) and navigate to your service name.
- **LangSmith**: Log into [smith.langchain.com](https://smith.langchain.com) and find your project.

Look for a trace tree showing graph execution, node names, LLM model calls, and tool invocations. If you enabled `STANDARD` or `FULL` level (the default is `FULL`), you will also see token counts and parameters.

## Common errors

**ImportError: Logfire is required for logfire tracing**

You installed `10xgraph` but not the `logfire` extra. Fix:

```bash
pip install '10xgraph[logfire]'
```

**ImportError: opentelemetry-exporter-otlp-proto-http is required for LangSmith tracing**

The LangSmith integration needs the OTLP HTTP exporter. Fix:

```bash
pip install '10xgraph[langsmith]'
```

**ValueError: A LangSmith API key is required**

The API key was not found. Ensure `LANGSMITH_API_KEY` is set:

```bash
export LANGSMITH_API_KEY="your-api-key"
```

Or pass it explicitly:

```python
LangsmithPublisher(api_key="your-api-key", project="my-agent")
```

**Spans do not appear in Logfire or LangSmith**

- Verify the token/API key is correct and has write permission.
- Check that `level` is not `SPANS` (which logs structure only, not content or graph state).
- If running locally with `send_to_logfire=False`, traces go to console instead.
- In the API server, confirm `enabled` is `true` under `observability.logfire` or `observability.langsmith` in `10xgraph.json` and the tokens are in `.env`.

## Run it in production

The server's in-process trace endpoint is disabled when `MODE=production`, so use OTEL or a publisher for traces there. Set `observability.user_id_mode` to `hash` or `mask` if user IDs should not appear in your tracing backend. See [Observability](/docs/server/observability).

## See also

- [How to use publishers](/docs/guides/use-publishers): the other publishers (Console, Redis, Kafka, RabbitMQ) and how to combine them.
- [Configure 10xgraph.json](/docs/server/configure): all top-level config keys and their meanings.
- [Server observability](/docs/server/observability): logging, metrics, OTEL tracing, and Sentry integration on the API server.
