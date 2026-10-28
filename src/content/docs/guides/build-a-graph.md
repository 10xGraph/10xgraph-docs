---
title: Build a graph
description: Create a StateGraph with nodes and routing, compile it, and run it with invoke.
section: "Build agents"
group: "Agents and graphs"
order: 20
label: Build a graph
updated: "2026-10-27"
faq:
  - q: "What imports do I need?"
    a: "Import `StateGraph`, `Agent`, `ToolNode` from `tenxgraph.core.graph`, `AgentState` and `Message` from `tenxgraph.core.state`, and `START`, `END` from `tenxgraph.utils`."
  - q: "How do I route between nodes?"
    a: "Use `add_edge()` for static routes and `add_conditional_edges()` with a function that returns a node name or looks up the name in a map."
  - q: "Do I need a checkpointer?"
    a: "No; graphs default to in-memory state. Add a checkpointer to `compile()` for persistence across runs."
---

`StateGraph` is the core orchestration primitive in 10xGraph. You construct a workflow by adding nodes (functions, `Agent` instances, or `ToolNode` instances), connecting them with edges, and compiling to get a runnable `CompiledGraph`. This guide walks you through building, wiring, and running a graph end to end.

## Prerequisites

Install the core library with a provider extra:

```bash
pip install "10xgraph[google-genai]"
```

Set your provider API key:

```bash
export GOOGLE_API_KEY=...         # for Google Gemini
export OPENAI_API_KEY=sk-...      # for OpenAI
export ANTHROPIC_API_KEY=...      # for Anthropic
```

## Import the essentials

```python
from tenxgraph.core.graph import StateGraph, Agent, ToolNode
from tenxgraph.core.state import AgentState, Message
from tenxgraph.utils import START, END
```

## Define your tools

Tools are plain Python functions. The LLM sees the function name, docstring, and type-annotated parameters. This schema determines what tools the LLM can call.

```python
from tenxgraph.prebuilt.tools import safe_calculator

def get_weather(city: str) -> str:
    """Return current weather for a city."""
    return f"Weather in {city}: 22°C, partly cloudy."

# Arithmetic: use the prebuilt safe_calculator. Never pass model output to eval(),
# even with empty builtins: it can be escaped, and 9**9**9 hangs the process.
```

## Create a ToolNode

Group tools in a `ToolNode`. Each function's `__name__` becomes the tool name the LLM uses. The node runs all tools in parallel when the LLM requests several at once.

```python
tool_node = ToolNode([get_weather, safe_calculator])
```

## Create an Agent node

`Agent` wraps the LLM as a graph node. It calls the model, receives tool calls if the LLM requests them, and returns a message. You pass tools by name or as a `ToolNode` instance.

```python
agent = Agent(
    model="gemini-2.5-flash",
    system_prompt=[{"role": "system", "content": "You are a helpful assistant."}],
    tool_node=tool_node,
)
```

Other key options:
- `provider`: explicit provider choice (`"google"`, `"openai"`, `"anthropic"`). Usually inferred from the model name.
- `temperature`, `max_tokens`, `top_p`: model parameters.
- `output_schema`: Pydantic model for structured output.

## Build and wire the graph

A graph is built by adding nodes and edges. Edges define the flow: static edges (always route one way) or conditional edges (route based on the state).

```python
graph = StateGraph()

# Add two nodes: the agent and the tool executor
graph.add_node("MAIN", agent)
graph.add_node("TOOL", tool_node)

# Conditional routing: if the agent produced tool calls, go to TOOL, else END
def should_use_tools(state: AgentState) -> str:
    last = state.context[-1] if state.context else None
    if last and last.role == "assistant" and getattr(last, "tools_calls", None):
        return "TOOL"
    return END

graph.add_conditional_edges("MAIN", should_use_tools, {"TOOL": "TOOL", END: END})

# After tools are done, loop back to the agent
graph.add_edge("TOOL", "MAIN")

# Set the entry point (START → MAIN)
graph.set_entry_point("MAIN")
```

