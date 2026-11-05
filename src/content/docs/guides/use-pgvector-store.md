---
title: How to use PgVectorStore
seoTitle: "PgVectorStore: memory and RAG in Postgres"
description: "Keep long-term memory and RAG in the same Postgres as your checkpointer with PgVectorStore: install, search strategies, settings, embedding fallback and table layout."
section: "Build agents"
group: "State, memory and context"
order: 252
label: PgVectorStore
updated: "2026-11-05"
---

`PgVectorStore` keeps long-term memory in one Postgres table, next to the tables `PgCheckpointer` already uses. It searches by vector similarity (pgvector), by full-text rank, or by both fused with Reciprocal Rank Fusion. You run one database for checkpoints and memory, and you can add your own columns to the table.

For what a memory store is and how agents use it, read [Long-term memory](/docs/concepts/memory-and-store) first. To isolate tenants or add your own columns, continue with [Multi-tenant data](/docs/guides/multi-tenant-data).

## Requirements

| Requirement | Version |
|---|---|
| PostgreSQL | 14 or newer |
| pgvector extension | 0.7.0 or newer (needed for HNSW indexes on L1 distance; a text-only store does not need it) |
| Extra | `pgvector` (installs `asyncpg` and `pgvector`) |

```bash
pip install "10xgraph[pgvector,openai]"
```

`asetup()` runs `CREATE EXTENSION IF NOT EXISTS vector`. On some managed Postgres services the role you connect with cannot create extensions. Ask an admin to run `CREATE EXTENSION vector;` once, or use a text-only store. If the extension is missing or older than 0.7.0, setup raises a `RuntimeError` that says so.

## Create the store

```python title="memory.py"
from tenxgraph.storage.store import OpenAIEmbedding, PgVectorStore

store = PgVectorStore(
    embedding=OpenAIEmbedding(),  # reads OPENAI_API_KEY
    dsn="postgresql://user:pass@localhost:5432/app",
)
await store.asetup()  # extension, table and indexes; safe to run from many workers
```

Pass the store to `compile(store=store)` or to `MemoryConfig(store=store)` exactly as you would a `QdrantStore`. Setup also runs on first use, so calling `asetup()` at startup is optional but makes a bad configuration fail early. For a runnable agent, see `examples/long_term_memory/pgvector_memory.py`.

