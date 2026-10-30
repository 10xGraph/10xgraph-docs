---
title: Publishers
seoTitle: "Publishers API reference (Python)"
description: "Reference for EventModel, BasePublisher, the Console, Redis, Kafka, RabbitMQ, OTEL, Logfire and LangSmith publishers, and publish_event."
section: Reference
group: "Python library"
order: 190
label: Publishers
updated: "2026-10-29"
faq:
  - q: "How do I attach a publisher to a graph?"
    a: "Pass the publisher, or a list of publishers, to StateGraph(publisher=...). Tracing helpers such as setup_tracing and setup_logfire must run before compile()."
  - q: "What is the difference between bus publishers and tracing publishers?"
    a: "Bus publishers (Console, Redis, Kafka, RabbitMQ) send each EventModel to a logger or message bus. Tracing publishers (OTEL, Logfire, LangSmith) turn events into spans."
  - q: "Do I need to call publish_event myself?"
    a: "No. The runtime publishes events automatically. Call publish_event only to emit a custom event from a node or tool."
---

Publishers receive an `EventModel` for every graph, node, LLM, tool and streaming step, so you can send execution events to a logger, a message bus or a tracing backend. This page lists each publisher class, its configuration, its defaults, and the `publish_event` helper for custom events. For a task-oriented walkthrough, see [Use publishers](/docs/guides/use-publishers); for the concepts, see [Events and observability](/docs/concepts/events-and-observability).

## Delivery guarantees

Publisher events are best-effort background work. Sync `invoke()` and `stream()` wait up to `shutdown_timeout` (default 30 s) for pending events, memory writes and thread naming before they return. The async `ainvoke()` and `astream()` do not wait: call `await graph.aclose()` before the process exits. At most 1000 background tasks can be pending. Beyond that, new ones are dropped, a WARNING is logged at most every 5 s, and the `background_task_manager.tasks_dropped` counter increases. Delivery is at-most-once, with no retry. A slow or unreachable sink loses events and never blocks a run.

### Large state snapshots

Some events carry the run state in `data["state"]`. Events are queued in the background before the sink sends them, and a queued event must not hold a whole run state while the sink is slow. When the JSON form of `data["state"]` is longer than `state_snapshot_limit` characters, the event carries a summary in its place. Set the limit in the publisher config:

```python
publisher = RedisPublisher(config={"url": "redis://localhost:6379", "state_snapshot_limit": 131072})
```

| Value | Meaning |
|---|---|
| not set | 65536 characters |
| a positive integer | Summarize states longer than this many JSON characters |
| `0`, `None` or a negative number | No limit: the full state is always sent |

A state at or under the limit is sent unchanged. A longer one is replaced by a dict with these fields:

| Field | Description |
|---|---|
| `truncated` | Always `True`, so a consumer can tell a summary from a real state. |
| `bytes` | The size of the original state as JSON, in characters. |
| `fields` | Sorted names of the state's top-level fields. |
| `context_count` | The number of messages in the state's `context`. |
| `context` | The last 50 messages as `{"message_id", "role"}`. A system message of 8 KiB or less is included whole. |
| `context_summary` | The state's `context_summary`, cut to 1000 characters. Present only when the state has one. |
| `execution_meta` | The state's `execution_meta`, included whole when it is under 8 KiB. |

Only the published event is affected. The state in your checkpointer and the state your nodes see are not changed. If a consumer reads message text from `data["state"]`, raise the limit or set it to `0`.

## Import paths

```python title="imports.py"
from tenxgraph.core.graph import StateGraph
from tenxgraph.runtime.publisher import BasePublisher, ConsolePublisher
from tenxgraph.runtime.publisher.events import Event, EventType, ContentType, EventModel
from tenxgraph.runtime.publisher import publish_event

# Optional backends
from tenxgraph.runtime.publisher import RedisPublisher     # pip install "10xgraph[redis]"
from tenxgraph.runtime.publisher import KafkaPublisher     # pip install "10xgraph[kafka]"
from tenxgraph.runtime.publisher import RabbitMQPublisher  # pip install "10xgraph[rabbitmq]"

# Fan-out
from tenxgraph.runtime.publisher import CompositePublisher

# Tracing backends
from tenxgraph.runtime.publisher import (
    ObservabilityLevel,
    OtelPublisher,
    LogfirePublisher,
    LangsmithPublisher,
    setup_tracing,
    setup_logfire,
    setup_langsmith,
    setup_observability,
)
```

