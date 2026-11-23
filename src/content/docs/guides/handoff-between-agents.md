---
title: Route between agents with handoff
description: "Transfer control between agents with handoff tools and Command routing, and run a sub-workflow as a tool call that keeps its data in a custom state field."
section: "Build agents"
group: "Control flow"
order: 250
updated: "2026-11-22"
faq:
  - q: "When should I use this instead of SwarmAgent?"
    a: "Use manual handoff when you need full control over graph topology or custom routing logic. Use SwarmAgent when all agents are peers and you want automatic handoff tool injection."
  - q: "Can handoff tools route to agents that do not exist?"
    a: "The handoff is detected and routed before tool execution, so the target node must exist in the graph. A target that is not a node raises a GraphError with code GRAPH_007."
  - q: "Can I put a compiled graph inside another graph as a node?"
    a: "No. 10xGraph does not support nested graphs. add_node raises ValueError: Invalid arguments for add_node when given a compiled graph. Wrap the sub-workflow as a tool: the tool runs it, keeps the full data in a custom state field and returns a short summary to the model."
  - q: "How do I prevent routing loops?"
    a: "Ensure at least one agent has a conditional edge that routes to END when no handoff is called, breaking the cycle."
---

In a multi-agent graph, agents often need to delegate tasks to specialists. 10xGraph provides two patterns to route control: the **handoff tool** convention, where handoff tools made with `create_handoff_tool` (named `transfer_to_<agent>`) intercept the LLM's tool calls and navigate the graph directly, and the **Command** mechanism, where a node function explicitly routes to another agent. Handoff tools keep the conversation history clean because the tool body never executes; Command routing gives you programmatic control over navigation and state updates.

## When to use each pattern

**Handoff tools** (`transfer_to_X`) are best when agents decide where to go next via tool calls. The LLM decides "I need to ask the researcher" and calls the corresponding tool. The tool node checks the call against the handoff tools registered on it, intercepts it before execution, and routes to the target node. This is lightweight and requires minimal setup per agent.

**Command routing** works when a dedicated node (often a router or condition function) makes routing decisions based on message content or logic you define. Return `Command(goto="TARGET_NODE")` from any custom node function to navigate explicitly. This is useful when routing decisions come from parsing outputs, matching patterns, or applying complex rules that the LLM should not see.

If your agents are all peers (equal, collaborative) and you want automatic handoff tool injection, consider `/docs/guides/prebuilt/swarm-agent` instead. If you have a supervisor that delegates to workers, use `/docs/guides/prebuilt/supervisor-team-agent`. Use manual handoff when you need full control over the graph topology or custom routing.

