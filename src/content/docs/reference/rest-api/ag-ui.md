---
title: AG-UI endpoint
description: "POST /v1/ag-ui runs a 10xGraph graph over the AG-UI protocol: the RunAgentInput request, the server-sent event stream, interrupts, client tools, auth and error codes."
section: Reference
group: "REST API"
order: 330
label: AG-UI
updated: "2026-11-25"
faq:
  - q: Is POST /v1/ag-ui always available?
    a: "No. It is mounted only when 10xgraph.json has \"ag_ui\" set to {\"enabled\": true} and the ag-ui extra is installed. Without it the route returns 404."
  - q: Does the AG-UI endpoint work in production?
    a: Yes. It is mounted in every mode once enabled, and it goes through the same auth, ownership check and rate limiter as the other graph routes.
---

`POST /v1/ag-ui` runs your graph over the [AG-UI protocol](https://docs.ag-ui.com). It takes an AG-UI `RunAgentInput` and streams the run back as AG-UI events, so any AG-UI client can drive the graph, including CopilotKit through its `HttpAgent`. For the CopilotKit frontend, see [10xGraph with CopilotKit](/docs/integrations/copilotkit). For the steps to turn the endpoint on, see [Serve your agent over AG-UI](/docs/server/ag-ui).

---

## Enabling the endpoint

The route is off by default. It exists only when `ag_ui.enabled` is `true` and the `ag-ui` extra is installed; see [Serve your agent over AG-UI](/docs/server/ag-ui).

| Key | Default | Effect |
| --- | --- | --- |
| `ag_ui.enabled` | `false` | Mounts `POST /v1/ag-ui` |
| `ag_ui.allow_client_tools` | `true` | Offers the tools the client sends with each run to the model. Set `false` to accept only the tools declared under [`remote_tools`](/docs/reference/api-cli/configuration#remote_tools) |

If `ag_ui.enabled` is `true` but the extra is missing, the server refuses to start and prints the install command.

---

## POST /v1/ag-ui

**Request headers:** `Content-Type: application/json`, plus `Authorization: Bearer <token>` when auth is configured.

**Request body:** an AG-UI `RunAgentInput`. Field names are camelCase.

| Field | Required | Description |
| --- | --- | --- |
| `threadId` | yes | The 10xGraph thread, matching `^[A-Za-z0-9._:@-]{1,128}$` (else `422`). Runs on the same `threadId` share the checkpoint. Send a blank or `"new"` to have the server create the thread; the id comes back in `RUN_STARTED`. An id the server never issued gets `404` unless `runs.thread_ids` is `client` |
| `runId` | yes | Client-chosen id, echoed on `RUN_STARTED` and `RUN_FINISHED` |
| `messages` | yes | The conversation as the client sees it. Only the new trailing user turn, or tool results for a pending browser tool call, reach the graph |
| `state` | no | Initial application state for the run. The keys `context`, `context_summary` and `execution_meta` are dropped. Every other key must be listed in `runs.state_keys` in `10xgraph.json`, or the request answers `422` |
| `tools` | no | Browser tools offered to the model for this run only. See [Client tools](#client-tools) |
| `context` | no | Accepted and validated, not passed to the graph |
| `forwardedProps` | no | Accepted and validated, not passed to the graph |
| `resume` | no | Answers to an open `interrupt()`. Each entry has `interruptId`, `status` (`resolved` or `cancelled`) and an optional `payload` |
| `parentRunId`, `protocolVersion` | no | Accepted and validated, not used |

Messages with role `assistant`, `system` or `developer` are never forwarded to the graph.

User message `content` is a string or a list of parts. Supported parts are `text` and the media parts `image`, `audio`, `video` and `document`, whose `source` is `{"type": "data" | "url" | "file", "value": ..., "mimeType": ...}`. A `file` source takes a `file_id` from [`POST /v1/files/upload`](/docs/reference/rest-api/files). The legacy `binary` part that older CopilotKit versions send is converted to the matching media part.

```bash
curl -N http://127.0.0.1:8000/v1/ag-ui \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $TOKEN" \
  -d '{
    "threadId": "t1",
    "runId": "r1",
    "messages": [{"id": "u1", "role": "user", "content": "What is the weather in Paris?"}]
  }'
```

**Response (200):** a server-sent event stream (`Content-Type: text/event-stream`). Each event is one `data: {...}` line holding an AG-UI event as camelCase JSON.

```text
data: {"type":"RUN_STARTED","threadId":"t1","runId":"r1"}

data: {"type":"STEP_STARTED","stepName":"MAIN"}

data: {"type":"TEXT_MESSAGE_START","messageId":"m1","role":"assistant"}

data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"m1","delta":"It is sunny"}

data: {"type":"TEXT_MESSAGE_END","messageId":"m1"}

data: {"type":"STEP_FINISHED","stepName":"MAIN"}

data: {"type":"RUN_FINISHED","threadId":"t1","runId":"r1"}
```

---

## Event stream

Every stream starts with `RUN_STARTED` and ends with exactly one `RUN_FINISHED` or `RUN_ERROR`. Each `START` comes before its `CONTENT` and `END`, and everything open is closed before the terminal event.

| Graph activity | AG-UI events |
| --- | --- |
| Run start and end | `RUN_STARTED`, `RUN_FINISHED` |
| A node runs (except `START` and `END`) | `STEP_STARTED`, `STEP_FINISHED` with the node name |
| Assistant text, streamed or whole | `TEXT_MESSAGE_START`, `TEXT_MESSAGE_CONTENT`, `TEXT_MESSAGE_END` |
| Reasoning summaries | `REASONING_START`, `REASONING_MESSAGE_START`, `REASONING_MESSAGE_CONTENT`, `REASONING_MESSAGE_END`, `REASONING_END` |
| A tool call from the model | `TOOL_CALL_START`, `TOOL_CALL_ARGS`, `TOOL_CALL_END`, sent together once the call is complete |
| A server tool result | `TOOL_CALL_RESULT` |
| A failed tool | `TOOL_CALL_RESULT` with `Error: <message>`, and the run continues |
| Application state changes | `STATE_SNAPSHOT` with the fields you added to `AgentState` (not `context`, `context_summary` or `execution_meta`), sent only when they change |
| `interrupt()` | `RUN_FINISHED` with an `interrupt` outcome |
| Graph error | `RUN_ERROR` with code `GRAPH_ERROR` |

`RUN_FINISHED` carries an `outcome` only for an interrupt.

A run whose `messages` contain nothing new, for example a client syncing state, still gets `RUN_STARTED` and `RUN_FINISHED`, with a `STATE_SNAPSHOT` of the thread's state in between when it differs from the client's.

---

## Interrupts

When the graph calls [`interrupt()`](/docs/guides/add-human-approval), the run ends with:

```json
{
  "type": "RUN_FINISHED",
  "threadId": "t1",
  "runId": "r1",
  "outcome": {
    "type": "interrupt",
    "interrupts": [{
      "id": "int-123",
      "reason": "tool_approval",
      "message": "Approve a refund of $40?",
      "toolCallId": "call-1",
      "metadata": { "value": { "amount": 40 }, "node": "TOOL" }
    }]
  }
}
```

`reason` defaults to `input_required`. The interrupt's `value` and node name travel in `metadata`.

Resume by sending a new run on the same thread with a `resume` entry:

```json
{
  "threadId": "t1",
  "runId": "r2",
  "messages": [],
  "resume": [{ "interruptId": "int-123", "status": "resolved", "payload": { "approved": true } }]
}
```

`interrupt()` returns `payload` for `resolved` and `None` for `cancelled`. While the thread is paused, a run without a matching `resume` (a new chat message, for example) reports the same interrupt again without running the graph. A `resume` for a different interrupt id, or for a thread that is not paused, ends the run with `RUN_ERROR` and code `INVALID_INPUT`. Each `resume` entry names its `interruptId`, so an AG-UI resume is always bound to the interrupt it answers. If the `payload` fails the interrupt's `response_schema`, the run also ends with `RUN_ERROR`.

---

## Client tools

Tools in `RunAgentInput.tools` are offered to the model for that run only, next to the server's tools. The graph needs a `ToolNode`. When the model calls a browser tool, the stream sends the `TOOL_CALL_*` events and ends with `RUN_FINISHED`, leaving the call unanswered. The client runs the tool and starts a new run on the same thread with a `tool` message whose `toolCallId` matches.

Each run's tool list is checked before anything runs:

| Limit | Value |
| --- | --- |
| Tools per run | 64 |
| Name | 1 to 64 letters, digits, `_` or `-`, unique within the run |
| Description | 4096 characters |
| Parameters schema | 16 KB as JSON |

With `ag_ui.allow_client_tools` true, a client tool named like a server tool (a local or MCP tool of the graph) is refused with 422 before the run starts (`tools[1]: 'get_weather' is the name of a server tool`). A client tool that repeats a name declared under `remote_tools` is accepted.

With `ag_ui.allow_client_tools` set to `false`, tools sent by the client are ignored and only [`remote_tools`](/docs/reference/api-cli/configuration#remote_tools) from `10xgraph.json` are offered.

---

## Authentication

The route uses `RequirePermission("graph", "stream")`, the same permission as [`POST /v1/graph/stream`](/docs/reference/rest-api/graph). When auth is configured, the server also checks that the caller may run on `threadId` through the [authorization backend](/docs/reference/api-cli/auth), so one user cannot run on another user's thread. AG-UI follows [`runs.thread_ids`](/docs/reference/api-cli/configuration#thread_ids) like REST. Under the default `server`, a `threadId` the server never issued gets `404`. A blank or `"new"` `threadId` makes the server create the thread, and the new id comes back in `RUN_STARTED`. Frontends that make their own ids (CopilotKit does by default) must set `runs.thread_ids` to `client`.

Browsers should not hold the API token. With CopilotKit, set the `Authorization` header in the Next.js route handler through `HttpAgent`'s `headers` option, so the token stays on the server.

The route counts against [`cache_store.rate_limit`](/docs/reference/api-cli/rate-limiting) like any other path.

---

## Error responses

Errors found before the stream starts return a normal HTTP error. See [Conventions](/docs/reference/rest-api/conventions) for the error body.

| Status | Cause |
| --- | --- |
| `401` | Auth is configured and no valid token was sent |
| `403` | The caller lacks `graph:stream` |
| `404` | The endpoint is not enabled (`ag_ui.enabled` is not `true`), or the `threadId` is unknown or not visible to the caller (including an id the server never issued under `runs.thread_ids: server`) |
| `400` | A media URL in the request is blocked by the media policy |
| `409` | Another run is still active on this `threadId` after 30 seconds (see [One run per thread](#one-run-per-thread)), or an `Idempotency-Key` was repeated |
| `422` | The body is not JSON, is not a valid `RunAgentInput`, has no `threadId`, breaks a [client tool limit](#client-tools), or breaks a [request size limit](#request-size-limits). Also an `Idempotency-Key` that is malformed or reused with a different body |
| `429` | The user has more than `runs.max_concurrent_per_user` runs in flight (`Retry-After: 5`) |

Once the stream has started, failures arrive as a `RUN_ERROR` event instead:

| `code` | Cause |
| --- | --- |
| `INVALID_INPUT` | A `resume` that does not match the open interrupt |
| `GRAPH_ERROR` | The graph reported an error. With `MODE=production` the message is generic, like invoke; development shows the details |
| `AG_UI_ERROR` | Any other failure. The message is generic and details go to the server log |

---

## One run per thread

See [One run per thread](/docs/reference/rest-api/graph#one-run-per-thread). AG-UI has no `on_busy` field, so it always waits and never cancels the running run.

---

## Idempotency

See [Idempotency keys](/docs/reference/rest-api/graph#idempotency-keys). A repeated key after the run finished answers `409`, because the event stream is not stored.

## Request size limits

AG-UI clients resend the whole conversation on every run, so the limits work differently here than on invoke and stream:

- The messages after the last assistant message (the trailing turn, which is what reaches the graph) get the normal [size limits](/docs/reference/rest-api/graph#post-v1graphinvoke): at most 500 messages, 100 content blocks per message and 1,000,000 characters of text in total.
- The full history gets a looser cap of 10,000 messages, plus the 100 blocks per message cap.

A request over a limit returns `422`.

---

`MESSAGES_SNAPSHOT` is not sent; load history from [`GET /v1/threads/{thread_id}/messages`](/docs/reference/rest-api/threads).
