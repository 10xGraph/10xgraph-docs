---
title: Context management
description: Manage model context window by trimming or summarizing message history as conversations grow.
section: Concepts
order: 130
group: "Memory and reliability"
updated: "2026-10-08"
---

As an agent conversation grows, the message history it sends to the model on each turn grows with it. Without bounds, this inflates token cost, latency, and eventually hits the model's context window. Context managers handle this by keeping the history within limits while preserving what the model needs to continue the conversation.

10xGraph offers two strategies: **trimming** (discard old messages) and **summarizing** (compress old messages with an LLM). Messages are also written to the checkpointer's message store, but at the end of a run the persisted `state.context` is the trimmed or summarized version.

## The problem: unbounded history

Every time the model runs, it receives the full `state.context` list of messages. Early in a conversation, this is cheap. After 50 exchanges with tools and follow-ups, the context balloons:

- Token cost per turn grows linearly with history length.
- Latency increases because the model must process more tokens.
- Beyond the context window (typically 128k or 200k tokens), the API rejects the request.

The context manager bounds `state.context`, which is what the model sees on its next call.

## Strategy 1: Trimming with MessageContextManager

`MessageContextManager` keeps the **N most recent user messages** and drops the rest. It does not use an LLM call. Install a provider extra for the Agent, for example `pip install "10xgraph[google-genai]"`.

```python
from tenxgraph.core import Agent, StateGraph
from tenxgraph.core.state import MessageContextManager

context_manager = MessageContextManager(
    max_messages=10,       # keep the last 10 user messages
    remove_tool_msgs=False # keep tool calls and results
)

agent = Agent(
    model="gemini-2.5-flash",
    trim_context=True,  # enable trimming for this Agent
)

graph = StateGraph(context_manager=context_manager)
graph.add_node("main", agent)
graph.set_entry_point("main")
app = graph.compile()
```

### How trimming works

- Counts only **user-role messages**, not all messages. An exchange (user + assistant + 3 tool calls + 3 tool results) counts as one.
- **Always preserves system messages**, regardless of `max_messages`.
- Drops the oldest non-system messages, keeping everything from the Nth most recent user message onward.
- Runs before each Agent call and again when a run ends, so the persisted `state.context` is the trimmed list.

If `remove_tool_msgs=True`, also strips assistant messages with tool calls and tool-result messages. This further reduces token cost when tools are verbose.

### Trade-offs

| Pros | Cons |
|---|---|
| No LLM calls; deterministic and fast. | Model forgets what fell out of the window. |
| Predictable token cost. | Can lose context needed for reasoning (e.g., earlier decisions). |
| Simple to configure (one integer). | May miss facts the user provided 20 messages ago. |

**When to use:** short conversations, dense conversations (few tool calls per message), or when you can store facts in `state` or a memory store instead of relying on the model to remember them.

## Strategy 2: Summarizing with SummaryContextManager

`SummaryContextManager` replaces old messages with an LLM-generated summary, keeping the N most recent messages verbatim. It needs the extra for the summarizer model's provider (`10xgraph[google-genai]` or `10xgraph[openai]`).

```python
from tenxgraph.core import Agent, StateGraph
from tenxgraph.core.state import SummaryContextManager

context_manager = SummaryContextManager(
    model="gemini-2.0-flash",
    max_messages=30,      # summarize when > 30 messages
    token_budget=8000,    # or when > 8000 est. tokens
    keep_recent=8,        # preserve the last 8 messages
    remove_tool_msgs=False,
)

agent = Agent(
    model="gpt-4o",
    trim_context=True,  # enable summarization
)

graph = StateGraph(context_manager=context_manager)
graph.add_node("main", agent)
graph.set_entry_point("main")
app = graph.compile()
```

### How summarization works

Summarization triggers when **either** threshold is exceeded:

- **`max_messages`**: total message count in `state.context` exceeds this value (default 30; `None` disables it).
- **`token_budget`**: estimated token count (roughly 4 characters per token) exceeds this value (default `None`, disabled).

Once triggered:

