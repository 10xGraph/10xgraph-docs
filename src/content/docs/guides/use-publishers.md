---
title: Emit events from your graph
description: "Forward structured events to observability systems using Redis, Kafka, RabbitMQ and more."
section: "Build agents"
group: "Observability and operations"
order: 390
label: Publishers
updated: "2026-10-27"
---

Publishers allow you to observe and audit agent execution by forwarding structured events to external systems. Every time your graph runs, publishers emit events for graph starts and ends, node execution, tool calls, LLM requests, state updates, errors, and streaming tokens. You can subscribe to these events in real-time to monitor your agent, log audits, trigger alerts, or analyze behavior. Publishers are optional: your graph works without them, but adding one is essential for production deployments.

## Why publishers matter

In development, you might test your agent locally and call it once. In production, you're serving many requests concurrently, and something goes wrong. Without visibility into what the agent was doing, debugging becomes expensive. Publishers create an event stream that records the exact sequence of execution, including what the agent decided and why. You can stream these events to monitoring platforms, log aggregators, or data warehouses for analysis.

10xGraph publishes structured `EventModel` events: not strings, but typed dictionaries with semantic fields. This lets downstream systems (monitoring, logging, or analytics) parse and act on them reliably, even as your agent evolves.

---

## Add a publisher to your graph

### Prerequisites

Import the publisher class and install the optional dependency if needed:

```bash
# Console: no install needed
# Provider for the examples below: pip install "10xgraph[openai]"
# Redis: pip install "10xgraph[redis]"
# Kafka: pip install "10xgraph[kafka]"
# RabbitMQ: pip install "10xgraph[rabbitmq]"
```

### Step 1: Create a publisher instance

Pick a transport and instantiate the publisher with its configuration. Here is Redis as an example:

```python
from tenxgraph.runtime.publisher import RedisPublisher

publisher = RedisPublisher({
    "url": "redis://localhost:6379/0",
    "mode": "stream",
    "stream": "agent.events",
    "maxlen": 50000,
})
```

### Step 2: Pass it to StateGraph

When you instantiate your graph, pass the publisher:

```python
from tenxgraph.core.graph import StateGraph, Agent
from tenxgraph.core.state import Message

graph = StateGraph(publisher=publisher)
graph.add_node("MAIN", Agent(model="gpt-4o"))
graph.set_entry_point("MAIN")

app = graph.compile()
```

### Step 3: Run your agent and verify

Invoke your agent normally. Events are emitted asynchronously in the background.

```python
import asyncio

async def main():
    result = await app.ainvoke(
        {"messages": [Message.text_message("Hello")]},
        config={"thread_id": "test"},
    )
    print(result["messages"][-1].text())
    await publisher.close()  # flush pending events

asyncio.run(main())
```

For Redis Streams mode, you can read events in another terminal:

```python
import redis.asyncio as aioredis
import json

async def listen():
    r = aioredis.from_url("redis://localhost:6379/0")
    # Start from the earliest event
    for _stream, entries in await r.xread({"agent.events": "0"}, count=10):
        for _msg_id, fields in entries:
            event = json.loads(fields[b"data"])
            print(f"Event: {event['event']} / {event['event_type']}")

asyncio.run(listen())
```

You should see output like `Event: node_execution / start`, `Event: llm_call / start`, `Event: node_execution / end`, etc.

---

## Publisher types

