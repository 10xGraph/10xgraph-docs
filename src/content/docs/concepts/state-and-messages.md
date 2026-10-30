---
title: State and Messages
seoTitle: "AgentState and messages in 10xGraph"
description: How AgentState holds conversation history, how Message carries multimodal content blocks, and how reducers and ToolResult update state.
section: Concepts
order: 30
group: "Foundations"
label: State and Messages
updated: "2026-10-08"
faq:
  - q: "Does a node replace the conversation history when it returns a message?"
    a: "No. The context field uses the add_messages reducer, which appends new messages and skips any whose message_id is already present, so history is never overwritten."
  - q: "How do I add my own fields to the state?"
    a: "Subclass AgentState, add typed fields with defaults, and pass the class or an instance to StateGraph. The built-in context, context_summary and execution_meta fields stay available."
  - q: "Can a tool change state as well as return text to the model?"
    a: "Yes. Return a ToolResult with a message for the model and a state dict. Only the fields named in the dict are updated."
---

Every node in a graph receives state and returns updates to it. `AgentState` is the default state class and holds the conversation history. `Message` is the unit of that history: one turn, made of typed content blocks such as text, images, tool calls and tool results. This page explains how both work and how updates merge.

## AgentState

`AgentState` is a Pydantic model with three built-in fields: the message history, an optional summary of trimmed history, and internal execution metadata. You read `context` in your nodes and extend the class with your own fields.

```python
class AgentState(BaseModel):
    context: Annotated[list[Message], add_messages] = Field(default_factory=list)
    context_summary: str | None = None
    execution_meta: ExecMeta = Field(default_factory=lambda: ExecMeta(current_node=START))
```

| Field | Type | Description |
|---|---|---|
| `context` | `list[Message]` | Conversation history. New messages are merged in by the `add_messages` reducer. |
| `context_summary` | `str \| None` | Summary of messages a context manager removed. `None` until a summarizing manager runs. |
| `execution_meta` | `ExecMeta` | Runtime metadata: current node, step counter, status, interrupt details, thread id and stop request. `ExecMeta` is `ExecutionState`. |

The `context` field is what the model sees on each turn, so your agent has access to every earlier turn unless a context manager trims it. `context_summary` keeps a condensed record of removed turns. `execution_meta` belongs to the runtime; read it through the helper methods below instead of editing it.

### The add_messages reducer

The `add_messages` reducer decides how a returned list of messages merges into `context`: it appends them, never replaces. Because history is append-only, many nodes can run in one request without any of them wiping what came before.

```python
def add_messages(left: list[Message], right: list[Message]) -> list[Message]:
    left_ids = {msg.message_id for msg in left}
    right = [msg for msg in right if msg.message_id not in left_ids and msg.delta is False]
    return left + right
```

Two rules follow from the code:

- A message whose `message_id` already exists in `context` is skipped, so re-sending the same message does not create a duplicate.
- Messages with `delta=True` (partial streaming chunks) are never stored. Only complete messages enter the history.

The same module exports other reducers (`replace_messages`, `append_items`, `replace_value`, `remove_tool_messages`), all importable from `tenxgraph.core.state`. See [Use custom state](/docs/guides/use-custom-state) for how to apply them to your own fields.

### Helper methods on AgentState

`AgentState` exposes methods that delegate to `execution_meta`. They are useful in custom nodes that need to inspect or change how the run is progressing.

```python
state.is_running()            # True while execution is in progress
state.is_interrupted()        # True when the graph is paused at an interrupt
state.is_stopped_requested()  # True when a stop was requested mid-run
state.advance_step()          # increment the execution step counter
state.set_current_node(name)  # set the current node in execution_meta
state.complete()              # mark execution as completed
state.error("message")        # mark execution as errored with a message
```

### Custom state

Subclass `AgentState` to carry application data alongside the conversation. Every node then receives your subclass and can read or write the extra fields.

```python
# title="state.py"
from tenxgraph.core.state import AgentState


class MyState(AgentState):
    user_id: str = ""
    session_data: dict = {}
    selected_city: str = ""
```

Pass the class (or an instance, to set initial values) to `StateGraph`:

```python
from tenxgraph.core.graph import StateGraph

graph = StateGraph(MyState)
```

You can also update custom fields from outside the graph. The `state` key of the input dict merges the listed fields into the existing state; fields you omit are left alone, and `context`, `context_summary` and `execution_meta` cannot be set this way.

