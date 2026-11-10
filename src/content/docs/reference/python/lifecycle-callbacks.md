---
title: Lifecycle Callbacks
description: GraphLifecycleHook, GraphLifecycleContext - hook into graph-level events (start, end, error, interrupt, resume, checkpoint, state update).
section: Reference
group: "Python library"
order: 150
updated: "2026-10-08"
---

A lifecycle hook is a class that runs code at structural points of a graph run: start, end, error, interrupt, resume, checkpoint and each state update. Subclass `GraphLifecycleHook`, override the methods you need, and register it on a `CallbackManager`. For per-LLM, tool and MCP call hooks, see [Callback Manager](/docs/reference/python/callback-manager). For patterns, see [Use callbacks](/docs/guides/use-callbacks).

## Import

```python
from tenxgraph.utils.callbacks import GraphLifecycleHook, GraphLifecycleContext
from tenxgraph.core.state import AgentState, Message
```

## GraphLifecycleContext

Passed to every hook with metadata about the current execution.

**Fields:**

| Field | Type | Description |
|---|---|---|
| `config` | `dict[str, Any]` | Full config dict passed to `invoke()` or `stream()`. |

**Properties:**

| Property | Type | Returns |
|---|---|---|
| `thread_id` | `str` | `config.get("thread_id", "")`, conversation ID or empty string. |
| `run_id` | `str` | `config.get("run_id", "")`, execution ID or empty string. |

---

## GraphLifecycleHook

Base class whose methods are all no-ops that return `None`. Override only the methods you need.

### on_graph_start

Fires after state is loaded but before the first node executes.

**Signature:**

```python
async def on_graph_start(
    self,
    context: GraphLifecycleContext,
    state: AgentState,
) -> AgentState | None:
```

**Parameters:**

| Param | Type | Description |
|---|---|---|
| `context` | `GraphLifecycleContext` | Execution context with thread_id, run_id, config. |
| `state` | `AgentState` | Loaded or freshly created initial state. |

**Returns:** `AgentState | None`
- Return `None` to use original state unchanged.
- Return modified `AgentState` to replace initial state before graph execution.

**Example:**

```python
class TraceStartHook(GraphLifecycleHook):
    async def on_graph_start(self, context, state):
        print(f"Starting: thread={context.thread_id} run={context.run_id}")
        return state  # or None to keep unchanged
```

---

### on_graph_end

Fires after execution loop completes successfully, before final persistence.

**Signature:**

```python
async def on_graph_end(
    self,
    context: GraphLifecycleContext,
    final_state: AgentState,
    messages: list[Message],
    total_steps: int,
) -> AgentState | None:
```

**Parameters:**

| Param | Type | Description |
|---|---|---|
| `context` | `GraphLifecycleContext` | Execution context. |
| `final_state` | `AgentState` | State after execution completes. |
| `messages` | `list[Message]` | All messages produced during the run. |
| `total_steps` | `int` | Final step count. |

**Returns:** `AgentState | None`
- Return `None` to persist unchanged.
- Return modified `AgentState` to persist and return modified state.

**Example:**

```python
class MetricsEndHook(GraphLifecycleHook):
    async def on_graph_end(self, context, final_state, messages, total_steps):
        print(f"Completed: {total_steps} steps, {len(messages)} messages")
        return None
```

---

### on_graph_error

Fires when an unhandled exception escapes the execution loop. **Cannot suppress the error.** The exception is always re-raised after the hook completes.

**Signature:**

```python
async def on_graph_error(
    self,
    context: GraphLifecycleContext,
    error: Exception,
    partial_state: AgentState,
    messages: list[Message],
    step: int,
    node_name: str,
) -> tuple[AgentState, str] | None:
```

**Parameters:**

| Param | Type | Description |
|---|---|---|
| `context` | `GraphLifecycleContext` | Execution context. |
| `error` | `Exception` | The unhandled exception. |
| `partial_state` | `AgentState` | State at error point (after `state.error()`). |
| `messages` | `list[Message]` | Messages collected before error. |
| `step` | `int` | Step number where error occurred. |
| `node_name` | `str` | The node that failed. |

