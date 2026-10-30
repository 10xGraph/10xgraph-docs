---
title: A payment tool that cannot charge twice
seoTitle: "Replay-safe payment tool with approval"
description: A charge_card tool that asks for approval with interrupt(), sends an idempotency key, and relies on the checkpointer tool ledger so a resumed run never charges twice.
section: Examples
group: Production
order: 12
label: Replay-safe payment tool
updated: "2026-10-27"
faq:
  - q: If the process crashes after the charge, will the customer be charged again?
    a: Not when the call was recorded. The charge result is written to the checkpointer ledger as soon as the tool returns, and a resumed run reuses it. A crash in the short window between the provider acting and that write can still run the tool again, which is why the tool also sends an idempotency key to the payment provider.
  - q: Why is interrupt() the first line of the tool and the charge the last?
    a: On resume the tool runs again from the top, so any code before interrupt() runs twice. Everything with a side effect goes after it.
---

A refund or a charge is the case where a duplicate costs real money. This example gives a support agent a `charge_card` tool with three layers: a human approves the amount before anything happens, the result of a finished call is stored in the checkpointer ledger, and the payment provider receives an idempotency key derived from the order.

**Needs:** `pip install "10xgraph[openai,pg_checkpoint]"` and `OPENAI_API_KEY` (or swap `provider`/`model` for Google or Anthropic and set `GEMINI_API_KEY` or `ANTHROPIC_API_KEY`). A PostgreSQL DSN and a Redis URL for `PgCheckpointer`. The `PaymentsClient` below is a mock you replace with your provider's SDK.

## The agent

```python title="graph/agent.py"
import os

from tenxgraph.prebuilt.agent import ReactAgent
from tenxgraph.storage.checkpointer import PgCheckpointer
from tenxgraph.utils import interrupt, tool


class PaymentsClient:
    """Placeholder. Replace with your provider's SDK."""

    def charge(self, amount_cents: int, *, idempotency_key: str) -> str:
        # A real provider returns the original result when it sees the same key again.
        return f"ch_{idempotency_key}"


payments = PaymentsClient()


@tool
def lookup_order(order_id: str) -> dict:
    """Look up an order by id. Returns its status and total in cents."""
    return {"order_id": order_id, "status": "awaiting_payment", "total_cents": 5900}


@tool
def charge_card(order_id: str, amount_cents: int) -> str:
    """Charge the customer's saved card for an order. A person must approve first."""
    # Nothing with a side effect may run before this line: on resume the tool starts again
    # from the top, and interrupt() then returns the answer instead of pausing.
    decision = interrupt(
        {"order_id": order_id, "amount_cents": amount_cents},
        message=f"Approve charging {amount_cents / 100:.2f} for order {order_id}?",
        reason="tool_approval",
        response_schema={
            "type": "object",
            "properties": {"approved": {"type": "boolean"}},
            "required": ["approved"],
        },
    )
    if not decision or not decision.get("approved"):
        return "Charge declined by approver."

    # Derived from stable inputs, never random: the same order always sends the same key.
    charge_id = payments.charge(amount_cents, idempotency_key=f"charge-{order_id}")
    return f"Charged {amount_cents} cents for order {order_id} ({charge_id})"


checkpointer = PgCheckpointer(
    postgres_dsn=os.environ["DATABASE_URL"],
    redis_url=os.environ["REDIS_URL"],
)

app = ReactAgent(
    model="gpt-4o-mini",
    provider="openai",
    system_prompt=[
        {
            "role": "system",
            "content": "You are a billing assistant. Look up the order, then charge the "
            "amount shown in the order total. Never charge a different amount.",
        }
    ],
    tools=[lookup_order, charge_card],
).compile(checkpointer=checkpointer)
```

Point `10xgraph.json` at it with `"agent": "graph.agent:app"`. The server uses the checkpointer carried by the compiled graph, so there is no `checkpointer` key to set.

## What the three layers do

1. **Approval.** `interrupt()` raises `GraphInterrupt`, which the graph catches. The run saves its state and ends with the pause reported. No charge has happened.
2. **The ledger.** Each tool call is keyed by the assistant message id plus the `tool_call_id`, both of which are stable after a reload from the checkpoint. Before calling a tool, the node asks the checkpointer for a recorded result under that key. After the tool returns, the node writes the result immediately (`InvokeNodeHandler._handle_single_tool` in `tenxgraph/core/graph/utils/invoke_node_handler.py`). A paused call has no result yet, so it is not recorded.
3. **The idempotency key.** It covers the gaps the ledger cannot: a crash after the provider acted but before the record was written, or a record write that failed.

## What happens on a crash and on resume

- **Pause, then answer.** The run stops at `interrupt()`. Your frontend shows the request, and the person answers minutes or days later. The pause is stored in the checkpoint, so a server restart in between loses nothing. The tool then runs again from its first line, `interrupt()` returns the answer, and the charge happens once.
- **Crash after a sibling tool finished.** The execution loop saves the current node before it runs and advances only after it completes, so a killed process runs that node again on resume. Tool calls already in the ledger are returned from the record and not called again. This was checked in a run with two tool calls in one node: one needed approval, the other finished first; after the answer, the finished one ran once (its result came from the ledger) and the charge ran once.
- **Crash after the charge, before the node finished.** If the record was written, the resumed node reuses it. If the process died inside the window between the provider charging and the record write, the tool runs again and the provider returns the first charge because the key is the same.
- **Crash while the tool was running.** Nothing is recorded, so the tool runs again. Same protection: the idempotency key.

Limits you should know: the ledger check runs on the invoke and the streaming tool path alike (`astream` and `/v1/graph/stream` use it too). A tool that exceeds `tool_timeout` is cancelled with nothing recorded. `InMemoryCheckpointer` supports the ledger but loses it on restart; `SqliteCheckpointer` does not implement it. Details in [Replay-safe tools](/docs/concepts/replay-safe-tools).

## Run it over the server

```bash
10xgraph dev --no-open
```

Call `POST /v1/graph/invoke` with `"response_granularity": "full"`. The first response has `state.execution_meta.status` set to `interrupted_before` and the open request under `state.execution_meta.interrupt_data.interrupt` (with its `id`, `message`, `value` and `response_schema`). Answer it by sending `resume` and `interrupt_id` on the same thread; the full request and error cases are in [Human approval over the API](/docs/examples/human-approval-over-api).

## What this shows

- A person approves the exact amount before the side effect, and the approval is validated against a schema. See [Interrupts](/docs/concepts/interrupts).
- A finished tool call is not run again on replay. See [Replay-safe tools](/docs/concepts/replay-safe-tools) and [Scaling and reliability](/docs/production/scaling).
- The guarantee has stated limits, so the payment call also sends an idempotency key. See [What 10xGraph does not protect](/docs/production/limits).
- Use `PgCheckpointer` in production so the pause and the ledger survive a restart. See [Set up checkpointing](/docs/guides/set-up-checkpointing).
