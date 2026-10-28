---
title: Handoff
seoTitle: "Multi-agent handoff example"
description: Build a multi-agent 10xGraph system where agents transfer work to each other using handoff tools.
section: Examples
group: "Multi-agent"
order: 160
label: Handoff
updated: "2026-10-27"
faq:
  - q: "What is the difference between a handoff and regular routing?"
    a: "In regular routing, your graph code decides the next node. With handoff tools, the model decides to transfer to another specialist by calling a handoff tool named transfer_to_<name>, and the graph jumps to that node."
  - q: "Can I use handoffs with prebuilt agents?"
    a: "Yes. SwarmAgent and SupervisorTeamAgent generate handoff tools for you. This example builds the same pattern by hand so you can see each part."
  - q: "Do I need explicit edges from tool nodes back to agents?"
    a: "No. When a tool node sees a call to a registered handoff tool, it skips running the tool and returns a Command that sends the graph to the target node. A transfer_to_<name> call to a tool that was not made with create_handoff_tool and registered on that tool node is an ordinary unknown tool call and is not routed."
---

A handoff lets an agent pass control to another agent by calling a tool named `transfer_to_<name>`. This example wires three agents (coordinator, researcher, writer) that delegate to each other with no fixed pipeline. The model chooses who works next, and the graph jumps there.

The source is `examples/handoff/handoff_multi_agent.py` in the repository.

## Run the example

You need the Google GenAI extra and a Gemini key. The example loads a `.env` file with `python-dotenv`, so install that too, or export the key in your shell.

```bash
pip install "10xgraph[google-genai]" python-dotenv
export GEMINI_API_KEY=your-key-here   # GOOGLE_API_KEY also works
python examples/handoff/handoff_multi_agent.py
```

The script sends "Please research quantum computing and write a brief article about it." and prints the full message history, including every tool call. Model output varies between runs.

## How the handoff works

A handoff tool is a tool made by `create_handoff_tool` and registered on the tool node. Its name is `transfer_to_<name>`, and it records its target. Before a tool node runs any tool calls, it checks each name against the handoff tools registered on that node. A name that only starts with `transfer_to_` does not count. On a match it does not run the tool. It returns a `Command` whose `goto` is the target stored on the tool. A `goto` to a node that is not in the graph raises `GraphError` (`GRAPH_007`).

<aside class="callout callout-warning" role="warning"><p class="callout-title">The target must equal the node name</p>

The target passed to `create_handoff_tool` is used as the node name as is, with no case conversion. The code below passes the exact node names (`"RESEARCHER"`) to `create_handoff_tool`, so the tool is `transfer_to_RESEARCHER` and the jump lands on the node `RESEARCHER`.

</aside>

## Walk through the code

The code below is the example condensed into one runnable file. It follows the repository file, except that the handoff targets use the uppercase node names.

### Imports and checkpointer

The imports bring in the agent, graph and tool node classes, the handoff helper and an in-memory checkpointer.

```python title="handoff_multi_agent.py"
from dotenv import load_dotenv

from tenxgraph.core import Agent, StateGraph, ToolNode
from tenxgraph.core.state import AgentState, Message
from tenxgraph.prebuilt.tools import create_handoff_tool
from tenxgraph.storage.checkpointer import InMemoryCheckpointer
from tenxgraph.utils.constants import END

load_dotenv()

checkpointer = InMemoryCheckpointer()
```

### Define the regular tools

Each specialist gets one ordinary tool. They return canned strings so the example needs no external services.

```python title="handoff_multi_agent.py"
def get_weather(location: str) -> str:
    """Get the current weather for a specific location."""
    return f"The weather in {location} is sunny, 25C"


def search_web(query: str) -> str:
    """Search the web for information."""
    return f"Search results for '{query}': Found relevant information about quantum computing"


def write_document(content: str, title: str) -> str:
    """Write a document with the given content and title."""
    return f"Document '{title}' written successfully with {len(content)} characters"
```

The repository version also declares optional `tool_call_id` and `state` parameters on these tools. They are injected at call time and hidden from the model, which is useful for logging but not needed here.

### Give each agent a tool node with handoff tools

Each agent's tool node mixes its own tools with `create_handoff_tool` calls for the agents it may pass work to. The second argument is the description the model sees.

```python title="handoff_multi_agent.py"
# Coordinator delegates to either specialist and can check the weather.
coordinator_tools = ToolNode(
    [
        create_handoff_tool("RESEARCHER", "Transfer to research specialist for detailed investigation"),
        create_handoff_tool("WRITER", "Transfer to writing specialist for content creation"),
        get_weather,
    ]
)

# Researcher searches, then hands to the writer or back to the coordinator.
researcher_tools = ToolNode(
    [
        search_web,
        create_handoff_tool("COORDINATOR", "Transfer back to coordinator for delegation"),
        create_handoff_tool("WRITER", "Transfer to writer with research findings"),
    ]
)

# Writer saves a document, then hands back to the coordinator.
writer_tools = ToolNode(
    [
        write_document,
        create_handoff_tool("COORDINATOR", "Transfer back to coordinator"),
    ]
)
```

