---
title: "Interrupts: human-in-the-loop"
description: "Pause graph execution from inside a node or tool to request human input, then resume with an answer."
order: 70
group: "Foundations"
section: Concepts
updated: "2026-11-25"
---

Human-in-the-loop patterns pause a graph mid-execution to collect human input: an approval, a correction, a choice, or confirmation. 10xGraph provides two interrupt mechanisms: the `interrupt()` function for pauses inside your code, and `interrupt_before`/`interrupt_after` for pauses at fixed node boundaries.

## The interrupt() function for decisions inside code

Call `interrupt()` inside a node or tool whenever your code needs outside input. The graph pauses, reports the request, saves its state, and ends the run. You then resume the same thread with the answer, and `interrupt()` returns that value.

```python
from tenxgraph.utils import interrupt

# issue_refund is your own function that performs the refund.
async def refund_tool(amount: float) -> str:
    """A tool that asks for approval before issuing a refund."""
    decision = interrupt(
        value={"amount": amount},
        message=f"Approve a refund of ${amount}?",
        reason="tool_approval",
        response_schema={
            "type": "object",
            "properties": {"approved": {"type": "boolean"}}
        },
    )
    if not decision or not decision.get("approved"):
        return "Refund declined"
    return issue_refund(amount)
```

When this tool runs, the graph calls `interrupt()`, which raises `GraphInterrupt` internally. The graph catches it, saves the pending request, and returns control. Later, you resume with the answer:

```python
from tenxgraph import Message
from tenxgraph.utils import ResponseGranularity

# First run: pauses at interrupt()
config = {"thread_id": "refund-123"}
result = await graph.ainvoke(
    {"messages": [Message.text_message("Please refund my order")]},
    config=config,
    response_granularity=ResponseGranularity.FULL,  # include "state" in the result
)

# The thread is paused; inspect what it's waiting for
from tenxgraph.utils import pending_interrupt
request = pending_interrupt(result["state"])
print(request.message)  # "Approve a refund of $150?"
print(request.value)    # {"amount": 150}

# Resume with the answer
result = await graph.ainvoke(
    {"resume": {"approved": True}},
    config=config
)
# The refund_tool runs again; interrupt() now returns {"approved": True}
```

### Arguments and return value

`interrupt()` takes four optional parameters:

| Parameter | Type | Purpose |
|---|---|---|
| `value` | Any | Data for the person answering: what to approve, what to choose from, context they need. |
| `message` | str | Human-readable prompt shown by UI frameworks (CopilotKit and similar). |
| `reason` | str | Machine-readable pause reason, e.g. `"tool_approval"`, `"user_choice"`, `"input_required"` (default). |
| `response_schema` | dict | JSON Schema the resume value must match. Helps UIs build forms. The resume is checked against it (see below). |

The function returns the resume value on the next run (or `None` if the client cancelled).

### Control flow and side effects

The interrupted node or tool runs twice: once until `interrupt()`, and again from the top on resume. Keep side effects (database writes, API calls, payment processing) **after** the `interrupt()` call:

```python
async def refund_tool(amount: float) -> str:
    # This code runs twice
    audit_log(f"Refund requested for ${amount}")  # WRONG: runs twice
    
    decision = interrupt({"amount": amount}, message=f"Approve ${amount}?")
    
    # This code runs only after resume
    if decision and decision.get("approved"):
        issue_refund(amount)  # CORRECT: only after approval
    return "refund complete"
```

If you call `interrupt()` multiple times in one node or tool, they are answered in order. Each resume answers one call:

```python
async def complex_approval() -> str:
    step1 = interrupt({"step": 1}, message="Approve step 1?")
    # Run pauses. Resume with an answer.
    # The node re-runs from the top, step1 now has the answer.
    
    if step1:
        step2 = interrupt({"step": 2}, message="Approve step 2?")
        # Run pauses again. Resume with the next answer.
```

In a `ToolNode` running parallel tools, tool calls that already completed on the first run are not re-executed; their results come from the tool-result ledger during the second run.

## What interrupt() saves in the checkpoint

When `interrupt()` is called, the graph saves the pause as part of the thread's checkpoint:

- **`interrupted_node`**: The node that was running.
- **`interrupt_reason`**: Always `"interrupt"` (`INTERRUPT_REASON`). The `reason` you passed is inside `interrupt_data`.
- **`interrupt_data`**: A JSON-serialized `Interrupt` object with the id, message, value, reason, schema, and tool_call_id.
- **`status`**: Set to `ExecutionStatus.INTERRUPTED_BEFORE` (the node will re-run when resumed).

The pause is part of the saved state, so it survives a restart when the checkpointer is durable.

## Resume: how it works

Resuming is an `invoke()` or `stream()` call with a `resume` key in the input instead of `messages`, as in the first example on this page.

On resume, the graph:
1. Loads the checkpointed thread.
2. Re-enters the interrupted node with resume values stored in the node's scope.
3. Re-executes the node from the start.
4. When `interrupt()` is reached, it returns the resume value instead of pausing.
5. The node continues normally.

A client that cancels instead of answering sends `{"resume": null}`. The `interrupt()` call returns `None`, allowing code to detect the cancellation.

## Bind a resume to its interrupt

A plain `{"resume": value}` answers whatever prompt the thread is paused at. That is risky when a request is retried or a second tab sends a stale answer: it could answer the next prompt of a node that calls `interrupt()` twice, before anyone has seen it.

