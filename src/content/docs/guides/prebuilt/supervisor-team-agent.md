---
title: SupervisorTeamAgent
description: Route tasks from a supervisor LLM to specialized worker agents, each independently configured with their own model and tools.
section: "Build agents"
group: "Prebuilt agents"
order: 120
label: SupervisorTeamAgent
updated: "2026-10-27"
faq:
  - q: When should I use SupervisorTeamAgent instead of SwarmAgent?
    a: Use SupervisorTeamAgent when you need centralized control and explicit routing logic. Use SwarmAgent when workers should hand off to each other directly. SupervisorTeamAgent is simpler when the coordinator should make all delegating decisions.
  - q: Can workers use different LLM models?
    a: Yes. Each worker is an independent Agent, so you can configure different models, tools, memory, and retry strategies per worker. The supervisor can use yet another model.
  - q: What happens if the supervisor response doesn't match a worker name?
    a: The routing function logs a warning and terminates the conversation. If this happens frequently, improve the supervisor prompt with clearer descriptions of workers, or override it entirely with supervisor_system_prompt.
---

SupervisorTeamAgent implements a centralized orchestration pattern where a single supervisor LLM makes all routing decisions between specialist worker agents. Each worker is a fully independent Agent configured with its own model, tools, and system prompt. The supervisor's only output is the name of the next worker to invoke or FINISH when the task is complete.

**Import path:** `tenxgraph.prebuilt.agent`

---

## When to use this pattern

SupervisorTeamAgent is best for workflows where a central coordinator must make informed routing decisions between specialists. It suits scenarios where task planning and handoff decisions matter more than individual worker initiative. Use this when:

- You need explicit control over which specialist handles each subtask.
- The supervisor benefits from seeing all previous work before delegating again.
- Workers should not hand off directly to each other (a pure supervisor-to-worker pattern).
- You want a single LLM to manage the overall flow and strategy.

If workers should negotiate and hand off to each other directly, use `/docs/guides/prebuilt/swarm-agent` instead. If you need a simpler loop where one agent acts with tools, use `/docs/guides/prebuilt/react-agent`.

---

## How the graph works

The pattern consists of five node types:

**SUPERVISOR** - An LLM that analyzes the conversation and outputs exactly one word: a worker name or FINISH. Its system prompt is auto-generated from the worker registry (or you can override it). Routing responses are never streamed to the caller.

**PRE_SUPERVISOR** - A lightweight state manager that increments the round counter before returning control to the supervisor. This keeps the hard-cap check decoupled from worker logic.

**WORKER nodes** - Each worker is a pre-built Agent node. When a worker finishes generating text, it returns to PRE_SUPERVISOR.

**WORKER_TOOL nodes** - When a worker emits tool calls, those calls route to a ToolNode, then back to the worker for reflection. Each worker gets its own mini ReAct loop.

**END** - The conversation terminates when the supervisor outputs FINISH or when max_rounds is reached.

### Visual example (two-worker team)

```mermaid
flowchart TD
    START([START]) --> SUPERVISOR

    SUPERVISOR["SUPERVISOR\n(LLM, outputs one word)"]
    PRE_SUPERVISOR["PRE_SUPERVISOR\n(increment rounds)"]
    RESEARCHER["RESEARCHER\n(LLM + tools)"]
    RESEARCHER_TOOL["RESEARCHER_TOOL\n(ToolNode)"]
    CODER["CODER\n(LLM + tools)"]
    CODER_TOOL["CODER_TOOL\n(ToolNode)"]
    END_NODE([END])

    SUPERVISOR -- "RESEARCHER" --> RESEARCHER
    SUPERVISOR -- "CODER" --> CODER
    SUPERVISOR -- "FINISH or max_rounds" --> END_NODE

    RESEARCHER -- "regular tool call" --> RESEARCHER_TOOL
    RESEARCHER -- "done" --> PRE_SUPERVISOR
    RESEARCHER_TOOL --> RESEARCHER

    CODER -- "regular tool call" --> CODER_TOOL
    CODER -- "done" --> PRE_SUPERVISOR
    CODER_TOOL --> CODER

    PRE_SUPERVISOR --> SUPERVISOR
```

### Worker without tools

A worker that does not need tools skips the tool loop. Its output goes directly back to PRE_SUPERVISOR:

