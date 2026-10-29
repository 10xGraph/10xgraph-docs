---
title: Thread endpoints
seoTitle: "Threads REST API reference"
description: "Reference for the 10xGraph REST endpoints that read and write thread state and messages, with request fields, responses, and auth requirements."
section: Reference
group: "REST API"
order: 340
label: Threads
updated: "2026-10-28"
faq:
  - q: "How do I create a thread over the REST API?"
    a: "There is no create-thread endpoint. A thread comes into existence when you call the invoke or stream endpoint without a thread_id and the server generates one. With `runs.thread_ids` set to `client`, it also comes into existence the first time a request uses an id you picked."
  - q: "Why do I get 403 on a thread I know exists?"
    a: "With the ownership authorization backend active, a thread can only be used by the user who owns it, for every action. A missing scope also returns 403, with the message Missing required scope."
  - q: "Is the limit parameter capped?"
    a: "Yes. The list endpoints default to 100 items and clamp any larger limit to 1000. A limit of 0 or less returns 422."
---

The thread endpoints read and manage what the checkpointer stores for a conversation: the thread record, its saved state and its messages. Every route lives under `/v1/threads` and is addressed by `thread_id`. Each route needs a `checkpointer` permission when auth is configured.

## Route summary

The server exposes eleven thread routes. Reads need `checkpointer:read`, writes need `checkpointer:write`, and deletes need `checkpointer:delete`. Importing messages is admin-only and needs `checkpointer:import`.

| Method | Path | Permission |
| --- | --- | --- |
| `GET` | `/v1/threads` | `checkpointer:read` |
| `GET` | `/v1/threads/{thread_id}` | `checkpointer:read` |
| `DELETE` | `/v1/threads/{thread_id}` | `checkpointer:delete` |
| `GET` | `/v1/threads/{thread_id}/state` | `checkpointer:read` |
| `PUT` | `/v1/threads/{thread_id}/state` | `checkpointer:write` |
| `DELETE` | `/v1/threads/{thread_id}/state` | `checkpointer:delete` |
| `GET` | `/v1/threads/{thread_id}/messages` | `checkpointer:read` |
| `POST` | `/v1/threads/{thread_id}/messages` | `checkpointer:import` (explicit grant) |
| `GET` | `/v1/threads/{thread_id}/messages/{message_id}` | `checkpointer:read` |
| `PUT` | `/v1/threads/{thread_id}/messages/{message_id}` | `checkpointer:write` |
| `DELETE` | `/v1/threads/{thread_id}/messages/{message_id}` | `checkpointer:delete` |

There is no create-thread endpoint. A thread is created implicitly when `POST /v1/graph/invoke` or `POST /v1/graph/stream` omits `thread_id` and the server generates one. With `runs.thread_ids` set to `client`, the first request that names an unused id creates it instead. See [Graph endpoints](/docs/reference/rest-api/graph).

## Response envelope and shared rules

Every successful response is a JSON object with a `data` field holding the result and a `metadata` object with `request_id`, `timestamp` and `message`. The examples below show only the `data` value. If no checkpointer is configured, the routes return `503` with `Checkpointer is not configured`. See [REST API conventions](/docs/reference/rest-api/conventions) for the full envelope and error format.

| Rule | Behavior |
| --- | --- |
| `thread_id` type | String or integer. An empty or whitespace-only string, or an integer below `1`, returns `422`. |
| `limit` | Default `100`, clamped to a maximum of `1000`. A value of `0` or less returns `422`. |
| `offset` | Must be `>= 0`, otherwise `422`. |
| `config` in a request body | Client keys are merged into the checkpointer config. The path `thread_id` always wins, and the server-owned keys `authz`, `user`, `user_id`, `remote_tools` and any key starting with `_` are dropped. |

The curl examples in this page assume a local server on port 8000 and a token in `$TOKEN`. Omit the `Authorization` header if auth is not configured.

## List threads

`GET /v1/threads` returns the threads stored in the checkpointer. The listing is scoped to the calling user by the service layer.

| Query parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `search` | string | none | Free-text filter over thread records |
| `offset` | integer | none | Number of threads to skip. A negative value returns `422` |
| `limit` | integer | `100` | Page size. A value above `1000` is lowered to `1000`; zero or a negative value returns `422` |

```bash
# List the first 20 threads whose records match "weather"
curl "http://localhost:8000/v1/threads?search=weather&limit=20" \
  -H "Authorization: Bearer $TOKEN"
```

Each item is a thread record with `thread_id`, `thread_name`, `user_id`, `metadata`, `updated_at` and `run_id` (the full field set of `ThreadInfo`; unset fields are `null`).

```json
{
  "threads": [
    {"thread_id": "t1", "thread_name": "Weather in Paris", "user_id": "user-123", "metadata": null, "updated_at": "2026-04-01T10:00:00", "run_id": null}
  ]
}
```

## Get a thread

`GET /v1/threads/{thread_id}` returns the record for one thread: its metadata, not its messages or state. The record is nested under `thread_data.thread`, and `thread` is `null` when the checkpointer has no record.

