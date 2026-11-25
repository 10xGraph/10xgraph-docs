---
title: Manage conversation context
description: "Keep message history within your LLM's context window using trimming and summarization."
section: "Build agents"
group: "Context and dependencies"
order: 230
updated: "2026-11-26"
faq:
  - q: "Do I need a context manager?"
    a: "Only if your agent runs for many turns and messages accumulate beyond the model's context window. For short-lived conversations, it is not necessary. Use one if you see truncation errors or degraded quality after many exchanges."
  - q: "Which manager should I use?"
    a: "MessageContextManager for simplicity and speed; it trims by message count. SummaryContextManager when long conversations are important and you can afford LLM-based summarization to preserve information."
  - q: "Does SummaryContextManager always summarize?"
    a: "No. It summarizes only when the message count or token budget is exceeded. Until then, no summarization happens."
---

Keep message history inside the model's context window by trimming old messages (`MessageContextManager`) or summarizing them (`SummaryContextManager`). Why and the trade-offs are in [Context management](/docs/concepts/context-management).

## Prerequisites

You have a working graph with at least one `Agent` node. Install 10xGraph with the provider extra your model needs, for example `pip install "10xgraph[google-genai]"` for Gemini.

## Option 1: MessageContextManager (trimming)

`MessageContextManager` discards old messages, keeping only the most recent N user messages. System messages are always preserved.

### Quick start

```python
from tenxgraph.core import Agent, StateGraph
from tenxgraph.core.state import Message, MessageContextManager
from tenxgraph.utils import END

context_manager = MessageContextManager(max_messages=10)

agent = Agent(
    model="gemini-2.5-flash",
    provider="google",
    system_prompt=[{"role": "system", "content": "You are a helpful assistant."}],
    trim_context=True,  # enable trimming for this agent
)

graph = StateGraph(context_manager=context_manager)
graph.add_node("agent", agent)
graph.set_entry_point("agent")
graph.add_edge("agent", END)

app = graph.compile()

# Run the agent
result = app.invoke({"messages": [Message.text_message("Hello")]})
print(result["messages"][-1].text())
```

Two steps are required:

1. **Pass `context_manager=` to `StateGraph()`** so the graph knows to trim.
2. **Set `trim_context=True` on the Agent** that should trim context before each call.

### Configuration

```python
context_manager = MessageContextManager(
    max_messages=10,       # keep the last N user messages (default: 10)
    remove_tool_msgs=False # also strip tool messages (default: False)
)
```

**Important:** System messages (role `"system"`) are **always kept** and never trimmed. Only user/assistant/tool messages are trimmed, and always from the oldest end, preserving the most recent context.

## Option 2: SummaryContextManager (compression)

`SummaryContextManager` compresses old messages into a single LLM-generated summary, preserving facts while freeing context budget.

### Quick start

```python
from tenxgraph.core import Agent, StateGraph
from tenxgraph.core.state import Message, SummaryContextManager
from tenxgraph.utils import END

context_manager = SummaryContextManager(
    model="gemini-2.0-flash",
    max_messages=30,
    token_budget=6000,
    keep_recent=8,
)

agent = Agent(
    model="gemini-2.5-flash",
    provider="google",
    system_prompt=[{"role": "system", "content": "You are a helpful assistant."}],
    trim_context=True,
)

graph = StateGraph(context_manager=context_manager)
graph.add_node("agent", agent)
graph.set_entry_point("agent")
graph.add_edge("agent", END)

app = graph.compile()

# Run the agent over multiple turns
result = app.invoke({"messages": [Message.text_message("What is Python?")]})
print(result["messages"][-1].text())

# After summarization, the oldest messages are replaced with a summary:
# state.context_summary holds the compressed conversation.
# state.context keeps system messages plus the last 8 non-system messages.
```

### Configuration

