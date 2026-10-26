---
title: "Add human approval with interrupt()"
seoTitle: "Pause for human approval: interrupt()"
description: "Pause a graph mid-execution for human approval, correction, or choice from inside a node or tool. Resume when the decision is made."
section: "Build agents"
group: "Multi-agent and control flow"
order: 290
label: "Pause for human input"
updated: "2026-10-27"
---

## Overview

`interrupt()` pauses a graph from inside a node or tool while it is running, saving the state and waiting for outside input. The next time you run the same thread with a `resume` value, the paused node resumes and `interrupt()` returns that value. Use this when the decision belongs in the middle of a node's logic, for example approving a refund, choosing among options, or asking for clarification.

If instead you need to pause at fixed boundaries in the graph (before or after a named node), use [`interrupt_before` and `interrupt_after` on `compile()`](/docs/concepts/interrupts), which are simpler for structural pauses. When the decision is dynamic (inside a tool or node logic), `interrupt()` is the right choice.

## When to use `interrupt()`

Use `interrupt()` when a node or tool needs human input partway through its execution. Common examples:

- **Tool approval:** A refund tool calls `interrupt()` before issuing a payment, asking "Refund $25?" The tool then completes only if the human approves.
- **Multi-choice:** A routing tool pauses and asks the user which of three options they prefer, then branches based on the response.
- **Clarification:** A tool detects ambiguous input and asks the human to clarify before proceeding.
- **Sensitivity check:** A content moderation tool pauses and asks a human to review a flagged item before forwarding it.

Contrast this with `interrupt_before` / `interrupt_after` on `compile()`, which are better for:
- Pausing before a planning phase and collecting a plan
- Pausing before expensive operations and getting confirmation
- Pausing after a node completes and inspecting or editing its output

See [Concepts: Interrupts](/docs/concepts/interrupts) to understand the difference in depth.

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

The `interrupt()` function accepts these parameters:

| Parameter | Type | Description |
| --- | --- | --- |
| `value` | Any | Data to send to whoever resumes: the amount to approve, options to choose from, or context for clarification. |
| `message` | `str \| None` | A human-readable prompt, shown by UI frameworks like CopilotKit. Include the question or instruction here. |
| `reason` | `str` | A machine-readable tag for the pause reason, e.g. `"tool_approval"`, `"user_choice"`, `"clarification"`. Defaults to `"input_required"`. Useful for logging and routing in UIs. |
| `response_schema` | `dict \| None` | JSON Schema describing the expected resume value. Helps the client validate and present a UI for the answer. |

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
from tenxgraph.core.state.stream_chunks import StreamEvent
from tenxgraph.utils.constants import ResponseGranularity

config = {"thread_id": "order-42"}

async for chunk in app.astream(
    {"messages": [Message.text_message("Refund my order, it was $25")]},
    config=config,
    response_granularity=ResponseGranularity.FULL,
):
    if chunk.event == StreamEvent.UPDATES:
        # Check if this is an interrupt event.
        if chunk.data.get("status") == "interrupted":
            interrupt_data = chunk.data.get("interrupt")
            print(f"Paused: {interrupt_data['message']}")
            print(f"Value: {interrupt_data['value']}")
            break  # Stop streaming once paused.
```

When using `astream()`, only `ResponseGranularity.FULL` includes the `UPDATES` chunk that signals an interrupt. Other granularities (LOW, PARTIAL) do not.

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

The paused node runs again from the start (not from the interrupt call), and this time `interrupt()` returns the resume value instead of stopping the graph. The execution continues normally after that.

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

The code can check for `None` and handle the cancellation:

```python
decision = interrupt(..., message="Approve?")
if decision is None:
    return "User cancelled."
```

### Multiple interrupts in one node

If a node or tool calls `interrupt()` multiple times, each one pauses separately. You resume them one at a time with one resume call per pause:

```python
async def multi_choice_tool() -> str:
    choice_a = interrupt(
        {"options": ["A", "B"]},
        message="First choice?"
    )  # First pause here; resume with the choice
    
    choice_b = interrupt(
        {"options": ["1", "2"]},
        message="Second choice?"
    )  # Second pause here; resume again with the choice
    
    return f"You chose {choice_a} and {choice_b}"
