---
title: Durability and concurrency
description: "Handle StaleStateError from optimistic concurrency when several processes advance one thread, and tune the per-step durable checkpoint."
section: "Data and state"
group: "Threads and state"
order: 20
label: "Durability and concurrency"
updated: "2026-11-27"
---

Several processes can advance the same thread. `PgCheckpointer` versions each thread's state so a stale writer fails instead of overwriting newer work, and saves after every step so a crash replays at most one node. This guide shows how to handle the conflict and tune the per-step save. Thread and user isolation and the state history limit are in [Set up checkpointing](/docs/guides/set-up-checkpointing); the tool ledger that stops a replayed tool from running twice is in [Replay-safe tools](/docs/concepts/replay-safe-tools).

## Optimistic concurrency and StaleStateError

When multiple server instances or processes try to advance the same thread concurrently, a collision is possible. For example, two API servers might both read the current state at version 5, and both try to write version 6 based on their work. The second write would silently overwrite the first, losing data (a lost update problem).

10xGraph prevents this using **optimistic concurrency control**. When a graph reads state, the checkpointer records the version number into `config["_checkpoint_version"]`. On the next write, the checkpointer performs a compare-and-swap: the write succeeds only if no other execution has advanced the version in the meantime. If another execution committed a newer version, the write is rejected with a `StaleStateError`.

`StaleStateError` has `error_code` `STORAGE_CONFLICT_001` when `PgCheckpointer` raises it (the class default is `STORAGE_CONFLICT_000`) and `context` with `thread_id`, `expected_version` and `current_version`.

When a `StaleStateError` occurs, the cached state for that thread is invalidated. The next read will fetch the current state from Postgres instead of a stale cache. The standard recovery is to re-read the thread's state and retry the turn.

This is what makes it safe to run several server instances or load-balanced workers against one `thread_id`: concurrent attempts will fail loudly instead of silently overwriting each other's work.

<aside class="callout callout-warning" role="warning"><p class="callout-title">Retrying on conflict</p>

You do not reload the thread by hand: a retry reads the latest state, because the version is tracked on an internal copy of `config`, never on the dict you pass. The failed attempt has already saved the user message to the thread (without a reply). Messages are saved by `message_id`, so build the input once and reuse the same `Message` on every retry. A new `Message` per retry (a new id) stores the user message twice.

Over the API a conflict answers `409` with `error` `state_conflict`. The server stores its own message ids, but it remembers the `message_id` you sent, so resend the same message with the same `message_id`: the run continues from where it stopped without saving the message again. The same works after a failed, cancelled or stopped run, or a server crash. Once the run completed, a resend gets `409` `MESSAGE_ALREADY_PROCESSED`. A message sent without a `message_id` (the TypeScript client sends none unless you set one) cannot be recognised and is stored twice. The server's [one run per thread](/docs/server/invoke-and-stream#one-run-per-thread) lock keeps two API runs off one thread, so there the conflict only comes from a writer outside the API.

```python
import asyncio

from tenxgraph.core.exceptions import StaleStateError


async def safe_invoke(app, input_data, thread_id):
    # input_data is built once by the caller, so every attempt sends the same message ids.
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

Disabling this makes sense when you have many short nodes and the overhead of per-step writes matters. Enabling it (the default) is safer for long-running graphs because recovery only replays one node instead of the entire graph.

Tool calls that already finished are not run again when a node replays: see [Replay-safe tools](/docs/concepts/replay-safe-tools).

## Run it in production

The server returns `409` when a second run starts on a busy thread (or waits up to 30 seconds with `on_busy`), and `StaleStateError` surfaces as a conflict instead of a lost write. Run `PgCheckpointer` with the shared Postgres and Redis behind every worker, and back up Postgres. See [Scaling and reliability](/docs/production/scaling) and [Backup and restore](/docs/server/backup-and-restore).
