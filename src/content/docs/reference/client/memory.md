---
title: Memory
seoTitle: Memory store methods in the TypeScript client
description: "Reference for memory store methods in the 10xGraph TypeScript client: store, search, retrieve, update and delete memories, with type filtering and vector similarity."
section: Reference
group: TypeScript client
order: 530
label: Memory
updated: "2026-11-26"
---

The memory methods on `TenxGraphClient` store, search, read, update, delete and bulk-forget long-term memories on the server's configured store. Each memory has a type, a category and optional metadata, and you retrieve memories by similarity or, where the store supports it, a hybrid strategy. For a task-oriented walkthrough, see [Use the memory API](/docs/client/use-memory-api).

<aside class="callout callout-note" role="note"><p class="callout-title">Requires store</p>

The memory endpoints require the `store` field to be configured in `10xgraph.json`. Without a store, the server answers memory requests with status `503` ("Store is not configured").

</aside>

All endpoints live under the base path `/v1/store`. Every method also accepts `config` and `options` objects. The server forwards only `infer` and `replace_metadata` from `options` and drops the rest, and it drops server-owned `config` keys such as `user`, `user_id`, `credential` and `collection` (`RESERVED_CONFIG_KEYS`).

---

## Imported enums

```ts
import {
  MemoryType,
  RetrievalStrategy,
  DistanceMetric,
} from '10xgraph-client';
```

### `MemoryType`

| Value | Enum key | Use case |
|---|---|---|
| `'episodic'` | `EPISODIC` | Conversation memories and session events. |
| `'semantic'` | `SEMANTIC` | Facts, knowledge, and world-model information. |
| `'procedural'` | `PROCEDURAL` | How-to knowledge, workflows, and procedures. |
| `'entity'` | `ENTITY` | Information about specific entities (people, places, products). |
| `'relationship'` | `RELATIONSHIP` | Relationships between entities. |
| `'declarative'` | `DECLARATIVE` | Explicit facts and events recorded verbatim. |
| `'custom'` | `CUSTOM` | Custom memory types specific to your application. |

### `RetrievalStrategy`

| Value | Description |
|---|---|
| `'similarity'` | Vector similarity search. Default for most use cases. |
| `'hybrid'` | Similarity plus keyword search. `PgVectorStore` only. |
| `'temporal'`, `'relevance'`, `'graph_traversal'` | In the enum, but no shipped store supports them: `PgVectorStore` refuses them and `QdrantStore` accepts only `'similarity'`. |

`PgVectorStore` also supports a keyword-only `text` strategy, which the client enum does not list yet.

### `DistanceMetric`

| Value | Description |
|---|---|
| `'cosine'` | Cosine similarity. Default. Best for semantic similarity in high-dimensional spaces. |
| `'euclidean'` | Euclidean distance. |
| `'dot_product'` | Dot product similarity. |
| `'manhattan'` | Manhattan (L1) distance. |

---

## `storeMemory(request)`

Store a new memory entry.

**Endpoint:** `POST /v1/store/memories`

```ts
const response = await client.storeMemory({
  content: 'User prefers dark mode and monospace fonts.',
  memory_type: MemoryType.SEMANTIC,
  category: 'preferences',
  metadata: { source: 'user_settings', importance: 'high' },
});

console.log('Stored memory ID:', response.data.memory_id);
```

### `StoreMemoryRequest`

| Field | Type | Required | Description |
|---|---|---|---|
| `content` | `string` | Yes | The text content to store as a memory. |
| `memory_type` | `MemoryType` | Yes | The type of memory. Controls how the store indexes and retrieves it. |
| `category` | `string` | Yes | Arbitrary category string for grouping related memories. |
| `metadata` | `Record<string, any>` | No | Optional key-value metadata stored alongside the memory. |
| `config` | `Record<string, any>` | No | Optional store-level config (backend-specific). |
| `options` | `Record<string, any>` | No | Optional store-level options (backend-specific). The server forwards only `infer` and `replace_metadata`. |

### `StoreMemoryResponse`

```ts
interface StoreMemoryResponse {
  data: {
    memory_id: string;
  };
  metadata: ResponseMetadata;
}
```

Save the `memory_id` to update or delete the memory later.

---

## `searchMemory(request)`

Search for memories by vector similarity, or a hybrid strategy where the store supports it.

**Endpoint:** `POST /v1/store/search`

```ts
const response = await client.searchMemory({
  query: 'What are the user\'s display preferences?',
  memory_type: MemoryType.SEMANTIC,
  category: 'preferences',
  limit: 5,
  retrieval_strategy: RetrievalStrategy.SIMILARITY,
  distance_metric: DistanceMetric.COSINE,
  score_threshold: 0.7,
});

for (const result of response.data.results) {
  console.log(`Score: ${result.score.toFixed(3)}, ${result.content}`);
}
```

### `SearchMemoryRequest`

