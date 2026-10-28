---
title: MCP Server
seoTitle: MCP server example with FastMCP
description: Expose Python tools over Model Context Protocol using FastMCP so 10xGraph and other MCP clients can call them remotely.
section: Examples
group: Tools and MCP
order: 100
label: MCP Server
updated: "2026-10-27"
---

This example turns a Python function into a remotely callable tool with FastMCP, a Python library for building Model Context Protocol servers. The server exposes the tool over HTTP, so 10xGraph graphs and other MCP clients can discover it and call it by name.

## What the example shows

A small but complete MCP server that wraps a weather function as a discoverable, remotely callable tool. The server listens on HTTP and handles tool listing and execution requests from MCP clients.

Model Context Protocol (MCP) is an open protocol that standardizes how applications call tools and access resources. Instead of each application implementing its own tool invocation system, MCP provides a single interface: clients list tools, the server responds with schema and metadata, and clients invoke tools by name with arguments. This example demonstrates the server side of that exchange.

This example is one half of the MCP pair. See the [MCP Client](/docs/examples/mcp-client) example for the client side. Together, they show how a graph can use remote tools without hosting them in the same process.

## How to run it

The example is at `examples/react-mcp/server.py` in the 10xGraph repository.

Install FastMCP:

```bash
pip install fastmcp
```

The `fastmcp` package is the only requirement for the server; it does not need 10xGraph installed. Then run the server:

```bash
cd examples/react-mcp
python server.py
```

The [MCP Client](/docs/examples/mcp-client) example connects to `http://127.0.0.1:8000/mcp` with the `streamable-http` transport, so start the server first.

## The code walked through

### Create a named MCP server

The first step is to instantiate a FastMCP server with a name:

```python title="examples/react-mcp/server.py"
from fastmcp import FastMCP

mcp = FastMCP("My MCP Server")
```

The name identifies the server to clients during the MCP handshake.

### Register a tool

Tools are registered with the `@mcp.tool()` decorator. The decorator exposes the function as a discoverable, remotely invokable tool and builds its input schema from the function's type hints:

```python title="examples/react-mcp/server.py"
@mcp.tool(
    description="Get the weather for a specific location",
    tags={"weather", "information"},
    exclude_args=["user_details"],
)
def get_weather(location: str, user: dict | None = None) -> dict:
    print(f"User Details: {user}")
    return {
        "location": location,
        "temperature": "22°C",
        "description": "Sunny",
    }
```

Key parts:
- `description` tells clients what the tool does.
- `tags` let clients filter or categorize tools.
- `exclude_args` lists parameter names to hide from the public tool schema. See the note below on how the example's value relates to its `user` parameter.

### Run the server

The `mcp.run()` call starts the server with a specified transport:

```python title="examples/react-mcp/server.py"
if __name__ == "__main__":
    mcp.run(transport="streamable-http")
```

The `streamable-http` transport serves MCP over HTTP, so clients connect by URL instead of launching the server as a subprocess.

## What happens when a client connects

When an MCP client connects to the server, two things can happen:

1. **List tools**: The client sends `list_tools()` and the server responds with the schema and metadata of all registered tools.

2. **Call a tool**: The client sends `call_tool("get_weather", {"location": "New York"})`. The server executes the Python function and returns the result as a structured MCP tool response.

The full request/response flow looks like this:

```
Client
  |
  +----> list_tools()
  |      <---- tool schema + metadata
  |
  +----> call_tool("get_weather", {"location": "New York"})
  |      <---- structured result
```

## Why this matters for 10xGraph

`ToolNode` accepts an MCP `client` argument, so a graph can call tools served by a FastMCP server as if they were local. This means you can:

- Keep tools in a separate process or service.
- Share tools across multiple agents.
- Manage tool authentication and versioning independently.
- Use standardized tool discovery and invocation.

## Common patterns

### Excluding arguments from the tool schema

The `exclude_args` option in `@mcp.tool()` hides named parameters from the schema clients see, which keeps internal values out of the public contract. In the example file the list is `["user_details"]`, but the function parameter is named `user`, so the names do not match. To hide `user`, set `exclude_args=["user"]`.

### Tool metadata and discovery

The `description` and `tags` you provide in the decorator directly influence how clients see and use the tool. A well-written description helps clients understand the tool's purpose. Tags let clients filter tools by category or capability. FastMCP reads the type hints from the function signature, so the model sees the parameter names and types.

### Error handling

Keep tool functions small and raise clear exceptions for bad input. The client receives a failed tool result instead of the server process stopping. Check the FastMCP documentation for the exact error format your version returns.

## What to try next

Run the [MCP Client](/docs/examples/mcp-client) example to see how to connect to this server, list its tools, and invoke them.

You can also consult:
- [Use MCP](/docs/guides/use-mcp) for how to wire an MCP client into a graph's `ToolNode`.
- [GitHub MCP](/docs/examples/github-mcp) for a more complex MCP example that connects to GitHub.
- [Guides: Tools and MCP](/docs/guides#tools-and-mcp) for the full set of tool and MCP documentation.
