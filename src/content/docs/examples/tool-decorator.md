---
title: Tool Decorator
seoTitle: Tool decorator metadata
description: Learn how to use the @tool decorator to attach metadata, tags, and capabilities to Python tool functions, plus filter and inspect tools at runtime.
section: Examples
group: Foundations
order: 40
label: Tool Decorator
updated: "2026-10-27"
---

This example demonstrates how to use the `@tool` decorator to enrich tool functions with runtime-queryable metadata: names, descriptions, tags for filtering, capabilities, and arbitrary application data. You'll build a set of decorated tools, sync, async, stateful, and learn to filter them by tag and introspect their metadata from your graph code.

**Source example:** [`examples/tool-decorator/basic_decorator_usage.py`](https://github.com/10xGraph/10xGraph/blob/main/examples/tool-decorator/basic_decorator_usage.py)

## Prerequisites

- Python 3.12 or later
- 10xGraph installed: `pip install 10xgraph`

## How to run the example

Clone the repository and navigate to the example:

```bash
git clone https://github.com/10xGraph/10xGraph.git
cd 10xGraph/examples/tool-decorator
python basic_decorator_usage.py
```

You should see output for basic tool schemas, tag filtering, metadata inspection, and an async tool.

## Why use `@tool`?

Without the decorator, a function registered in a `ToolNode` exposes only its name, docstring, and parameter types to the LLM. The `@tool` decorator lets you attach rich metadata, explicit names, descriptions, tags for runtime filtering, provider hints, capabilities, and arbitrary key-value metadata, that your application code can query at runtime for tool selection, routing, auditing, or access control.

```mermaid
flowchart LR
    A[Python function] -->|@tool decorator| B[Decorated function]
    B -->|ToolNode| C[LLM tool schema]
    B -->|get_tool_metadata| D[Runtime metadata]

    style A fill:#4A90D9,color:#fff
    style B fill:#7B68EE,color:#fff
    style C fill:#50C878,color:#fff
    style D fill:#F5A623,color:#fff
```

## Imports

```python
from tenxgraph.utils import (
    tool,
    get_tool_metadata,
    has_tool_decorator,
    END,
    START,
)
from tenxgraph.core.graph.tool_node import ToolNode
from tenxgraph.core.state import AgentState
```

## Example 1, Basic tool with explicit name

```python
@tool(name="add_numbers")
def add(a: int, b: int) -> int:
    """Add two numbers together."""
    return a + b
```

The `name` parameter overrides the Python function name in the LLM schema. Everything else (description, parameter types) is derived from the docstring and annotations.

## Example 2, Decorator with no arguments (uses function name)

```python
@tool
def multiply(x: int, y: int) -> int:
    """Multiply two numbers together."""
    return x * y
```

When no arguments are provided, `@tool` uses the function name (`multiply`) and docstring as-is.

## Example 3, Full metadata

```python
@tool(
    name="web_search",
    description="Search the web for information using a search engine",
    tags=["search", "web", "external"],
    provider="custom",
    capabilities=["network_access"],
    metadata={"rate_limit": 100, "timeout": 30},
)
def search_web(query: str, max_results: int = 10) -> list[str]:
    """Simulate a web search."""
    return [f"Result {i + 1} for '{query}'" for i in range(max_results)]
```

### Metadata fields

| Field | Type | Description |
|---|---|---|
| `name` | `str` | Name exposed to the LLM in the tool schema |
| `description` | `str` | Description shown to the LLM (defaults to docstring) |
| `tags` | `list[str]` | Arbitrary labels for filtering at runtime |
| `provider` | `str` | Hint about which system provides this tool |
| `capabilities` | `list[str]` | Capability strings (e.g. `"network_access"`, `"database_write"`) |
| `metadata` | `dict` | Arbitrary key-value data for application use |

## Example 4, Async tool

```python
import asyncio

@tool(
    name="fetch_data",
    description="Asynchronously fetch data from a remote API",
    tags=["async", "api", "fetch"],
)
async def fetch_data_async(endpoint: str, timeout: int = 5) -> dict:
    """Fetch data asynchronously from an API endpoint."""
    await asyncio.sleep(0.1)  # simulated I/O
    return {"endpoint": endpoint, "data": "sample data"}
```

`ToolNode` handles async functions automatically. You do not need to change any other part of your graph.

## Example 5, Injectable parameters

Parameters with reserved names (such as `state`, `config` and `tool_call_id`) are **injected automatically** by the framework, matched by parameter name, and do **not** appear in the LLM schema. This lets tools access conversation state without the LLM needing to pass it.

```python
@tool(
    name="stateful_calculator",
    description="Calculator that can access agent state",
    tags=["calculator", "stateful"],
)
def stateful_add(a: int, b: int, state: AgentState | None = None) -> int:
    """The 'state' parameter is injected, it won't appear in the LLM's tool schema."""
    result = a + b
    if state:
        # Access conversation history, custom fields, etc.
        pass
    return result
```

Other injectable names include `tool_call_id` (the call ID from the LLM), `config`, `emit`, `generated_id`, `context_manager`, `publisher`, `checkpointer`, `store` and `task_manager`.

## Registering tools with ToolNode

```python
tool_node = ToolNode([add, multiply, search_web, fetch_data_async, stateful_add])
tools = tool_node.get_local_tool()  # returns list of tool schema dicts

for schema in tools:
    fn = schema["function"]
    print(fn["name"], "-", fn["description"])
```

## Tag-based filtering

At runtime you can request only tools that match a set of tags. A tool with no tags is never filtered out, so untagged tools (such as `add` and `multiply` above) are returned for every tag filter.

```python
# Database-tagged tools, plus any untagged tools
db_tools = tool_node.get_local_tool(tags={"database"})

# Read-tagged tools, plus any untagged tools
read_tools = tool_node.get_local_tool(tags={"read"})

# External-tagged tools, plus any untagged tools
network_tools = tool_node.get_local_tool(tags={"external"})
```

```mermaid
flowchart TD
    A[ToolNode\nadd, multiply, search_web\nread_from_db, write_to_db] -->|tags=database| B[read_from_db\nwrite_to_db]
    A -->|tags=search| C[search_web]
    A -->|tags=read| D[read_from_db]

    style A fill:#7B68EE,color:#fff
    style B fill:#50C878,color:#fff
    style C fill:#F5A623,color:#fff
    style D fill:#4A90D9,color:#fff
```

## Inspecting metadata at runtime

```python
from tenxgraph.utils import has_tool_decorator, get_tool_metadata

# Check if a function was decorated
print(has_tool_decorator(add))          # True
print(has_tool_decorator(lambda x: x)) # False

# Read full metadata
meta = get_tool_metadata(search_web)
print(meta["name"])          # "web_search"
print(meta["tags"])          # {"search", "web", "external"} (a set)
print(meta["capabilities"])  # ["network_access"]
print(meta["metadata"])      # {"rate_limit": 100, "timeout": 30}
```

## Complete source

```python
import asyncio
from tenxgraph.core.graph.tool_node import ToolNode
from tenxgraph.core.state import AgentState
from tenxgraph.utils import END, START, get_tool_metadata, has_tool_decorator, tool

@tool(name="add_numbers")
def add(a: int, b: int) -> int:
    """Add two numbers together."""
    return a + b

@tool
def multiply(x: int, y: int) -> int:
    """Multiply two numbers."""
    return x * y

@tool(
    name="web_search",
    description="Search the web for information",
    tags=["search", "web", "external"],
    metadata={"rate_limit": 100},
)
def search_web(query: str, max_results: int = 10) -> list[str]:
    return [f"Result {i + 1} for '{query}'" for i in range(max_results)]

@tool(name="fetch_data", tags=["async", "api"])
async def fetch_data_async(endpoint: str) -> dict:
    await asyncio.sleep(0.1)
    return {"endpoint": endpoint}

@tool(name="database_read", tags=["database", "read"])
def read_from_db(table: str, record_id: int) -> dict:
    return {"table": table, "id": record_id}

@tool(name="database_write", tags=["database", "write"])
def write_to_db(table: str, data: dict) -> bool:
    return True

if __name__ == "__main__":
    tool_node = ToolNode([add, multiply, search_web, read_from_db, write_to_db])

    # All tools
    print("All tools:", [t["function"]["name"] for t in tool_node.get_local_tool()])

    # Filtered by tag
    print("Database tools:", [t["function"]["name"] for t in tool_node.get_local_tool(tags={"database"})])

    # Metadata inspection
    print("search_web tags:", get_tool_metadata(search_web)["tags"])
```

## Key concepts

| Concept | Details |
|---|---|
| `@tool` | Decorator that attaches metadata to a Python function for use in `ToolNode` |
| `tags` | Arbitrary string labels, stored as a set; filter with `get_local_tool(tags={...})` (untagged tools always pass) |
| Injectable params | Reserved names such as `state`, `config`, `tool_call_id`, supplied by the runtime, hidden from LLM schema |
| `has_tool_decorator` | Returns `True` if a function was wrapped with `@tool` |
| `get_tool_metadata` | Returns the full metadata dict from a decorated function |

## What you learned

- How to use `@tool` with no arguments, with just a name, and with full metadata.
- How to add async tools transparently.
- How to use injectable parameters to give tools access to conversation state.
- How to filter tools by tag at runtime.
- How to introspect tool metadata programmatically.

## Next step

→ [ReAct Agent](/docs/examples/react-agent), build a full ReAct loop with a checkpointer for persistent conversation history.