```mermaid
flowchart LR
    SUPERVISOR["SUPERVISOR"] -- "WRITER" --> WRITER["WRITER\n(LLM, no tools)"]
    WRITER --> PRE_SUPERVISOR["PRE_SUPERVISOR"] --> SUPERVISOR
    SUPERVISOR -- "FINISH" --> END_NODE([END])
```

---

## Auto-generated supervisor prompt

By default, `SupervisorTeamAgent` builds the supervisor's system prompt from the worker registry and their descriptions. You do not need to write this prompt yourself:

```
You are a supervisor agent that coordinates a team of specialist workers to complete tasks assigned by the user.

Available workers:
- RESEARCHER: Searches the web for factual information.
- CODER: Writes and runs Python code.
- FINISH: All tasks are fully completed and no further delegation is needed.

Based on the conversation so far, respond with **only** the name of the next worker to invoke, or FINISH if the task is complete.

Rules:
- Respond with a single word, exactly one worker name or FINISH.
- Do NOT explain your choice.
- Do NOT include any other text.
```

Each worker's description comes from the `description` field in its `WorkerConfig`. If you want full control over the prompt, pass `supervisor_system_prompt` to override it entirely.

---

## Constructor parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `supervisor_model` | `str` | required | LLM model for the supervisor agent (e.g. `"gpt-4o"`, `"gemini-2.5-flash"`) |
| `workers` | `dict[str, WorkerConfig]` | required | Worker registry mapping worker names (UPPER-CASE recommended) to their configs |
| `supervisor_system_prompt` | `list[dict] \| None` | auto-generated | Custom supervisor system prompt; if None, built from worker descriptions |
| `max_rounds` | `int` | `10` | Hard cap on supervisor→worker delegations per turn before terminating. The count is per turn (one invoke or stream of a user message): it resets when a new message starts a turn after a completed run or a run that ended in an error, and is kept when a paused or stopped run resumes (interrupt, client tool or stop). |
| `state` | `AgentState \| None` | `None` | Optional custom state class for the entire graph |
| `context_manager` | `BaseContextManager \| None` | `None` | Optional custom context manager (e.g. trimming, summarization) |
| `publisher` | `BasePublisher \| list[BasePublisher] \| None` | `None` | Event publisher for streaming events to external systems |
| `id_generator` | `BaseIDGenerator` | `DefaultIDGenerator()` | ID generation strategy |
| `container` | `InjectQ \| None` | `None` | Dependency injection container for tool and node execution |
| `**supervisor_kwargs` | `Any` | - | Extra arguments forwarded to the supervisor Agent only (e.g. `provider="openai"`, `temperature=0.7`) |

## `compile()` parameters

The `compile()` method wires the graph and returns a `CompiledGraph` ready to invoke. Parameters:

| Parameter | Type | Default | Description |
|---|---|---|---|
| `checkpointer` | `BaseCheckpointer` | `None` | Persistence backend for state snapshots and resumption. `None` uses an `InMemoryCheckpointer` |
| `store` | `BaseStore` | `None` | Long-term cross-thread key-value storage |
| `interrupt_before` | `list[str]` | `None` | Pause execution before these node names |
| `interrupt_after` | `list[str]` | `None` | Pause execution after these node names |
| `callback_manager` | `CallbackManager` | default | Lifecycle hooks and invoke callbacks |
| `media_store` | `BaseMediaStore` | `None` | Storage backend for media files and references |
| `shutdown_timeout` | `float` | `30.0` | Seconds to wait for graceful shutdown |

---

## Complete example: research and coding team

This example creates a two-worker team: a researcher who can search the web and a coder who can run Python. The supervisor decides which worker should handle each part of the task.

