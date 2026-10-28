---
title: Manage conversation context
description: "Keep message history within your LLM's context window using trimming and summarization."
section: "Build agents"
group: "State, memory and context"
order: 260
updated: "2026-10-27"
faq:
  - q: "Do I need a context manager?"
    a: "Only if your agent runs for many turns and messages accumulate beyond the model's context window. For short-lived conversations, it is not necessary. Use one if you see truncation errors or degraded quality after many exchanges."
  - q: "Which manager should I use?"
    a: "MessageContextManager for simplicity and speed; it trims by message count. SummaryContextManager when long conversations are important and you can afford LLM-based summarization to preserve information."
  - q: "Does SummaryContextManager always summarize?"
    a: "No. It summarizes only when the message count or token budget is exceeded. Until then, no summarization happens. The summary is optional and additive."
---

As an agent runs, messages accumulate in its context. Without limits, the history grows until it exceeds the model's context window, causing failures or degraded performance. Two strategies handle this: **trimming** (discard old messages) and **summarization** (compress old messages into a concise summary). 10xGraph ships both, and you choose based on your use case.

## Prerequisites

You have a working graph with at least one `Agent` node. Install 10xGraph with the provider extra your model needs, for example `pip install "10xgraph[google-genai]"` for Gemini.

## Why context management matters

Every LLM has a context window limit. In a long-running agent, the message history grows with each interaction:

1. User sends a message (100 tokens)
2. Agent responds, adds 2-3 messages to context (300 tokens)
3. User replies, adds another message (100 tokens)
4. This pattern repeats...

After 20-30 exchanges, the history may exceed the window. When that happens:
- Some models silently truncate old messages, losing important context.
- Others return a hard error.
- Either way, the agent loses coherence and produces poor results.

Context management prevents this by keeping context within budget while preserving what matters most.

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

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `max_messages` | `int` | `10` | Number of user-role messages to keep per LLM call. |
| `remove_tool_msgs` | `bool` | `False` | If `True`, strips AI messages with tool calls and tool result messages. Useful to reduce clutter from long tool traces. |

**Important:** System messages (role `"system"`) are **always kept** and never trimmed. Only user/assistant/tool messages are trimmed, and always from the oldest end, preserving the most recent context.

### When to use MessageContextManager

- Conversations are moderately long (under 100 messages).
- You do not need to preserve the entire history.
- Speed and simplicity matter (no LLM call overhead).
- You have a known context window and can estimate a safe `max_messages`.

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

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `model` | `str` | Required | Model for summarization (e.g., `"gpt-4o-mini"`, `"gemini-2.0-flash"`). Provider is auto-detected. |
| `max_messages` | `int \| None` | `30` | Summarize when message count exceeds this. `None` disables count-based trigger. |
| `token_budget` | `int \| None` | `None` | Summarize when estimated tokens exceed this. `None` disables token-budget trigger. Either threshold fires summarization. |
| `keep_recent` | `int` | `8` | Non-system messages to retain verbatim after summarization. |
| `remove_tool_msgs` | `bool` | `False` | If `True`, strips tool-related messages before summarization and trimming. |
| `summary_system_prompt` | `str \| None` | Default | Override the default instruction sent to the summarizer. |
| `max_summary_tokens` | `int` | `600` | Upper bound on summary output length (tokens). |
| `api_style` | `"responses" \| "chat"` | `"responses"` | OpenAI only. Use `"chat"` for older or third-party models. |

### How summarization works

1. **Trigger check**: If message count > `max_messages` or tokens > `token_budget`, summarization is needed.
2. **Split**: The oldest messages (minus `keep_recent` recent ones) are summarized. System messages and the `keep_recent` newest messages are kept.
3. **Summarize**: An LLM call generates a concise summary of the old messages.
4. **Store**: The summary is stored in `state.context_summary`. The agent's response system automatically injects it before the recent messages.
5. **Continue**: Only the recent messages + summary use context budget.

If summarization fails (e.g., API error), the context is left unchanged and the error is logged.

### When to use SummaryContextManager

- Conversations are long (50+ messages) and the full history matters.
- You can afford LLM-based compression (adds latency and cost).
- Information loss from trimming is unacceptable.
- You want to preserve facts and decisions across many exchanges.

## Choosing between them

| Aspect | MessageContextManager | SummaryContextManager |
|---|---|---|
| **Speed** | Fast (no LLM call) | Slower (LLM call when triggered) |
| **Cost** | Free | Adds per-summarization cost |
| **Memory loss** | Loses old messages | Compresses to summary |
| **Setup** | Simple | Requires a summarization model |
| **Best for** | Short-to-moderate conversations | Long conversations, information-critical |

## Custom context managers

To implement different logic (e.g., importance-based trimming, semantic similarity), subclass `BaseContextManager`:

```python
from tenxgraph.core.state import BaseContextManager, AgentState

class ImportanceContextManager(BaseContextManager):
    """Keep messages marked as important, discard the rest."""

    def __init__(self, max_messages: int = 10):
        self.max_messages = max_messages

    def trim_context(self, state: AgentState) -> AgentState:
        messages = state.context
        # Separate system and important messages from regular ones
        system = [m for m in messages if m.role == "system"]
        regular = [m for m in messages if m.role != "system"]

        # Keep the last max_messages and any marked as important
        recent_ids = {id(m) for m in regular[-self.max_messages:]}
        kept = [m for m in regular if m.metadata.get("important") or id(m) in recent_ids]

        state.context = system + kept
        return state

    async def atrim_context(self, state: AgentState) -> AgentState:
        return self.trim_context(state)
```

Register it the same way:

```python
graph = StateGraph(context_manager=ImportanceContextManager(max_messages=10))
```

Both `trim_context` and `atrim_context` methods must be implemented. If your logic is synchronous, you can run the sync method in the async version and return the result.

## Verify trimming

Enable debug logging to see when trimming happens:

```python
import logging
logging.getLogger("tenxgraph.state").setLevel(logging.DEBUG)
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
| First user message is always dropped | `max_messages=1` is too low and cutting into important messages. | Increase `max_messages` to at least 3-5. |
| Tool results disappear from responses | `remove_tool_msgs=True` is too aggressive for your use case. | Set `remove_tool_msgs=False` (default) or keep tool results in `keep_recent`. |
| `SummaryContextManager` fails silently | The summarization model or API key is misconfigured. | Check logs with `logging.getLogger("tenxgraph.state.summary")` set to `DEBUG`. Verify your API key and model name. |
| Summary gets very long over time | Each summarization appends to the previous summary, accumulating length. | Lower `max_messages` to trigger summarization more often, or increase `keep_recent` to retain more recent context. |

## Run it in production

Trimming or summarizing context keeps every thread's stored state and your token cost bounded, which matters once many users share one database. There is no enforced maximum state size. See [Scaling and reliability](/docs/production/scaling) and [Errors and limits](/docs/concepts/errors-and-limits).

## Next steps

- Learn about [long-term memory](/docs/concepts/memory-and-store) for storing facts across sessions.
- See how to [set up checkpointing](/docs/guides/set-up-checkpointing) for multi-turn persistence.
- Understand [dependency injection](/docs/guides/use-dependency-injection) to pass context managers or other services to nodes.
