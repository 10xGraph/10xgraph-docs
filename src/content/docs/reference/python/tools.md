---
title: Tools
seoTitle: "ToolNode API reference (Python)"
description: "ToolNode, ToolResult, and utilities for tool registration and execution."
section: Reference
group: "Python library"
order: 40
label: Tools
updated: "2026-10-29"
---

ToolNode is a unified registry and executor for Python functions and MCP tools. It automatically generates JSON schemas from type annotations, executes tool calls in parallel, handles errors, and publishes events. Pair it with `Agent` to give LLMs access to callable tools, or use the utilities and decorators to define, inspect, and manage tool metadata.

## Import paths

```python
from tenxgraph.core.graph import ToolNode
from tenxgraph.core.state import ToolResult
from tenxgraph.core.graph.tool_node import UnsupportedToolParameterError, HAS_MCP, HAS_FASTMCP
from tenxgraph.utils import tool, get_tool_metadata, has_tool_decorator
```

---

## ToolNode

A unified registry and executor for callable tools from multiple sources (local functions, MCP servers).

### Constructor

```python
ToolNode(
    tools,
    client=None,
    pass_user_info_to_mcp=False,
    max_result_chars=None,
    mcp_include=None,
    mcp_exclude=None,
    mcp_prefix=None,
    mcp_max_result_chars=None,
    mcp_max_description_chars=None,
    mcp_cache_tools=True,
    mcp_connect_timeout=30.0,
)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `tools` | `Iterable[Callable]` | **required** | Local Python functions to register. Each is registered under its `__name__`. Pass an empty list when only serving MCP tools. |
| `client` | `fastmcp.Client \| None` | `None` | MCP client for remote tool access. Requires `pip install "10xgraph[mcp]"`. |
| `pass_user_info_to_mcp` | `bool` | `False` | Forward the run config's `user` dict to MCP tool calls as request metadata (`meta`), readable on the server as `ctx.request_context.meta`. It is not sent as a tool argument. It logs a warning if the client's `call_tool` has no `meta` parameter. |
| `max_result_chars` | `int \| None` | `None` | Cap on the text a local tool returns. Longer text is cut and a marker is appended, so one huge result is not saved to state and re-sent to the model every turn. `None` means no cap. |
| `mcp_include` | `Iterable[str] \| None` | `None` | Allow-list of MCP tool names. Only these are shown to the model and callable. `None` means every tool the server lists. |
| `mcp_exclude` | `Iterable[str] \| None` | `None` | MCP tool names to hide and refuse, applied after `mcp_include`. |
| `mcp_prefix` | `str \| None` | `None` | String put in front of every MCP tool name the model sees (for example `"github_"`), so two `ToolNode`s can expose servers that share a tool name. It is removed again before the server call. `mcp_include` and `mcp_exclude` match the server's own names, without the prefix. |
| `mcp_max_result_chars` | `int \| None` | `None` | Cap on the text of one MCP tool result. Longer output is cut and a marker is appended. `None` means no cap. |
| `mcp_max_description_chars` | `int \| None` | `None` | Cap on an MCP tool description, which is sent to the model on every call. A longer description is cut and ends in `...`. `None` means no cap. |
| `mcp_cache_tools` | `bool` | `True` | List the server's tools once per `ToolNode` and reuse the list, which saves a connect, ping and list round trip per model call. Set `False` to list the server every time. See [MCP tool list caching](#mcp-tool-list-caching). |
| `mcp_connect_timeout` | `float \| None` | `30.0` | Seconds to wait for the MCP connection to open. Only the connect is bounded, never a tool call. If the connect times out, the tool call fails like any other tool error (the model sees a generic failure and the log says `MCP connect timed out after ...s`), and a tool listing that times out returns no MCP tools and is not cached. `None` waits without a limit. |

`tools` may also be a generator. If a different callable is registered under the name of an existing tool, `ToolNode` logs a warning and the new one replaces the old.

**Argument coercion.** Arguments the model sends are coerced against the tool's type hints in lax mode. A value that converts cleanly is converted: `"5"` for an `int` becomes `5`, and a number for a `str` becomes a string. Unknown extra keys are ignored. A value that cannot convert (`"abc"` for an `int`) is not run: the model gets a failed tool result and the tool does not execute.

**Raises:** `TypeError` when an item in `tools` is not callable; `ImportError` when a `client` is given but the MCP packages are not installed.

### Methods

| Method | Signature | Returns | Description |
|---|---|---|---|
| `invoke` | `await invoke(name: str, args: dict, tool_call_id: str, config: dict, state: AgentState)` | `Message` | Execute a single tool call by name. Returns a `Message` with the result or error information (the signature also allows a dict). |
| `all_tools` | `await all_tools(tags: set[str] \| None = None, config: dict \| None = None)` | `list[dict]` | Async method returning JSON schemas for all registered tools, optionally filtered by tags. |
| `all_tools_sync` | `all_tools_sync(tags: set[str] \| None = None, config: dict \| None = None)` | `list[dict]` | Synchronous version of `all_tools`. |
| `add_tool` | `add_tool(tool: Callable)` | `None` | Register one more function after construction. Raises `TypeError` if it is not callable. |
| `refresh_mcp_tools` | `await refresh_mcp_tools()` | `list[dict]` | Drop the cached MCP tool list, fetch it from the server again and return the JSON schemas. Returns `[]` when there is no MCP client. |

### MCP tool list caching

By default a `ToolNode` fetches the MCP server's tool list once and reuses it for the life of the node. Tools that you add to the server later do not appear, and removed tools stay listed, until you refresh. A failed listing is never cached, so a server that was down at the first call is listed again on the next one.

```python
tool_node = ToolNode([], client=client)