```bash
# Fetch the record for thread t1
curl http://localhost:8000/v1/threads/t1 -H "Authorization: Bearer $TOKEN"
```

```json
{
  "thread_data": {
    "thread": {"thread_id": "t1", "thread_name": "Weather in Paris", "user_id": "user-123", "metadata": null, "updated_at": "2026-04-01T10:00:00", "run_id": null}
  }
}
```

## Delete a thread

`DELETE /v1/threads/{thread_id}` removes a thread and its checkpointed data. The request body is required: send `{}` or `{"config": {}}`.

```bash
# Delete thread t1 (the body is required, even when empty)
curl -X DELETE http://localhost:8000/v1/threads/t1 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"config": {}}'
```

```json
{"success": true, "message": "Thread deleted successfully", "data": null}
```

If file, trace or ownership-cache cleanup fails after the thread is deleted, the answer is `success: false` with the message `Thread deleted, but cleanup did not finish: <steps>` and `data` like this. The thread itself is gone. A delete also releases the files linked to that thread by their own metadata, even when no message references them (local and memory media stores; the cloud store cannot list its files, so it is skipped). A file left with no thread is deleted only with `media.delete_with_thread` on, which is the default.

```json
{"success": false, "message": "Thread deleted, but cleanup did not finish: cache", "data": {"deleted": true, "cleanup_failed": ["cache"], "result": {}}}
```

`cleanup_failed` lists the steps that failed. Check `success` before you treat the delete as fully clean. On success, the inner `data` is whatever the checkpointer returns from its clean-up. The server also deletes the thread's telemetry traces when a telemetry store is bound, and evicts the thread's cached ownership entry, so the `thread_id` can be reused by a different user afterwards.

## Thread and message ids

