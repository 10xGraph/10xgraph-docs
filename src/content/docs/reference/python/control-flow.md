---
title: Control flow
seoTitle: "Control flow API reference (Python)"
description: "Reference for Command, interrupt(), Interrupt, GraphInterrupt, pending_interrupt, create_handoff_tool and is_handoff_tool in 10xGraph."
section: Reference
group: "Python library"
order: 130
label: Control flow
updated: "2026-11-22"
---

These APIs control graph execution from inside nodes and tools. Use `Command` to update state and choose the next node in one return value, `interrupt()` to pause for human input and resume later, and handoff tools to let a model transfer control to another agent.

For concepts and walkthroughs, see [Interrupts](/docs/concepts/interrupts), [Routing, Command and callbacks](/docs/concepts/callbacks-and-command), [Add human approval](/docs/guides/add-human-approval) and [Hand off between agents](/docs/guides/handoff-between-agents).

## Import paths

```python
from tenxgraph.utils import Command, END
from tenxgraph.utils import interrupt, Interrupt, GraphInterrupt, pending_interrupt
from tenxgraph.prebuilt.tools import create_handoff_tool, is_handoff_tool
```

---

## `Command`

A return value from a node function that combines a state update with an explicit routing decision. Returning `Command(goto=...)` sends execution to the named node, or to `END` to stop.

```python
from tenxgraph.core.state import AgentState
from tenxgraph.utils import Command, END

# Route on the last message; the matching nodes must exist in the graph
def router_node(state: AgentState, config: dict) -> Command:
    last = state.context[-1].text() if state.context else ""
    if "research" in last.lower():
        return Command(goto="RESEARCHER")
    elif "write" in last.lower():
        return Command(goto="WRITER")
    else:
        return Command(goto=END)
```

### Signature

```python
Command(
    update=None,
    goto=None,
    graph=None,
    state=None,
)
```

### Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `update` | `StateT \| Message \| str \| BaseConverter \| None` | `None` | Applied before navigating. An `AgentState` replaces the current state (its new messages are recorded); a `Message`, `str`, converter or list of these is added as new message(s). |
| `goto` | `str \| None` | `None` | Name of the next node to execute, or `END` to terminate. |
| `graph` | `str \| None` | `None` | Not used. The value is stored on the command, and the runtime never reads it. |
| `state` | `StateT \| None` | `None` | Optional state to attach. When streaming, its new context messages are emitted. |

### Example

Add a message and navigate in one step:

```python
from tenxgraph.core.state import AgentState
from tenxgraph.utils import Command

# Record a note as an assistant message, then jump to BILLING_AGENT
def classify_node(state: AgentState, config: dict) -> Command:
    return Command(update="Routing to billing.", goto="BILLING_AGENT")
```

---

## `interrupt()`

Pause the graph and wait for a resume value. Call `interrupt()` when a node or tool needs outside input: approval, a choice, or a correction. The first time it runs, it stops the graph. The graph saves its state and reports the interrupt. Resume by running the same thread again with a `resume` value.

```python
from tenxgraph.utils import interrupt

# Tool that pauses for approval before acting; issue_refund is your own function
async def refund(amount: float) -> str:
    decision = interrupt(
        {"amount": amount},
        message=f"Approve ${amount} refund?",
        response_schema={
            "type": "object",
            "properties": {"approved": {"type": "boolean"}}
        },
    )
    if not decision or not decision.get("approved"):
        return "Refund declined"
    return issue_refund(amount)

# First run: pauses at interrupt() (app and config come from your graph)
await app.ainvoke({"messages": [...]}, config)

# Resume on the same thread: interrupt() returns the value
await app.ainvoke({"resume": {"approved": True}}, config)
```

The interrupted node or tool runs again from the start on resume, so keep side effects after the `interrupt()` call. The thread needs a checkpointer and a `thread_id` in `config` to be resumable.

### Signature

```python
interrupt(
    value=None,
    *,
    message=None,
    reason="input_required",
    response_schema=None,
)
```

### Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `value` | `Any` | `None` | Data for the client (what to approve, what to choose from). |
| `message` | `str \| None` | `None` | Human-readable prompt, shown by UIs such as CopilotKit. |
| `reason` | `str` | `"input_required"` | Machine-readable reason, e.g., `"tool_approval"` or `"human_verification"`. |
| `response_schema` | `dict[str, Any] \| None` | `None` | JSON Schema describing the expected resume value. |

