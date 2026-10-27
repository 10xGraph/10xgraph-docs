---
title: MCP Client
seoTitle: "MCP client example with FastMCP"
description: "Connect to MCP servers, discover remote tools, and invoke them directly using FastMCP."
section: Examples
group: "Tools and MCP"
order: 110
label: MCP Client
faq:
  - q: "Do I need a graph to call MCP tools?"
    a: "No. The FastMCP Client connects to a server, lists tools and calls them on its own. A graph is only needed when an LLM should choose the tools."
  - q: "Does the example server check the Authorization header?"
    a: "No. The example server accepts any request. The header in the client config shows where credentials go for servers that require them."
updated: "2026-10-27"
---

## What the example shows

The FastMCP `Client` connects to an MCP server, lists its tools with their schemas, and calls one directly, with no graph involved. Use this pattern to inspect a server or call tools from a script, or to learn MCP before wiring it into a 10xGraph agent.

The example pairs a small weather server with a client that lists the tools and calls `get_weather`.

## How to run it

The files are in `examples/react-mcp/`. Install the packages (the client also imports `python-dotenv`), then start the server in one terminal.

```bash
pip install fastmcp python-dotenv
python examples/react-mcp/server.py
```

The server uses the streamable HTTP transport and serves the MCP endpoint at `http://127.0.0.1:8000/mcp`. In a second terminal, run the client.

```bash
python examples/react-mcp/client.py
```

You see the tool name and tags, the full tool definition, then the result of calling `get_weather` for New York.

## The server exposes one tool

The server registers `get_weather` with a description and tags, then runs over streamable HTTP. The tags are what the client later reads from the tool metadata.

```python title="examples/react-mcp/server.py"
from fastmcp import FastMCP


mcp = FastMCP("My MCP Server")


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


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
```

## The client lists and calls the tool

The client declares its servers in a config dict, opens the connection with an async context manager, lists the tools, and calls one by name. The same file is shown whole so you can run it as is.

```python title="examples/react-mcp/client.py"
import asyncio

from dotenv import load_dotenv
from fastmcp import Client
from mcp import Tool


load_dotenv()


# Map server names to connection details.
config = {
    "mcpServers": {
        "weather": {
            "url": "http://127.0.0.1:8000/mcp",
            "transport": "streamable-http",
            "headers": {"Authorization": "Bearer TEST_WEATHER_API_KEY"},
        },
    },
}


client_http = Client(config)


async def call_tools():
    # Discover tools and print their tags and full definitions.
    async with client_http:
        tools: list[Tool] = await client_http.list_tools()
        for i in tools:
            meta = i.meta or {}
            tags = meta.get("_fastmcp", {}).get("tags", [])
            print(f"Tool: {i.name}, Tags: {tags}")

            print(i.model_dump())


async def invoke():
    # Call a tool by name with a dict of arguments.
    async with client_http:
        result = await client_http.call_tool(
            "get_weather",
            {
                "location": "New York",
            },
        )
        print(result)


async def main():
    await call_tools()
    await invoke()


if __name__ == "__main__":
    asyncio.run(main())
```

The first line of output looks like this (example output, the tool definition that follows varies with the FastMCP version):

```text
Tool: get_weather, Tags: ['weather', 'information']
```

The call prints a `CallToolResult` that holds the content, the parsed `structured_content` and `data`, and an `is_error` flag. For this tool, `data` is `{'location': 'New York', 'temperature': '22°C', 'description': 'Sunny'}`.

## What each part does

The example shows three client patterns: configuration, discovery and invocation.

| Pattern | Code | What it does |
|---|---|---|
| Configuration | `Client(config)` | Declares one or more servers by name, each with a URL, transport and optional headers. |
| Discovery | `list_tools()` | Returns `Tool` objects with names, JSON Schema inputs and metadata such as tags. |
| Invocation | `call_tool(name, args)` | Awaits the server's response and returns a `CallToolResult`, not a raw string. |

The example server does not check the `Authorization` header. The header in the config only shows where credentials go for servers that require them.

## When to use this pattern

Use a standalone client to inspect a server's tools before integrating it, to call MCP tools from a script, or to understand MCP mechanics. Do not use it when an LLM should decide which tools to call. In that case plug MCP into a 10xGraph agent, which manages the client for you, as in [MCP ReAct agent](/docs/examples/mcp-react-agent). The server side is covered in [MCP server](/docs/examples/mcp-server).

## Common issues and how to fix them

| Issue | Fix |
|---|---|
| Connection refused | Start the server first and check that the URL in the config matches its host, port and `/mcp` path. |
| 401 or auth errors | Match the headers to what your server expects. The example server needs none. |
| `ModuleNotFoundError` for `fastmcp`, `mcp` or `dotenv` | Run `pip install fastmcp python-dotenv`. |
| Empty tag list | The tool was registered without `tags`, or your FastMCP version stores metadata differently. Print `i.model_dump()` to check. |

## What to try next

Add a second server entry to the `mcpServers` config and list the tools from both. Then move to [MCP ReAct agent](/docs/examples/mcp-react-agent) to let an agent call these tools automatically.