---

## `EventModel`

`EventModel` is the pydantic model every publisher receives. The runtime emits one at each significant moment: node start and end, LLM call, tool call, streaming chunk and error. Enum fields are stored as their string values (`use_enum_values`).

**Signature:**

```python
class EventModel(BaseModel):
    event: Event
    event_type: EventType
    content: str = ""
    content_blocks: list[ContentBlock] | None = None
    data: dict[str, Any] = {}
    content_type: list[ContentType] | None = None
    node_name: str = ""
    run_id: str  # default: new UUID4 string
    thread_id: str | int = ""
    user_id: str | int | None = None
    timestamp: float  # default: current time
    is_error: bool = False
    metadata: dict[str, Any] = {}
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `event` | `Event` | (required) | Source: `GRAPH_EXECUTION`, `NODE_EXECUTION`, `LLM_CALL`, `TOOL_EXECUTION`, `STREAMING`, or `REALTIME`. |
| `event_type` | `EventType` | (required) | Phase: `START`, `PROGRESS`, `RESULT`, `END`, `UPDATE`, `ERROR`, or `INTERRUPTED`. |
| `content` | `str` | `""` | Streamed textual content. |
| `content_blocks` | `list[ContentBlock] \| None` | `None` | Structured content blocks (TextBlock, ImageBlock, etc.) for multimodal or structured streaming. |
| `data` | `dict[str, Any]` | `{}` | Structured payload carrying event details. |
| `content_type` | `list[ContentType] \| None` | `None` | Semantic types of the payload (may be a list). |
| `node_name` | `str` | `""` | Name of the graph node that produced this event. |
| `run_id` | `str` | new UUID4 string | Unique ID for the execution run. |
| `thread_id` | `str \| int` | `""` | Thread ID for resumable execution. |
| `user_id` | `str \| int \| None` | `None` | User ID associated with the execution (from config). |
| `timestamp` | `float` | current time | UNIX timestamp when the event was created. |
| `is_error` | `bool` | `False` | True when the event represents an error state. |
| `metadata` | `dict[str, Any]` | `{}` | Additional context for consumers (run_timestamp, is_stream, etc.). |

**Example:**

```python
from tenxgraph.runtime.publisher.events import EventModel, Event, EventType, ContentType