```python
context_manager = SummaryContextManager(
    model="gpt-4o-mini",               # model for summarization
    max_messages=30,                   # summarize when count exceeds this
    token_budget=8000,                 # or when tokens exceed this (either triggers)
    keep_recent=8,                     # preserve this many recent messages
    remove_tool_msgs=False,            # also strip tool messages (default: False)
    summary_system_prompt=None,        # override the default prompt
    max_summary_tokens=600,            # limit summary output length
    api_style="responses",             # OpenAI only: "responses" (default) or "chat"
)
```

All options are in [Context managers](/docs/reference/python/context-manager#summarycontextmanager).

### How summarization works

When the message count passes `max_messages` or the estimated tokens pass `token_budget`, the older messages (all but the `keep_recent` newest and the system messages) are summarized into `state.context_summary`, which the agent sends before the recent messages. A new summary is appended to the previous one and compacted when it grows too long. If the summary call fails, the context is left unchanged and the error is logged.


## Custom context managers

To implement different logic (e.g., importance-based trimming, semantic similarity), subclass `BaseContextManager`:

```python
from tenxgraph.core.state import BaseContextManager, AgentState

class ImportanceContextManager(BaseContextManager):
    """Keep messages marked as important, discard the rest."""

    def __init__(self, max_messages: int = 10):
        self.max_messages = max_messages

    async def trim_context(self, state: AgentState) -> AgentState:
        messages = state.context
        # Separate system and important messages from regular ones
        system = [m for m in messages if m.role == "system"]
        regular = [m for m in messages if m.role != "system"]

        # Keep the last max_messages and any marked as important
        recent_ids = {id(m) for m in regular[-self.max_messages:]}
        kept = [m for m in regular if m.metadata.get("important") or id(m) in recent_ids]

        state.context = system + kept
        return state
```

Register it the same way:

```python
graph = StateGraph(context_manager=ImportanceContextManager(max_messages=10))
```

A custom manager implements only `trim_context`. Write it as `async def` (recommended, the engine is async) or as a plain `def`; a sync version runs in a worker thread. `atrim_context` is deprecated and removed in 2.0.

## Verify trimming

Enable debug logging to see when trimming happens:

```python
import logging
logging.getLogger("tenxgraph.state").setLevel(logging.DEBUG)  # summary: "tenxgraph.state.summary"
```

**For MessageContextManager:**
```
Trimmed from 42 to 21 messages (10 user messages kept)
```

**For SummaryContextManager:**
```
Summarisation triggered by message count: 35 > 30
Summarising 27 messages; keeping 8 recent (provider=google, model=gemini-2.0-flash)
Context reduced to 8 messages; cumulative summary length=450 chars
```

## Common errors and fixes

| Error | Cause | Fix |
|---|---|---|
| Context keeps growing despite `trim_context=True` | `context_manager` was not passed to `StateGraph()`. | Add `context_manager=context_manager` to `StateGraph(...)`. |
| Tool results disappear from responses | `remove_tool_msgs=True` is too aggressive for your use case. | Set `remove_tool_msgs=False` (default) or keep tool results in `keep_recent`. |
| Context is never summarized | The summary call fails (model name or API key). | Look for the ERROR "Summarisation LLM call failed; leaving context unchanged" in the `tenxgraph.state.summary` log. |
| 400 "Invalid `signature` in `thinking` block" with Claude | Trimming or summarizing removed messages that Claude's signed thinking blocks were bound to. | Pass `thinking` with `block_binding` and the beta header to the `Agent`. See [Context managers and thinking signatures](/docs/integrations/anthropic#context-managers-and-thinking-signatures). |

## Run it in production

Trimming or summarizing context keeps every thread's stored state and your token cost bounded, which matters once many users share one database. There is no enforced maximum state size. See [Scaling and reliability](/docs/production/scaling) and [Errors and limits](/docs/concepts/errors-and-limits).

## Next steps

- Learn about [long-term memory](/docs/concepts/memory-and-store) for storing facts across sessions.
- See how to [set up checkpointing](/docs/guides/set-up-checkpointing) for multi-turn persistence.
