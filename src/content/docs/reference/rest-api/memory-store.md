---
title: Memory store endpoints
description: "Reference for /v1/store endpoints: storing, searching, listing, updating, deleting, and forgetting memories through the 10xGraph API server."
section: Reference
group: "REST API"
order: 350
label: Memory store
updated: "2026-11-25"
---

The `/v1/store` endpoints let you store, search, list, read, update, delete and bulk-forget long-term memories through the 10xGraph API server. They work only when a `store` is configured in `10xgraph.json`; without one, every endpoint returns `503` with "Store is not configured".

Base path: `/v1/store`

## Request fields shared by every endpoint

The `memory_id` path parameter must match `^[A-Za-z0-9._:@-]{1,128}$` (letters, digits and `. _ : @ -`). Any other value gets `422` with code `VALIDATION_ERROR`.

Every request body accepts two optional fields besides the endpoint-specific ones, and the server decides whose memories a request touches from the authenticated user, not from the body.

| Field | Type | Description |
| --- | --- | --- |
| `config` | object | Values forwarded to the store backend. Defaults to `{}`. Server-owned keys are dropped (see [Conventions](/docs/reference/rest-api/conventions)). |
| `options` | object | Keyword arguments forwarded to the store backend. Only `infer` and `replace_metadata` are accepted; every other key is dropped, including `memory_id`. |

The server sets `user_id` from the authenticated user (or `anonymous` when auth is off). Sending `user_id` in `config` has no effect. The same goes for `collection`: a client cannot choose the collection, and the routes always use the collection default of the store (a name, or a function the developer set, called with the authenticated `user`). See [Collections](/docs/concepts/memory-and-store#collections-keeping-data-apart). An authenticated `user_id` starting with `__system__` is refused (`401`).

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
| `content` | string or `Message` | yes | | Memory text (at most 100,000 characters), or a structured `Message` object |
| `memory_type` | string | no | `episodic` | One of `episodic`, `semantic`, `procedural`, `entity`, `relationship`, `custom`, `declarative` |
| `category` | string | no | `general` | Category label for organizing memories |
| `metadata` | object | no | `null` | Arbitrary metadata stored alongside the memory |
| `expires_at` | string | no | `null` | Expiry as an ISO 8601 timestamp with a time zone. Omit for no expiry. |

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
| `query` | string | yes | | Search query for semantic similarity; empty or whitespace-only returns `422`; longer than 8,000 characters returns `422` |
| `memory_type` | string | no | `null` | Filter results by memory type (same values as when storing) |
| `category` | string | no | `null` | Filter results by category |
| `limit` | integer | no | `10` | Maximum results to return; must be between 1 and 100 |
| `score_threshold` | float | no | `null` | Minimum similarity score for a result to be included |
| `origins` | array | no | `null` | Only memories written by these origins: `user`, `agent`, `tool`, `system`. `null` inside the array also matches memories of unknown origin |
| `filters` | object | no | `null` | Additional store-specific filters. With `PgVectorStore`, column conditions as in [Filters](/docs/guides/multi-tenant-data#filters); a bad filter answers 422 |
| `retrieval_strategy` | string | no | `null` (the store's own setting) | One of `similarity`, `temporal`, `relevance`, `hybrid`, `text`, `graph_traversal`; support depends on the backend |
| `distance_metric` | string | no | `null` (the store's own setting) | One of `cosine`, `euclidean`, `dot_product`, `manhattan` |
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
        "timestamp": "2026-10-08T10:30:00Z",
        "origin": "user",
        "expires_at": null
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

The body is optional.

**Request body (optional):**

```json
{
  "limit": 50,
  "offset": 0,
  "config": {}
}
```

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `limit` | integer | no | `100` | Maximum memories to return; must be between 1 and 1000 |
| `offset` | integer | no | `0` | Memories to skip, for paging. Send `next_offset` from the previous response. |
| `origins` | array | no | `null` | Only memories written by these origins: `user`, `agent`, `tool`, `system`. `null` inside the array also matches memories of unknown origin |
| `filters` | object | no | `null` | Narrows the list. With `PgVectorStore`, column conditions as in [Filters](/docs/guides/multi-tenant-data#filters); a bad filter answers 422. The list stays scoped to the caller, so filters can only reduce it |

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
        "timestamp": "2026-10-08T10:30:00Z",
        "origin": "user",
        "expires_at": null
      }
    ],
    "has_more": false,
    "next_offset": null
  },
  "metadata": {
    "request_id": "req_xyz",
    "timestamp": "2026-10-08T10:30:00Z",
    "message": "OK"
  }
}
```

`has_more` is `true` when more memories follow this page. Then `next_offset` holds the `offset` to send next; on the last page it is `null`.

**Error codes:**

- `422` Unprocessable Entity: `limit` is outside the 1 to 1000 range, or `offset` is negative or above 100000, or a filter is not allowed

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
      "timestamp": "2026-10-08T10:30:00Z",
      "origin": "user",
      "expires_at": null
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

- `404` Memory not found, or outside the caller's reach
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
| `content` | string or `Message` | yes | Replacement memory content (string at most 100,000 characters) or structured message |
| `metadata` | object | no | Replacement metadata (merged or replaced per backend) |
| `expires_at` | string | no | New expiry, ISO 8601 with a time zone. Omit to leave it unchanged |

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

- `404` Memory not found, or outside the caller's reach
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

- `404` Memory not found, or outside the caller's reach
- `422` Unprocessable Entity: `memory_id` is empty or whitespace-only

**Example:**

```bash
curl -X DELETE http://localhost:8000/v1/store/memories/mem_abc123 \
  -H "Authorization: Bearer <token>"
```

---

## POST /v1/store/memories/forget

Delete the caller's memories matching all the given filters; with none, every memory of the caller. Requires `store:delete` permission.

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
| `filters` | object | no | Additional filters. With `PgVectorStore`, keys `user_id` and tenant columns are refused (422). See [Filters](/docs/guides/multi-tenant-data#filters) |

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

Search, list and get return memory objects with these fields. `score` is a relevance score for search and `0.0` for list and get.

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
| `origin` | string or null | Who wrote it: `user`, `agent`, `tool` or `system`. `null` is unknown. Memories written through this API are always `user` |
| `expires_at` | string or null | Expiry time, or `null` when the memory never expires |

Client `metadata` keys the store owns (such as `user_id`, `memory_id`, `origin`, `expires_at`) are dropped on store and update.

Expired memories are hidden from search, list and get. See [Memory origin and expiry](/docs/concepts/memory-and-store#memory-origin-and-expiry).

## Permissions

| Operation | Required permission |
| --- | --- |
| Store, update | `store:write` |
| Search, get, list | `store:read` |
| Delete, forget | `store:delete` |

Any endpoint answers `503` when no store is configured. See [Authentication and authorization](/docs/server/auth).

## Related pages

- [Use the memory store](/docs/guides/use-memory-store) for a task walkthrough.
- [Memory stores (Python)](/docs/reference/python/memory-stores) for the `BaseStore` API behind these routes.
- [Memory API (client)](/docs/reference/client/memory) for the TypeScript wrappers.
