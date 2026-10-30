---
package: api
version: "1.0.0rc2"
date: 2026-10-30
summary: The second 1.0 release candidate. Stricter ids, resume and write conflicts as 409, a JWT algorithm allowlist, shutdown settings, Redis and media limits, and a run trace. Breaking changes included.
breaking: true
---

The second 1.0 release candidate. It is the `1.0.0rc1` code plus the changes below. Pip skips it unless you pass `--pre`:

```bash
pip install -U --pre "10xgraph-api==1.0.0rc2"
```

It requires `10xgraph` 1.0.0rc2 and is aligned with `10xgraph-client` 1.0.0-rc.2. If you upgrade from 0.9.x, the rc1 breaking list applies to you as well. Read **Breaking** and the [upgrade guide](/docs/project/upgrade-to-1.0) before upgrading.

### Breaking

- **Ids in paths and bodies must match `^[A-Za-z0-9._:@-]{1,128}$`.** A `thread_id`, `message_id` or memory id that is longer or has other characters gets 422 (`VALIDATION_ERROR`). Snowflake integers and UUIDs fit.
- **Nested `initial_state`, `config` and `resume` values deeper than 64 levels get 422.**
- **Resume errors answer 409 or 422.** A wrong interrupt id, a resume sent to a thread that is not paused, and a new message sent to a thread paused at `interrupt()` return 409 (before the stream starts on `POST /v1/graph/stream`). A value that fails the interrupt's `response_schema` returns 422.
- **Writes during a run return 409.** State and message writes, thread and message deletes, and `POST /v1/graph/fix` are refused while a run holds the thread. **Migration:** retry after the run ends or stop it first.
- **`DELETE /v1/threads/{thread_id}` can return `success=false`** with `data.cleanup_failed` when file, trace or cache cleanup failed. The thread rows are deleted; retry the cleanup.
- **`JWT_ALGORITHM` must be on the allowlist** (`HS256`, `RS256`, `ES256`, `PS256`, `EdDSA` and their variants). `none` or any other value stops startup, as does `"auth": "jwt"` without PyJWT. The `auth` value must be exactly `"jwt"`.
- **The `graph:setup` scope is gone.** Remove it from your authorization config.
- **A run that hits its recursion limit answers 422 (`GRAPH_RECURSION_LIMIT`), not 500.** Graph validation errors use `VALIDATION_ERROR` only.
- **`POST /v1/graph/stream` is labelled `application/x-ndjson`** and idle streams send a blank keep-alive line every 15 s. **Migration:** update proxy rules or clients that matched `text/event-stream`.
- **AG-UI and `/v1/graph/live` follow `runs.thread_ids` like REST.** Frontends that make their own thread ids (CopilotKit does by default) must set `"runs": {"thread_ids": "client"}`.
- **`10xgraph build` refuses `--docker-compose` together with `--k8s`.** Run it once per target.
- **Uploads are checked against new limits:** images over 50,000,000 pixels and PDFs over 10 MB or 500 pages get 413.
- **`IS_DEBUG` is removed.** Debug follows `MODE`. The `/v1/evals/runs` endpoints are removed, and `10xgraph eval` writes only the JSON report.

### Upgrade notes

- Postgres: stop all old pods, run the schema migration with one new pod, then start the rest. `/health/ready` fails while the schema is behind.
- The generated Gunicorn command uses `TenxGraphUvicornWorker`: regenerate Docker and Kubernetes files with `10xgraph build`. Keep `--graceful-timeout` above the three `SHUTDOWN_*_SECONDS` settings.
- Handled client errors log one WARNING line, not an ERROR with a traceback.

### Added

- Shutdown settings `SHUTDOWN_GRACE_SECONDS`, `SHUTDOWN_STOP_SECONDS` and `SHUTDOWN_TIMEOUT_SECONDS`; 503 with `Retry-After` while closing; a final error chunk with `data.interrupted: true` on a cut stream; and a terminal `done` chunk on HTTP streams.
- Typed server errors with the request id, 429 `PROVIDER_RATE_LIMITED`, and `Retry-After` on 429 and 409.
- Redis settings `REDIS_SOCKET_TIMEOUT`, `REDIS_CONNECT_TIMEOUT`, `REDIS_POOL_TIMEOUT`, `REDIS_MAX_CONNECTIONS`, `REDIS_HEALTH_CHECK_INTERVAL` and `REDIS_KEY_PREFIX`.
- Media limits `MEDIA_MAX_FILES_PER_USER`, `MEDIA_MAX_USER_STORAGE_MB`, `MEDIA_MAX_IMAGE_PIXELS`, `MEDIA_MAX_PDF_MB`, `MEDIA_MAX_PDF_PAGES`, `MEDIA_INLINE_MAX_BYTES` and `MEDIA_SWEEP_INTERVAL_SECONDS`, and `GET /v1/files`.
- `has_more`, `offset` and `limit` on thread, message and memory lists.
- A run trace span tree on the observability route (dev only), and `realtime_options` in the graph details.
- `10xgraph revoke` for tokens (`--jti` or `--user`) with Redis-backed revocation.

### Fixed

- Stop and shutdown reach a REST stream after its first chunk, and a disconnected stream frees its thread only after the run is saved.
- `10xgraph eval` reports carry each case's expectations, and the `init` eval templates check what they declare and can pass.
- The template weather tool answers per city, and the default Gemini Live model name is current.