Redis, RabbitMQ and Kafka publishers send the full event, including message text and tool inputs and results. Send them only to systems you trust. 10xGraph never forces TLS, so it is your call: we recommend TLS in production whenever you can, and always on a network you do not control. A broker reachable only inside a network you secure yourself (a private subnet or VPC, or a service mesh that already encrypts traffic) can run without it. See [What is in your traces and events](/docs/concepts/events-and-observability#what-is-in-your-traces-and-events).

### ConsolePublisher

Prints events to stdout or the `tenxgraph.publisher` logger. Good for debugging locally in development.

```python
from tenxgraph.runtime.publisher import ConsolePublisher

# Default: print to stdout
publisher = ConsolePublisher()

# Or route through the logger (better for servers)
publisher = ConsolePublisher(config={"use_logger": True})
```

**Use only in development.** Stdout is noisy and not suitable for production. Switch to a real transport (Redis, Kafka, RabbitMQ) before deploying.

---

### RedisPublisher

Publishes events to a Redis channel or stream. Choose Pub/Sub for real-time subscribers or Streams for durable retention.

#### Pub/Sub mode

```python
from tenxgraph.runtime.publisher import RedisPublisher

publisher = RedisPublisher({
    "url": "redis://localhost:6379/0",
    "mode": "pubsub",
    "channel": "agent.events",
})

graph = StateGraph(publisher=publisher)
```

Subscribe in another process to receive live events:

```python
import redis.asyncio as aioredis
import asyncio

async def listen():
    r = aioredis.from_url("redis://localhost:6379/0")
    pubsub = r.pubsub()
    await pubsub.subscribe("agent.events")
    async for msg in pubsub.listen():
        if msg["type"] == "message":
            print(msg["data"].decode())  # raw JSON event

asyncio.run(listen())
```

#### Streams mode

```python
publisher = RedisPublisher({
    "url": "redis://localhost:6379/0",
    "mode": "stream",
    "stream": "agent.events",
    "maxlen": 50000,  # keep the last 50k events
})
```

Streams mode is preferred for audit logs because events are persisted and you can replay them. Use Pub/Sub if you only care about live subscribers.

#### Configuration reference

| Key | Default | Notes |
|---|---|---|
| `url` | `"redis://localhost:6379/0"` | Redis connection URL. |
| `mode` | `"pubsub"` | `"pubsub"` or `"stream"`. |
| `channel` | `"tenxgraph.events"` | Pub/Sub channel name. |
| `stream` | `"tenxgraph.events"` | Redis Stream name. |
| `maxlen` | `None` | Max length cap for streams. |
| `max_connections` | `10` | Connection pool size. |
| `socket_timeout` | `5.0` | Socket timeout in seconds. |
| `socket_connect_timeout` | `5.0` | Connection timeout in seconds. |
| `socket_keepalive` | `True` | TCP keepalive. |
| `health_check_interval` | `30` | Health-check interval in seconds. |

For TLS, use a `rediss://` URL, for example `"url": "rediss://redis.example.com:6380/0"`.

---

### KafkaPublisher

Publishes events to a Kafka topic. Use this if your organization already runs Kafka for event streaming.

```python
from tenxgraph.runtime.publisher import KafkaPublisher

publisher = KafkaPublisher({
    "bootstrap_servers": "localhost:9092",
    "topic": "agent-events",
    "client_id": "my-agent-service",
    "compression_type": "gzip",
})

graph = StateGraph(publisher=publisher)
```

Consumers on the same topic receive all events in order:

```python
import asyncio
import json
from aiokafka import AIOKafkaConsumer

async def listen():
    consumer = AIOKafkaConsumer(
        "agent-events",
        bootstrap_servers="localhost:9092",
        value_deserializer=lambda m: json.loads(m.decode("utf-8")),
    )
    await consumer.start()
    try:
        async for record in consumer:
            print(f"Event: {record.value['event']}")
    finally:
        await consumer.stop()

asyncio.run(listen())
```

#### Configuration reference

| Key | Default | Notes |
|---|---|---|
| `bootstrap_servers` | `"localhost:9092"` | Comma-separated broker list. |
| `topic` | `"tenxgraph.events"` | Kafka topic to publish to. |
| `client_id` | `None` | Producer client ID. |
| `max_batch_size` | `16384` | Max batch size in bytes. |
| `linger_ms` | `0` | Time to wait for batching in ms. |
| `compression_type` | `None` | `"gzip"`, `"snappy"`, `"lz4"`, `"zstd"`, or `None`. |
| `request_timeout_ms` | `30000` | Request timeout in milliseconds. |
| `security_protocol` | not set | `"PLAINTEXT"`, `"SSL"`, `"SASL_PLAINTEXT"` or `"SASL_SSL"`. |
| `ssl_context` | not set | A ready `ssl.SSLContext`. Wins over the three file keys below. |
| `ssl_cafile` | not set | Path to the CA bundle (PEM). |
| `ssl_certfile` | not set | Path to the client certificate (PEM), for mutual TLS. |
| `ssl_keyfile` | not set | Path to the client private key (PEM). |
| `sasl_mechanism` | not set | `"PLAIN"`, `"SCRAM-SHA-256"` or `"SCRAM-SHA-512"`. |
| `sasl_plain_username` | not set | SASL user name. |
| `sasl_plain_password` | not set | SASL password. |

The TLS and SASL keys are passed to `aiokafka` only when you set them. If you set any of `ssl_cafile`, `ssl_certfile` or `ssl_keyfile` and no `ssl_context`, 10xGraph builds an `SSLContext` from those files.

#### Kafka with TLS and SASL

```python
import os
from tenxgraph.runtime.publisher import KafkaPublisher

publisher = KafkaPublisher({
    "bootstrap_servers": "broker1.example.com:9093,broker2.example.com:9093",
    "topic": "agent-events",
    "security_protocol": "SASL_SSL",
    "ssl_cafile": "/etc/ssl/kafka/ca.pem",
    "sasl_mechanism": "SCRAM-SHA-512",
    "sasl_plain_username": "agent-service",
    "sasl_plain_password": os.environ["KAFKA_PASSWORD"],
})
```

---

### RabbitMQPublisher

Publishes events to a RabbitMQ exchange. Use if RabbitMQ is part of your infrastructure.

```python
from tenxgraph.runtime.publisher import RabbitMQPublisher

publisher = RabbitMQPublisher({
    "url": "amqp://guest:guest@localhost/",
    "exchange": "agent.events",
    "routing_key": "agent.executions",
    "exchange_type": "topic",
    "durable": True,
})

graph = StateGraph(publisher=publisher)
```

Bind a queue to the exchange and consume:

```python
import asyncio
from aio_pika import connect_robust

async def listen():
    connection = await connect_robust("amqp://guest:guest@localhost/")
    channel = await connection.channel()
    exchange = await channel.get_exchange("agent.events")
    queue = await channel.declare_queue(auto_delete=True)
    await queue.bind(exchange, "agent.*")
    
    async for message in queue.iterator():
        print(message.body.decode())

asyncio.run(listen())
```

#### Configuration reference

| Key | Default | Notes |
|---|---|---|
| `url` | `"amqp://guest:guest@localhost/"` | AMQP connection URL. |
| `exchange` | `"tenxgraph.events"` | Exchange name. |
| `routing_key` | `"tenxgraph.events"` | Message routing key. |
| `exchange_type` | `"topic"` | `"topic"`, `"direct"`, `"fanout"`, `"headers"`. |
| `declare` | `True` | Declare the exchange if it doesn't exist. |
| `durable` | `True` | Exchange survives broker restarts. |
| `connection_timeout` | `10` | Connection timeout in seconds. |
| `heartbeat` | `60` | Heartbeat interval in seconds. |

For TLS, use an `amqps://` URL, for example `"url": "amqps://user:pass@mq.example.com/"`.

---

## Fan out to multiple publishers

Send events to multiple transports simultaneously using `CompositePublisher`. Common patterns include console for development and Redis for real-time monitoring or an audit stream.

```python
from tenxgraph.runtime.publisher import CompositePublisher, ConsolePublisher, RedisPublisher

publisher = CompositePublisher([
    ConsolePublisher(config={"use_logger": True}),
    RedisPublisher({
        "url": "redis://localhost:6379/0",
        "mode": "stream",
        "stream": "audit.log",
    }),
])

graph = StateGraph(publisher=publisher)
```

You can also pass a list directly to `StateGraph`, and it wraps it automatically:

```python
graph = StateGraph(
    publisher=[
        ConsolePublisher(),
        RedisPublisher({"url": "redis://localhost:6379/0"}),
    ]
)
```

---

## Understand event structure

Every event published is an `EventModel` with these fields:

| Field | Type | Description |
|---|---|---|
| `event` | `Event` | Source: `GRAPH_EXECUTION`, `NODE_EXECUTION`, `LLM_CALL`, `TOOL_EXECUTION`, `STREAMING`, or `REALTIME`. |
| `event_type` | `EventType` | Phase: `START`, `PROGRESS`, `RESULT`, `END`, `UPDATE`, `ERROR`, or `INTERRUPTED`. |
| `content_type` | `list[ContentType]` | Content tags: `TEXT`, `MESSAGE`, `TOOL_CALL`, `TOOL_RESULT`, `IMAGE`, `AUDIO`, `TRANSCRIPT`, `STATE`, etc. |
| `node_name` | `str \| None` | Name of the node that emitted the event. |
| `data` | `dict` | Event payload: arguments, results, error messages, token counts, etc. |
| `content_blocks` | `list[ContentBlock]` | Structured message blocks (tool calls, tool results, etc.). |
| `run_id`, `thread_id`, `user_id`, `timestamp` | various | Run identity and UNIX timestamp, top-level fields. |
| `metadata` | `dict` | Extra run metadata, such as `run_timestamp` and `is_stream`. |

To inspect the event structure, use `ConsolePublisher` locally:

```python
from tenxgraph.runtime.publisher import Event, EventType, ContentType

# Import to understand the enums
print([e for e in Event])  # all event sources
print([e for e in EventType])  # all event phases
```

---

## Send traces to a backend

For OpenTelemetry-based tracing to Logfire, LangSmith, or other backends, see [Send traces to Logfire and LangSmith](/docs/guides/send-traces-to-logfire-langsmith). That guide covers the `OtelPublisher` and helper functions to instrument your graph with full tracing.

---

## What you learned

- Publishers emit structured `EventModel` events from every stage of graph execution.
- Add a publisher by instantiating it and passing it to `StateGraph(publisher=...)`.
- `ConsolePublisher` is for development; use Redis, Kafka, or RabbitMQ in production.
- `RedisPublisher` supports Pub/Sub (live subscribers) and Streams (durable log).
- `CompositePublisher` sends events to multiple transports simultaneously.
- Every event has a source, phase, node name, and structured data for downstream processing.

## Run it in production

Publishers carry run events to Kafka, Redis, RabbitMQ or OTEL outside the request path. Use TLS to the broker, and set `observability.user_id_mode` if user IDs should be hashed or masked. See [Observability](/docs/server/observability) and [Scaling and reliability](/docs/production/scaling).
