---
title: ReactAgent
seoTitle: "ReactAgent: prebuilt ReAct agent"
description: ReactAgent implements the ReAct pattern, a simple LLM loop that reasons about what to do and acts by calling tools until it reaches a final answer.
section: "Build agents"
group: "Prebuilt agents"
order: 90
label: ReactAgent
updated: "2026-10-27"
faq:
  - q: "When should I use ReactAgent instead of building a custom graph?"
    a: "ReactAgent is ideal for most agent use cases: tool use, multi-turn conversations, and simple reasoning loops. Use a custom graph when you need specialized routing logic, multiple LLM nodes, or a structure that does not fit the single-LLM-plus-tools pattern."
  - q: "Can ReactAgent handle multiple tools efficiently?"
    a: "Yes. ReactAgent automatically runs all tool calls from a single LLM response in parallel, which is much faster than sequential tool execution."
  - q: "Do I need a checkpointer for persistent conversations?"
    a: "No, but without one the agent is stateless. Pass a checkpointer to compile() and use the same thread_id across invocations to enable multi-turn conversations that remember previous exchanges."
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

### The ReAct loop in detail

Each iteration follows this cycle.

1. **Reason:** MAIN receives the conversation state and generates either a final response or one or more tool-call requests.
2. **Act:** If tool calls are present, TOOL runs all of them concurrently and appends the results as tool-role messages.
3. **Observe:** The loop returns to step 1 with the new messages added to state.
4. **Exit:** When MAIN produces a response with no tool calls, the agent exits.

There is no step counter, maximum-thought budget, or other external control. The LLM itself decides when it has enough information, making the pattern transparent and easy to debug.

### Without tools

If you create a ReactAgent with no tools, it becomes a single LLM node that generates a response and exits immediately. This is still useful for stateless LLM interactions with optional per-call tools.

### Parallel tool execution

When the LLM requests multiple tools in one response, ReactAgent runs them all at the same time. This is much faster than running them one by one, especially when the tools are independent (e.g., fetching weather from multiple cities, querying different databases).

### Multi-turn conversations

ReactAgent itself is stateless. To support persistent conversations across multiple invocations, pass a checkpointer to `compile()` and use the same `thread_id` in your config. The checkpointer stores the conversation state after each turn, so the next invocation picks up exactly where the previous one left off.

---

## When to use ReactAgent

Use ReactAgent when your task fits this pattern:

- The agent needs to call tools and observe their results.
- The agent reasons iteratively until it has an answer (no need for a fixed plan ahead of time).
- You want fast, simple, transparent execution (no need for internal intermediate representations).
- The agent makes decisions using a single LLM at each step.

Do NOT use ReactAgent for:

- **Multi-step planning with an explicit plan node**: use `/docs/guides/prebuilt/plan-act-reflect-agent` instead.
- **Handing off between multiple specialized agents**: use `/docs/guides/prebuilt/swarm-agent` or `/docs/guides/prebuilt/supervisor-team-agent`.
- **Retrieval-augmented generation with explicit retrieval steps**: use `/docs/guides/prebuilt/rag-agent` (which retrieves documents before the wrapped agent answers).
- **Complex custom routing logic**: build a custom graph with `/docs/guides/build-a-graph`.

---

## Prerequisites

- Python 3.12 or later.
- One LLM provider SDK: `pip install "10xgraph[openai]"`, `"10xgraph[google-genai]"`, or `"10xgraph[anthropic]"`.
- API key for your chosen provider in the environment (e.g., `OPENAI_API_KEY`).
- Optional: `pip install "10xgraph[pg_checkpoint]"` for persistent conversation state in production.

---

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

By default, each invocation is independent. To support multi-turn conversations, add a checkpointer.