# The runtime normally creates these; build one by hand for custom events
event = EventModel(
    event=Event.NODE_EXECUTION,
    event_type=EventType.START,
    node_name="agent",
    run_id="run-123",
    thread_id="thread-456",
    content_type=[ContentType.MESSAGE],
    data={"model": "gpt-4", "temperature": 0.7},
)
```

---

## `Event` - source enum

Where the event originated.

| Value | Description |
|---|---|
| `GRAPH_EXECUTION` | Emitted by the graph runner (start/end of full invocation). |
| `NODE_EXECUTION` | Emitted at the start and end of each node run. |
| `LLM_CALL` | Emitted for individual LLM API calls within a node. |
| `TOOL_EXECUTION` | Emitted before and after each tool call. |
| `STREAMING` | Emitted for each incremental streaming chunk from the LLM. |
| `REALTIME` | Emitted by realtime audio-to-audio sessions. |

---

## `EventType` - phase enum

What phase of execution this event represents.

| Value | When emitted |
|---|---|
| `START` | Execution begins. |
| `PROGRESS` | Intermediate update during streaming (incremental chunk). |
| `RESULT` | A result is ready (tool result, LLM completion). |
| `END` | Execution ends (success or error). |
| `UPDATE` | State or data updated. |
| `ERROR` | An error occurred. |
| `INTERRUPTED` | Execution paused at an interrupt point. |

---

## `ContentType` - payload type enum

Semantic label for what is in the event payload.

| Value | When used |
|---|---|
| `TEXT` | Plain text output or content. |
| `MESSAGE` | Full Message object. |
| `REASONING` | Extended thinking trace or reasoning. |
| `TOOL_CALL` | Tool invocation request (from LLM). |
| `TOOL_RESULT` | Tool execution result. |
| `IMAGE` | Image content. |
| `AUDIO` | Audio content. |
| `TRANSCRIPT` | Text transcript of audio (realtime sessions). |
| `VIDEO` | Video content. |
| `DOCUMENT` | Document content. |
| `DATA` | Binary or structured data. |
| `STATE` | Graph state snapshot. |
| `UPDATE` | Incremental state update. |
| `ERROR` | Error payload or error details. |

---

## LLM span events

Each model call publishes an `Event.LLM_CALL` span: a `START` event when the request goes out, then one `END` or one `ERROR` event.

| Event | When | `data` fields |
|---|---|---|
| `START` | The request is sent | `model`, `provider`, `input_messages`, `system_prompt`, `request_params`, `tool_count` |
| `END` | The call finished | `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens`, `reasoning_tokens`, `finish_reason`, `response_model` |
| `ERROR` | The call or the stream failed | `error` (the exception type name); `is_error` is `True` |

A non-streaming call also adds `output_response` and `response_id` to the `END` event.

For a streaming call, the span ends when the stream ends, not when the first chunk arrives. The `END` event is published once the last chunk has been read, so it carries the real token counts from the final chunks and the `finish_reason` and `response_model` the provider reported. If the stream fails partway (a connection drop, a [stream idle timeout](/docs/concepts/errors-and-limits#llm-stream-idle-timeout)), an `ERROR` event is published instead, with whatever usage was available. The cost and latency a tracing backend shows for a streaming call therefore covers the whole stream.

---

## `BasePublisher`

`BasePublisher` is the abstract base class for all publishers. Subclasses implement `publish`, `close` and `sync_close`. It stores the config dict as `self.config`, which may carry an optional `publish_timeout` (seconds, no default) that bounds one send: if a send takes longer, the error is logged and that event is dropped. Without it, a publish waits for the broker. Queued events are snapshots taken when they are emitted, so consumers see the real `START` and `PROGRESS` events rather than later state, and a failed LLM call publishes an `ERROR` event. It also tracks closed state in `self._is_closed`, and works as an async context manager that calls `close()` on exit.

**Signature:**

```python
class BasePublisher(ABC):
    def __init__(self, config: dict[str, Any])

    @abstractmethod
    async def publish(self, event: EventModel) -> Any
    
    @abstractmethod
    async def close(self) -> None

    @abstractmethod
    def sync_close(self) -> None
```

| Method | Returns | Raises | Description |
|---|---|---|---|
| `publish(event)` | `Any` | `RuntimeError` (built-in publishers) | Publish one event. Built-in publishers raise if the publisher is closed. |
| `close()` | `None` | - | Release connections and resources (idempotent, async). |
| `sync_close()` | `None` | - | Release connections and resources (idempotent, synchronous). |

**Example:**

```python title="context_manager.py"
import asyncio

from tenxgraph.core.graph import StateGraph
from tenxgraph.core.state import AgentState, Message
from tenxgraph.runtime.publisher import ConsolePublisher
from tenxgraph.utils.constants import END, START


def echo(state: AgentState) -> list[Message]:
    return [Message.text_message("hello", role="assistant")]


async def main() -> None:
    # The publisher is closed automatically when the block exits
    async with ConsolePublisher() as publisher:
        graph = StateGraph(publisher=publisher)
        graph.add_node("echo", echo)
        graph.add_edge(START, "echo")
        graph.add_edge("echo", END)
        app = graph.compile()
        await app.ainvoke({"messages": [Message.text_message("hi")]})


asyncio.run(main())
```

---

## `ConsolePublisher`

`ConsolePublisher` prints each event as one line to stdout, or sends it to the `tenxgraph.publisher` logger at `INFO` level. It is for development and debugging; use a real transport in production.

**Signature:**

```python
class ConsolePublisher(BasePublisher):
    def __init__(self, config: dict[str, Any] | None = None)
```

| Config key | Type | Default | Description |
|---|---|---|---|
| `use_logger` | `bool` | `False` | When `True`, emit through the `tenxgraph.publisher` logger at `INFO` instead of `print`. |
| `format` | `str` | `"json"` | Stored on the instance. The current output is a single text line regardless of this value. |
| `include_timestamp` | `bool` | `True` | Stored on the instance. The timestamp is always part of the line. |
| `indent` | `int` | `2` | Stored on the instance. Not used by the current output. |

Each line has the form `<timestamp> -> Source: <node_name>.<event_type>:-> Payload: <data> -> <metadata>`. `publish` raises `RuntimeError` after `close()`.

**Example:**

```python title="console_publisher.py"
from tenxgraph.core.graph import StateGraph
from tenxgraph.runtime.publisher import ConsolePublisher

