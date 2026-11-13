---
package: api
version: "1.0.0rc3"
date: 2026-10-30
summary: The third 1.0 release candidate. The server refuses to start while a configured backend is unreachable, a rate-limiter outage answers 503, and the hosted playground can reach a local dev server.
breaking: false
---

The third 1.0 release candidate. It is the `1.0.0rc2` code plus the changes below. Pip skips it unless you pass `--pre`:

```bash
pip install -U --pre "10xgraph-api==1.0.0rc3"
```

It requires `10xgraph` 1.0.0rc3 (stores have `aping()`). `10xgraph-client` stays at 1.0.0-rc.2. See the [upgrade guide](/docs/project/upgrade-to-1.0) for the move to 1.0.

### Added

- **Startup checks.** The server refuses to start while a configured backend is unreachable: the checkpointer's Postgres (query and schema version) and Redis, the store (when it has `aping` or `ping`), the API's Redis (`redis` in `10xgraph.json` or `REDIS_URL`) and the rate limiter's own Redis.
- It retries with a short backoff for `STARTUP_CHECK_TIMEOUT_SECONDS` (default 30), so services started together can come up in any order. Then it exits non-zero with each failed component, its `host:port` (no credentials) and the error.
- This applies in production too, so a broken connection string fails the deploy instead of the first request. `STARTUP_CHECKS=false` skips it.
- Before, the server started anyway and, with a fail-closed Redis rate limiter, answered every request except `/ping` with 429.

### Changed

- **A rate-limiter backend outage with `fail_open: false` answers `503`** with error code `RATE_LIMIT_UNAVAILABLE` and `Retry-After: 5`, instead of `429 RATE_LIMIT_EXCEEDED`. 429 is kept for a real limit hit. Clients that retried on 429 should now retry on 503 too.
- A custom backend can signal the same with `RateLimitDecision.backend_unavailable()`. Backends that return only allow or deny work unchanged.
- The Redis backend logs a traceback for the first error of an outage and one line per error after it, instead of a traceback per request.

### Fixed

- The hosted playground can reach a local `10xgraph dev` server: CORS answers the browser's private-network preflight (`Access-Control-Request-Private-Network`) for origins in `ORIGINS`. Before, it answered 400 and the browser reported a CORS error.
