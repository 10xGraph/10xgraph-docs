---
title: ReactAgent
seoTitle: "ReactAgent: prebuilt ReAct agent"
description: ReactAgent implements the ReAct pattern, a simple LLM loop that reasons about what to do and acts by calling tools until it reaches a final answer.
section: "Build agents"
group: "Prebuilt agents"
order: 90
label: ReactAgent
updated: "2026-11-26"
faq:
  - q: "Can ReactAgent handle multiple tools efficiently?"
    a: "Yes. ReactAgent automatically runs all tool calls from a single LLM response in parallel, which is much faster than sequential tool execution."
  - q: "Do I need a checkpointer for persistent conversations?"
    a: "Not for development: without one, compile() uses an InMemoryCheckpointer, so a thread keeps its history until the process restarts. For threads that survive restarts, pass a durable checkpointer such as PgCheckpointer to compile()."
---

ReactAgent implements the ReAct (Reason + Act) pattern: an LLM loops through reasoning and tool calls until it decides it has enough information to return a final answer. It is the simplest and most versatile prebuilt agent, handling everything from straightforward tool use to complex multi-step reasoning.

**Import path:** `from tenxgraph.prebuilt.agent import ReactAgent`

**Install:** `pip install "10xgraph[openai]"` (or `[google-genai]`, `[anthropic]` for other providers)

---

## How ReactAgent works

ReactAgent combines two nodes in a simple loop: an LLM node (MAIN) that reasons and decides what to do, and a tool execution node (TOOL) that runs the requested tools and feeds results back to the LLM.

### Graph structure

```mermaid
flowchart LR
    START([START]) --> MAIN
    MAIN["MAIN\n(LLM)"]
    TOOL["TOOL\n(ToolNode)"]
    END_NODE([END])

    MAIN -- "has tool calls?" --> TOOL
    MAIN -- "no tool calls" --> END_NODE
    TOOL -- "append results" --> MAIN
```

The LLM in MAIN sees the full conversation history and decides either to emit one or more tool-call requests or to return a final answer. When tool calls are requested, TOOL executes them in parallel and appends each result as a message. The loop repeats until MAIN produces an answer with no tool calls, at which point the graph exits to END.

To choose between `ReactAgent`, the other prebuilt agents and your own graph, see [Choosing a building block](/docs/concepts/choosing-a-building-block).

## Basic example

The simplest ReactAgent takes a model and optional tools.

```python
import asyncio
from dotenv import load_dotenv
from tenxgraph.prebuilt.agent import ReactAgent
from tenxgraph.core.state import Message

load_dotenv()

def get_weather(city: str) -> str:
    """Return the current weather for a city."""
    return f"Sunny, 24°C in {city}"

# Create the agent
agent = ReactAgent(
    model="gpt-4o-mini",
    tools=[get_weather],
    system_prompt=[{
        "role": "system",
        "content": "You are a helpful assistant. Use the get_weather tool to answer questions about the weather.",
    }],
)

# Compile to a runnable graph
app = agent.compile()

# Run it
async def main():
    result = await app.ainvoke(
        {"messages": [Message.text_message("What is the weather in Paris?")]},
        config={"thread_id": "demo-1"},
    )
    print(result["messages"][-1].text())

asyncio.run(main())
```

**To verify it worked:** the agent should fetch the weather and return a natural response like "The weather in Paris is sunny and 24 degrees Celsius."

---

## Adding persistence with a checkpointer

Without a checkpointer, `compile()` uses an `InMemoryCheckpointer`: a thread keeps its history until the process restarts. For threads that survive restarts, pass a durable checkpointer ([Set up checkpointing](/docs/guides/set-up-checkpointing) lists the backends).