# Print events to stdout
publisher = ConsolePublisher()

# Or route them through the logger, so they follow your logging config
publisher = ConsolePublisher(config={"use_logger": True})

graph = StateGraph(publisher=publisher)
```

---

## `RedisPublisher`

`RedisPublisher` sends each event as JSON to a Redis Pub/Sub channel (default) or appends it to a Redis Stream. It connects lazily on the first publish, using a connection pool and a `ping` check.

**Requires:** `pip install "10xgraph[redis]"`

**Signature:**

```python
class RedisPublisher(BasePublisher):
    def __init__(self, config: dict[str, Any] | None = None)
```

| Config key | Type | Default | Description |
|---|---|---|---|
| `url` | `str` | `redis://localhost:6379/0` | Redis connection URL. |
| `mode` | `str` | `"pubsub"` | `"pubsub"` for Pub/Sub, `"stream"` for Redis Streams (`XADD`). |
| `channel` | `str` | `tenxgraph.events` | Pub/Sub channel (pubsub mode). |
| `stream` | `str` | `tenxgraph.events` | Stream key (stream mode). |
| `maxlen` | `int \| None` | `None` | Approximate maximum stream length (stream mode). Unbounded when unset. |
| `encoding` | `str` | `"utf-8"` | Payload encoding. |
| `max_connections` | `int` | `10` | Connection pool size. |
| `socket_timeout` | `float` | `5.0` | Socket timeout in seconds. |
| `socket_connect_timeout` | `float` | `5.0` | Connect timeout in seconds. |
| `socket_keepalive` | `bool` | `True` | Enable TCP keepalive. |
| `health_check_interval` | `int` | `30` | Connection health check interval in seconds. |

**Returns:** from `publish`, the subscriber count (pubsub) or the stream entry ID (stream). In stream mode the JSON payload is stored in the entry's `data` field.

**Raises:** `RuntimeError` if the publisher is closed, the `redis` package is missing, or the connection fails.

**Example:**

```python title="redis_publisher.py"
from tenxgraph.core.graph import StateGraph
from tenxgraph.runtime.publisher import RedisPublisher

# Pub/Sub on a named channel
pubsub = RedisPublisher(config={"url": "redis://localhost:6379/0", "channel": "agent-events"})

# Stream mode with a bounded length
stream = RedisPublisher(config={"mode": "stream", "stream": "agent-events", "maxlen": 10000})

graph = StateGraph(publisher=stream)
```

---

## `KafkaPublisher`

`KafkaPublisher` sends each event as a UTF-8 JSON message to a Kafka topic with `aiokafka`, waiting for the broker acknowledgement. The producer starts lazily on the first publish. If the first start fails, the next publish tries again instead of staying closed. `RedisPublisher` does the same.

**Requires:** `pip install "10xgraph[kafka]"`

**Signature:**

```python
class KafkaPublisher(BasePublisher):
    def __init__(self, config: dict[str, Any] | None = None)
```

| Config key | Type | Default | Description |
|---|---|---|---|
| `bootstrap_servers` | `str` | `localhost:9092` | Kafka bootstrap servers. |
| `topic` | `str` | `tenxgraph.events` | Topic to publish to. |
| `client_id` | `str \| None` | `None` | Producer client ID. |
| `max_batch_size` | `int` | `16384` | Maximum batch size in bytes. |
| `linger_ms` | `int` | `0` | Time to wait for more messages before sending a batch. |
| `compression_type` | `str \| None` | `None` | Passed to `aiokafka` (for example `"gzip"`). |
| `request_timeout_ms` | `int` | `30000` | Request timeout in milliseconds. |
| `security_protocol` | `str` | not set | `"PLAINTEXT"`, `"SSL"`, `"SASL_PLAINTEXT"` or `"SASL_SSL"`. |
| `ssl_context` | `ssl.SSLContext` | not set | Pre-built context. Wins over the file keys. |
| `ssl_cafile`, `ssl_certfile`, `ssl_keyfile` | `str` | not set | PEM file paths. When any is set and there is no `ssl_context`, an `SSLContext` is built from them. |
| `sasl_mechanism` | `str` | not set | For example `"PLAIN"`, `"SCRAM-SHA-256"`, `"SCRAM-SHA-512"`. |
| `sasl_plain_username`, `sasl_plain_password` | `str` | not set | SASL credentials. |

