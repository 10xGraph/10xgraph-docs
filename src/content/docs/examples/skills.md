---
title: Skills
seoTitle: "Skills example: dynamic SKILL.md loading"
description: Run an example graph that loads Agent Skills (SKILL.md files) on demand and combines them with normal Python tools.
section: Examples
group: "Testing and operations"
order: 190
label: Skills
updated: "2026-10-27"
faq:
  - q: How does the model know which skill to load?
    a: The agent adds an available_skills catalog (name, description and triggers) to the system prompt. When a request matches a description, the model calls activate_skill with that skill name.
  - q: Can I mix skills with normal Python tools?
    a: Yes. The example registers get_weather in a ToolNode, and the skill tools are added to the same node, so one agent can call both.
---

This example builds one assistant that switches into specialized modes at runtime by loading `SKILL.md` files from disk, alongside a normal Python tool. The code lives in `examples/skills/` and needs Python 3.12 or newer. Skills follow the Agent Skills format, so the folders are portable between tools.

## What this example shows

The agent in this example:

- answers normal questions directly
- calls a regular Python tool for weather lookups
- loads dynamic `SKILL.md` files when requests match a skill's description
- stays in the main loop after the skill content is injected

## How to run it

Install the required packages:

```bash
pip install "10xgraph[google-genai]" python-dotenv
```

The scripts call `load_dotenv()`, so you can also put `GOOGLE_API_KEY` in a `.env` file next to where you run them.

Set your Google API key:

```bash
export GOOGLE_API_KEY=your_key_here
```

Run the interactive chat:

```bash
python examples/skills/chat.py
```

Or run the scripted example with a single query (from the repository root):

```bash
cd examples/skills
python graph.py
python graph.py "Review this Python function: def add(a, b): return a + b"
python graph.py "Write a professional apology email to a client"
```

## Example structure

The skills folder is in the repo:

```text title="examples/skills/"
examples/skills/
├── graph.py
├── chat.py
└── skills/
    ├── code-review/
    │   └── SKILL.md
    ├── data-analysis/
    │   └── SKILL.md
    ├── humanizer/
    │   └── SKILL.md
    └── writing-assistant/
        └── SKILL.md
```

Each SKILL.md contains frontmatter and instructions:

```markdown title="skills/code-review/SKILL.md"
---
name: code-review
description: "Perform thorough code reviews, identify bugs, suggest improvements, and explain code quality issues. Use when the user shares code and asks for a review, bug hunt, or quality feedback."
metadata:
  triggers: "review my code; check this code; find bugs"
  tags: "engineering"
  priority: "10"
---

You are now in code review mode.
...
```

## How skills are discovered and injected

You point `SkillConfig` at a folder, and the agent discovers every `SKILL.md` in it, adds a catalog to the system prompt, and registers the skill tools. The agent is built in the next section; here are the settings that control the behavior.

When the graph is built, 10xGraph adds these tools to the tool node:

- `activate_skill(skill_name)` loads a skill's instructions.
- `read_skill_resource(skill_name, path)` reads a file bundled with a skill. It is registered only when a skill bundles files.

| Setting | Effect |
|---|---|
| `skills_dir` | Path to the folder containing skill folders |
| `inject_catalog=True` | Adds skill names and descriptions to the system prompt so the model knows what to load (default `True`) |
| `hot_reload=True` | Re-reads a `SKILL.md` from disk when its modification time changes (default `True`; useful during authoring) |

## Building the graph

The example defines a normal tool, an agent with skills, a router and a ReAct-style graph. Together they form the complete `graph.py` (the real file also prints the registered tools and accepts a query from the command line).

### Define the tool, agent and graph

```python title="examples/skills/graph.py"
from pathlib import Path

from dotenv import load_dotenv

from tenxgraph.core.graph import Agent, StateGraph, ToolNode
from tenxgraph.core.skills import SkillConfig
from tenxgraph.core.state import AgentState, Message
from tenxgraph.core.state.message_context_manager import MessageContextManager
from tenxgraph.utils.constants import END

load_dotenv()


# A regular Python tool, used alongside the skills
def get_weather(location: str) -> str:
    """Get the current weather for a location."""
    weather_data = {
        "london": "Cloudy, 15°C",
        "new york": "Sunny, 22°C",
        "tokyo": "Rainy, 18°C",
        "paris": "Partly cloudy, 17°C",
    }
    location_lower = location.lower()
    if location_lower in weather_data:
        return f"The weather in {location} is: {weather_data[location_lower]}"
    else:
        return f"Weather data not available for {location}. Try London, New York, Tokyo, or Paris."


# The folder that holds one sub-folder per skill
SKILLS_DIR = str(Path(__file__).parent / "skills")

# Registered in the graph as "TOOL"
tool_node = ToolNode([get_weather])

agent = Agent(
    model="google/gemini-2.5-flash",
    system_prompt=[
        {"role": "system", "content": "You are a smart, multi-skilled assistant."}
    ],
    tool_node="TOOL",  # resolved to the ToolNode above when the graph compiles
    skills=SkillConfig(
        skills_dir=SKILLS_DIR,
        inject_catalog=True,  # add the <available_skills> catalog to the prompt
        hot_reload=True,  # re-read a SKILL.md when it changes on disk
    ),
    trim_context=True,
)


def should_use_tools(state: AgentState) -> str:
    """Route to TOOL node if there are tool calls, else END."""
    if not state.context:
        return END
    last = state.context[-1]
    if last.role == "assistant" and hasattr(last, "tools_calls") and last.tools_calls:
        return "TOOL"
    if last.role == "tool":
        return "MAIN"
    return END

graph = StateGraph(context_manager=MessageContextManager(max_messages=20))
graph.add_node("MAIN", agent)
graph.add_node("TOOL", tool_node)
graph.add_conditional_edges("MAIN", should_use_tools, {"TOOL": "TOOL", END: END})
graph.add_edge("TOOL", "MAIN")
graph.set_entry_point("MAIN")

app = graph.compile()
```

