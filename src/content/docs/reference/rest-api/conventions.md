---
title: Conventions and permissions
description: "The 10xGraph REST API response envelope, HTTP and WebSocket authentication, the endpoint permission table, WebSocket close codes and HTTP status codes."
section: Reference
group: "REST API"
order: 300
label: Conventions and permissions
updated: "2026-10-27"
---

Every route in the 10xGraph REST API lives under `/v1/` (except `/ping`), returns the same JSON envelope, authenticates with a Bearer token, and is guarded by a resource and action permission pair. This page lists those shared rules, the full permission table, the WebSocket close codes and the HTTP status codes.

## Base URL and response envelope

Successful responses wrap the payload in `data` and add a `metadata` object with `request_id`, `timestamp` and `message`. Errors raised by the application return `error` instead, with the same `metadata`. The `details` list is empty unless the error carries extra context (validation errors, or the `context` of a graph or node error outside production).

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

Errors from `HTTPException` (permission denied, not found, empty upload) use the code `HTTPException`. Request validation failures use `VALIDATION_ERROR`. Three responses come from middleware and do not use this exact shape: the `state_conflict` `409`, `413` and `429` (see [HTTP status codes](#http-status-codes)).

## Authentication

When `auth` is configured in `10xgraph.json`, every endpoint except `/ping` (and the public eval routes) needs a Bearer token. Send it as an `Authorization` header on HTTP routes. WebSocket clients that cannot set headers have two fallbacks, listed here in order of preference.

```text
Authorization: Bearer <token>
```

```javascript
// Preferred for browsers: the token rides in a request header, not the URL
new WebSocket("ws://host/v1/graph/ws", ["10xgraph-bearer", token]);
```

```text
# Last-resort fallback (WebSocket only): the token lands in URLs and access logs
/v1/graph/ws?token=<token>
```

The server echoes the `10xgraph-bearer` sentinel back on accept, which browsers require to complete the handshake. The older `agentflow-bearer` sentinel is accepted until 2.0. The `?token=` query parameter is read only on WebSocket connections.

If auth is not configured (`"auth": null`), credentials are not required. Missing, invalid or expired credentials return HTTP `401`. A permission failure returns `403`. On WebSocket routes both become close code `1008`. See [authentication](/docs/server/auth) for setup.

## Permission model

Each endpoint declares one `(resource, action)` pair. On every request the server calls `authorize(user, resource, action)` on the configured `AuthorizationBackend`. The built-in `DefaultAuthorizationBackend` allows any request whose user has a `user_id`, so write your own backend for real access control.

### Permission reference

The table lists every `(resource, action)` pair the server enforces. `POST /v1/ag-ui` exists only when `ag_ui.enabled` is true in `10xgraph.json`. The `/v1/evals/*` routes are mounted only when `MODE` is not `production`.

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
| `GET /v1/threads/{id}/state` | `checkpointer` | `read` |
| `PUT /v1/threads/{id}/state` | `checkpointer` | `write` |
| `DELETE /v1/threads/{id}/state` | `checkpointer` | `delete` |
| `GET /v1/threads/{id}/messages` | `checkpointer` | `read` |
| `GET /v1/threads/{id}/messages/{msg}` | `checkpointer` | `read` |
| `POST /v1/threads/{id}/messages` | `checkpointer` | `import` (explicit grant, admin only) |
| `PUT /v1/threads/{id}/messages/{msg}` | `checkpointer` | `write` |
| `DELETE /v1/threads/{id}/messages/{msg}` | `checkpointer` | `delete` |
| `GET /v1/threads` | `checkpointer` | `read` |
| `GET /v1/threads/{id}` | `checkpointer` | `read` |
| `DELETE /v1/threads/{id}` | `checkpointer` | `delete` |
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
| `GET /v1/config/multimodal` | `config` | `read` |
| `GET /ping` | (none) | (none) |
| `GET /v1/evals/runs` | (none) | (none) |
| `GET /v1/evals/runs/{run_id}` | (none) | (none) |

The last three rows are the complete public allowlist. Every other route must carry a `RequirePermission` guard, and the server refuses to start if one does not.

<aside class="callout callout-warning" role="note"><p class="callout-title">The eval endpoints are unauthenticated</p>

`/v1/evals/runs*` serves the contents of `eval_reports/` to anyone who can reach the port, regardless of your `auth` setting. They are not mounted when `MODE=production`. Outside production, keep `eval_reports/` out of the deployed working directory or block `/v1/evals/*` at your ingress. See [eval endpoints](/docs/reference/rest-api/evals).

</aside>

## WebSocket close codes

WebSocket routes report failures with close codes instead of HTTP statuses. `1008` also covers a graph that is on the wrong socket: a realtime graph on `/v1/graph/ws`, or a turn-based graph on `/v1/graph/live`.

| Code | Name | When |
| --- | --- | --- |
| `1000` | Normal closure | The client disconnected cleanly |
| `1008` | Policy violation | Authentication or authorization failed, or the graph type does not match the route |
| `1011` | Server error | Unexpected server error |
| `1013` | Try again later | Rate limit or connection cap exceeded at the handshake |

## HTTP status codes

These are the status codes the server returns. Routes document their own specific causes on their pages.

| Code | When |
| --- | --- |
| `200` | Success |
| `400` | Empty file upload, missing filename, or malformed `Content-Length` |
| `401` | Missing, invalid or expired credentials |
| `403` | Insufficient permissions, or access to a thread you do not own |
| `404` | File, thread, message or eval run not found |
| `409` | A run on this thread is still active after 30 seconds (`message` is `thread is busy`), or a `resume` named an `interrupt_id` that does not match the open interrupt. Standard error body with code `HTTPException`. See [One run per thread](/docs/reference/rest-api/graph#one-run-per-thread) |
| `409` | Another run updated the thread while yours was in flight. Body is `{"error": "state_conflict", "detail": "...", "thread_id": ...}`. Reload the thread and retry |
| `413` | Request body over `MAX_REQUEST_SIZE` (default 10 MB), or upload over `MEDIA_MAX_SIZE_MB` (default 25) |
| `415` | Uploaded content type not allowed |
| `422` | Request validation error (malformed body or invalid parameter), a request over the [size limits](/docs/reference/rest-api/graph) (500 messages, 100 blocks per message, 1,000,000 characters of text), or a resume answer that fails the interrupt's `response_schema` |
| `429` | Rate limit exceeded. Body has `error.code` `RATE_LIMIT_EXCEEDED`; the `Retry-After` and `X-RateLimit-*` headers say when to retry |
| `500` | Unexpected server error |
| `503` | Checkpointer or storage temporarily unavailable |