```

Each call to `ainvoke()` with a `resume` value answers one interrupt in order. The first resume answers the first `interrupt()` call, the graph pauses at the second, and so on.

## How `interrupt()` behaves in detail

### Node re-execution

When you resume, the interrupted node or tool runs again from the start, not from the point of `interrupt()`. This means any code before the `interrupt()` call runs twice.

**Keep side effects after the interrupt() call:**

```python
async def process_payment(amount: float) -> str:
    # This runs twice (on initial run and on resume).
    validation = check_amount(amount)
    
    # Ask for approval. This happens only once.
    approval = interrupt(
        {"amount": amount, "validated": validation},
        message=f"Process payment of ${amount}?"
    )
    
    # This runs only on resume, after approval.
    if approval:
        charge_credit_card(amount)  # Safe to run here
    
    return "Payment processed"
```

If you call `charge_credit_card(amount)` before the `interrupt()`, it would run twice: once before pausing, and again after resuming, which is wrong. By placing it after, it runs only once, after the user approves.

### Parallel tool calls

When the LLM calls multiple tools at once and one of them calls `interrupt()`, the behavior depends on how you invoke the graph:

**Under `invoke()` / `ainvoke()`:**
Tools that already finished before the interrupt are not re-run on resume. Their results are retrieved from the tool-result ledger, which caches them.

```python
async def tool_a() -> str:
    return "A finished"

async def tool_b() -> str:
    interrupt({"query": "Continue?"})  # Pauses here
    return "B finished"

# When both tools are called by the LLM:
# 1. tool_a() finishes immediately.
# 2. tool_b() calls interrupt() and pauses.
# 3. On resume, tool_b() runs again, but tool_a() does not (cached).
```

**Under `stream()` / `astream()`:**
Finished siblings are run again on resume, so make them idempotent (safe to call multiple times with the same inputs):

```python
async def idempotent_tool(order_id: str) -> str:
    # Safe to run twice with the same order_id.
    # Fetch from cache, or return cached result.
    return get_order_status(order_id)
```

### Error handling

`interrupt()` raises `GraphInterrupt`, which derives from `BaseException`, not `Exception`. This means `except Exception` blocks (including tool error handlers) let it through unchanged:

```python
async def my_tool() -> str:
    try:
        interrupt({"query": "Continue?"})
    except Exception as e:  # Does NOT catch GraphInterrupt
        return f"Error: {e}"
    # GraphInterrupt passes through and stops the graph here.
```

Do not catch `BaseException` around the `interrupt()` call, as that will suppress the pause:

```python
async def my_tool() -> str:
    try:
        interrupt({"query": "Continue?"})
    except BaseException as e:  # Catches GraphInterrupt; breaks interrupt!
        return f"Error: {e}"
    # Wrong: the graph won't pause.
```

### Calling `interrupt()` outside a node or tool

If you call `interrupt()` from outside a running graph (e.g., at module level), it raises `RuntimeError`:

```python
# This raises RuntimeError
decision = interrupt({"query": "Continue?"})
```

The function must be called from within a node or tool that the graph is currently executing.

## Using `interrupt()` over the REST API

The API server exposes the pause/resume mechanism over REST. When a thread is paused at `interrupt()`, the `/v1/graph/invoke` and `/v1/graph/stream` routes accept a `"resume"` key instead of messages:

### Invoking and pausing

The `thread_id` goes inside `config`. Set `response_granularity` to `full` so the response includes the state:

```bash
curl -X POST http://localhost:8000/v1/graph/invoke \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": [{"type": "text", "text": "Refund my order, $25"}]}],
    "config": {"thread_id": "order-42"},
    "response_granularity": "full"
  }'
```

The response has the usual `messages`, `state`, `context`, `summary` and `meta` fields. There is no top-level `interrupt` field. The pending interrupt is stored in the returned state, under `execution_meta.interrupt_data.interrupt`, with `execution_meta.interrupt_reason` set to `"interrupt"`:

```json
{
  "state": {
    "execution_meta": {
      "interrupt_reason": "interrupt",
      "interrupt_data": {
        "interrupt": {
          "id": "int_abc123...",
          "message": "Approve a refund of $25?",
          "value": {"amount": 25},
          "reason": "tool_approval",
          "response_schema": {}
        }
      }
    }
  }
}
```

### Resuming

```bash
curl -X POST http://localhost:8000/v1/graph/invoke \
  -H "Content-Type: application/json" \
  -d '{
    "resume": {"approved": true},
    "config": {"thread_id": "order-42"}
  }'
