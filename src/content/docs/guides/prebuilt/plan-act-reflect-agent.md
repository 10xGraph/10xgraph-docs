---
title: PlanActReflectAgent
description: Plan-act-reflect loops add an evaluation phase to prevent incomplete answers, making agents iterate until they finish the task.
section: "Build agents"
group: "Prebuilt agents"
order: 100
label: PlanActReflectAgent
updated: "2026-10-27"
---

PlanActReflectAgent is a self-improving agent that breaks tasks into steps, executes them, then explicitly evaluates whether the work is complete. If not, it iterates. This pattern solves a common problem in agent workflows: standard ReAct loops can get stuck or produce incomplete answers because they lack a clear evaluation step. By adding a dedicated critic that inspects all work and decides whether to continue or stop, this agent achieves higher task completion rates on complex assignments like research, analysis, and planning.

**Import path:** `from tenxgraph.prebuilt.agent import PlanActReflectAgent`

**Install:** `pip install "10xgraph[openai]"` (or `[google-genai]`, `[anthropic]` for other providers)

---

## When to use this agent

PlanActReflectAgent is best for tasks that require iterative refinement or verification. Use it when:

- **The task has multiple steps.** A plan phase ensures coherent structure before executing.
- **Quality verification matters.** The reflect phase catches incomplete or incorrect work before finishing.
- **Tools are optional but helpful.** It works equally well with or without external tools. With tools, the planner calls them when needed; without them, it performs pure reasoning.
- **Iteration is acceptable.** The agent may loop several times (bounded by `max_iterations`). If latency is critical, prefer a simpler agent like `ReactAgent`.
- **You want explicit decision points.** Unlike ReAct, which continues calling tools until it thinks it is done, PlanActReflect always evaluates completion against the full context.

Avoid this agent if you need single-shot responses or if the task is simple enough for a basic agent. For retrieval-heavy workloads, prefer `RAGAgent`. For team-based multi-agent orchestration, use `SwarmAgent` or `SupervisorTeamAgent`.

---

## How it works

The agent runs three specialized LLM instances in sequence: a planner, an actor (tool executor), and a reflector.

### The graph topology

```mermaid
flowchart TD
    START([START]) --> PLAN

    PLAN["PLAN\n(LLM + tools)"]
    ACT["ACT\n(ToolNode)"]
    REFLECT["REFLECT\n(LLM, no tools)"]
    INC["INCREMENT_ITERATIONS"]
    END_NODE([END])

    PLAN -- "has tool calls" --> ACT
    PLAN -- "no tool calls" --> REFLECT
    ACT --> REFLECT
    REFLECT -- "[DONE] or max_iterations reached" --> END_NODE
    REFLECT -- "not done" --> INC
    INC --> PLAN
```

Three separate `Agent` instances execute inside the graph, each with its own system prompt:

| Node | Responsibility | Sees tools? | Output |
|---|---|---|---|
| **PLAN** | Break the task into steps; decide if tools are needed; emit tool calls or text | Yes | Tool calls and/or analysis |
| **ACT** | Run all requested tools in parallel (ToolNode) | n/a | Tool results |
| **REFLECT** | Review the complete work (plan + results); decide if done or if more work is needed | No | Completion signal (`[DONE]`) or guidance for next iteration |

### Routing decisions

**At PLAN:** If the planner emits tool calls, the graph routes to ACT; otherwise it routes directly to REFLECT. This branch lets the agent skip unnecessary tool execution when it can reason toward progress without external data.

**At REFLECT:** Two exit conditions:
1. The reflector's output contains `[DONE]` (case-insensitive): signals successful completion.
2. The iteration counter reaches `max_iterations` for the current turn: hard cap to prevent runaway loops.

If neither condition is met, the counter increments and the graph loops back to PLAN.

### The reflect filter

To prevent long tool outputs from overflowing context, tool result messages (messages with `role="tool"`) are hidden from the reflector. The planner still sees the full context on the next iteration, so information is not lost, only filtered from the critic's view.

### Default system prompts

Each phase has a built-in prompt that can be overridden (paraphrased here; see `DEFAULT_PLAN_SYSTEM_PROMPT` and `DEFAULT_REFLECT_SYSTEM_PROMPT` in `tenxgraph.prebuilt.agent.plan_act_reflect` for the exact text):

**PLAN**, "You are a strategic planner. Break the user's task into clear, actionable steps and make progress toward it. When a step requires external information, call the appropriate tools. When you can make progress without tools, provide your analysis. Be concise."

**REFLECT**, "You are a critical evaluator. Review all work done so far and decide whether the task is fully complete. If complete, provide a concise summary and end with [DONE]. If not complete, identify gaps and give clear guidance for the next planning step."