```python
import asyncio
from dotenv import load_dotenv
from tenxgraph.core.graph import Agent, ToolNode
from tenxgraph.prebuilt.agent import SupervisorTeamAgent
from tenxgraph.prebuilt.agent.supervisor_team import WorkerConfig
from tenxgraph.prebuilt.tools import google_web_search
from tenxgraph.core.state import Message

load_dotenv()

def run_python(code: str) -> str:
    """Execute Python code and return stdout (use a real sandbox in production)."""
    import io, contextlib
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        exec(code, {})  # noqa: S102
    return buf.getvalue()

agent = SupervisorTeamAgent(
    supervisor_model="gpt-4o",
    provider="openai",
    workers={
        "RESEARCHER": WorkerConfig(
            agent=Agent(
                model="gpt-4o-mini",
                provider="openai",
                tool_node=ToolNode([google_web_search]),
                system_prompt=[{
                    "role": "system",
                    "content": "Search the web and return factual results."
                }],
            ),
            description="Searches the web and returns factual information.",
        ),
        "CODER": WorkerConfig(
            agent=Agent(
                model="gpt-4o",
                provider="openai",
                tool_node=ToolNode([run_python]),
                system_prompt=[{
                    "role": "system",
                    "content": "Write and run Python code to solve problems."
                }],
            ),
            description="Writes and executes Python code to solve computational problems.",
        ),
    },
    max_rounds=8,
)

app = agent.compile()

async def main():
    result = await app.ainvoke(
        {"messages": [Message.text_message(
            "Find the current price of Bitcoin, then calculate how much $1000 "
            "would be worth if BTC doubles."
        )]},
        config={"thread_id": "supervisor-1"},
    )
    print("Final output:", result["messages"][-1].text())

asyncio.run(main())
```

Install the extras the example uses and run it with your OpenAI and Google API keys set in the environment:

```bash
pip install "10xgraph[openai,google-genai]"
python supervisor_team_example.py
```

---

## Customization

### Override the supervisor prompt

By default, the supervisor prompt is built automatically. To enforce a specific routing policy or add constraints, override it:

```python
from tenxgraph.core.graph import Agent, ToolNode
from tenxgraph.prebuilt.agent import SupervisorTeamAgent
from tenxgraph.prebuilt.agent.supervisor_team import WorkerConfig
from tenxgraph.prebuilt.tools import google_web_search


def run_python(code: str) -> str:
    """Execute Python code (use a real sandbox in production)."""
    ...


agent = SupervisorTeamAgent(
    supervisor_model="gpt-4o",
    provider="openai",
    workers={
        "RESEARCHER": WorkerConfig(
            agent=Agent(model="gpt-4o-mini", provider="openai", tool_node=ToolNode([google_web_search])),
            description="Searches the web for facts.",
        ),
        "CODER": WorkerConfig(
            agent=Agent(model="gpt-4o", provider="openai", tool_node=ToolNode([run_python])),
            description="Writes and runs code.",
        ),
    },
    supervisor_system_prompt=[{
        "role": "system",
        "content": (
            "You manage a RESEARCHER and CODER. "
            "Always research first to gather facts, then delegate to CODER only if computation is needed. "
            "Respond with only one word: RESEARCHER, CODER, or FINISH."
        ),
    }],
    max_rounds=6,
)
```

### Add persistent memory with a checkpointer

Use a checkpointer to save and restore conversation state across runs. This lets users continue multi-turn conversations:

```python
import asyncio
from tenxgraph.core.graph import Agent, ToolNode
from tenxgraph.prebuilt.agent import SupervisorTeamAgent
from tenxgraph.prebuilt.agent.supervisor_team import WorkerConfig
from tenxgraph.storage.checkpointer import PgCheckpointer
from tenxgraph.prebuilt.tools import google_web_search, safe_calculator
from tenxgraph.core.state import Message

agent = SupervisorTeamAgent(
    supervisor_model="gpt-4o-mini",
    provider="openai",
    workers={
        "RESEARCHER": WorkerConfig(
            agent=Agent(
                model="gpt-4o-mini",
                provider="openai",
                tool_node=ToolNode([google_web_search]),
            ),
            description="Searches the web for facts.",
        ),
        "CALCULATOR": WorkerConfig(
            agent=Agent(
                model="gpt-4o-mini",
                provider="openai",
                tool_node=ToolNode([safe_calculator]),
            ),
            description="Performs arithmetic and numeric calculations.",
        ),
    },
    max_rounds=6,
)

# Compile with Postgres + Redis for production
checkpointer = PgCheckpointer(
    postgres_dsn="postgresql://user:pass@localhost/db",
    redis_url="redis://localhost:6379",
)
app = agent.compile(checkpointer=checkpointer)

async def main():
    # First invocation
    result = await app.ainvoke(
        {"messages": [Message.text_message(
            "What is the compound interest on $5000 at 7% over 10 years?"
        )]},
        config={"thread_id": "user-10-finance", "user_id": "user-10"},
    )
    print("Result:", result["messages"][-1].text())
    
    # Second invocation on same thread, state is restored
    result2 = await app.ainvoke(
        {"messages": [Message.text_message(
            "Now calculate the difference if the rate was 8% instead."
        )]},
        config={"thread_id": "user-10-finance", "user_id": "user-10"},
    )
    print("Follow-up:", result2["messages"][-1].text())

asyncio.run(main())
```

