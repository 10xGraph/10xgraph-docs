---
title: Use custom state
description: "Extend AgentState with application-specific fields and understand state reducers for controlled field updates."
section: "Build agents"
group: "Agents and graphs"
order: 40
label: Custom state
updated: "2026-10-27"
---

Every 10xGraph agent runs within an `AgentState` instance that persists data across all nodes in the graph. By default, `AgentState` holds the message conversation history and execution metadata. You extend it by subclassing to add typed, persistent application fields, like user IDs, ticket numbers, sentiment scores, or any domain-specific data your agent needs. The graph threads the state through every node and saves it with the checkpointer.

## Why custom state

Custom state fields let you:
- Track data that threads through the entire agent execution
- Use placeholders in system prompts (`"Help user {user_id}"`) interpolated at runtime
- Persist application context across multiple invocations via checkpointing
- Structure decision-making (conditional edges read custom fields to route the graph)
- Pass initial values into a run without rebuilding the graph

Without custom state, you would store this data outside the graph, losing the automatic persistence and threading benefits of the framework.

## Built-in fields

`AgentState` provides three fields you can read and build on:

| Field | Type | Description |
|---|---|---|
| `context` | `list[Message]` | The conversation history (new messages are appended with the `add_messages` reducer and deduplicated by `message_id`) |
| `context_summary` | `str \| None` | Optional compressed summary of older messages |
| `execution_meta` | `ExecutionState` | Internal metadata tracking node progress, interrupts, and step counts. Read-only for most use cases. |

---

## Step 1: Define a custom state class

Create a Pydantic model that extends `AgentState`:

```python
from pydantic import Field
from tenxgraph.core.state import AgentState


class SupportTicketState(AgentState):
    """Custom state for a support agent."""
    
    user_id: str = ""
    ticket_id: str | None = None
    sentiment: str = "neutral"  # "positive" | "neutral" | "negative"
    escalation_count: int = 0
    resolved: bool = False
    tags: list[str] = Field(default_factory=list)
```

All Pydantic features work: type hints, validators, `default_factory`, optional fields, computed fields. The built-in fields (`context`, `context_summary`, `execution_meta`) are inherited automatically.

---

## Step 2: Pass your state class to StateGraph

Instantiate the graph with your custom state class or instance:

```python
from tenxgraph.core.graph import StateGraph

# Option A: Pass the class (StateGraph instantiates it)
graph = StateGraph(SupportTicketState)

# Option B: Pass a pre-populated instance with defaults
initial_state = SupportTicketState(user_id="user-456")
graph = StateGraph(initial_state)
```

Both approaches work. The instance is a prototype: a new thread starts from a deep copy of it, and a thread that already has a saved state loads that state instead. Option B lets you bake in different defaults.

---

## Step 3: Read and update custom fields in nodes

Node functions receive the current state (declare a `state` parameter). Change the fields you need on the state object and return it. A node can also return a `str`, a `Message`, a list of messages, or a `Command`; a plain `dict` is not a valid return value. See [use custom nodes](/docs/guides/use-custom-nodes).

```python
from tenxgraph.core.state import Message


def classify_sentiment(state: SupportTicketState, config: dict) -> SupportTicketState:
    """Analyze the last user message and update sentiment."""
    last_user_msg = next(
        (m for m in reversed(state.context) if m.role == "user"), None
    )
    if not last_user_msg:
        return state

    text = last_user_msg.text().lower()
    if any(word in text for word in ["angry", "terrible", "worst", "unacceptable"]):
        state.sentiment = "negative"
        state.escalation_count += 1
    elif any(word in text for word in ["great", "thanks", "excellent", "happy"]):
        state.sentiment = "positive"
    else:
        state.sentiment = "neutral"
    return state


def resolve_ticket(state: SupportTicketState, config: dict) -> SupportTicketState:
    """Mark the ticket resolved and append a closing message."""
    state.resolved = True
    state.tags = ["handled", "closed"] if state.ticket_id else []
    state.context.append(
        Message.text_message(
            f"Ticket {state.ticket_id} has been resolved. Thank you for using our support.",
            role="assistant",
        )
    )
    return state
```

