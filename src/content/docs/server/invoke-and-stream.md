---
title: "Invoke and stream over REST"
description: "Call your graph over HTTP: synchronous invoke, streaming with NDJSON, thread management, stop and fix operations."
order: 90
group: "Interfaces"
section: "API server"
updated: "2026-10-26"
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
| `config` | object | `{}` | Optional configuration for the run, such as `thread_id` for continuing a conversation. |
| `initial_state` | object | `null` | Optional initial state for the graph execution. Custom fields and `current_node` are allowed. `context_summary` and `execution_meta` return 422. |
| `response_granularity` | string | `low` | How much to return: `low`, `partial` or `full`. `state` in the response is filled only at `full`. |
| `recursion_limit` | integer | 25 | Maximum depth of graph execution (1-100). Raise this if your graph has deep loops. |
| `resume` | any | `null` | Set this to resume a paused thread (see human-in-the-loop section below). |

### What the server accepts from clients

The server refuses some input with `422`, on invoke, stream and the WebSocket:

- Messages with role `assistant` or `system`. Clients send user messages only.
- A `tool` message that is not `tool_result` blocks answering a pending remote tool call.
- `context_summary` or `execution_meta` in `initial_state`. These built-in fields are never client-writable.
- An unknown `current_node`.
- A state value that does not match its field type. The error names the field.

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

## Use threads for conversation memory

A thread is a persistent conversation context. Use `thread_id` in the config to keep messages and state across multiple calls, so your graph can remember previous exchanges.

### Start a new thread

If you do not provide a `thread_id`, the server generates one:

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

Pass the thread_id in the next request to continue the conversation:

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

The graph now sees all previous messages in the thread, so it can answer contextually. The checkpointer (configured in `10xgraph.json`) stores the thread state durably.

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

Stop is a request flag. The server marks the thread, and the running graph checks the flag between nodes and then exits. The response reports whether a run was active:

```json
{
  "data": {"ok": true, "running": true},
  "metadata": {"request_id": "abc123", "message": "OK"}
}
```

If nothing is running, `running` is `false` (or `ok` is `false` with a `reason` such as `no-state` or `no-checkpointer`). A stopped graph exits cleanly and the checkpoint is saved. You can continue the thread later by sending a new invoke or stream request with the same thread_id.

## Fix corrupted graph state

If a graph execution is interrupted or fails mid-tool-call, the checkpoint may contain tool-call messages with empty content. Use POST `/v1/graph/fix` to clean these up:

```bash
curl -X POST http://localhost:8000/v1/graph/fix \
  -H "Content-Type: application/json" \
  -d '{
    "thread_id":"thread-abc123"
  }'
```

The response shows how many messages were removed. `state` is the updated state serialized as a JSON string.

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

After fixing, the thread is safe to resume. Empty tool calls typically occur when:
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

## Error handling

If an error occurs during execution, the response will include an error chunk:

```json
{"event":"error","data":{"reason":"Tool call failed"},"run_id":"run-123"}
```

Failures during a stream arrive as an `error` chunk, because the HTTP status is already 200 once streaming starts. Authentication, authorization and validation errors are returned before the stream begins. For synchronous invoke, the call fails with an HTTP error status:

| Status | Meaning |
|--------|---------|
| 422 | Invalid request (bad schema, missing messages, or invalid input). |
| 401 | Authentication required (token missing or invalid). |
| 403 | Permission denied (you do not own this thread, or a required scope is missing). |
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