### Key graph methods

| Method | Purpose |
|---|---|
| `add_node(name, func)` | Add a node. The name is a string; `func` is a callable, `Agent`, or `ToolNode`. |
| `add_edge(from_node, to_node)` | Add a static route: always go from `from_node` to `to_node`. |
| `add_conditional_edges(from_node, condition, path_map)` | Add dynamic routing. `condition(state)` returns a key; `path_map` maps keys to node names. Or omit `path_map` and have `condition` return the node name directly. |
| `set_entry_point(node_name)` | Set the starting node. Shorthand for `add_edge(START, node_name)`. |
| `compile(checkpointer=None, store=None, ...)` | Build the executable graph. Returns a `CompiledGraph`. |

## Compile

Once the graph is wired, compile it to get a runnable `CompiledGraph`:

```python
app = graph.compile()
```

Compilation validates the graph structure and prepares it for execution. Without a `checkpointer`, the graph uses an `InMemoryCheckpointer`: threads keep their state while the process runs, and everything is lost on restart. For state that survives restarts, pass a durable checkpointer (the SQLite one needs `pip install "10xgraph[sqlite_checkpoint]"`):

```python
from tenxgraph.storage.checkpointer import SqliteCheckpointer

app = graph.compile(
    checkpointer=SqliteCheckpointer(db_path="./db.sqlite"),
)
```

See [set up checkpointing](/docs/guides/set-up-checkpointing) for persistent state options.

## Run the graph

Call `invoke()` to run the graph synchronously:

```python
result = app.invoke(
    {"messages": [Message.text_message("What is the weather in Paris?")]},
    config={"thread_id": "session-1", "user_id": "user-42"},
)

for msg in result["messages"]:
    print(f"{msg.role}: {msg.text()}")
```

Or use `ainvoke()` for async execution:

```python
import asyncio

async def main():
    result = await app.ainvoke(
        {"messages": [Message.text_message("Calculate 123 * 456")]},
        config={"thread_id": "session-2"},
    )
    for msg in result["messages"]:
        print(f"{msg.role}: {msg.text()}")

asyncio.run(main())
```

## Run config: thread_id, user_id, and more

The `config` dict controls runtime behavior. Most keys are optional:

| Key | Default | Purpose |
|---|---|---|
| `thread_id` | UUID (auto-generated, with a logged warning) | Conversation thread ID. Used by the checkpointer to save and load state. Pass one explicitly for any run you may resume or stop. |
| `user_id` | `"anonymous"` | User identifier. Passed to tools and event publishers. |
| `recursion_limit` | 25 | Max node execution steps. Prevents infinite loops; raises `GraphRecursionError` if exceeded. |

Other reserved keys are set by the runtime and should not be passed:

- `run_id`: unique execution ID.
- `is_stream`: true if this is a streaming run.
- `timestamp`: run start time.

If you enable JWT auth on the API server, two additional keys are injected:

- `user_id`: authenticated user.
- `user`: the auth object or claims.

Extra keys in `config` are kept and are readable by nodes that take `config`:

```python
result = app.invoke(
    {"messages": [Message.text_message("What is the weather in Paris?")]},
    config={"thread_id": "session-1", "user_id": "user-42", "metadata": {"source": "api"}},
)
```

To set fields on a custom state at invoke time, pass them under a `"state"` key in the input, for example `{"messages": [...], "state": {"priority": "high"}}`. See [use custom state](/docs/guides/use-custom-state).

## Handle tool errors

When a tool raises an exception, the error is caught and returned as a `ToolResultBlock` with the error message. The agent sees the error and can retry or report it.

```python
def divide(a: float, b: float) -> float:
    """Divide two numbers."""
    if b == 0:
        raise ValueError("Cannot divide by zero.")
    return a / b
```

