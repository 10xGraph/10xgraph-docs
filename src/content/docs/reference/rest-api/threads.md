---
title: Thread endpoints
seoTitle: "Threads REST API reference"
description: "Reference for the 10xGraph REST endpoints that read and write thread state and messages, with request fields, responses, and auth requirements."
section: Reference
group: "REST API"
order: 340
label: Threads
updated: "2026-11-25"
faq:
  - q: "How do I create a thread over the REST API?"
    a: "There is no create-thread endpoint. A thread comes into existence when you call the invoke or stream endpoint without a thread_id and the server generates one. With `runs.thread_ids` set to `client`, it also comes into existence the first time a request uses an id you picked."
  - q: "Why do I get 404 on a thread I know exists?"
    a: "With auth on, a thread can only be reached by the user who owns it (or by a role whose reach is wider, for reads and deletes). To anyone else it does not exist, so the answer is 404, never 403. A missing permission returns 403."
  - q: "Is the limit parameter capped?"
    a: "Yes. The list endpoints default to 100 items and clamp any larger limit to 1000. A limit of 0 or less returns 422."
---

The thread endpoints read and manage what the checkpointer stores for a conversation: the thread record, its saved state and its messages. Every route lives under `/v1/threads` and is addressed by `thread_id`.

## Route summary

The server exposes ten thread routes. Reads need `threads:read`, writes need `threads:write`, and deletes need `threads:delete`.

| Method | Path | Permission |
| --- | --- | --- |
| `GET` | `/v1/threads` | `threads:read` |
| `GET` | `/v1/threads/{thread_id}` | `threads:read` |
| `DELETE` | `/v1/threads/{thread_id}` | `threads:delete` |
| `GET` | `/v1/threads/{thread_id}/state` | `threads:read` |
| `PUT` | `/v1/threads/{thread_id}/state` | `threads:write` |
| `DELETE` | `/v1/threads/{thread_id}/state` | `threads:delete` |
| `GET` | `/v1/threads/{thread_id}/messages` | `threads:read` |
| `GET` | `/v1/threads/{thread_id}/messages/{message_id}` | `threads:read` |
| `PUT` | `/v1/threads/{thread_id}/messages/{message_id}` | `threads:write` |
| `DELETE` | `/v1/threads/{thread_id}/messages/{message_id}` | `threads:delete` |

There is no create-thread route: omit `thread_id` on invoke or stream. With `runs.thread_ids: client`, naming an unused id creates it. See [Graph endpoints](/docs/reference/rest-api/graph).

## Response envelope and shared rules

Every successful response is a JSON object with a `data` field holding the result and a `metadata` object with `request_id`, `timestamp` and `message`. The examples below show only the `data` value. If no checkpointer is configured, the routes return `503` with `Checkpointer is not configured`. See [REST API conventions](/docs/reference/rest-api/conventions) for the full envelope and error format.

| Rule | Behavior |
| --- | --- |
| `thread_id` type | String or integer. An empty or whitespace-only string, or an integer below `1`, returns `422`. |
| `limit` | Default `100`, clamped to a maximum of `1000`. A value of `0` or less returns `422`. |
| `offset` | Must be `>= 0`, otherwise `422`. |
| `config` in a request body | Client keys are merged into the checkpointer config. The path `thread_id` always wins; server-owned keys are dropped (see [Conventions](/docs/reference/rest-api/conventions)). |

## List threads

`GET /v1/threads` returns the threads stored in the checkpointer. The listing is scoped to the calling user by the service layer.

| Query parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `search` | string | none | Free-text filter over thread records |
| `offset` | integer | none | Number of threads to skip. A negative value returns `422` |
| `limit` | integer | `100` | Page size. A value above `1000` is lowered to `1000`; zero or a negative value returns `422` |
| `filters` | string (JSON object) | none | Column conditions, for example `{"plan": "pro", "created_at": {"gte": "2026-01-01T00:00:00+00:00"}}`. Filterable: `thread_name`, `created_at`, `updated_at` and the checkpointer's extra columns. Tenant columns and `user_id` are refused. Needs `PgCheckpointer`. Invalid JSON, a column or operator that is not allowed, or a checkpointer without filterable columns returns `422`. At most 8192 characters. See [Filters](/docs/guides/multi-tenant-data#filters) |

