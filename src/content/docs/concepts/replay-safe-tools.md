---
title: Replay-safe tools
seoTitle: "Replay-safe tools: no double tool calls"
description: Replay-safe tools let a resumed 10xGraph run skip tool calls that already finished, so a crash does not charge a card or send an email twice.
section: Concepts
order: 140
group: "Memory and reliability"
updated: 2026-10-08
faq:
  - q: Does 10xGraph guarantee a tool runs exactly once?
    a: No. It guarantees that a tool call recorded in the checkpointer's ledger is not executed again. A crash in the short window after a tool finishes but before its record is written can still run it again, and a tool that crashes or times out before returning is not recorded. Pass your own idempotency key to the external service for those cases.
  - q: Which checkpointers support replay-safe tools?
    a: PgCheckpointer stores the ledger durably in PostgreSQL. InMemoryCheckpointer keeps it in process memory, so it only protects replays inside the same process. SqliteCheckpointer does not implement the ledger and falls back to at-least-once behavior.
  - q: Do I need to change my tool code to make it replay-safe?
    a: No. The check happens around the tool call, not inside it. Write the tool as a normal function. Add an idempotency key to calls to payment or email providers as a second layer of protection.
  - q: What happens when a replayed tool call is skipped?
    a: 10xGraph returns the result that was recorded when the tool first ran, so the model still sees a normal tool result and the run continues from where it was interrupted.
---

Replay-safe tools prevent duplicate execution when a run resumes after a crash. Each finished tool call is recorded in the checkpointer as soon as it returns, so replayed runs use the recorded result instead of calling the tool again.

## What failure does it prevent?

Agents call tools with side effects: refunds, emails, tickets, database writes. Consider a support agent that calls `refund_order`.

1. The model asks for `refund_order("1042", 59.0)`.
2. The tool runs and the refund goes through.
3. The process is killed (an out-of-memory kill, a deploy, a node failure) before the node finishes.
4. The run resumes. The run loop saved the current node before it started, so it runs that node again from the top.
5. Without protection, `refund_order` runs again and the customer is refunded twice.

Charges, emails, and tickets have the same risk pattern. The [engineering blog post](/blog/your-agent-charged-the-card-twice) explores this in more detail.

## How does it work?

The logic lives in `tenxgraph/core/graph/utils/invoke_node_handler.py`. Four steps ensure tools do not run twice:

1. **Node is persisted first.** The run loop records the current node before it runs and advances only after completion. A killed process re-runs the interrupted node on resume.
2. **Each call gets a stable identity.** The ledger key combines the assistant message id (persisted and replayed) with the `tool_call_id`. Message id alone is stable across replays; tool call ids like `call_1` reuse on every turn. Together, the key stays unique and stable across restarts.
3. **The ledger is checked before invoking.** If the checkpointer holds a recorded result for that key, 10xGraph returns it immediately without calling the tool.
4. **Result is recorded immediately.** The record is written as soon as the tool returns, before the node completes. A crash later in the same node cannot re-fire it. Parallel tool calls in one node are tracked individually, so finished siblings are skipped on replay.

## What does it not guarantee?

This provides at-most-once protection for recorded calls, not a global exactly-once guarantee. Gaps exist:

- **A crash before the tool returns.** If the process dies while the tool is running, nothing is recorded and the tool runs again on resume. The external side effect may have already happened.
- **The gap after return.** A short window exists between the tool returning and the record being written. A crash inside it can run the tool again.
- **A failed record write.** If the checkpointer cannot store the record, 10xGraph logs an error but continues. A replay may then execute the call a second time.
- **A failed ledger read.** If the ledger cannot be read, the tool runs again with a warning logged. 10xGraph treats an unreadable entry as "no record" because skipping a tool that never ran is worse.
- **Timeouts.** A tool exceeding its timeout is cancelled and raises an error with nothing recorded. If the provider already acted, the call may run again.
- **Streaming runs.** The ledger check lives in the `invoke` and `ainvoke` tool path. The streaming tool path (`stream` and `astream`) does not consult or write the ledger, so streamed runs get no replay protection.
- **Missing ids.** Without a `tool_call_id` or message id, no ledger key can be built and the tool is not protected.

