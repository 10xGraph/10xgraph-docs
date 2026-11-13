---
package: api
version: "1.0.0rc5"
date: 2026-11-10
summary: The fifth 1.0 release candidate. Roles with reach, tenant isolation, background jobs on TaskIQ, an audit log, JSON logs and Prometheus metrics make the API server ready for multi-tenant applications.
breaking: true
---

The fifth 1.0 release candidate. 10xGraph is open-source, self-hosted infrastructure for AI applications, and this release makes the API server ready for multi-tenant applications. Pip skips it unless you pass `--pre`:

```bash
pip install -U --pre "10xgraph-api==1.0.0rc5"
```

It requires `10xgraph` 1.0.0rc5. Breaking changes since rc4 and the upgrade steps are in the [upgrade guide](/docs/project/upgrade-to-1.0).

### Breaking

- **The `authorization` key is removed.** Authorization now lives in the single `auth` object (see Highlights below). Top-level `authorization` refuses to boot.

### Highlights

- **Roles with reach.** One `auth` object: `method` (`none`, `jwt`, `custom`), `roles` with permissions and a reach of `own`, `tenant` or `all`, `default_role` and `tenant_claims`. Reads, lists, deletes and stop widen with reach; runs and writes stay with the owner. A thread, message, memory, file or run outside the caller's reach answers 404.
- **Tenant isolation.** `tenant_claims` must match the tenant columns declared on the checkpointer and the store (refused in production on a mismatch), and files are tenant-scoped.
- **Background jobs on TaskIQ.** `from tenxgraph_api.jobs import broker`, `10xgraph worker`, `10xgraph scheduler` and the `/v1/tasks` routes. Jobs run as the caller and check `tasks:trigger`.
- **Audit log and JSON logs.** A metadata-only audit log (`audit` key; sinks `log`, `publisher` or your own `BaseAuditSink`) and `LOG_FORMAT=json`. The production template turns the audit log on, and `10xgraph build` sets `LOG_FORMAT=json`.
- **Prometheus metrics** for the API and the job worker through the `metrics` block, by scrape or OTLP push.
- **Built for teams going through SOC 2 and ISO 27001 audits.** See the [control mapping](/docs/production/control-mapping).