Both are fully overridable via `plan_system_prompt` and `reflect_system_prompt` parameters.

### No-tools mode

When called without tools, PLAN always routes directly to REFLECT, skipping the ACT node. The agent becomes a pure reasoning loop: plan → reflect → decide → iterate. This is useful for complex multi-step reasoning tasks that do not require external data.

---

## Constructor parameters

Create a PlanActReflectAgent by passing a model and optionally tools and configuration:

```python
agent = PlanActReflectAgent(
    model="gpt-4o-mini",
    provider="openai",
    tools=[google_web_search, fetch_url],
    max_iterations=4,
)
app = agent.compile()
```

**Required parameters:**

| Parameter | Type | Description |
|---|---|---|
| `model` | `str` | LLM model identifier (e.g., `"gpt-4o-mini"`, `"gemini-2.5-flash"`). Used by the planner and reflector (the ACT node is a plain ToolNode). The provider is inferred from the model name or set `provider` explicitly via `agent_kwargs` (e.g., `provider="anthropic"`). |

**Optional parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `tools` | `Iterable[Callable]` | `None` | Callables made available to the planner. If empty or `None`, the agent skips the ACT phase and performs pure reasoning. Tools run in parallel when the planner requests multiple at once. |
| `max_iterations` | `int` | `3` | Maximum plan→act→reflect cycles per turn. Prevents runaway loops. Reaching this limit terminates the graph immediately. The count is per turn (one invoke or stream of a user message): it resets when a new message starts a turn after a completed run or a run that ended in an error, and is kept when a paused or stopped run resumes (interrupt, client tool or stop). |
| `plan_system_prompt` | `list[dict]` | built-in | Override the planner's system message. Pass a list of role/content dicts (e.g., `[{"role": "system", "content": "..."}]`). |
| `reflect_system_prompt` | `list[dict]` | built-in | Override the reflector's system message. Same format as `plan_system_prompt`. |
| `plan_model` | `str` | `None` | Use a different model for the planner (e.g., more capable). Falls back to `model` if not set. |
| `reflect_model` | `str` | `None` | Use a different model for the reflector. Falls back to `model` if not set. |
| `plan_reasoning_config` | `dict \| bool` | `None` | Override extended reasoning (e.g., Claude Thinking, OpenAI o1 reasoning) for the planner only. Overrides the shared `reasoning_config` if set. |
| `reflect_reasoning_config` | `dict \| bool` | `None` | Override extended reasoning for the reflector only. Overrides the shared `reasoning_config` if set. |
| `reasoning_config` | `dict \| bool` | `True` | Enable extended reasoning for all internal agents (applied unless overridden per-phase). |
| `memory` | `MemoryConfig` | `None` | Long-term memory configuration shared by all agents. Enables retrieval and storage of cross-thread context. |
| `retry_config` | `Any` | `True` | Retry policy for LLM calls. Passed to all internal agents. |
| `fallback_models` | `list` | `None` | Backup models if the primary fails (e.g., `["gpt-4-turbo", "gpt-3.5-turbo"]`). |
| `trim_context` | `bool` | `False` | Trim old messages from context when it grows long, keeping recent messages. Helps control token usage on long runs. |
| `client` | `Any` | `None` | FastMCP client instance for MCP-hosted tools. |
| `pass_user_info_to_mcp` | `bool` | `False` | Include user info (user_id, etc.) in MCP tool calls. |
| `extra_messages` | `list[Message]` | `None` | Initial messages added to every run's context (e.g., examples or constraints). |
| `tools_tags` | `set[str]` | `None` | Filter tools by tags; only tools matching these tags are offered. |
| `skills` | `SkillConfig` | `None` | Agent Skills configuration; enables dynamic skill discovery and activation. |
| `multimodal_config` | `MultimodalConfig` | `None` | Multimodal settings for image, audio, and document handling. |
| `**agent_kwargs` | `dict` | - | Extra keyword arguments passed to all inner Agent instances (e.g., `temperature=0.7`, `top_p=0.9`, `provider="anthropic"`). |

---

## compile() parameters

Once you have a PlanActReflectAgent instance, call `.compile()` to create a runnable graph:

```python
app = agent.compile(
    checkpointer=PgCheckpointer(...),
    interrupt_before=["REFLECT"],
)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `checkpointer` | `BaseCheckpointer` | `None` | Persist and restore agent state across runs. With a checkpointer, passing the same `thread_id` in the run config resumes from the last checkpoint. Without one, state is lost after the run ends. |
| `store` | `BaseStore` | `None` | Long-term cross-thread memory storage (Qdrant, Mem0, or custom). Pairs with the `memory` parameter in the constructor to enable retrieval across different conversations. |
| `interrupt_before` | `list[str]` | `None` | Pause before executing the named nodes (e.g., `["REFLECT", "PLAN"]`). Useful for human-in-the-loop workflows. The graph saves the state and can resume with new input. |
| `interrupt_after` | `list[str]` | `None` | Pause after the named nodes complete. Combined with `interrupt_before`, enables fine-grained control over execution. |
| `callback_manager` | `CallbackManager` | default | Attach lifecycle hooks (on_start, on_end, on_error, etc.) to monitor or modify execution. |
| `media_store` | `BaseMediaStore` | `None` | Backend for storing uploaded media files (images, audio, documents). Enables agents to handle multimodal input. |
| `shutdown_timeout` | `float` | `30.0` | Seconds to wait for graceful shutdown during cleanup. |

---

## Examples

### Research task with tools

This example demonstrates the full plan-act-reflect loop on a research task. The agent breaks the task into steps, searches for information, and iterates until it has a complete answer.

```python
import asyncio
from dotenv import load_dotenv
from tenxgraph.prebuilt.agent import PlanActReflectAgent
from tenxgraph.prebuilt.tools import fetch_url, google_web_search
from tenxgraph.core.state import Message

load_dotenv()

def summarize_findings(text: str) -> str:
    """Compress a long text to key points."""
    return text[:2000] + "..." if len(text) > 2000 else text

agent = PlanActReflectAgent(
    model="gpt-4o-mini",
    provider="openai",
    tools=[fetch_url, google_web_search, summarize_findings],
    max_iterations=4,
)

app = agent.compile()

async def main():
    result = await app.ainvoke(
        {"messages": [Message.text_message(
            "Research the current state of fusion energy and write a 3-paragraph summary."
        )]},
        config={"thread_id": "research-1"},
    )
    print(result["messages"][-1].text())

asyncio.run(main())
```

### Custom system prompts

Override the default prompts to steer the agent's behavior. This is useful for domain-specific tasks or when you want precise instructions for planning and evaluation.

```python
from tenxgraph.prebuilt.agent import PlanActReflectAgent
from tenxgraph.prebuilt.tools import fetch_url, google_web_search

agent = PlanActReflectAgent(
    model="gpt-4o",
    provider="openai",
    tools=[fetch_url, google_web_search],
    max_iterations=5,
    plan_system_prompt=[{
        "role": "system",
        "content": "You are a systematic researcher. Break each task into numbered steps.",
    }],
    reflect_system_prompt=[{
        "role": "system",
        "content": (
            "Review the work done. Is the research complete and accurate? "
            "If yes, write a summary and end with [DONE]. "
            "If not, list exactly what is still missing."
        ),
    }],
)
```

### Pure reasoning (no tools)

For complex reasoning tasks that do not require external data, run the agent without tools. The plan phase generates reasoning, then the reflect phase evaluates and iterates if needed.

```python
import asyncio
from tenxgraph.prebuilt.agent import PlanActReflectAgent
from tenxgraph.core.state import Message

agent = PlanActReflectAgent(
    model="gpt-4o-mini",
    provider="openai",
    max_iterations=3,
)

app = agent.compile()

async def main():
    result = await app.ainvoke(
        {"messages": [Message.text_message("Devise three approaches to reduce LLM hallucination.")]},
        config={"thread_id": "reason-1"},
    )
    print(result["messages"][-1].text())

asyncio.run(main())
```

### Persistent conversations with a checkpointer

Add a checkpointer to persist state across runs. Pass the same `thread_id` in the config to resume a conversation or retrieve the previous result.

```python
import asyncio
from tenxgraph.prebuilt.agent import PlanActReflectAgent
from tenxgraph.prebuilt.tools import fetch_url, google_web_search
from tenxgraph.storage.checkpointer import PgCheckpointer
from tenxgraph.core.state import Message

agent = PlanActReflectAgent(
    model="gpt-4o-mini",
    provider="openai",
    tools=[fetch_url, google_web_search],
    max_iterations=4,
)

# Requires: pip install "10xgraph[pg_checkpoint]"
checkpointer = PgCheckpointer(
    postgres_dsn="postgresql://user:pass@localhost/db",
    redis_url="redis://localhost:6379",
)
app = agent.compile(checkpointer=checkpointer)

async def main():
    result = await app.ainvoke(
        {"messages": [Message.text_message("Research recent breakthroughs in solid-state batteries.")]},
        config={"thread_id": "user-42-research"},
    )
    print(result["messages"][-1].text())

