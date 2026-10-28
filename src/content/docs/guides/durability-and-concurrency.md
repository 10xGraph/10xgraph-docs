---
title: Durability and concurrency
description: "Ensure reliable execution: thread isolation, state history, optimistic concurrency, and idempotent tool calls."
section: "Build agents"
group: "State, memory and context"
order: 241
label: "Durability and concurrency"
updated: "2026-10-27"
---

When you run multi-turn agents in production, multiple executions may touch the same thread from different servers or clients. 10xGraph protects your data and prevents lost updates through thread isolation, versioned state, and idempotent tool execution. This guide covers the guarantees that PgCheckpointer provides and how to handle concurrency conflicts.

For checkpointer setup, see [Set up checkpointing](/docs/guides/set-up-checkpointing).

---

## Thread isolation

Each unique `thread_id` in the `config` parameter maintains its own completely isolated state. Two conversations using different `thread_id` values cannot interfere with each other, even when running on the same graph or server.

```python
from tenxgraph.core.graph import StateGraph, Agent
from tenxgraph.storage.checkpointer import PgCheckpointer
from tenxgraph.core.state import AgentState, Message

# Set up the graph and checkpointer
checkpointer = PgCheckpointer(
    postgres_dsn="postgresql://user:pass@localhost:5432/mydb",
    redis_url="redis://localhost:6379/0",
)

graph = StateGraph()
# ... add nodes and edges ...
app = graph.compile(checkpointer=checkpointer)
checkpointer.setup()  # create tables once, outside a running event loop

# Two independent threads, each with isolated state
result_alice = app.invoke(
    {"messages": [Message.text_message("I'm Alice")]},
    config={"thread_id": "user-alice"},
)

result_bob = app.invoke(
    {"messages": [Message.text_message("I'm Bob")]},
    config={"thread_id": "user-bob"},
)

# Alice's messages are never visible to Bob's thread
result_bob_check = app.invoke(
    {"messages": [Message.text_message("Who am I?")]},
    config={"thread_id": "user-bob"},
)
# Output will be "You are Bob", not Alice
```

Thread isolation is automatic: the checkpointer stores state keyed by `thread_id`, and reads/writes are scoped to that key. There is no shared state between threads unless you explicitly pass it through your graph's custom state or external storage.

If you are using multi-user isolation (the default `enforce_user_isolation=True`), then threads are further scoped by `user_id`. An authenticated caller cannot read or modify another user's threads, even if they know the `thread_id`. See the [Set up checkpointing](/docs/guides/set-up-checkpointing) guide for isolation configuration.

---

## State history and pruning

Every durable checkpoint writes a new versioned row to the database rather than overwriting the previous state. This versioned history is essential for concurrency safety and also allows you to inspect or recover earlier snapshots.

The `state_history_limit` parameter controls how many prior versions are kept:

```python
from tenxgraph.storage.checkpointer import PgCheckpointer

checkpointer = PgCheckpointer(
    postgres_dsn="postgresql://user:pass@localhost:5432/mydb",
    redis_url="redis://localhost:6379/0",
    state_history_limit=20,  # keep current + 19 prior snapshots
)
```

At runtime, the graph engine always reads and uses only the **latest** version. Old versions exist purely for debugging, audit, and manual recovery. To prevent the history table from growing unbounded, versions older than `state_history_limit` are pruned automatically on each write.

| Value | Behavior |
|-------|----------|
| `1` | Keep only the current state per thread (minimal storage). |
| `20` (default) | Keep a 20-version window for audit and rollback. |
| Higher | Retain a longer history (more storage per active thread). |
| `0` or `None` | Disable pruning entirely (history grows unbounded, not recommended). |

Concurrency safety and correctness are **identical at every setting**. The `state_history_limit` parameter only changes how much historical audit trail you keep.

---

## Optimistic concurrency and StaleStateError

When multiple server instances or processes try to advance the same thread concurrently, a collision is possible. For example, two API servers might both read the current state at version 5, and both try to write version 6 based on their work. The second write would silently overwrite the first, losing data (a lost update problem).

10xGraph prevents this using **optimistic concurrency control**. When a graph reads state, the checkpointer records the version number into `config["_checkpoint_version"]`. On the next write, the checkpointer performs a compare-and-swap: the write succeeds only if no other execution has advanced the version in the meantime. If another execution committed a newer version, the write is rejected with a `StaleStateError`.

```python
from tenxgraph.core.exceptions import StaleStateError

try:
    result = await app.ainvoke(
        {"messages": [Message.text_message("Process this request")]},
        config={"thread_id": "shared-thread"},
    )
except StaleStateError as exc:
    # Another execution committed state for this thread before us
    # exc.error_code == "STORAGE_CONFLICT_000"
    # exc.context includes thread_id, expected_version, current_version
    print(f"Conflict: expected version {exc.context['expected_version']}, "
          f"but current version is {exc.context['current_version']}")
    # Retry by re-reading the thread and trying again
```

When a `StaleStateError` occurs, the cached state for that thread is invalidated. The next read will fetch the current state from Postgres instead of a stale cache. The standard recovery is to re-read the thread's state and retry the turn.

This is what makes it safe to run several server instances or load-balanced workers against one `thread_id`: concurrent attempts will fail loudly instead of silently overwriting each other's work.

<aside class="callout callout-warning" role="warning"><p class="callout-title">Retrying on conflict</p>

If you catch `StaleStateError`, you must reload the thread and retry. Retrying the same request with the same stale config will fail again. Best practice is to re-fetch the thread state and apply the user's request against the fresh state:

