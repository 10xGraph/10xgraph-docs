---
title: Memory store endpoints
description: "Reference for /v1/store endpoints: storing, searching, listing, updating, deleting, and forgetting memories through the 10xGraph API server."
section: Reference
group: "REST API"
order: 350
label: Memory store
updated: "2026-10-27"
---

The `/v1/store` endpoints let you store, search, list, read, update, delete and bulk-forget long-term memories through the 10xGraph API server. They work only when a `store` is configured in `10xgraph.json`; without one, every endpoint returns `503` with "Store is not configured". Responses use the standard `data` and `metadata` envelope.

Base path: `/v1/store`

## Request fields shared by every endpoint

Every request body accepts two optional fields besides the endpoint-specific ones, and the server decides whose memories a request touches from the authenticated user, not from the body.

| Field | Type | Description |
| --- | --- | --- |
| `config` | object | Values forwarded to the store backend. Defaults to `{}`. The keys `user_id`, `user`, `authz`, `remote_tools`, `collection` and any key starting with `_` are dropped by the server. |
| `options` | object | Extra keyword arguments forwarded to the store backend. The key `memory_id` is dropped, so the store always generates IDs. |

The server sets `user_id` from the authenticated user (or `anonymous` when auth is off). Sending `user_id` in `config` has no effect. The same goes for `collection`: a client cannot choose the collection, and the routes always use the collection default of the store (a name, or a function the developer set, called with the authenticated `user`). See [Collections](/docs/concepts/memory-and-store#collections-keeping-data-apart). Store operations always need a non-empty `user_id`, so an identity without one cannot use these endpoints. Reserved ids starting with `__system__` (built with `system_user_id(name)`) own shared data such as agent memory and RAG knowledge bases, and the server refuses an authenticated identity whose `user_id` starts with `__system__`. See the [REST conventions](/docs/reference/rest-api/conventions) for the envelope and error format.

---

## POST /v1/store/memories

Store a memory record. Requires `store:write` permission.

**Request body:**

```json
{
  "content": "User prefers concise responses.",
  "memory_type": "episodic",
  "category": "preference",
  "metadata": {"source": "chat"},
  "config": {}
}
```

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `content` | string or `Message` | yes | | Memory text, or a structured `Message` object |
| `memory_type` | string | no | `episodic` | One of `episodic`, `semantic`, `procedural`, `entity`, `relationship`, `custom`, `declarative` |
| `category` | string | no | `general` | Category label for organizing memories |
| `metadata` | object | no | `null` | Arbitrary metadata stored alongside the memory |

**Response (200 OK):**

```json
{
  "data": {
    "memory_id": "mem_abc123"
  },
  "metadata": {
    "request_id": "req_xyz",
    "timestamp": "2026-10-08T10:30:00Z",
    "message": "Memory stored successfully"
  }
}
```

**Error codes:**

- `401` Unauthorized: missing or invalid auth token
- `403` Forbidden: insufficient permission (not `store:write`)

**Example:**

```bash
curl -X POST http://localhost:8000/v1/store/memories \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "User prefers concise responses.",
    "memory_type": "episodic",
    "category": "preference"
  }'
```

---

## POST /v1/store/search

Search memories by semantic similarity. Requires `store:read` permission.

**Request body:**

```json
{
  "query": "How does this user like to receive information?",
  "category": "preference",
  "limit": 5,
  "config": {}
}
```

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `query` | string | yes | | Search query for semantic similarity; empty or whitespace-only returns `422` |
| `memory_type` | string | no | `null` | Filter results by memory type (same values as when storing) |
| `category` | string | no | `null` | Filter results by category |
| `limit` | integer | no | `10` | Maximum results to return; must be between 1 and 100 |
| `score_threshold` | float | no | `null` | Minimum similarity score (between 0 and 1) for a result to be included |
| `filters` | object | no | `null` | Additional store-specific filters |
| `retrieval_strategy` | string | no | `similarity` | One of `similarity`, `temporal`, `relevance`, `hybrid`, `graph_traversal`; support depends on the backend |
| `distance_metric` | string | no | `cosine` | One of `cosine`, `euclidean`, `dot_product`, `manhattan` |
| `max_tokens` | integer | no | `4000` | Token budget for truncation during search; at most 16000 |

**Response (200 OK):**

```json
{
  "data": {
    "results": [
      {
        "id": "mem_abc123",
        "content": "User prefers concise responses.",
        "score": 0.91,
        "memory_type": "episodic",
        "metadata": {"source": "chat", "category": "preference"},
        "user_id": "user-123",
        "thread_id": null,
        "timestamp": "2026-10-08T10:30:00Z"
      }
    ]
  },
  "metadata": {
    "request_id": "req_xyz",
    "timestamp": "2026-10-08T10:30:00Z",
    "message": "OK"
  }
}
```

**Error codes:**

- `401` Unauthorized: missing or invalid auth token
- `403` Forbidden: insufficient permission (not `store:read`)
- `422` Unprocessable Entity: query is empty or whitespace-only, or limit outside valid range

**Example:**

```bash
curl -X POST http://localhost:8000/v1/store/search \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "user preferences",
    "limit": 5,
    "config": {}
  }'
```

---

## POST /v1/store/memories/list

List stored memories (subject to backend limits). Requires `store:read` permission.

This is a `POST` endpoint (not `GET`) because the request carries a `config` object for scoping. An empty or null body is valid and applies defaults.

**Request body (optional):**

```json
{
  "limit": 50,
  "config": {}
}
```

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `limit` | integer | no | `100` | Maximum memories to return; must be between 1 and 1000 |

**Response (200 OK):**

```json
{
  "data": {
    "memories": [
      {
        "id": "mem_abc123",
        "content": "User prefers concise responses.",
        "score": 0.0,
        "memory_type": "episodic",
        "metadata": {"category": "preference"},
        "user_id": "user-123",
        "thread_id": null,
        "timestamp": "2026-10-08T10:30:00Z"
      }
    ]
  },
  "metadata": {
    "request_id": "req_xyz",
    "timestamp": "2026-10-08T10:30:00Z",
    "message": "OK"
  }
}
```

**Error codes:**

- `401` Unauthorized: missing or invalid auth token
- `403` Forbidden: insufficient permission (not `store:read`)
- `422` Unprocessable Entity: `limit` is outside the 1 to 1000 range

**Example:**

```bash
curl -X POST http://localhost:8000/v1/store/memories/list \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "limit": 50,
    "config": {}
  }'
```

---

## POST /v1/store/memories/{memory_id}

Retrieve a single memory by ID. Requires `store:read` permission.

The request body is optional and carries only `config` and `options`. A `memory_id` that is empty or whitespace-only returns `422`.

<aside class="callout callout-note" role="note"><p class="callout-title">Route precedence</p>

The static routes `/list` and `/forget` are registered before this catch-all, so `POST /v1/store/memories/list` and `POST /v1/store/memories/forget` match their own handlers, not this one with `memory_id="list"` or `memory_id="forget"`.

</aside>

**Request body (optional):**

```json
{
  "config": {}
}
```

**Response (200 OK):**

```json
{
  "data": {
    "memory": {
      "id": "mem_abc123",
      "content": "User prefers concise responses.",
      "score": 0.0,
      "memory_type": "episodic",
      "metadata": {"category": "preference"},
      "user_id": "user-123",
      "thread_id": null,
      "timestamp": "2026-10-08T10:30:00Z"
    }
  },
  "metadata": {
    "request_id": "req_xyz",
    "timestamp": "2026-10-08T10:30:00Z",
    "message": "OK"
  }
}
```

**Error codes:**

- `401` Unauthorized: missing or invalid auth token
- `403` Forbidden: insufficient permission (not `store:read`)
- `422` Unprocessable Entity: `memory_id` is empty or whitespace-only

**Example:**

```bash
curl -X POST http://localhost:8000/v1/store/memories/mem_abc123 \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "config": {}
  }'
```

---

## PUT /v1/store/memories/{memory_id}

Update the content or metadata of a stored memory. Requires `store:write` permission.

**Request body:**

```json
{
  "content": "Updated memory content.",
  "metadata": {"updated": true},
  "config": {}
}
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `content` | string or `Message` | yes | Replacement memory content or structured message |
| `metadata` | object | no | Replacement metadata (merged or replaced per backend) |

**Response (200 OK):**

```json
{
  "data": {
    "success": true,
    "data": null
  },
  "metadata": {
    "request_id": "req_xyz",
    "timestamp": "2026-10-08T10:30:00Z",
    "message": "Memory updated successfully"
  }
}
```

**Error codes:**

- `401` Unauthorized: missing or invalid auth token
- `403` Forbidden: insufficient permission (not `store:write`)
- `422` Unprocessable Entity: `memory_id` is empty or whitespace-only

**Example:**

```bash
curl -X PUT http://localhost:8000/v1/store/memories/mem_abc123 \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Updated memory content.",
    "metadata": {"updated_at": "2026-10-08"}
  }'
