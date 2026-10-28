---
title: SwarmAgent
seoTitle: "SwarmAgent: peer-to-peer agent handoffs"
description: SwarmAgent enables peer-to-peer multi-agent coordination where any member can hand off to any other member, with no bottleneck at a central supervisor.
section: "Build agents"
group: "Prebuilt agents"
order: 110
label: SwarmAgent
updated: "2026-10-27"
---

SwarmAgent implements a peer-to-peer multi-agent pattern where any agent can hand off control directly to any other agent. Unlike supervisor-based architectures with a single coordinator routing all work, swarms distribute decision-making across members. This produces flexible, decentralized workflows with no central bottleneck, each member acts independently and delegates when it determines another member is better suited for the task.

**Import path:** `tenxgraph.prebuilt.agent`

---

## When to use SwarmAgent

SwarmAgent shines when agents must coordinate flexibly without a predetermined routing hierarchy. Choose it when:

- **Agents negotiate handoffs.** Members decide when another member is better suited, rather than waiting for a supervisor's decision. A researcher can hand off to an analyst when facts are gathered; an analyst can hand off to a writer when analysis is done.
- **No single coordinator.** The workflow has no natural "decision-maker." Research, analysis, and writing are peers with equal authority.
- **Members may loop.** An agent can hand off to a colleague, work on later stages, and potentially receive control back from another member in a future turn.
- **Decentralized resilience.** If one member fails, others are not blocked waiting for a supervisor's reroute decision.

Avoid SwarmAgent when:

- **One agent always coordinates.** If a triage agent always makes routing decisions, use `SupervisorTeamAgent` instead, it is more explicit about the hierarchy and easier to reason about.
- **Fixed stage pipeline.** If workflow stages are: research → analysis → writing, with no variation, a custom graph with explicit edges is simpler and more maintainable.
- **LLM token overhead.** Every member's system prompt must list handoff targets. For very large teams (20+ members), this scales poorly.

## How SwarmAgent works

Each member is a fully independent agent, a pre-built `Agent` instance with its own model, tools, memory, and skills. SwarmAgent wires them together with automatic handoff tools (`transfer_to_<member_name>`) that any member can call.

### Full graph, three-member example

```mermaid
flowchart TD
    START([START]) --> TRIAGE

    TRIAGE["TRIAGE\n(LLM)"]
    RESEARCHER["RESEARCHER\n(LLM + tools)"]
    RESEARCHER_TOOL["RESEARCHER_TOOL\n(ToolNode)"]
    WRITER["WRITER\n(LLM)"]
    END_NODE([END])

    TRIAGE -- "transfer_to_researcher" --> RESEARCHER
    TRIAGE -- "transfer_to_writer" --> WRITER
    TRIAGE -- "no handoff" --> END_NODE

    RESEARCHER -- "transfer_to_writer" --> WRITER
    RESEARCHER -- "regular tool call" --> RESEARCHER_TOOL
    RESEARCHER -- "no tool calls" --> END_NODE
    RESEARCHER_TOOL --> RESEARCHER

    WRITER -- "no handoff" --> END_NODE
```

### Routing logic: three-step priority

After each member's LLM call, a routing function inspects the last message for tool calls and decides what happens next. The decision tree is simple:

1. **Handoff tool call detected** (`transfer_to_<member_name>`): Route to that member immediately, but only if the target is allowed by `can_handoff_to`. The handoff tool body is never executed; the routing function reads the call and navigates to the target. SwarmAgent registers handoff tools only for allowed targets, so a call to any other `transfer_to_*` name is an ordinary unknown tool call: it is not routed, and the member's tool node, if it has one, answers "Tool not found".
2. **Regular tool call detected**: If the member has tools (like web search or calculator), route to the member's `MEMBER_TOOL` node to execute those tools. The member loops back and tries again.
3. **No tool calls detected**: The member finished its work. Route to `END` to complete the run.

```python
# Simplified from tenxgraph/prebuilt/agent/swarm.py
for tc in last_message.tools_calls:
    is_handoff, target = is_handoff_tool(tool_call_name(tc))  # "transfer_to_researcher"
    if is_handoff and target and target.upper() in allowed_set:
        return target.upper()                                  # route to that member

if tool_node_name is not None:
    return tool_node_name                                      # execute the member's tools

return END                                                     # done
```

This ensures:
- Handoff decisions are made by the LLM inside each member, not by a central coordinator.
- Regular tools run in their own loop per member, giving each a "mini ReAct" phase.
- The flow is deterministic and inspectable: you can see exactly why a member handed off by reading the tool call.

