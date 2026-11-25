---
title: Graph endpoints
seoTitle: "Graph REST API reference"
description: "Reference for the 10xGraph REST endpoints that invoke, stream, stop, and inspect a graph, with request bodies, responses, and auth requirements."
section: Reference
group: "REST API"
order: 310
label: Graph
updated: "2026-11-25"
---

The graph endpoints run your compiled graph over HTTP and WebSocket: invoke it for a complete result, stream it chunk by chunk, stop or repair a thread, and inspect the graph's nodes, tools, and state schema.

Responses use the [standard envelope](/docs/reference/rest-api/conventions#base-url-and-response-envelope).

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
      "content": [{"type": "text", "text": "What is the capital of France?"}]
    }
  ]
}
```

`content` is a list of content blocks, not a plain string. A string gets `422`. The example sends no `config.thread_id`, so the server starts a new thread and returns its id in `data.thread_id`. Send that id as `config.thread_id` in the next request to continue the thread. With the default `runs.thread_ids` of `server`, naming an id that does not exist answers `404`.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `messages` | array | yes, unless `resume` is set | One or more messages to append to state before invoking. |
| `resume` | any | no | Answer for a thread paused by [`interrupt()`](/docs/guides/add-human-approval). The paused node runs again and `interrupt()` returns this value; `null` means cancelled. Send it only to resume a paused thread. Nested no deeper than 64 levels by default (`MAX_NESTING_DEPTH`). |
| `interrupt_id` | string | no | The `id` of the interrupt `resume` answers. Take it from `execution_meta.interrupt_data.interrupt.id` in the thread state. If the thread is not paused, or is paused at a different interrupt, the request gets `409` before anything runs. Ignored without `resume`. |
| `on_busy` | string | no | `wait` (default) or `cancel`. What to do when another run is active on the thread (see [One run per thread](#one-run-per-thread)). |
| `initial_state` | object | no | Initial state for the run. Only keys listed in `runs.state_keys` are accepted, none by default; built-in fields never are (see input rules below). Nested no deeper than 64 levels by default (`MAX_NESTING_DEPTH`). |
| `config` | object | no | Run configuration. Nested no deeper than 64 levels by default (`MAX_NESTING_DEPTH`). |
| `config.thread_id` | string | no | Id of an existing thread to continue. Must match `^[A-Za-z0-9._:@-]{1,128}$`, else `422`. When absent or blank, the server starts a new thread, generates its id and persists it; the id comes back in `data.thread_id`. With the default `runs.thread_ids` of `server`, an id that does not exist answers `404`. See [`runs.thread_ids`](/docs/reference/api-cli/configuration#thread_ids). |
| `config.model` | string | no | Name of a model the graph's Agent registers in its `model_registry`. Take the names from [`info.models`](#infomodels) of `GET /v1/graph`. No name means the default model. A name that is not registered answers `422` before the run starts, with the registered names in the message, in production too. A node can read another key (`config_key` in `info.models`). |
| `recursion_limit` | integer | no | Maximum graph iterations. Default `25`, at least `1`. A value above `runs.max_recursion_limit` (default `100`) gets `422`. |
| `response_granularity` | string | no | `full`, `partial`, or `low`. Default `low`. |

Server-owned `config` keys (for example `user`, `user_id`, `remote_tools`, `collection`, and any key starting with `_`) are dropped, not refused; see [Conventions](/docs/reference/rest-api/conventions).

**Input rules.** The server refuses these with `422`:

- A message with role `assistant` or `system`. Clients send user messages only.
- A `tool` message that is not made of `tool_result` blocks, or that does not answer a remote tool call waiting for a result.
- A key in `initial_state` that is not listed in `runs.state_keys` (an empty list by default). `current_node` needs listing too.
- `context_summary` or `execution_meta` in `initial_state`. Clients can never write these built-in fields.
- A `current_node` in `initial_state` that is not a node in the graph.
- A state value whose type does not match the state field. The error names the field.
- An `initial_state`, `config` or `resume` value nested deeper than 64 levels by default (`MAX_NESTING_DEPTH`). The answer is `422` with code `VALIDATION_ERROR`.

Custom state fields are denied unless the operator lists them in `runs.state_keys` in `10xgraph.json`; only listed keys are accepted. The server replaces any `message_id` you send with its own. The same rules apply to `POST /v1/graph/stream` and the WebSocket.

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
| `thread_id` | Thread of the run, the same name every stream event carries. |
| `run_id` | Run id, the same name every stream event carries. |
| `meta` | Run metadata (`is_new_thread`, `thread_id`), or `null`. How much is filled in depends on `response_granularity`. |

### One run per thread

The server runs one graph run at a time on a thread. A second run on a busy thread waits up to 30 seconds for the first to finish, then the request is rejected with `409` in the standard error body and a `Retry-After: 5` header:

```json
{
  "error": {"code": "HTTPException", "message": "thread is busy", "details": []},
  "metadata": {"request_id": "...", "timestamp": "...", "message": "thread is busy"}
}
```

On invoke and stream, this answer comes before the response starts. A new thread (no `thread_id` in the request) is locked as soon as its id exists. The lock is shared across processes when the cache store is shared, and per process otherwise. It expires on its own if a worker dies, and is released when the run ends, fails, is cancelled or the client disconnects. `/v1/graph/live` takes the same lock for the whole session; a busy thread ends the session with a fatal `thread_busy` error and close code `1013`.

Set `on_busy` to `"cancel"` to stop the running run (the same mechanism as [`POST /v1/graph/stop`](#post-v1graphstop)) and start the new one. The 30-second wait limit and the `409` still apply if the old run does not stop in time.

On invoke, a run that passes its recursion limit answers `422` (`GRAPH_RECURSION_000`).

### Idempotency keys

Send an `Idempotency-Key` header (1 to 255 printable ASCII characters, else `422`) on `POST /v1/graph/invoke`, `POST /v1/graph/stream` and [`POST /v1/ag-ui`](/docs/reference/rest-api/ag-ui), or `idempotency_key` in the [WebSocket](#ws-v1graphws) run frame, so a gateway retry after a timeout does not run the tools twice. The header is opt-in: a request without it behaves as before. The key is scoped to the authenticated user.

| Situation | Answer |
| --- | --- |
| First request with the key | Runs normally. |
| Same key while that run is still going | `409` with `Retry-After: 5`. |
| Same key after the run finished, invoke | The stored result, as the first call returned it. |
| Same key after the run finished, stream | The final state line plus the `done` line, replayed as NDJSON. |
| Same key after the run finished, AG-UI and WebSocket | `409`. Their event output is not stored. |
| Same key with a different body | `422`. |
| The first run failed | Nothing is stored, so the key can be retried. |
| A result over 1 MiB | Not stored; later requests with the key answer `409`. |

A finished run is remembered for `IDEMPOTENCY_TTL_SECONDS` (default 86400). Records live in the cache store, so they are per process unless it is shared (Redis). If the cache store cannot be reached the request runs without idempotency.

### Resume answers

A resume that does not fit the thread fails before the graph runs:

| Status | Cause |
| --- | --- |
| `409` | `interrupt_id` was sent and the thread is not paused, or is paused at a different interrupt (`INTERRUPT_001`). |
| `409` | `resume` was sent to a thread that is not paused at an `interrupt()` (`INTERRUPT_003`, `NothingToResumeError`). |
| `409` | A plain new message was sent to a thread that is paused at an `interrupt()` (`INTERRUPT_004`, `InterruptPendingError`). Resume it with `resume`. |
| `422` | The answer fails the interrupt's `response_schema` (`INTERRUPT_002`). |

The schema check supports `type`, `enum`, `properties`, `required` and `items`. Other keywords are ignored. A `null` answer (cancel) is never checked. See [Interrupts](/docs/concepts/interrupts#bind-a-resume-to-its-interrupt).

---

## POST /v1/graph/stream

Run the graph and stream one JSON-encoded `StreamChunk` per line.

**Request body:** Same as `/v1/graph/invoke`, including `resume`, `interrupt_id`, `on_busy` and the size limits.

A repeated `Idempotency-Key` is answered the same way (see [Idempotency keys](#idempotency-keys)). Errors found before the stream starts (busy thread `409`, per-user run cap `429`, bad resume `409`, client gone `499`) are normal HTTP errors; later failures arrive as an `error` chunk. With `MODE=production` the text of an `error` chunk is replaced by a generic message.

**Response:** `Content-Type: application/x-ndjson`

NDJSON, one `StreamChunk` per line (not SSE). A blank line is sent every 15 seconds while silent; skip empty lines.

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
| `data` | `object \| null` | Populated for `updates` (for example `{"status": "done"}`) and `error` (for example `{"reason": "...", "code": "..."}`). |
| `thread_id` | `string \| null` | Thread this chunk belongs to. |
| `run_id` | `string \| null` | Run this chunk belongs to. |
| `metadata` | `object \| null` | Additional per-chunk metadata. |
| `timestamp` | `number` | UNIX timestamp of chunk creation. |

A run that is refused because the graph is closing ends with a terminal `error` chunk whose `data` has `code: "SERVICE_UNAVAILABLE"`, a `reason` and `retry_after_seconds` (the same hint as the HTTP 503 `Retry-After`). No `done` chunk follows. Treat it as "retry on another replica", not as a failed run.

A stream that finishes without an error ends with a terminal `updates` chunk whose `data` is `{"status": "done"}`. A client that waits for it can tell a finished stream from a cut one. If the server shuts down while the stream is open, the stream ends with a final chunk that says the run was interrupted and that the thread is saved: send a new request on the same `thread_id` to continue.

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

The request records a stop flag on the thread, and the running graph checks it between nodes, so the current node finishes first. When nothing is running the call returns `200` with `ok: false` and `reason` `no-state` or `no-checkpointer`. A thread outside the caller's reach is `404`. Stopping needs a checkpointer.

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
      "realtime_options": null,
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
      "state_fields": ["context", "context_summary"],
      "models": {
        "MAIN": {
          "default": "openai",
          "names": ["openai", "gemini", "vllm"],
          "config_key": "model"
        }
      }
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

Connecting to the wrong one sends an error and closes with code `1008`. For a live graph `info.realtime_options` lists the init options `/v1/graph/live` honors (`client_overrides`, `models`, `model_selectable`, `tools_tags`).

### `info.models`

`models` maps each agent node that has a `model_registry` to the models a run may pick. It is `{}` when no node has a registry. It holds names only, never model strings, keys or URLs.

| Field | Meaning |
| --- | --- |
| `default` | The entry used when the run config names none. |
| `names` | The registered names a client may pick. |
| `config_key` | The `config` key that carries the name. `model` unless the Agent sets `model_config_key`. |

Build a model dropdown from `names`, and send the choice as `config[config_key]` on invoke, stream or the WebSocket run frame:

```json
{"messages": [...], "config": {"thread_id": "t1", "model": "vllm"}}
```

An unregistered name answers `422` on invoke and stream, before the run starts. On the WebSocket the server sends an `error` chunk before the run. The message names the registered models and is not replaced in production. The registry in your code is the allowlist. See [Model registry](/docs/reference/python/agent#model-registry).

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

Repair a thread whose history is broken because a run stopped after the model asked for tools but before the results were saved.

The repair works in two steps:

1. An assistant message is removed when any of its tool calls has no matching tool result. Calls and results are matched by tool call id.
2. Tool result messages whose call no longer exists, including results left over from a message removed in step 1, are then removed. Every remaining result has its call.

If the thread is paused (an `interrupt()`, a client tool call waiting for its result, or a human-approval pause), the unanswered calls of the latest assistant message are kept, because the pause is waiting on them. Earlier dangling calls are still removed. Messages without tool calls are never touched.

When nothing needs fixing, the response has `removed_count: 0` and the state is not written.

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
    "message": "Removed 1 message with unanswered tool calls",
    "removed_count": 1,
    "state": {}
  },
  "metadata": {"request_id": "...", "timestamp": "...", "message": "OK"}
}
```

