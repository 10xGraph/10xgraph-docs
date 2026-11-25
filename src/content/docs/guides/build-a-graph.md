---
title: Build a graph
description: Create a StateGraph with nodes and routing, compile it, and run it with invoke.
section: "Build agents"
group: "Agents and graphs"
order: 20
label: Build a graph
updated: "2026-11-26"
faq:
  - q: "What imports do I need?"
    a: "Import `StateGraph`, `Agent`, `ToolNode` from `tenxgraph.core.graph`, `AgentState` and `Message` from `tenxgraph.core.state`, and `START`, `END` from `tenxgraph.utils`."
  - q: "How do I route between nodes?"
    a: "Use `add_edge()` for static routes and `add_conditional_edges()` with a function that returns a node name or looks up the name in a map."
  - q: "Do I need a checkpointer?"
    a: "No. Without one, `compile()` uses an `InMemoryCheckpointer` (lost on restart). Pass a durable checkpointer to `compile()` to keep threads across restarts."
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
def get_weather(city: str) -> str:
    """Return current weather for a city."""
    return f"Weather in {city}: 22°C, partly cloudy."

def multiply(a: float, b: float) -> float:
    """Multiply two numbers."""
    return a * b
```

## Create a ToolNode

Group tools in a `ToolNode`. Each function's `__name__` becomes the tool name the LLM uses. The node runs all tools in parallel when the LLM requests several at once.

```python
tool_node = ToolNode([get_weather, multiply])
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
    if last and last.role == "assistant" and last.tools_calls:
        return "TOOL"
    return END

graph.add_conditional_edges("MAIN", should_use_tools, {"TOOL": "TOOL", END: END})

# After tools are done, loop back to the agent
graph.add_edge("TOOL", "MAIN")

# Set the entry point (START → MAIN)
graph.set_entry_point("MAIN")
```

All `StateGraph` methods are in the [graph reference](/docs/reference/python/graph).

## Compile

Once the graph is wired, compile it to get a runnable `CompiledGraph`:

```python
app = graph.compile()
```

Without a `checkpointer`, the graph uses an `InMemoryCheckpointer`: threads keep their state while the process runs, and everything is lost on restart. For state that survives restarts, pass a durable checkpointer (the SQLite one needs `pip install "10xgraph[sqlite_checkpoint]"`):

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

`thread_id` names the conversation (pass one for any run you may resume or stop; without it a random id is used and a warning is logged), `user_id` the caller (default `"anonymous"`, also with a warning) and `recursion_limit` the step cap (default 25). The full list is in [What goes in the run config?](/docs/concepts/state-graph#what-goes-in-the-run-config).

Extra keys in `config` are kept and are readable by nodes that take `config`:

```python
result = app.invoke(
    {"messages": [Message.text_message("What is the weather in Paris?")]},
    config={"thread_id": "session-1", "user_id": "user-42", "metadata": {"source": "api"}},
)
```

To set fields on a custom state at invoke time, pass them under a `"state"` key in the input, for example `{"messages": [...], "state": {"priority": "high"}}`. See [use custom state](/docs/guides/use-custom-state).

## Handle tool errors

When a tool raises an exception, `ToolNode` catches it and returns a failed tool result. The model gets only `Tool '<name>' failed with an internal error (reference <id>).`; the exception text stays in the server log. To give the model a reason it can act on, return `ToolResult(message=..., is_error=True)` instead of raising.

```python
def divide(a: float, b: float) -> float:
    """Divide two numbers."""
    if b == 0:
        raise ValueError("Cannot divide by zero.")
    return a / b
```

When the agent calls `divide(10, 0)`, the model sees that the tool failed and can try another approach or tell the user.

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

## Complete example

Here is a working agent that can check weather and do math:

```python
from tenxgraph.core.graph import StateGraph, Agent, ToolNode
from tenxgraph.core.state import AgentState, Message
from tenxgraph.utils import END

def get_weather(city: str) -> str:
    """Get the weather for a city."""
    return f"Weather in {city}: 22°C, sunny."

def multiply(a: float, b: float) -> float:
    """Multiply two numbers."""
    return a * b

tool_node = ToolNode([get_weather, multiply])

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
    if last and last.role == "assistant" and last.tools_calls:
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