The agent is passed `tool_node="TOOL"`, a string naming the graph node that holds the `ToolNode`. When the graph compiles, 10xGraph resolves it and wires the skill tools into that node.

### Run one query

Invoke the compiled graph with a message and a thread id, then print the assistant replies.

```python title="examples/skills/graph.py"
if __name__ == "__main__":
    result = app.invoke(
        {"messages": [Message.text_message("Review this function: def add(a, b): return a + b")]},
        config={"thread_id": "skills-demo-1", "recursion_limit": 15},
    )
    for msg in result["messages"]:
        if msg.role == "assistant":
            print(msg.text() or "(no text)")
```

## How the model uses skills

At runtime the model sees an `<available_skills>` catalog in the system prompt, then calls `activate_skill` when a request matches a skill's description. The tool returns the skill body, which the model follows for the rest of the turn.

The catalog lists each skill's name and description, plus any `triggers` from the frontmatter, ordered by priority (highest first):

```xml
<available_skills>
  <skill>
    <name>code-review</name>
    <description>Perform thorough code reviews, ...</description>
    <triggers>review my code; check this code; ...</triggers>
  </skill>
  ...
</available_skills>
```

When a request matches, the model calls `activate_skill("code-review")`. The tool returns the `SKILL.md` body wrapped in `<skill_content>` tags, followed by a list of any bundled files:

```text
<skill_content name="code-review">
You are now in **CODE REVIEW** mode.
...
</skill_content>
```

The result is a tool message in the conversation, so the model applies those instructions to the user's request.

## Testing the example

Start the example and test these inputs:

```text
You: Review this Python function for bugs
```

The agent should load the `code-review` skill.

```text
You: Analyse this data: [120, 95, 140, 88, 160]
```

The agent should load the `data-analysis` skill.

```text
You: What's the weather in London?
```

The agent should call the `get_weather` tool instead of loading a skill. Model behavior varies, so treat these outcomes as typical, not guaranteed. In `chat.py` a line such as `>> Skill loaded: code-review` confirms an activation.

## The persistent chat variant

`examples/skills/chat.py` wraps the same graph in a terminal REPL. The excerpts below show the three patterns that matter: one thread per session, detecting which skill loaded, and printing the final reply.

### Use one thread for the whole session

```python title="examples/skills/chat.py"
thread_id = f"skills-chat-{uuid4().hex[:8]}"

result = app.invoke(
    {"messages": [Message.text_message(user_input)]},
    config={"thread_id": thread_id, "recursion_limit": 20},
)
```

### Detect which skill was loaded

```python title="examples/skills/chat.py"
SKILL_CONTENT_RE = re.compile(r'<skill_content name="([^"]+)">')

for msg in result["messages"]:
    if msg.role == "tool":
        match = SKILL_CONTENT_RE.match(msg.text() or "")
        if match:
            print(f"  >> Skill loaded: {match.group(1)}")
```

### Print the assistant reply

```python title="examples/skills/chat.py"
for msg in reversed(result["messages"]):
    if msg.role == "assistant" and msg.text():
        print(f"\nAssistant: {msg.text()}\n")
        break
```

The chat version passes `tools=[get_weather]` to the `Agent` instead of a `tool_node`, then calls `agent.get_tool_node()` to get the tool node with the skill tools included and adds it to the graph as "TOOL".

## Key patterns

Skills work because:

- The `<available_skills>` catalog helps the model decide when to load a skill
- `activate_skill` returns the full SKILL.md content, grounding the model in exact instructions
- `read_skill_resource` lets skills bundle references and scripts the model can read
- Skill activations are recorded in the execution state, so they survive context trimming

## Common mistakes

- Adding the agent to a graph without a node named "TOOL" when you pass `tool_node="TOOL"`; the name must match the node you add with `add_node`
- Putting all instructions in the system prompt instead of splitting them into focused SKILL.md files
- Writing descriptions that don't match what users actually type; the catalog is the model's only guide to when to load a skill
- Leaving `hot_reload=True` on in production when you do not need it; it exists for editing skills while the app runs (set `hot_reload=False` to disable)

## Related pages

- [Agent Skills guide](/docs/guides/use-skills): in-depth coverage of all options, validation, and troubleshooting
- [Skills reference](/docs/reference/python/skills): API details
- [Agents and Tools](/docs/concepts/agents-and-tools): how agents, tools and the tool node work together

## Next step

Continue with [Testing](/docs/examples/testing) to add fast unit tests around graphs like this one.