See `/docs/guides/set-up-checkpointing` for setup options (InMemory, SQLite, PgCheckpointer).

### Mix different LLM providers

The supervisor and workers are independent Agents, so they can use different providers. Use `**supervisor_kwargs` to configure only the supervisor:

```python
from tenxgraph.core.graph import Agent, ToolNode
from tenxgraph.prebuilt.agent import SupervisorTeamAgent
from tenxgraph.prebuilt.agent.supervisor_team import WorkerConfig
from tenxgraph.prebuilt.tools import google_web_search

# Supervisor uses Google Gemini
agent = SupervisorTeamAgent(
    supervisor_model="gemini-2.5-flash",
    provider="google",  # applies only to supervisor
    workers={
        "RESEARCHER": WorkerConfig(
            agent=Agent(
                model="gpt-4o-mini",
                provider="openai",  # workers use OpenAI
                tool_node=ToolNode([google_web_search]),
            ),
            description="Researches topics on the web.",
        ),
    },
    max_rounds=5,
)
```

---

## Deployment: running with the API server

To serve a SupervisorTeamAgent over HTTP, create a graph module and configuration file:

**`graph.py`**

```python
from tenxgraph.core.graph import Agent, ToolNode
from tenxgraph.prebuilt.agent import SupervisorTeamAgent
from tenxgraph.prebuilt.agent.supervisor_team import WorkerConfig
from tenxgraph.prebuilt.tools import google_web_search, safe_calculator

app = SupervisorTeamAgent(
    supervisor_model="gpt-4o-mini",
    provider="openai",
    workers={
        "RESEARCHER": WorkerConfig(
            agent=Agent(
                model="gpt-4o-mini",
                provider="openai",
                tool_node=ToolNode([google_web_search]),
            ),
            description="Searches the web for facts.",
        ),
        "CALCULATOR": WorkerConfig(
            agent=Agent(
                model="gpt-4o-mini",
                provider="openai",
                tool_node=ToolNode([safe_calculator]),
            ),
            description="Performs arithmetic and numeric calculations.",
        ),
    },
    max_rounds=6,
).compile()
```

**`10xgraph.json`**

```json
{
  "agent": "graph:app",
  "env": ".env",
  "auth": null
}
```

Start the server:

```bash
10xgraph dev --no-open
```

Then invoke it:

```bash
curl -X POST http://localhost:8000/v1/graph/invoke \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": [{"type": "text", "text": "Research AI trends and calculate the growth rate."}]}],
    "config": {"thread_id": "team-1"}
  }'
```

Or start the interactive playground:

```bash
10xgraph dev
```

---

## How routing works

The supervisor routing function uses word-boundary regex to match worker names, preventing partial matches. For example, if you have workers named `CODE` and `CODER`, a supervisor response containing `CODER` will match `CODER`, not `CODE`. If the supervisor response does not contain any recognized worker name or FINISH, the conversation terminates and a warning is logged.

The round counter lives in `execution_meta.internal_data["sta_rounds"]` and increments before each supervisor call. The counter is per turn and resets when a new message arrives after a completed run or a run that ended in an error. When `max_rounds` is reached, the supervisor is bypassed and the graph terminates immediately.

---

## Parameters reference

For the complete reference of constructor and compile parameters, see `/docs/reference/python/prebuilt-agents`.

---

## Compare with other patterns

- **ReactAgent**: A single agent with tools. Use when one model can handle the task with tool loops.
- **SwarmAgent**: Workers hand off to each other directly. Use when workers are peers and should negotiate.
- **SupervisorTeamAgent**: Central coordinator routes to specialists. Use when one LLM should make all routing decisions.

See `/docs/concepts/choosing-a-building-block` for a detailed decision guide.

## Run it in production

`max_rounds` counts one turn and resets on the next, which bounds the model calls one request can trigger. Serve it with a durable checkpointer passed to `compile()` and a rate limit. See [Rate limiting](/docs/server/rate-limiting) and [Scaling and reliability](/docs/production/scaling).
