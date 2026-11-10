---
title: Remote Tools
seoTitle: "Remote tools: run tools in the client"
description: How 10xGraph lets a Python graph request tools that execute in a TypeScript client or browser.
section: Concepts
group: "Platform"
order: 200
updated: "2026-10-08"
---

Remote tools let your agent request capabilities that only exist on the client side. The server defines a trusted schema and validates tool calls, but the client executes the actual implementation. Use this for browser-only tasks like clipboard access, reading selected files, checking DOM state, or getting geolocation data.

## The problem: agent needs client-side capabilities

An agent running on the server cannot access the user's browser or device directly. Tasks like "copy the selected text to the clipboard" or "detect the user's location" require code running in the client's browser context.

You have several options:

- **Local tools:** Run everything on the server. Works for most tasks, but impossible for browser-only operations.
- **Send data to the client first:** Have the client fetch data and send it as context. Adds round trips and is manual.
- **Remote tools:** Define a schema on the server, let the agent request them, and execute them in the client. The cleanest path for client-side capabilities.

## How remote tools work

A remote tool is a contract between the server and client:

1. The **server** defines schemas: tool name, description, and JSON Schema parameter types. These go in `10xgraph.json` or are attached programmatically.
2. The **client** implements handlers: when the server asks for a tool, the client's code runs and sends back the result.
3. The **graph** pauses while waiting for the client result, then resumes with that result in the message context.

Remote tools are validated the same way local tools are. Unknown tool names, invalid schemas, and missing graph nodes fail at startup. The server advertises these schemas to the LLM alongside its own tools, so the model treats them as callable options.

## Two ways to declare remote tools

### Static declaration in configuration

List them in `10xgraph.json` under `remote_tools`. The server loads and validates them when it starts:

```json
{
  "agent": "graph.react:app",
  "remote_tools": [
    {
      "node": "tools",
      "name": "read_clipboard",
      "description": "Read the current clipboard text.",
      "parameters": {
        "type": "object",
        "properties": {},
        "required": []
      }
    },
    {
      "node": "tools",
      "name": "get_location",
      "description": "Get the user's geolocation.",
      "parameters": {
        "type": "object",
        "properties": {
          "timeout_ms": {
            "type": "integer",
            "description": "Timeout in milliseconds"
          }
        },
        "required": []
      }
    }
  ]
}
```

The `node` field (aliased as `node_name` for wire compatibility) specifies which graph node offers the tool. Usually this is a `ToolNode`. Unknown keys or typos fail at startup.

### Programmatic attachment

For code-first graphs, attach remote tools directly:

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

The client uses the `10xgraph-client` SDK to register handlers that match the server schemas by name:

```typescript
import { TenxGraphClient, Message } from "10xgraph-client";

const client = new TenxGraphClient({
  baseUrl: "http://localhost:8000",
  authToken: "your-token",
});

// Register a handler for the read_clipboard tool
client.registerToolHandler("read_clipboard", async () => {
  const text = await navigator.clipboard.readText();
  return { text };
});

// Register a handler for get_location
client.registerToolHandler("get_location", async (params) => {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      (error) => reject(error),
      { timeout: params.timeout_ms || 5000 }
    );
  });
});

// Invoke the agent; handlers are called automatically
const result = await client.invoke([
  Message.text_message("Copy our location to the clipboard"),
]);
```

Handlers receive the tool parameters and must return a serializable object. See the client implementation guide for complete details.

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

Per-run tools use either the flat shape above or the OpenAI function-calling format (`{"type": "function", "function": {...}}`). The `ToolNode` offers them to the model for that run only. A tool name the graph already has (a server tool, an MCP tool, or a configured remote tool) is silently ignored; clients cannot shadow server tools.

**Important:** When serving over the API server, the `remote_tools` config key is server-owned. REST clients cannot set it directly; `/v1/graph/invoke` and `/v1/graph/stream` drop it from the request. The server-side integration can fill it on behalf of authenticated users.

## Execution flow

Remote tool execution follows a clear sequence:

1. **Schema advertisement:** The server advertises remote-tool schemas to the LLM alongside local tools.
2. **Tool call:** The model requests a remote tool (e.g., "read_clipboard").
3. **Pause:** The `ToolNode` returns a `RemoteToolCallBlock` instead of executing it. The graph pauses after the tool node.
4. **Client execution:** Any server tools called in the same step finish first and are saved to the checkpoint. The client sees the `RemoteToolCallBlock` and runs the matching handler.
5. **Resume:** The client sends a `ToolResultBlock` with the result on the same thread. The graph resumes after the tool node, with the result available in the message context.

Both `invoke()` and `stream()` handle this loop automatically. Clients never need to poll or manage the pause/resume cycle manually.

## When to use remote tools

**Use remote tools when:**

- The agent needs a capability that only exists in the browser (clipboard, DOM access, file selection, geolocation).
- You want the server to remain stateless: the client handles all state-dependent logic.
- You trust the client to execute the tool logic; you control both server and client.

**Prefer server-side alternatives when:**

- The task can run on the server (database queries, API calls, file operations on the server).
- You need the server to validate or transform the result before the agent sees it.
- The capability is available via an MCP server; MCP tools execute on the server and are easier to audit.

**Avoid remote tools for:**

- Heavy computation; the client might not have the resources.
- Operations that require elevated server permissions (e.g., modifying protected data).
- Tasks that benefit from server-side caching or deduplication.

## Security considerations

Remote tools create a contract between server and client, so think about trust:

- **Schema validation:** The server validates tool schemas at startup. Invalid definitions fail loudly.
- **No client mutations:** Clients cannot modify the shared graph; per-run tools are scoped to one invocation.
- **Server-owned config:** The API server treats `remote_tools` as server-owned, preventing clients from injecting tools without authorization.
- **Handler implementation:** The client is responsible for implementing handlers securely. A `read_clipboard` handler should respect browser APIs and user permissions.

If you serve multiple tenants, ensure handlers respect isolation boundaries (e.g., a client cannot read another user's clipboard).

## Related concepts and recipes

- **Defining tools:** See the [Agents and tools](/docs/concepts/agents-and-tools) concept to understand how tools fit into the graph, and [`ToolNode` in reference](/docs/reference/python/tools) for the full API.
- **State and messages:** [State and messages](/docs/concepts/state-and-messages) explains how `ToolResultBlock` and `RemoteToolCallBlock` flow through the graph.
- **Client-side implementation:** The [client remote tools guide](/docs/client/remote-tools) walks through registering handlers and handling execution in TypeScript.
- **Server-side setup:** The [server remote tools guide](/docs/server/remote-tools) covers configuration in `10xgraph.json` and how the API server manages them.