For these cases, always send an idempotency key to your payment or email provider. Derive it from stable inputs such as the order id, never from a random value generated inside the tool.

## How do I enable it?

Replay safety requires two things: a checkpointer that implements the ledger, and a `thread_id` on every call. Without a checkpointer, tools behave as in any framework.

| Checkpointer | Ledger | Survives a process restart |
|---|---|---|
| `PgCheckpointer` | Yes, in a PostgreSQL `tool_executions` table | Yes |
| `InMemoryCheckpointer` | Yes, in process memory | No |
| `SqliteCheckpointer` | Not implemented | Not applicable |

`PgCheckpointer` scopes ledger reads to the thread's owner, the same way it scopes messages: with `enforce_user_isolation=True` (the default), or when the API server's authorization policy asks for owner isolation, a caller that names another user's `thread_id` finds no recorded result, and recording one into that thread raises an error. With `enforce_user_isolation=False` the read skips the ownership join. Behind the API server, a run on another user's thread is already refused before the graph starts, so this check matters when you call the checkpointer from your own code. See [Multi-user isolation](/docs/guides/set-up-checkpointing#multi-user-isolation).

For production, install the extra and compile the graph with `PgCheckpointer`:

```bash
pip install "10xgraph[pg_checkpoint]"
```

```python
from tenxgraph.prebuilt.agent import ReactAgent
from tenxgraph.storage.checkpointer import PgCheckpointer


def lookup_order(order_id: str) -> dict:
    """Look up an order by id and return its status and total."""
    return {"order_id": order_id, "status": "delivered", "total": 59.0}


def refund_order(order_id: str, amount: float) -> str:
    """Refund an order. Moves money, so it must not run twice for one request."""
    # Also pass an idempotency key to your payment provider, derived from
    # stable inputs, to cover the cases listed above.
    return f"Refunded {amount:.2f} for order {order_id}"


checkpointer = PgCheckpointer(
    postgres_dsn="postgresql://user:password@db/tenxgraph",
    redis_url="redis://redis:6379/0",
)

app = ReactAgent(
    model="google/gemini-2.5-flash",
    provider="google",
    system_prompt=[{"role": "system", "content": "You are a support agent for an online shop."}],
    tools=[lookup_order, refund_order],
).compile(checkpointer=checkpointer)
```

The API server uses the checkpointer carried by the compiled graph. For setup details, see [Production checklist](/docs/server/production-checklist). After a crash, call the same thread with the same `thread_id` and the run resumes from the saved node.

## Related protections: versioned writes and timeouts

Replay safety works alongside two other mechanisms that handle related failure modes.

- **Versioned state writes.** `PgCheckpointer` keeps a per-thread version counter and uses optimistic compare-and-swap for durability. This prevents concurrent runs on the same thread from overwriting each other's state. Redis cache writes are guarded by the same version, so a stale run cannot regress the cache. The ledger protects side effects; versioned writes protect state.
- **Timeouts.** `node_timeout` (default 900 seconds) and `tool_timeout` (default 300 seconds) prevent hung calls from blocking workers forever. Configure per run: `config={"thread_id": "t1", "tool_timeout": 60}`. Pass `None` or `0` to disable. Defaults are in `tenxgraph/utils/constants.py`.

## Related pages

- [Your agent charged the card twice](/blog/your-agent-charged-the-card-twice), the engineering write-up.
- [What is durable execution for AI agents?](/docs/glossary/what-is-durable-execution)
- [What is an idempotent tool call?](/docs/glossary/what-is-an-idempotent-tool-call)
- [Checkpointing](/docs/server/production-checklist) and [Memory: hot and cold](/docs/concepts/memory)
- [Checkpointing and threads](/docs/concepts/checkpointing-and-threads)