The TLS and SASL keys are opt-in and passed to `aiokafka` only when set. TLS is never forced. Events carry full message and tool content, so we recommend `"SSL"` or `"SASL_SSL"` in production, and always on networks you do not control; a broker inside a network you secure yourself can run without it. For Redis use a `rediss://` URL, and for RabbitMQ an `amqps://` URL. See [Emit events from your graph](/docs/guides/use-publishers) for a TLS and SASL example.

**Returns:** from `publish`, the result of `send_and_wait`. **Raises:** `RuntimeError` if closed or `aiokafka` is missing.

**Example:**

```python title="kafka_publisher.py"
from tenxgraph.core.graph import StateGraph
from tenxgraph.runtime.publisher import KafkaPublisher

publisher = KafkaPublisher(config={
    "bootstrap_servers": "localhost:9092",
    "topic": "agent-events",
    "compression_type": "gzip",
})

graph = StateGraph(publisher=publisher)
```

---

## `RabbitMQPublisher`

`RabbitMQPublisher` sends each event as a JSON message to a RabbitMQ exchange with a routing key, using `aio-pika` and a robust (auto-reconnecting) connection. It connects lazily on the first publish.

**Requires:** `pip install "10xgraph[rabbitmq]"`

**Signature:**

```python
class RabbitMQPublisher(BasePublisher):
    def __init__(self, config: dict[str, Any] | None = None)
```

| Config key | Type | Default | Description |
|---|---|---|---|
| `url` | `str` | `amqp://guest:guest@localhost/` | RabbitMQ connection URL. |
| `exchange` | `str` | `tenxgraph.events` | Exchange name. |
| `routing_key` | `str` | `tenxgraph.events` | Routing key for messages. |
| `exchange_type` | `str` | `"topic"` | Exchange type (for example `"topic"`, `"direct"`, `"fanout"`). Unknown values fall back to topic. |
| `declare` | `bool` | `True` | Declare the exchange. When `False`, the default exchange is used. |
| `durable` | `bool` | `True` | Declare the exchange as durable. |
| `connection_timeout` | `int` | `10` | Connect timeout in seconds. It also bounds opening the channel and declaring the exchange after the connection is up. If that step fails or times out, the connection is closed and the next publish starts clean. |
| `heartbeat` | `int` | `60` | Heartbeat interval in seconds. |
| `publish_timeout` | `float` | none | Seconds to wait for one send to the exchange. Unset waits for the broker. A send that times out is logged and that event is dropped. |

**Returns:** `True` from `publish`. **Raises:** `RuntimeError` if closed or `aio-pika` is missing.

**Example:**

```python title="rabbitmq_publisher.py"
from tenxgraph.core.graph import StateGraph
from tenxgraph.runtime.publisher import RabbitMQPublisher

publisher = RabbitMQPublisher(config={
    "url": "amqp://guest:guest@localhost:5672/",
    "exchange": "agent-events",
    "routing_key": "graph.events",
})

graph = StateGraph(publisher=publisher)
```

---

## `CompositePublisher`

`CompositePublisher` fans each event out to several publishers concurrently with `asyncio.gather`. Exceptions from one publisher are swallowed (`return_exceptions=True`) so the others still receive the event. `StateGraph(publisher=[...])` with a list builds one for you.

**Signature:**

```python
class CompositePublisher(BasePublisher):
    def __init__(self, publishers: list[BasePublisher])
    def add_publisher(self, publisher: BasePublisher) -> None
    def remove_publisher(self, publisher: BasePublisher) -> None
```

| Method | Returns | Description |
|---|---|---|
| `add_publisher(publisher)` | `None` | Append a publisher to the fan-out list. |
| `remove_publisher(publisher)` | `None` | Remove a publisher. Raises `ValueError` if it is not in the list. |
| `close()` | `None` | Close every child publisher concurrently. |
| `sync_close()` | `None` | Close every child publisher synchronously, in order. |

**Example:**

```python title="composite_publisher.py"
from tenxgraph.core.graph import StateGraph
from tenxgraph.runtime.publisher import CompositePublisher, ConsolePublisher, RedisPublisher

publisher = CompositePublisher([
    ConsolePublisher(),
    RedisPublisher({"url": "redis://localhost:6379/0"}),
])

graph = StateGraph(publisher=publisher)
# Equivalent: StateGraph(publisher=[ConsolePublisher(), RedisPublisher(...)])
```