```python
import asyncio
from tenxgraph.prebuilt.agent import ReactAgent
from tenxgraph.storage.checkpointer import PgCheckpointer
from tenxgraph.core.state import Message

# Create a Postgres + Redis checkpointer for durability
# Requires: pip install "10xgraph[pg_checkpoint]"
checkpointer = PgCheckpointer(
    postgres_dsn="postgresql://user:password@localhost/agents_db",
    redis_url="redis://localhost:6379",  # PgCheckpointer needs Redis as well as Postgres
)

def get_weather(city: str) -> str:
    """Return current weather for a city."""
    return f"Weather in {city}: 22°C, partly cloudy."

# Build the agent
agent = ReactAgent(
    model="gpt-4o-mini",
    tools=[get_weather],
)

# Compile with the checkpointer
app = agent.compile(checkpointer=checkpointer)

async def main():
    # First turn: user asks for the weather
    result = await app.ainvoke(
        {"messages": [Message.text_message("What is the weather in Paris?")]},
        config={"thread_id": "user-session-1"},
    )
    print("Turn 1:", result["messages"][-1].text())

    # Second turn: same thread, agent remembers the previous exchange
    result = await app.ainvoke(
        {"messages": [Message.text_message("Now say that in Spanish")]},
        config={"thread_id": "user-session-1"},
    )
    print("Turn 2:", result["messages"][-1].text())

asyncio.run(main())
```

---

## Adding tools

Pass plain functions or `@tool` functions in `tools=`; to use tools from an MCP server, pass its client as `client=`. See [Use the tool decorator](/docs/guides/use-tool-decorator) and [Use MCP](/docs/guides/use-mcp).

## Customization options

### Trimming context for long conversations

If conversations grow large, trim old messages to keep tokens down.

```python
agent = ReactAgent(
    model="gpt-4o-mini",
    tools=[multiply],
    trim_context=True,  # Automatically trim old messages
)
```

See `/docs/guides/use-context-manager` for more control over trimming and summarization.

### Extended reasoning (thinking)

Enable extended reasoning for complex tasks (available on models that support it).

```python
agent = ReactAgent(
    model="gpt-4o",
    tools=[get_weather],
    reasoning_config={"effort": "high"},  # Extended reasoning
)
```

### Retries on LLM errors

ReactAgent retries transient LLM errors by default (`retry_config=True`). Customize retry behavior.

```python
from tenxgraph.core.graph import RetryConfig

agent = ReactAgent(
    model="gpt-4o-mini",
    retry_config=RetryConfig(max_retries=3, initial_delay=1.0, backoff_factor=2.0),
)
```

### Fallback models

Specify a backup model if the primary fails.

```python
agent = ReactAgent(
    model="gpt-4o",
    fallback_models=["gpt-4o-mini"],
    tools=[get_weather],
)
```

### Custom node names

If you need different node names in the graph (for example, to avoid conflicts in a larger system).

```python
agent = ReactAgent(
    model="gpt-4o-mini",
    main_node_name="reason",
    tool_node_name="execute",
)
```

## Compile options

`compile()` takes `checkpointer`, `store`, `interrupt_before`, `interrupt_after`, `callback_manager`, `media_store`, `shutdown_timeout` and `media_policy`. The node names for `interrupt_before` and `interrupt_after` are `MAIN` and `TOOL` unless you renamed them. Every constructor and compile parameter is in the [prebuilt agents reference](/docs/reference/python/prebuilt-agents#reactagent).

## Troubleshooting

**Agent keeps calling tools and never exits:**
Check that your tools are returning meaningful results and your system prompt guides the agent toward a final answer. If needed, lower the `recursion_limit` in the run config (see [Recursion limit](/docs/concepts/errors-and-limits#recursion-limit)).

**Tools are called but results are ignored:**
Ensure your tool is a regular function (the `@tool` decorator is optional) with type hints and a docstring. The tool must return a string or serializable value. See `/docs/guides/use-tool-decorator`.

**Agent forgets previous messages in the conversation:**
Use the same `thread_id` on every call of a conversation. The default `InMemoryCheckpointer` loses threads when the process restarts; pass a durable checkpointer to `compile()` to keep them.

**LLM returns errors about tool schemas:**
Tool schemas are extracted from type hints and docstrings. Ensure all parameters have type hints and the docstring describes what the tool does.

---

## Run it in production

The server turns this agent into an API with streaming, stop and thread routes, and does not need extra code. Add auth, a durable checkpointer passed to `compile()`, and the [production checklist](/docs/server/production-checklist). See [Production readiness](/docs/production).

## Next steps

- Learn to build custom agents: `/docs/guides/build-a-graph`
- Add long-term memory: `/docs/guides/use-memory-store`
- Stream and monitor execution: `/docs/guides/stream-graph`
- Test your agent: `/docs/testing/unit-tests`
- Deploy to production: `/docs/server/run-the-server`
