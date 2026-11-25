---
title: Remote Tools
seoTitle: "Remote tools: run tools in the client"
description: How 10xGraph lets a Python graph request tools that execute in a TypeScript client or browser.
section: Concepts
group: "Platform"
order: 200
updated: "2026-11-25"
---

A remote tool is a tool the model calls but the client runs. The server holds the trusted schema; the client (browser or app) runs the handler. Use it for client-only work such as the clipboard, the DOM or geolocation.

## How remote tools work

A remote tool is a contract between the server and client:

1. The **server** defines schemas: tool name, description, and JSON Schema parameter types. These go in `10xgraph.json` or are attached programmatically.
2. The **client** implements handlers: when the server asks for a tool, the client's code runs and sends back the result.
3. The **graph** pauses while waiting for the client result, then resumes with that result in the message context.

The schemas are offered to the model next to the node's own tools.

## Two ways to declare remote tools

### Static declaration in configuration

When you serve the graph, list them in `10xgraph.json` under `remote_tools`; the server validates them and attaches them at startup. See [Server: remote tools](/docs/server/remote-tools).

### Programmatic attachment

Without the server, attach them to the compiled graph. `node` names the `ToolNode` that offers the tool:

```python
from tenxgraph.core.graph import RemoteToolConfig, StateGraph, ToolNode

# Define your remote tool schemas
clipboard_tool = RemoteToolConfig(
    node="tools",
    name="read_clipboard",
    description="Read the current clipboard text.",
)

location_tool = RemoteToolConfig(
    node="tools",
    name="get_location",
    description="Get the user's geolocation.",
    parameters={
        "type": "object",
        "properties": {
            "timeout_ms": {"type": "integer"}
        },
        "required": []
    }
)

# Build your graph (AgentState, my_local_tool and agent are your own)
graph = StateGraph(AgentState)
graph.add_node("tools", ToolNode([my_local_tool]))
graph.add_node("agent", agent)
# ... add edges ...

# Attach remote tools
compiled = graph.compile()
compiled.attach_remote_tools([clipboard_tool, location_tool])
```

## Registering handlers on the client

With `10xgraph-client`, register one handler per tool name with `client.registerToolHandler(name, handler)`; `invoke()` and `stream()` then run the pause and resume loop for you. See [Client: remote tools](/docs/client/remote-tools).

## Per-run client tools

Sometimes a client needs to offer a tool for just one run without modifying the shared graph. Pass `remote_tools` in the run config:

```python
from tenxgraph.core.state import Message

await graph.ainvoke(
    {"messages": [Message.text_message("Change the page background to red")]},
    config={
        "thread_id": "session-1",
        "remote_tools": [
            {
                "name": "change_background",
                "description": "Change the page background color.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "color": {"type": "string", "description": "CSS color value"}
                    },
                    "required": ["color"]
                }
            }
        ]
    }
)
```

Per-run tools use either the flat shape above or the OpenAI function-calling format (`{"type": "function", "function": {...}}`). The `ToolNode` offers them to the model for that run only. A tool name the graph already has (a server tool, an MCP tool, or a configured remote tool) is ignored with a logged warning; clients cannot shadow server tools.

**Over the API server**, `remote_tools` is a server-owned config key: plain REST and WebSocket requests cannot set it. Only the AG-UI endpoint fills it from the AG-UI request, when `ag_ui.allow_client_tools` is on.

## Execution flow

1. **Schema advertisement:** The server advertises remote-tool schemas to the LLM alongside local tools.
2. **Tool call:** The model requests a remote tool (e.g., "read_clipboard").
3. **Pause:** The `ToolNode` returns a `RemoteToolCallBlock` instead of executing it. The graph pauses after the tool node.
4. **Client execution:** Any server tools called in the same step finish first and are saved to the checkpoint. The client sees the `RemoteToolCallBlock` and runs the matching handler.
5. **Resume:** The client sends a `ToolResultBlock` with the result on the same thread. The graph resumes after the tool node, with the result available in the message context.

The TypeScript client's `invoke()` and `stream()` run this loop for you.

## When to use remote tools

**Use remote tools when:**

- The agent needs a capability that only exists in the browser (clipboard, DOM access, file selection, geolocation).
- You trust the client to execute the tool logic; you control both server and client.

**Prefer server-side alternatives when:**

- The task can run on the server (database queries, API calls, file operations on the server).
- You need the server to validate or transform the result before the agent sees it.
- The capability is available via an MCP server; MCP tools execute on the server and are easier to audit.

## Security

The schemas are trusted (set by your code or `10xgraph.json`); a client cannot add tools to the shared graph. The handler runs on the client, so treat its arguments as model output and validate them there.

## Related concepts and recipes

- **Defining tools:** See the [Agents and tools](/docs/concepts/agents-and-tools) concept to understand how tools fit into the graph, and [`ToolNode` in reference](/docs/reference/python/tools) for the full API.
- **State and messages:** [State and messages](/docs/concepts/state-and-messages) explains how `ToolResultBlock` and `RemoteToolCallBlock` flow through the graph.
- **Client-side implementation:** The [client remote tools guide](/docs/client/remote-tools) walks through registering handlers and handling execution in TypeScript.