When the agent calls `divide(10, 0)`, the error is turned into a tool result and sent back to the agent in the next message. The agent can decide to inform the user or try a different approach.

## Conditional routing patterns

### Direct routing (condition returns node name)

The condition function returns the node name directly:

```python
class TicketState(AgentState):
    priority: str = "normal"
    category: str = "default"

def route_to_next(state: TicketState) -> str:
    priority = state.priority
    return "urgent_queue" if priority == "high" else "normal_queue"

graph.add_conditional_edges("classifier", route_to_next)
```

### Mapped routing (condition result mapped to nodes)

The condition returns a key, and a map translates it to a node name:

```python
def get_category(state: TicketState) -> str:
    return state.category

category_map = {
    "finance": "finance_processor",
    "legal": "legal_processor",
    "default": "general_processor",
}
graph.add_conditional_edges("categorizer", get_category, category_map)
```

### Tool call detection (common pattern)

Check if the last message from the agent contains tool calls:

```python
def should_use_tools(state: AgentState) -> str:
    last_msg = state.context[-1] if state.context else None
    if last_msg and last_msg.role == "assistant" and getattr(last_msg, "tools_calls", None):
        return "tools"
    return "end"

graph.add_conditional_edges("agent", should_use_tools, {"tools": "tool_node", "end": END})
```

## Complete example

Here is a working agent that can check weather and do math:

```python
from tenxgraph.core.graph import StateGraph, Agent, ToolNode
from tenxgraph.core.state import AgentState, Message
from tenxgraph.prebuilt.tools import safe_calculator
from tenxgraph.utils import END

def get_weather(city: str) -> str:
    """Get the weather for a city."""
    return f"Weather in {city}: 22°C, sunny."

# Arithmetic: use the prebuilt safe_calculator. Never pass model output to eval(),
# even with empty builtins: it can be escaped, and 9**9**9 hangs the process.
tool_node = ToolNode([get_weather, safe_calculator])

agent = Agent(
    model="gemini-2.5-flash",
    system_prompt=[{"role": "system", "content": "You are a helpful assistant."}],
    tool_node=tool_node,
)

graph = StateGraph()
graph.add_node("MAIN", agent)
graph.add_node("TOOL", tool_node)

def should_use_tools(state: AgentState) -> str:
    last = state.context[-1] if state.context else None
    if last and last.role == "assistant" and getattr(last, "tools_calls", None):
        return "TOOL"
    return END

graph.add_conditional_edges("MAIN", should_use_tools, {"TOOL": "TOOL", END: END})
graph.add_edge("TOOL", "MAIN")
graph.set_entry_point("MAIN")

app = graph.compile()

result = app.invoke(
    {"messages": [Message.text_message("What is the weather in Tokyo and what is 100 * 50?")]},
    config={"thread_id": "demo-1", "user_id": "user-1"},
)

for msg in result["messages"]:
    print(f"{msg.role}: {msg.text()}")
```

The output includes the assistant's tool call turn, the tool results (`Weather in Tokyo: 22°C, sunny.` and `5000`) and a final assistant answer. Exact wording depends on the model.

## Run it in production

Serve this graph with `10xgraph dev` while you build, then ship the image from `10xgraph build`. The server loads the compiled `app` once at startup and adds auth, request limits and error handling around it, so you do not write them in the graph. Start at [Production readiness](/docs/production) and [Run the server](/docs/server/run-the-server).

## Next steps

- [Configure an Agent](/docs/guides/configure-agent): dive into model selection, system prompts, and structured output.
- [Set up checkpointing](/docs/guides/set-up-checkpointing): add persistence for multi-turn conversations.
- [Stream responses](/docs/guides/stream-graph): emit tokens and intermediate results as they happen.
- [Custom state](/docs/guides/use-custom-state): extend `AgentState` with domain-specific fields.
- [Use custom nodes](/docs/guides/use-custom-nodes): write function nodes that are not agents or tools.
