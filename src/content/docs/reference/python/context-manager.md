---
title: Context Manager
seoTitle: "Context manager API reference (Python)"
description: Reference for MessageContextManager, SummaryContextManager and BaseContextManager, which trim or summarize message history before each LLM call.
section: Reference
group: "Python library"
order: 70
label: Context Manager
updated: "2026-10-08"
---

A context manager shortens the message history in `state.context` so a long conversation stays inside the model's context window. You pass one to `StateGraph(context_manager=...)`. Two are built in: `MessageContextManager` drops old turns, and `SummaryContextManager` replaces them with an LLM-written summary.

For a task-oriented walkthrough, see [Use a context manager](/docs/guides/use-context-manager). For the state fields these classes edit, see [State and messages](/docs/concepts/state-and-messages).

## Import path

All three classes are exported from `tenxgraph.core.state`.

```python
from tenxgraph.core.state import (
    BaseContextManager,
    MessageContextManager,
    SummaryContextManager,
)
```

## Choose a context manager

Use `MessageContextManager` when dropping old turns is acceptable, and `SummaryContextManager` when earlier facts must survive. Both keep system messages and edit `state.context`. Only the summary manager also writes `state.context_summary`.

| Class | Strategy | Calls an LLM | Triggers when |
|---|---|---|---|
| `MessageContextManager` | Keep the last N user turns | No | User message count exceeds `max_messages` |
| `SummaryContextManager` | Summarize old messages, keep recent ones | Yes | Message count exceeds `max_messages` or estimated tokens exceed `token_budget` |
| `BaseContextManager` | Your own logic | Up to you | Up to you |

## `MessageContextManager`

`MessageContextManager` keeps every system message plus the most recent `max_messages` user turns (with the assistant and tool messages that follow them) and drops everything older. It makes no LLM call, so it is free and fast.

```python
from tenxgraph.core.graph import StateGraph
from tenxgraph.core.state import MessageContextManager

# Keep the 10 most recent user turns plus all system messages
ctx_mgr = MessageContextManager(max_messages=10)
graph = StateGraph(context_manager=ctx_mgr)
```

### Constructor

| Parameter | Type | Default | Description |
|---|---|---|---|
| `max_messages` | `int` | `10` | Maximum number of user-role messages to keep. |
| `remove_tool_msgs` | `bool` | `False` | If `True`, remove completed tool-call sequences before counting and trimming. |

### Behavior

Messages with `role == "system"` are never trimmed and are placed first. If the context holds more than `max_messages` user messages, the manager keeps the last `max_messages` user messages and everything after the oldest of them. If the count is within the limit, the context is left unchanged.

With `remove_tool_msgs=True`, only completed tool sequences are removed: an assistant message with tool calls, its tool results, and the final assistant answer that used them. An incomplete sequence (a tool call still waiting for a final answer) is kept in full.

### Methods

| Method | Signature | Returns | Description |
|---|---|---|---|
| `trim_context` | `(state: S) -> S` | The same state with `context` replaced if trimming was needed | Synchronous trim. |
| `atrim_context` | `async (state: S) -> S` | Same as above | Async version with the same logic. |

### Example: trim without a model

This script runs offline and shows which messages survive.

```python
# trim_demo.py
from tenxgraph.core.state import AgentState, Message, MessageContextManager

state = AgentState(
    context=[
        Message.text_message("You are terse.", role="system"),
        Message.text_message("First question", role="user"),
        Message.text_message("First answer", role="assistant"),
        Message.text_message("Second question", role="user"),
        Message.text_message("Second answer", role="assistant"),
        Message.text_message("Third question", role="user"),
    ]
)

manager = MessageContextManager(max_messages=2)
trimmed = manager.trim_context(state)

for msg in trimmed.context:
    print(msg.role, "|", msg.text())
# system | You are terse.
# user | Second question
# assistant | Second answer
# user | Third question
```

## `SummaryContextManager`