### Handoff tools injected automatically

SwarmAgent generates `transfer_to_<member_name>` (lowercase member name) tools for each member's allowed targets and injects them into the member's `ToolNode`. These are made with `create_handoff_tool`. They are not executed as tools; when the LLM calls one, the routing logic intercepts the call and navigates the graph directly to the target member. This prevents spurious `tool` role messages in the conversation history, the handoff is clean, and the next member sees a natural continuation of the conversation.

Each handoff tool's docstring includes the target member's `description` field, so the LLM understands when and why to route there. For example, if RESEARCHER has `description="Gathers facts from the web"`, the handoff tool is named `transfer_to_researcher`, takes no arguments, and carries "Gathers facts from the web" as its description.

### Member tool loops

A member with regular tools (like web search or calculations) gets a dedicated `<NAME>_TOOL` node. After the member's LLM call, if a regular tool is requested, the graph routes to `<NAME>_TOOL`, executes the tool, and loops back to the member. This gives each member a mini-ReAct loop: call tools, see results, decide whether to call more tools or hand off.

A member without tools (pure LLM decision-making) skips the tool node and routes directly to handoff targets or END.

### Controlling handoff targets with `can_handoff_to`

| Setting | Behavior |
|---|---|
| `None` (default) | Member can hand off to all other members |
| `["A", "B"]` | Member can hand off only to A and B (case-insensitive; normalized to uppercase) |
| `[]` | Terminal member, no handoffs allowed; always routes to END after tools |

Setting `can_handoff_to=[]` creates a terminal member that always ends the swarm, useful for a final writer or decision-maker that should not pass control further.

### Each member configured independently

Every member is a fully independent `Agent` instance. Members can use different:
- Models (OpenAI gpt-4o, Google Gemini 2.0, Anthropic Claude, etc.)
- Tools and tool-execution strategies
- Memory and context managers
- Skills and skill configurations
- Retry policies, multimodal settings, reasoning configs
- System prompts and tone

SwarmAgent only wires the graph and injects handoff tools. It enforces no configuration constraints on members, each is as customizable as a standalone agent.

---

## Member configuration

Each member is described by a `SwarmMemberConfig`:

| Field | Type | Default | Description |
|---|---|---|---|
| `agent` | `BaseAgent` | required | A fully-configured `Agent` instance. Do not pre-add handoff tools to its `tool_node`; SwarmAgent injects them. |
| `can_handoff_to` | `list[str] \| None` | `None` | List of member names this member may hand off to. `None` means all other members. `[]` means no handoffs (terminal). |
| `description` | `str` | `""` | Short description of this member's role (e.g., "Gathers facts from the web"). Injected into handoff tool docstrings of other members so the LLM knows when to route here. |

## SwarmAgent constructor

| Parameter | Type | Default | Description |
|---|---|---|---|
| `members` | `dict[str, SwarmMemberConfig]` | required | Mapping of member names (UPPER-CASE recommended) to their configs. All members must be present before construction; SwarmAgent does not support dynamic member addition. |
| `entry` | `str` | required | Name of the member that receives the first user message. Must be a key in `members`. |
| `state` | `AgentState \| None` | `None` | Optional custom state class. If not provided, `AgentState` is used. All members share the same state instance. |
| `context_manager` | `BaseContextManager \| None` | `None` | Optional context-trimming strategy (e.g., `MessageContextManager` or `SummaryContextManager`). Shared by all members. |
| `publisher` | `BasePublisher \| list[BasePublisher] \| None` | `None` | Optional event publisher(s) for observability and streaming. See `/docs/guides/use-publishers` for options. |
| `id_generator` | `BaseIDGenerator` | `DefaultIDGenerator()` | Generates message and run IDs. Override for distributed ID schemes (e.g., Snowflake IDs). |
| `container` | `InjectQ \| None` | `None` | Optional dependency-injection container. If provided, injectable parameters in member nodes and tools are resolved from this container. |

## Compile options

Call `.compile()` on the SwarmAgent instance to wire the graph and prepare it for execution:

| Parameter | Type | Default | Description |
|---|---|---|---|
| `checkpointer` | `BaseCheckpointer \| None` | `None` | Persistence backend for conversation state. `None` = a default `InMemoryCheckpointer` (lost on restart). See `/docs/guides/set-up-checkpointing` for options. |
| `store` | `BaseStore \| None` | `None` | Long-term memory store for facts and summaries across runs. See `/docs/guides/use-memory-store` for details. |
| `interrupt_before` | `list[str] \| None` | `None` | Pause execution before entering any of these named members (or tool nodes). Useful for human-in-the-loop workflows. |
| `interrupt_after` | `list[str] \| None` | `None` | Pause execution after exiting any of these named members. |
| `callback_manager` | `CallbackManager` | `CallbackManager()` | Lifecycle hooks and invoke callbacks for observability. See `/docs/guides/use-callbacks`. |
| `media_store` | `BaseMediaStore \| None` | `None` | Backend for storing images, audio, and documents. Enables multimodal workflows. |
| `shutdown_timeout` | `float` | `30.0` | Graceful-shutdown timeout in seconds. |

---

## Complete examples

### Basic three-member research workflow

Build a swarm where a triage agent routes research and writing tasks, a researcher gathers facts, and a writer produces the final document. This example shows the full pattern: custom tools, member independence, and handoff routing.

The examples use OpenAI models and `google_web_search`, so install both extras:

```bash
pip install "10xgraph[openai,google-genai]"
```

```python
import asyncio
from dotenv import load_dotenv
from tenxgraph.core.graph import Agent, ToolNode
from tenxgraph.prebuilt.agent import SwarmAgent
from tenxgraph.prebuilt.agent.swarm import SwarmMemberConfig
from tenxgraph.prebuilt.tools import fetch_url, google_web_search
from tenxgraph.core.state import Message

load_dotenv()

def draft_report(topic: str, facts: str) -> str:
    """Draft a structured report from gathered facts."""
    return f"# Report: {topic}\n\n{facts}"

triage_agent = Agent(
    model="gpt-4o-mini",
    provider="openai",
    system_prompt=[{
        "role": "system",
        "content": (
            "You are a triage agent. Decide whether the task needs research "
            "or can go directly to the writer. Route accordingly."
        ),
    }],
)

researcher_agent = Agent(
    model="gpt-4o",
    provider="openai",
    tool_node=ToolNode([fetch_url, google_web_search]),
    system_prompt=[{
        "role": "system",
        "content": "You are a research specialist. Gather facts and hand off to the writer.",
    }],
)

writer_agent = Agent(
    model="gpt-4o-mini",
    provider="openai",
    tool_node=ToolNode([draft_report]),
    system_prompt=[{
        "role": "system",
        "content": "You are a writer. Produce the final document from the gathered information.",
    }],
)

swarm = SwarmAgent(
    members={
        "TRIAGE": SwarmMemberConfig(
            agent=triage_agent,
            can_handoff_to=["RESEARCHER", "WRITER"],
            description="Triages the request and routes to the right specialist.",
        ),
        "RESEARCHER": SwarmMemberConfig(
            agent=researcher_agent,
            can_handoff_to=["WRITER"],
            description="Gathers facts from the web. Use for research tasks.",
        ),
        "WRITER": SwarmMemberConfig(
            agent=writer_agent,
            can_handoff_to=[],  # terminal, no handoffs out
            description="Writes the final document.",
        ),
    },
    entry="TRIAGE",
)

app = swarm.compile()

async def main():
    result = await app.ainvoke(
        {"messages": [Message.text_message(
            "Write a brief report on quantum computing progress in 2024."
        )]},
        config={"thread_id": "swarm-1"},
    )
    print(result["messages"][-1].text())

asyncio.run(main())
```

### Two-member swarm with unrestricted handoffs

When members have equal authority and can hand off to each other in either direction, omit `can_handoff_to` (defaults to `None` = all other members). In this example, a researcher and analyst collaborate freely.

```python
import asyncio
from tenxgraph.core.graph import Agent, ToolNode
from tenxgraph.prebuilt.agent import SwarmAgent
from tenxgraph.prebuilt.agent.swarm import SwarmMemberConfig
from tenxgraph.prebuilt.tools import google_web_search, safe_calculator
from tenxgraph.core.state import Message

researcher = Agent(
    model="gpt-4o-mini",
    provider="openai",
    tool_node=ToolNode([google_web_search]),
    system_prompt=[{"role": "system", "content": "Research topics and hand off to analyst when done."}],
)

analyst = Agent(
    model="gpt-4o-mini",
    provider="openai",
    tool_node=ToolNode([safe_calculator]),
    system_prompt=[{"role": "system", "content": "Analyse data and produce a final answer."}],
)

swarm = SwarmAgent(
    members={
        "RESEARCHER": SwarmMemberConfig(
            agent=researcher,
            description="Searches the web for facts.",
        ),
        "ANALYST": SwarmMemberConfig(
            agent=analyst,
            description="Runs calculations and produces the final answer.",
        ),
    },
    entry="RESEARCHER",
)

app = swarm.compile()

async def main():
    result = await app.ainvoke(
        {"messages": [Message.text_message("What is the GDP of Germany in USD? Convert at today's rate.")]},
        config={"thread_id": "two-member-1"},
    )
    print(result["messages"][-1].text())

asyncio.run(main())
```