### Returns

The resume value on the run that resumes this interrupt. `None` if the client cancelled.

### Raises

| Exception | When |
|---|---|
| `GraphInterrupt` | On the first run, to stop the graph. Do not catch it. |
| `RuntimeError` | When called outside a running graph node or tool. |

### Example

Multiple interrupts in one node, answered one per resume:

```python
from tenxgraph.core.state import AgentState
from tenxgraph.utils import interrupt

async def approval_step(state: AgentState, config: dict):
    step1 = interrupt({"step": 1}, message="Continue to step 1?")
    if not step1:
        return state
    step2 = interrupt({"step": 2}, message="Continue to step 2?")
    if not step2:
        return state
    return "All approved"
```

---

## `Interrupt`

A pause requested by `interrupt()`, waiting for a resume value.

### Signature

```python
class Interrupt(BaseModel):
    id: str
    key: str
    node: str
    value: Any
    message: str | None
    reason: str
    response_schema: dict[str, Any] | None
    tool_call_id: str | None
```

### Fields

| Field | Type | Description |
|---|---|---|
| `id` | `str` | Unique id of this pause; clients echo it when resuming. |
| `key` | `str` | Stable position of the call within its node or tool call. |
| `node` | `str` | Node that was running when the graph paused. |
| `value` | `Any` | Payload passed to `interrupt()`. |
| `message` | `str \| None` | Human-readable prompt. |
| `reason` | `str` | Why the graph paused (default `"input_required"`). |
| `response_schema` | `dict[str, Any] \| None` | JSON Schema the resume value should follow. |
| `tool_call_id` | `str \| None` | Tool call that paused (if `interrupt()` ran inside a tool). |

### Example

Inspect a pending interrupt after `invoke`. The state is only returned with `ResponseGranularity.FULL`:

```python
from tenxgraph.utils import ResponseGranularity, pending_interrupt

result = app.invoke(
    {"messages": [...]}, config, response_granularity=ResponseGranularity.FULL
)
paused = pending_interrupt(result["state"])
if paused:
    print(f"Waiting at {paused.node}: {paused.message}")
    result = app.invoke({"resume": {"approved": True}}, config)
```

---

## `GraphInterrupt`

Exception raised by `interrupt()` to stop the graph. Derives from `BaseException`, so standard error handlers in tools and nodes do not catch it.

### Signature

```python
class GraphInterrupt(BaseException):
    def __init__(self, interrupt: Interrupt) -> None: ...

    interrupt: Interrupt  # The pause details
```

The graph runtime catches `GraphInterrupt`. Do not catch it in nodes or tools, and note that a bare `except BaseException` would swallow it.

---

## `pending_interrupt()`

Return the interrupt a paused thread is waiting on, or `None`.

Pass the `AgentState` from a run made with `ResponseGranularity.FULL` (`result["state"]`).

### Signature

```python
pending_interrupt(state: AgentState) -> Interrupt | None
```

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `state` | `AgentState` | The state from `result["state"]` after `invoke()` or `ainvoke()` with `ResponseGranularity.FULL`. |

### Returns

The pending `Interrupt` if the thread is paused at an `interrupt()` call, or `None`.

### Example

```python
from tenxgraph.utils import ResponseGranularity, pending_interrupt

result = app.invoke(
    {"messages": [...]}, config, response_granularity=ResponseGranularity.FULL
)
pause = pending_interrupt(result["state"])
if pause:
    # Paused: resume with a value
    result = app.invoke({"resume": user_input}, config)
else:
    # Finished
    print(result["messages"][-1].text())
```

---

## `create_handoff_tool()`

Factory that creates an LLM-callable tool. When the model calls it, the `ToolNode` detects the `transfer_to_<agent>` name and navigates directly to that node without executing the function body.

```python
from tenxgraph.core import ToolNode
from tenxgraph.prebuilt.tools import create_handoff_tool

transfer_to_researcher = create_handoff_tool(
    agent_name="RESEARCHER",
    description="Transfer to the research agent for detailed investigation.",
)

tools = ToolNode([transfer_to_researcher])
```

### Signature