`SummaryContextManager` sends the oldest messages to an LLM, stores the result in `state.context_summary`, and keeps only the `keep_recent` newest non-system messages in `state.context`. Use it when earlier facts and decisions must stay available at a fraction of the token cost.

```python
from tenxgraph.core.graph import StateGraph
from tenxgraph.core.state import SummaryContextManager

manager = SummaryContextManager(
    model="gemini-2.0-flash",  # summarizer model, provider auto-detected
    max_messages=30,
    token_budget=6000,
    keep_recent=8,
)
graph = StateGraph(context_manager=manager)
```

### Constructor

`model` is positional. All other parameters are keyword-only.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `model` | `str` | required | Model used for summarization, for example `"gemini-2.0-flash"` or `"gpt-4o-mini"`. The provider is detected from the name. |
| `max_messages` | `int \| None` | `30` | Summarize when the context holds more than this many messages. `None` disables the count trigger. |
| `token_budget` | `int \| None` | `None` | Summarize when the estimated token count exceeds this. `None` disables the token trigger. |
| `keep_recent` | `int` | `8` | Number of newest non-system messages kept verbatim after summarizing. |
| `remove_tool_msgs` | `bool` | `False` | If `True`, strip completed tool sequences before checking thresholds and summarizing. |
| `summary_system_prompt` | `str \| None` | `None` | Custom instruction for the summarizer. The default asks for a concise, factual, third-person summary that preserves facts, decisions and tool results. |
| `max_summary_tokens` | `int` | `600` | Upper bound on the summary length, in tokens. |
| `api_style` | `"responses" \| "chat"` | `"responses"` | OpenAI only. Use `"chat"` for models that support only the Chat Completions endpoint. |

### Behavior

Summarization runs when either threshold is exceeded. Token usage is estimated at one token per four characters of text, plus the string form of any tool calls.

1. The messages older than the `keep_recent` newest non-system messages are rendered as text and sent to the model.
2. The returned summary is stored in `state.context_summary`. If a summary already exists, the new one is appended after a blank line, so earlier history is never discarded.
3. `state.context` becomes the system messages plus the `keep_recent` newest messages.

The context is left unchanged when there is nothing older than `keep_recent` to summarize, when the summarizer returns an empty string, or when the LLM call raises an exception (the error is logged). If both `max_messages` and `token_budget` are `None`, nothing is ever summarized.

### Methods

| Method | Signature | Returns | Description |
|---|---|---|---|
| `atrim_context` | `async (state: S) -> S` | The updated state | Checks thresholds, calls the LLM if needed, updates `context` and `context_summary`. |
| `trim_context` | `(state: S) -> S` | The updated state | Calls `asyncio.run(self.atrim_context(state))`. |

<aside class="callout callout-warning" role="warning"><p class="callout-title">Do not call trim_context inside a running event loop</p>

`trim_context` uses `asyncio.run`, which raises `RuntimeError` when an event loop is already running. Inside async code and graph nodes, always use `await manager.atrim_context(state)`.

</aside>

### Example: summarize on a token budget

This graph summarizes once the conversation passes about 8000 estimated tokens. It needs `pip install "10xgraph[openai]"` and `OPENAI_API_KEY` set in your environment.

```python
# summary_agent.py
from tenxgraph.core.graph import Agent, StateGraph
from tenxgraph.core.state import Message, SummaryContextManager
from tenxgraph.utils.constants import END

# Summarize when the conversation exceeds roughly 8000 tokens
manager = SummaryContextManager(
    model="gpt-4o-mini",
    max_messages=None,  # rely only on the token trigger
    token_budget=8000,
    keep_recent=10,
)

# trim_context=True makes the agent call the manager before each LLM call
agent = Agent(
    model="gpt-4o",
    provider="openai",
    system_prompt="You are a helpful assistant.",
    trim_context=True,
)

graph = StateGraph(context_manager=manager)
graph.add_node("MAIN", agent)
graph.add_edge("MAIN", END)
graph.set_entry_point("MAIN")
app = graph.compile()

result = app.invoke(
    {"messages": [Message.text_message("Hello, remember that my name is Sam.")]},
    config={"thread_id": "demo"},
)
print(result["messages"][-1])
```