| Field | Type | Default | Description |
|---|---|---|---|
| `query` | `string` | - | The search query, at most 8,000 characters. Converted to a vector embedding by the store backend. |
| `memory_type` | `MemoryType` | none | Filter by memory type. Omitted from the request when unset, so no type filter applies. |
| `category` | `string` | none | Filter by category. Omitted from the request when unset, so no category filter applies. |
| `limit` | `number` | `10` | Maximum number of results to return. |
| `score_threshold` | `number` | none | Minimum similarity score. Results below this threshold are excluded. Omitted when unset. |
| `filters` | `Filters` | `{}` | Filter by column: `{ col: value }` or `{ col: { op: value } }`. See [Filters](#filters). |
| `retrieval_strategy` | `RetrievalStrategy` | `SIMILARITY` | Which retrieval algorithm to use. |
| `distance_metric` | `DistanceMetric` | `COSINE` | Which distance metric to use for vector search. |
| `max_tokens` | `number` | `4000` | Maximum total tokens to return across all results. At most 16000; more answers 422. |
| `config` | `Record<string, any>` | `{}` | Store-level config. |
| `options` | `Record<string, any>` | `{}` | Store-level options. The server forwards only `infer` and `replace_metadata`. |

### `SearchMemoryResponse`

```ts
interface SearchMemoryResponse {
  data: {
    results: MemoryResult[];
  };
  metadata: ResponseMetadata;
}

interface MemoryResult {
  id: string;
  content: string;
  score: number;              // Similarity score (0 to 1, higher is more similar)
  memory_type: string;
  metadata: Record<string, any>;
  vector: number[];           // The embedding vector (may be empty in some backends)
  user_id: string;
  thread_id: string;
  timestamp: string;          // ISO 8601 timestamp
}
```

---

## `getMemory(memoryId, options?)`

Fetch a single memory by its ID. It returns the memory as a `MemoryResult` (the same shape search returns).

**Endpoint:** `POST /v1/store/memories/{memoryId}`

```ts
const response = await client.getMemory('mem-abc123');
console.log(response.data.memory.content);
console.log(response.data.memory.score);
```

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `memoryId` | `string` | The memory ID returned by `storeMemory()`. |
| `options.config` | `Record<string, any>` | Optional store-level config. |
| `options.options` | `Record<string, any>` | Optional store-level options. The server forwards only `infer` and `replace_metadata`. |

---

## `updateMemory(memoryId, content, options?)`

Replace the content of an existing memory. You can pass new metadata through `options.metadata`; the memory's type and category cannot be changed with this method.

**Endpoint:** `PUT /v1/store/memories/{memoryId}`

```ts
await client.updateMemory(
  'mem-abc123',
  'User prefers dark mode, monospace fonts, and large text size.',
  {
    metadata: { tags: ['display', 'accessibility'], revised: true },
  }
);
```

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `memoryId` | `string` | The memory ID. |
| `content` | `string` | The new text content. Replaces the previous content. |
| `options.config` | `Record<string, any>` | Optional store-level config. |
| `options.options` | `Record<string, any>` | Optional store-level options. The server forwards only `infer` and `replace_metadata`. |
| `options.metadata` | `Record<string, any>` | Updated metadata. Sent as `{}` when omitted. Whether it merges with or replaces existing metadata depends on the store backend. |

### `UpdateMemoryResponse`

```ts
interface UpdateMemoryResponse {
  data: {
    success: boolean;
    data: Record<string, any>;
  };
  metadata: ResponseMetadata;
}
```

---

## `deleteMemory(memoryId, options?)`

Delete a memory by ID.

**Endpoint:** `DELETE /v1/store/memories/{memoryId}`

```ts
const response = await client.deleteMemory('mem-abc123');
console.log('Deleted:', response.data.success);
```

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `memoryId` | `string` | The memory ID. |
| `options.config` | `Record<string, any>` | Optional store-level config. |
| `options.options` | `Record<string, any>` | Optional store-level options. The server forwards only `infer` and `replace_metadata`. |

### `DeleteMemoryResponse`

```ts
interface DeleteMemoryResponse {
  data: {
    success: boolean;
    data: string;
  };
  metadata: ResponseMetadata;
}
```

---

## `listMemories(options?)`

List stored memories, up to a limit that defaults to 100. It returns `response.data.memories`, an array of `MemoryResult`, plus `has_more` and `next_offset` for paging.

**Endpoint:** `POST /v1/store/memories/list`

```ts
const response = await client.listMemories({ limit: 100 });

console.log(`Found ${response.data.memories.length} memories`);
for (const mem of response.data.memories) {
  console.log(`[${mem.memory_type}] ${mem.content.slice(0, 80)}`);
}

// Next page
if (response.data.has_more) {
  const next = await client.listMemories({ limit: 100, offset: response.data.next_offset ?? 0 });
}
```

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `options.limit` | `number` | Maximum number of memories to return. Default `100`, at most `1000`. |
| `options.offset` | `number` | Memories to skip, for paging. Pass `next_offset` from the previous page. Needs `10xgraph-api` with paging support. At most 100000. |
| `options.filters` | `Filters` | Filter by column. See [Filters](#filters). Omitted when empty. |
| `options.config` | `Record<string, any>` | Optional store-level config. |
| `options.options` | `Record<string, any>` | Optional store-level options. The server forwards only `infer` and `replace_metadata`. |

---

## `forgetMemories(options?)`

Bulk-delete memories matching a type, category or metadata filter. It is one request instead of a `deleteMemory()` call per memory. Only the fields you pass are sent. The server applies every field you pass; with none, all of your memories are deleted. With `PgVectorStore`, `filters` on a tenant column or `user_id` is rejected (422).

**Endpoint:** `POST /v1/store/memories/forget`

```ts
// Delete all episodic memories in the 'session_temp' category
await client.forgetMemories({
  memory_type: MemoryType.EPISODIC,
  category: 'session_temp',
});

// Delete memories matching custom filters
await client.forgetMemories({
  filters: { expired: true },
});
```

A failed `forgetMemories()` call throws a `TenxGraphError` subclass (for example `ValidationError` for 422).

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `options.memory_type` | `MemoryType` | Filter by memory type. |
| `options.category` | `string` | Filter by category. |
| `options.filters` | `Filters` | Filter by column. See [Filters](#filters). |
| `options.config` | `Record<string, any>` | Optional store-level config. |
| `options.options` | `Record<string, any>` | Optional store-level options. The server forwards only `infer` and `replace_metadata`. |

### `ForgetMemoriesResponse`

```ts
interface ForgetMemoriesResponse {
  data: {
    success: boolean;
    data: Record<string, any>;
  };
  metadata: ResponseMetadata;
}
```

---

## Filters

`searchMemory()`, `listMemories()` and `forgetMemories()` accept `filters`, and so does `threads()`. A filter is `{ column: value }` for equality, or `{ column: { op: value, ... } }`. Operators: `eq`, `ne`, `in`, `nin`, `like`, `ilike`, `is_null`, `gt`, `gte`, `lt`, `lte`. `in` and `nin` take arrays, `is_null` takes a boolean. Several operators on one column are combined.

```ts
import type { Filters } from '10xgraph-client';

const filters: Filters = {
  plan: { in: ['pro'] },
  created_at: { gte: '2026-11-01T00:00:00Z' },
};

const found = await client.searchMemory({ query: 'dark mode', filters });
const page = await client.listMemories({ limit: 50, filters });
await client.forgetMemories({ filters: { plan: { in: ['trial'] } } });
```

The client does not check column names or value types. The server validates them and answers 422 with a safe message for an unknown column, a wrong type or a tenant column. The exported types are `Filters`, `FilterCondition`, `FilterOperator` and `FilterScalar`.

---

## Complete example: memory-enhanced agent

This example searches memory before each call, passes the hits to the agent as a system message, then stores the question as an episodic memory. It assumes a running server with a configured store.

```ts title="memory-agent.ts"
import {
  TenxGraphClient,
  Message,
  MemoryType,
  RetrievalStrategy,
} from '10xgraph-client';

const client = new TenxGraphClient({ baseUrl: 'http://localhost:8000' });

// Before invoking the agent, retrieve relevant past memories
async function invokeWithMemory(userInput: string) {
  // 1. Search for relevant context
  const memories = await client.searchMemory({
    query: userInput,
    memory_type: MemoryType.SEMANTIC,
    limit: 3,
    score_threshold: 0.6,
    retrieval_strategy: RetrievalStrategy.SIMILARITY,
  });

  // 2. Build a system prompt with context
  const context = memories.data.results
    .map(r => `- ${r.content}`)
    .join('\n');

  const systemMsg = Message.text_message(
    `You are a helpful assistant. Relevant context from memory:\n${context}`,
    'system'
  );

  // 3. Invoke the agent
  const result = await client.invoke([
    systemMsg,
    Message.text_message(userInput),
  ]);

  // 4. Store the interaction as an episodic memory
  await client.storeMemory({
    content: `User asked: "${userInput}"`,
    memory_type: MemoryType.EPISODIC,
    category: 'conversations',
  });

  return result;
}

const result = await invokeWithMemory('What theme should the dashboard use?');
console.log(result.messages);
```

---

## Common errors

Failed requests throw `TenxGraphError` (or a subclass such as `ValidationError`) with a `statusCode`. See [Client errors](/docs/reference/client/errors) for the full error class.

| Error | Cause | Fix |
|---|---|---|
| status `404` | Memory not found (wrong ID or already deleted). | Check the ID returned by `storeMemory()`. |
| status `422` | `searchMemory()` was called with an empty `query`, a `query` over 8,000 characters, `limit` outside 1 to 100, or `storeMemory()` or `updateMemory()` was given string `content` over 100,000 characters. | Pass a non-empty query within the limits, and shorten or split long content. |
| status `503` | Store not configured or unavailable. | Check the `store` field in `10xgraph.json` and the store backend status. |

---

## What you learned

- Use `MemoryType` to categorize memories and filter on it when searching.
- `searchMemory()` with `RetrievalStrategy.SIMILARITY` performs vector search, so the store must support embeddings.
- `listMemories()` returns up to `limit` memories (default 100). Pass `offset` and follow `has_more` and `next_offset` to read further pages.
- `forgetMemories()` bulk-deletes by type, category or filter.

## Next step

See [Files](/docs/reference/client/files) to learn how to upload and reference media files in multimodal messages.