---

## `ObservabilityLevel`

`ObservabilityLevel` is a string enum that controls how much data the tracing publishers put on spans. The default is `STANDARD`; use `FULL` only where prompts and responses may be stored.

| Value | String | Captures |
|---|---|---|
| `SPANS` | `"spans"` | Timing and structure only, no I/O data. |
| `STANDARD` | `"standard"` | Adds token counts, model name and request parameters when available. Default. |
| `FULL` | `"full"` | Adds model input and output messages, tool I/O and the system prompt. May contain PII. |

---

## `OtelPublisher`

`OtelPublisher` turns `EventModel` events into OpenTelemetry spans, tracking parent and child spans explicitly. Attach it before `compile()`, because the publisher is bound into the dependency container at compile time.

**Requires:** `pip install "10xgraph[otel]"`

**Signature:**

```python
class OtelPublisher(BasePublisher):
    def __init__(
        self,
        tracer: Tracer | None = None,
        level: ObservabilityLevel = ObservabilityLevel.STANDARD,
        user_id_mode: UserIdMode = "raw",
    )

def setup_tracing(
    graph: StateGraph,
    tracer: Tracer | None = None,
    level: ObservabilityLevel = ObservabilityLevel.STANDARD,
    user_id_mode: UserIdMode = "raw",
) -> OtelPublisher
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `graph` | `StateGraph` | (required) | `setup_tracing` only. Graph to instrument. |
| `tracer` | `Tracer \| None` | `None` | Explicit tracer. Uses the global `TracerProvider` (tracer name `10xgraph`) when omitted. |
| `level` | `ObservabilityLevel` | `STANDARD` | Span detail level. Prompts and tool I/O are recorded only at `FULL`. |
| `user_id_mode` | `"raw" \| "hash" \| "mask"` | `"raw"` | How `user_id` appears on spans. See below. |

**`user_id_mode`:**

- `"raw"`: the id is emitted unchanged.
- `"hash"`: the first 16 hex characters of SHA-256 of the id. If the environment variable `TENXGRAPH_TRACE_USER_ID_KEY` is set, HMAC-SHA256 with that key is used instead. The same id always gives the same value, so one user's spans still group together. Plain SHA-256 of a short id (an email, a small integer) can be recovered by guessing, so set the key.
- `"mask"`: ids of 4 characters or fewer become `***`; 5 to 7 characters keep one character on each side (`a***e`); 8 or more keep two on each side (`al***42`).

It applies to OTEL spans, and so to Logfire and LangSmith. It does not change Redis, RabbitMQ, Kafka or Console events. An unknown value raises `ValueError`.

**Returns:** `setup_tracing` returns the `OtelPublisher` it assigned to the graph. **Raises:** `ImportError` if `opentelemetry-api` is not installed.

**Example:**

```python title="otel_tracing.py"
from tenxgraph.core.graph import StateGraph
from tenxgraph.runtime.publisher import ObservabilityLevel, setup_tracing

graph = StateGraph()
# ... add nodes and edges

# Attach tracing before compile
setup_tracing(graph, level=ObservabilityLevel.STANDARD)
app = graph.compile()
```

---

## `LogfirePublisher` and `setup_logfire`

`LogfirePublisher` is an `OtelPublisher` that calls `logfire.configure()` on construction and exports spans to Logfire. `setup_logfire` does the same configuration and also instruments a graph with `setup_tracing`.

**Requires:** `pip install "10xgraph[logfire]"`

**Signature:**

```python
class LogfirePublisher(OtelPublisher):
    def __init__(
        self,
        *,
        token: str | None = None,
        service_name: str | None = None,
        send_to_logfire: bool = True,
        console: Any = None,
        level: ObservabilityLevel = ObservabilityLevel.STANDARD,
        additional_span_processors: list | None = None,
        **configure_kwargs: Any,
    )