### Create the three agents

Each `Agent` has a system prompt and the name of its tool node. The prompt tells the model which handoff tools exist and when to use them.

```python title="handoff_multi_agent.py"
coordinator_agent = Agent(
    model="gemini-2.5-flash",
    provider="google",
    system_prompt=[
        {
            "role": "system",
            "content": """You are a coordinator agent. Your job is to:
1. Understand user requests
2. Delegate tasks to specialized agents:
   - Use transfer_to_RESEARCHER for investigation and research tasks
   - Use transfer_to_WRITER for content creation and writing tasks
3. You can also check weather using get_weather
Always explain your decision to delegate.""",
        },
    ],
    tool_node="COORDINATOR_TOOLS",
    trim_context=True,
)

researcher_agent = Agent(
    model="gemini-2.5-flash",
    provider="google",
    system_prompt=[
        {
            "role": "system",
            "content": """You are a research specialist. Investigate topics with search_web.
When research is complete, use transfer_to_WRITER if content must be written,
or transfer_to_COORDINATOR if the task is done.""",
        },
    ],
    tool_node="RESEARCHER_TOOLS",
    trim_context=True,
)

writer_agent = Agent(
    model="gemini-2.5-flash",
    provider="google",
    system_prompt=[
        {
            "role": "system",
            "content": """You are a writing specialist. Write clear content and save it with
write_document. Then use transfer_to_COORDINATOR.""",
        },
    ],
    tool_node="WRITER_TOOLS",
    trim_context=True,
)
```

### Route each agent to its tools or to the end

Each agent needs one conditional edge. The router sends the graph to the agent's tool node when the last assistant message has tool calls, back to the agent after a tool result, and to `END` otherwise. One factory function builds all three routers.

```python title="handoff_multi_agent.py"
def make_router(agent_node: str, tools_node: str):
    """Build a routing function for one agent and its tool node."""

    def route(state: AgentState) -> str:
        if not state.context:
            return tools_node
        last = state.context[-1]
        if last.role == "assistant" and getattr(last, "tools_calls", None):
            return tools_node
        if last.role == "tool":
            return agent_node
        return END

    return route
```

The repository file spells out three near-identical functions (`should_continue_coordinator` and so on). The factory behaves the same.

### Assemble and compile the graph

The graph registers all six nodes and adds one conditional edge per agent. The repository example adds no edges out of the tool nodes: handoffs jump via `Command`. If you adapt it and a regular tool result does not return to its agent, add an explicit edge from the tool node back to the agent.

```python title="handoff_multi_agent.py"
graph = StateGraph()

graph.add_node("COORDINATOR", coordinator_agent)
graph.add_node("COORDINATOR_TOOLS", coordinator_tools)
graph.add_node("RESEARCHER", researcher_agent)
graph.add_node("RESEARCHER_TOOLS", researcher_tools)
graph.add_node("WRITER", writer_agent)
graph.add_node("WRITER_TOOLS", writer_tools)

graph.set_entry_point("COORDINATOR")

for agent_node in ("COORDINATOR", "RESEARCHER", "WRITER"):
    tools_node = f"{agent_node}_TOOLS"
    graph.add_conditional_edges(
        agent_node,
        make_router(agent_node, tools_node),
        {tools_node: tools_node, END: END},
    )

app = graph.compile(checkpointer=checkpointer)
```

### Invoke the graph and inspect the messages

The run uses a `thread_id` for the checkpointer and a `recursion_limit` so a looping handoff cannot run forever. The loop prints each message and the tools it called, which shows the handoffs.

```python title="handoff_multi_agent.py"
if __name__ == "__main__":
    inp = {
        "messages": [
            Message.text_message(
                "Please research quantum computing and write a brief article about it."
            )
        ]
    }
    config = {"thread_id": "handoff-demo-001", "recursion_limit": 15}

    res = app.invoke(inp, config=config)

    for i, msg in enumerate(res["messages"], 1):
        print(f"[{i}] {msg.role}: {msg.text()[:200]}")
        for tool_call in getattr(msg, "tools_calls", None) or []:
            print("    tool called:", tool_call.get("function", {}).get("name", ""))
```

## Expected flow

The model decides the exact path, but a typical run looks like this:

1. The coordinator explains its choice and calls `transfer_to_RESEARCHER`.
2. The coordinator's tool node detects the prefix and returns a `Command` to `RESEARCHER`.
3. The researcher calls `search_web`, then `transfer_to_WRITER`.
4. The writer calls `write_document`, then `transfer_to_COORDINATOR`.
5. The coordinator writes a final summary with no tool calls, so the router returns `END`.

If a run stops early or loops, tighten the system prompts. Handoff behavior depends on the model following them.

## Try next

- Read [Handoff between agents](/docs/guides/handoff-between-agents) for when to choose handoffs over other patterns.
- Use [SwarmAgent](/docs/guides/prebuilt/swarm-agent) to get this wiring generated for you.
- See [Agents and tools](/docs/concepts/agents-and-tools) for how agents and tool nodes interact.