1. The oldest non-system messages are sent to the summarization model (with the summary system prompt). System messages are never summarized.
2. The model produces a concise text capturing facts, decisions, tool results, and context.
3. This summary replaces the old messages in `state.context_summary`.
4. The most recent `keep_recent` non-system messages remain verbatim in `state.context`. If the summarization call fails, the context is left unchanged.

`convert_messages` (the function that turns `state` into the model's message input) automatically injects the accumulated summary as an assistant message before the retained context, so the model sees:

```
[System prompt]
[Context summary from earlier exchanges]
[Last 8 messages verbatim]
```

Subsequent summarizations append to the existing summary, preserving a rolling history of everything discussed.

### Trade-offs

| Pros | Cons |
|---|---|
| Model retains high-level facts and decisions. | Costs tokens on each summarization LLM call. |
| Graceful degradation; old details fade to summary. | Summary quality depends on the model chosen. |
| Two tuning knobs (message count and token budget). | Adds latency at the summarization point. |
| Handles long conversations better than trimming. | Summarization prompt injection is a risk; customize it carefully. |

**When to use:** long conversations, conversations where the model must reason about past context (e.g., multi-turn negotiation or analysis), or when facts live only in the conversation and not in a store.

## Choosing between them

| Factor | Trimming | Summarizing |
|---|---|---|
| Token cost per turn | Lowest. | Higher (per-turn + summarization calls). |
| Memory of old context | None. | High-level summary only. |
| Latency | Lowest. | Higher at summarization boundary. |
| When context is sparse | Better. | Overkill; wastes LLM calls. |
| When context is dense | Worse; loses details. | Better; summary captures intent. |
| Long conversations (100+ messages) | Poor. | Good. |

## Preserving facts across trimming

If you use trimming and conversation grows long, the model will lose early context. Move critical facts to:

1. **`state` fields**: Store extracted data in custom state fields (e.g., `state.user_profile`, `state.decisions`). Nodes can update these; the model can read them.
2. **Memory store**: Use `/docs/guides/use-memory-store` to save facts to a durable store (PgVectorStore or another vector DB). Nodes can retrieve them with a retrieval tool.
3. **System prompt**: Include static facts (company policies, user role) in the system prompt; they are always preserved.

Example:

```python
from tenxgraph.core.state import AgentState

class CustomState(AgentState):
    user_profile: str  # Static facts about the user
    decisions_made: list[str]  # Extracted decisions

context_manager = MessageContextManager(max_messages=10)

async def extract_decision(state: CustomState) -> CustomState:
    # After the model's response, extract and store the decision
    last_msg = state.context[-1]
    if "decided" in last_msg.text():
        state.decisions_made.append(last_msg.text())
    return state
```

Now even if the message history is trimmed to 10 messages, `state.decisions_made` and `state.user_profile` remain available to nodes downstream.

**Claude with thinking on:** removing or replacing earlier messages invalidates the signed thinking blocks Claude has stored, and Anthropic can reject the next request with a 400. A one-line fix on the `Agent` avoids it. See [Context managers and thinking signatures](/docs/integrations/anthropic#context-managers-and-thinking-signatures).

## Context managers and the checkpointer

The context manager runs on `state` before the Agent calls the model, and again when a run finishes, just before the state is saved. So the saved state is already reduced:

- **Trimming**: the saved `state.context` holds only the kept messages.
- **Summarizing**: the saved state has `state.context_summary` plus the trimmed `state.context`.

Messages produced during each run are also written to the checkpointer's message store as they happen, so a per-message record exists apart from the trimmed state. Treat the trimmed state, not the message store, as what the next run starts from.

## Related pages

- `/docs/guides/use-context-manager`: How to implement and troubleshoot context managers.
- `/docs/guides/use-memory-store`: Long-term memory stores for facts that outlive the conversation.
- `/docs/concepts/checkpointing-and-threads`: How threads and checkpoints preserve state.
- `/docs/reference/python/context-manager`: Full API for `MessageContextManager` and `SummaryContextManager`.