**A sub-workflow as a tool** fits when one step is a workflow of its own and the model needs only its result. The tool runs it, keeps the full data in a custom state field and returns a short summary. See [Run a sub-workflow as a tool call](#run-a-sub-workflow-as-a-tool-call).

## How handoff tools work

When you call `create_handoff_tool("researcher")`, it returns a function named `transfer_to_researcher` with metadata flags that tell the graph this is a handoff. When an agent's tool node receives this tool call, the node handler checks whether that name is a handoff tool registered on this `ToolNode`. If it is, the handler reads the target agent name stored on the tool, updates the routing, and skips the tool function body. A name that merely starts with `transfer_to_` is not enough: a call to a made-up `transfer_to_*` tool is an ordinary unknown tool call and gets a "Tool not found" result. So a model cannot steer the run to a node by inventing a call. A `Command(goto=...)` that names a node not in the graph raises `GraphError` with code `GRAPH_007`. The message history stays clean because no tool-result message is added.

```python
Agent LLM thinks: "I need the researcher to investigate."
    ↓
Agent calls tool: transfer_to_researcher
    ↓
Graph handler finds the name among the registered handoff tools
    ↓
Graph routes to the node named "researcher"
    (tool function never runs)
```

The graph does the routing, not the tool function. This keeps the conversation clean and makes routing transparent to the LLM.

## Complete working example

Install with `pip install "10xgraph[google-genai]"` and set `GEMINI_API_KEY` (or `GOOGLE_API_KEY`). Here's a fully runnable three-agent graph: a triage agent routes requests to a researcher or writer, and they can hand back to the triage agent or to each other.

```python
from tenxgraph.core import Agent, StateGraph, ToolNode, Message
from tenxgraph.core.state import AgentState
from tenxgraph.prebuilt.tools import create_handoff_tool
from tenxgraph.utils import END

# ────────────────────────────────────────────────────────────────────────────
# Helper: Check if the last message has tool calls
# ────────────────────────────────────────────────────────────────────────────
def has_tool_calls(state: AgentState) -> bool:
    """Return True if the last message contains tool calls."""
    return bool(state.context and state.context[-1].tools_calls)

# ────────────────────────────────────────────────────────────────────────────
# Tools: Handoff tools for each agent
# ────────────────────────────────────────────────────────────────────────────
triage_tools = ToolNode([
    create_handoff_tool("researcher", "Hand off to researcher for fact-finding."),
    create_handoff_tool("writer", "Hand off to writer for drafting."),
])

researcher_tools = ToolNode([
    create_handoff_tool("triage", "Return to triage coordinator."),
    create_handoff_tool("writer", "Hand off to writer with research findings."),
])

writer_tools = ToolNode([
    create_handoff_tool("triage", "Return to triage coordinator."),
    create_handoff_tool("researcher", "Ask researcher for more information."),
])

# ────────────────────────────────────────────────────────────────────────────
# Agents
# ────────────────────────────────────────────────────────────────────────────
triage_agent = Agent(
    model="gemini-2.5-flash",
    provider="google",
    system_prompt=[{
        "role": "system",
        "content": "You are a triage coordinator. Route user requests to the researcher for investigation or to the writer for content creation.",
    }],
    tool_node="triage_tools",
)

researcher_agent = Agent(
    model="gemini-2.5-flash",
    provider="google",
    system_prompt=[{
        "role": "system",
        "content": "You are a researcher. Investigate topics thoroughly. When done, hand off to the writer or return to triage.",
    }],
    tool_node="researcher_tools",
)

writer_agent = Agent(
    model="gemini-2.5-flash",
    provider="google",
    system_prompt=[{
        "role": "system",
        "content": "You are a writer. Draft content based on the materials provided. Ask for more info if needed, or return to triage.",
    }],
    tool_node="writer_tools",
)

# ────────────────────────────────────────────────────────────────────────────
# Graph
# ────────────────────────────────────────────────────────────────────────────
graph = StateGraph()

# Add agent nodes
graph.add_node("triage", triage_agent)
graph.add_node("triage_tools", triage_tools)
graph.add_node("researcher", researcher_agent)
graph.add_node("researcher_tools", researcher_tools)
graph.add_node("writer", writer_agent)
graph.add_node("writer_tools", writer_tools)

# Set entry point
graph.set_entry_point("triage")

# Tool nodes route back to their agents
graph.add_edge("triage_tools", "triage")
graph.add_edge("researcher_tools", "researcher")
graph.add_edge("writer_tools", "writer")

# Agent routing: if tool call exists, go to tool node; otherwise end
graph.add_conditional_edges(
    "triage",
    lambda state: "triage_tools" if has_tool_calls(state) else END,
    {"triage_tools": "triage_tools", END: END},
)

graph.add_conditional_edges(
    "researcher",
    lambda state: "researcher_tools" if has_tool_calls(state) else END,
    {"researcher_tools": "researcher_tools", END: END},
)

graph.add_conditional_edges(
    "writer",
    lambda state: "writer_tools" if has_tool_calls(state) else END,
    {"writer_tools": "writer_tools", END: END},
)

app = graph.compile()

# ────────────────────────────────────────────────────────────────────────────
# Run it
# ────────────────────────────────────────────────────────────────────────────
result = app.invoke({
    "messages": [Message.text_message("Find recent AI breakthroughs and write a summary article.")]
})

for msg in result["messages"]:
    print(f"{msg.role}: {msg.text()}")
```

The flow: triage receives the request, decides to call `transfer_to_researcher` to investigate. The graph intercepts this tool call, routes to the researcher node, and the researcher runs. When the researcher calls `transfer_to_writer`, the graph routes there. When the writer finishes (no handoff called), execution ends.

## Alternative: explicit routing with Command

If you prefer to control routing in code rather than via tool calls, return a `Command` from a custom node:

```python
from tenxgraph.utils import Command, END
from tenxgraph.core.state import AgentState

def router_node(state: AgentState, config: dict) -> Command:
    """Route based on message content."""
    last_msg = state.context[-1].text() if state.context else ""

    if "research" in last_msg.lower():
        return Command(goto="researcher")
    elif "write" in last_msg.lower():
        return Command(goto="writer")
    else:
        return Command(goto=END)

graph.add_node("router", router_node)
graph.set_entry_point("router")
```

`Command` lets you:
- **goto**: Route to any node name or `END`
- **update**: Apply state changes before navigating (e.g., add a message)
- **state**: Attach a full state object

Command routing is useful when decisions come from parsing outputs, applying business logic, or orchestrating multi-turn flows where the LLM should not see routing logic.

## Run a sub-workflow as a tool call

10xGraph does not support nested graphs. A compiled graph cannot be a node of another `StateGraph`: `add_node` accepts a function, a `ToolNode` or an `Agent`, and a compiled graph raises `ValueError: Invalid arguments for add_node`. There is no jump to a parent graph either.

When one step of your agent is a whole workflow of its own (research, data collection, a multi-step lookup), wrap it as a tool:

1. The tool runs the sub-workflow. It can be plain Python code, or a second compiled graph that the tool calls with `await sub_app.ainvoke(...)`.
2. The tool writes the full intermediate data to a custom state field.
3. The tool returns only a short summary to the model.

A custom state field is saved per thread with the checkpoint. The model does not see it unless you put it in the prompt (for example with a `{field}` placeholder in the system prompt), so the model context stays small however much data the sub-workflow produces. Later tools and nodes read the full data from `state`.

```python
from typing import Annotated

from pydantic import Field

from tenxgraph.core import Agent, Message, StateGraph, ToolNode
from tenxgraph.core.state import AgentState, ToolResult
from tenxgraph.storage.checkpointer import InMemoryCheckpointer
from tenxgraph.utils import END
from tenxgraph.utils.decorators import tool


# The sub-workflow: its own small graph. Replace collect with your own steps or Agent nodes.
def collect(state: AgentState) -> Message:
    topic = state.context[-1].text()
    notes = [f"{topic}: finding {i}" for i in range(1, 21)]
    return Message.text_message("\n".join(notes), role="assistant")


sub = StateGraph()
sub.add_node("collect", collect)
sub.set_entry_point("collect")
sub.add_edge("collect", END)
research_app = sub.compile()


# Outer state: the sub-workflow's data lives in a custom field, not in the messages.
def merge_notes(left: dict, right: dict) -> dict:
    return {**left, **right}


class DeskState(AgentState):
    research_notes: Annotated[dict[str, list[str]], merge_notes] = Field(default_factory=dict)


@tool
async def research(topic: str, state: DeskState) -> ToolResult:
    """Research a topic. Returns a short summary; the full notes are kept in state."""
    result = await research_app.ainvoke({"messages": [Message.text_message(topic)]})
    notes = result["messages"][-1].text().splitlines()
    return ToolResult(
        message=f"Collected {len(notes)} notes on {topic}. First: {notes[0]}",
        state={"research_notes": {**state.research_notes, topic: notes}},
    )


agent = Agent(
    model="gemini-2.5-flash",
    provider="google",
    system_prompt=[{"role": "system", "content": "Use the research tool, then answer briefly."}],
    tool_node="tools",
)

graph = StateGraph(DeskState())
graph.add_node("agent", agent)
graph.add_node("tools", ToolNode([research]))
graph.set_entry_point("agent")
graph.add_conditional_edges(
    "agent",
    lambda state: "tools" if state.context and state.context[-1].tools_calls else END,
    {"tools": "tools", END: END},
)
graph.add_edge("tools", "agent")
app = graph.compile(checkpointer=InMemoryCheckpointer())

result = app.invoke(
    {"messages": [Message.text_message("Research solar and wind power.")]},
    config={"thread_id": "desk-1"},
)
for msg in result["messages"]:
    print(f"{msg.role}: {msg.text()}")
```

The model sees one summary line per tool call. The 20 notes per topic stay in `state.research_notes` and are saved with the thread. How it works:

- `state` is an injected parameter. The tool gets the current state, and the model never sees the parameter in the tool schema.
- `ToolResult(message=..., state=...)` returns the message to the model and sets the named state fields. A name that is not a field of the state is ignored.
- When the model makes several tool calls in one turn, they run in parallel and each call works on its own copy of the state. If two calls change the same field, the field's reducer combines the values. Without a reducer the last write wins and a warning is logged, so a field that several calls fill needs one (here `merge_notes`).

Keep these limits in mind when the sub-workflow is a compiled graph. It runs as a separate run inside the tool call. Its stream chunks and tool calls do not appear in the outer stream, client tools of the outer run (`config["remote_tools"]`) do not reach it, and an `interrupt()` inside it does not pause the outer run. Put human approval in the outer graph (see [Add human approval](/docs/guides/add-human-approval)). Compile the sub-workflow without a checkpointer, or give it its own: one checkpointer instance serves one state class.

If the specialists should talk to the user directly or take turns in one conversation, use Agent nodes and handoff tools in one graph, as in the examples above.

## Routing topologies

### Peer-to-peer

All agents can call all others. Each agent has handoff tools for every peer:

```
Agent A ←→ Agent B
  ↕         ↕
Agent C ←→ Agent D
```

Use **SwarmAgent** to automate this: it generates all `transfer_to_*` tools and injects them.

### Hub and spoke

One central coordinator routes to specialist agents, and specialists return to the coordinator:

```
        ┌─ Researcher
        │
Triage ─┼─ Writer
        │
        └─ Analyst
```

Use **SupervisorTeamAgent** for this pattern: it generates a supervisor LLM that decides where to route.

### Chain

Agents form a linear sequence; each hands off to the next:

```
Investigator → Analyzer → Writer → Editor → END
```

Use manual handoff with conditional edges that route sequentially.

## Common errors and fixes

| Error | Cause | Fix |
|---|---|---|
| Agent keeps calling `transfer_to_X` but never moves. | Target node name doesn't exist in the graph. | Verify the `agent_name` argument to `create_handoff_tool()` matches an `add_node()` call exactly (case-sensitive). |
| Handoff tool executes (logs show "should have been intercepted"). | Node handler is not the framework's built-in handler; you've replaced it with custom logic. | Use `Agent` and `ToolNode` directly; do not override node handlers. |
| Routing loop: agents keep handing off to each other infinitely. | No base-case conditional edge to `END`. | Add `END` as an option from at least one agent's conditional edges. Ensure an agent can finish without calling a handoff. |
| `Command.goto` is ignored. | `Command` returned from an `Agent` node instead of a custom function. | Return `Command` only from custom node functions, not from `Agent` instances. Agents return messages. |
| Handoff to agent X works but state looks wrong. | State not passed through the handoff correctly. | The framework preserves `state.context` (messages) across handoffs. If you need custom state, subclass `AgentState` and use reducers. |

## How to verify

After building the graph, compile it and run with a simple input to trace the path:

```python
import logging
logging.basicConfig(level=logging.DEBUG)

result = app.invoke({"messages": [Message.text_message("Your request")]})
```

The logs show which nodes execute in order, making it easy to confirm the routing is working.

## Run it in production

Handoffs are decided inside the graph, and only a handoff tool registered on the `ToolNode` can move a run to another node, so a prompt-injected `transfer_to_*` call is an ordinary failed tool call. A caller can start a run at a chosen node with `current_node` only if you list it in `runs.state_keys`, which is empty by default; leave it off if your graph needs an entry guard. See the [Security model](/docs/production/security-model).

## Related pages

- `/docs/guides/prebuilt/swarm-agent`: Automate peer-to-peer handoff for multi-agent teams.
- `/docs/guides/prebuilt/supervisor-team-agent`: Use a supervisor LLM to route work to specialists.
- `/docs/guides/build-a-graph`: Fundamentals of building graphs and routing.
- `/docs/concepts/state-graph`: How StateGraph, nodes, and edges work.
- `/docs/concepts/agents-and-tools`: Agent behavior and tool dispatch.
