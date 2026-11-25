---
title: Configure ID generators
description: Control the format of thread IDs and run IDs using built-in or custom generators to match your storage backend and observability requirements.
section: "Deploy"
order: 40
label: "ID generators for many replicas"
updated: "2026-11-26"
---

By default, 10xGraph generates UUID v4 strings for threads, runs and messages. UUIDs are collision-resistant and require no coordination, but they are not sortable by time and may not fit your database schema. You can swap the ID generator to match your infrastructure.

## What the generator makes

It makes thread, run and message ids you do not supply. A `thread_id` or `run_id` you pass in `config`, or a message id you set, is used as given.

The built-in generators (`DefaultIDGenerator`, `HexIDGenerator`, `ShortIDGenerator`, `IntIDGenerator`, `TimestampIDGenerator`, `BigIntIDGenerator`) are compared in [Choose a generator](/docs/reference/python/id-generator#choose-a-generator). Import them from `tenxgraph.utils.id_generator`.

## Quick start: use a built-in generator

To replace the default UUID generator, pass `id_generator` to `StateGraph()`:

```python
from tenxgraph.core.graph import StateGraph
from tenxgraph.core.state import Message
from tenxgraph.utils.constants import END
from tenxgraph.utils.id_generator import BigIntIDGenerator

def echo(state):
    return Message.text_message("Hello back", role="assistant")

# Create a graph with timestamp-sortable integer IDs
graph = StateGraph(id_generator=BigIntIDGenerator())
graph.add_node("echo", echo)
graph.set_entry_point("echo")
graph.add_edge("echo", END)
app = graph.compile()

# Invoke without a thread_id; the generator supplies it (a 19-digit integer)
result = app.invoke({"messages": [Message.text_message("Hello")]})
```

Threads, runs and messages created without an explicit ID now use the new ID format. The generator does not affect how you invoke the graph.

## On the API server

When you serve the graph with the API server, you can instead set `"id_generator"` in `10xgraph.json` (`uuid`, `hex`, `short`, `int`, `bigint`, `timestamp`, `snowflake` or a `module:attr` path). Set it in one place only: the server refuses to boot when the graph code also sets a generator, or when the id columns of an existing `PgCheckpointer` table cannot hold the ids. New thread ids and run ids come from the generator bound in the shared container. A thread or message id from a path, body, WebSocket frame or AG-UI message is converted to the generator's type: `int` for Snowflake and the other integer generators (a non-numeric value gets 422), `str` otherwise. The checkpointer's id type follows the generator (default string, Snowflake gives bigint); its `id_type` argument is deprecated. See the [configuration reference](/docs/reference/api-cli/configuration#id_generator).

`PgCheckpointer` id columns follow the generator, and setup refuses existing tables of another type; keep the generator the tables were created with, or migrate the columns.

## Write a custom generator

Extend `BaseIDGenerator` to implement your own ID logic:

```python
import uuid

from tenxgraph.core.graph import StateGraph
from tenxgraph.utils.id_generator import BaseIDGenerator, IDType

class PrefixedUUIDGenerator(BaseIDGenerator):
    """Generates UUIDs with a prefix for filtering, e.g., 'run_550e8400-e29b-...'."""

    def __init__(self, prefix: str = "run"):
        self.prefix = prefix

    @property
    def id_type(self) -> IDType:
        return IDType.STRING

    def generate(self) -> str:
        return f"{self.prefix}_{uuid.uuid4()}"


# Use it:
graph = StateGraph(id_generator=PrefixedUUIDGenerator("sess"))
app = graph.compile()
```

Your generator receives no input and must produce a new, unique ID each time `generate()` is called. `generate()` may also be `async def` (for an external sequence); see [Write an async generator](/docs/reference/python/id-generator#write-an-async-generator). `AsyncIDGenerator` and `UUIDGenerator` are deprecated and will be removed in 2.0; use `BaseIDGenerator` and `DefaultIDGenerator`.

For more details on the ID generator API, class hierarchy, and all built-in implementations, see the [ID generator reference](/docs/reference/python/id-generator).

## Run it in production

The API server runs several workers, so IDs must stay unique across processes. Pick a generator that does not depend on in-process counters, and configure the matching values in your environment as listed in [Configure the server](/docs/server/configure). See [Scaling and reliability](/docs/production/scaling).
