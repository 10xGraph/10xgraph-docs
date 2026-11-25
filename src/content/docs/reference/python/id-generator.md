---
title: ID Generator
seoTitle: "ID generator API reference (Python)"
description: "BaseIDGenerator, IDType and the built-in generators: control the format of the thread IDs, run IDs and message IDs that 10xGraph creates."
section: Reference
group: "Python library"
order: 170
label: ID Generator
updated: "2026-10-08"
---

An ID generator decides the format of the identifiers 10xGraph creates for threads, runs and messages. Pass one to `StateGraph(id_generator=...)`, or subclass `BaseIDGenerator` to write your own. This page lists `IDType`, the base interface, every built-in generator, and how generated IDs reach your nodes.

## Import path

```python
from tenxgraph.utils.id_generator import (
    AsyncIDGenerator,
    BaseIDGenerator,
    BigIntIDGenerator,
    DefaultIDGenerator,
    HexIDGenerator,
    IDType,
    IntIDGenerator,
    ShortIDGenerator,
    TimestampIDGenerator,
    UUIDGenerator,
)
```

## Choose a generator

`StateGraph` takes `id_generator: BaseIDGenerator | None = None` and falls back to `DefaultIDGenerator()` when you pass nothing. The prebuilt agents (`ReactAgent`, `SwarmAgent` and others) also accept `id_generator` and forward it to their graph.

| Generator | `id_type` | Output | Use it when |
|---|---|---|---|
| `DefaultIDGenerator` | `STRING` | UUID v4, 36 characters | You want globally unique IDs with no coordination (the default). |
| `UUIDGenerator` | `STRING` | UUID v4 | Deprecated alias of `DefaultIDGenerator`, removed in 2.0. |
| `AsyncIDGenerator` | `STRING` | UUID v4, produced by an `async` method | Deprecated, removed in 2.0. Subclass `BaseIDGenerator` with an `async def generate()` instead. |
| `HexIDGenerator` | `STRING` | 32 hex characters | You want UUID-like randomness without hyphens. |
| `ShortIDGenerator` | `STRING` | 8 alphanumeric characters | You want readable IDs for low volumes. |
| `BigIntIDGenerator` | `BIGINT` | Nanosecond Unix time as an integer | You need time-ordered integers for a `bigint` column. |
| `TimestampIDGenerator` | `BIGINT` | Microsecond Unix time as an integer | You need time-ordered integers that are shorter. |
| `IntIDGenerator` | `INTEGER` | Random integer, 0 to 2,147,483,647 (fits a signed 32-bit column) | You need compact IDs at very low volume. |

## `IDType`

`IDType` is a `str` enum that declares what kind of value a generator returns. The framework reads it to pick a fallback when a generator returns an empty value.

| Member | Value |
|---|---|
| `IDType.STRING` | `"string"` |
| `IDType.INTEGER` | `"integer"` |
| `IDType.BIGINT` | `"bigint"` |

The enum is a label, not a validator. The framework does not check that `generate()` returns a value within a range for the declared type.

## `BaseIDGenerator`

`BaseIDGenerator` is the abstract base class for all generators. It has two abstract members, and a subclass that omits either cannot be instantiated.

| Member | Signature | Description |
|---|---|---|
| `id_type` | `@property -> IDType` | The type of ID this generator returns. |
| `generate` | `() -> str \| int \| Awaitable[str \| int]` | Returns a new unique ID. May be a plain method or an `async def`. |

## Built-in generators

Every built-in generator takes no constructor arguments. Each section shows the value `generate()` returns.

### `DefaultIDGenerator`

`DefaultIDGenerator` returns `str(uuid.uuid4())`, a 36-character string such as `"550e8400-e29b-41d4-a716-446655440000"`. This is the generator `StateGraph` uses when you pass none.

```python
from tenxgraph import StateGraph
from tenxgraph.utils.id_generator import DefaultIDGenerator

graph = StateGraph(id_generator=DefaultIDGenerator())
```

| Property | Value |
|---|---|
| `id_type` | `IDType.STRING` |
| `generate()` returns | `str` (UUID v4) |

### `UUIDGenerator`

`UUIDGenerator` is a deprecated alias of `DefaultIDGenerator`. It warns with a `DeprecationWarning` when constructed and is removed in 2.0. Use `DefaultIDGenerator`.