```python
import asyncio

from tenxgraph.core.exceptions import StaleStateError


async def safe_invoke(app, input_data, thread_id):
    config = {"thread_id": thread_id}
    max_retries = 3
    for attempt in range(max_retries):
        try:
            return await app.ainvoke(input_data, config=config)
        except StaleStateError:
            if attempt == max_retries - 1:
                raise  # Give up after max retries
            await asyncio.sleep(0.1 * (2 ** attempt))  # Exponential backoff
```

</aside>

---

## Per-step durable checkpoints

By default, the runtime persists a durable checkpoint after every completed node. This means a process killed mid-execution will replay at most one node on recovery (not the entire graph from the start).

Only **new** messages not yet in the database are written during a checkpoint, so long-running graphs do not re-upsert their entire history on each step.

To trade crash granularity for fewer database writes, you can disable per-step checkpoints per run:

```python
result = app.invoke(
    input_data,
    config={
        "thread_id": "t-1",
        "durable_checkpoint_every_step": False,  # only checkpoint at the end
    },
)
```

| Config key | Default | Effect |
|---|---|---|
| `durable_checkpoint_every_step` | `True` | Persist state and new messages after each completed step. When `False`, only realtime cache updates happen per step; durable writes occur only at the end. |

Disabling this makes sense when you have many short nodes and the overhead of per-step writes matters. Enabling it (the default) is safer for long-running graphs because recovery only replays one node instead of the entire graph.

---

## Tool idempotency ledger

When a graph calls a tool, the call is recorded in the `tool_executions` table keyed by `(thread_id, tool_call_id)`. The tool's result is stored as soon as the tool returns.

If a node is replayed (for example, after a crash), the checkpointer consults the ledger before running the tool. If the exact `tool_call_id` has already been recorded, the tool is not called again. Instead, the recorded result is returned immediately.

This deduplication prevents side effects from happening twice. A payment, email, or API call will not re-execute during recovery.

```python
from tenxgraph.utils import tool

@tool
def send_payment(amount: float, recipient: str) -> str:
    """Send a payment. This will not be called twice for the same tool_call_id."""
    # Simulated API call
    print(f"Sending ${amount} to {recipient}")
    return f"Payment of ${amount} sent to {recipient}"

# If the node containing this tool call crashes and replays,
# send_payment will not be called again; the recorded result is reused.
```

### Ledger failure behavior

The ledger read and write paths have **asymmetric** failure behavior:

| Operation | On failure |
|---|---|
| Ledger read | Falls back to "no record". The tool runs again (at-least-once semantics), and the run continues. |
| Ledger write | Raises. If recording a completed side effect fails, the exception is raised so the caller knows a critical operation may not have been logged. |

The reasoning: a failed **write** could cause the same tool to fire twice on the next replay (a critical data loss), so the error must be surfaced. A failed **read** is safer; the tool runs again, and if it is idempotent, no harm is done. If idempotence cannot be guaranteed, retry the operation at a higher level (e.g., in your API layer).

The ledger table is created by `checkpointer.setup()` as part of the schema version 3 migration.

---

## Putting it together: multi-instance deployment

With thread isolation, optimistic concurrency, per-step checkpoints, and the tool ledger, you can safely deploy multiple instances of your graph behind a load balancer, all reading and writing to the same Postgres and Redis.

```python
import asyncio
from tenxgraph.core.graph import StateGraph, Agent
from tenxgraph.storage.checkpointer import PgCheckpointer
from tenxgraph.core.state import AgentState, Message
from tenxgraph.core.exceptions import StaleStateError

checkpointer = PgCheckpointer(
    postgres_dsn="postgresql://user:pass@postgres.example.com:5432/mydb",
    redis_url="redis://redis.example.com:6379/0",
    state_history_limit=20,
    enforce_user_isolation=True,  # multi-tenant
)

graph = StateGraph()
# ... define your agent ...
app = graph.compile(checkpointer=checkpointer)

async def handle_request(user_id: str, thread_id: str, message: str):
    """Process a user message, handling conflicts gracefully."""
    config = {"user_id": user_id, "thread_id": thread_id}
    input_data = {"messages": [Message.text_message(message)]}
    
    max_retries = 3
    for attempt in range(max_retries):
        try:
            return await app.ainvoke(input_data, config=config)
        except StaleStateError:
            if attempt == max_retries - 1:
                raise
            await asyncio.sleep(0.1 * (2 ** attempt))

# The same thread can be invoked from any instance. Thread isolation ensures
# separate users do not interfere. Optimistic concurrency prevents lost updates.
# Tools are deduplicated via the ledger. All instances can write to the same DB.
```

---

## What you learned

- **Thread isolation**: each unique `thread_id` maintains completely independent state; with multi-user isolation, `user_id` further scopes ownership.
- **State history**: versions are appended rather than overwritten; `state_history_limit` controls retention for audit/recovery without affecting correctness.
- **Optimistic concurrency**: concurrent writes are checked; conflicts raise `StaleStateError`; the recovery path is to reload the thread and retry.
- **Per-step checkpoints**: default `True` for safety on long runs; set `durable_checkpoint_every_step=False` to reduce database load if needed.
- **Tool idempotency**: completed tool calls are recorded in the ledger and not re-executed on replay, preventing duplicate side effects.
- **Multi-instance deployment**: use thread isolation, optimistic concurrency, and the ledger to safely run multiple servers against one Postgres+Redis backend.

## Run it in production

The server returns `409` when a second run starts on a busy thread (or waits up to 30 seconds with `on_busy`), and `StaleStateError` surfaces as a conflict instead of a lost write. Run `PgCheckpointer` with the shared Postgres and Redis behind every worker, and back up Postgres. See [Scaling and reliability](/docs/production/scaling) and [Backup and restore](/docs/server/backup-and-restore).
