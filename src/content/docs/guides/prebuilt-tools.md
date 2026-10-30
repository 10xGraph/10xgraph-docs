---
title: Use prebuilt tools
description: "Ready-made production tools: fetch URLs, calculate safely, read and search files, search the web, manage memory, and transfer between agents."
section: "Build agents"
group: "Tools and MCP"
order: 170
label: Prebuilt tools
updated: "2026-10-27"
faq:
  - q: "Can I mix prebuilt tools with custom tools?"
    a: "Yes. Pass all tools to a single ToolNode. Prebuilt and custom tools coexist without conflict."
  - q: "How do I filter which tools an agent sees?"
    a: "Use Agent(..., tools_tags={\"tag_name\"}) to expose only tools with that tag. Tags are defined per tool."
  - q: "Are prebuilt tools safe to expose to LLMs?"
    a: "Yes. safe_calculator blocks code execution, fetch_url restricts to public hosts, and file tools enforce workspace boundaries."
---

10xGraph ships a library of production-ready tools in `tenxgraph.prebuilt.tools`. Each tool is designed to be safe, well-bounded, and easy to compose. Add them to any graph by passing them to a `ToolNode` or prebuilt agent.

## Overview

The prebuilt tools address common needs: web requests, arithmetic, file operations, search, long-term memory, and multi-agent handoffs. You can use them individually, mix them with custom tools, and control which tools each agent exposes with tags.

## Installation

The tools are part of the core package. `google_web_search` and `vertex_ai_search` need the `google-genai` extra, and the examples below that name a model need that provider's extra (for example `pip install "10xgraph[openai]"`).

```python
from tenxgraph.prebuilt.tools import (
    fetch_url,
    file_read,
    file_write,
    file_search,
    safe_calculator,
    google_web_search,
    vertex_ai_search,
    make_user_memory_tool,
    make_agent_memory_tool,
    create_handoff_tool,
)
```

## Safe arithmetic with safe_calculator

The `safe_calculator` tool evaluates arithmetic expressions safely using Python's `ast` module, exposing only math without code execution. It enforces strict size and value limits to prevent abuse.

### Use safe_calculator

```python
from tenxgraph.core.state import Message
from tenxgraph.prebuilt.agent import ReactAgent
from tenxgraph.prebuilt.tools import safe_calculator

agent = ReactAgent(
    model="gpt-4o",
    tools=[safe_calculator],
    system_prompt=[{
        "role": "system",
        "content": "You are a math assistant. Use safe_calculator for all arithmetic."
    }],
)

app = agent.compile()

result = await app.ainvoke(
    {"messages": [Message.text_message("What is (123 * 456) / 7?")]},
    config={"thread_id": "t1"},
)
```

### Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `expression` | `str` | required | Arithmetic expression, e.g. `"(3 + 4) * 2"` |
| `precision` | `int \| None` | `None` | Round float results to this many decimal places (0-12) |

### Return value

Success:
```json
{"result": 14}
```

Error:
```json
{"error": "division by zero"}
```

### Supported operators

`+`, `-`, `*`, `/`, `//`, `%`, `**` (power). Unary `+` and `-` are also supported.

### Safety limits

| Limit | Value |
|---|---|
| Maximum expression length | 500 characters |
| Maximum absolute value (inputs and result) | 10¹² |
| Maximum power exponent | 12 |
| Infinity / NaN | rejected |

### Combining with other tools

```python
from tenxgraph.prebuilt.tools import safe_calculator, google_web_search
from tenxgraph.prebuilt.agent import ReactAgent

agent = ReactAgent(
    model="gemini-2.5-flash",
    tools=[safe_calculator, google_web_search],
    system_prompt=[{
        "role": "system",
        "content": (
            "You are a research assistant. Search the web for facts, "
            "then use safe_calculator for computations."
        ),
    }],
)

app = agent.compile()
```

## Fetch URLs with fetch_url

`fetch_url` retrieves the text of a public HTTP or HTTPS URL. It only connects to globally routable addresses, re-checks every redirect hop (at most 5), connects to the address it checked, ignores proxy environment variables, strips HTML to text, and truncates to `max_chars` (default and cap 20000). On failure it returns a JSON object with an `error` key. Tags: `["web", "fetch", "network"]`.

To limit the hosts the model can reach, build the tool with `create_fetch_url(allowed_hosts)`. It takes host names or globs such as `docs.example.com` or `*.example.com`, matched ignoring case, and checks the list on the first request and on every redirect hop. An empty list raises `ValueError`.

