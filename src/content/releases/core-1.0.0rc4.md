---
package: core
version: "1.0.0rc4"
date: 2026-10-31
summary: The fourth 1.0 release candidate. Every checkpointer now implements aping(), a read-only connectivity check the API server uses for startup and readiness. Breaking for custom checkpointers.
breaking: true
---

The fourth 1.0 release candidate. It is the `1.0.0rc3` code plus a required connectivity check on checkpointers. Pip skips it unless you pass `--pre`:

```bash
pip install -U --pre "10xgraph==1.0.0rc4"
```

`10xgraph-api` 1.0.0rc4 ships alongside and requires it. `10xgraph-client` stays at 1.0.0-rc.2. Read **Breaking** and the [upgrade guide](/docs/project/upgrade-to-1.0#from-100rc3-to-100rc4) before upgrading.

### Breaking

- **`BaseCheckpointer.aping()` is now abstract.** A custom checkpointer must implement `async def aping(self) -> None`: return when its backends are reachable and usable, and raise when they are not. An in-process checkpointer just returns. Keep it read-only and cheap, because the API server calls it on every readiness probe and at startup. **Migration:** add the method to every custom `BaseCheckpointer` subclass. Without it the class raises `TypeError` when created.

### Added

- `InMemoryCheckpointer.aping()`, `SqliteCheckpointer.aping()` (a `SELECT 1`) and `PgCheckpointer.aping()`. The Postgres version runs `SELECT 1`, raises `RuntimeError` when the recorded schema version is older than the code expects (the message names both), and pings its Redis cache directly, so an outage is reported and the Redis circuit breaker is left unchanged. It never creates the schema: the server runs `asetup()` at boot.
