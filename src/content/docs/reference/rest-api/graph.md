---
title: Graph endpoints
seoTitle: "Graph REST API reference"
description: "Reference for the 10xGraph REST endpoints that invoke, stream, stop, and inspect a graph, with request bodies, responses, and auth requirements."
section: Reference
group: "REST API"
order: 310
label: Graph
updated: "2026-10-27"
---

The graph endpoints run your compiled graph over HTTP and WebSocket: invoke it for a complete result, stream it chunk by chunk, stop or repair a thread, and inspect the graph's nodes, tools, and state schema. This page lists each route with its permission, request body, and response.

Routes sit under `/v1/graph`, and every response wraps its payload in `{"success": true, "data": ...}`.

## Route summary

| Method | Path | Permission |
| --- | --- | --- |
| `POST` | `/v1/graph/invoke` | `graph:invoke` |
| `POST` | `/v1/graph/stream` | `graph:stream` |
| `POST` | `/v1/graph/stop` | `graph:stop` |
| `POST` | `/v1/graph/fix` | `graph:fix` |
| `GET` | `/v1/graph` | `graph:read` |
| `GET` | `/v1/graph/tools` | `graph:read` |
| `GET` | `/v1/graph:StateSchema` | `graph:read` |
| `GET` | `/v1/observability/{thread_id}` | `graph:read` |
| `WS` | `/v1/graph/ws` | `graph:stream` |
| `WS` | `/v1/graph/live` | `graph:stream` |

`/v1/observability/{thread_id}` is documented in [Observability](/docs/reference/rest-api/observability) and `WS /v1/graph/live` in [Live WebSocket](/docs/reference/rest-api/live).

---

## POST /v1/graph/invoke

Run the graph and return the complete result when all nodes finish.

**Request body:**