When a node returns the state, the runtime keeps the new field values and records any new entries in `state.context` as new messages of the run.

---

## Step 4: Use custom fields in system prompts

The `Agent` class interpolates state field values into system prompts at runtime:

```python
from tenxgraph.core.graph import Agent

agent = Agent(
    model="gpt-4o",
    system_prompt=[
        {
            "role": "system",
            "content": (
                "You are a customer support agent assisting user {user_id}. "
                "Ticket: {ticket_id}. Current sentiment: {sentiment}. "
                "This is escalation #{escalation_count}."
            ),
        }
    ],
)
```

Placeholders in curly braces are filled from the current state with `str.format`. If any placeholder names a field the state does not have, a warning is logged and the whole prompt is sent without interpolation. A field set to `None` renders as `None` (so `ticket_id` above reads `Ticket: None` until it is set). Escape literal braces as `{{` and `}}`.

---

## Step 5: Pass initial values at invocation

Messages go under `"messages"`. Custom field values go under a `"state"` key:

```python
from tenxgraph.utils import ResponseGranularity

result = app.invoke(
    {
        "messages": [Message.text_message("My order hasn't arrived.")],
        "state": {
            "user_id": "cust-789",
            "ticket_id": "TKT-2024-001",
            "sentiment": "negative",
        },
    },
    config={"thread_id": "support-session-1"},
    response_granularity=ResponseGranularity.FULL,
)
print(result["state"].ticket_id)
```

Only keys that already exist as fields on your state class are applied; `context`, `context_summary` and `execution_meta` are skipped. By default `invoke` returns only `messages` and `token_usage`. Pass `response_granularity=ResponseGranularity.FULL` (from `tenxgraph.utils`) to also get the final `state` object.

---

## What clients can write through the API

When you serve the graph with `10xgraph dev`, a client can set custom state fields on invoke, stream and WebSocket `initial_state`, and with `PUT /v1/threads/{thread_id}/state`. This is by design: a frontend can send a selected ID straight into state without spending a model turn on it.

The server limits what a client can write:

| Client input | Result |
|---|---|
| Custom fields you defined on your state class | Accepted, if the value matches the field type. A wrong type returns 422 and names the field. |
| `context_summary` or `execution_meta` | Always 422. These built-in fields are never client-writable. |
| `current_node` | Accepted if it names a node in the graph. An unknown node returns 422. |
| Messages in `context` | User messages only. Roles `assistant` and `system` return 422. A `tool` message is accepted only as `tool_result` blocks that answer a pending client tool call. |
| `message_id` on a message | Ignored. The server generates the id. |

To restrict which custom keys clients may set, list them in `runs.state_keys` in `10xgraph.json`. When it is set, any other key is refused.

<aside class="callout callout-warning" role="warning"><p class="callout-title">Never read identity from state</p>
<p>Because clients can write custom state fields, a field such as <code>user_id</code>, <code>tenant_id</code>, <code>role</code> or <code>account</code> in state is not proof of who is calling. Do not use it for access checks, database filters or billing in tools or nodes. Take the user from the authenticated config with <code>get_authz(config)</code>, which clients cannot set. See <a href="/docs/guides/authorization-scopes#read-caller-identity-inside-tools-and-nodes">Authorization scopes</a>. The <code>user_id</code> field in the examples on this page is a display value only.</p></aside>

---

## Reducers: combining concurrent updates

A reducer is a function `(left, right) -> merged`, attached to a field with `Annotated`. The runtime uses a field's reducer when parallel tool calls in one `ToolNode` step both change the same field: their changes are combined with the reducer instead of one overwriting the other. Without a reducer the last write wins and a warning is logged. Reducers are not applied to values returned from ordinary function nodes; there you assign the field yourself.

10xGraph provides these in `tenxgraph.core.state`:

### `add_messages` (append with deduplication)

Appends new messages and deduplicates by `message_id`. This is the default reducer for the `context` field. Use it for any message list field:

```python
from typing import Annotated
from tenxgraph.core.state import AgentState, Message
from tenxgraph.core.state.reducers import add_messages
from pydantic import Field


class PipelineState(AgentState):
    # A separate log of intermediate messages, also deduplicated by ID
    processing_log: Annotated[list[Message], add_messages] = Field(default_factory=list)
```

