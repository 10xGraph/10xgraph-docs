---
title: "Invoke and stream over REST"
description: "Call your graph over HTTP: synchronous invoke, streaming with NDJSON, thread management, stop and fix operations."
order: 90
group: "Interfaces"
section: "API server"
updated: "2026-10-27"
---

The 10xGraph API server exposes your graph over HTTP, allowing you to invoke it synchronously, stream results in real time, manage thread-scoped state, and control running executions. This page covers the REST interface for graph execution.

## Invoke and wait for results

Use POST `/v1/graph/invoke` to call the graph and wait for the final result. The server processes all nodes and returns the complete output when done.

```bash
curl -X POST http://localhost:8000/v1/graph/invoke \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {
        "role": "user",
        "content": [{"type": "text", "text": "What is the capital of France?"}]
      }
    ]
  }'
```

Message `content` is a list of content blocks, not a plain string. The response wraps the graph output in a `data` envelope with request `metadata`:

```json
{
  "data": {
    "messages": [
      {
        "message_id": "msg-1",
        "role": "assistant",
        "content": [{"type": "text", "text": "The capital of France is Paris."}]
      }
    ],
    "state": null,
    "context": null,
    "summary": null,
    "meta": {
      "thread_id": "conv-xyz",
      "is_new_thread": true
    }
  },
  "metadata": {
    "request_id": "abc123",
    "message": "OK"
  }
}
```

Each message also carries fields such as `timestamp`, `usages` and `metadata`; they are trimmed here.

### Request parameters

