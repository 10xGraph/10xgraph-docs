---
title: State
seoTitle: "AgentState API reference (Python)"
description: "Reference for AgentState, ExecutionState, ExecutionStatus and the reducer functions in tenxgraph.core.state, with signatures, fields and examples."
section: Reference
group: "Python library"
order: 50
label: State
updated: "2026-10-08"
---

`AgentState` is the Pydantic model that every node in a 10xGraph graph reads and updates. It holds the message history (`context`), an optional rolling summary, and framework-managed execution metadata (`ExecutionState`). Subclass it to add your own fields. Reducer functions control how message lists and other values merge.

## Import

All names below are exported from `tenxgraph.core.state`. `Command` lives in `tenxgraph.utils.command` and `StateGraph` in `tenxgraph.core.graph`.

```python
from tenxgraph.core.state import (
    AgentState,
    ExecutionState,
    ExecutionStatus,
    Message,
    add_messages,
    append_items,
    remove_tool_messages,
    replace_messages,
    replace_value,
)
```

For the `Message` class and content blocks, see [Messages](/docs/reference/python/messages). For the concepts behind state, see [State and messages](/docs/concepts/state-and-messages), and for a walkthrough of custom fields see [Use custom state](/docs/guides/use-custom-state).

## `AgentState`

`AgentState` is the default state class. It has three fields and a set of convenience methods that delegate to `execution_meta`. Subclasses keep all of them.

```python
class AgentState(BaseModel):
    context: Annotated[list[Message], add_messages] = Field(default_factory=list)
    context_summary: str | None = None
    execution_meta: ExecutionState = Field(default_factory=lambda: ExecutionState(current_node=START))
```

### Fields

| Field | Type | Default | Description |
|---|---|---|---|
| `context` | `list[Message]` (reducer `add_messages`) | `[]` | Message history. New messages are appended; messages whose `message_id` already exists are dropped. |
| `context_summary` | `str \| None` | `None` | Optional summary of earlier conversation, written by summary logic such as `SummaryContextManager`. |
| `execution_meta` | `ExecutionState` | `ExecutionState(current_node=START)` | Execution progress and interrupt data, managed by the runtime. |

### Methods

| Method | Returns | Description |
|---|---|---|
| `is_running()` | `bool` | `True` when `execution_meta.status` is `RUNNING`. |
| `is_interrupted()` | `bool` | `True` when the status is `INTERRUPTED_BEFORE` or `INTERRUPTED_AFTER`. |
| `is_stopped_requested()` | `bool` | `True` when a stop was requested for the run (see `CompiledGraph.stop`). |
| `set_interrupt(node, reason, status, data=None)` | `None` | Records an interrupt: `node: str`, `reason: str`, `status: ExecutionStatus`, `data: dict \| None`. |
| `clear_interrupt()` | `None` | Clears the interrupt fields and sets the status back to `RUNNING`. |
| `advance_step()` | `None` | Increments `execution_meta.step`. |
| `set_current_node(node)` | `None` | Sets `execution_meta.current_node` to `node: str`. |
| `complete()` | `None` | Sets the status to `COMPLETED`. |
| `error(error_msg)` | `None` | Sets the status to `ERROR` and stores `error_msg: str` in `execution_meta.internal_data["error"]`. |

The runtime calls the lifecycle methods (`set_interrupt`, `advance_step`, `complete`, `error`) for you. Application code normally only reads `is_running()`, `is_interrupted()` and `is_stopped_requested()`.

### Read state in a node

```python
from tenxgraph.core.state import AgentState, Message


# Nodes receive the current state and the run config.
def greet(state: AgentState, config: dict) -> list[Message]:
    # Read the last user message from the history.
    last = state.context[-1].text() if state.context else ""
    return [Message.text_message(f"You said: {last}", role="assistant")]
```

## Subclass `AgentState` to add fields

Inherit from `AgentState` to add application fields. `context`, `context_summary` and `execution_meta` are preserved, and the whole state, including your fields, is what checkpointers persist.