---

## WS /v1/graph/ws

Turn-based streaming over a WebSocket. Same payloads as `POST /v1/graph/stream`, but the connection stays open across runs, which is what makes client-side tool execution possible without a second HTTP request.

**Mounted unless `websocket.enabled` is `false`.** Serving it needs the `websocket` extra. Concurrent connections are capped (shared by all workers when the cache store is shared, per process otherwise) by [`websocket.max_connections`](/docs/reference/api-cli/configuration#websocket-ag_ui-and-observability) and `max_connections_per_user`; a refused handshake closes with code `1013`.

**Authentication.** See [Conventions](/docs/reference/rest-api/conventions#authentication).

**Fresh run.** Client sends:

```json
{
  "invoke_type": "fresh",
  "messages": [{"role": "user", "content": [{"type": "text", "text": "What is the weather in Paris?"}]}],
  "config": {"thread_id": "my-thread-1"}
}
```

`messages` must be non-empty, unless the frame carries `resume`. A frame may carry `idempotency_key` (see [Idempotency keys](#idempotency-keys)); a repeat of the key (while the run is going or after it finished) or a different body with the same key gets an `error` chunk, and the connection stays open. `config.thread_id` is optional; omit it, or send `"new"`, to start a new thread. The server picks the id and sends it on each chunk. A `thread_id` that does not exist gets an `error` chunk, the same as an unauthorized one, unless `runs.thread_ids` is `client`.

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

Close codes are listed in [Conventions](/docs/reference/rest-api/conventions#websocket-close-codes). Recoverable problems (an invalid frame, an unauthorized `thread_id`, a busy thread, a resume that does not match the open interrupt) are sent as an `error` `StreamChunk` and the connection stays open for the next request.

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
