---
title: "Add human approval with interrupt()"
seoTitle: "Pause for human approval: interrupt()"
description: "Pause a graph mid-execution for human approval, correction, or choice from inside a node or tool. Resume when the decision is made."
section: "Build agents"
group: "Control flow"
order: 260
label: "Pause for human input"
updated: "2026-11-26"
---

## Overview

`interrupt()` pauses a graph from inside a node or tool while it is running, saving the state and waiting for outside input. The next time you run the same thread with a `resume` value, the paused node resumes and `interrupt()` returns that value. Use this when the decision belongs in the middle of a node's logic, for example approving a refund, choosing among options, or asking for clarification.

To pause at a fixed node boundary, use [`interrupt_before` and `interrupt_after` on `compile()`](/docs/concepts/interrupts#fixed-point-interrupts-with-interrupt_before-and-interrupt_after). To require approval for a whole tool without writing `interrupt()` yourself, use `ToolGuard(approval={"refund"})`; see [Human approval](/docs/security/zero-trust-agents#human-approval).

## Basic example: Tool approval

Define a tool that asks for approval before taking action:

```python
from tenxgraph.utils import interrupt

async def issue_refund_to_bank(amount: float) -> str:
    # Stand-in for your payment call.
    return "ok"

async def refund(amount: float) -> str:
    """Issue a refund, but ask for approval first."""
    decision = interrupt(
        {"amount": amount},
        message=f"Approve a refund of ${amount}?",
        reason="tool_approval",
        response_schema={
            "type": "object",
            "properties": {
                "approved": {
                    "type": "boolean",
                    "description": "Whether to proceed with the refund"
                }
            },
            "required": ["approved"]
        },
    )
    
    # interrupt() returns the resume value on the second run.
    # If the user declined (sent None or {"approved": False}), return early.
    if not decision or not decision.get("approved"):
        return f"Refund of ${amount} declined by user."
    
    # Only now, after approval, issue the refund.
    result = await issue_refund_to_bank(amount)
    return f"Refund of ${amount} issued: {result}"
```

Register `refund` in a `ToolNode` like any other tool, compile the graph with a checkpointer (the default `InMemoryCheckpointer` works for local runs), and always pass a `thread_id` so the thread can be resumed.

`interrupt()` takes `value`, and keyword-only `message`, `reason` (default `"input_required"`) and `response_schema`; see [Arguments and return value](/docs/concepts/interrupts#arguments-and-return-value).

## Running the graph until the pause

Run the graph normally with `ainvoke()` or `astream()`. The first time `interrupt()` is called, it stops the graph immediately and saves the state. Here is how to detect the pause:

### Using `ainvoke()` with `pending_interrupt()`

```python
from tenxgraph.utils import pending_interrupt
from tenxgraph.utils.constants import ResponseGranularity
from tenxgraph.core.state import Message

config = {"thread_id": "order-42"}

# Run the graph. When interrupt() is called, it saves state and returns.
result = await app.ainvoke(
    {"messages": [Message.text_message("Refund my order, it was $25")]},
    config=config,
    response_granularity=ResponseGranularity.FULL,
)

# Check if the graph is paused waiting for input.
pending = pending_interrupt(result["state"])
if pending:
    print(f"Message: {pending.message}")       # "Approve a refund of $25?"
    print(f"Value: {pending.value}")           # {"amount": 25}
    print(f"Reason: {pending.reason}")         # "tool_approval"
    print(f"Tool call ID: {pending.tool_call_id}")  # Set if interrupt() was in a tool
    print(f"Schema: {pending.response_schema}")     # The JSON Schema
```

The `pending_interrupt()` helper extracts the `Interrupt` object from the state's execution metadata. If there is no active interrupt, it returns `None`.

### Using `astream()` for real-time detection

If you stream the graph execution, the pause arrives as a stream chunk:

```python
from tenxgraph.core.state import Message
from tenxgraph.core.state.stream_chunks import StreamEvent

config = {"thread_id": "order-42"}

async for chunk in app.astream(
    {"messages": [Message.text_message("Refund my order, it was $25")]},
    config=config,
):
    if chunk.event == StreamEvent.UPDATES:
        # Check if this is an interrupt event.
        if chunk.data.get("status") == "interrupted":
            interrupt_data = chunk.data.get("interrupt")
            print(f"Paused: {interrupt_data['message']}")
            print(f"Value: {interrupt_data['value']}")
            break  # Stop streaming once paused.
```

The pause chunk reaches the stream at every granularity.

## Resuming the execution

Once the human has provided their decision, resume the paused thread by calling `ainvoke()` again with the same thread ID and a `"resume"` key:

```python
# User approved the refund.
result = await app.ainvoke(
    {"resume": {"approved": True}},
    config=config,
)

print(result["messages"][-1].text())  # Final response after the refund tool ran.
```

The paused node runs again from the start (not from the interrupt call), and this time `interrupt()` returns the resume value instead of stopping the graph. The execution continues normally after that. A node that calls `interrupt()` several times pauses at each one; each resume answers the next call in order.

### Name the interrupt you are answering

A retried request or a stale tab can send an answer after the prompt has already moved on. To make a resume safe, add the `id` of the pending interrupt under `resume_interrupt_id`:

```python
from tenxgraph.utils import pending_interrupt

request = pending_interrupt(result["state"])

result = await app.ainvoke(
    {"resume": {"approved": True}, "resume_interrupt_id": request.id},
    config=config,
)
```

If the id is not the pending interrupt's, the call raises `InterruptMismatchError` (`INTERRUPT_001`) and records nothing. If the value fails the interrupt's `response_schema`, it raises `ResumeValidationError` (`INTERRUPT_002`). Both are also `ValueError`s. The schema check supports `type`, `enum`, `properties`, `required` and `items`, and ignores other keywords. A `None` resume is never checked. See [Concepts: Interrupts](/docs/concepts/interrupts#bind-a-resume-to-its-interrupt).

### Handling cancellation

If the user declines or cancels the approval, resume with `None`:

```python
result = await app.ainvoke(
    {"resume": None},
    config=config,
)
```

## Keep side effects after the pause

On resume the paused node or tool runs again from the top, so code before `interrupt()` runs twice. Put payments, writes and emails after it, as `refund` does above. In a `ToolNode` with parallel calls, siblings that already finished are not run again: their results come from the tool ledger under `invoke` and `stream` alike. `interrupt()` raises `GraphInterrupt`, a `BaseException`, so `except Exception` does not catch it; never wrap it in `except BaseException`. Details: [Control flow and side effects](/docs/concepts/interrupts#control-flow-and-side-effects).

## Using `interrupt()` over the REST API

Send `resume` instead of `messages` to `/v1/graph/invoke`, `/v1/graph/stream` or the WebSocket, with the thread id in `config`. Add `interrupt_id` (the pending interrupt's `id`) to bind the answer; the server passes it to core as `resume_interrupt_id`. A thread that is not paused, or is paused at another interrupt, answers 409; an answer that fails `response_schema` answers 422 (an error chunk on stream and WebSocket). With `"response_granularity": "full"` the invoke response holds the pending interrupt under `state.execution_meta.interrupt_data.interrupt`; a stream sends it as an `updates` chunk with `status` `interrupted`. Request and response examples: [Pause and resume over the API](/docs/server/invoke-and-stream#human-in-the-loop-pause-and-resume).

## Integration with AG-UI and CopilotKit

The [AG-UI](/docs/server/ag-ui) endpoint (off by default; it needs the `ag-ui` extra and a config key) supports pauses from `interrupt()`, and so does [CopilotKit](https://docs.copilotkit.ai/) on top of it:

- When the graph pauses at `interrupt()`, the run ends with an `"interrupt"` outcome.
- The UI receives the `message`, `value`, `response_schema`, and other fields from the `Interrupt` object.
- CopilotKit's `useInterrupt()` hook handles the pause and presents the prompt to the user.
- The user's response is sent back to resume the thread. The interrupt event carries the interrupt `id`, and AG-UI matches the answer to it.

See [10xGraph with CopilotKit](/docs/integrations/copilotkit) for a complete example.

## Who is allowed to approve

Over the API, only the thread's owner can resume a paused run. A role with reach `tenant` or `all` does not change this: runs always stay on the caller's own threads. So the resume value comes from whoever owns the thread, which is usually the requester.

That matters for the refund example. If the customer who asked for the refund owns the thread, the customer's own `{"approved": true}` is what `interrupt()` returns. Do not treat that value as authorization for something the requester must not approve for themselves.

- **Keep the decision out of client-writable state.** Clients can set `initial_state` on a run and, with `threads:write`, `PUT` the thread state. Do not store "approved" there and trust it.
- **For a separate approver** (support agent, manager), record the decision in your own store, from a run or endpoint that checks the approver's role and tenant. The paused run reads that record when it resumes, instead of trusting the resume value.

## Troubleshooting

### Graph does not pause

Check that the code path reaches `interrupt()`, that it is called inside a running node or tool (outside one it raises `RuntimeError`), and that no `except BaseException` swallows `GraphInterrupt`.

### Resume value not received

Ensure you pass the `resume` key in the next invocation. The value must match the `response_schema` if one is defined. Check the error response: a 422 means the answer failed the schema, and a 409 means `interrupt_id` did not match the open interrupt or the thread is not paused. In Python, these are `ResumeValidationError` and `InterruptMismatchError`.

## Run it in production

Under `10xgraph dev` the pause surfaces as an interrupt in the HTTP response, and the client resumes by posting to the same thread. Use a durable checkpointer such as `PgCheckpointer`, passed to `compile()`, so a pending approval survives a restart. See [Pause and resume over the API](/docs/server/invoke-and-stream#human-in-the-loop-pause-and-resume) and [Scaling and reliability](/docs/production/scaling).

## See also

- [Concepts: Interrupts](/docs/concepts/interrupts): arguments, re-execution, fixed-point pauses
- [Zero-trust agents: Human approval](/docs/security/zero-trust-agents#human-approval): per-tool approval with `ToolGuard`
- [Guide: Stream a graph](/docs/guides/stream-graph): streaming graph execution
- [Integration: CopilotKit](/docs/integrations/copilotkit): building UIs with pause/resume