```python
create_handoff_tool(
    agent_name: str,
    description: str | None = None,
) -> Callable
```

### Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `agent_name` | `str` | **required** | Must match an existing node name in the graph exactly. |
| `description` | `str \| None` | `None` | Description shown to the LLM. Defaults to `"Transfer control to <agent_name> agent"`. |

An `agent_name` containing an underscore logs a warning, because it can complicate name matching. Prefer names such as `RESEARCHER`.

### Returns

A callable with special attributes:
- `__name__` = `f"transfer_to_{agent_name}"`
- `__doc__` = the description string
- `__handoff_tool__` = `True`
- `__target_agent__` = `agent_name`

### Interception flow

When the last assistant message contains a tool call named `transfer_to_<agent>`, the `ToolNode` handler (invoke and stream) intercepts it before running any tool:

```text
Agent calls transfer_to_RESEARCHER
  -> ToolNode handler: is_handoff_tool("transfer_to_RESEARCHER") returns (True, "RESEARCHER")
  -> handler returns Command(goto="RESEARCHER")
  -> the tool function body is not called
```

### Example

A coordinator that can hand off to a researcher. Set `OPENAI_API_KEY` first and install with `pip install "10xgraph[openai]"`:

```python
from tenxgraph.core import Agent, StateGraph, ToolNode
from tenxgraph.core.state import AgentState
from tenxgraph.prebuilt.tools import create_handoff_tool
from tenxgraph.utils import END

handoff = create_handoff_tool("RESEARCH", "Transfer to the researcher for deep investigation.")

coordinator = Agent(model="gpt-4o", provider="openai", tool_node="COORD_TOOLS")
researcher = Agent(model="gpt-4o", provider="openai")

# Go to the tool node when the model asked for tools, otherwise finish
def after_coord(state: AgentState) -> str:
    last = state.context[-1]
    return "COORD_TOOLS" if last.role == "assistant" and last.tools_calls else END

graph = StateGraph()
graph.add_node("COORD", coordinator)
graph.add_node("COORD_TOOLS", ToolNode([handoff]))
graph.add_node("RESEARCH", researcher)
graph.set_entry_point("COORD")
graph.add_conditional_edges("COORD", after_coord, {"COORD_TOOLS": "COORD_TOOLS", END: END})
graph.add_edge("RESEARCH", END)

app = graph.compile()
```

For a fuller multi-agent walkthrough, see [Hand off between agents](/docs/guides/handoff-between-agents).

---

## `is_handoff_tool()`

Check whether a tool name follows the handoff convention.

```python
from tenxgraph.prebuilt.tools import is_handoff_tool

print(is_handoff_tool("transfer_to_researcher"))  # (True, 'researcher')
print(is_handoff_tool("get_weather"))             # (False, None)
```

### Signature

```python
is_handoff_tool(tool_name: str) -> tuple[bool, str | None]
```

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `tool_name` | `str` | The name to check. |

### Returns

A tuple `(is_handoff, target_agent)`:
- `is_handoff` (`bool`): `True` if the name matches `"transfer_to_<agent>"` pattern.
- `target_agent` (`str | None`): The text after the `transfer_to_` prefix, unchanged (case is preserved), or `None` if not a handoff tool or the prefix has no target.

### Example

```python
is_hoff, target = is_handoff_tool("transfer_to_support_team")
assert is_hoff is True
assert target == "support_team"
```

---

## Common errors

| Error | Cause | Fix |
|---|---|---|
| `"should have been intercepted"` in logs | Handoff tool body executed. | Run the tool through a standard `ToolNode`, not a custom tool handler. |
| LLM doesn't choose handoff tools | Description is unclear. | Make `description=` action-oriented and specific. |
| `Command.graph` has no effect | The runtime does not route on `graph`. | Route with `goto` within the current graph. |
| `pending_interrupt()` fails on a dict | Passed the `invoke()` result instead of the state. | Use `ResponseGranularity.FULL` and pass `result["state"]`. |
| `RuntimeError` from `interrupt()` | Called outside a graph node/tool. | Call `interrupt()` only during graph execution. |
| `ValueError` or `TypeError` from `create_handoff_tool` | `agent_name` is empty (`ValueError`) or not a string (`TypeError`). | Pass a non-empty string. |