The request body is a JSON object with these fields:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `messages` | array | `[]` | List of user messages to send to the graph. At least one message is required unless `resume` is provided. Roles `assistant` and `system` return 422. |
| `config` | object | `{}` | Optional configuration for the run, such as `thread_id` for continuing an existing conversation. Omit it to start a new thread. |
| `initial_state` | object | `null` | Optional initial state for the graph execution. Custom fields and `current_node` are allowed. `context_summary` and `execution_meta` return 422. |
| `response_granularity` | string | `low` | How much to return: `low`, `partial` or `full`. `state` in the response is filled only at `full`. |
| `recursion_limit` | integer | 25 | Maximum depth of graph execution (1-100). Raise this if your graph has deep loops. |
| `resume` | any | `null` | Set this to resume a paused thread (see human-in-the-loop section below). |
| `interrupt_id` | string | `null` | The id of the interrupt `resume` answers. Optional. A mismatch returns 409. |
| `on_busy` | string | `wait` | What to do if another run is active on the thread: `wait` or `cancel` (see [One run per thread](#one-run-per-thread)). |

### What the server accepts from clients

The server refuses some input with `422`, on invoke, stream and the WebSocket:

- Messages with role `assistant` or `system`. Clients send user messages only.
- A `tool` message that is not `tool_result` blocks answering a pending remote tool call.
- `context_summary` or `execution_meta` in `initial_state`. These built-in fields are never client-writable.
- An unknown `current_node`.
- A state value that does not match its field type. The error names the field.

Requests are also limited in size: at most 500 messages, 100 content blocks per message and 1,000,000 characters of text in total. A request over a limit gets `422` with a message that names the limit, in development and production alike. The limits are fixed.

Custom state fields are allowed, so a frontend can pass a selected ID straight into state. To limit which keys clients may set, list them in `runs.state_keys` in `10xgraph.json`. The server ignores any `message_id` you send and generates its own.

### Response fields

The `data` object has these fields:

| Field | Type | Description |
|-------|------|-------------|
| `messages` | array | Final messages from the graph after all processing. |
| `state` | object or null | The graph's final state. Returned only with `response_granularity: "full"`. |
| `context` | array or null | Context messages, when the graph produces them. |
| `summary` | string or null | A summary, when the graph produces one. |
| `meta` | object | Metadata such as `thread_id` and `is_new_thread`. |

## Stream results in real time

Use POST `/v1/graph/stream` to get results as they are produced. The response body is NDJSON (newline-delimited JSON), one chunk per line. The `Content-Type` header is `text/event-stream`, but lines are plain JSON, not `data:` frames.

```bash
curl -X POST http://localhost:8000/v1/graph/stream \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {
        "role": "user",
        "content": [{"type": "text", "text": "Generate a short story"}]
      }
    ]
  }'
```

The stream emits chunks as the graph runs (fields trimmed for readability):

```json
{"event":"updates","data":{"status":"invoking_graph","step":0},"thread_id":"thread-abc123","run_id":"run-123"}
{"event":"message","message":{"role":"assistant","delta":true,"content":[{"type":"text","text":"Once upon"}]},"thread_id":"thread-abc123","run_id":"run-123"}
{"event":"message","message":{"role":"assistant","delta":true,"content":[{"type":"text","text":" a time..."}]},"thread_id":"thread-abc123","run_id":"run-123"}
{"event":"updates","data":{"status":"graph_invoked","reason":"Graph execution completed successfully"},"thread_id":"thread-abc123","run_id":"run-123"}
```

Each line is a separate JSON object (a `StreamChunk`). Your client must parse each line independently. Message chunks carry the message in the `message` field, and `delta` is `true` for partial text. Chunks also carry `metadata` and `timestamp`. When the graph runs to completion, the last chunk is an `updates` chunk; if you have a thread name generator configured, a final `updates` chunk with `"status": "completed"` follows.

### Stream event types

The `event` field in each chunk is one of four values:

| Event | When emitted | Where the content is |
|-------|--------------|----------------------|
| `message` | The graph produces a message or a partial message | `message` field (a message object; `delta` marks partial text). |
| `updates` | Progress and lifecycle changes | `data.status`, for example `invoking_graph`, `invoking_node`, `graph_invoked`, `interrupted`, plus `node`, `step` and `reason`. |
| `state` | The graph emits its state | `state` field. |
| `error` | An error occurred | `data.reason` (a sanitized message in production). |

A stop request ends the stream with an `updates` chunk whose `data.reason` is `Graph execution stopped by request`.

## One run per thread

A thread runs one graph run at a time. Two runs on one thread would both load the state, both run and both save, so tools would run twice and the history would interleave (a double click on Send, or two tabs). The server prevents this on invoke, stream, the WebSocket and AG-UI.

A second run on a busy thread waits up to 30 seconds for the first to finish. If the thread is still busy, the request is rejected with `409`:

```json
{
  "error": {"code": "HTTPException", "message": "thread is busy", "details": []},
  "metadata": {"request_id": "abc123", "timestamp": "2026-10-27T10:00:00", "message": "thread is busy"}
}
```

On invoke and stream, this comes before the response starts, as a normal HTTP error. On the WebSocket it is an `error` chunk with `"reason": "thread is busy"`, and the socket stays open. AG-UI always waits.

To replace the running run instead of waiting, send `"on_busy": "cancel"`. The server asks the running run to stop (the same mechanism as the stop endpoint below) and starts yours once the thread is free. The 30-second limit and the `409` still apply.

A few details:

- A new thread is locked as soon as its id exists, so the first run on it is covered too.
- With Redis configured, the lock is shared across processes. Without it, the lock is per process.
- The lock expires by itself if a worker dies, and is released when the run ends, fails, is cancelled or the client disconnects.
- If Redis fails, the run proceeds without the lock and the error is logged.
- `/v1/graph/live` is not covered.

<aside class="callout callout-warning" role="note"><p class="callout-title">Parallel runs on one thread now queue</p>

An app that sent parallel runs on the same thread will see them queue, or get `409` after 30 seconds. Use a separate thread for each concurrent conversation.

</aside>

## Use threads for conversation memory

A thread is a persistent conversation context. Use `thread_id` in the config to keep messages and state across multiple calls, so your graph can remember previous exchanges. The server makes the id of a new thread. You do not pick it.

### Start a new thread

Leave `thread_id` out and the server starts a new thread and generates its id:

```bash
curl -X POST http://localhost:8000/v1/graph/invoke \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role":"user","content":[{"type":"text","text":"Hello"}]}],
    "config":{}
  }'
```

The response includes `data.meta.thread_id`:

```json
{
  "data": {
    "messages": [...],
    "meta": {
      "thread_id": "thread-abc123"
    }
  },
  "metadata": {"request_id": "abc123", "message": "OK"}
}
```

### Continue on the same thread

Pass the returned `thread_id` in the next request to continue the conversation:

```bash
curl -X POST http://localhost:8000/v1/graph/invoke \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role":"user","content":[{"type":"text","text":"What did I say before?"}]}],
    "config":{
      "thread_id":"thread-abc123"
    }
  }'
```

The graph now sees all previous messages in the thread, so it can answer contextually. The checkpointer (passed to `graph.compile(checkpointer=...)` in your graph code) stores the thread state durably.

By default (`runs.thread_ids` is `"server"`), a `thread_id` that does not exist answers `403`, the same as an id another user owns. Do not invent an id for a new conversation. See [`runs.thread_ids`](/docs/reference/api-cli/configuration#thread_ids).

### Read thread history

To see all messages in a thread without running the graph, use GET `/v1/threads/{thread_id}/messages`:

```bash
curl http://localhost:8000/v1/threads/thread-abc123/messages
```

Returns the thread messages:

```json
{
  "data": {
    "messages": [
      {"role":"user","content":[{"type":"text","text":"Hello"}]},
      {"role":"assistant","content":[{"type":"text","text":"Hi there"}]}
    ]
  },
  "metadata": {"request_id": "abc123", "message": "OK"}
}
```

The endpoint also accepts `search`, `offset` and `limit` query parameters.

## Stop a running execution

If a graph is running and you want to halt it, POST to `/v1/graph/stop` with the thread_id:

```bash
curl -X POST http://localhost:8000/v1/graph/stop \
  -H "Content-Type: application/json" \
  -d '{
    "thread_id":"thread-abc123"
  }'
```

Stop is a request flag. The server marks the thread, and the running graph checks the flag between nodes and then exits. The flag belongs to the run it was made for: starting a new run on the thread does not clear a stop meant for a run that is still going. The response reports whether a run was active:

```json
{
  "data": {"ok": true, "running": true},
  "metadata": {"request_id": "abc123", "message": "OK"}
}
```

If nothing is running, `running` is `false` (or `ok` is `false` with a `reason` such as `no-state` or `no-checkpointer`). A stopped graph exits cleanly and the checkpoint is saved. You can continue the thread later by sending a new invoke or stream request with the same thread_id.

## Fix corrupted graph state

If a graph execution is interrupted or fails mid-tool-call, the checkpoint may contain an assistant message whose tool calls never got results. Use POST `/v1/graph/fix` to clean these up:

```bash
curl -X POST http://localhost:8000/v1/graph/fix \
  -H "Content-Type: application/json" \
  -d '{
    "thread_id":"thread-abc123"
  }'
```

The response shows how many messages were removed (`removed_count: 0` when nothing needed fixing). A thread that is paused on an interrupt, a client tool call or a human approval keeps the unanswered calls of its latest assistant message. See [POST /v1/graph/fix](/docs/reference/rest-api/graph#post-v1graphfix) for the rules. `state` is the updated state serialized as a JSON string.

```json
{
  "data": {
    "success": true,
    "message": "Successfully removed 2 message(s)",
    "removed_count": 2,
    "state": "..."
  },
  "metadata": {"request_id": "abc123", "message": "OK"}
}
```

After fixing, the thread is safe to resume. Unanswered tool calls typically occur when:
- A tool was called but the client disconnected before sending the result.
- An interrupt happened while a tool was running.
- A network error cut off the tool response.

## Human-in-the-loop: pause and resume

If your graph calls `interrupt()` to pause for human approval, the stream ends with an `updates` chunk whose `data.status` is `interrupted`, with the `node` that paused and the `interrupt` payload. To resume, send a `resume` request with your approval:

```bash
curl -X POST http://localhost:8000/v1/graph/invoke \
  -H "Content-Type: application/json" \
  -d '{
    "resume":{"approved":true,"comment":"Looks good"},
    "config":{
      "thread_id":"thread-abc123"
    }
  }'
```

The graph resumes from the paused node with your response. The `resume` value is passed directly to the `interrupt()` call, so shape it however your node expects.

### Bind the resume to its interrupt

Add `interrupt_id` to say which interrupt you are answering. This stops a retried or stale request from answering the next prompt unseen.

```bash
curl -X POST http://localhost:8000/v1/graph/invoke \
  -H "Content-Type: application/json" \
  -d '{
    "resume":{"approved":true},
    "interrupt_id":"int_abc123",
    "config":{"thread_id":"thread-abc123"}
  }'
```

Get the id from the thread state, at `execution_meta.interrupt_data.interrupt.id` (invoke with `"response_granularity": "full"` to see it in the response `state`), or from the `interrupt` object of the `interrupted` update chunk. On AG-UI, the interrupt event carries it.

| Status | Cause |
|--------|-------|
| 409 | The thread is not paused, or is paused at a different interrupt. Checked before anything runs. |
| 422 | The answer fails the interrupt's `response_schema`. |

On stream and WebSocket, both arrive as an `error` chunk. `interrupt_id` is optional: without it, the resume answers whatever the thread is paused at. The WebSocket also accepts `resume` and `interrupt_id` now. See [Interrupts](/docs/concepts/interrupts#bind-a-resume-to-its-interrupt) for the schema subset and the Python-side errors.

## Error handling

If an error occurs during execution, the response will include an error chunk:

```json
{"event":"error","data":{"reason":"Tool call failed"},"run_id":"run-123"}
```

In production (`MODE=production`), the text in an `error` chunk is replaced by a generic message, the same as invoke returns, so a failing node cannot leak a connection string or a path. Development shows the details. The same applies on the WebSocket and AG-UI.

Failures during a stream arrive as an `error` chunk, because the HTTP status is already 200 once streaming starts. Authentication, authorization and validation errors are returned before the stream begins. For synchronous invoke, the call fails with an HTTP error status:

| Status | Meaning |
|--------|---------|
| 422 | Invalid request (bad schema, missing messages, invalid input, a request over the size limits, or a resume answer that fails the interrupt's `response_schema`). |
| 401 | Authentication required (token missing or invalid). |
| 403 | Permission denied (you do not own this thread, or a required scope is missing). |
| 409 | The thread is busy (another run was still active after 30 seconds), or `interrupt_id` does not match the open interrupt. |
| 429 | Rate limit exceeded. Retry after the `Retry-After` header. |
| 500 | Internal server error (bug in your graph or infrastructure failure). |

## Common issues

**Validation error: "messages must contain at least one message" (422)**

You sent an empty messages array. Include at least one message, or use `resume` to continue an interrupted thread.

**403 on a thread you expect to own**

With `"authorization": "ownership"` a thread belongs to the user who created it. Check that the token carries the same `user_id` as the original request.

**Stream stops abruptly**

Your graph may have crashed or the server restarted. Check server logs and the thread checkpoint to diagnose. Use `/v1/graph/fix` if needed.

**Tool call returns empty result**

The client may not have sent the tool result back to the server. Resend it with `invoke` or `stream` and use the same thread_id to let the graph retry.

## Next steps

- See [WebSocket streaming and realtime](/docs/server/websockets) for WebSocket real-time updates and bidirectional communication.
- Learn how to [handle authentication](/docs/server/auth) for production deployments.
- Read [stream and approve](/docs/get-started/tutorial/stream-and-approve) to add human-in-the-loop workflows.