```python
import asyncio
from tenxgraph.prebuilt.agent import ReactAgent
from tenxgraph.prebuilt.tools import fetch_url
from tenxgraph.storage.checkpointer import PgCheckpointer
from tenxgraph.core.state import Message

# Create a Postgres + Redis checkpointer for durability
# Requires: pip install "10xgraph[pg_checkpoint]"
checkpointer = PgCheckpointer(
    postgres_dsn="postgresql://user:password@localhost/agents_db",
    redis_url="redis://localhost:6379",  # PgCheckpointer needs Redis as well as Postgres
)

# Build the agent
agent = ReactAgent(
    model="gpt-4o-mini",
    tools=[fetch_url],
)

# Compile with the checkpointer
app = agent.compile(checkpointer=checkpointer)

async def main():
    # First turn: user asks the agent to fetch a page
    result = await app.ainvoke(
        {"messages": [Message.text_message("Fetch https://example.com and summarize the title")]},
        config={"thread_id": "user-session-1"},
    )
    print("Turn 1:", result["messages"][-1].text())

    # Second turn: same thread, agent remembers the previous exchange
    result = await app.ainvoke(
        {"messages": [Message.text_message("Now translate that summary to Spanish")]},
        config={"thread_id": "user-session-1"},
    )
    print("Turn 2:", result["messages"][-1].text())

asyncio.run(main())
```

**How it works:** the checkpointer saves the conversation state (all messages and agent state) after each invocation. When you call the same thread again, the agent resumes with the full history and can refer to previous turns.

---

## Using prebuilt tools

Instead of writing tools from scratch, you can use the prebuilt tool library.

```python
from tenxgraph.prebuilt.agent import ReactAgent
from tenxgraph.prebuilt.tools import fetch_url, safe_calculator, google_web_search

agent = ReactAgent(
    model="gpt-4o-mini",
    tools=[fetch_url, safe_calculator, google_web_search],
    system_prompt=[{
        "role": "system",
        "content": "You are a helpful assistant with web search and calculator tools.",
    }],
)

app = agent.compile()
```

See `/docs/guides/prebuilt-tools` for the full catalog.

---

## Streaming responses

For real-time feedback, stream events from the agent.

```python
import asyncio
from tenxgraph.prebuilt.agent import ReactAgent
from tenxgraph.core.state import Message

agent = ReactAgent(model="gpt-4o-mini")
app = agent.compile()

async def main():
    async for event in app.astream(
        {"messages": [Message.text_message("Explain the ReAct pattern")]},
        config={"thread_id": "stream-1"},
    ):
        print(event)

asyncio.run(main())
```

Each event represents a step: an LLM call, a tool execution, or a state update. See `/docs/guides/stream-graph` for interpreting stream events.

---

## Customization options

### Custom system prompts

Control the agent's behavior with a detailed system prompt.

```python
agent = ReactAgent(
    model="gpt-4o-mini",
    tools=[fetch_url],
    system_prompt=[{
        "role": "system",
        "content": (
            "You are an expert researcher. "
            "Always verify information by fetching primary sources. "
            "Cite your sources in the final answer."
        ),
    }],
)
```

### Trimming context for long conversations

If conversations grow large, trim old messages to keep tokens down.

```python
agent = ReactAgent(
    model="gpt-4o-mini",
    tools=[safe_calculator],
    trim_context=True,  # Automatically trim old messages
)
```

See `/docs/guides/use-context-manager` for more control over trimming and summarization.

### Extended reasoning (thinking)

Enable extended reasoning for complex tasks (available on models that support it).

```python
agent = ReactAgent(
    model="gpt-4o",
    tools=[fetch_url],
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
    fallback_models=["gpt-4o-mini", "gpt-3.5-turbo"],
    tools=[fetch_url],
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

---

## Compile options

When you call `.compile()`, you can pass additional options.

```python
agent = ReactAgent(model="gpt-4o-mini", tools=[fetch_url])