```

To bind the answer to the prompt it belongs to, add `interrupt_id` with the `id` from `execution_meta.interrupt_data.interrupt`:

```bash
curl -X POST http://localhost:8000/v1/graph/invoke \
  -H "Content-Type: application/json" \
  -d '{
    "resume": {"approved": true},
    "interrupt_id": "int_abc123...",
    "config": {"thread_id": "order-42"}
  }'
```

The server answers 409 if the thread is not paused or is paused at a different interrupt, and 422 if the answer fails the `response_schema`. Nothing runs in either case. `interrupt_id` also works on `/v1/graph/stream` and on the WebSocket, where both failures arrive as an error chunk. `interrupt_id` is optional; without it the resume answers whatever the thread is paused at.

The `/v1/graph/stream` route similarly accepts `"resume"` in place of `"messages"` to resume a paused thread and stream the rest of the execution. When streaming with `"response_granularity": "full"`, the pause arrives as an `updates` chunk with `"status": "interrupted"` and an `interrupt` object.

## Integration with AG-UI and CopilotKit

The [AG-UI](/docs/server/ag-ui) endpoint (off by default; it needs the `ag-ui` extra and a config key) supports pauses from `interrupt()`, and so does [CopilotKit](https://docs.copilotkit.ai/) on top of it:

- When the graph pauses at `interrupt()`, the run ends with an `"interrupt"` outcome.
- The UI receives the `message`, `value`, `response_schema`, and other fields from the `Interrupt` object.
- CopilotKit's `useInterrupt()` hook handles the pause and presents the prompt to the user.
- The user's response is sent back to resume the thread. The interrupt event carries the interrupt `id`, and AG-UI matches the answer to it.

See [10xGraph with CopilotKit](/docs/integrations/copilotkit) for a complete example.

## Common patterns

### Approval workflow

Use `interrupt()` in a tool that performs a sensitive action to ask for confirmation:

```python
from tenxgraph.utils import interrupt
from tenxgraph.utils.decorators import tool

@tool
async def transfer_funds(account: str, amount: float) -> str:
    """Transfer funds with human approval."""
    approval = interrupt(
        {"account": account, "amount": amount},
        message=f"Transfer ${amount} to {account}?",
        reason="payment_approval",
        response_schema={
            "type": "object",
            "properties": {"approved": {"type": "boolean"}}
        }
    )
    if not approval or not approval.get("approved"):
        return "Transfer cancelled."
    return await process_transfer(account, amount)
```

### Multi-step form

Collect multiple values across several pauses:

```python
async def collect_feedback() -> str:
    rating = interrupt(
        {"options": [1, 2, 3, 4, 5]},
        message="Rate this experience (1-5):"
    )
    if not rating:
        return "Feedback cancelled."
    
    comment = interrupt(
        {"rating": rating},
        message="Any additional comments?"
    )
    
    return f"Rating: {rating}, Comment: {comment}"
```

### Conditional routing

Ask the user which path to take:

```python
async def choose_action(data: dict) -> str:
    choice = interrupt(
        {"options": ["analyze", "summarize", "visualize"]},
        message="How should I process this?",
        response_schema={
            "type": "object",
            "properties": {"action": {"type": "string"}}
        }
    )
    action = choice.get("action") if choice else "analyze"
    
    if action == "analyze":
        return analyze(data)
    elif action == "summarize":
        return summarize(data)
    else:
        return visualize(data)
```

## Troubleshooting

### `RuntimeError: interrupt() can only be called while a graph node or tool is running`

This error occurs when `interrupt()` is called outside a graph execution context. Ensure you call it from within a node function or tool that the graph is running.

### Graph does not pause

Verify that `interrupt()` is called. If the node completes without calling it, the graph will not pause. Also ensure that `response_granularity=ResponseGranularity.FULL` is set when using `astream()` to detect the pause.

### Resume value not received

Ensure you pass the `resume` key in the next invocation. The value must match the `response_schema` if one is defined. Check the error response: a 422 means the answer failed the schema, and a 409 means `interrupt_id` did not match the open interrupt or the thread is not paused. In Python, these are `ResumeValidationError` and `InterruptMismatchError`.

## See also

- [Concepts: Interrupts](/docs/concepts/interrupts): detailed explanation of interrupt mechanisms
- [Guide: Stream a graph](/docs/guides/stream-graph): streaming graph execution
- [Integration: CopilotKit](/docs/integrations/copilotkit): building UIs with pause/resume
