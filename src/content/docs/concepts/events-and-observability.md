---
title: Events and observability
description: How 10xGraph emits structured events, publishes them to external systems, and exposes metrics and tracing for production monitoring.
updated: "2026-10-27"
order: 180
group: "Serving"
section: Concepts
faq:
  - q: "How do I export events to LangSmith or Logfire?"
    a: "Enable `langsmith` or `logfire` in the `observability` block of `10xgraph.json`, or call `setup_langsmith()` or `setup_logfire()` from Python before `compile()`. Set `LANGSMITH_API_KEY` or `LOGFIRE_TOKEN` in the environment."
  - q: "What is the difference between metrics and tracing?"
    a: "Metrics are aggregated counters and histograms (message count, latency percentiles), dimensioned, dashboarded data. Tracing captures individual request flows as spans with attributes and hierarchy, useful for debugging. 10xGraph emits both."
  - q: "Can I publish events to multiple backends at once?"
    a: "Yes. Pass a list of publishers to `StateGraph(publisher=[...])`, or wrap them in a `CompositePublisher`, to fan out to Console, Redis, Kafka, RabbitMQ, and OTEL at once."
---

When a 10xGraph agent executes, it emits a continuous stream of structured events: the graph starts, nodes run, tools call, LLMs respond, and the graph ends. Each event carries execution context (thread ID, run ID, user ID, timestamps) and semantic content type (text, tool call, error). This event stream is the foundation for observability in production: you can publish events to external systems for logging, distributed tracing, metrics, and real-time monitoring.

This page explains the event model, the publishers that deliver events to backends, the metrics system, and how tracing works end to end.

## The event model

Every execution event is an `EventModel`: a structured record with a source, phase, content, and metadata.

### Event sources and phases

Events come from six sources within the runtime:

- **Graph execution**: The overall graph lifecycle (start, progress, end).
- **Node execution**: A node in the graph running (a step of work).
- **LLM call**: An agent or LLM node making a request to a model.
- **Tool execution**: A tool being invoked.
- **Streaming**: Real-time output from a node (e.g., token-by-token LLM output).
- **Realtime**: Audio/streaming media from a realtime endpoint.

Each event is tagged with a phase that marks its place in the lifecycle:

- **START**: Execution is beginning.
- **PROGRESS**: Execution is in progress (e.g., partial LLM output).
- **RESULT**: A result is available (e.g., tool output).
- **END**: Execution is complete.
- **UPDATE**: State or metadata changed.
- **ERROR**: An error occurred.
- **INTERRUPTED**: Execution was paused for human approval.

### Event content and metadata

Every event carries:

- **Content**: Textual or structured content blocks (text, tool calls, reasoning, images, audio, documents).
- **Content type**: Semantic tag (`TEXT`, `MESSAGE`, `TOOL_CALL`, `TOOL_RESULT`, `ERROR`, etc.).
- **Execution context**: `thread_id` (which conversation), `run_id` (which execution), `user_id` (who ran it), `timestamp` (when), `node_name` (which node).
- **Structured data**: A dictionary of additional fields specific to the event (model name, tokens, tool name, error message, etc.).
- **Metadata**: Optional extra attributes for consumers (is it streaming, what was trimmed, etc.).

This structure lets you slice and filter events by any dimension: all events for a thread, all LLM calls for a user, all errors in the last hour.

## Publishers: routing events to external systems

The runtime publishes events to external systems via pluggable publishers. Each publisher implements a simple interface: `async def publish(event: EventModel)`. You can wire one or many publishers into your graph through the `publisher` argument of `StateGraph(...)`; a list of publishers is wrapped in a `CompositePublisher`.

### Built-in publishers

**ConsolePublisher** is for development and debugging. It writes events to stdout (or to a logger with `use_logger`) so you see them as your graph runs locally. It's opt-in and not used in production by default.

```python
from tenxgraph import StateGraph
from tenxgraph.runtime.publisher import ConsolePublisher

graph = StateGraph(
    AgentState,
    publisher=ConsolePublisher({"format": "json", "indent": 2}),
)
# ... add nodes and edges ...
compiled = graph.compile()
```

**RedisPublisher** broadcasts each event to a Redis Pub/Sub channel (default `tenxgraph.events`) or, with `mode: "stream"`, to a Redis stream. Subscribers on the server (or any external system listening to that channel) receive all events in real time. Useful for event-driven architectures and low-latency integrations.

**KafkaPublisher** publishes events to a Kafka topic. Each event becomes a message in the stream, so multiple consumers can replay or process them independently. Kafka is durable and fault-tolerant, making it a good choice for high-volume production systems.

**RabbitMQPublisher** sends events to a RabbitMQ exchange (default `tenxgraph.events`). You configure the exchange, exchange type and routing key to partition events by type, user, or any other dimension.