app = agent.compile(
    checkpointer=checkpointer,  # For persistence
    store=memory_store,  # For long-term memory across threads
    interrupt_before=["TOOL"],  # Pause before the TOOL node
    interrupt_after=["MAIN"],  # Pause after the MAIN node
    media_store=media_storage,  # For file and image storage
    shutdown_timeout=30.0,  # Seconds to wait for graceful shutdown
)
```

See `/docs/concepts/interrupts` for human-in-the-loop patterns.

---

## Full parameters reference

For a complete list of constructor and compile parameters, see `/docs/reference/python/prebuilt-agents`.

---

## Running in the playground

To test your agent interactively, use the playground.

**`graph.py`**

```python title="graph.py"
from tenxgraph.prebuilt.agent import ReactAgent
from tenxgraph.prebuilt.tools import fetch_url, safe_calculator, google_web_search

agent = ReactAgent(
    model="gpt-4o-mini",
    tools=[fetch_url, safe_calculator, google_web_search],
)

app = agent.compile()
```

**`10xgraph.json`**

```json title="10xgraph.json"
{
  "agent": "graph:app",
  "env": ".env"
}
```

**`.env`**

```text title=".env"
OPENAI_API_KEY=sk-...
```

**Launch the playground:**

```bash
10xgraph dev
```

This starts the API server on `localhost:8000` and opens an interactive web UI where you can send messages to your agent and inspect the execution in real time.

---

## Common patterns

### Checking if the agent called a tool

You can inspect the execution to see which tools were called.

```python
result = await app.ainvoke(
    {"messages": [Message.text_message("What is 2 + 2?")]},
    config={"thread_id": "test-1"},
)

for msg in result["messages"]:
    if msg.role == "assistant" and msg.tools_calls:
        print(f"Tool calls: {[tc['function']['name'] for tc in msg.tools_calls]}")
```

### Handling tool errors gracefully

If a tool fails, the agent sees the error and can retry or adapt. You can also handle errors in custom tools.

```python
def safe_divide(a: float, b: float) -> str:
    """Safely divide two numbers."""
    if b == 0:
        return "Error: division by zero"
    return str(a / b)

agent = ReactAgent(
    model="gpt-4o-mini",
    tools=[safe_divide],
)
```

### Using dependency injection

Pass application context (user ID, database, config) to tools without passing it through the message.

```python
from injectq import Inject
from tenxgraph.utils import tool

class Database:
    def query(self, user_id: str):
        ...  # return an object with .name and .email

@tool
def fetch_user_data(user_id: str, db: Inject[Database]) -> str:
    """Fetch user information."""
    user = db.query(user_id)
    return f"User: {user.name}, Email: {user.email}"

agent = ReactAgent(
    model="gpt-4o-mini",
    tools=[fetch_user_data],
)
```

See `/docs/guides/use-dependency-injection` for full details.

---

## Comparison with other agents

| Agent | Loop | Best for |
|---|---|---|
| **ReactAgent** | LLM → tools → LLM | Simple tool use, iterative reasoning |
| PlanActReflect | Plan → act (tools) → reflect → loop | Complex multi-step tasks with reflection |
| RAG | Retrieve → (rerank) → synthesize | Document search and question answering |
| Swarm | Agent → agent handoff | Multiple specialized agents working together |
| SupervisorTeam | Supervisor → worker agents | Teams with a coordinator |

---

## Troubleshooting

**Agent keeps calling tools and never exits:**
Check that your tools are returning meaningful results and your system prompt guides the agent toward a final answer. If needed, lower the `recursion_limit` in the run config (see `/docs/concepts/errors-and-limits`).

**Tools are called but results are ignored:**
Ensure your tool is a regular function (the `@tool` decorator is optional) with type hints and a docstring. The tool must return a string or serializable value. See `/docs/guides/use-tool-decorator`.

**Agent forgets previous messages in the conversation:**
You must pass a checkpointer to `compile()` and use the same `thread_id` across invocations. Without persistence, each call is independent.

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
