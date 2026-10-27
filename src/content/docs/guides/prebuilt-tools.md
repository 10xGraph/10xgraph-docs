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

The `fetch_url` tool retrieves the text content of public HTTP/HTTPS URLs. It blocks private and loopback IP addresses, enforces timeouts, and truncates long responses to prevent context overflow.

### Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `url` | `str` | required | Public HTTP/HTTPS URL to fetch. |
| `timeout` | `float` | `10.0` | Request timeout in seconds (clamped to 1-30). |
| `max_chars` | `int` | `20000` | Maximum characters to return (capped at 20000). |

### Return value

```json
{
  "url": "https://example.com",
  "status_code": 200,
  "content_type": "text/html",
  "content": "...",
  "truncated": false
}
```

On failure the tool returns a JSON object with an `error` key instead, for example `{"error": "URL host is not public or could not be resolved"}` or `{"error": "HTTP error: 404", "status_code": 404}`.

### Security

- Blocks private IPs, loopback (127.x), link-local, multicast, and reserved ranges
- Allows only `http` and `https` schemes
- Enforces a maximum timeout of 30 seconds
- Strips HTML markup, extracting text only
- Truncates responses longer than `max_chars`

### Tags

`["web", "fetch", "network"]`

## File tools: read, write, search

The file tools (`file_read`, `file_write`, `file_search`) provide controlled access to the local filesystem. All three enforce that paths stay within the configured workspace root, preventing escape attempts. They also hide secret files such as `.env`, `*.pem` and anything under `.ssh` or `.git`, and refuse them with the same `path is not allowed` error whether or not the file exists.

For a graph that serves requests, build the tools with `create_file_tools(root)` instead of passing the module-level functions. The root is fixed in code, so the run config cannot move it, and you can add patterns with `deny=` or drop the defaults with `use_default_deny=False`. See the [file tools guide](/docs/guides/prebuilt/file-tools) for the full list of hidden patterns.

### file_read: Read files

Read UTF-8 text files with optional line ranges.

```python
from tenxgraph.prebuilt.tools import file_read
from tenxgraph.core.graph import ToolNode, Agent

tool_node = ToolNode([file_read])

agent = Agent(
    model="gpt-4o",
    tool_node=tool_node,
)
```

**Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `path` | `str` | required | Relative or absolute path to the file. |
| `start_line` | `int` | `1` | 1-based starting line (inclusive). |
| `end_line` | `int` | `0` | 1-based ending line (inclusive); 0 means end of file. |
| `max_chars` | `int` | `20000` | Maximum characters to return (capped at 20000). |
| `config` | `dict` | `None` | Injected run config; `file_tool_root` or `workspace_root` sets the root (default: current directory). |

**Return value:**

```json
{
  "path": "src/main.py",
  "start_line": 1,
  "end_line": 10,
  "content": "...",
  "truncated": false
}
```

**Tags:** `["file", "filesystem", "read"]`

### file_write: Write and append

Write UTF-8 text files with three modes.

**Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `path` | `str` | required | Path to write to. |
| `content` | `str` | required | Text content to write. |
| `mode` | `str` | `"create"` | `"create"` (fail if exists), `"overwrite"` (replace), `"append"`. |
| `create_dirs` | `bool` | `False` | Create parent directories if they do not exist. Content is limited to 200,000 characters. |
| `config` | `dict` | `None` | Injected run config; `file_tool_root` or `workspace_root` sets the root. |

**Return value:**

```json
{
  "status": "written",
  "path": "output.txt",
  "bytes": 1024,
  "mode": "create"
}
```

**Tags:** `["file", "filesystem", "write"]`

### file_search: Find files and lines

Search files by name and content.

**Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `query` | `str` | required | Search string for filename or content match. |
| `path` | `str` | `""` | Root directory to search from (relative to workspace root). |
| `glob` | `str` | `"**/*"` | Glob pattern for files to include. |
| `max_results` | `int` | `20` | Maximum results to return (capped at 100). |
| `config` | `dict` | `None` | Injected run config; `file_tool_root` or `workspace_root` sets the root. |

**Return value:**

```json
{
  "query": "search_term",
  "root": ".",
  "results": [
    {
      "path": "src/main.py",
      "match_type": "filename",
      "line": null,
      "preview": "main.py"
    },
    {
      "path": "src/config.py",
      "match_type": "content",
      "line": 42,
      "preview": "search_term appears on this line..."
    }
  ]
}
```

**Tags:** `["file", "filesystem", "search"]`

## Web search: google_web_search and vertex_ai_search

These tools leverage Google's models to search the public web or a private Vertex AI Search datastore.

### google_web_search

Search the public web with Gemini Google Search grounding, which returns both a grounded answer and supporting search metadata.

**Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `query` | `str` | required | Search query string. |
| `model` | `str` | `"gemini-2.5-flash"` | Gemini model to use for grounding. |
| `max_chars` | `int` | `20000` | Maximum characters in the response (capped at 20000). |

Requires: `pip install "10xgraph[google-genai]"` and Google Cloud credentials (GOOGLE_API_KEY or Application Default Credentials).

**Tags:** `["web", "search", "google"]`

### vertex_ai_search

Search a Vertex AI Search datastore with Gemini grounding. Useful for querying proprietary documents or internal knowledge bases.

**Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `query` | `str` | required | Search query string. |
| `datastore` | `str` | required | Full Vertex AI Search datastore resource path. |
| `model` | `str` | `"gemini-2.5-flash"` | Gemini model to use for grounding. |
| `max_chars` | `int` | `20000` | Maximum characters in the response. |

Requires: `pip install "10xgraph[google-genai]"`, Google Cloud project, and a Vertex AI Search datastore.

**Tags:** `["search", "google", "vertex_ai"]`

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

The tool blocks private IPs (10.x, 192.168.x, 127.x, etc.). Ensure the URL is publicly accessible.

### "File tool says path is outside workspace root"

File tools enforce a security boundary. Confirm the path is relative to the configured workspace root (default: current working directory). You can override via the `config` parameter:

```python
result = file_read(
    "relative/path.txt",
    config={"workspace_root": "/path/to/allowed/dir"}
)
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

## Related pages

- [Web tools guide](/docs/guides/prebuilt/web-tools): In-depth coverage of `fetch_url`, `google_web_search`, and `vertex_ai_search`.
- [File tools guide](/docs/guides/prebuilt/file-tools): Details on `file_read`, `file_write`, and `file_search`.
- [Memory tools guide](/docs/guides/prebuilt/memory-tools): Using memory for long-term user and agent facts.
- [Handoff between agents](/docs/guides/handoff-between-agents): Multi-agent patterns with `create_handoff_tool`.
- [Build custom tools](/docs/guides/use-tool-decorator): Writing your own tools with the `@tool` decorator.