def setup_logfire(
    graph: StateGraph | None = None,
    *,
    token: str | None = None,
    service_name: str | None = None,
    send_to_logfire: bool = True,
    console: Any = None,
    level: ObservabilityLevel = ObservabilityLevel.STANDARD,
    user_id_mode: UserIdMode = "raw",
    additional_span_processors: list | None = None,
    **configure_kwargs: Any,
) -> None
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `graph` | `StateGraph \| None` | `None` | `setup_logfire` only. `None` configures Logfire without attaching a publisher. |
| `token` | `str \| None` | `None` | Logfire write token. Falls back to the `LOGFIRE_TOKEN` environment variable. |
| `service_name` | `str \| None` | `None` | Service name shown in the Logfire UI. |
| `send_to_logfire` | `bool` | `True` | Export spans to Logfire. |
| `console` | `Any` | `None` | `False` to suppress console output, a `logfire.ConsoleOptions`, or `None` for environment defaults. |
| `level` | `ObservabilityLevel` | `STANDARD` | Span detail level. |
| `user_id_mode` | `str` | `"raw"` | `"raw"`, `"hash"` or `"mask"`. See `OtelPublisher`. |
| `additional_span_processors` | `list \| None` | `None` | Extra `SpanProcessor` instances. |
| `**configure_kwargs` | `Any` | | Forwarded to `logfire.configure()`. |

**Returns:** `setup_logfire` returns `None`. **Raises:** `ImportError` if `logfire` is not installed.

**Example:**

```python title="logfire_tracing.py"
from tenxgraph.core.graph import StateGraph
from tenxgraph.runtime.publisher import setup_logfire

graph = StateGraph()
# ... add nodes and edges

# Reads LOGFIRE_TOKEN from the environment
setup_logfire(graph, service_name="my-agent")
app = graph.compile()
```

---

## `LangsmithPublisher` and `setup_langsmith`

`LangsmithPublisher` is an `OtelPublisher` that builds an OTLP HTTP exporter for LangSmith and installs it on a tracer provider. `setup_langsmith` does the same and also instruments a graph.

**Requires:** `pip install "10xgraph[langsmith]"`

**Signature:**

```python
class LangsmithPublisher(OtelPublisher):
    def __init__(
        self,
        *,
        api_key: str | None = None,
        project: str | None = None,
        endpoint: str = "https://api.smith.langchain.com/otel",
        level: ObservabilityLevel = ObservabilityLevel.STANDARD,
        tracer_provider: Any = None,
    )

def setup_langsmith(
    graph: StateGraph | None = None,
    *,
    api_key: str | None = None,
    project: str | None = None,
    endpoint: str = "https://api.smith.langchain.com/otel",
    level: ObservabilityLevel = ObservabilityLevel.STANDARD,
    user_id_mode: UserIdMode = "raw",
    tracer_provider: Any = None,
) -> None
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `graph` | `StateGraph \| None` | `None` | `setup_langsmith` only. `None` configures the exporter without attaching a publisher. |
| `api_key` | `str \| None` | `None` | LangSmith API key. Falls back to the `LANGSMITH_API_KEY` environment variable. |
| `project` | `str \| None` | `None` | Project name, sent as the `Langsmith-Project` header. |
| `endpoint` | `str` | `https://api.smith.langchain.com/otel` | OTLP base URL. `/v1/traces` is appended. Override for regional deployments. |
| `level` | `ObservabilityLevel` | `STANDARD` | Span detail level. |
| `user_id_mode` | `str` | `"raw"` | `"raw"`, `"hash"` or `"mask"`. See `OtelPublisher`. |
| `tracer_provider` | `Any` | `None` | Existing `TracerProvider` to attach to. A new global one is created when omitted. |

**Returns:** `setup_langsmith` returns `None`. **Raises:** `ImportError` if the OTLP HTTP exporter or SDK is missing; `ValueError` if no API key is given and `LANGSMITH_API_KEY` is unset.

**Example:**

```python title="langsmith_tracing.py"
from tenxgraph.core.graph import StateGraph
from tenxgraph.runtime.publisher import setup_langsmith

graph = StateGraph()
# ... add nodes and edges

# Reads LANGSMITH_API_KEY from the environment
setup_langsmith(graph, project="my-project")
app = graph.compile()
```

---

## `setup_observability`

`setup_observability` enables Logfire, LangSmith or both from a config dict that mirrors the `observability` block of `10xgraph.json`. When both are enabled they share one `TracerProvider`. If neither is enabled it does nothing.

**Signature:**

```python
def setup_observability(graph: StateGraph | None, config: dict[str, Any]) -> None
```