```python
from tenxgraph.core.state import AgentState, Message
from tenxgraph.core.graph import StateGraph
from tenxgraph.utils.constants import END, START


class MyState(AgentState):
    selected_city: str = ""


def reply(state: MyState) -> list[Message]:
    # Read a custom field and append one assistant message to context
    text = f"Selected city: {state.selected_city or 'none'}"
    return [Message.text_message(text, role="assistant")]


graph = StateGraph(MyState)
graph.add_node("REPLY", reply)
graph.add_edge(START, "REPLY")
graph.add_edge("REPLY", END)
app = graph.compile()

result = app.invoke(
    {
        "messages": [Message.text_message("Hi")],
        "state": {"selected_city": "Paris"},  # merged into MyState
    },
    config={"thread_id": "demo"},
)
```

## Message

A `Message` is one turn in a conversation: a role, a list of content blocks, and metadata. The role says who produced it, and the blocks hold the actual content, so one message can mix text, images and tool calls.

```python
class Message(BaseModel):
    message_id: str | int
    role: Literal["user", "assistant", "system", "tool"]
    content: Sequence[ContentBlock]
    delta: bool = False
    tools_calls: list[dict[str, Any]] | None = None
    timestamp: float | None
    metadata: dict[str, Any] = {}
    usages: TokenUsages | None = None
    raw: dict[str, Any] | None = None
    parsed_content: dict | pydantic.BaseModel | None = None
```

| Field | Meaning |
|---|---|
| `message_id` | Generated automatically unless you pass one. The reducer uses it to avoid duplicates. |
| `role` | `"user"`, `"assistant"`, `"system"` or `"tool"`. |
| `content` | A sequence of content blocks. |
| `delta` | `True` for a partial streaming message. Delta messages are not stored in `context`. A delta carries only the new piece of reasoning or text as a block; the final message carries the full reasoning block. |
| `tools_calls` | Raw tool-call dicts from the model. Tool calls also appear as `ToolCallBlock` entries in `content`. |
| `timestamp` | UNIX timestamp, set at creation. |
| `usages` | Token counts, when the provider returned them. |
| `raw` | The provider-native response, when kept. |
| `parsed_content` | Structured output parsed from the response, when an output schema is used. |

### Message roles

| Role | Description |
|---|---|
| `"user"` | Input from the human. |
| `"assistant"` | Response from the model. May carry tool calls. |
| `"tool"` | Result of a tool execution. |
| `"system"` | A system instruction. |

### Create messages

Use the factory methods for common cases and build a `Message` directly when you need several blocks.

```python
from tenxgraph.core.state import (
    ImageBlock,
    MediaRef,
    Message,
    TextBlock,
    ToolResultBlock,
)

# Plain text user message
msg = Message.text_message("Hello!")

# Tool result message, linked to the call by call_id
msg = Message.tool_message(
    content=[ToolResultBlock(call_id="call_123", output="Sunny, 22C", status="completed")],
)

# Multimodal message built from explicit blocks
msg = Message(
    role="user",
    content=[
        TextBlock(text="What is this?"),
        ImageBlock(
            media=MediaRef(kind="url", url="https://example.com/img.png", mime_type="image/png")
        ),
    ],
)
```

`Message` also has `image_message`, `multimodal_message` and `from_file` constructors. See the [Message reference](/docs/reference/python/messages) for their parameters.

### Extract text

`msg.text()` returns the concatenated text of the message's `TextBlock` entries and the output of its `ToolResultBlock` entries. Other block types are ignored.

```python
text = msg.text()
```

### Track token usage

When the provider returns usage data, it is stored on `msg.usages` as a `TokenUsages` model, so you can measure cost per turn.

```python
class TokenUsages(BaseModel):
    completion_tokens: int
    prompt_tokens: int
    total_tokens: int
    reasoning_tokens: int = 0
    cache_creation_input_tokens: int = 0
    cache_read_input_tokens: int = 0
    image_tokens: int | None = 0
    audio_tokens: int | None = 0
```

## Content blocks

A message carries its content as typed blocks, one per kind of content. All block classes are importable from `tenxgraph.core.state`, and the [Message reference](/docs/reference/python/messages) lists every field.