When two parallel tool calls each add messages to `processing_log`, both sets are appended. A message whose ID already exists is skipped. The same function is what keeps `context` free of duplicate messages.

### `replace_messages` (replace entire list)

Replaces the entire message list with the new one. Use this when the latest write should win outright:

```python
from typing import Annotated
from tenxgraph.core.state.reducers import replace_messages


class SummarizedState(AgentState):
    # This field is always replaced, never appended
    summary_messages: Annotated[list[Message], replace_messages] = Field(default_factory=list)
```

When the reducer runs, the old list is discarded and replaced by the new one.

### `append_items` (append objects with id deduplication)

Appends items to a list and deduplicates by each item's `.id` attribute. Use this for domain objects:

```python
from typing import Annotated
from tenxgraph.core.state.reducers import append_items
from pydantic import Field, BaseModel


class ToolResult(BaseModel):
    id: str
    name: str
    value: str


class ToolState(AgentState):
    # Append tool results, deduplicated by their .id
    tool_results: Annotated[list[ToolResult], append_items] = Field(default_factory=list)
```

When the reducer runs, new items are appended. An item with an `.id` that already exists is skipped.

### `replace_value` (replace a value)

Returns the new value and ignores the old one. Use it to make last-write-wins explicit:

```python
from tenxgraph.core.state.reducers import replace_value


class MyState(AgentState):
    status: Annotated[str, replace_value] = "pending"
    counter: int = 0  # No reducer: last write wins, with a warning on a parallel conflict
```

### `remove_tool_messages` (prune completed tool sequences)

Unlike the others, this takes a single list and returns the pruned list, so it is a plain helper, not a field reducer. It removes completed tool interaction sequences to keep context lean. A sequence is only removed if it is **complete**:

1. An assistant message with tool calls
2. One or more tool result messages
3. A final assistant message without tool calls (using the tool results)

If a sequence is incomplete (tool call made but no final response yet), all messages are kept:

```python
from tenxgraph.core.state.reducers import remove_tool_messages


def prune(state: AgentState, config: dict) -> AgentState:
    state.context = remove_tool_messages(state.context)
    return state
```

This is useful in long-running agents where you want to drop tool calls and results after the model has used them, reducing token usage on later calls.

---

## Complete example

Here is a working example that ties it together. Install a provider extra first, for example `pip install "10xgraph[openai]"`, and set `OPENAI_API_KEY`.

```python
from pydantic import Field
from tenxgraph.core.graph import StateGraph, Agent
from tenxgraph.core.state import AgentState, Message
from tenxgraph.utils import END, ResponseGranularity


# Define custom state
class ResearchState(AgentState):
    research_topic: str = ""
    findings: list[str] = Field(default_factory=list)
    sources: list[str] = Field(default_factory=list)
    confidence: float = 0.0


# Define a node that processes custom fields
def extract_findings(state: ResearchState, config: dict) -> ResearchState:
    """Extract key findings from the last response."""
    if not state.context:
        return state

    text = state.context[-1].text()

    # Simplified extraction: split by "Finding:" markers
    findings = [
        f.strip()
        for f in text.split("Finding:")[1:]
        if f.strip()
    ]

    state.findings = findings
    state.confidence = 0.85 if len(findings) > 2 else 0.5
    return state


# Build the graph
graph = StateGraph(ResearchState)

agent = Agent(
    model="gpt-4o",
    system_prompt=[
        {
            "role": "system",
            "content": (
                "You are a research assistant. "
                "Research topic: {research_topic}. "
                "Your confidence level: {confidence}. "
                "List your findings prefixed with 'Finding:'."
            ),
        }
    ],
)

graph.add_node("research", agent)
graph.add_node("extract", extract_findings)
graph.set_entry_point("research")
graph.add_edge("research", "extract")
graph.add_edge("extract", END)

app = graph.compile()

# Invoke with initial state values
result = app.invoke(
    {
        "messages": [Message.text_message("Research the benefits of remote work.")],
        "state": {"research_topic": "Remote work productivity"},
    },
    config={"thread_id": "research-session-1"},
    response_granularity=ResponseGranularity.FULL,
)

final = result["state"]
print("Findings:", final.findings)
print("Confidence:", final.confidence)
```

