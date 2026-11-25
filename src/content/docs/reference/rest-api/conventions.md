---
title: Conventions and permissions
description: "The 10xGraph REST API response envelope, HTTP and WebSocket authentication, the endpoint permission table, WebSocket close codes and HTTP status codes."
section: Reference
group: "REST API"
order: 300
label: Conventions and permissions
updated: "2026-11-25"
---

Shared rules for every route: response envelope, authentication, the permission table, WebSocket close codes and HTTP status codes.

## Base URL and response envelope

Successful responses wrap the payload in `data` and add a `metadata` object with `request_id`, `timestamp` and `message`. Errors raised by the application return `error` instead, with the same `metadata`. The `details` list is empty unless the error carries extra context (validation errors, or the `context` of a graph or node error outside production).

Errors from `HTTPException` (permission denied, not found, empty upload) use the code `HTTPException`. Request validation failures use `VALIDATION_ERROR`. Data the database cannot store (a NUL character, a lone surrogate, a number out of range) uses `INVALID_REQUEST_DATA`. Authentication failures use `INVALID_TOKEN`, `EXPIRED_TOKEN` or `REVOKED_TOKEN`; see the [auth error codes](/docs/reference/api-cli/auth). The `413` (`REQUEST_TOO_LARGE`), `429` (`RATE_LIMIT_EXCEEDED`, `RATE_LIMIT_UNAVAILABLE`) and `state_conflict` `409` responses come from middleware and use their own body shape.