```bash
# List the first 20 threads whose records match "weather"
curl "http://localhost:8000/v1/threads?search=weather&limit=20" \
  -H "Authorization: Bearer $TOKEN"

# Only threads whose "plan" extra column is "pro"
curl -G "http://localhost:8000/v1/threads" \
  --data-urlencode 'filters={"plan": "pro"}' \
  -H "Authorization: Bearer $TOKEN"
```

Each item is a thread record with `thread_id`, `thread_name`, `user_id`, `metadata`, `updated_at` and `run_id`.

```json
{
  "threads": [
    {"thread_id": "t1", "thread_name": "Weather in Paris", "user_id": "user-123", "metadata": null, "updated_at": "2026-04-01T10:00:00", "run_id": null}
  ],
  "has_more": false,
  "offset": 0,
  "limit": 100
}
```

`has_more` is true when another page follows; `offset` and `limit` are the values applied.

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

If file or trace cleanup fails after the thread is deleted, the answer is `success: false` with the message `Thread deleted, but cleanup did not finish: <steps>` and `data` like this. The thread itself is gone. Files that only this thread referenced are deleted too (`media.delete_with_thread`, default true).

```json
{"success": false, "message": "Thread deleted, but cleanup did not finish: traces", "data": {"deleted": true, "cleanup_failed": ["traces"], "result": {}}}
```

`cleanup_failed` lists the steps that failed. Check `success` before you treat the delete as fully clean. On success, the inner `data` is whatever the checkpointer returns from its clean-up.

## Thread and message ids

Ids must match the rule in [Conventions](/docs/reference/rest-api/conventions#resource-ids).

## Writes while a run is active

These routes answer `409` (code `HTTPException`, message `thread is busy`, `Retry-After: 5`) at once while a run holds the thread, instead of waiting: `PUT /v1/threads/{thread_id}/state`, `DELETE /v1/threads/{thread_id}/state`, `DELETE /v1/threads/{thread_id}/messages/{message_id}`, `DELETE /v1/threads/{thread_id}` and `POST /v1/graph/fix`. Retry after the run ends, or stop it with `POST /v1/graph/stop`.

## Get thread state

`GET /v1/threads/{thread_id}/state` returns the saved state for a thread.

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

The exact fields depend on your `AgentState` subclass. `state` is `null` when nothing is stored. Messages carry no `raw` field.

## Update thread state

`PUT /v1/threads/{thread_id}/state` merges the fields you send into the existing state, writes the result to the checkpointer and the cache, and returns the merged state.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `state` | object | yes | State fields to merge into the current state |
| `config` | object | no | Extra keys merged into the checkpointer config |

The merge rules are fixed. `context` is appended to the existing list, not replaced. Nested dictionaries are deep-merged, other values overwrite, and `null` values are ignored. The server refuses some input with `422`:

- The built-in fields `context_summary` and `execution_meta` can never be set by a client.
- Messages in `context` must be user messages. A message with role `assistant` or `system` returns `422`. A `tool` message is accepted only as `tool_result` blocks that answer a pending client tool call.
- Messages that carry a tool call return `422`.
- Any `message_id` you send in `context` is ignored. The server generates the ids.
- A value that does not match the type of its state field returns `422` and names the field. This includes `context`, which must be a list of messages.

Keys outside `runs.state_keys` get `422` (`context` is always allowed).

```bash
# Add a custom field to the state before the first invoke
curl -X PUT http://localhost:8000/v1/threads/t1/state \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"state": {"user_id": "user-456"}, "config": {}}'
```

The response `data` has the same shape as the get-state response: `{"state": {...}}` with the merged state.

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
  ],
  "has_more": false,
  "offset": 0,
  "limit": 100
}
```

`has_more` is true when another page follows; `offset` and `limit` are the values applied.

Each item is a `Message` object. Fields such as `timestamp`, `metadata` and `usages` are also included; they are omitted above for brevity.

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

The response `data` is the updated `Message`, the same shape as [Get a message](#get-a-message). The route returns `404` when the thread has no such message, and `501` when the checkpointer cannot store message feedback.

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
{"success": true, "message": "Message deleted successfully"}
```

## Authentication and ownership

Ownership is enforced in storage. With reach `own` another user's thread answers `404`; roles with reach `tenant` or `all` can read, list and delete beyond their own, but state and message writes (`PUT`) and runs stay on the caller's own threads. See [Authentication and authorization](/docs/server/auth).