Thread, message and memory ids must match `^[A-Za-z0-9._:@-]{1,128}$`: 1 to 128 letters, digits and `. _ : @ -`, with no spaces or slashes. Other ids in the path or body get `422` `VALIDATION_ERROR`. See [Conventions](/docs/reference/rest-api/conventions#resource-ids).

## Writes while a run is active

These routes answer `409` (code `HTTPException`, message `thread is busy`, `Retry-After: 5`) at once while a run holds the thread, instead of waiting: `PUT /v1/threads/{thread_id}/state`, `DELETE /v1/threads/{thread_id}/state`, `POST /v1/threads/{thread_id}/messages`, `DELETE /v1/threads/{thread_id}/messages/{message_id}`, `DELETE /v1/threads/{thread_id}` and `POST /v1/graph/fix`. A write that raced a run would be overwritten by it, or would bring a deleted thread back. Retry after the run ends, or stop it with `POST /v1/graph/stop`.

## Get thread state

`GET /v1/threads/{thread_id}/state` returns the saved state for a thread. If the checkpointer has no persisted state, the server falls back to the state cache.

```bash
# Read the saved state of thread t1
curl http://localhost:8000/v1/threads/t1/state -H "Authorization: Bearer $TOKEN"
```

```json
{
  "state": {
    "context": [
      {"role": "user", "content": [{"type": "text", "text": "Hello"}]},
      {"role": "assistant", "content": [{"type": "text", "text": "Hi there!"}]}
    ]
  }
}
```

The exact fields depend on your `AgentState` subclass. `state` is `null` when nothing is stored. Messages in `context` carry no `raw` field, and `execution_meta.internal_data` holds only `error` when a run failed. With `MODE=production` that error is a generic message with its error code, as in stream error chunks, not the exception text. The rest of `internal_data` stays on the server.

## Update thread state

`PUT /v1/threads/{thread_id}/state` merges the fields you send into the existing state, writes the result to the checkpointer and the cache, and returns the merged state.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `state` | object | yes | State fields to merge into the current state |
| `config` | object | no | Extra keys merged into the checkpointer config |

The merge rules are fixed. `context` is appended to the existing list, not replaced. Nested dictionaries are deep-merged, other values overwrite, and `null` values are ignored. The server refuses some input with `422`:

- The built-in fields `context_summary` and `execution_meta` can never be set by a client.
- Messages in `context` must be user messages. A message with role `assistant` or `system` returns `422`. A `tool` message is accepted only as `tool_result` blocks that answer a pending client tool call.
- Messages that carry a tool call return `422`, because only the model may request tools.
- Any `message_id` you send in `context` is ignored. The server generates the ids.
- A value that does not match the type of its state field returns `422` and names the field. This includes `context`, which must be a list of messages.

Custom state fields are allowed. If the operator set `runs.state_keys` in `10xgraph.json`, only the listed keys are accepted.

```bash
# Add a custom field to the state before the first invoke
curl -X PUT http://localhost:8000/v1/threads/t1/state \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"state": {"user_id": "user-456"}, "config": {}}'
```

The response `data` has the same shape as the get-state response: `{"state": {...}}` with the merged state. Use this endpoint to seed custom fields before the first invoke call or to repair inconsistent state. A custom field must exist on your state class to survive validation.

## Clear thread state

`DELETE /v1/threads/{thread_id}/state` clears the saved state for a thread, so the next invoke call with this `thread_id` starts fresh. It takes no body.

```bash
# Clear the saved state of thread t1
curl -X DELETE http://localhost:8000/v1/threads/t1/state -H "Authorization: Bearer $TOKEN"
```

```json
{"success": true, "message": "State cleared successfully", "data": null}
```

Here too, the inner `data` is the checkpointer's return value.

## List messages

`GET /v1/threads/{thread_id}/messages` returns the conversation messages stored for a thread.

| Query parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `search` | string | none | Free-text filter over message content |
| `offset` | integer | none | Number of messages to skip. A negative value returns `422` |
| `limit` | integer | `100` | Page size. A value above `1000` is lowered to `1000`; zero or a negative value returns `422` |

```bash
# Read up to 50 messages from thread t1
curl "http://localhost:8000/v1/threads/t1/messages?limit=50" \
  -H "Authorization: Bearer $TOKEN"
```

```json
{
  "messages": [
    {"message_id": "m1", "role": "user", "content": [{"type": "text", "text": "Hello"}]},
    {"message_id": "m2", "role": "assistant", "content": [{"type": "text", "text": "Hi there!"}]}
  ]
}
```

Each item is a `Message` object. Fields such as `timestamp`, `metadata` and `usages` are also included; they are omitted above for brevity.

## Store messages

`POST /v1/threads/{thread_id}/messages` writes messages to a thread, for example to import a conversation. It accepts messages of any role, so it is admin-only. The caller needs the `checkpointer:import` scope granted explicitly. A token that declares no scopes gets `403`, and a role of `"*"` has the scope. Normal clients send messages through invoke or stream, and use [Set message feedback](#set-message-feedback) to attach feedback.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `messages` | array of `Message` | yes | Messages to store. An empty array returns `422`. |
| `metadata` | object | no | Arbitrary metadata stored with the write |
| `config` | object | no | Extra keys merged into the checkpointer config |

`content` is a list of content blocks, so send `[{"type": "text", "text": "..."}]` rather than a plain string. Messages that carry a tool call return `422`, and any media files they reference must belong to the caller.

```bash
# Import one user message into thread t1
curl -X POST http://localhost:8000/v1/threads/t1/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": [{"type": "text", "text": "Injected message"}]}],
    "metadata": {"source": "import"}
  }'
```

```json
{"success": true, "message": "Messages put successfully", "data": null}
```

## Get a message

`GET /v1/threads/{thread_id}/messages/{message_id}` returns a single `Message` object as `data`. An empty or whitespace-only `message_id` returns `422`, and a `message_id` the thread does not have returns `404`. The provider's raw response (`raw`) is never included.

```bash
# Fetch message m1 from thread t1
curl http://localhost:8000/v1/threads/t1/messages/m1 -H "Authorization: Bearer $TOKEN"
```

## Set message feedback

`PUT /v1/threads/{thread_id}/messages/{message_id}` stores feedback on a message, for example a thumbs up or down with a comment. It writes to `message.metadata["feedback"]` and replaces any earlier feedback. Nothing else on the message can change.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `feedback` | object | yes | Any JSON object. At most 8 KB serialized and 10 levels deep, otherwise `422`. |

```bash
# Record a thumbs-down with a comment on message m2
curl -X PUT http://localhost:8000/v1/threads/t1/messages/m2 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"feedback": {"rating": "down", "comment": "Wrong city"}}'
```

The response `data` is the updated `Message`, the same shape as [Get a message](#get-a-message). The route returns `404` when the thread has no such message, and `501` when the checkpointer lacks `aupdate_message_metadata` (added in `10xgraph` 1.0; the message is "This checkpointer does not support message feedback").

## Delete a message

`DELETE /v1/threads/{thread_id}/messages/{message_id}` removes one message. The body is required and takes the same `config` object as the other write routes. A `message_id` the thread does not have returns `404`.

```bash
# Delete message m1 from thread t1
curl -X DELETE http://localhost:8000/v1/threads/t1/messages/m1 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"config": {}}'
```

```json
{"success": true, "message": "Message deleted successfully", "data": null}
```

## Authentication and ownership

When auth is configured, every thread route requires a bearer token and the scope shown in the [route summary](#route-summary). A failed login returns `401`. A missing scope or a thread owned by someone else returns `403`. When auth is not configured, these checks are skipped entirely.

Thread ownership is enforced by the ownership authorization backend. It is the default when `MODE=production` and no `authorization` is configured, and it can be selected explicitly with `"authorization": "ownership"`. In development, the default backend allows every authenticated user. With ownership active, a request for a thread owned by another user is rejected with `403` before it reaches the checkpointer, for every action. A `thread_id` that does not exist yet is refused with `403`, the same answer as for another user's thread, unless `runs.thread_ids` is `client`. A new thread is started by omitting the id. The checkpointer write routes follow the same rule. See [`runs.thread_ids`](/docs/reference/api-cli/configuration#thread_ids). Ownership checks need a checkpointer that can report a thread's owner, such as the Postgres checkpointer; otherwise the check is inactive and the server logs a warning.

See [Authentication](/docs/reference/api-cli/auth) for the backends and how to write your own.
