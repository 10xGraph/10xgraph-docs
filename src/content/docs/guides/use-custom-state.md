---
title: Use custom state
description: "Extend AgentState with application-specific fields and understand state reducers for controlled field updates."
section: "Build agents"
group: "Agents and graphs"
order: 40
label: Custom state
updated: "2026-11-26"
---

Subclass `AgentState` to add typed fields to a graph's state. The graph passes the state through every node and saves it with the checkpointer.

## Built-in fields

`AgentState` already has `context` (the messages), `context_summary` and `execution_meta`; see [State and messages](/docs/concepts/state-and-messages#agentstate).

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

Any Pydantic field works. Use `Field(default_factory=...)` for lists and dicts.

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

Node functions receive the current state (declare a `state` parameter). Change the fields you need on the state object and return it. A node can also return a `str`, a `Message`, a list of messages, or a `Command`; a `dict` such as `{"field": value}` sets those state fields (unknown names raise an error), and `None` means no change. See [use custom nodes](/docs/guides/use-custom-nodes).

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

Placeholders in curly braces are filled from the current state with `str.format`. A field the state does not have, or a malformed placeholder, stays exactly as written while the other fields are still filled, and a warning is logged. The run never fails. The text of `extra_messages` is filled the same way. A field set to `None` renders as `None` (so `ticket_id` above reads `Ticket: None` until it is set). Escape literal braces as `{{` and `}}`.

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

When you serve the graph with `10xgraph dev`, a client can set custom state fields on invoke, stream and WebSocket `initial_state`, with `PUT /v1/threads/{thread_id}/state` and in the AG-UI `state` field, but only the keys you list in `runs.state_keys` in `10xgraph.json`. The list is empty by default, so a client can set none until you allow some. A frontend can then send a selected ID straight into state without spending a model turn on it.

Every rule for what a client may send is in [What the server accepts from clients](/docs/server/invoke-and-stream#what-the-server-accepts-from-clients).

```json
{
  "agent": "graph.react:app",
  "runs": { "state_keys": ["selected_job_id"] }
}
```

<aside class="callout callout-warning" role="warning"><p class="callout-title">Never read identity from state</p>
<p>Because clients can write custom state fields, a field such as <code>user_id</code>, <code>tenant_id</code>, <code>role</code> or <code>account</code> in state is not proof of who is calling. Do not use it for access checks, database filters or billing in tools or nodes. Take the user from the authenticated config with <code>get_identity(config)</code> from <code>tenxgraph.core.authz</code>, which clients cannot set. See <a href="/docs/guides/authorization-scopes">Authorization scopes</a>. The <code>user_id</code> field in the examples on this page is a display value only.</p></aside>

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

## Common errors and fixes

**My field in `"state"` was ignored.**

Only keys that already exist on the state class are applied, and `context`, `context_summary` and `execution_meta` are always skipped. Check the spelling, and pass messages under `"messages"`.

**The system prompt shows raw `{placeholders}`.**

A placeholder names a field the state does not have, so it was left as written and a warning was logged (the other fields are still filled). Add the field to your state class with a default:

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

## Run it in production

Clients can set only the state keys you list in `runs.state_keys`, and identity must come from the authenticated user, never from state. See [Configure the server](/docs/server/configure).

## Next steps

- [Build a graph](/docs/guides/build-a-graph) for the full workflow assembly guide
- [Set up checkpointing](/docs/guides/set-up-checkpointing) to persist custom state across requests
- [State and messages](/docs/concepts/state-and-messages)