```json
{
  "messages": [
    {
      "role": "user",
      "content": "What is the capital of France?"
    }
  ],
  "config": {
    "thread_id": "my-thread-1"
  }
}
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `messages` | array | yes, unless `resume` is set | One or more messages to append to state before invoking. |
| `resume` | any | no | Answer for a thread paused by [`interrupt()`](/docs/guides/add-human-approval). The paused node runs again and `interrupt()` returns this value; `null` means cancelled. Send it only to resume a paused thread. |
| `interrupt_id` | string | no | The `id` of the interrupt `resume` answers. Take it from `execution_meta.interrupt_data.interrupt.id` in the thread state. If the thread is not paused, or is paused at a different interrupt, the request gets `409` before anything runs. Ignored without `resume`. |
| `on_busy` | string | no | `wait` (default) or `cancel`. What to do when another run is active on the thread (see [One run per thread](#one-run-per-thread)). |
| `initial_state` | object | no | Initial state for the run. Custom fields and `current_node` are allowed; built-in fields are not (see input rules below). |
| `config` | object | no | Run configuration |
| `config.thread_id` | string | no | Id of an existing thread to continue. When absent or blank, the server starts a new thread, generates its id and persists it; the id comes back in `data.meta.thread_id`. With the default `runs.thread_ids` of `server`, an id that does not exist answers `403`. See [`runs.thread_ids`](/docs/reference/api-cli/configuration#thread_ids). |
| `config.remote_tools` | - | - | Server-owned: dropped from client config, along with `user`, `user_id`, `authz`, `collection` and `_`-prefixed keys. A client cannot choose a memory collection; it is ignored, not refused. See [Collections](/docs/concepts/memory-and-store#collections-keeping-data-apart). |
| `recursion_limit` | integer | no | Maximum graph iterations. Default `25`, range `1`-`100`. |
| `response_granularity` | string | no | `full`, `partial`, or `low`. Default `low`. |

**Input rules.** The server refuses these with `422`:

- A message with role `assistant` or `system`. Clients send user messages only.
- A `tool` message that is not made of `tool_result` blocks, or that does not answer a remote tool call waiting for a result.
- `context_summary` or `execution_meta` in `initial_state`. Clients can never write these built-in fields.
- A `current_node` in `initial_state` that is not a node in the graph.
- A state value whose type does not match the state field. The error names the field.

Custom state fields are allowed. If the operator set `runs.state_keys` in `10xgraph.json`, only the listed keys are accepted. The server replaces any `message_id` you send with its own. The same rules apply to `POST /v1/graph/stream` and the WebSocket.

**Size limits.** At most 500 messages per request, 100 content blocks per message, and 1,000,000 characters of text in total across text blocks. A request over a limit gets `422` with a message that names the limit, in development and production alike. The limits are fixed and apply to invoke, stream and the WebSocket (`messages` and `tool_result`), and to `PUT /v1/threads/{id}/state` `context` and `POST /v1/threads/{id}/messages`. [AG-UI](/docs/reference/rest-api/ag-ui#request-size-limits) applies them to the trailing turn.

Messages may carry image and document content blocks referencing an uploaded `file_id`. Those references are resolved before the graph runs; see [Multimodal and vision](/docs/server/files-and-multimodal).

**Response:**

```json
{
  "data": {
    "messages": [
      {"role": "user", "content": [{"type": "text", "text": "What is the capital of France?"}]},
      {"role": "assistant", "content": [{"type": "text", "text": "The capital of France is Paris."}]}
    ]
  },
  "metadata": {"request_id": "...", "timestamp": "...", "message": "OK"}
}
```

| `data` field | Description |
| --- | --- |
| `messages` | Final processed messages from the graph. Always present. |
| `state` | State from the run, or `null`. |
| `context` | Context messages, or `null`. |
| `summary` | Summary text, or `null`. |
| `meta` | Run metadata such as `thread_id`, or `null`. How much is filled in depends on `response_granularity`. |

### One run per thread

The server runs one graph run at a time on a thread. A second run on a busy thread waits up to 30 seconds for the first to finish, then the request is rejected with `409` in the standard error body:

```json
{
  "error": {"code": "HTTPException", "message": "thread is busy", "details": []},
  "metadata": {"request_id": "...", "timestamp": "...", "message": "thread is busy"}
}
```

On invoke and stream, this answer comes before the response starts. A new thread (no `thread_id` in the request) is locked as soon as its id exists. The lock is shared across processes when Redis is configured, and per process otherwise. It expires on its own if a worker dies, and is released when the run ends, fails, is cancelled or the client disconnects. `/v1/graph/live` is not covered.

Set `on_busy` to `"cancel"` to stop the running run (the same mechanism as [`POST /v1/graph/stop`](#post-v1graphstop)) and start the new one. The 30-second wait limit and the `409` still apply if the old run does not stop in time.

### Resume answers

A request with `resume` can fail two ways, both before the graph runs:

| Status | Cause |
| --- | --- |
| `409` | `interrupt_id` was sent and the thread is not paused, or is paused at a different interrupt. |
| `422` | The answer fails the interrupt's `response_schema`. |

The schema check supports `type`, `enum`, `properties`, `required` and `items`. Other keywords are ignored. A `null` answer (cancel) is never checked. See [Interrupts](/docs/concepts/interrupts#bind-a-resume-to-its-interrupt).

---

## POST /v1/graph/stream

Run the graph and stream one JSON-encoded `StreamChunk` per line.

**Request body:** Same as `/v1/graph/invoke`, including `resume`, `interrupt_id`, `on_busy` and the size limits.

A busy thread (`409`) and an `interrupt_id` mismatch (`409`) are answered before the stream starts, as a normal HTTP error. Failures once the stream is running arrive as an `error` chunk. With `MODE=production`, the text in an `error` chunk's `data` (`reason`, `error` or `message`) is replaced by the same generic message invoke uses, such as `An error occurred in a graph node.`; development shows the details. The built-in text for an unexpected tool failure (`Tool '<name>' failed with an internal error (reference <id>).`) is kept, because it holds no detail.

**Response:** `Content-Type: text/event-stream`

Despite the content type, the body is **not** SSE-framed. There are no `data:` prefixes and no
blank-line separators. It is newline-delimited JSON, so split the body on newlines rather than
using `EventSource` or an SSE client library.

```
{"event": "message", "message": {"role": "assistant", "content": [{"type": "text", "text": "The capital"}]}, "thread_id": "t1", ...}
{"event": "message", "message": {"role": "assistant", "content": [{"type": "text", "text": " of France is Paris."}]}, "thread_id": "t1", ...}
{"event": "updates", "data": {"status": "done"}, "thread_id": "t1", ...}
```

### StreamChunk fields

| Field | Type | Description |
| --- | --- | --- |
| `event` | `string` | Chunk discriminator. One of `message`, `state`, `updates`, `error`. |
| `message` | `object \| null` | Populated when `event` is `message`. A full `Message` with a `content` block list. |
| `state` | `object \| null` | Populated when `event` is `state`. The current `AgentState`. |
| `data` | `object \| null` | Populated for `updates` (for example `{"status": "done"}`) and `error` (for example `{"reason": "..."}`). |
| `thread_id` | `string \| null` | Thread this chunk belongs to. |
| `run_id` | `string \| null` | Run this chunk belongs to. |
| `metadata` | `object \| null` | Additional per-chunk metadata. |
| `timestamp` | `number` | UNIX timestamp of chunk creation. |

Tool activity arrives as ordinary `message` chunks whose `content` carries `tool_call` and
`tool_result` blocks. There are no separate `tool_call` or `done` event types.

---

## POST /v1/graph/stop

Cancel an in-progress graph execution.

**Request body:**

```json
{
  "thread_id": "my-thread-1",
  "config": {}
}
```

**Response:**

```json
{
  "data": {"ok": true, "running": true},
  "metadata": {"request_id": "...", "timestamp": "...", "message": "OK"}
}
```

The request records a stop flag on the thread, and the running graph checks it between nodes, so the current node finishes first. When nothing is running the call still succeeds, with `running: false` (`reason: "no-state"`) or `ok: false` (`reason: "no-checkpointer"`). Stopping needs a checkpointer. A stop request belongs to the run it targets: starting a new run on the thread does not clear a stop meant for a run that is still going.

---

## GET /v1/graph

Get metadata about the loaded graph: its nodes, edges, and an `info` block describing how the server is wired.

**Response:**

```json
{
  "data": {
    "info": {
      "node_count": 2,
      "edge_count": 3,
      "is_realtime": false,
      "checkpointer": true,
      "checkpointer_type": "PgCheckpointer",
      "publisher": false,
      "store": false,
      "interrupt_before": null,
      "interrupt_after": null,
      "context_type": null,
      "id_generator": "SnowFlakeIdGenerator",
      "id_type": "BIGINT",
      "state_type": "AgentState",
      "state_fields": ["context", "context_summary"]
    },
    "nodes": [
      {"id": "MAIN", "name": "MAIN"},
      {"id": "TOOL", "name": "TOOL"}
    ],
    "edges": [
      {"id": "MAIN-TOOL", "source": "MAIN", "target": "TOOL"}
    ]
  },
  "metadata": {"request_id": "...", "timestamp": "...", "message": "OK"}
}
```

### `info.is_realtime`

`is_realtime` is `true` when the compiled graph is rooted at a live (realtime) agent. Clients use it to decide which socket to open:

| `is_realtime` | Use |
| --- | --- |
| `false` | `POST /v1/graph/invoke`, `POST /v1/graph/stream`, `WS /v1/graph/ws` |
| `true` | `WS /v1/graph/live` |

Connecting to the wrong one is rejected at the handshake with close code `1008`, so read this field once at startup and route accordingly.

---

## GET /v1/graph/tools

List the tools exposed by every `ToolNode` in the graph, grouped by node.

**Response:**

```json
{
  "data": {
    "node_count": 1,
    "tool_count": 2,
    "nodes": [
      {
        "node_name": "TOOL",
        "tool_count": 2,
        "tools": [
          {
            "name": "get_weather",
            "description": "Look up the current weather for a city.",
            "source": "local",
            "parameters": {"type": "object", "properties": {"city": {"type": "string"}}}
          },
          {
            "name": "search_repos",
            "description": "Search GitHub repositories.",
            "source": "mcp",
            "parameters": {"type": "object", "properties": {"query": {"type": "string"}}}
          }
        ]
      }
    ]
  },
  "metadata": {"request_id": "...", "timestamp": "...", "message": "OK"}
}
```

| Field | Description |
| --- | --- |
| `node_count` | Number of `ToolNode`s in the graph |
| `tool_count` | Total tools across all tool nodes |
| `nodes[].node_name` | Name of the tool node in the graph |
| `nodes[].tools[].source` | `local` (a Python function on the node), `mcp` (from a connected MCP server), or `remote` (declared in `10xgraph.json` and executed by a client) |
| `nodes[].tools[].parameters` | JSON Schema for the tool's parameters, in OpenAI function-calling shape |

Tool collection is best-effort per node: an MCP server that fails to respond is logged and its node contributes no tools, rather than failing the whole request.

---

## POST /v1/graph/fix

Repair a thread whose state contains messages with tool calls that have empty content, which is what an interrupted or failed tool execution leaves behind. Those messages are removed from the state.

**Request body:**

```json
{
  "thread_id": "my-thread-1",
  "config": {}
}
```

`thread_id` is required and must not be blank.

**Response:**

```json
{
  "data": {
    "success": true,
    "message": "Removed 1 message with empty tool calls",
    "removed_count": 1,
    "state": {}
  },
  "metadata": {"request_id": "...", "timestamp": "...", "message": "OK"}
}
```

---

## WS /v1/graph/ws

Turn-based streaming over a WebSocket. Same payloads as `POST /v1/graph/stream`, but the connection stays open across runs, which is what makes client-side tool execution possible without a second HTTP request.

**Always mounted.** There is no setting that turns this endpoint off. Concurrent connections are capped per process by [`websocket.max_connections`](/docs/reference/api-cli/configuration#websocket-ag_ui-and-observability) and `max_connections_per_user`; a refused handshake closes with code `1013`.

**Authentication.** Bearer token via the `Authorization` header, the `10xgraph-bearer` `Sec-WebSocket-Protocol` (preferred for browsers), or the `?token=` query fallback. Identical to the [live socket](/docs/reference/rest-api/live#authentication).

**Fresh run.** Client sends:

```json
{
  "invoke_type": "fresh",
  "messages": [{"role": "user", "content": [{"type": "text", "text": "What is the weather in Paris?"}]}],
  "config": {"thread_id": "my-thread-1"}
}
```

`messages` must be non-empty, unless the frame carries `resume`. `config.thread_id` is optional; omit it, or send `"new"`, to start a new thread. The server picks the id and sends it on each chunk. A `thread_id` that does not exist gets an `error` chunk, the same as an unauthorized one, unless `runs.thread_ids` is `client`.

**Answer an `interrupt()` pause.** A `fresh` frame accepts `resume` (any JSON value, `null` to cancel) and an optional `interrupt_id`, with the same meaning as on invoke. No `messages` are needed:

```json
{
  "invoke_type": "fresh",
  "resume": {"approved": true},
  "interrupt_id": "int_abc123...",
  "config": {"thread_id": "my-thread-1"}
}
```

**Resume after a remote tool call.** When the stream contains a remote tool call, the client executes the tool and sends:

```json
{
  "invoke_type": "resume",
  "tool_result": [{"role": "tool", "content": [{"type": "tool_result", "call_id": "call-abc123", "output": "24 degrees and sunny"}]}],
  "config": {"thread_id": "my-thread-1"}
}
```

`tool_result` must be non-empty and `config.thread_id` is required, so the server can resume the right checkpoint. Each message must be a `tool` message of `tool_result` blocks that answers a pending remote tool call, and `call_id` must match that call.

Both frames also accept `initial_state`, `recursion_limit`, `on_busy` and `response_granularity` with the same meaning as `POST /v1/graph/invoke`, and the same input rules.

**Server frames.** The server sends `StreamChunk` JSON messages, identical to the HTTP stream, followed by a terminator:

```json
{"event": "updates", "data": {"status": "done"}}
```

The server does not inspect chunks for tool calls; detecting a remote tool call is the client's job. `invoke_type` is used only for validation and logging.

**Close codes.**

| Code | Meaning |
| --- | --- |
| `1000` | Normal closure |
| `1008` | Auth or authorization rejected, or the graph is a live agent (use `/v1/graph/live`) |
| `1011` | Unexpected server error |
| `1013` | Rate limit or `websocket.max_connections` exceeded |

Recoverable problems (an invalid frame, an unauthorized `thread_id`, a busy thread, a resume that does not match the open interrupt) are sent as an `error` `StreamChunk` and the connection stays open for the next request.

---

## GET /v1/graph:StateSchema

Get the JSON schema for the graph's state class.

**Response:**

```json
{
  "data": {
    "type": "object",
    "properties": {
      "context": {"type": "array"},
      "user_id": {"type": "string"}
    }
  },
  "metadata": {"request_id": "...", "timestamp": "...", "message": "OK"}
}
```

---

## Authentication

When auth is configured, all endpoints require an `Authorization` header:

```
Authorization: Bearer <token>
```

See [Authentication](/docs/reference/api-cli/auth) for configuration details.
