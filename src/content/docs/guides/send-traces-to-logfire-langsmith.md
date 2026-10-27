---
title: Send traces to Logfire and LangSmith
description: Send 10xGraph spans to Pydantic Logfire or LangSmith over OpenTelemetry using helpers, publishers, or configuration.
section: "Build agents"
group: "Observability and operations"
order: 400
label: Logfire & LangSmith tracing
updated: "2026-10-27"
---

[Pydantic Logfire](https://pydantic.dev/logfire) and [LangSmith](https://docs.langchain.com/langsmith/) are production-grade observability platforms for monitoring AI applications. Both implement OpenTelemetry, the industry-standard protocol for distributed tracing. 10xGraph automatically instruments your graphs with spans at every layer, graph execution, node transitions, LLM invocations, token usage, and tool execution, including GenAI semantic conventions (`gen_ai.usage.input_tokens`, `gen_ai.request.model`, `session.id`, and more). The `OtelPublisher` routes these spans through an OpenTelemetry `TracerProvider` to your chosen backend. You need only configure which exporter to use; no vendor-specific instrumentation is required.

## Prerequisites and installation

Install 10xGraph with the observability extra you need:

```bash
pip install '10xgraph[logfire]'        # Logfire only
pip install '10xgraph[langsmith]'      # LangSmith
pip install '10xgraph[observability]'  # Both, plus OTEL
pip install '10xgraph[openai]'         # Provider used by the Agent in the examples
```

The `langsmith` extra includes the OpenTelemetry OTLP HTTP exporter (not the LangSmith SDK), because 10xGraph sends traces over the standard OTLP protocol. This approach works with any OTLP-compatible backend.

Set your API credentials in environment variables:

```bash
export LOGFIRE_TOKEN="your-logfire-write-token"       # Logfire
export LANGSMITH_API_KEY="your-langsmith-api-key"     # LangSmith
```

Both setup helpers and the API server configuration read from these variables when credentials are not passed explicitly.

## Option 1: Configure Logfire with a Python helper

For development and local testing, use the `setup_logfire()` helper to configure the OpenTelemetry `TracerProvider` and attach tracing to your graph. Call it **before** `graph.compile()`:

```python
from tenxgraph.core.graph import StateGraph, Agent
from tenxgraph.runtime.publisher import setup_logfire, ObservabilityLevel
from tenxgraph.utils import END

# Build the graph
graph = StateGraph()
graph.add_node("MAIN", Agent(model="gpt-4o"))
graph.set_entry_point("MAIN")
graph.add_edge("MAIN", END)

# Configure Logfire and instrument the graph before compile()
setup_logfire(
    graph,
    service_name="my-agent",
    level=ObservabilityLevel.STANDARD,
)

app = graph.compile()
```

`setup_logfire()` calls `logfire.configure(...)` internally to install the global `TracerProvider`, then attaches the `OtelPublisher` to emit spans into it.

### Options for setup_logfire

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `graph` | StateGraph or None | `None` | The graph to instrument. Leave as `None` to configure providers only (API server use case). |
| `token` | str | `LOGFIRE_TOKEN` | Logfire write token. Falls back to the env var if not passed. |
| `service_name` | str | None | Service name shown in the Logfire UI. |
| `send_to_logfire` | bool | `True` | Set `False` to emit to console only (for local testing). |
| `console` | bool or ConsoleOptions | None | Control local console output. Pass `False` to silence it. |
| `level` | ObservabilityLevel | `STANDARD` | Verbosity: `SPANS` (timing only), `STANDARD` (tokens, model, params), or `FULL` (prompt/completion text). See details below. |
| `user_id_mode` | str | `"raw"` | `"raw"`, `"hash"` or `"mask"`. See [Hide the user id in traces](#hide-the-user-id-in-traces). |
| `additional_span_processors` | list | None | Extra `SpanProcessor`s attached alongside the Logfire one. |
| `**configure_kwargs` | dict | - | Extra keyword arguments passed to `logfire.configure()` (e.g., `environment="staging"`). |

## Option 2: Configure LangSmith with a Python helper

Similarly, use `setup_langsmith()` to attach LangSmith tracing:

```python
from tenxgraph.runtime.publisher import setup_langsmith, ObservabilityLevel

setup_langsmith(
    graph,
    project="my-agent",              # Sent as the Langsmith-Project header
    level=ObservabilityLevel.STANDARD,
)

app = graph.compile()
```

For deployments in other regions, pass the full OTEL endpoint (10xGraph appends `/v1/traces` automatically):

```python
setup_langsmith(
    graph,
    project="my-agent",
    endpoint="https://eu.api.smith.langchain.com/otel",
)
```

### Options for setup_langsmith

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `graph` | StateGraph or None | `None` | The graph to instrument. Leave as `None` to configure providers only. |
| `api_key` | str | `LANGSMITH_API_KEY` | LangSmith API key. Falls back to env var if not passed. |
| `project` | str | None | LangSmith project name, sent as the `Langsmith-Project` header. |
| `endpoint` | str | `https://api.smith.langchain.com/otel` | Base OTEL endpoint URL. `/v1/traces` is appended automatically. Override for regional deployments. |
| `level` | ObservabilityLevel | `STANDARD` | Verbosity: `SPANS`, `STANDARD`, or `FULL`. See details below. |
| `user_id_mode` | str | `"raw"` | `"raw"`, `"hash"` or `"mask"`. See [Hide the user id in traces](#hide-the-user-id-in-traces). |
| `tracer_provider` | TracerProvider | None | Existing `TracerProvider` to attach to. Creates a new global one if not supplied. |

## Option 3: Use a publisher object

If you prefer to work with publisher objects, for example, to compose multiple publishers with `CompositePublisher`, instantiate `LogfirePublisher` or `LangsmithPublisher` and pass it to your graph:

```python
from tenxgraph.runtime.publisher import LangsmithPublisher, ObservabilityLevel

publisher = LangsmithPublisher(
    project="my-agent",
    level=ObservabilityLevel.STANDARD,
)

graph = StateGraph(publisher=publisher)
# ... add nodes and edges ...
app = graph.compile()
```

`LogfirePublisher` accepts the keyword arguments of `setup_logfire()` except `graph`; `LangsmithPublisher` accepts those of `setup_langsmith()` except `graph`. Both are subclasses of `OtelPublisher` and configure the `TracerProvider` on construction.

## Option 4: Enable both Logfire and LangSmith at once

The `setup_observability()` helper reads a config dict and enables either or both backends, ensuring they share a single `TracerProvider`:

```python
from tenxgraph.runtime.publisher import setup_observability

setup_observability(graph, {
    "level": "standard",
    "logfire": {
        "enabled": True,
        "service_name": "my-agent",
    },
    "langsmith": {
        "enabled": True,
        "project": "my-agent",
    },
})

app = graph.compile()
```

When both are enabled, the LangSmith span processor is passed to Logfire via `additional_span_processors`, so they share the same `TracerProvider` and there is no duplication.

## Understanding observability levels

The `level` parameter controls how much detail lands on each span and whether sensitive information is included. This is critical for PII and cost management:

| Level | What is included | PII risk | Use case |
|---|---|---|---|
| `SPANS` | Graph/node/LLM/tool structure and timing only | None | Performance profiling; production baseline. |
| `STANDARD` (default) | + token counts, model name, LLM parameters (temperature, max_tokens). **No message content.** | Low | Default for most production workloads. |
| `FULL` | + user messages, LLM prompts, completions, tool inputs and results | High | Development and local debugging only. |

`FULL` puts your application's prompts and responses on spans. The framework's built-in log redaction (`install_secret_redaction()`) does **not** scrub span content, so treat `FULL` traces as sensitive and restrict who can view them in Logfire or LangSmith. Never use `FULL` in production without understanding the privacy implications.

## Hide the user id in traces

Spans always carry `user_id`, `thread_id` and `run_id`. By default the user id is sent as is. Set `user_id_mode` to change that for every span, including those sent to Logfire and LangSmith:

| Mode | What the span carries |
|---|---|
| `raw` (default) | The id, unchanged. |
| `hash` | First 16 hex characters of SHA-256 of the id. The same id always gives the same value, so one user's spans still group together. |
| `mask` | Ids of 4 characters or fewer: `***`. 5 to 7 characters: `a***e`. 8 or more: `al***42`. |

Plain SHA-256 of a short id, such as an email or a small integer, can be recovered by guessing. Set the environment variable `TENXGRAPH_TRACE_USER_ID_KEY` and `hash` uses HMAC-SHA256 with that key instead.

```python
setup_logfire(graph, service_name="my-agent", user_id_mode="hash")
```

`OtelPublisher(level=..., user_id_mode="hash")`, `setup_tracing(...)`, `setup_langsmith(...)` and `setup_observability(graph, {"user_id_mode": "hash", ...})` take the same option. An invalid value raises `ValueError`.

This changes spans only. Redis, RabbitMQ, Kafka and Console events keep the raw id. Prompts and tool I/O still appear at `FULL`. See [What is in your traces and events](/docs/concepts/events-and-observability#what-is-in-your-traces-and-events).

## Serve with declarative configuration

When serving a graph through the 10xGraph API server using `10xgraph api`, you do not call setup functions yourself. Instead, add an `observability` block to your `10xgraph.json` config file, and the server wires everything up during startup:

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

`observability.user_id_mode` is also in the `10xgraph config` editor (Observability section, "User id in traces"). It applies to the server's OTEL publisher both for the `observability` block and for `OTEL_ENABLED`. If the installed core is too old to support it, the server keeps raw ids and logs a warning.

All config keys are optional. You can enable just Logfire, just LangSmith, or both. The default `level` is `"standard"` if not specified.

## Verifying traces are flowing

### Local development with console output

When `send_to_logfire=False` or during local testing, you can verify tracing is working by enabling console output:

```python
import logfire
from tenxgraph.core.state import Message

setup_logfire(
    graph,
    service_name="my-agent",
    send_to_logfire=False,
    console=logfire.ConsoleOptions(),  # Print spans to the console
    level=ObservabilityLevel.STANDARD,
)

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

Look for a trace tree showing graph execution, node names, LLM model calls, and tool invocations. If you enabled `STANDARD` or `FULL` level, you will also see token counts and parameters.

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
setup_langsmith(graph, api_key="your-api-key", project="my-agent")
```

**Spans do not appear in Logfire or LangSmith**

- Verify the token/API key is correct and has write permission.
- Check that `level` is not `SPANS` (which logs structure only, not content).
- If running locally with `send_to_logfire=False`, traces go to console instead.
- In the API server, confirm `enabled` is `true` under `observability.logfire` or `observability.langsmith` in `10xgraph.json` and the tokens are in `.env`.

## See also

- [How to use publishers](/docs/guides/use-publishers): the other publishers (Console, Redis, Kafka, RabbitMQ) and how to combine them.
- [Configure 10xgraph.json](/docs/server/configure): all top-level config keys and their meanings.
- [Server observability](/docs/server/observability): logging, metrics, OTEL tracing, and Sentry integration on the API server.
