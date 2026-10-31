---
package: api
version: "1.0.0rc4"
date: 2026-10-31
summary: The fourth 1.0 release candidate. One BaseCacheStore replaces the concurrency limiter, token revocation and rate-limit backends, and a leftover REDIS_URL no longer blocks boot. Breaking changes included.
breaking: true
---

The fourth 1.0 release candidate. It is the `1.0.0rc3` code plus the changes below. Pip skips it unless you pass `--pre`:

```bash
pip install -U --pre "10xgraph-api==1.0.0rc4"
```

It requires `10xgraph` 1.0.0rc4 (checkpointers have `aping()`). `10xgraph-client` stays at 1.0.0-rc.2. Read **Breaking** and the [upgrade guide](/docs/project/upgrade-to-1.0#from-100rc3-to-100rc4) before upgrading.

### Breaking

- **`BaseCacheStore` replaces three extension points.** Removed with no aliases: `ConcurrencyLimiter`; `TokenRevocationBackend` (and its in-memory and Redis variants, and `build_token_revocation`); `BaseRateLimitBackend`, `MemoryRateLimitBackend` and `RedisRateLimitBackend`. **Migration:** implement `BaseCacheStore` if you wrote your own, and select it with `"cache_store": "module:attr"`.
- **`token_revocation` is `true`, `false` or an object.** The values `"redis"`, `"memory"` and `"module:attr"` are config errors that name `cache_store`. The object form is `{"enabled": true, "token_lifetime": <seconds>, "user_ttl": <seconds>}`; `user_ttl` defaults to 30 days and `null` keeps entries forever. **Migration:** use `"token_revocation": true` and set `redis` (or `REDIS_URL`) so revocations reach every worker.
- **`rate_limit.backend` and `rate_limit.redis` are removed.** They are config errors that name `cache_store`. The counters follow the cache store. **Migration:** delete both keys and set the top-level `"redis": "${REDIS_URL}"`.
- **`/health/ready` reports `cache`, not `redis`.** The keys are `checkpointer`, `store` and `cache`. **Migration:** update monitors that read `checks.redis`.
- **Rate-limit counters reset once.** The Redis keys moved to the `10xgraph:ratelimit2` namespace. Other Redis key layouts are unchanged, so old and new pods share locks during a rolling deploy.

### Added

- `BaseCacheStore`, `RedisCacheStore`, `InMemoryCacheStore` and `SlotResult`, importable from `tenxgraph_api`. One class holds the per-thread run lock, `runs.max_concurrent_per_user`, WebSocket caps, idempotency (the running lease and stored records), the ownership cache (L2), token revocation and rate limiting. Valkey, Dragonfly and KeyDB work through the Redis URL. See [Bring your own backend](/docs/server/bring-your-own-backend).
- `"cache_store": "module:attr"` in `10xgraph.json` (an instance or a zero-argument factory). Selection order: `cache_store`, then `redis`, then `REDIS_URL`, then `InMemoryCacheStore`. The server logs one INFO line at boot that names the store and where the choice came from.
- `tenxgraph_api.testing.cache_store_contract`: a `CacheStoreContract` pytest mixin and `run_cache_store_contract(factory)` that check an implementation against the contract.
- A warning at boot when token revocation uses an in-memory cache store in production or with `WEB_CONCURRENCY` above 1, because revocations then only reach one process.

### Changed

- **The startup check and `/health/ready` only call `aping()`.** The cache store stops the boot, and fails readiness, only when a fail-closed feature uses it: `token_revocation` is on, or `rate_limit` is on with `fail_open` set to `false`. Otherwise an unreachable cache store logs one warning and the server starts. The hint reads "Start the backend, fix its URL, or set STARTUP_CHECKS=false to skip this check."
- Failure behaviour is explicit: run locks, caps, idempotency and the ownership cache fail open; token revocation fails closed (503); rate limiting follows `rate_limit.fail_open`.
- `10xgraph revoke` builds the configured cache store the same way as the server (`--redis-url` still overrides) and refuses with a clear error when it is `InMemoryCacheStore`.
- `10xgraph init --rate-limit redis` turns rate limiting on with a Redis cache store (`"redis": "${REDIS_URL}"`); `memory` turns it on without Redis. The production template sets `"redis": "${REDIS_URL}"` and `"token_revocation": true` and has no `rate_limit.backend` or `rate_limit.redis`.
- `InMemoryCacheStore` caps its memory at 50,000 slot keys and 10,000 plain values and evicts the least recently used entry, except live lease (`concurrency:`) and revocation (`revoked:`) keys.

### Fixed

- A leftover `REDIS_URL` no longer stops the server from booting when nothing you configured needs Redis. In rc3 a setup with an in-memory checkpointer and an in-memory rate limiter refused to start because of it.
