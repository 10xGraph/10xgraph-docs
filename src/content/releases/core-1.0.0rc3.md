---
package: core
version: "1.0.0rc3"
date: 2026-10-30
summary: The third 1.0 release candidate. Every memory store now implements aping(), a connectivity check the API server uses for readiness and startup. Breaking for custom stores.
breaking: true
---

The third 1.0 release candidate. It is the `1.0.0rc2` code plus a required connectivity check on memory stores. Pip skips it unless you pass `--pre`:

```bash
pip install -U --pre "10xgraph==1.0.0rc3"
```

`10xgraph-api` 1.0.0rc3 ships alongside it. Read **Breaking** and the [upgrade guide](/docs/project/upgrade-to-1.0) before upgrading.

### Breaking

- **`BaseStore.aping()` is now abstract.** A custom store must implement `async def aping(self) -> None`: return when its backend is reachable and raise when it is not. An in-process store just returns. `10xgraph-api` calls it for `/health/ready` and at startup. **Migration:** add the method to every custom `BaseStore` subclass. Without it the class raises `TypeError` when created.

### Added

- `QdrantStore.aping()`, `Mem0Store.aping()` and `InMemoryStore.aping()` check that the store's backend is reachable. `10xgraph-api` uses them for `/health/ready` and its startup check.
