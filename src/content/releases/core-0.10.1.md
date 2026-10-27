---
package: core
version: "0.10.1"
date: 2026-10-16
summary: Fixes the checkpointers' state cache. A state written between runs is now what the next run starts from, and clearing a thread also clears its cached state.
breaking: false
---

Bug fixes for the checkpointers' state cache. No API changes.

### Fixed

- **`aput_state` now refreshes the state cache (write-through) on every checkpointer.** A run loads its state from the cache first (`aget_state_cache`), but `aput_state` wrote only the durable store, so a state written between runs was not what the next run started from. `InMemoryCheckpointer` and `SqliteCheckpointer` silently lost the update, because the next run wrote the old state back over it. `PgCheckpointer` also left the old checkpoint version in Redis, so the next run's first write raised `StaleStateError` (`STORAGE_CONFLICT_001`) and the run failed. `PgCheckpointer` now refreshes Redis after the durable write succeeds, at the new version, version-guarded and best-effort like every cache write, so a Redis outage never fails the write. `SqliteCheckpointer` updates its cache row in the same transaction.
- **Clearing a thread's state now also drops its cached state.** `aclear_state` on `InMemoryCheckpointer` and `SqliteCheckpointer` deleted only the durable state, so the next run read the cleared state back from the cache and resumed from it. Both now delete the cache entry too (SQLite in the same transaction), as `PgCheckpointer` already did.
- **`InMemoryCheckpointer.aclean_thread` now removes the whole thread.** It deleted only the thread record; it now also deletes the thread's state, cached state and messages, like the SQLite and Postgres checkpointers.
