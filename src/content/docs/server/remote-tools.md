---
title: "Remote tools"
description: "Configure client-executed tools on the server: define them in 10xgraph.json, attach them to graph nodes, and let clients run them."
order: 100
group: "Interfaces"
section: "API server"
updated: "2026-11-25"
faq:
  - question: "Can a client call a tool that isn't registered as a remote tool?"
    answer: "No. The server only presents remote tools from 10xgraph.json to the model. If ag_ui.allow_client_tools is true, AG-UI clients can bring their own tools for that run, but plain REST/WebSocket callers cannot. See the AG-UI documentation for per-run client tools."
  - question: "What if the model calls a remote tool that the client hasn't registered?"
    answer: "The client's ToolExecutor returns a failed tool result with the error \"Tool '<name>' not found\", which goes back to the graph as a tool error. The model can then retry or handle the failure."
  - question: "Are remote tools secure for untrusted clients?"
    answer: "The tool schemas are trusted: they are defined server-side in 10xgraph.json and attached to the graph at startup. The handler still runs in the caller's environment, so treat its arguments as untrusted model output and validate them in the client handler."
---

Remote tools are trusted tool schemas configured on the server that the model can call but the client executes. This page covers server-side setup: how to declare remote tools in 10xgraph.json, attach them to graph nodes, and verify they are available when the model runs.

## Why remote tools

A remote tool runs client-side code, browser APIs, local databases, user-specific resources, that the server must not execute. The model calls them by name as if they were server tools; the framework routes the call to the client, the client runs the handler, and returns the result to the graph.

Use remote tools when your task needs:

- Browser capabilities (geolocation, clipboard, localStorage, DOM)
- Desktop APIs (native file dialogs, system notifications)
- Client-side only state or secrets (API keys the user owns, not the server)
- Integration with the client's framework or app state

Do not use remote tools for logic that belongs on the server: business data fetching, authentication, rate limiting, or audit logging. Keep server-critical operations server-side.

## Declaring remote tools in 10xgraph.json

Remote tools are defined in the `remote_tools` array at the root of 10xgraph.json. Each tool has a node name (the graph ToolNode that carries it), a name, a description, and parameter schemas in JSON Schema format.

```json title="10xgraph.json"
{
  "agent": "graph:app",
  "remote_tools": [
    {
      "node": "TOOL",
      "name": "get_user_location",
      "description": "Get the user's current location using the browser geolocation API.",
      "parameters": {
        "type": "object",
        "properties": {
          "timeout_ms": {
            "type": "number",
            "description": "Maximum time to wait for location in milliseconds."
          }
        },
        "required": []
      }
    },
    {
      "node": "TOOL",
      "name": "read_clipboard",
      "description": "Read text from the user's clipboard.",
      "parameters": {
        "type": "object",
        "properties": {},
        "required": []
      }
    }
  ]
}
```

### Field reference

- **`node`** (string, required): The name of the `ToolNode` in your graph that carries this tool (for example "TOOL"). It must be a `ToolNode`; attaching to any other node fails at startup. The tool schemas are attached only to this node.

- **`name`** (string, required): The tool's name, as the model will call it. Must not be blank, and must be unique across all remote tools. The model invokes it as `tool_name`, not `node_name:tool_name`.

- **`description`** (string, required): What the tool does. The model reads this to decide whether to use the tool. Be specific: "reads user's clipboard" not just "clipboard". Minimum 1 character; blank values are rejected.

- **`parameters`** (object, optional): JSON Schema for the tool's inputs. Defaults to `{"type": "object", "properties": {}, "required": []}` (a tool that takes no arguments). The schema must be an object type; array or scalar parameters are not supported. The `properties` object maps parameter names to JSON Schema type descriptors. The `required` array lists required parameter names.

  ```json
  "parameters": {
    "type": "object",
    "properties": {
      "min_accuracy": {
        "type": "number",
        "description": "Minimum accuracy in meters"
      },
      "high_accuracy": {
        "type": "boolean",
        "description": "Request high-accuracy location"
      }
    },
    "required": ["high_accuracy"]
  }
  ```

## How remote tools reach the graph

When the server starts, it reads `remote_tools` from 10xgraph.json, validates each one, groups them by node name, and calls `CompiledGraph.attach_remote_tools(schemas, node_name)` for each group. This registers the tool schemas on that `ToolNode`, so the model is offered them alongside the node's server tools.

At runtime, when a request arrives:

1. The server loads the graph and its attached remote tools.
2. The model runs. If it decides to invoke a remote tool, it emits a tool call with the tool name and arguments.
3. The server's ToolNode sees the call targets a remote tool (not a server tool) and emits a remote tool call block instead of running it.
4. The run ends and the tool call reaches the client in the response stream (HTTP) or WebSocket message.
5. The client's ToolExecutor looks up the registered handler by tool name, runs it with the arguments, and builds a tool result message.
6. The client sends the result back in a follow-up request on the same thread, and the graph resumes with it.

With `TenxGraphClient`, `invoke()` and `stream()` run this loop for you; you only register handlers.

## Setting up the client

With the TypeScript client, register a handler per tool with `client.registerToolHandler(name, handler)`; see [Client: remote tools](/docs/client/remote-tools).

For Python clients or direct HTTP/WebSocket calls, the client framework (or your code) is responsible for routing tool calls to the appropriate handler. The server emits remote tool calls in the stream; you must listen for them, run the tool, and send a tool result message back on the same thread.

## Validation and constraints

The server validates remote tool configurations at startup. Configuration errors will prevent the server from starting:

- `remote_tools` must be a list, and unknown fields on a tool are rejected.
- `node`, `name` and `description` must be non-blank strings.
- Remote tool names must be unique across the whole list.
- `parameters.type` must be `"object"`, `properties` must be an object and `required` a list of strings.
- The `node` must exist in the compiled graph and be a `ToolNode`.

If validation or attachment fails, the server fails to start. Run `10xgraph audit` to check the config file before starting, and read the `10xgraph dev` output for the message.

## Troubleshooting

**Server won't start, error mentions "remote_tools"**

Check that:
- `remote_tools` is an array (not an object).
- Each tool has non-empty `node`, `name`, and `description` strings.
- The `node` name matches a `ToolNode` in your compiled graph. `client.graph()` (GET `/v1/graph`) lists the nodes.
- `parameters` (if present) has type "object", an object `properties`, and a `required` list of strings.
- Run `10xgraph audit` to validate the file.

**Model doesn't call the remote tool**

- Confirm the tool was attached: `client.graphTools()` lists the tools the graph offers.
- Check your graph's system prompt or routing logic. The model decides whether to call a tool from its description and your prompt.
- Check server logs for "Attached X configured remote tools" to confirm attachment succeeded.

**Client error: "Tool not registered"**

- Ensure you called `client.registerToolHandler(name, handler)` for every remote tool before calling `stream()` or `invoke()`. The error text is `Tool '<name>' not found`.
- Verify the handler name matches exactly (case-sensitive).

**Tool runs but returns wrong result**

- On the server, check that the result from the client was properly returned to the graph.

## Related pages

- [Concepts: Remote tools](/docs/concepts/remote-tools): the conceptual model and use cases.
- [Client: Remote tools](/docs/client/remote-tools): how the TypeScript client executes them.
- [Guide: Send media](/docs/guides/send-media): if your remote tools transfer files or media.
- [Reference: Configuration](/docs/reference/api-cli/configuration): full 10xgraph.json schema.
