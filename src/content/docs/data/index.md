---
title: Data and state
description: "Where your agent state lives: threads, memory and shared server state, on Postgres and Redis by default."
section: "Data and state"
order: 0
updated: "2026-11-10"
---

This section covers where 10xGraph keeps agent state: checkpoints for threads, long-term memory, shared server state and the databases behind them. Use Postgres and Redis by default, SQLite for local work, and any database through BaseCheckpointer, BaseStore and BaseCacheStore.

Reference: [BaseCheckpointer](/docs/reference/python/checkpointers) · Source: [base_checkpointer.py](https://github.com/10xGraph/10xGraph/blob/main/tenxgraph/storage/checkpointer/base_checkpointer.py)

Reference: [BaseStore](/docs/reference/python/memory-stores) · Source: [base_store.py](https://github.com/10xGraph/10xGraph/blob/main/tenxgraph/storage/store/base_store.py)

Reference: [BaseCacheStore](/docs/reference/api-cli/cache-store) · Source: [base.py](https://github.com/10xGraph/10xgraph-api/blob/main/tenxgraph_api/src/app/core/cache_store/base.py)

- [Set up checkpointing](/docs/guides/set-up-checkpointing): Choose and configure a checkpointer for state persistence, from development to production.
- [Durability and concurrency](/docs/guides/durability-and-concurrency): Thread isolation, state history, optimistic concurrency, and idempotent tool calls.
- [Memory store](/docs/guides/use-memory-store): Use PgVectorStore and QdrantStore for long-term memory and enable agent-level memory with MemoryConfig.
- [PgVectorStore](/docs/guides/use-pgvector-store): Keep long-term memory and RAG in the same Postgres as your checkpointer.
- [Cache store](/docs/concepts/cache-store): What the API server keeps in its cache store, which backend to use, and how each feature behaves when the store fails.
- [Postgres and Redis](/docs/integrations/postgres-and-redis): Set up PgCheckpointer for durable, resumable agent threads, with schema, pooling and operations.
- [Bring your own database](/docs/server/bring-your-own-backend): The storage classes behind a 10xGraph server and how to plug in a custom one.
- [Backup and restore](/docs/server/backup-and-restore): What 10xGraph persists and how to back up, restore or roll back a running deployment safely.