```

---

## DELETE /v1/store/memories/{memory_id}

Delete a single memory record by ID. Requires `store:delete` permission.

The request body is optional and carries only `config` and `options`. A `memory_id` that is empty or whitespace-only returns `422`.

**Response (200 OK):**

```json
{
  "data": {
    "success": true,
    "data": null
  },
  "metadata": {
    "request_id": "req_xyz",
    "timestamp": "2026-10-08T10:30:00Z",
    "message": "Memory deleted successfully"
  }
}
```

**Error codes:**

- `401` Unauthorized: missing or invalid auth token
- `403` Forbidden: insufficient permission (not `store:delete`)
- `422` Unprocessable Entity: `memory_id` is empty or whitespace-only

**Example:**

```bash
curl -X DELETE http://localhost:8000/v1/store/memories/mem_abc123 \
  -H "Authorization: Bearer <token>"
```

---

## POST /v1/store/memories/forget

Delete all memories matching the given filters. Requires `store:delete` permission.

Use this to bulk-delete memories by type, category, or custom filters without listing them first.

**Request body:**

```json
{
  "memory_type": "episodic",
  "category": "preference",
  "filters": {"source": "chat"},
  "config": {}
}
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `memory_type` | string | no | Restrict deletion to this memory type (same values as when storing) |
| `category` | string | no | Restrict deletion to this category |
| `filters` | object | no | Additional backend-specific filters |