Parameters, the response shape and common errors are in the [web tools guide](/docs/guides/prebuilt/web-tools#fetch_url-fetch-and-parse-web-pages).

## File tools: read, write, search

`file_read`, `file_write` and `file_search` give an agent controlled access to one directory. Paths stay inside the root, and secret files (`.env`, `*.pem`, `.git-credentials`, `*.tfstate`, `*.tfvars`, anything under `.ssh` or `.git`) are hidden and refused with the same `path is not allowed` error whether or not they exist. Tags: `["file", "filesystem", "search"]`.

For a graph that serves requests, build the tools with `create_file_tools(root)` so the root is fixed in code and the run config cannot move it:

```python
from tenxgraph.core.graph import ToolNode
from tenxgraph.prebuilt.tools import create_file_tools

file_read, file_write, file_search = create_file_tools("/path/to/allowed/dir")
tool_node = ToolNode([file_read, file_search])  # read-only: leave file_write out
```

Parameters, return formats, the full list of hidden patterns, `deny=` and limits are in the [file tools guide](/docs/guides/prebuilt/file-tools).

## Web search: google_web_search and vertex_ai_search

`google_web_search` searches the public web with Gemini Google Search grounding. `vertex_ai_search` searches a private Vertex AI Search datastore. Both need `pip install "10xgraph[google-genai]"` and Google Cloud credentials, and both default to `gemini-2.5-flash`. Tags: `["web", "search", "google"]` and `["search", "google", "vertex_ai"]`.

The model chooses `datastore` and `model` on the module-level tools. To fix them in code, build the tools with `create_google_web_search(model)` and `create_vertex_ai_search(datastore, model)`; the model cannot change them. Parameters and examples are in the [web tools guide](/docs/guides/prebuilt/web-tools).

## Memory tools

Memory tools integrate with 10xGraph's long-term memory system, letting agents remember facts about users and themselves. For most cases, use `Agent(..., memory=MemoryConfig(...))` to inject memory tools automatically; the factories below are useful when you need manual control. They are the only memory tools; there is no general-purpose `memory_tool`.

### make_user_memory_tool and make_agent_memory_tool

Factories that create the tools injected by `Agent(..., memory=MemoryConfig(...))`. Call them directly only when you need custom configuration.

```python
from tenxgraph.core.graph import ToolNode
from tenxgraph.prebuilt.tools import make_user_memory_tool, make_agent_memory_tool
from tenxgraph.storage.store import MemoryConfig, OpenAIEmbedding, create_local_qdrant_store

store = create_local_qdrant_store("./qdrant_data", OpenAIEmbedding())
config = MemoryConfig(store=store)
user_tool = make_user_memory_tool(config)
agent_tool = make_agent_memory_tool(config)

tool_node = ToolNode([user_tool, agent_tool])
```

The typical pattern is to let the `Agent` class handle memory tool injection:

```python
from tenxgraph.prebuilt.agent import ReactAgent
from tenxgraph.storage.store import MemoryConfig, OpenAIEmbedding, create_local_qdrant_store

store = create_local_qdrant_store("./qdrant_data", OpenAIEmbedding())

agent = ReactAgent(
    model="gpt-4o",
    memory=MemoryConfig(store=store),
)
```

## Multi-agent handoffs with create_handoff_tool

Transfer control from one agent to another in swarm or supervisor-team patterns.

```python
from tenxgraph.prebuilt.tools import create_handoff_tool
from tenxgraph.core.graph import ToolNode

transfer_to_billing = create_handoff_tool(
    agent_name="billing",
    description="Transfer the user to the billing agent for payment questions.",
)

tool_node = ToolNode([transfer_to_billing])
```

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `agent_name` | `str` | Name of the target agent node in the graph. |
| `description` | `str \| None` | Description shown to the LLM to decide when to hand off. Optional; defaults to `Transfer control to <agent_name> agent`. |

The tool uses a naming convention (`transfer_to_<agent_name>`) that the graph execution layer detects and intercepts, routing to the target agent without executing the tool itself. See [Handoff between agents](/docs/guides/handoff-between-agents) for the full guide.

## Tag reference

Use tags to expose only certain tools to an agent:

| Tool | Tags |
|---|---|
| `fetch_url` | `["web", "fetch", "network"]` |
| `safe_calculator` | `["math", "calculator"]` |
| `file_read` | `["file", "filesystem", "read"]` |
| `file_write` | `["file", "filesystem", "write"]` |
| `file_search` | `["file", "filesystem", "search"]` |
| `google_web_search` | `["web", "search", "google"]` |
| `vertex_ai_search` | `["search", "google", "vertex_ai"]` |

### Filter tools by tag

```python
from tenxgraph.prebuilt.agent import ReactAgent
from tenxgraph.prebuilt.tools import (
    fetch_url,
    safe_calculator,
    google_web_search,
)

agent = ReactAgent(
    model="gpt-4o",
    tools=[fetch_url, safe_calculator, google_web_search],
    tools_tags={"search"},  # Expose only tools tagged with "search"
)
```

In this example, only `google_web_search` is available to the agent because it has the `"search"` tag.

## Compose prebuilt and custom tools

Prebuilt tools work seamlessly with custom tools in a single `ToolNode`.

```python
from tenxgraph.prebuilt.tools import fetch_url, safe_calculator
from tenxgraph.core.graph import Agent, ToolNode
from tenxgraph.utils.decorators import tool

@tool(name="get_weather", tags=["weather"])
async def get_weather(city: str) -> str:
    """Get the current weather in a city."""
    return f"Temperature in {city} is 72F and sunny."

tool_node = ToolNode([
    fetch_url,
    safe_calculator,
    get_weather,
])

agent = Agent(
    model="gpt-4o",
    tool_node=tool_node,
)
```

## Common patterns

### Research agent

Combine web fetching, searching, and calculation for fact-finding tasks:

```python
agent = ReactAgent(
    model="gpt-4o",
    tools=[fetch_url, google_web_search, safe_calculator],
    system_prompt=[{
        "role": "system",
        "content": (
            "You are a research agent. Use google_web_search to find facts, "
            "fetch_url to read full articles, and safe_calculator for computations."
        ),
    }],
)
```

### File assistant

Give an agent read/write/search access to a codebase or document set:

```python
agent = ReactAgent(
    model="gpt-4o",
    tools=[file_read, file_write, file_search],
    system_prompt=[{
        "role": "system",
        "content": (
            "You are a code assistant. Use file tools to navigate the repository, "
            "read code, and suggest edits."
        ),
    }],
)
```

## Verify tools work

After adding tools to an agent, run a quick test to verify they are callable:

```python
from tenxgraph.core.state import Message

app = agent.compile()
result = await app.ainvoke(
    {"messages": [Message.text_message("What is 2 + 2?")]},
    config={"thread_id": "test"},
)
print(result["messages"][-1])
```

The agent should call `safe_calculator` and return the result.

## Troubleshooting

### "ImportError: cannot import safe_calculator"

Ensure 10xgraph is installed:
```bash
pip install 10xgraph
```

### "fetch_url fails with hostname resolution"

The tool blocks private IPs (10.x, 192.168.x, 127.x, etc.), and it checks every redirect hop again, so a public URL that redirects to a private address is refused too. Ensure the URL is publicly accessible.

### "File tool says path is outside workspace root"

File tools enforce a security boundary. Confirm the path is relative to the tools' root. Set the root in code with `create_file_tools`; passing `file_tool_root` or `workspace_root` in the run config is deprecated and removed in 0.11:

```python
file_read, file_write, file_search = create_file_tools("/path/to/allowed/dir")
result = file_read("relative/path.txt")
```

### "google_web_search says SDK is not installed"

Install the Google GenAI extra:
```bash
pip install "10xgraph[google-genai]"
```

Then set Google Cloud credentials:
```bash
export GOOGLE_API_KEY=your-key
# or
export GOOGLE_APPLICATION_CREDENTIALS=path/to/credentials.json
```

## Run it in production

Tools that reach outside the process (`fetch_url`, file tools) are the ones to review before you expose an agent. Fix the file root in code with `create_file_tools`, and read what the server does and does not guard in the [Security model](/docs/production/security-model) and [What 10xGraph does not protect](/docs/production/limits).

## Related pages

- [Web tools guide](/docs/guides/prebuilt/web-tools): In-depth coverage of `fetch_url`, `google_web_search`, and `vertex_ai_search`.
- [File tools guide](/docs/guides/prebuilt/file-tools): Details on `file_read`, `file_write`, and `file_search`.
- [Memory tools guide](/docs/guides/prebuilt/memory-tools): Using memory for long-term user and agent facts.
- [Handoff between agents](/docs/guides/handoff-between-agents): Multi-agent patterns with `create_handoff_tool`.
- [Build custom tools](/docs/guides/use-tool-decorator): Writing your own tools with the `@tool` decorator.
