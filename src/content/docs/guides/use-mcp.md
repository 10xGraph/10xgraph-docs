---
title: Use MCP tools in agents
description: Connect 10xGraph agents to MCP servers and mix local Python tools with remote MCP tools in a single graph.
section: "Build agents"
group: "Tools and MCP"
order: 210
label: MCP tools
updated: "2026-10-29"
faq:
  - q: "Can I use MCP tools without a local Python function?"
    a: "Yes. Pass an empty list to ToolNode(tools=[]) and provide the MCP client. The graph will offer only the MCP server's tools."
  - q: "Do MCP tools run in parallel like local tools?"
    a: "Yes. The LLM can request multiple MCP tools in one turn, and ToolNode executes them concurrently."
  - q: "How do I test MCP tools without a real server?"
    a: "Use MockMCPClient from tenxgraph.qa.testing. It simulates an MCP client and tracks tool calls for assertions."
---

10xGraph integrates with [Model Context Protocol (MCP)](https://modelcontextprotocol.io) servers, allowing your agents to call tools exposed by remote MCP servers alongside local Python functions. The Model Context Protocol is an open standard for LLM tool integration, maintained by Anthropic, letting you compose tools from multiple sources seamlessly.

This guide covers connecting an MCP server, invoking its tools from a graph, testing with mock clients, and mixing MCP tools with local tools. After completing it, your agent will be able to execute both local and remote tools in the same workflow.

## Prerequisites

Install the MCP extra to add fastmcp and mcp libraries:

```bash
pip install "10xgraph[mcp,openai]"
```

The samples use `gpt-4o` and need `OPENAI_API_KEY`. The final example uses Google and needs `pip install "10xgraph[mcp,google-genai]"`.

## Step 1: Create an MCP client

The `fastmcp.Client` class connects to MCP servers and fetches their available tools. It supports three transport modes: a config dict (for multiple servers or HTTP), a local subprocess (stdio), or a remote URL. Choose the one that matches your server.

### Using a config dict for multiple servers or HTTP

If your MCP server is accessed over HTTP or you need to configure multiple servers at once, use a dict with the server config:

```python
from fastmcp import Client

config = {
    "mcpServers": {
        "github": {
            "url": "https://api.githubcopilot.com/mcp/",
            "headers": {"Authorization": "Bearer YOUR_GITHUB_TOKEN"},
            "transport": "streamable-http",
        },
        "filesystem": {
            "command": "python",
            "args": ["mcp_filesystem_server.py"],
        },
    }
}

client = Client(config)
```

### Using a stdio subprocess server

To run an MCP server as a subprocess on your machine, pass the path of the server script and fastmcp starts it over stdio:

```python
from fastmcp import Client

# Starts the server and communicates over stdio
client = Client("my_mcp_server.py")
```

### Using a remote HTTP server

For an MCP server listening on HTTP, pass the URL directly:

```python
from fastmcp import Client

client = Client("https://my-mcp-server.example.com/mcp")
```

## Step 2: Wire the MCP client into ToolNode

Create a `ToolNode` and pass the MCP client. The `ToolNode` queries the client for available tools each time the Agent prepares its tool list before calling the LLM. It pings the server first and offers no MCP tools if the ping fails.

```python
from tenxgraph.core.graph import ToolNode

tool_node = ToolNode(
    tools=[],       # no local tools, or add them here
    client=client,
)
```

The first argument `tools` is a list of local Python functions (or empty if you have none). The `client` is the MCP client created in the previous step.

## Step 3: Build and wire the graph

The graph structure is identical to one using local tools. Create an `Agent` that uses the `ToolNode`, add it to the graph alongside a routing function, and compile:

```python
from tenxgraph.core.graph import StateGraph, Agent, ToolNode
from tenxgraph.core.state import AgentState, Message
from tenxgraph.utils import END

tool_node = ToolNode(tools=[], client=client)

agent = Agent(
    model="gpt-4o",
    system_prompt=[{"role": "system", "content": "You are a helpful assistant."}],
    tool_node=tool_node,
)

def should_use_tools(state: AgentState) -> str:
    """Route to tools if the agent requested them."""
    last = state.context[-1] if state.context else None
    if last and last.role == "assistant" and getattr(last, "tools_calls", None):
        return "tools"
    return END

graph = StateGraph()
graph.add_node("agent", agent)
graph.add_node("tools", tool_node)
graph.add_conditional_edges("agent", should_use_tools, {"tools": "tools", END: END})
graph.add_edge("tools", "agent")
graph.set_entry_point("agent")

app = graph.compile()
```

## Step 4: Invoke the agent

Call the compiled graph with a message. The agent will see the MCP tools available and call them when appropriate:

```python
result = app.invoke(
    {"messages": [Message.text_message("List the latest commits in owner/repo-name.")]},
    config={"thread_id": "mcp-demo-1"},
)
print(result["messages"][-1].content)
```

Verify that the agent used the MCP tools by checking the message history for `ToolCallBlock` and `ToolResultBlock` entries.

## Mixing local and remote tools

You can register both local Python functions and MCP tools in the same `ToolNode`. The runtime automatically routes each tool call to the correct backend (local or remote):

```python
from tenxgraph.prebuilt.tools import safe_calculator

# Local function
def my_custom_tool(query: str) -> str:
    return f"Custom result: {query}"

# Both local and MCP tools available
tool_node = ToolNode(
    tools=[safe_calculator, my_custom_tool],
    client=client,
)
```

When the LLM requests a tool, `ToolNode` runs it on the MCP client if the name is one of the MCP tools it listed, otherwise it runs the local function. A local function and an MCP tool must not share a name. `ToolNode` raises `ValueError` when an MCP tool has the same name as a local or remote tool, so rename one of them.

## Forwarding user context to MCP

Many MCP servers need to know who is calling them (for access control, logging, or per-user state). Set `pass_user_info_to_mcp=True` on `ToolNode` to send the `user` dict from the execution config to the MCP server. It is sent as request metadata (`meta`) on the MCP call, not as a tool argument, and the server reads it from `ctx.request_context.meta`. If the client's `call_tool` has no `meta` parameter, a warning is logged and the user info is not sent. If `config` has no `user` dict but has a `user_id`, the server receives `{"user_id": ...}` instead.

```python
tool_node = ToolNode(
    tools=[],
    client=client,
    pass_user_info_to_mcp=True,
)
```

The MCP server reads it from the request metadata, not from a tool argument. Declare a `ctx: Context` parameter on the server tool. FastMCP injects it and it is not part of the schema the model sees. The user dict is under the key `user` in `ctx.request_context.meta`, which keeps extra fields in `model_extra`:

```python
# Code on the MCP server (fastmcp)
from fastmcp import Context, FastMCP

mcp = FastMCP("secure")

@mcp.tool()
def secure_action(query: str, ctx: Context) -> str:
    meta = ctx.request_context.meta
    user = (meta.model_extra or {}).get("user") if meta else None
    user = user or {}
    if "admin" not in user.get("roles", []):
        raise PermissionError(f"User {user.get('id')} does not have permission")
    return f"Action completed by {user.get('id')}"
```

Pass the user dict in the invoke config. When requests go through the 10xGraph API server with authentication, the server sets `config["user"]` for you. When you call the graph directly, pass it yourself:

```python
result = app.invoke(
    {"messages": [Message.text_message("Do something.")]},
    config={
        "thread_id": "mcp-auth-1",
        "user": {"id": "user-123", "name": "Alice", "roles": ["admin"]},
    },
)
```

## Tune how a `ToolNode` uses an MCP server

These `ToolNode` options bound what an MCP server can put in front of the model. All are optional.

```python
tool_node = ToolNode(
    tools=[],
    client=client,
    mcp_prefix="github_",             # the model sees github_create_issue, the server gets create_issue
    mcp_max_result_chars=20_000,      # cut one tool result at 20,000 characters
    mcp_max_description_chars=500,    # cut each tool description at 500 characters
    mcp_cache_tools=True,             # default: list the server's tools once
    mcp_connect_timeout=30.0,         # default: seconds to wait for the connection to open
)
```

- **Prefix.** `mcp_prefix` lets two `ToolNode`s expose servers that have a tool with the same name. `mcp_include` and `mcp_exclude` still use the server's own names.
- **Size caps.** A result over `mcp_max_result_chars` is cut and a marker with the number of dropped characters is appended. A description over `mcp_max_description_chars` is cut and ends in `...`. Descriptions go to the model on every call, so a long one costs tokens each turn. Neither cap has a default.
- **Tool list caching.** The tool list is fetched once per `ToolNode` and reused. Tools you add to the server later are not seen until you call `await tool_node.refresh_mcp_tools()`, or you build the node with `mcp_cache_tools=False` to list the server on every model call. A listing that fails is not cached.
- **Connect timeout.** `mcp_connect_timeout` bounds only the connect, never a tool call. Set `None` to wait without a limit.

To check what an MCP tool returns before the model reads it, register an `after_invoke` callback for `InvocationType.MCP`. See [Validate tool, MCP and RAG output](/docs/guides/protect-against-prompt-injection#validate-tool-mcp-and-rag-output). The `END` event of a tool call, which publishers and the run trace see, carries the value `after_invoke` returned, not the raw MCP result.

## Filtering MCP tools by tag

MCP servers can tag their tools with metadata. If the server supports it, you can filter which tools are offered to the Agent using `tools_tags` on the `Agent`. MCP tools are matched against the server's fastmcp tags:

```python
agent = Agent(
    model="gpt-4o",
    tool_node=tool_node,
    tools_tags={"read"},   # only expose tools tagged "read"
)
```

The Agent will only see MCP tools that share at least one of the specified tags. Local tools registered with `@tool(tags=[...])` are filtered the same way; untagged local tools are always offered.

## Testing MCP tools without a server

To test your graph with MCP tools without running an actual MCP server, use `MockMCPClient` from `tenxgraph.qa.testing`. It simulates tool execution and tracks calls for assertions:

```python
import pytest
from tenxgraph.qa.testing import MockMCPClient
from tenxgraph.core.graph import ToolNode, StateGraph, Agent
from tenxgraph.core.state import Message
from tenxgraph.utils import END

# Set up mock client
mock_client = MockMCPClient()
mock_client.add_tool(
    name="search",
    description="Search for information",
    parameters={"query": {"type": "string"}},
    handler=lambda query: f"Results for: {query}",
)

# Create ToolNode with mock client
tool_node = ToolNode(tools=[], client=mock_client)

# Build graph (same as before)
agent = Agent(
    model="gpt-4o",
    system_prompt=[{"role": "system", "content": "You are helpful."}],
    tool_node=tool_node,
)

def should_use_tools(state) -> str:
    last = state.context[-1] if state.context else None
    if last and last.role == "assistant" and getattr(last, "tools_calls", None):
        return "tools"
    return END

graph = StateGraph()
graph.add_node("agent", agent)
graph.add_node("tools", tool_node)
graph.add_conditional_edges("agent", should_use_tools, {"tools": "tools", END: END})
graph.add_edge("tools", "agent")
graph.set_entry_point("agent")

app = graph.compile()

# Test the graph
result = app.invoke(
    {"messages": [Message.text_message("Search for AI trends.")]},
    config={"thread_id": "test-1"},
)

# Verify the tool was called
mock_client.assert_called("search")
assert mock_client.call_count("search") == 1

# Check the arguments
call = mock_client.get_last_call("search")
assert "AI trends" in call["arguments"]["query"]
```

`MockMCPClient` provides helper methods for testing:
- `add_tool(name, description, parameters, handler)`: Register a mock tool
- `was_called(name)`: Check if a tool was invoked
- `call_count(name)`: Get the number of times a tool was called
- `get_calls(name)`: Get all calls to a tool
- `get_last_call(name)`: Get the most recent call with its arguments
- `assert_called(name)`: Assert a tool was called (raises if not)
- `assert_called_with(name, **args)`: Assert a tool was called with specific arguments
- `reset()`: Clear call history but keep tool registrations
- `clear()`: Remove all tools and call history

## Using ReactAgent with MCP

`ReactAgent` is a prebuilt agent that includes tool calling built-in. Pass the MCP client directly:

```python
from tenxgraph.prebuilt.agent import ReactAgent

agent = ReactAgent(
    model="gpt-4o",
    tools=[],
    client=client,
    pass_user_info_to_mcp=True,
)
app = agent.compile()
```

Invoke it the same way as the manual graph:

```python
result = app.invoke(
    {"messages": [Message.text_message("Search for the latest news.")]},
    config={"thread_id": "react-mcp-1"},
)
```

## Complete example: GitHub MCP integration

This example builds a complete agent that uses the GitHub MCP server to read repository information:

```python
import os
from fastmcp import Client
from tenxgraph.core.graph import StateGraph, Agent, ToolNode
from tenxgraph.core.state import AgentState, Message
from tenxgraph.storage.checkpointer import InMemoryCheckpointer
from tenxgraph.utils import END

# Configure the GitHub MCP server
mcp_config = {
    "mcpServers": {
        "github": {
            "url": "https://api.githubcopilot.com/mcp/",
            "headers": {"Authorization": f"Bearer {os.environ['GITHUB_TOKEN']}"},
            "transport": "streamable-http",
        },
    }
}

client = Client(mcp_config)
tool_node = ToolNode(tools=[], client=client)

agent = Agent(
    model="gemini-2.0-flash",
    provider="google",
    system_prompt=[{"role": "system", "content": "You are a helpful GitHub assistant."}],
    tool_node=tool_node,
    trim_context=True,
)

def should_use_tools(state: AgentState) -> str:
    last = state.context[-1] if state.context else None
    if last and last.role == "assistant" and getattr(last, "tools_calls", None):
        return "tools"
    return END

graph = StateGraph()
graph.add_node("agent", agent)
graph.add_node("tools", tool_node)
graph.add_conditional_edges("agent", should_use_tools, {"tools": "tools", END: END})
graph.add_edge("tools", "agent")
graph.set_entry_point("agent")

app = graph.compile(checkpointer=InMemoryCheckpointer())

result = app.invoke(
    {"messages": [Message.text_message("List the latest commits in the 10xgraph repo.")]},
    config={"thread_id": "github-1", "recursion_limit": 10},
)
print(result["messages"][-1].content)
```

## What you learned

- Install `pip install "10xgraph[mcp]"` to enable MCP support.
- Create an MCP client with `fastmcp.Client(config_dict)`, `Client(stdio_command)`, or `Client(http_url)`.
- Pass the client to `ToolNode(tools=[], client=client)` to offer MCP tools to your agent.
- Mix local and MCP tools in the same `ToolNode`; the runtime routes each call appropriately.
- Forward user context to MCP servers with `pass_user_info_to_mcp=True`.
- Filter MCP tools by tag with `tools_tags` on the `Agent`.
- Test MCP tools without a real server using `MockMCPClient`.

## Run it in production

MCP servers run with whatever access you give them, and a tool name that clashes with another tool raises `ValueError` at setup. Pin and review the servers your graph connects to before exposing the agent. See the [Security model](/docs/production/security-model) and [What 10xGraph does not protect](/docs/production/limits).

## Next steps

- [Build a graph](/docs/guides/build-a-graph) for complete graph construction and routing.
- [Configure Agent](/docs/guides/configure-agent) for all Agent options that work alongside MCP.
- [Use the tool decorator](/docs/guides/use-tool-decorator) to write custom local tools.
- [Test and evaluate](/docs/testing/unit-tests) to integrate MCP tests into your test suite.
