---
package: core
version: "1.0.0rc5"
date: 2026-11-10
summary: The fifth 1.0 release candidate. Adds tenant isolation in storage, identity with reach, pgvector long-term memory, Phoenix and OTLP tracing, and SOC 2 and ISO 27001 control mapping.
breaking: true
---

The fifth 1.0 release candidate. 10xGraph is open-source, self-hosted infrastructure for AI applications, and this release adds the core pieces for multi-tenant applications. Pip skips it unless you pass `--pre`:

```bash
pip install -U --pre "10xgraph==1.0.0rc5"
```

`10xgraph-api` 1.0.0rc5 ships alongside it. The changelog for this release lists highlights only. Breaking changes since rc4 and the upgrade steps are in the [upgrade guide](/docs/project/upgrade-to-1.0).

### Highlights

- **Tenant isolation in storage.** Declare `tenant_columns` (and data `extra_columns`) on `PgCheckpointer` and `PgVectorStore`. Values come only from the verified identity and filter every query. Native Postgres row-level security is opt-in with `row_level_security=True`. `compile()` checks that the checkpointer and the store declare the same tenant columns.
- **Identity with reach.** The caller is an `Identity` in `config["user"]` with reach `own`, `tenant` or `all`. Reads widen with reach, writes always stay with the owner, and a thread outside the caller's reach raises `ThreadNotFoundError` (404 in the API). This replaces the `config["authz"]` block.
- **Long-term memory in the same Postgres.** `PgVectorStore` (extra `pgvector`) offers similarity, full-text and hybrid search, and safe filters on declared columns. `Mem0Store` is removed.
- **Tracing.** A Phoenix publisher (OpenInference attributes) and OTLP export, next to OpenTelemetry, Logfire and LangSmith (extras `phoenix`, `otlp`, `observability`).
- **Built for teams going through SOC 2 and ISO 27001 audits.** Together with `10xgraph-api` (roles, tenant isolation, audit log, JSON logs), see the [control mapping](/docs/production/control-mapping).