**Returns:** `tuple[AgentState, str] | None`
- Return `None` to persist unchanged; re-raise original error message.
- Return `(AgentState, str)` to persist modified state and error message, then re-raise.

**Example:**

```python
class ErrorAlertHook(GraphLifecycleHook):
    async def on_graph_error(self, context, error, partial_state, messages, step, node_name):
        print(f"Error at {node_name}: {error}")
        return None  # or modify state before re-raising
```

---

### on_interrupt

Fires when graph execution pauses at an interrupt point.

**Signature:**

```python
async def on_interrupt(
    self,
    context: GraphLifecycleContext,
    interrupted_node: str,
    interrupt_type: str,
    state: AgentState,
) -> AgentState | None:
```

**Parameters:**

| Param | Type | Description |
|---|---|---|
| `context` | `GraphLifecycleContext` | Execution context. |
| `interrupted_node` | `str` | The node where execution paused. |
| `interrupt_type` | `str` | `"before"`, `"after"`, `"stop"`, `"remote_tool"` or `"interrupt"`. |
| `state` | `AgentState` | State at interrupt point. |

**Returns:** `AgentState | None`
- Return `None` to persist unchanged.
- Return modified `AgentState` to persist modified state.

**Example:**

```python
class InterruptNotificationHook(GraphLifecycleHook):
    async def on_interrupt(self, context, interrupted_node, interrupt_type, state):
        print(f"Paused at {interrupted_node} ({interrupt_type})")
        return state
```

---

### on_resume

Fires when a previously interrupted graph is resumed.

**Signature:**

```python
async def on_resume(
    self,
    context: GraphLifecycleContext,
    resumed_node: str,
    state: AgentState,
    resume_data: dict[str, Any],
) -> AgentState | None:
```

**Parameters:**

| Param | Type | Description |
|---|---|---|
| `context` | `GraphLifecycleContext` | Execution context. |
| `resumed_node` | `str` | The node being resumed. |
| `state` | `AgentState` | The loaded interrupted state (before clearing interrupt). |
| `resume_data` | `dict[str, Any]` | Mutable dict with data passed to `ainvoke()` on resume. |

**Returns:** `AgentState | None`
- Return `None` to continue with loaded state.
- Return modified `AgentState` to continue with modified state.

**Example:**

```python
class ResumeValidationHook(GraphLifecycleHook):
    async def on_resume(self, context, resumed_node, state, resume_data):
        print(f"Resumed at {resumed_node}")
        return state
```

---

### on_checkpoint

Fires immediately before state/messages are persisted to the checkpointer. Fires every time state is persisted, including during interrupts, stops, and errors.

**Signature:**

```python
async def on_checkpoint(
    self,
    context: GraphLifecycleContext,
    state: AgentState,
    messages: list[Message],
    is_context_trimmed: bool,
) -> tuple[AgentState, list[Message]] | AgentState | None:
```

**Parameters:**

| Param | Type | Description |
|---|---|---|
| `context` | `GraphLifecycleContext` | Execution context. |
| `state` | `AgentState` | State about to be persisted. |
| `messages` | `list[Message]` | Messages about to be persisted. |
| `is_context_trimmed` | `bool` | Whether context compression was applied. |

**Returns:** `tuple[AgentState, list[Message]] | AgentState | None`
- Return `None` to persist unchanged.
- Return `AgentState` to persist returned state with current messages.
- Return `(AgentState, list[Message])` to persist both returned values.

**Example:**

```python
class CheckpointHook(GraphLifecycleHook):
    async def on_checkpoint(self, context, state, messages, is_context_trimmed):
        print(f"Checkpointing {len(messages)} messages")
        return None
```

---

### on_state_update

Fires after each node transition, after a node executes and state is merged. Most granular graph-level hook.

**Signature:**

