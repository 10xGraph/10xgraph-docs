---
title: Human approval over the API
seoTitle: "Human approval over the 10xGraph API"
description: Pause a refund agent with interrupt() and a response_schema, read the open request from the API, resume with resume and interrupt_id, and handle 409 and 422.
section: Examples
group: Production
order: 13
label: Human approval over the API
updated: "2026-10-27"
faq:
  - q: What does interrupt_id protect against?
    a: A retried or stale request cannot answer a different prompt. If the thread is not paused at that interrupt, the server answers 409 before anything runs.
  - q: Can I send a new message to a paused thread?
    a: No. The server answers 422 and tells you to resume. A paused thread waits for an answer to one specific question.
---

An agent that can move money should ask first. This example puts `interrupt()` inside a refund tool, serves the graph with `10xgraph-api`, and walks through the HTTP calls a frontend makes: start a run, read the open request, answer it, and handle the errors the server returns. Every response shown was captured from a running server.

**Needs:** `pip install "10xgraph[openai]" "10xgraph-api[jwt]"` and `OPENAI_API_KEY` for the model (or the Google or Anthropic equivalents). `JWT_SECRET_KEY` for auth. The `issue_refund` body is a placeholder for your payment code.

## The graph

```python title="graph/agent.py"
from tenxgraph.prebuilt.agent import ReactAgent
from tenxgraph.storage.checkpointer import InMemoryCheckpointer
from tenxgraph.utils import interrupt, tool


@tool
def issue_refund(order_id: str, amount_cents: int) -> str:
    """Refund part or all of an order. A person must approve every refund."""
    decision = interrupt(
        {"order_id": order_id, "amount_cents": amount_cents},
        message=f"Approve a refund of {amount_cents / 100:.2f} for order {order_id}?",
        reason="tool_approval",
        response_schema={
            "type": "object",
            "properties": {"approved": {"type": "boolean"}},
            "required": ["approved"],
        },
    )
    if not decision or not decision.get("approved"):
        return "Refund declined."
    return f"Refunded {amount_cents} cents for order {order_id}"  # call your payment API here


app = ReactAgent(
    model="gpt-4o-mini",
    provider="openai",
    system_prompt=[{"role": "system", "content": "You are a support agent. Refund orders when asked."}],
    tools=[issue_refund],
).compile(checkpointer=InMemoryCheckpointer())  # use PgCheckpointer in production
```

```json title="10xgraph.json"
{ "agent": "graph.agent:app", "auth": "jwt", "authorization": "ownership" }
```

```bash
10xgraph dev --no-open
```

## 1. Start a run and read the open request

Ask for `"response_granularity": "full"`; the default does not include the state that holds the request.

```bash
curl -s http://127.0.0.1:8000/v1/graph/invoke \
  -H "Authorization: Bearer $ALICE" -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":[{"type":"text","text":"Refund order 1042, 59.00"}]}],
       "response_granularity":"full"}'
```

The run ends without a final answer. In the response, `data.meta.thread_id` names the thread and `data.state.execution_meta` holds the pause:

```json
{
  "current_node": "TOOL",
  "status": "interrupted_before",
  "interrupted_node": "TOOL",
  "interrupt_data": {
    "interrupt": {
      "id": "int_710c73f7a4a1479881718d9ad18a3c55",
      "key": "tool:c1:0",
      "node": "TOOL",
      "value": { "order_id": "1042", "amount_cents": 5900 },
      "message": "Approve charging 59.00 for order 1042?",
      "reason": "tool_approval",
      "response_schema": { "type": "object", "properties": { "approved": { "type": "boolean" } }, "required": ["approved"] },
      "tool_call_id": "c1"
    }
  }
}
```

Your UI renders `message` and `value`, and can build its form from `response_schema`. The `id` is what you send back. (This block was captured from a test graph with the same tool shape, so its `message` and `tool_call_id` differ from what your model-driven run produces.) When you stream (`/v1/graph/stream`), the pause arrives as an `updates` event with `status: "interrupted"`.

