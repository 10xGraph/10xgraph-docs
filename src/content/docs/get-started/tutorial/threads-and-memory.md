---
title: Add Memory with Threads
seoTitle: "Add memory with checkpointers and thread IDs"
description: "Give your agent conversation memory with thread IDs and checkpointers, persist state across calls, and tell thread memory apart from long-term memory."
group: "Tutorial"
section: "Get started"
order: 70
label: Add Memory
updated: "2026-11-25"
faq:
  - q: "Why does my agent forget what I said in the previous call?"
    a: "Either the graph was compiled without a checkpointer, or each call used a different thread_id. Attach a checkpointer with graph.compile(checkpointer=...) and pass the same thread_id in config on every call of the conversation."
  - q: "What happens if I do not pass a thread_id?"
    a: "The graph generates a random thread_id for that run and logs a warning. The run cannot be continued later because nobody knows its ID, so always pass an explicit thread_id."
  - q: "Is a checkpointer the same as long-term memory?"
    a: "No. A checkpointer stores the full state of one thread, keyed by thread_id. Long-term memory is a separate store searched by meaning and shared across threads and users."
---

A checkpointer saves your agent's state after each run, so a conversation continues across calls that share a `thread_id`. Without one, every `app.invoke` call starts from nothing. In this step you attach `InMemoryCheckpointer`, prove memory works across turns and fails across threads, and learn the upgrade path to SQLite and Postgres+Redis.

## What you build

You take the agent from the previous steps and compile it with a checkpointer. Then you run two turns on one thread and see the agent recall your name, and run a third call on a different thread and see it does not.

Prerequisites:

- 10xGraph installed with a provider extra: `pip install "10xgraph[google-genai]"` (or `[openai]` or `[anthropic]`).
- The provider API key set in your environment, as in the earlier steps.

## Understand threads and checkpoints

A thread is one conversation, identified by a `thread_id` string you choose. When a checkpointer is attached, each `app.invoke` call loads the saved state for that ID, adds your new message, runs the graph, and saves the result back. Different IDs never see each other's state.

You send only the new message on each call. The checkpointer supplies the earlier history, so you do not resend it.

If you omit `thread_id`, the graph generates a random one and logs a warning. That run cannot be resumed or stopped later, because no caller knows its ID. Always pass an explicit `thread_id` for anything you may continue.

## Add a checkpointer to the graph

`InMemoryCheckpointer` keeps all state in process memory. It needs no setup or extra packages, which makes it the right choice for development and tests. State is lost when the process exits.

Create `agent_with_memory.py`. The graph is a single agent node with no tools, compiled with a checkpointer:

```python title="agent_with_memory.py"
from tenxgraph.core.graph import Agent, StateGraph
from tenxgraph.core.state import AgentState, Message
from tenxgraph.storage.checkpointer import InMemoryCheckpointer
from tenxgraph.utils import END

# State lives in this process only; it disappears on exit
checkpointer = InMemoryCheckpointer()

agent = Agent(
    model="gemini-2.5-flash",
    system_prompt=[
        {"role": "system", "content": "You are a helpful assistant."}
    ],
)

graph = StateGraph(AgentState)
graph.add_node("assistant", agent)
graph.set_entry_point("assistant")
graph.add_edge("assistant", END)

# Attach the checkpointer when you compile
app = graph.compile(checkpointer=checkpointer)

THREAD = "memory-demo-1"

# Turn 1: tell the agent your name
result = app.invoke(
    {"messages": [Message.text_message("My name is Alex.")]},
    config={"thread_id": THREAD},
)
print("Turn 1:", result["messages"][-1].text())

# Turn 2: same thread_id, so the agent sees turn 1
result = app.invoke(
    {"messages": [Message.text_message("What is my name?")]},
    config={"thread_id": THREAD},
)
print("Turn 2:", result["messages"][-1].text())

# Turn 3: a different thread_id starts from a blank state
result = app.invoke(
    {"messages": [Message.text_message("What is my name?")]},
    config={"thread_id": "memory-demo-2"},
)
print("New thread:", result["messages"][-1].text())
```

## Run it and check memory

Run the file. The first two calls share a thread, and the third uses a new one:

```bash
python agent_with_memory.py
```

Example output (the wording varies from run to run):

```text
Turn 1: Nice to meet you, Alex!
Turn 2: Your name is Alex.
New thread: I don't know your name yet. Could you tell me?
```

Turn 2 answers correctly because it ran on `memory-demo-1`, where the checkpointer holds turn 1. The last call used `memory-demo-2`, which has no history, so the agent cannot know your name. To confirm the checkpointer is the cause, remove `checkpointer=checkpointer` from `compile` and run again: turn 2 no longer knows the name.

## Choose a checkpointer for your use case

All three checkpointers plug into `graph.compile(checkpointer=...)` the same way, so moving between them changes one line. Pick by how long state must live and how many users you serve.

| Checkpointer | Storage | Durability | When to use | Install |
|---|---|---|---|---|
| `InMemoryCheckpointer` | Process memory | Lost on exit | Development, tests, demos | Included |
| `SqliteCheckpointer` | One SQLite file | Survives restarts | Single-user or embedded agents, desktop apps, CLI tools | `pip install "10xgraph[sqlite_checkpoint]"` |
| `PgCheckpointer` | Postgres and Redis | Durable, shared | Multi-user servers, production | `pip install "10xgraph[pg_checkpoint]"` |

Setup code for SQLite and Postgres is in the [checkpointing guide](/docs/guides/set-up-checkpointing).

## Thread memory versus long-term store

There are two separate memory layers. Thread memory is the checkpointer: the full conversation state of one thread, loaded by `thread_id`. The long-term store holds facts that outlive any single thread.

| Layer | Holds | Looked up by | Scope |
|---|---|---|---|
| Thread memory (checkpointer) | Messages and state of one conversation | `thread_id` | One thread |
| Long-term store (for example PgVectorStore or Qdrant) | Facts, preferences, shared knowledge | Semantic search | Across threads and users |

This tutorial builds thread memory. Add a long-term store when the agent must remember something across conversations, such as "remember my preferences in every chat". It is optional and set with `Agent(memory=MemoryConfig(...))`; see [Long-term memory](/docs/concepts/memory-and-store).

## Next step

Serve the agent over HTTP with [Serve and inspect](/docs/get-started/tutorial/serve-and-inspect). Method-level details for each backend are in the [checkpointers reference](/docs/reference/python/checkpointers).