**OtelPublisher** reconstructs OTEL (OpenTelemetry) spans from events. Every graph execution becomes a span tree: the graph span has child spans for nodes, LLM calls, and tool calls. Attributes from the event data are attached to each span, and the span timing comes from the event timestamps. If you have an OTEL collector and exporter configured (e.g., Jaeger, Datadog, New Relic), spans are sent there automatically.

**LangsmithPublisher** exports OTEL spans to LangSmith, the observability platform from LangChain, over its OTLP endpoint. Each span corresponds to a graph, node, LLM or tool event. This is useful if your team already uses LangSmith for monitoring and debugging.

**LogfirePublisher** exports spans to Logfire, Pydantic's observability platform. Like LangSmith, it captures the full execution trace and makes it queryable in their UI.

**CompositePublisher** is a fan-out publisher: it holds a list of other publishers and sends each event to all of them concurrently. A failure in one publisher does not block the others. Use this to, for example, send events to both Redis and OTEL at the same time.

```python
from tenxgraph.runtime.publisher import CompositePublisher, ConsolePublisher, RedisPublisher

publishers = [
    ConsolePublisher(),
    RedisPublisher({"url": "redis://localhost:6379"}),
]
composite = CompositePublisher(publishers)

graph = StateGraph(AgentState, publisher=composite)
# ... add nodes and edges ...
compiled = graph.compile()
```

### Configuring publishers

In Python, pass a publisher (or a list of publishers) to the `StateGraph` constructor:

```python
graph = StateGraph(AgentState, publisher=redis_publisher)
```

The API server's `10xgraph.json` has an `observability` block for the OTEL-based backends only (Logfire and LangSmith). Console, Redis, Kafka and RabbitMQ publishers are not configured there; create them in your graph module.

```json
{
  "agent": "graph:app",
  "observability": {
    "level": "standard",
    "logfire": {"enabled": true, "service_name": "my-agent"},
    "langsmith": {"enabled": true, "project": "my-agent"}
  }
}
```

Secrets stay in the environment: set `LOGFIRE_TOKEN` and `LANGSMITH_API_KEY`. The `level` value is one of `spans`, `standard` or `full` and falls back to `standard` if unrecognized.

## Metrics: counters and latency timers

The `tenxgraph.utils.metrics` module provides a lightweight, zero-dependency metrics system. You can emit counters (counts of events) and timers (latency measurements) from anywhere in your code.

### Using the metrics API

```python
from tenxgraph.utils.metrics import counter, timer

# Increment a counter
counter("messages_sent_total").inc()

# Record latency
with timer("db_query_latency_ms"):
    result = await db.query()

# With attributes (dimensions for OTEL)
counter("node_executions").inc(attributes={"node": "agent", "outcome": "success"})
```

Metrics are stored in an in-process registry and are cheap to call (no I/O by default). You can take a snapshot at any time:

```python
from tenxgraph.utils.metrics import snapshot

snapshot_data = snapshot()
# {
#   "counters": {"messages_sent_total": 42},
#   "timers": {
#     "db_query_latency_ms": {
#       "count": 10,
#       "avg_ms": 15.2,
#       "max_ms": 42.1
#     }
#   }
# }
```

### Exporting metrics to OpenTelemetry

By default, metrics stay in-process. To export them to your observability backend (Prometheus, Datadog, etc.) via OTEL:

```python
from tenxgraph.utils.metrics import setup_otel_metrics

# Call once at startup
setup_otel_metrics()

# Every counter/timer now exports to your OTEL MeterProvider
```

If you do not have OpenTelemetry installed, `setup_otel_metrics()` returns False and logs a message; metrics keep working in-process.

The framework emits standard metrics, including:
- `tenxgraph.node.executions`, `tenxgraph.node.errors`, `tenxgraph.node.timeouts`, `tenxgraph.node.stopped`: counters for node runs, with node attributes.
- `tenxgraph.node.duration`: timer for node execution.
- `tenxgraph.tool.calls`, `tenxgraph.tool.errors`, `tenxgraph.tool.timeouts`: counters for tool calls.
- `tenxgraph.tool.duration`: timer for tool execution.

Checkpointers and the background task manager add their own counters and timers.

You can add your own metrics in custom nodes or tools, and they will all export together if OTEL is configured.

## Tracing: spans and attributes

Tracing captures the shape and timing of a request as a tree of spans. The `OtelPublisher` reconstructs this tree from EventModel events.

### How tracing works

Each execution event corresponds to a span. The event hierarchy maps to span parent-child relationships:

- Graph execution event → graph span (root).
- Node execution event → node span (child of graph).
- LLM call event → LLM span (child of node).
- Tool execution event → tool span (child of node).

Span timing is set from `EventModel.timestamp`. Attributes are derived from event data: model name, token counts, tool name, thread ID, user ID, etc. These attributes follow OTEL semantic conventions (the `gen_ai.*`, `server.*`, `db.*` namespaces).