## 2. Resume

Send `resume` and `interrupt_id` with the thread id. `messages` is not needed.

```bash
curl -s http://127.0.0.1:8000/v1/graph/invoke \
  -H "Authorization: Bearer $ALICE" -H "Content-Type: application/json" \
  -d '{"resume":{"approved":true},
       "interrupt_id":"int_710c73f7a4a1479881718d9ad18a3c55",
       "config":{"thread_id":"<thread_id from step 1>"}}'
```

The paused tool runs again from its first line, `interrupt()` returns `{"approved": true}`, the refund runs once, and the model writes its answer. To refuse, send `{"approved": false}`. To cancel, send `"resume": null`; `interrupt()` returns `None` and a cancel is never checked against the schema.

The same call with the TypeScript client:

```ts
import { TenxGraphClient, Message, ConflictError, ValidationError } from '10xgraph-client';

const client = new TenxGraphClient({ baseUrl: 'http://127.0.0.1:8000', authToken: token });

const first = await client.invoke([Message.text_message('Refund order 1042, 59.00')], {
  response_granularity: 'full',
});
// The client's AgentState type does not declare interrupt_data yet, so read it loosely.
const meta = (first.state as any)?.execution_meta;
const pending = meta?.interrupt_data?.interrupt;
const threadId = first.meta.thread_id;

if (pending) {
  try {
    const done = await client.invoke([], {
      resume: { approved: true },
      interrupt_id: pending.id,
      config: { thread_id: threadId },
    });
    console.log(done.messages.at(-1));
  } catch (err) {
    if (err instanceof ConflictError) {
      // 409: the thread moved on, or another tab already answered.
    } else if (err instanceof ValidationError) {
      // 422: the answer does not match response_schema.
    } else {
      throw err;
    }
  }
}
```

## 3. The errors, as the server returns them

| Situation | Status | Message |
|---|---|---|
| `interrupt_id` is not the open interrupt | 409 | `interrupt_id 'int_nope' does not match the open interrupt 'int_710c...'` |
| Resume sent to a thread that is not paused (also a repeated resume) | 409 | `Nothing to resume: this thread is not paused at an interrupt` |
| The answer breaks the schema (`"approved": "yes"`) | 422 | `Resume value does not match the response schema of interrupt '...': $.approved: expected boolean, got str` |
| A new message sent to the paused thread | 422 | `Thread is paused at interrupt '...' in node 'TOOL'. Resume it with {'resume': value}.` |
| Another user's token on this thread | 403 | `Not authorized to invoke graph` |
| Another run is active on the thread for more than 30 s | 409 | `thread is busy` |

A rejected resume records nothing, so the thread stays paused and you can send a corrected answer.

### When the thread is busy

One run at a time executes per thread. A second request on the same thread waits up to 30 seconds for the first, then gets `409 thread is busy` in the standard error envelope. Send `"on_busy": "cancel"` to ask the active run to stop first, then run this request; the default is `"wait"`. With the TypeScript client this is `ConflictError`, and the option is `on_busy: 'cancel'` on `invoke`.

## What this shows

- The pause is part of the checkpoint, so the person can answer later and a server restart in between loses nothing (with a durable checkpointer). See [Interrupts](/docs/concepts/interrupts).
- The answer is bound to the question: `interrupt_id` stops a stale or repeated request from answering the next prompt, and `response_schema` rejects malformed answers before the tool runs. See [Security model](/docs/production/security-model).
- Only the thread's owner can resume it; the check happens before the graph starts. See [Auth](/docs/server/auth).
- One run per thread, with a bounded wait, keeps concurrent tabs from corrupting a thread. See [Scaling and reliability](/docs/production/scaling).
- Combine this with the [payment example](/docs/examples/payment-tool-replay-safe) when the approved action moves money.