| Block | Holds |
|---|---|
| `TextBlock` | Text, plus optional annotation references such as citations. |
| `ImageBlock`, `AudioBlock`, `VideoBlock` | Media referenced through a `MediaRef`, with metadata. |
| `DocumentBlock` | A document such as a PDF, referenced through a `MediaRef`. |
| `DataBlock` | Generic binary data. |
| `ToolCallBlock` | A model request to call a tool: `id`, `name` and `args`. |
| `ToolResultBlock` | The output of a tool call, linked by `call_id`, with `is_error` and `status`. |
| `ReasoningBlock` | Reasoning content from models that expose it. Read it from `content`; a message has no separate reasoning field. Converters order blocks reasoning, text, media, tool calls. |
| `ErrorBlock` | An error recorded in the conversation. |
| `AnnotationBlock` | Annotation data attached to content. |

Media blocks point at the data through `MediaRef`, whose `kind` is `"url"`, `"file_id"` or `"data"`. Prefer a URL or provider file id over inline base64 for large payloads. [Media and files](/docs/concepts/media-and-files) covers how references are stored and resolved.

## ToolResult: tools that update state

A tool normally returns a value that goes back to the model. When it must also change state, return a `ToolResult` instead. Its `message` is what the model sees, and its `state` dict is merged into the graph state.

```python
from tenxgraph.core.state import AgentState, ToolResult


class MyState(AgentState):
    selected_city: str = ""


def select_city(city: str) -> ToolResult:
    """Set the currently selected city in the workflow."""
    return ToolResult(
        message=f"City updated to '{city}'.",  # returned to the model
        state={"selected_city": city},          # updates MyState.selected_city
    )
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `message` | `Any` | `None` | Text returned to the model as the tool result. `content=` is accepted as an alias. |
| `state` | `dict[str, Any] \| None` | `None` | Field names mapped to new values. Fields not listed are unchanged. |
| `is_error` | `bool` | `False` | Marks the result as a failed tool call. |

Use this when a tool call should drive later routing, such as a selected filter or a chosen record. If the tool only produces information, return a plain value. [Agents and tools](/docs/concepts/agents-and-tools) explains how tool calls are dispatched.

## How context accumulates across turns

Each completed turn appends to `context`. After a few exchanges the list reads like a transcript, including the tool call and its result.

```python
[
    Message(role="user", content=[TextBlock(text="What is 2 + 2?")]),
    Message(role="assistant", content=[TextBlock(text="4.")]),
    Message(role="user", content=[TextBlock(text="What is the weather in Tokyo?")]),
    Message(
        role="assistant",
        content=[ToolCallBlock(id="c1", name="get_weather", args={"location": "Tokyo"})],
    ),
    Message(role="tool", content=[ToolResultBlock(call_id="c1", output="Cloudy, 18C", status="completed")]),
    Message(role="assistant", content=[TextBlock(text="It is cloudy and 18C in Tokyo.")]),
]
```

With a checkpointer, this list is saved under the thread id and restored when the thread resumes, which is why a conversation on the same thread feels continuous. See [Checkpointing and threads](/docs/concepts/checkpointing-and-threads).

## Keep context within the model window

Long conversations can exceed a model's context window. To limit this, register a context manager and set `trim_context=True` on the `Agent`. Setting the flag alone does nothing: the agent looks up the registered `BaseContextManager` and skips trimming, with a warning, if none exists.

```python
from tenxgraph.core import Agent
from tenxgraph.core.graph import StateGraph
from tenxgraph.core.state import AgentState, MessageContextManager

# Keep the first message and the most recent 10 user turns
graph = StateGraph(AgentState, context_manager=MessageContextManager(max_messages=10))
graph.add_node("MAIN", Agent(model="gemini-2.5-flash", trim_context=True))
```

Two managers ship in `tenxgraph.core.state`:

| Manager | Behavior |
|---|---|
| `MessageContextManager` | Trims by a maximum number of user messages (`max_messages`, default 10). |
| `SummaryContextManager` | Summarizes old messages with an LLM, stores the result in `state.context_summary`, and keeps the most recent messages verbatim. |

Trimming removes messages from the context sent on later turns, so use the summary manager when older facts must survive. For setup details see [Use a context manager](/docs/guides/use-context-manager) and the [context manager reference](/docs/reference/python/context-manager). For facts that should outlive a conversation, use long-term memory instead: [Long-term memory](/docs/concepts/memory-and-store).

## Related concepts

- [Agents and tools](/docs/concepts/agents-and-tools): how agents invoke tools and handle responses.
- [Checkpointing and threads](/docs/concepts/checkpointing-and-threads): how conversations are persisted and resumed.
- [Media and files](/docs/concepts/media-and-files): storing and referencing large media in messages.
- [Use custom state](/docs/guides/use-custom-state): reducers and custom fields in practice.