```python
from tenxgraph import StateGraph
from tenxgraph.utils.id_generator import DefaultIDGenerator

graph = StateGraph(id_generator=DefaultIDGenerator())
```

| Property | Value |
|---|---|
| `id_type` | `IDType.STRING` |
| `generate()` returns | `str` (UUID v4) |

### `AsyncIDGenerator`

`AsyncIDGenerator` is deprecated and removed in 2.0. It still works and warns with a `DeprecationWarning` when constructed. Its `generate()` is a coroutine that returns a UUID v4 string and performs no real I/O. For an external or async id source, see [Write an async generator](#write-an-async-generator).

| Property | Value |
|---|---|
| `id_type` | `IDType.STRING` |
| `generate()` returns | `Awaitable[str]` (UUID v4) |

### `HexIDGenerator`

`HexIDGenerator` returns 32 hexadecimal characters built from 16 cryptographically random bytes (`secrets.token_hex(16)`), for example `"1a2b3c4d5e6f7890abcdef1234567890"`.

```python
from tenxgraph import StateGraph
from tenxgraph.utils.id_generator import HexIDGenerator

graph = StateGraph(id_generator=HexIDGenerator())
```

| Property | Value |
|---|---|
| `id_type` | `IDType.STRING` |
| `generate()` returns | `str` (32 characters, `0-9a-f`) |

### `ShortIDGenerator`

`ShortIDGenerator` returns 8 characters chosen at random from 62 letters and digits, for example `"Ab3XyZ9k"`. That gives 62^8, about 2.18 x 10^14, combinations.

```python
from tenxgraph import StateGraph
from tenxgraph.utils.id_generator import ShortIDGenerator

graph = StateGraph(id_generator=ShortIDGenerator())
```

| Property | Value |
|---|---|
| `id_type` | `IDType.STRING` |
| `generate()` returns | `str` (8 characters) |

<aside class="callout callout-warning" role="note"><p class="callout-title">Not for high-volume primary keys</p>

Eight characters is enough for human-readable IDs in URLs and logs, but the chance of a collision grows with volume. Use `DefaultIDGenerator` or `HexIDGenerator` for database primary keys.

</aside>

### `BigIntIDGenerator`

`BigIntIDGenerator` returns `int(time.time() * 1_000_000_000)`, the Unix time in nanoseconds, typically 19 digits. IDs sort by creation time and fit a PostgreSQL `bigint` column.

```python
from tenxgraph import StateGraph
from tenxgraph.utils.id_generator import BigIntIDGenerator

graph = StateGraph(id_generator=BigIntIDGenerator())
```

| Property | Value |
|---|---|
| `id_type` | `IDType.BIGINT` |
| `generate()` returns | `int` |

<aside class="callout callout-warning" role="note"><p class="callout-title">Time-based IDs can collide</p>

The value comes from a floating-point clock, so the lowest digits are not true nanosecond precision, and two calls in the same clock tick return the same ID. It is also not coordinated across processes. For several nodes or workers, use a Snowflake generator (see [Distributed deployments](#distributed-deployments)).

</aside>

### `TimestampIDGenerator`

`TimestampIDGenerator` returns `int(time.time() * 1000000)`, the Unix time in microseconds, typically 16 digits. It sorts by creation time like `BigIntIDGenerator` but is shorter and has the same collision risk.

```python
from tenxgraph import StateGraph
from tenxgraph.utils.id_generator import TimestampIDGenerator

graph = StateGraph(id_generator=TimestampIDGenerator())
```

| Property | Value |
|---|---|
| `id_type` | `IDType.BIGINT` |
| `generate()` returns | `int` |

The value exceeds 2^31, so `PgCheckpointer` creates a 64-bit `bigint` column for it (1.1; before 1.1 it was declared `INTEGER` and could not be stored in Postgres).

### `IntIDGenerator`

`IntIDGenerator` returns `secrets.randbits(31)`, a random integer from 0 to 2,147,483,647, so every id fits a signed 32-bit column. Collisions become likely at moderate volume, so use it only for small, non-critical workloads.

```python
from tenxgraph import StateGraph
from tenxgraph.utils.id_generator import IntIDGenerator

graph = StateGraph(id_generator=IntIDGenerator())
```

| Property | Value |
|---|---|
| `id_type` | `IDType.INTEGER` |
| `generate()` returns | `int` |

## Write a custom generator

Subclass `BaseIDGenerator`, implement `id_type` and `generate()`, and pass an instance to `StateGraph`. Use this when you need a prefix, a different alphabet or an external source.

### Write a synchronous generator

A synchronous generator defines `generate()` as a normal method.

```python
# prefixed_ids.py
import uuid

from tenxgraph import StateGraph
from tenxgraph.utils.id_generator import BaseIDGenerator, IDType


class PrefixedIDGenerator(BaseIDGenerator):
    """Generates string IDs such as 'session_<uuid>'."""

    def __init__(self, prefix: str = "run") -> None:
        self.prefix = prefix

    @property
    def id_type(self) -> IDType:
        return IDType.STRING

    def generate(self) -> str:
        return f"{self.prefix}_{uuid.uuid4()}"


graph = StateGraph(id_generator=PrefixedIDGenerator("session"))
```

### Write an async generator

An async generator subclasses `BaseIDGenerator` and defines `async def generate()`, for example to read from a database sequence or an external id service. The framework awaits the result when it creates message, thread and run IDs.

```python
# sequence_ids.py
from tenxgraph import StateGraph
from tenxgraph.utils.id_generator import BaseIDGenerator, IDType


class DatabaseSequenceGenerator(BaseIDGenerator):
    """Takes IDs from a PostgreSQL sequence through an asyncpg pool."""

    def __init__(self, pool) -> None:
        self.pool = pool  # an asyncpg.Pool you created elsewhere

    @property
    def id_type(self) -> IDType:
        return IDType.BIGINT

    async def generate(self) -> int:
        async with self.pool.acquire() as conn:
            return await conn.fetchval("SELECT nextval('my_id_sequence')")


# pool = await asyncpg.create_pool("postgresql://user:pass@host/db")
# graph = StateGraph(id_generator=DatabaseSequenceGenerator(pool))
```

## Read the generated ID in a node

`StateGraph` binds the `BaseIDGenerator` in its InjectQ container, and also the keys `"generated_id"` (a factory that calls your generator each time it is resolved) and `"generated_id_type"` (the generator's `IDType`) for nodes that inject them. The framework itself reads only the `BaseIDGenerator` binding. A node can request the keys with `Inject`.

```python
# nodes.py
from injectq import Inject


async def my_node(
    state,
    config: dict,
    generated_id=Inject["generated_id"],
    generated_id_type=Inject["generated_id_type"],
):
    # IDType is a str enum, so it compares equal to "string", "integer" or "bigint".
    print(f"New ID: {generated_id} (type: {generated_id_type.value})")
    return state
```

## Distributed deployments

For several nodes or workers, the API package provides `SnowFlakeIdGenerator` in `tenxgraph_api.src.app.utils.snowflake_id_generator`. It subclasses `BaseIDGenerator`, returns `IDType.BIGINT`, has an `async` `generate()`, and raises `ImportError` if the optional `snowflakekit` package is missing.

Its constructor takes seven optional integers: `snowflake_epoch`, `total_bits`, `snowflake_time_bits`, `snowflake_node_bits`, `snowflake_node_id`, `snowflake_worker_id` and `snowflake_worker_bits`. Pass none, and it reads `SNOWFLAKE_EPOCH`, `SNOWFLAKE_TOTAL_BITS`, `SNOWFLAKE_TIME_BITS`, `SNOWFLAKE_NODE_BITS`, `SNOWFLAKE_NODE_ID`, `SNOWFLAKE_WORKER_ID` and `SNOWFLAKE_WORKER_BITS` from the environment. Pass all seven, or none: a partial set is silently ignored. See [Configure an ID generator](/docs/guides/configure-id-generator) for setup.

## Common errors

| Symptom | Cause | Fix |
|---|---|---|
| `TypeError: Can't instantiate abstract class` | A subclass of `BaseIDGenerator` is missing `id_type` or `generate`. | Implement both members. |
| Unique constraint violation on IDs | `IntIDGenerator`, `ShortIDGenerator` or a time-based generator produced a duplicate. | Switch to `DefaultIDGenerator`, `HexIDGenerator` or a Snowflake generator. |
| Column type mismatch | The generator returns `int` but the column is `varchar`, or the reverse. | Match the generator's `IDType` to your schema. |
| Integer overflow on insert | `TimestampIDGenerator` or `BigIntIDGenerator` value exceeds a 32-bit column. | Use a `bigint` column. |
| `thread_id` is a coroutine object | An async generator was used without an explicit `thread_id`. | Pass `thread_id` in the run config. |