# After you deploy new tools to the MCP server:
schemas = await tool_node.refresh_mcp_tools()
```

If your server changes its tools while the process runs and you want every model call to see the change, construct the node with `mcp_cache_tools=False`. That costs a connect, ping and list round trip per model call.

### Example

```python title="tool_node_example.py"
from tenxgraph.core.graph import Agent, ToolNode


def lookup_order(order_id: str) -> dict:
    """Look up an order by ID."""
    return {"order_id": order_id, "status": "shipped"}


def refund_order(order_id: str, amount: float) -> dict:
    """Refund an order."""
    return {"refund_id": "R-1", "amount": amount}


# Register local functions; each is exposed under its __name__
tool_node = ToolNode([lookup_order, refund_order])

# Inspect the JSON schemas the model will see
schemas = tool_node.all_tools_sync()
print(len(schemas))  # 2

# Add another tool after construction
def cancel_order(order_id: str) -> dict:
    """Cancel an order."""
    return {"order_id": order_id, "status": "cancelled"}

tool_node.add_tool(cancel_order)

# Give the tools to an agent; also add tool_node to your StateGraph as a node
agent = Agent(model="gpt-4o", provider="openai", tool_node=tool_node)
```

To wire the agent, the tool node and the routing edges into a graph, see [Define custom tools with @tool](/docs/guides/use-tool-decorator).

---

## ToolResult

Return type for tool functions that need to update graph state and return a message to the AI.

### Constructor

```python
ToolResult(message=None, state=None, is_error=False, *, content=None)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `message` | `Any` | `None` | The text response to return to the AI. `content` is accepted as an alias. |
| `state` | `dict[str, Any] \| None` | `None` | Dict mapping state field names to new values. Only fields present are updated. |
| `is_error` | `bool` | `False` | If True, marks the result as a failed tool call (status="failed"). |
| `content` | `Any` | `None` | Alias for `message`; ignored if `message` is provided. |

### Example

```python
from tenxgraph.core.state import ToolResult, AgentState

class MyState(AgentState):
    jd_name: str = ""

def update_context(state: MyState, jd_name: str) -> ToolResult:
    return ToolResult(
        message=f"JD name updated to '{jd_name}'",
        state={"jd_name": jd_name},
    )
```

---

## tool decorator

Mark a function as a tool with metadata for schema generation and filtering.

### Signature

```python
@tool(
    _func=None,
    *,
    name: str | None = None,
    description: str | None = None,
    tags: list[str] | set[str] | None = None,
    provider: str | None = None,
    capabilities: list[str] | None = None,
    metadata: dict[str, Any] | None = None,
    parameters: dict[str, Any] | None = None,
)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `name` | `str \| None` | `None` | Tool name. If None, uses the function's `__name__`. `@tool("name")` also works as the name form. `@tool` works on bound methods too. |
| `description` | `str \| None` | `None` | Tool description. If None, uses the function's docstring, or "No description provided." when there is none. |
| `tags` | `list[str] \| set[str] \| None` | `None` | Tags for categorizing and filtering tools. Examples: `["search", "web"]`. |
| `provider` | `str \| None` | `None` | Provider or source of the tool (e.g., "local", "mcp", "composio"). |
| `capabilities` | `list[str] \| None` | `None` | Capabilities or permissions required by the tool. Examples: `["read_files", "network_access"]`. |
| `metadata` | `dict[str, Any] \| None` | `None` | Additional arbitrary metadata for the tool. |
| `parameters` | `dict[str, Any] \| None` | `None` | Explicit JSON Schema dict for parameters. Bypasses automatic schema generation. |

**Returns:** The decorated function with metadata attached as private attributes (`_py_tool_*`). The function behaves identically to the original.

**Raises:** `ValueError` if the decorated object is not callable or if `parameters` is provided but not a dict.

### Example

```python
from tenxgraph.core.graph import ToolNode
from tenxgraph.utils import tool

@tool(name="lookup_order", tags=["search", "orders"])
def find_order(order_id: str) -> dict:
    """Look up an order by ID."""
    return {"order_id": order_id, "status": "shipped"}