Run routes accept an opt-in `Idempotency-Key` header; see [Idempotency keys](/docs/reference/rest-api/graph#idempotency-keys). `IDEMPOTENCY_TTL_SECONDS` (default 86400) sets how long a finished run is remembered.

```json
{
  "data": {},
  "metadata": {
    "request_id": "550e8400-e29b-41d4-a716-446655440000",
    "timestamp": "2026-05-23T10:00:00",
    "message": "OK"
  }
}
```

```json
{
  "error": {
    "code": "EXPIRED_TOKEN",
    "message": "Token has expired, please login again",
    "details": []
  },
  "metadata": {
    "request_id": "550e8400-e29b-41d4-a716-446655440000",
    "timestamp": "2026-05-23T10:00:00",
    "message": "Token has expired, please login again"
  }
}
```

## Resource ids

Thread, message and memory ids must match `^[A-Za-z0-9._:@-]{1,128}$`: 1 to 128 letters, digits and `. _ : @ -`, with no spaces or slashes. This applies to the `thread_id`, `message_id` and `memory_id` path parameters and to `thread_id` and `config.thread_id` in request bodies. Any other id gets `422` with code `VALIDATION_ERROR`. Ids the server makes itself (Snowflake integers, UUIDs, store memory ids) always fit.

The same rule covers the WebSocket `config.thread_id`, the `thread_id` in the `/v1/graph/live` init frame and the AG-UI `threadId` (an error frame or `422`, code `VALIDATION_ERROR`).

## Request size limits

Client dicts and lists (`config`, `initial_state`, `resume`, `metadata`, `filters`, and the bodies of the store and checkpointer routes and WebSocket frames) are capped beside the nesting depth limit (64 levels by default, `MAX_NESTING_DEPTH`): at most 1000 keys per object, 10000 items per list and 200000 values in all. A body over a cap gets `422` `VALIDATION_ERROR`. The key, item and value caps are fixed and have no setting.

Server-owned keys in a client `config` are dropped, not refused: `user`, `user_id`, `credential`, `remote_tools`, `ag_ui`, `file_tool_root`, `workspace_root`, `tool_timeout`, `node_timeout`, `max_parallel_tool_calls`, `collection`, and any key starting with `_`.

## Authentication

When `auth` is configured in `10xgraph.json`, every endpoint except `/ping` and `/health/ready` needs a Bearer token. Send it as an `Authorization` header on HTTP routes. WebSocket clients that cannot set headers send the token in the `Sec-WebSocket-Protocol` header.

```text
Authorization: Bearer <token>
```

```javascript
// Preferred for browsers: the token rides in a request header, not the URL
new WebSocket("ws://host/v1/graph/ws", ["10xgraph-bearer", token]);
```

A `?token=` query parameter is not accepted. The older `agentflow-bearer` sentinel is accepted until 2.0.

If auth is not configured (`"auth": null`), credentials are not required. Missing, invalid or expired credentials return HTTP `401`. A permission failure returns `403`. On WebSocket routes both become close code `1008`. See [authentication](/docs/server/auth) for setup.

## Permission model

Each endpoint declares one `(resource, action)` pair. On every request the server calls `authorize(identity, "resource:action", resource_id)` on your `BaseAuth`. The default implementation checks the permissions on the caller's `Identity`: everything except `admin:*` when no roles are configured, or what the caller's roles grant. A missing permission answers `403`; a thread, message, memory, file or run outside the caller's reach answers `404`. See [authentication and authorization](/docs/server/auth).

### Permission reference

The table lists every `(resource, action)` pair the server enforces. `POST /v1/ag-ui` exists only when `ag_ui.enabled` is true in `10xgraph.json`, and the `/v1/tasks` routes only when background tasks are configured.

| Endpoint | Resource | Action |
| --- | --- | --- |
| `POST /v1/graph/invoke` | `graph` | `invoke` |
| `POST /v1/graph/stream` | `graph` | `stream` |
| `POST /v1/ag-ui` | `graph` | `stream` |
| `WebSocket /v1/graph/ws` | `graph` | `stream` |
| `WebSocket /v1/graph/live` | `graph` | `stream` |
| `GET /v1/graph` | `graph` | `read` |
| `GET /v1/graph/tools` | `graph` | `read` |
| `GET /v1/observability/{thread_id}` | `graph` | `read` |
| `GET /v1/graph:StateSchema` | `graph` | `read` |
| `POST /v1/graph/stop` | `graph` | `stop` |
| `POST /v1/graph/fix` | `graph` | `fix` |
| `GET /v1/threads/{id}/state` | `threads` | `read` |
| `PUT /v1/threads/{id}/state` | `threads` | `write` |
| `DELETE /v1/threads/{id}/state` | `threads` | `delete` |
| `GET /v1/threads/{id}/messages` | `threads` | `read` |
| `GET /v1/threads/{id}/messages/{msg}` | `threads` | `read` |
| `PUT /v1/threads/{id}/messages/{msg}` | `threads` | `write` |
| `DELETE /v1/threads/{id}/messages/{msg}` | `threads` | `delete` |
| `GET /v1/threads` | `threads` | `read` |
| `GET /v1/threads/{id}` | `threads` | `read` |
| `DELETE /v1/threads/{id}` | `threads` | `delete` |
| `POST /v1/store/memories` | `store` | `write` |
| `POST /v1/store/search` | `store` | `read` |
| `POST /v1/store/memories/{id}` | `store` | `read` |
| `POST /v1/store/memories/list` | `store` | `read` |
| `PUT /v1/store/memories/{id}` | `store` | `write` |
| `DELETE /v1/store/memories/{id}` | `store` | `delete` |
| `POST /v1/store/memories/forget` | `store` | `delete` |
| `POST /v1/files/upload` | `files` | `upload` |
| `GET /v1/files/{id}` | `files` | `read` |
| `GET /v1/files/{id}/info` | `files` | `read` |
| `GET /v1/files/{id}/url` | `files` | `read` |
| `GET /v1/files` | `files` | `read` |
| `DELETE /v1/files/{id}` | `files` | `delete` |
| `GET /v1/config/multimodal` | `config` | `read` |
| `GET /v1/tasks/{id}` | `tasks` | `read` |
| `POST /v1/tasks/{name}` and `PATCH /v1/tasks/{id}` | `tasks` | `trigger` |
| `POST /v1/tasks/{id}/cancel` | `tasks` | `cancel` |
| `GET /v1/me` | (identity only) | (none) |
| `GET /ping` | (none) | (none) |
| `GET /health/ready` | (none) | (none) |

`/ping` and `/health/ready` are the complete public allowlist. Every other route must carry a `RequirePermission` guard, and the server refuses to start if one does not.


## WebSocket close codes

WebSocket routes report failures with close codes instead of HTTP statuses.

| Code | Name | When |
| --- | --- | --- |
| `1000` | Normal closure | The client disconnected cleanly |
| `1003` | Unsupported data | The `/v1/graph/live` init frame is not a JSON object |
| `1008` | Policy violation | Authentication or authorization failed, the token expired or was revoked while the socket was open, or the graph type does not match the route |
| `1009` | Message too big | A frame is over `MAX_REQUEST_SIZE` (the live init frame limit is 1 MiB) |
| `1011` | Server error | Unexpected server error |
| `1012` | Service restart | The graph is closing; reconnect |
| `1013` | Try again later | Rate limit or connection cap exceeded at the handshake, or the client stopped reading |

## HTTP status codes

| Code | When |
| --- | --- |
| `200` | Success |
| `400` | Empty file upload, missing filename, malformed `Content-Length` (code `INVALID_CONTENT_LENGTH`), or an external media URL the media policy blocks |
| `401` | Missing, invalid, expired or revoked credentials (`INVALID_TOKEN`, `EXPIRED_TOKEN`, `REVOKED_TOKEN`) |
| `403` | Missing permission. An upload by an identity with no tenant value (when the checkpointer declares tenant columns) |
| `404` | File, thread, message or memory not found, or outside the caller's reach |
| `409` | A run on this thread is still active after 30 seconds (`message` is `thread is busy`), or a resume does not fit the thread: the `interrupt_id` does not match, the thread is not paused, or a plain message was sent to a thread paused at an `interrupt()`. The busy answer carries `Retry-After: 5`. The same status answers a repeated `Idempotency-Key` while its run is going (with `Retry-After: 5`), a finished key on AG-UI or WebSocket, and a stored thread whose node no longer exists (`GRAPH_NODE_MISSING_001`). Standard error body with code `HTTPException`. See [One run per thread](/docs/reference/rest-api/graph#one-run-per-thread) |
| `409` | Another run updated the thread while yours was in flight. Body is `{"error": "state_conflict", "detail": "...", "thread_id": ...}`. Reload the thread and retry |
| `413` | Request body over `MAX_REQUEST_SIZE` (default 10 MB), or upload over `MEDIA_MAX_SIZE_MB` (default 25) |
| `415` | Uploaded content type not allowed |
| `422` | Request validation error (malformed body or invalid parameter), a request over the [size limits](/docs/reference/rest-api/graph#post-v1graphinvoke), an `initial_state`, `config` or `resume` nested deeper than `MAX_NESTING_DEPTH` (64 by default) or over the [size caps](#request-size-limits), an `Idempotency-Key` that is malformed or reused with a different body, an upload with no `file` part, a resume answer that fails the interrupt's `response_schema`, or data the database cannot store, such as a NUL character, a lone surrogate or a number out of range (code `INVALID_REQUEST_DATA`) |
| `429` | Rate limit exceeded. Body has `error.code` `RATE_LIMIT_EXCEEDED`; the `Retry-After` and `X-RateLimit-*` headers say when to retry. The same status is returned when a user has more than `runs.max_concurrent_per_user` runs in flight (default 10); that body has code `HTTPException` and `Retry-After: 5`. The model provider rate limiting the server also returns `429`, with code `PROVIDER_RATE_LIMITED` and a `Retry-After` taken from the provider (5 seconds if it sends none) |
| `499` | The client closed the request while it waited for a busy thread. The response is never read |
| `500` | Unexpected server error. Body has code `INTERNAL_SERVER_ERROR`; in production the message is generic |
| `501` | The checkpointer cannot store message feedback, or the media store cannot list files |
| `503` | Checkpointer or storage temporarily unavailable (code `SERVICE_UNAVAILABLE` for a database or cache driver error that is not a data error), with `Retry-After`. A rate limiter whose backend is unreachable with `fail_open: false` also answers 503, with code `RATE_LIMIT_UNAVAILABLE` and `Retry-After: 5` |