### Persistent conversations with a checkpointer

Enable thread-based memory so users can resume conversations. The checkpointer saves the conversation history and the point in the swarm where it was paused. This example uses a Postgres checkpointer (recommended for production).

```python
import asyncio
from tenxgraph.core.graph import Agent, ToolNode
from tenxgraph.prebuilt.agent import SwarmAgent
from tenxgraph.prebuilt.agent.swarm import SwarmMemberConfig
from tenxgraph.storage.checkpointer import PgCheckpointer
from tenxgraph.prebuilt.tools import google_web_search
from tenxgraph.core.state import Message

triage = Agent(model="gpt-4o-mini", provider="openai",
               system_prompt=[{"role": "system", "content": "Route requests."}])
researcher = Agent(model="gpt-4o-mini", provider="openai",
                   tool_node=ToolNode([google_web_search]),
                   system_prompt=[{"role": "system", "content": "Research and answer."}])

swarm = SwarmAgent(
    members={
        "TRIAGE": SwarmMemberConfig(triage, can_handoff_to=["RESEARCHER"],
                                    description="Routes requests."),
        "RESEARCHER": SwarmMemberConfig(researcher, description="Researches the topic."),
    },
    entry="TRIAGE",
)

checkpointer = PgCheckpointer(
    postgres_dsn="postgresql://user:pass@localhost/db",
    redis_url="redis://localhost:6379",
)
app = swarm.compile(checkpointer=checkpointer)

async def main():
    result = await app.ainvoke(
        {"messages": [Message.text_message("Who won the 2024 Nobel Prize in Physics?")]},
        config={"thread_id": "user-99-session-1", "user_id": "user-99"},
    )
    print(result["messages"][-1].text())

asyncio.run(main())
```

### Mixed providers: Gemini and OpenAI in one swarm

Members are not constrained to the same provider. Here, a researcher uses Google Gemini 2.5 Flash while the writer uses OpenAI's GPT-4o-mini. SwarmAgent automatically adapts to each member's provider.

```python
from tenxgraph.core.graph import Agent, ToolNode
from tenxgraph.prebuilt.agent import SwarmAgent
from tenxgraph.prebuilt.agent.swarm import SwarmMemberConfig
from tenxgraph.prebuilt.tools import google_web_search

researcher = Agent(
    model="gemini-2.5-flash",
    provider="google",
    tool_node=ToolNode([google_web_search]),
    system_prompt=[{"role": "system", "content": "Research and hand off to writer."}],
    trim_context=True,
)

writer = Agent(
    model="gpt-4o-mini",
    provider="openai",
    system_prompt=[{"role": "system", "content": "Write the final answer."}],
)

swarm = SwarmAgent(
    members={
        "RESEARCHER": SwarmMemberConfig(researcher, can_handoff_to=["WRITER"],
                                        description="Researches the topic."),
        "WRITER": SwarmMemberConfig(writer, can_handoff_to=[],
                                    description="Writes the final document."),
    },
    entry="RESEARCHER",
)

app = swarm.compile()
```

---

## Testing and serving

### Test interactively with `10xgraph dev`

Use the playground UI to test your swarm without writing client code. The playground streams messages and shows which member is active at each step, making it easy to debug handoff logic and member behavior.

Create a `graph.py` file with your SwarmAgent:

**`graph.py`**

```python
from tenxgraph.core.graph import Agent, ToolNode
from tenxgraph.prebuilt.agent import SwarmAgent
from tenxgraph.prebuilt.agent.swarm import SwarmMemberConfig
from tenxgraph.prebuilt.tools import google_web_search

triage = Agent(
    model="gpt-4o-mini",
    provider="openai",
    system_prompt=[{"role": "system", "content": "Route requests to researcher or writer."}],
)
researcher = Agent(
    model="gpt-4o-mini",
    provider="openai",
    tool_node=ToolNode([google_web_search]),
    system_prompt=[{"role": "system", "content": "Research the topic and hand off to writer."}],
)
writer = Agent(
    model="gpt-4o-mini",
    provider="openai",
    system_prompt=[{"role": "system", "content": "Write the final answer."}],
)

swarm = SwarmAgent(
    members={
        "TRIAGE": SwarmMemberConfig(triage, can_handoff_to=["RESEARCHER", "WRITER"],
                                    description="Routes the task."),
        "RESEARCHER": SwarmMemberConfig(researcher, can_handoff_to=["WRITER"],
                                        description="Researches the topic."),
        "WRITER": SwarmMemberConfig(writer, can_handoff_to=[],
                                    description="Writes the final answer."),
    },
    entry="TRIAGE",
)

app = swarm.compile()
```

