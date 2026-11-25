---
title: Emit events from your graph
description: "Forward structured events to observability systems using Redis, Kafka, RabbitMQ and more."
section: "Observability"
group: "Events"
order: 60
label: "Publishers (Kafka, Redis, RabbitMQ)"
updated: "2026-11-26"
---

Publishers allow you to observe and audit agent execution by forwarding structured events to external systems. Every time your graph runs, event publishers (Kafka, Redis, RabbitMQ) receive a short stream of run, node and tool events, and tracing publishers receive the extra detail they need for spans, such as model calls. You can subscribe to these events in real-time to monitor your agent, log audits, trigger alerts, or analyze behavior. Publishers are optional: your graph runs without them.

<aside class="callout callout-note" role="note"><p class="callout-title">The set is closed</p>

The publishers listed on this page are a closed set, and new destinations are not being added. For another destination, write a [callback](/docs/guides/use-callbacks), subclass `BasePublisher` (see [Writing a custom publisher](/docs/reference/python/publishers#writing-a-custom-publisher)), or send traces through the OTEL publisher to any OTLP backend (see [Send AI traces](/docs/guides/send-traces#send-to-an-otlp-endpoint)).

</aside>

## Two kinds of publishers

A publisher has a `kind`. An event publisher (`kind = "events"`) is an event stream for your own consumers: Kafka, Redis, RabbitMQ, the console, or a class you write. A tracing publisher (`kind = "observability"`) turns graph, node, LLM call and tool events into spans for Logfire, LangSmith, Phoenix or an OTLP endpoint. Event publishers get the domain events (`run.started`, `node.completed`, `tool.completed` and so on, see [Domain events](/docs/concepts/events-and-observability#domain-events)). Tracing publishers also get the model call events. The console prints everything. Each event has a tag (`all` or `observability`) that decides who gets it; see [How events are routed](/docs/concepts/events-and-observability#how-events-are-routed). Task lifecycle events from the API worker go to event publishers only. See [Publishers, AI tracing and metrics](/docs/concepts/events-and-observability#publishers-ai-tracing-and-metrics) for what each one receives.

A custom publisher is an event publisher unless you say otherwise. To write a custom tracing backend, set `kind = "observability"`. To send an app event to event publishers only, pass `only="events"` to `publish_event`:

```python
from tenxgraph.runtime.publisher import BasePublisher, publish_event


class MyTracingPublisher(BasePublisher):
    kind = "observability"
    # publish, close and sync_close as usual


# Reaches Kafka or Redis publishers, not tracing publishers
publish_event(event, only="events")
```

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

Invoke your agent normally. Events are queued and sent in the background in batches.

```python
import asyncio

async def main():
    result = await app.ainvoke(
        {"messages": [Message.text_message("Hello")]},
        config={"thread_id": "test"},
    )
    print(result["messages"][-1].text())
    await app.aclose()  # flush queued events, then shut down

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
            print(f"Event: {event['metadata']['event_name']} / node: {event['node_name']!r}")

asyncio.run(listen())
```

For a one-node agent you should see `run.started`, `node.completed` and `run.completed`, and `tool.started` and `tool.completed` for each tool call. Model call events do not reach Redis, because they are for tracing backends. See [Domain events](/docs/concepts/events-and-observability#domain-events) for every event and its fields.

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

Every key and its default is in the [RedisPublisher reference](/docs/reference/python/publishers#redispublisher).

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

The message key is the thread ID, so all events of one thread go to the same partition and stay in order. A consumer on the topic reads them like this:

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
            print(f"Event: {record.value['metadata']['event_name']}")
    finally:
        await consumer.stop()

asyncio.run(listen())
```

Every key, including the TLS and SASL ones, is in the [KafkaPublisher reference](/docs/reference/python/publishers#kafkapublisher).

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
import json
from aio_pika import connect_robust

async def listen():
    connection = await connect_robust("amqp://guest:guest@localhost/")
    channel = await connection.channel()
    exchange = await channel.get_exchange("agent.events")
    queue = await channel.declare_queue(auto_delete=True)
    # The publisher sends every event with its routing_key ("agent.executions" here)
    await queue.bind(exchange, "agent.executions")
    
    async for message in queue.iterator():
        event = json.loads(message.body)
        print(event["metadata"]["event_name"], event["run_id"])

asyncio.run(listen())
```

Every key is in the [RabbitMQPublisher reference](/docs/reference/python/publishers#rabbitmqpublisher).

Redis, Kafka and RabbitMQ publishers accept `batch_size`, `flush_interval_ms`, `queue_size` and `publish_timeout`, and any publisher accepts `state_snapshot_limit`, in its config. See [Large state snapshots](/docs/reference/python/publishers#large-state-snapshots).

For TLS, use an `amqps://` URL, for example `"url": "amqps://user:pass@mq.example.com/"`.

---

## Batching

Redis, Kafka and RabbitMQ publishers send in batches. It is always on and you do not need to enable it. `publish_event` puts the event in a bounded queue and returns at once. One worker per publisher sends the queue in order, when it holds `batch_size` events or `flush_interval_ms` after the first queued event, whichever comes first.

```python
publisher = KafkaPublisher({
    "bootstrap_servers": "localhost:9092",
    "topic": "agent-events",
    "batch_size": 200,         # default 100
    "flush_interval_ms": 50,   # default 20
    "queue_size": 4096,        # default 2048
    "publish_timeout": 10,     # seconds for one batch, no default
})
```

How each broker sends a batch:

- **RabbitMQ** publishes the whole batch together and waits once for the broker confirms.
- **Kafka** calls `send()` for every event and then waits once for all deliveries. The message key is the thread ID, so events of one thread stay in order on one partition.
- **Redis** sends one pipeline without a transaction (Pub/Sub or stream, as configured).

If the queue is full, the new event is dropped. The counter `tenxgraph.publish.dropped` goes up and a warning is logged, at most once every 10 seconds. A batch that fails or times out is dropped as well, and counted the same way. Delivery stays at-most-once, with no retry.

Queued events are sent when you call `await app.aclose()`, when a sync `invoke` or `stream` returns, and when you call the publisher's `close()`. With `ainvoke` and `astream`, call `aclose()` before your process exits.

Three metrics help you size the batches: `tenxgraph.publish.duration` (time to send one batch), `tenxgraph.publish.batches` and `tenxgraph.publish.events`, each with a `publisher` attribute. `publisher.publish(event)` called by hand still sends one event at once.

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

Every event is an `EventModel`. Consumers switch on `metadata["event_name"]` (for example `node.completed`); run-level events have an empty `node_name`, and custom events from `publish_event()` have no `event_name`. The fields and enums are in the [EventModel reference](/docs/reference/python/publishers#eventmodel), and every domain event with its fields is in [Domain events](/docs/concepts/events-and-observability#domain-events).

---

## Send traces to a backend

For OpenTelemetry tracing to an OTLP endpoint, Arize Phoenix, Logfire or LangSmith, see [Send AI traces](/docs/guides/send-traces).

## Run it in production

Publishers carry run events to Kafka, Redis, RabbitMQ or OTEL outside the request path. Use TLS to the broker, and set `observability.user_id_mode` if user IDs should be hashed or masked. See [Observability](/docs/server/observability) and [Scaling and reliability](/docs/production/scaling).