---

## How to verify it worked

Invoke with `response_granularity=ResponseGranularity.FULL` so the result includes the final state, then check:

1. **State is threaded:** custom fields hold the values you expect.

```python
state = result["state"]
print(state.user_id)      # Should match what you passed
print(state.sentiment)    # Should reflect updates from nodes
print(len(state.context)) # Messages should be accumulated
```

2. **Checkpointing preserves state:** `compile()` uses an in-memory checkpointer by default, so invoking again with the same `thread_id` in the same process continues from the saved state.

```python
result2 = app.invoke(
    {"messages": [Message.text_message("Follow-up question.")]},
    config={"thread_id": "support-session-1"},
    response_granularity=ResponseGranularity.FULL,
)
assert result2["state"].user_id == state.user_id
```

---

## Common errors and fixes

**Error: `AttributeError` or a Pydantic error mentioning a missing field**

You accessed or assigned a field that is not defined in your state class. Add it:

```python
class SupportTicketState(AgentState):
    my_field: str = ""  # Add the missing field
```

**My field in `"state"` was ignored.**

Only keys that already exist on the state class are applied, and `context`, `context_summary` and `execution_meta` are always skipped. Check the spelling, and pass messages under `"messages"`.

**The system prompt shows raw `{placeholders}`.**

A placeholder names a field the state does not have, so interpolation was skipped for the whole prompt and a warning was logged. Add the field to your state class with a default:

```python
class MyState(AgentState):
    user_id: str = "unknown"
```

**My custom state updates do not persist across restarts.**

The default checkpointer is in memory. Pass a durable one to `compile()`, for example `SqliteCheckpointer` (`pip install "10xgraph[sqlite_checkpoint]"`):

```python
from tenxgraph.storage.checkpointer import SqliteCheckpointer

app = graph.compile(checkpointer=SqliteCheckpointer(db_path="./state.db"))
```

---

## Variations and best practices

**Typed reducers for custom types:** If your field is a list of domain objects, use `append_items`:

```python
from typing import Annotated
from pydantic import BaseModel, Field
from tenxgraph.core.state import AgentState
from tenxgraph.core.state.reducers import append_items


class Item(BaseModel):
    id: str
    name: str

class MyState(AgentState):
    items: Annotated[list[Item], append_items] = Field(default_factory=list)
```

**Combining multiple reducers:** You can have different fields with different reducers in the same state:

```python
from typing import Annotated
from pydantic import BaseModel, Field
from tenxgraph.core.state import AgentState, Message
from tenxgraph.core.state.reducers import add_messages, replace_value, append_items


class MultiReducerState(AgentState):
    messages_log: Annotated[list[Message], add_messages] = Field(default_factory=list)
    latest_status: Annotated[str, replace_value] = "pending"
    collected_items: Annotated[list[Item], append_items] = Field(default_factory=list)
```

**Initializing with factory defaults:** For complex fields, use `Field(default_factory=...)`:

```python
class MyState(AgentState):
    metadata: dict = Field(default_factory=dict)
    tags: list[str] = Field(default_factory=list)
```

This ensures each graph instance gets its own dict/list, not a shared one (a common Python pitfall).

---

## Run it in production

Over the API, callers can set custom state fields on purpose (a frontend picker can send its selection straight into state). To limit which keys clients may write, list them in `runs.state_keys` in `10xgraph.json`. Built-in fields such as `context_summary` and `execution_meta` are never writable through the API, and identity must come from the authenticated user, never from state. See [Configure the server](/docs/server/configure) and [Invoke and stream](/docs/server/invoke-and-stream).

## Next steps

- [Build a graph](/docs/guides/build-a-graph) for the full workflow assembly guide
- [Set up checkpointing](/docs/guides/set-up-checkpointing) to persist custom state across requests
- [Use dependency injection](/docs/guides/use-dependency-injection) to pass runtime config into nodes
- [State and messages (concept)](/docs/concepts/state-and-messages) for a deeper dive into message content blocks