To prevent this, name the interrupt you are answering. Add the key `resume_interrupt_id` (the constant `RESUME_INTERRUPT_ID_KEY` in `tenxgraph.utils.interrupt`) with the `id` of the pending interrupt:

```python
request = pending_interrupt(result["state"])

result = await graph.ainvoke(
    {"resume": {"approved": True}, "resume_interrupt_id": request.id},
    config=config,
)
```

The key is optional. Without it, the resume answers the pending interrupt as before.

Four errors can reject a resume or the input meant for a paused thread. Nothing is recorded when one is raised, and all are also `ValueError`s, so existing handlers for a bad resume keep working. The API server answers 409 for `INTERRUPT_001`, `INTERRUPT_003` and `INTERRUPT_004`, and 422 for `INTERRUPT_002`.

| Exception | Code | Raised when |
|---|---|---|
| `InterruptMismatchError` | `INTERRUPT_001` | `resume_interrupt_id` is not the id of the pending interrupt. |
| `ResumeValidationError` | `INTERRUPT_002` | The resume value fails the interrupt's `response_schema`. |
| `NothingToResumeError` | `INTERRUPT_003` | A `resume` was sent to a thread that is not paused at an `interrupt()`. |
| `InterruptPendingError` | `INTERRUPT_004` | A plain new message was sent to a thread that is paused at an `interrupt()`. Resume it with a `resume` value. |

A resume of `None` (a cancel) is never checked against the schema. To let a user cancel, accept a cancel option in `response_schema` or send `{"resume": null}`.

### The schema subset

The check uses a small built-in validator, so no JSON Schema library is needed. It supports these keywords:

- `type`: a type name or a list of names (`string`, `boolean`, `integer`, `number`, `null`, `array`, `object`).
- `enum`
- `properties` and `required`
- `items`, as a single schema

Any other keyword (`oneOf`, `pattern`, `minimum` and so on) is ignored. A schema that uses only those keywords is checked only for the ones above.

## Fixed-point interrupts with interrupt_before and interrupt_after

Instead of pausing inside code, pause the graph at node boundaries using `compile()` parameters:

```python
graph = StateGraph(AgentState)
# ... add nodes and edges ...
compiled = graph.compile(
    interrupt_before=["approval_node", "user_input_node"],
    interrupt_after=["agent", "tool_node"],
)
```

With `interrupt_before=["approval_node"]`, the graph pauses **before** that node runs on any execution. With `interrupt_after=["tool_node"]`, it pauses **after** the node completes.

This differs from `interrupt()`: fixed-point interrupts trigger at the boundary regardless of code logic. Use them for workflows with fixed gates (e.g. always ask for approval before a specific node) or when integrating with external approval systems.

These pauses are not `interrupt()` pauses: `state.is_interrupted()` is true, but `pending_interrupt(state)` returns `None` and there is no resume value to send. To continue, invoke the same thread again with new input; sending `{"resume": ...}` raises a `ValueError`.

## The Interrupt and GraphInterrupt classes

The `Interrupt` class represents a pending pause:

```python
from tenxgraph.utils import Interrupt

request = pending_interrupt(state)
print(request.id)            # Unique pause id
print(request.node)          # Node that paused
print(request.message)       # Human prompt
print(request.reason)        # Machine-readable reason
print(request.value)         # Payload passed to interrupt()
print(request.response_schema)  # JSON Schema for validation
print(request.tool_call_id)  # Set if interrupt() ran inside a tool
```

`GraphInterrupt` is a `BaseException` subclass raised by `interrupt()` to stop the graph. It derives from `BaseException` (not `Exception`) so tool and node error handlers that catch `except Exception` pass it through untouched, preventing false "tool error" reports.

## Over the API

Send `resume` instead of `messages` to `/v1/graph/invoke`, `/v1/graph/stream` or the WebSocket, with the thread id in `config`. Send the pending interrupt's id as `interrupt_id` to bind the answer; the server passes it to core as `resume_interrupt_id`. A mismatch or a thread that is not paused answers 409, a schema failure 422 (an error chunk on stream and WebSocket). On a stream the pause arrives as an `updates` chunk with `"status": "interrupted"` at every granularity. See [Add human approval](/docs/guides/add-human-approval#using-interrupt-over-the-rest-api).

## When to use interrupt() vs interrupt_before/after vs callbacks

| Mechanism | Use when | Example |
|---|---|---|
| `interrupt()` | You need to pause inside code logic, after a calculation, conditionally. | "Ask for approval only if the refund is over $1000." |
| `interrupt_before` / `interrupt_after` | You always pause at fixed node boundaries. | "Every time this approval node runs, pause." |
| Callbacks (not interrupts) | You want to observe or modify execution without pausing. | "Log every node execution" or "validate input before running." |

For a per-tool approval gate without writing `interrupt()` yourself, use `ToolGuard(approval={"tool_name"})`; see [Human approval](/docs/security/zero-trust-agents#human-approval).

## Who can resume

Over the API only the thread's owner can resume, so the resume value is the requester's own answer, not an approval by someone else. See [Who is allowed to approve](/docs/guides/add-human-approval#who-is-allowed-to-approve).

## Limitations and gotchas

- **Requires checkpointing:** Interrupts must save the thread state, so a checkpointer is required. `compile()` creates an `InMemoryCheckpointer` by default, which loses the pause on restart; use `PgCheckpointer` in production.
- **Serialization:** The Interrupt object is JSON-serialized in the checkpoint. Custom Python objects in `value` or `response_schema` must be JSON-serializable.
