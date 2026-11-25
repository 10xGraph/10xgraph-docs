---
title: Events and observability
description: How 10xGraph emits structured events, publishes them to external systems, and exposes metrics and tracing for production monitoring.
updated: "2026-11-25"
order: 190
group: "Platform"
section: Concepts
faq:
  - q: "How do I export events to LangSmith or Logfire?"
    a: "Enable `langsmith` or `logfire` in the `observability` block of `10xgraph.json`, or pass a `LangsmithPublisher` or `LogfirePublisher` to `StateGraph(publisher=...)`. Set `LANGSMITH_API_KEY` or `LOGFIRE_TOKEN` in the environment."
  - q: "What is the difference between metrics and tracing?"
    a: "Metrics are aggregated counters and histograms (message count, latency percentiles), dimensioned, dashboarded data. Tracing captures individual request flows as spans with attributes and hierarchy, useful for debugging. 10xGraph emits both."
  - q: "Can I publish events to multiple backends at once?"
    a: "Yes. Pass a list of publishers to `StateGraph(publisher=[...])`, or wrap them in a `CompositePublisher`, to fan out to Console, Redis, Kafka, RabbitMQ, and OTEL at once."
---

When a 10xGraph agent executes, it emits structured events. Event consumers (Kafka, Redis, RabbitMQ or your own publisher) get a short stream of domain events: a run starts, nodes finish, tools start and finish, and the run ends. Tracing backends get more detail, such as each model call, so they can build spans. Each event carries execution context (thread ID, run ID, user ID, timestamps) and semantic content type (text, tool call, error). You can publish events to external systems for logging, distributed tracing, metrics, and real-time monitoring.

This page explains the event model, how events are routed to publishers, the domain events your consumers receive, batching for broker publishers, the metrics system, and how tracing works end to end.

## The event model

Every execution event is an `EventModel`: a structured record with a source, phase, content, and metadata.

### Event sources and phases

Events come from six sources within the runtime:

- **Graph execution**: The run itself (start, end, failure, pause, stop).
- **Node execution**: A node in the graph running (a step of work).
- **LLM call**: An agent or LLM node making a request to a model. Sent to tracing backends and the console only.
- **Tool execution**: A tool being invoked.
- **Streaming**: A source value in the `Event` enum. The runtime does not publish streaming events to publishers.
- **Realtime**: Audio/streaming media from a realtime endpoint.

Each event carries a phase that marks its place in the lifecycle:

- **START**: Execution is beginning.
- **PROGRESS**: Kept in the enum. The runtime no longer publishes progress events.
- **RESULT**: A result is available (for example a realtime transcript).
- **END**: Execution is complete.
- **UPDATE**: Metadata changed (used by realtime events and custom events).
- **ERROR**: An error occurred.
- **INTERRUPTED**: Execution was paused or stopped.