**`10xgraph.json`**

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

```bash
10xgraph dev
```

Open your browser (the command prints the URL) and start a conversation. You will see:
- Which member is processing your message
- Tool calls and results in real time
- Handoff decisions and why they happened
- Final output with full context

### Serve over REST or WebSocket

To call your swarm from a client (TypeScript, Python, curl), serve it with the 10xGraph API server:

```bash
10xgraph dev --no-open
```

This exposes the swarm at `/v1/graph/invoke` and `/v1/graph/stream`. See `/docs/server/invoke-and-stream` for full details.

---

## Customization options

### Custom state

By default, SwarmAgent uses `AgentState` (messages and context). Pass a custom state class to the constructor if you need additional fields:

```python
from tenxgraph.core.state import AgentState, Message

class ResearchState(AgentState):
    research_notes: list[str] = []
    final_report: str = ""

swarm = SwarmAgent(
    members={...},
    entry="RESEARCHER",
    state=ResearchState(),
)
```

All members share this custom state instance, so handoffs preserve your extra fields.

### Context management and trimming

Pass a context manager to trim or summarize long conversations:

```python
from tenxgraph.core.state import MessageContextManager

swarm = SwarmAgent(
    members={...},
    entry="TRIAGE",
    context_manager=MessageContextManager(max_messages=20),  # keep last 20 messages
)
```

This is useful when members loop and generate many messages. See `/docs/guides/use-context-manager` for options.

### Per-member tools

Each member can have its own tools. For example, only the researcher accesses web search, and only the writer has the calculator:

```python
from tenxgraph.prebuilt.tools import google_web_search, safe_calculator

researcher = Agent(
    model="gpt-4o",
    tool_node=ToolNode([google_web_search]),
)

writer = Agent(
    model="gpt-4o-mini",
    tool_node=ToolNode([safe_calculator]),
)

swarm = SwarmAgent(
    members={
        "RESEARCHER": SwarmMemberConfig(researcher, can_handoff_to=["WRITER"]),
        "WRITER": SwarmMemberConfig(writer, can_handoff_to=[]),
    },
    entry="RESEARCHER",
)
```

### Observability: publishers and callbacks

Monitor what the swarm is doing with publishers (events) and lifecycle hooks:

```python
from tenxgraph.runtime.publisher import ConsolePublisher
from tenxgraph.utils.callbacks import CallbackManager, GraphLifecycleHook

publisher = ConsolePublisher()  # print events to console

class LogHook(GraphLifecycleHook):
    async def on_graph_start(self, ctx, state):
        print("Swarm started")

    async def on_graph_end(self, ctx, final_state, messages, total_steps):
        print("Swarm finished")


callback_manager = CallbackManager()
callback_manager.register_lifecycle_hook(LogHook())

swarm = SwarmAgent(members={...}, entry="TRIAGE", publisher=publisher)
app = swarm.compile(callback_manager=callback_manager)
```

See `/docs/guides/use-publishers` and `/docs/guides/use-callbacks` for more patterns.

---

## Reference and troubleshooting

For the complete parameter list and advanced options, see the [reference page](/docs/reference/python/prebuilt-agents).

**Common issues:**

- **Members do not hand off**: Check that `can_handoff_to` is set correctly and includes the target member name (case-insensitive). If empty, the member is terminal.
- **Handoff tool not in docstring**: Ensure the target member has a non-empty `description`. Handoff tools inherit their docstring from it so the LLM knows when to route there.
- **LLM gets confused about who to call**: Keep descriptions short and distinct. "Gathers facts" and "Analyzes data" are clearer than "Does stuff."
- **Token limits**: Long lists of handoff tools (20+ members) can exceed model context. Consider a two-tier swarm (triage agent routes to team leads, then to specialists) or using a custom graph instead.

## Run it in production

Handoffs are limited to the agents each one is allowed to hand off to; a call to any other target returns tool-not-found. A caller can still start at a chosen node with `current_node`, so restrict it with `runs.state_keys` if needed. See the [Security model](/docs/production/security-model).