## `BaseContextManager`

`BaseContextManager` is the abstract base class for custom strategies. It is generic over the state type, and a subclass must implement both `trim_context` and `atrim_context`, because both are abstract. Each receives the full state and returns it.

```python
# custom_context.py
from tenxgraph.core.state import AgentState, BaseContextManager


class LastNMessages(BaseContextManager[AgentState]):
    """Keep only the last n messages of the context."""

    def __init__(self, n: int = 20) -> None:
        self.n = n

    def trim_context(self, state: AgentState) -> AgentState:
        state.context = state.context[-self.n :]
        return state

    async def atrim_context(self, state: AgentState) -> AgentState:
        return self.trim_context(state)
```

### Abstract methods

| Method | Signature | Description |
|---|---|---|
| `trim_context` | `(state: S) -> S` | Must implement. Trim or process `state.context` and return the state. |
| `atrim_context` | `async (state: S) -> S` | Must implement. Async version. The agent calls this one. |

## How context managers run in a graph

An `Agent` node calls `await context_manager.atrim_context(state)` before it sends messages to the model, but only when the agent was created with `trim_context=True`. The default is `False`. If trimming is enabled and no manager is registered, the agent logs a warning and continues with the full context.

```text
StateGraph(context_manager=manager)
  -> Agent(trim_context=True)
       -> manager.atrim_context(state)   # before each LLM call
```

The graph also runs the manager when it persists state at the end of a run, so the trimmed context is what the checkpointer stores. See [Set up checkpointing](/docs/guides/set-up-checkpointing) for how state is saved.

## Access the manager in a node

A node function can receive the registered manager through dependency injection. The parameter is `None` when the graph has no manager.

```python
# nodes.py
from injectq import Inject

from tenxgraph.core.state import AgentState, BaseContextManager


async def my_node(
    state: AgentState,
    ctx_mgr: BaseContextManager | None = Inject[BaseContextManager],
) -> AgentState:
    # Trim explicitly before doing your own LLM call
    if ctx_mgr:
        state = await ctx_mgr.atrim_context(state)
    return state
```

See [Dependency injection](/docs/concepts/dependency-injection) for the other injectable objects.

## Common errors

| Symptom | Cause | Fix |
|---|---|---|
| Context grows without limit | No manager was passed to `StateGraph`, or the `Agent` was created without `trim_context=True`. | Pass `context_manager=` to `StateGraph(...)` and set `trim_context=True` on the `Agent`. |
| Log line "trim_context is enabled but no context manager is available" | `trim_context=True` but the graph has no manager. | Add `context_manager=MessageContextManager()` to `StateGraph`. |
| `TypeError` when creating a custom manager | The subclass implements only one of `trim_context` and `atrim_context`; both are abstract. | Implement both. `atrim_context` can call `trim_context`. |
| System prompt disappears | The message role is not exactly `"system"`. | Create it with `role="system"`. The check is exact string equality. |
| `RuntimeError: asyncio.run() cannot be called from a running event loop` | `SummaryContextManager.trim_context` was called from async code. | Use `await manager.atrim_context(state)`. |
| Summaries are slow | Each summarization is an extra LLM call that blocks the node. | Use a smaller summarizer model, or raise `token_budget` or `max_messages` so it runs less often. |
| Context never shrinks with `SummaryContextManager` | Both triggers are `None`, the context is not past a threshold, the summarizer failed, or it returned an empty string. | Set `max_messages` or `token_budget` and check the logs for "Summarisation LLM call failed". |
| 400 "Invalid `signature` in `thinking` block" with Claude | Trimming or summarizing removed messages that Claude's signed thinking blocks were bound to. | Pass `thinking` with `block_binding` and the beta header to the `Agent`. See [Context managers and thinking signatures](/docs/integrations/anthropic#context-managers-and-thinking-signatures). |