| Parameter | Type | Description |
|---|---|---|
| `graph` | `StateGraph \| None` | Graph to instrument. `None` configures providers only. |
| `config` | `dict[str, Any]` | Dict with `level` (`"spans"`, `"standard"` or `"full"`; unknown values fall back to `"standard"`), `user_id_mode` (`"raw"`, `"hash"` or `"mask"`; top-level key), `logfire` and `langsmith` blocks. |

| Config key | Description |
|---|---|
| `logfire.enabled` | Turn Logfire on. Default `False`. |
| `logfire.service_name`, `logfire.send_to_logfire`, `logfire.console` | Passed to `setup_logfire`. `send_to_logfire` defaults to `True`. |
| `langsmith.enabled` | Turn LangSmith on. Default `False`. |
| `langsmith.project`, `langsmith.endpoint` | Project name and OTLP base URL. |

An invalid `user_id_mode` raises `ValueError`.

Secrets (`LOGFIRE_TOKEN`, `LANGSMITH_API_KEY`) come from environment variables only, never from the config. It raises `ImportError` if a requested backend is not installed and `ValueError` if LangSmith is enabled without an API key.

**Example:**

```python title="observability.py"
from tenxgraph.core.graph import StateGraph
from tenxgraph.runtime.publisher import setup_observability

graph = StateGraph()
# ... add nodes and edges

setup_observability(graph, {
    "level": "standard",
    "user_id_mode": "hash",
    "logfire": {"enabled": True, "service_name": "my-agent"},
    "langsmith": {"enabled": True, "project": "eval"},
})
app = graph.compile()
```

---

## `publish_event`

`publish_event` emits a custom `EventModel` from inside a node or tool. It does not block: the event is handed to the background task manager, which calls the bound publisher. If no publisher is bound, it returns immediately. Publish failures are logged, not raised.

**Signature:**

```python
def publish_event(
    event: EventModel,
    publisher: BasePublisher | None = Inject[BasePublisher],
    task_manager: BackgroundTaskManager = Inject[BackgroundTaskManager],
) -> None
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `event` | `EventModel` | (required) | The event to publish. |
| `publisher` | `BasePublisher \| None` | `Inject[BasePublisher]` | Injected. Leave it unset. |
| `task_manager` | `BackgroundTaskManager` | `Inject[BackgroundTaskManager]` | Injected. Leave it unset. |

**Returns:** `None`.

**Example:**

```python title="custom_event_tool.py"
from tenxgraph.runtime.publisher import publish_event
from tenxgraph.runtime.publisher.events import ContentType, Event, EventModel, EventType
from tenxgraph.utils import tool


@tool
def shout(query: str) -> str:
    """Uppercase the query and emit a custom event."""
    result = query.upper()
    publish_event(
        EventModel(
            event=Event.TOOL_EXECUTION,
            event_type=EventType.RESULT,
            node_name="shout",
            content=result,
            content_type=[ContentType.TEXT],
            data={"query": query, "result_length": len(result)},
        )
    )
    return result
```

---

## Writing a custom publisher

Subclass `BasePublisher`, call `super().__init__(config)`, and implement `publish`, `close` and `sync_close`. Honor `self._is_closed` and keep `close` idempotent. This example posts events to a webhook with `httpx` (`pip install httpx`).

```python title="webhook_publisher.py"
import asyncio
from typing import Any

import httpx

from tenxgraph.core.graph import StateGraph
from tenxgraph.runtime.publisher import BasePublisher
from tenxgraph.runtime.publisher.events import EventModel


class WebhookPublisher(BasePublisher):
    """Post each event as JSON to a webhook."""

    def __init__(self, webhook_url: str, config: dict[str, Any] | None = None):
        super().__init__(config or {})
        self.webhook_url = webhook_url
        self._client: httpx.AsyncClient | None = None

    async def publish(self, event: EventModel) -> None:
        if self._is_closed:
            raise RuntimeError("Cannot publish to closed WebhookPublisher")
        if self._client is None:
            self._client = httpx.AsyncClient()
        await self._client.post(self.webhook_url, json=event.model_dump(mode="json"))

    async def close(self) -> None:
        if self._is_closed:
            return
        if self._client is not None:
            await self._client.aclose()
            self._client = None
        self._is_closed = True

    def sync_close(self) -> None:
        asyncio.run(self.close())


publisher = WebhookPublisher("https://example.com/events")
graph = StateGraph(publisher=publisher)
```