```python
from pydantic import BaseModel, Field

from tenxgraph.core.graph import StateGraph
from tenxgraph.core.state import AgentState, Message


class OrderState(AgentState):
    """State for an order-processing graph."""

    order_id: str | None = None
    cart: list[dict] = Field(default_factory=list)
    confirmed: bool = False


# Nodes mutate the state and return it, or return messages to append.
def process_order(state: OrderState, config: dict) -> list[Message]:
    state.confirmed = True
    return [Message.text_message(f"Order {state.order_id} confirmed", role="assistant")]


# Pass an instance of your class as the graph's initial state.
graph = StateGraph(OrderState())
graph.add_node("process_order", process_order)
```

## How nodes update state

A node changes state by returning a value, or by mutating the `state` object it was given and returning it. The runtime appends any new messages to `state.context` through `add_messages`.

| Node returns | Effect |
|---|---|
| `str` | Wrapped as an assistant text message and appended to `context`. |
| `Message` | Appended to `context` unless its `message_id` already exists. |
| `list` of `Message` or `str` | Each item is converted as above and appended. |
| `AgentState` (or subclass) | Becomes the new state; messages not seen before are reported as new. Use this to change custom fields. |
| `dict` | A partial state update: each key is a state field set to the value (validated against the field's type); `"messages"` appends a `Message` or list of messages. An unknown field raises `ValueError`. |
| `None` | No change. |
| `Command` | `Command(update=..., goto=...)`: the `update` is processed as above and `goto` picks the next node. |

Any other return type raises `ValueError` (the node fails with `NODE_001`). To change a custom field, return `{"field": value}` or set it on `state` and return `state`.

```python
from tenxgraph.core.state import AgentState, Message


class CounterState(AgentState):
    attempts: int = 0


def retry_node(state: CounterState, config: dict) -> CounterState:
    # Change a custom field in place, then return the state.
    state.attempts += 1
    state.context.append(Message.text_message(f"Attempt {state.attempts}", role="assistant"))
    return state
```

## `ExecutionState`

`ExecutionState` is the Pydantic model behind `AgentState.execution_meta`. It records which node is running, the step count, the status, and interrupt and stop data. Read it for diagnostics; let the runtime write it.

```python
class ExecutionState(BaseModel):
    current_node: str
    step: int = 0
    status: ExecutionStatus = ExecutionStatus.RUNNING
    interrupted_node: str | None = None
    interrupt_reason: str | None = None
    interrupt_data: dict[str, Any] | None = None
    thread_id: str | None = None
    stop_current_execution: StopRequestStatus = StopRequestStatus.NONE
    internal_data: dict[str, Any] = Field(default_factory=dict)
```

### Fields

| Field | Type | Default | Description |
|---|---|---|---|
| `current_node` | `str` | required | Node currently executing. |
| `step` | `int` | `0` | Number of steps taken. |
| `status` | `ExecutionStatus` | `RUNNING` | Current status. |
| `interrupted_node` | `str \| None` | `None` | Node where the last interrupt occurred. |
| `interrupt_reason` | `str \| None` | `None` | Reason recorded for the interrupt. |
| `interrupt_data` | `dict[str, Any] \| None` | `None` | Extra data attached to the interrupt. |
| `thread_id` | `str \| None` | `None` | Thread ID, if set. |
| `stop_current_execution` | `StopRequestStatus` | `NONE` | Stop flag: `NONE`, `STOP_REQUESTED` or `STOPPED`. |
| `internal_data` | `dict[str, Any]` | `{}` | Framework-managed data. `error()` stores its message under the `"error"` key. |

`StopRequestStatus` is defined in `tenxgraph.core.state.execution_state` and is not re-exported from `tenxgraph.core.state`.

### Methods

`ExecutionState` has the same methods as `AgentState` (`set_interrupt`, `clear_interrupt`, `is_interrupted`, `advance_step`, `set_current_node`, `complete`, `error`, `is_running`, `is_stopped_requested`) with identical parameters. It adds one class method:

| Method | Returns | Description |
|---|---|---|
| `ExecutionState.from_dict(data)` | `ExecutionState` | Builds an instance from a dict. `current_node` is required; `step`, `status` (default `"running"`), the interrupt fields and `thread_id` are optional. Internal data is read from the `_internal_data` key. |

### `ExecutionStatus`

`ExecutionStatus` is a `StrEnum` with these values.

| Member | Value |
|---|---|
| `RUNNING` | `"running"` |
| `INTERRUPTED_BEFORE` | `"interrupted_before"` |
| `INTERRUPTED_AFTER` | `"interrupted_after"` |
| `COMPLETED` | `"completed"` |
| `ERROR` | `"error"` |

### Inspect execution metadata

```python
from tenxgraph.core.state import AgentState

state = AgentState()
meta = state.execution_meta

print(meta.current_node)   # the start node until the run begins
print(meta.step)           # 0
print(meta.is_running())   # True

# After an interrupt, these fields tell you where and why it paused.
if state.is_interrupted():
    print(f"Paused at {meta.interrupted_node}: {meta.interrupt_reason}")
```

## Reducers

Reducers are functions of the form `(left, right) -> merged`. Declare one with `Annotated[type, reducer]` on a state field. The runtime always applies `add_messages` to `context` when a node produces messages. For custom fields, a reducer is used when parallel tool calls in one tool node change the same field: it combines their results instead of letting the last write win. Fields without a reducer keep the last write and log a warning on conflict.

### `add_messages`

```python
def add_messages(left: list[Message], right: list[Message]) -> list[Message]
```

Appends `right` to `left`, skipping messages whose `message_id` is already in `left` and messages with `delta=True`.

| Parameter | Type | Description |
|---|---|---|
| `left` | `list[Message]` | Existing messages. |
| `right` | `list[Message]` | New messages to add. |

Returns the combined `list[Message]`.

### `replace_messages`

```python
def replace_messages(left: list[Message], right: list[Message]) -> list[Message]
```

Returns `right` and ignores `left`. Use it on a field that should be overwritten by each update.

### `append_items`

```python
def append_items(left: list, right: list) -> list
```

Appends items from `right` whose `.id` is not already present in `left`. Every item in both lists must have an `id` attribute, otherwise an `AttributeError` is raised.

### `replace_value`

```python
def replace_value(left, right)
```

Returns `right` and ignores `left`.

### Declare reducers on custom fields

```python
from typing import Annotated

from pydantic import BaseModel, Field

from tenxgraph.core.state import AgentState, append_items, replace_value


class Finding(BaseModel):
    id: str
    text: str


class AnalysisState(AgentState):
    # Parallel tool calls that add findings are merged, deduplicated by id.
    findings: Annotated[list[Finding], append_items] = Field(default_factory=list)
    # The latest value wins.
    stage: Annotated[str, replace_value] = "start"
```

### `remove_tool_messages`

```python
def remove_tool_messages(messages: list[Message]) -> list[Message]
```

Removes completed tool interactions from a message list to shorten history. A sequence is completed only when an assistant message with `tools_calls` is followed by one or more `role="tool"` messages and then an assistant message without `tools_calls`. The assistant message with tool calls and the tool results are removed; the final assistant message is kept. Incomplete sequences are left untouched. An empty list is returned as is.

| Parameter | Type | Description |
|---|---|---|
| `messages` | `list[Message]` | Messages to filter. |

Returns the filtered `list[Message]`. It raises nothing.

```python
from tenxgraph.core.state import Message, ToolResultBlock, remove_tool_messages

messages = [
    Message.text_message("What is 2 + 2?", role="user"),
    # Assistant turn that requested a tool.
    Message(
        role="assistant",
        content=[],
        tools_calls=[{"id": "call_1", "type": "function", "function": {"name": "calc"}}],
    ),
    # Tool result for that call.
    Message.tool_message([ToolResultBlock(call_id="call_1", output="4")]),
    # Final assistant answer without tool calls.
    Message.text_message("The answer is 4.", role="assistant"),
]

cleaned = remove_tool_messages(messages)
print([m.role for m in cleaned])  # ['user', 'assistant']
```

If the last message were the tool result, the sequence would be incomplete and all four messages would be kept.