```python
async def on_state_update(
    self,
    context: GraphLifecycleContext,
    node_name: str,
    old_state: AgentState,
    new_state: AgentState,
    step: int,
) -> AgentState | None:
```

**Parameters:**

| Param | Type | Description |
|---|---|---|
| `context` | `GraphLifecycleContext` | Execution context. |
| `node_name` | `str` | The node that just executed. |
| `old_state` | `AgentState` | Deep copy of state **before** node ran. |
| `new_state` | `AgentState` | State after node result merged. |
| `step` | `int` | Current step number. |

**Returns:** `AgentState | None`
- Return `None` to use `new_state` unchanged.
- Return modified `AgentState` to replace `new_state` for rest of graph.

**Example:**

```python
class ObserveTransitionHook(GraphLifecycleHook):
    async def on_state_update(self, context, node_name, old_state, new_state, step):
        msg_delta = len(new_state.messages) - len(old_state.messages)
        print(f"Step {step}: {node_name} (+{msg_delta} messages)")
        return None
```

To react to one tool's result, read `ToolResultBlock.name` on the messages the node added:

```python
from tenxgraph.core.state.message_block import ToolResultBlock

class SearchResultHook(GraphLifecycleHook):
    async def on_state_update(self, context, node_name, old_state, new_state, step):
        for message in new_state.context[len(old_state.context):]:
            for block in message.content:
                if isinstance(block, ToolResultBlock) and block.name == "search":
                    print(f"search finished (error={block.is_error})")
        return None
```

---

### on_turn_start and on_turn_end

Realtime sessions only. Fire when a conversation turn begins or completes. A turn spans one model generation; `turn_index` is 1-based. Never fire for turn-based `invoke` or `stream` runs.

**Signatures:**

```python
async def on_turn_start(
    self,
    context: GraphLifecycleContext,
    state: AgentState,
    turn_index: int,
) -> AgentState | None:

async def on_turn_end(
    self,
    context: GraphLifecycleContext,
    state: AgentState,
    turn_index: int,
) -> AgentState | None:
```

**Parameters:**

| Param | Type | Description |
|---|---|---|
| `context` | `GraphLifecycleContext` | Execution context. |
| `state` | `AgentState` | Current state. |
| `turn_index` | `int` | 1-based turn number. |

**Returns:** `AgentState | None`
- Return modified `AgentState` to replace current state, or `None` to keep it.

**Example:**

```python
class TurnLogHook(GraphLifecycleHook):
    async def on_turn_end(self, context, state, turn_index):
        print(f"Turn {turn_index} ended")
        return None
```

---

## Register a hook

Register a hook with `CallbackManager` and pass the manager to `compile()`:

```python
from tenxgraph.core.graph import StateGraph
from tenxgraph.core.state import AgentState
from tenxgraph.utils.callbacks import CallbackManager, GraphLifecycleHook

class MyLifecycleHook(GraphLifecycleHook):
    async def on_graph_start(self, context, state):
        print(f"Run {context.run_id} started")
        return None


cbm = CallbackManager()
cbm.register_lifecycle_hook(MyLifecycleHook())

graph = StateGraph(AgentState)
# Add your nodes and edges here, then compile with the manager.
app = graph.compile(callback_manager=cbm)

# Hooks fire automatically during invoke/stream
# result = await app.ainvoke({"messages": [Message.text_message("Hi")]})
```

---

## Common errors

| Error | Cause | Fix |
|---|---|---|
| Lifecycle hook never fires | Hook not registered on `CallbackManager` passed to `compile()`. | Call `cbm.register_lifecycle_hook(MyHook())` before `compile()`. |
| `on_graph_error` doesn't suppress error | By design; the exception always re-raises. | Use node-level `on_error` callbacks in [Callback Manager](/docs/reference/python/callback-manager) for error recovery. |
| `on_interrupt` not called | Interrupt not triggered; node completed successfully. | Set `interrupt_before` or `interrupt_after` on `compile()`, or call `stop()` through the API. |