### Observability levels

The `OtelPublisher` emits different amounts of data based on the `ObservabilityLevel`:

- **SPANS**: Structure and timing only. No input/output data on spans (fastest, smallest, safest).
- **STANDARD**: Adds token counts, model name, request parameters when available (default).
- **FULL**: Adds model input messages, output, tool I/O, system prompt (may contain PII; use only in dev/controlled environments).

Set the level when configuring OTEL:

```python
from tenxgraph.runtime.publisher import OtelPublisher, ObservabilityLevel

publisher = OtelPublisher(level=ObservabilityLevel.FULL)
graph = StateGraph(AgentState, publisher=publisher)
# ... add nodes and edges ...
compiled = graph.compile()
```

Or call `setup_tracing(graph, level=ObservabilityLevel.FULL)` before `compile()`. In `10xgraph.json`, the `observability.level` key sets the level for Logfire and LangSmith.

### Distributed tracing

When you integrate with an OTEL collector (e.g., Jaeger, Datadog, New Relic), spans are exported as they complete. You can then:

- View the full execution tree in the observability platform's UI.
- Search spans by attributes (find all runs by a user, all errors, etc.).
- Set alerts on error rates or latency percentiles.
- Sample traces for inspection (e.g., every 100th request, or all errors).

## What is in your traces and events

Content stays in events and spans on purpose, because debugging needs it. What leaves your process depends on the sink:

- **Redis, RabbitMQ and Kafka publishers** send the full event as JSON, including message text and tool inputs and results. Send them only to systems you trust.
- **OTEL spans** (and so Logfire and LangSmith) carry prompts, completions and tool I/O only at `ObservabilityLevel.FULL`. At `SPANS` and `STANDARD` they carry structure, timing, token counts and model names.
- **Ids.** Spans always carry `user_id`, `thread_id` and `run_id`. Events carry the same ids.
- **TLS is your choice. 10xGraph never forces it.** We recommend TLS in production whenever you can, because events carry message and tool content. If the broker runs only inside a network you secure yourself (for example a private subnet or VPC, or a service mesh that already encrypts traffic), a plain connection can be fine. For Redis use a `rediss://` URL, for RabbitMQ an `amqps://` URL, and for Kafka the opt-in `security_protocol`, `ssl_*` and `sasl_*` config keys. See [Emit events from your graph](/docs/guides/use-publishers).
- **`user_id_mode`** changes how `user_id` appears on OTEL spans: `"raw"` (default, unchanged), `"hash"` or `"mask"`. It does not change Redis, RabbitMQ, Kafka or Console events. See [Hide the user id in traces](/docs/guides/send-traces-to-logfire-langsmith#hide-the-user-id-in-traces).

## Where each sink is configured

Here is a reference table of where each piece is configured:

| Feature | Env var | Python API | 10xgraph.json |
|---------|---------|------------|---------------|
| Console output | - | `ConsolePublisher(config)` | - |
| Redis | - | `RedisPublisher({"url": ...})` | - |
| Kafka | - | `KafkaPublisher({"bootstrap_servers": ...})` | - |
| RabbitMQ | - | `RabbitMQPublisher({"url": ...})` | - |
| OTEL tracing | standard OTEL SDK variables | `OtelPublisher(level=..., user_id_mode=...)`, `setup_tracing(graph)` | `observability.level`, `observability.user_id_mode` |
| LangSmith | `LANGSMITH_API_KEY` | `setup_langsmith(graph)` | `observability.langsmith.enabled` |
| Logfire | `LOGFIRE_TOKEN` | `setup_logfire(graph)` | `observability.logfire.enabled` |
| Metrics | - | `setup_otel_metrics()` | - |

## Publishing events from custom nodes

If you write custom nodes or tools, you can emit your own events:

```python
from tenxgraph.runtime.publisher import ContentType, Event, EventModel, EventType, publish_event


async def my_custom_node(state, config: dict):
    # ... do work ...
    event = EventModel.default(
        config,
        data={"custom_metric": 1},
        content_type=[ContentType.DATA],
        event=Event.NODE_EXECUTION,
        event_type=EventType.UPDATE,
        node_name="my_custom_node",
    )
    publish_event(event)
```

The publisher (if configured) will route your event to all sinks automatically.

## Summary

Events are the nerve system of production AI agents. 10xGraph emits them continuously, in a structured format that captures context and content. Publishers fan them out to backends for logging, tracing, metrics, and alerting. The framework provides publishers for Console (dev), Redis, Kafka, RabbitMQ, OTEL, LangSmith, and Logfire, and you can build your own by subclassing `BasePublisher`. Metrics and tracing work through OTEL, so your existing observability stack can integrate with minimal configuration.

For production, start with OTEL + one backend (Datadog, New Relic, Jaeger), add a metrics exporter, and layer in Redis or Kafka for event replay if needed.