asyncio.run(main())
```

### Using Google Gemini

PlanActReflectAgent works with any provider. Here is an example using Gemini with context trimming enabled to manage token usage on long conversations.

```python
from tenxgraph.prebuilt.agent import PlanActReflectAgent
from tenxgraph.prebuilt.tools import google_web_search

agent = PlanActReflectAgent(
    model="gemini-2.5-flash",
    provider="google",
    tools=[google_web_search],
    max_iterations=4,
    trim_context=True,
)

app = agent.compile()
```

Set your `GOOGLE_API_KEY` in the environment before running.

### Streaming events

Stream execution events as they happen instead of waiting for the entire run to complete. Each event is printed as the agent plans, acts, and reflects.

```python
import asyncio
from tenxgraph.prebuilt.agent import PlanActReflectAgent
from tenxgraph.core.state import Message

agent = PlanActReflectAgent(
    model="gpt-4o-mini",
    provider="openai",
    max_iterations=3,
)
app = agent.compile()

async def main():
    async for event in app.astream(
        {"messages": [Message.text_message("Explain the trade-offs between RAG and fine-tuning.")]},
        config={"thread_id": "stream-1"},
    ):
        print(event)

asyncio.run(main())
```

---

## Deploy with the API server and playground

To test your agent interactively or deploy it as a REST API, use the `10xgraph` CLI.

**`graph.py`**, Define your agent:

```python
from tenxgraph.prebuilt.agent import PlanActReflectAgent
from tenxgraph.prebuilt.tools import fetch_url, google_web_search, safe_calculator

agent = PlanActReflectAgent(
    model="gpt-4o-mini",
    provider="openai",
    tools=[fetch_url, google_web_search, safe_calculator],
    max_iterations=4,
)

app = agent.compile()
```

**`10xgraph.json`**, Point the CLI to your agent:

```json
{
  "agent": "graph:app",
  "env": ".env",
  "auth": null,
  "injectq": null,
  "store": null,
  "redis": null,
  "thread_name_generator": null
}
```

**`.env`**, Provide API keys:

```
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=AIza...
```

**Launch the playground** to test interactively:

```bash
10xgraph dev
```

**Launch the API server** to serve the agent over HTTP:

```bash
10xgraph dev --no-open
```

The server opens Swagger docs at `http://localhost:8000/docs` with full route reference.

---

## Customization

### Per-phase model selection

You can use different models for planning and reflection to balance cost and capability:

```python
agent = PlanActReflectAgent(
    model="gpt-4o-mini",  # default
    plan_model="gpt-4o",  # more capable planner
    reflect_model="gpt-4o-mini",  # cheaper reflector
    tools=[...],
)
```

### Extended reasoning for specific phases

Use `plan_reasoning_config` and `reflect_reasoning_config` to enable extended reasoning only where you need it:

```python
agent = PlanActReflectAgent(
    model="gpt-4o",
    plan_reasoning_config={"effort": "high"},  # Enable thinking for planning
    reflect_reasoning_config=False,  # Skip for reflection to save tokens
    tools=[...],
)
```

### Filter tools by tags

If you have a large set of tools, use tags to offer only a subset to the planner:

```python
agent = PlanActReflectAgent(
    model="gpt-4o-mini",
    tools=[search_tool, fetch_tool, database_query_tool],
    tools_tags={"web", "research"},  # Only offer tools tagged with these
)
```

### Human-in-the-loop approval

Pause before the REFLECT node so a human can review the planner's proposed actions before evaluation:

```python
app = agent.compile(interrupt_before=["REFLECT"])

# Run interactively
result = await app.ainvoke(
    {"messages": [Message.text_message("Research X")]},
    config={"thread_id": "t1"},
)
print(f"Plan state: {result['messages']}")

# Optionally add feedback, then resume
result = await app.ainvoke(
    {"messages": [Message.text_message("Also check Y")]},
    config={"thread_id": "t1"},
)
```

---

## Run it in production

`max_iterations` counts one turn and resets when the next turn starts, so cost per request stays bounded on a long-lived thread. Serve it with a durable checkpointer passed to `compile()`. See [Errors and limits](/docs/concepts/errors-and-limits) and [Scaling and reliability](/docs/production/scaling).

## See also

- **Full reference:** `/docs/reference/python/prebuilt-agents`: comprehensive parameter tables.
- **Other prebuilt agents:** `/docs/guides/prebuilt-agents`: ReactAgent, RAGAgent, SwarmAgent, and more.
- **Checkpointing:** `/docs/guides/set-up-checkpointing`: persist state and resume conversations.
- **Tools:** `/docs/guides/use-tool-decorator`: define custom tools for your agent.
- **Streaming:** `/docs/guides/stream-graph`: handle partial results and token-by-token output.