@tool(tags=["write", "payments"])
async def refund_order(order_id: str, amount: float) -> dict:
    """Refund an order."""
    return {"refund_id": "R-1", "amount": amount}

tool_node = ToolNode([find_order, refund_order])
```

---

## get_tool_metadata

Extract all tool metadata from a decorated function.

### Signature

```python
get_tool_metadata(func: Callable) -> dict[str, Any]
```

| Parameter | Type | Description |
|---|---|---|
| `func` | `Callable` | A function that may have been decorated with `@tool`. |

**Returns:** Dict with keys: `name`, `description`, `tags` (set), `provider`, `capabilities`, `metadata`, `parameters`. Unset values are `None`; `tags` is an empty set when unset.

### Example

```python
from tenxgraph.utils import tool, get_tool_metadata

@tool(name="my_tool", tags=["test"])
def example():
    """Example function."""
    pass

metadata = get_tool_metadata(example)
print(metadata["name"])  # "my_tool"
print(metadata["tags"])  # {"test"}
```

---

## has_tool_decorator

Check if a function has been decorated with `@tool`.

### Signature

```python
has_tool_decorator(func: Callable) -> bool
```

| Parameter | Type | Description |
|---|---|---|
| `func` | `Callable` | The function to check. |

**Returns:** True if the function has been decorated with `@tool`, False otherwise.

### Example

```python
from tenxgraph.utils import tool, has_tool_decorator

@tool
def decorated():
    pass

def not_decorated():
    pass

print(has_tool_decorator(decorated))      # True
print(has_tool_decorator(not_decorated))  # False
```

---

## UnsupportedToolParameterError

Raised when a tool parameter annotation cannot be expressed as a portable JSON Schema.

Supported annotations are `str`, `int`, `float`, `bool`, common stdlib scalars (`datetime`, `date`, `time`, `UUID`, `Path`, `Decimal`, `bytes`), `Optional`, `list`, `dict`, `Literal`, `Enum` subclasses, pydantic models and dataclasses, and nestings of those. Anything else, including `TypedDict`, raises this error when schemas are built. Pass `@tool(parameters=...)` to supply a hand-written schema instead.

Subclasses `TypeError` so existing `except TypeError` handlers around tool registration continue to work.

### Example

```python
from tenxgraph.core.graph.tool_node import UnsupportedToolParameterError

from typing import TypedDict

from tenxgraph.core.graph import ToolNode


class Options(TypedDict):
    verbose: bool


def bad_tool(options: Options) -> str:
    """A tool whose parameter (a TypedDict) is not supported."""
    return "ok"


try:
    # Schemas are built from annotations; unsupported ones raise this error
    schemas = ToolNode([bad_tool]).all_tools_sync()
except UnsupportedToolParameterError as e:
    print(f"Cannot register tool: {e}")
```

---

## HAS_MCP and HAS_FASTMCP

Boolean flags indicating whether the Model Context Protocol and FastMCP packages are installed.

Use these to conditionally enable MCP features without importing optional dependencies:

```python
from tenxgraph.core.graph import ToolNode
from tenxgraph.core.graph.tool_node import HAS_MCP, HAS_FASTMCP


def my_function(text: str) -> str:
    """Echo text."""
    return text


if HAS_FASTMCP and HAS_MCP:
    from fastmcp import Client

    client = Client("http://localhost:8000/mcp")  # replace with your MCP server
    tools = ToolNode([my_function], client=client)
else:
    print('MCP support requires: pip install "10xgraph[mcp]"')
    tools = ToolNode([my_function])
```

---

## Per-tool access control

Scopes guard API routes. Inside a tool you have the run config, the authenticated user and the authorization helpers, so you decide what each tool may do. A tool receives these by naming the parameter, and they are not shown to the model:

`tool_call_id`, `state`, `config`, `emit`, `generated_id`, `context_manager`, `publisher`, `checkpointer`, `store`, `task_manager`.

```python
from tenxgraph.core.authz import get_authz, has_scope
from tenxgraph.core.state import ToolResult
from tenxgraph.utils import tool


@tool
def delete_record(record_id: str, config: dict) -> ToolResult | str:
    """Delete a record."""
    if not has_scope(config, "records:delete"):
        return ToolResult(message="You do not have permission to delete records.", is_error=True)
    user_id = (get_authz(config) or {}).get("user_id")
    return f"Record {record_id} deleted by {user_id}."
```

Return a `ToolResult` with `is_error=True` to refuse in words the model can relay. A raised exception reaches the model only as a generic failure with a reference. See [Control access inside a tool](/docs/guides/authorization-scopes#control-access-inside-a-tool) for the full guide, including the no-auth and empty-scope cases.

---

## Related guides

For task-focused guidance on using tools, see:
- [Define custom tools with @tool](/docs/guides/use-tool-decorator)
- [Use MCP servers](/docs/guides/use-mcp)
- [Emit tool progress updates](/docs/guides/emit-tool-progress)
- [Prebuilt tools](/docs/guides/prebuilt-tools)