Owner rules match `QdrantStore`: every call needs a non-empty `user_id` in `config`, and shared data uses `system_user_id(name)`. See the [user_id rule](/docs/reference/python/memory-stores#the-user_id-rule-and-system_user_id).

## Constructor options

| Option | Default | Meaning |
|---|---|---|
| `embedding` | required | A `BaseEmbedding`, or `None` for a text-only store. |
| `dsn` | `None` | Connection string. The store creates a pool and closes it in `arelease()`. |
| `pool` | `None` | An existing asyncpg pool. The store never closes it. Pass `dsn` or `pool`, not both. |
| `pool_config` | `None` | Extra `asyncpg.create_pool` arguments for a pool built from `dsn`. |
| `schema` | `"public"` | Postgres schema of the table. |
| `table` | `"tenxgraph_memories"` | Table name: letters, digits, underscore, at most 48 characters. |
| `collection` | `None` | Default collection: a name, or a function `(config) -> name`. |
| `distance_metric` | `COSINE` | Metric of the HNSW index and the default for searches. |
| `retrieval_strategy` | `None` | Default search strategy. `None` means `SIMILARITY`, or `TEXT` for a text-only store. |
| `hybrid_weights` | `(1.0, 1.0)` | `(vector_weight, text_weight)` for `HYBRID` fusion. |
| `rrf_k` | `60` | The RRF constant `k`. |
| `hybrid_candidates` | `None` | Rows each list contributes to fusion. `None` means `max(4 * limit, 20)`. |
| `text_search_config` | `"english"` | Postgres text search configuration. Fixed when the table is created. |
| `on_embedding_error` | `"fallback"` | `"fallback"` or `"raise"`. See [Embedding fallback](#embedding-fallback-and-backfill). |
| `acquire_timeout` | `30.0` | Seconds to wait for a free pooled connection (`None` waits). |
| `tenant_columns` | `None` | Columns that isolate data. See [Multi-tenant data](/docs/guides/multi-tenant-data). |
| `extra_columns` | `None` | Your own data columns, same page. |
| `row_level_security` | `False` | Also enforce tenant columns with native Postgres row-level security. |

Collections work as described in [Collections: keeping data apart](/docs/concepts/memory-and-store#collections-keeping-data-apart). One table holds every collection.

## Text-only store

Pass `embedding=None` when you want keyword search only. The table has no `embedding` column, `asetup()` does not touch the pgvector extension, and the default strategy is `TEXT`. Nothing calls an embedding provider, so no API key is needed.

```python
from tenxgraph.storage.store import PgVectorStore
from tenxgraph.storage.store.store_schema import RetrievalStrategy

store = PgVectorStore(
    embedding=None,
    dsn="postgresql://user:pass@localhost:5432/app",
    retrieval_strategy=RetrievalStrategy.TEXT,
)
```

A table created by a text-only store cannot be reused by an embedding store: setup raises and tells you to use another table.

## Search strategies

| Strategy | How it ranks | Needs embedding |
|---|---|---|
| `SIMILARITY` | Vector distance to the embedded query, using the HNSW index. | Yes |
| `TEXT` | `ts_rank` on the generated `tsv` column. The query uses `websearch_to_tsquery` syntax (quoted phrases, `or`, `-word`). | No |
| `HYBRID` | Runs both searches and fuses the two ranked lists with Reciprocal Rank Fusion. | Yes |

In `HYBRID`, a row at rank `r` in a list scores `weight / (rrf_k + r)`, and the two scores are added. Raise one entry of `hybrid_weights` to favour vector or keyword results. Hybrid helps when users search for names, codes or exact phrases that embeddings blur.

Scores are similarities, so `score_threshold` means what it means on `QdrantStore`: cosine similarity for `COSINE`, the inner product for `DOT_PRODUCT`, and `1 / (1 + distance)` for `EUCLIDEAN` and `MANHATTAN`. `TEXT` scores are `ts_rank` normalized to below 1. `HYBRID` scores are scaled so a row ranked first in both lists scores 1.0, and `score_threshold` applies to each row's vector similarity.

## Settings at three levels

`retrieval_strategy` can be set in three places, and `distance_metric` in two (the store and the call; `MemoryConfig` has no metric). The most specific one wins, and anything left unset falls back to the level before it, then to the built-in default.

| Level | Where | Applies to |
|---|---|---|
| Store | `PgVectorStore(retrieval_strategy=..., distance_metric=...)` | Every search on the store |
| Memory config | `retrieval_strategy` only: `MemoryConfig(retrieval_strategy=...)`, then `UserMemoryConfig(...)` or `AgentMemoryConfig(...)`, which override the `MemoryConfig` value for their scope | Preload, the memory tools and `RAGAgent` |
| Call | `store.asearch(config, query, retrieval_strategy=..., distance_metric=...)` | One search |

```python
from tenxgraph.storage.store import MemoryConfig, UserMemoryConfig
from tenxgraph.storage.store.store_schema import RetrievalStrategy

memory = MemoryConfig(
    store=store,                                    # store default: SIMILARITY
    retrieval_strategy=RetrievalStrategy.HYBRID,    # all scopes use HYBRID ...
    agent_memory=None,
    user_memory=UserMemoryConfig(
        retrieval_strategy=RetrievalStrategy.TEXT,  # ... except user memory
    ),
)

results = await store.asearch(
    config, "invoice 4471", retrieval_strategy=RetrievalStrategy.TEXT
)  # this call wins
```

`DistanceMetric` is exported from `tenxgraph.storage.store`. A call may ask for a metric other than the one the index was built with. The query still runs, computed exactly without the index, and the store logs a warning. `QdrantStore` accepts the same two arguments but raises for `TEXT` and `HYBRID`.

## Embedding fallback and backfill

An embedding provider can fail or be rate limited. With `on_embedding_error="fallback"` (the default):

- **Writes** save the text with an empty embedding and log a warning. The memory is searchable by `TEXT` at once.
- **Searches** that cannot embed the query run as `TEXT` and log a warning.

A vector of the wrong size always raises, because that is a configuration error and not an outage. Set `on_embedding_error="raise"` if you would rather see every failure.

Fill the missing embeddings later with `abackfill_embeddings`:

```python
filled = await store.abackfill_embeddings(batch_size=100)
print(f"embedded {filled} memories")
```

It walks the table once in primary-key order, embeds each batch outside any transaction, and skips rows whose content changed meanwhile. It is safe to run while the store is in use and to run again. It raises on embedding errors (no fallback) and on a text-only store. On a store with row-level security it covers every tenant, so run it from a maintenance job, not from a request.

## Table layout

One table (default `tenxgraph_memories`) holds all collections.

| Column | Type | Index |
|---|---|---|
| `id` | `text` | Primary key `(collection, id)` |
| `collection` | `text` | Part of the primary key |
| `user_id` | `text` | `(collection, user_id)` |
| `thread_id` | `text`, null | None |
| `memory_key` | `text`, null | Unique `(collection, user_id, memory_type, memory_key)` where not null; tenant columns join this index |
| `memory_type`, `category` | `text` | None |
| `content` | `text` | None |
| `tsv` | `tsvector`, generated from `content` | GIN |
| `embedding` | `vector(dim)`, null (absent when `embedding=None`) | HNSW, operator class from the store's distance metric |
| `metadata` | `jsonb` | None |
| `created_at`, `updated_at` | `timestamptz` | None |
| your tenant columns | declared type | B-tree each |
| your extra columns | declared type | B-tree each |

Details that matter in production:

- The vector dimension comes from your embedding service. A table whose `embedding` column has another dimension makes setup raise. HNSW cannot index more than 2000 dimensions; above that the store logs a warning and searches without an index.
- With a `memory_key`, `astore` is one atomic upsert, so two writers cannot create duplicate memories for the same key. On PostgreSQL 15 and newer, optional tenant columns hold `NULL` and still dedupe (`NULLS NOT DISTINCT`); on 14 they do not.
- `metadata` is for free-form extras you never filter on. Anything you filter or index should be a real column: declare it as an extra column.
- A write whose `memory_id` belongs to another user raises `PermissionError`, in the same statement as the write.
- A cancelled call leaves no partial row, and a lost connection is retried the way `PgCheckpointer` retries.
- `aping()` runs `SELECT 1`. `arelease()` closes the pool only when the store created it from `dsn`.

## Next steps

- **To isolate tenants or add columns:** [Multi-tenant data](/docs/guides/multi-tenant-data).
- **To wire the store into an agent:** [How to use the memory store](/docs/guides/use-memory-store).
- **To run a full example:** `examples/long_term_memory/pgvector_memory.py` and `examples/long_term_memory/multi_tenant_memory.py` in the repository.
- **For method signatures:** [Memory stores reference](/docs/reference/python/memory-stores).