The phase and source tell you what kind of event it is. For event publishers, the better key is the domain name in `metadata["event_name"]`; see [Domain events](#domain-events).

### Event content and metadata

Every event carries:

- **Content**: Textual or structured content blocks (text, tool calls, reasoning, images, audio, documents).
- **Content type**: Semantic tag (`TEXT`, `MESSAGE`, `TOOL_CALL`, `TOOL_RESULT`, `ERROR`, etc.).
- **Execution context**: `thread_id` (which conversation), `run_id` (which execution), `user_id` (who ran it), `timestamp` (when), `node_name` (which node).
- **Structured data**: A dictionary of additional fields specific to the event (model name, tokens, tool name, error message, etc.).
- **Metadata**: Extra attributes for consumers. Domain events carry their name in `metadata["event_name"]`.

This structure lets you slice and filter events by any dimension: all events for a thread, all LLM calls for a user, all errors in the last hour.

## Publishers: routing events to external systems

The runtime publishes events to external systems via pluggable publishers. Each publisher implements a simple interface: `async def publish(event: EventModel)`. You can wire one or many publishers into your graph through the `publisher` argument of `StateGraph(...)`; a list of publishers is wrapped in a `CompositePublisher`.

### How events are routed

Every event has a tag, and every publisher has a `kind`. Together they decide who gets the event.

- A tag of `all` goes to event publishers (`kind="events"`: Kafka, Redis, RabbitMQ and custom publishers) and to observability publishers (`kind="observability"`: OTEL, Phoenix, LangSmith, Logfire).
- A tag of `observability` goes to observability publishers only. The runtime uses it for node starts, model calls (LLM_CALL start, end and error), node errors and the resume span event. Spans need them. Event consumers do not.
- `ConsolePublisher` gets every event, whatever its tag.
- `publish_event()` sends your own events with the tag `all` by default. Set `EventModel(tag=...)` to change it. The tag is used for routing only and is never serialized.
- If no bound publisher takes a tag, the event is not built at all. A graph with only a Kafka publisher does not build model call payloads.

The `kind` of a publisher is a class attribute and there is no setting to change the routing. The older events (graph start and end, state updates, progress events and the duplicated node and tool events) are gone, and no setting brings them back.

### Domain events

Event publishers receive these events. The name is in `metadata["event_name"]`. Switch on it instead of on `event` and `event_type`.

| Name | When it fires | Key payload | `data["state"]` | `node_name` |
|---|---|---|---|---|
| `run.started` | A run begins (also when it resumes a paused thread). | `metadata`: `current_node`, `step`, `is_interrupted`. No run config. | No | Empty |
| `node.completed` | Once per node, after the node returns (not for `__start__`). | `data["messages"]`: the messages this node added (not all run messages). `data["next_node"]`: set only when the node chose it (a `Command` or a handoff), else `None`. | No | The node |
| `tool.started` | A tool call begins (local, MCP or client tool). | `data`: `args`, `tool_call_id`, `function_name`. | No | The graph node that runs the tool |
| `tool.completed` | The tool call finished. | `data`: `status` (`"success"`), `duration_ms`, `message` (the result message). | No | The graph node that runs the tool |
| `tool.failed` | The tool raised, was denied, was not found, timed out, was cancelled or returned an error result. | `data`: `status` (`"error"`), `duration_ms`, `error` when there is an error text, `message` when there is a result message. | No | The graph node that runs the tool |
| `run.completed` | The run finished without a pause or stop. | `data["messages"]`: the final messages. `metadata`: `time_taken`, `total_input_tokens`, `total_output_tokens`, `total_reasoning_tokens`, `total_tokens`, `step`, `current_node`, `total_messages`. | Yes | Empty |
| `run.failed` | The run raised an error. Sent once. | `data["error"]`. `metadata`: `time_taken`, `step`, `current_node`. | Yes | Empty |
| `run.interrupted` | The run paused: `interrupt_before`, `interrupt_after`, an `interrupt()` call or a client tool. | `data`: `interrupted_node`, `interrupt_type` (`"before"`, `"after"`, `"interrupt"` or `"remote_tool"`), and `interrupt` (id and value of the request) for `interrupt()`. | Yes | The interrupted node |
| `run.stopped` | A stop request, or a cancelled run. | `data`: `interrupted_node`, `reason`. `metadata["interrupt_type"]` is `"stop"` or `"cancel"`. | Yes | Empty |
| `run.recovered` | A new run found a thread whose previous run died, and repaired it. Sent before the new run's `run.started`. | `data["dead_run_id"]`. | No | Empty |
| `input.rejected` | An input validator refused the input, so the run never starts. | `data`: `error`, `rejected_count`. | No | Empty |

How to read the table:

- `data["state"]` is sent to event publishers on the run-end events only: `run.completed`, `run.failed`, `run.interrupted` and `run.stopped`. It is still bounded by `state_snapshot_limit` (see [Large state snapshots](/docs/reference/python/publishers#large-state-snapshots)). Observability publishers also get the state on node and run start events.
- Run-level events have an empty `node_name`. The node is in `metadata["current_node"]` (for a stop, in `data["interrupted_node"]`). `run.interrupted` keeps the interrupted node in `node_name`.
- Event publishers do not get `error_message` or `error_traceback`, because they can hold file paths, DSNs or SQL. Tracing backends do.
- A tool `status` of `"error"` also covers denied calls. The `metadata["status"]` text says which case it was.
- A `LiveAgent` (realtime) session sends `run.started`, then `run.completed`, `run.failed` or `run.stopped`.

A run with three nodes (model, tool, model) sends event publishers seven events:

```text
run.started
node.completed      (model, asks for a tool)
tool.started
tool.completed
node.completed      (tool)
node.completed      (model, final answer)
run.completed       (with data["state"])
```

A consumer switches on the name. This one reads the Redis stream from the guide:

```python
import json

def handle(raw: bytes) -> None:
    event = json.loads(raw)
    name = event["metadata"]["event_name"]
    if name == "run.started":
        print("run", event["run_id"], "started on thread", event["thread_id"])
    elif name == "tool.failed":
        print("tool", event["data"]["function_name"], "failed:", event["data"].get("error"))
    elif name == "run.completed":
        print("done in", event["metadata"]["time_taken"], "seconds,",
              event["metadata"]["total_tokens"], "tokens")
    elif name in ("run.failed", "run.stopped", "run.interrupted"):
        print(name, event["data"].get("error") or event["data"].get("reason"))
```

For RabbitMQ the message body is the same JSON, and for Kafka the message value is. See [Emit events from your graph](/docs/guides/use-publishers).

### Batching broker publishers

Redis, Kafka and RabbitMQ publishers send in batches, always. `publish_event` puts the event in a bounded queue and returns. One worker per publisher sends the queue, in order, every `batch_size` events or `flush_interval_ms` after the first queued event, whichever comes first.

| Key | Default | Meaning |
|---|---|---|
| `batch_size` | `100` | Events per batch. |
| `flush_interval_ms` | `20` | Longest wait for a batch to fill, in milliseconds. |
| `queue_size` | `2048` | Events the queue holds. |
| `publish_timeout` | none | Seconds one batch may take. A timed-out batch is dropped and logged. |

Values that are not positive numbers fall back to the default. If the queue is full, the new event is dropped, `tenxgraph.publish.dropped` counts it, and a warning is logged at most once every 10 seconds. A failed or timed-out batch is dropped too and adds its size to the same counter. `CompiledGraph.aclose()`, sync `invoke` and `stream`, and the publisher's `close()` flush the queue. With async `ainvoke` and `astream`, call `await graph.aclose()` before the process exits, or queued events can be lost.

Metrics: `tenxgraph.publish.duration` times one batch send, `tenxgraph.publish.batches` counts batches and `tenxgraph.publish.events` counts events sent, all with a `publisher` attribute holding the class name. Config keys, per-broker behaviour and the Kafka message key are in [Publishers reference](/docs/reference/python/publishers#batching).

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

**KafkaPublisher** publishes events to a Kafka topic. Each event becomes a message keyed by the thread ID, so one thread's events stay in order within a partition. Multiple consumers can replay or process them independently. Kafka is durable and fault-tolerant, making it a good choice for high-volume production systems.

**RabbitMQPublisher** sends events to a RabbitMQ exchange (default `tenxgraph.events`). You configure the exchange, exchange type and routing key to partition events by type, user, or any other dimension.

**OtelPublisher** reconstructs OTEL (OpenTelemetry) spans from events. Every graph execution becomes a span tree: the graph span has child spans for nodes, LLM calls, and tool calls. It is an observability publisher, so it gets the `observability` events too. Attributes from the event data are attached to each span, and the span timing comes from the event timestamps. If you have an OTEL collector and exporter configured (e.g., Jaeger, Datadog, New Relic), spans are sent there automatically.

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

The API server's `10xgraph.json` has an `observability` block for the OTEL-based backends only (Phoenix, Logfire, LangSmith and OTLP). Console, Redis, Kafka and RabbitMQ publishers are not configured there; create them in your graph module.

```json
{
  "agent": "graph:app",
  "observability": {
    "level": "full",
    "logfire": {"enabled": true, "service_name": "my-agent"},
    "langsmith": {"enabled": true, "project": "my-agent"}
  }
}
```

Secrets stay in the environment: set `LOGFIRE_TOKEN` and `LANGSMITH_API_KEY`. With several backends enabled, the server creates each span once and writes the keys each backend reads (OpenInference for Phoenix, `langsmith.*`, `logfire.msg`). `otlp` alone gets the basic attributes only. The `level` value is one of `spans`, `standard` or `full` and falls back to `full` if unrecognized. `full` is the default and sends message content and graph state to the trace backend; set `standard` or `spans` to send less (see [Observability levels](#observability-levels)).

If the graph already has an observability publisher (for example a `PhoenixPublisher` passed to the graph or agent), the API server reuses it, logs a warning and does not apply the `observability` block, including its `level`.

In Python, a list of tracing publishers (or a `CompositePublisher` of them) works, but every tracing publisher creates its own span, so each span is built once per backend. For several tracing backends at once, prefer the `observability` block. A list or `CompositePublisher` is the way to combine one tracing publisher with event publishers (Redis, Kafka, RabbitMQ, console).

## Publishers, AI tracing and metrics

Three kinds of sink receive information. Event publishers (Kafka, Redis, RabbitMQ, console, or your own) are an event stream for your consumers. AI tracing backends (OTEL, Logfire, LangSmith, Phoenix) turn graph, node, LLM and tool events into spans. Metrics are counters and timers.

| What | Event publishers | AI tracing | Metrics | Logs |
|---|---|---|---|---|
| Run, node and tool events (the domain events) | Yes | Yes | Unchanged | Yes |
| Model call (LLM_CALL) events and node starts, including AI errors | No (console only) | Yes | Unchanged | Yes |
| Task lifecycle: queued, started, finished, saved, cancelled | Yes | No | Unchanged | Yes |
| Task failure | No, not published | No | `tenxgraph.task.runs{status="failure"}` | ERROR log |
| API HTTP errors | Not published | Not published | In the HTTP metrics | Yes |

Task lifecycle events are not graph runs, so AI tracing backends never get them. A failed task is counted and logged, but no event is sent.

Every publisher has a `kind` attribute. It is `"events"` by default, so a custom publisher is an event publisher. Built-in tracing publishers (`OtelPublisher`, `LogfirePublisher`, `LangsmithPublisher`, `PhoenixPublisher`) set `"observability"`. For a custom tracing backend, set it yourself:

```python
from tenxgraph.runtime.publisher import BasePublisher


class MyTracingPublisher(BasePublisher):
    kind = "observability"
    # publish, close and sync_close as usual
```

Which events a publisher gets also depends on the event tag; see [How events are routed](#how-events-are-routed). `publish_event` takes an optional `only` argument. `publish_event(event, only="events")` sends the event to event publishers only and skips tracing publishers, also inside a `CompositePublisher`. `only="observability"` does the reverse. Without `only`, every publisher gets the event.

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
- **STANDARD**: Adds token counts, model name and request parameters when available. It also adds the graph state on node spans: `input.value` is the state going in, `output.value` is the state after the node, plus the messages it produced and the next node. State can contain the conversation, so `STANDARD` is not content-free.
- **FULL** (default): Adds model input messages, output, tool I/O and the system prompt, on top of everything in `STANDARD`. It sends message content and graph state to the trace backend and may contain PII. Choose `STANDARD` or `SPANS` to reduce what leaves your process; use `FULL` only where the backend is trusted to hold that data.

The default is `FULL`. Set the level when configuring OTEL:

```python
from tenxgraph.runtime.publisher import OtelPublisher, ObservabilityLevel

publisher = OtelPublisher(level=ObservabilityLevel.STANDARD)
graph = StateGraph(AgentState, publisher=publisher)
# ... add nodes and edges ...
compiled = graph.compile()
```

In `10xgraph.json`, the `observability.level` key sets the level for the backends in that block.

### Distributed tracing

When you integrate with an OTEL collector (e.g., Jaeger, Datadog, New Relic), spans are exported as they complete. You can then:

- View the full execution tree in the observability platform's UI.
- Search spans by attributes (find all runs by a user, all errors, etc.).
- Set alerts on error rates or latency percentiles.
- Sample traces for inspection (e.g., every 100th request, or all errors).

## What is in your traces and events

Content stays in events and spans on purpose, because debugging needs it. What leaves your process depends on the sink:

- **Redis, RabbitMQ and Kafka publishers** send the event as JSON, including message text and tool inputs and results, and the run state on run-end events. Send them only to systems you trust.
- **OTEL spans** (and so Logfire and LangSmith) carry prompts, completions and tool I/O at `ObservabilityLevel.FULL`, which is the default. They also carry the graph state on node spans at `FULL` and `STANDARD`, and the state can contain the conversation. Only `SPANS` carries structure, timing and ids alone; `STANDARD` adds token counts, model names and graph state.
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
| OTEL tracing | standard OTEL SDK variables | `OtelPublisher(level=..., user_id_mode=...)` | `observability.level`, `observability.user_id_mode` |
| LangSmith | `LANGSMITH_API_KEY` | `LangsmithPublisher(...)` | `observability.langsmith.enabled` |
| Logfire | `LOGFIRE_TOKEN` | `LogfirePublisher(...)` | `observability.logfire.enabled` |
| Phoenix | `PHOENIX_API_KEY` | `PhoenixPublisher(...)` | `observability.phoenix.enabled` |
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

The publisher (if configured) routes your event to every publisher that takes its tag. The tag is `all` unless you set `EventModel(tag="observability")`, so your event reaches event publishers and tracing publishers alike. Use `only="events"` to skip tracing backends. Your event has no `event_name`, so consumers that switch on it should ignore events without one.

## Summary

Events are the nerve system of production AI agents. 10xGraph emits them in a structured format that captures context and content. Event publishers get a short stream of run, node and tool events, and tracing publishers get the detail they need for spans. Publishers fan them out to backends for logging, tracing, metrics, and alerting. The framework provides publishers for Console (dev), Redis, Kafka, RabbitMQ, OTEL, LangSmith, and Logfire, and you can build your own by subclassing `BasePublisher`. Metrics and tracing work through OTEL, so your existing observability stack can integrate with minimal configuration.

For production, start with OTEL + one backend (Datadog, New Relic, Jaeger), add a metrics exporter, and layer in Redis or Kafka for event replay if needed.