**Response (200 OK):**

```json
{
  "data": {
    "success": true,
    "data": null
  },
  "metadata": {
    "request_id": "req_xyz",
    "timestamp": "2026-10-08T10:30:00Z",
    "message": "Memories removed successfully"
  }
}
```

**Error codes:**

- `401` Unauthorized: missing or invalid auth token
- `403` Forbidden: insufficient permission (not `store:delete`)

**Example:**

```bash
curl -X POST http://localhost:8000/v1/store/memories/forget \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "category": "old_session",
    "config": {}
  }'
```

---

## Memory object fields

Search, list and get return memory objects with these fields. `score` is a relevance score for search and `0.0` for list and get; `vector` is also part of the model and is `null` unless the backend returns it.

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Memory identifier, used as `memory_id` in the other endpoints |
| `content` | string | Memory text |
| `score` | float | Similarity or relevance score |
| `memory_type` | string | Memory classification |
| `metadata` | object | Client metadata plus backend fields such as `category` |
| `user_id` | string or null | Owning user |
| `thread_id` | string or null | Thread the memory came from, if any |
| `timestamp` | string or null | Creation time |

Client `metadata` keys that the store owns (`content`, `user_id`, `thread_id`, `memory_type`, `category`, `timestamp`, `memory_id`) are dropped on store and update.

The `data` of update, delete and forget responses is `{"success": true, "data": <backend result>}`, where the inner `data` depends on the store backend and is often `null`.

## Permissions and authentication

All endpoints require the authenticated user to hold the appropriate permission:

| Operation | Required permission | HTTP status on failure |
| --- | --- | --- |
| Store, update | `store:write` | 403 Forbidden |
| Search, get, list | `store:read` | 403 Forbidden |
| Delete, forget | `store:delete` | 403 Forbidden |
| Any endpoint | (valid auth) | 401 Unauthorized |
| Any endpoint, no store configured | none | 503 Service Unavailable |

Auth tokens are passed via the `Authorization: Bearer <token>` header. See [Authentication and authorization](/docs/server/auth) for JWT setup and custom auth backends.

## Related pages

- [Use the memory store](/docs/guides/use-memory-store) for a task walkthrough.
- [Memory stores (Python)](/docs/reference/python/memory-stores) for the `BaseStore` API behind these routes.
- [Memory API (client)](/docs/reference/client/memory) for the TypeScript wrappers.
