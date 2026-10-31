---
package: api
version: "1.0.0rc4"
date: 2026-10-31
summary: The fourth 1.0 release candidate. One cache_store object configures the BaseCacheStore behind locks, rate limiting and token revocation, and 10xgraph init asks only three questions. Breaking changes included.
breaking: true
---

The fourth 1.0 release candidate. It is the `1.0.0rc3` code plus the changes below. Pip skips it unless you pass `--pre`:

```bash
pip install -U --pre "10xgraph-api==1.0.0rc4"
```

It requires `10xgraph` 1.0.0rc4 (checkpointers have `aping()`). `10xgraph-client` stays at 1.0.0-rc.2. Read **Breaking** and the [upgrade guide](/docs/project/upgrade-to-1.0#from-100rc3-to-100rc4) before upgrading.

### Breaking

- **`BaseCacheStore` replaces three extension points.** Removed with no aliases: `ConcurrencyLimiter`; `TokenRevocationBackend` (and its in-memory and Redis variants, and `build_token_revocation`); `BaseRateLimitBackend`, `MemoryRateLimitBackend` and `RedisRateLimitBackend`. **Migration:** implement `BaseCacheStore` if you wrote your own, and select it with `"cache_store": {"type": "custom", "path": "module:attr"}`.
- **`cache_store` is one object.** It holds the store and what it backs: `{"type": "memory" | "redis" | "custom", "url": "${REDIS_URL}", "path": "module:attr", "rate_limit": {...}, "token_revocation": true}`. `url` goes with type `redis` (optional: empty reads the `REDIS_URL` environment variable; `$VAR` and `${VAR}` are expanded) and `path` with type `custom`. No `cache_store`, or no `type`, is the in-memory store. Unknown keys are config errors that list the valid ones.
- **Top-level `redis`, `rate_limit` and `token_revocation` keys are config errors.** The error says where each setting goes: inside `cache_store`. `rate_limit` inside `cache_store` has no `backend` or `redis` key, and `token_revocation` is `true`, `false`, `null` or `{"enabled", "token_lifetime", "user_ttl"}`; the strings `"redis"`, `"memory"` and `"module:attr"` are config errors. **Migration:** see the mapping table in the [upgrade guide](/docs/project/upgrade-to-1.0#from-100rc3-to-100rc4).
- **`REDIS_URL` no longer selects the cache store.** Write `"cache_store": {"type": "redis"}`; with no `url` it reads `REDIS_URL`. Type `redis` without the `redis` package refuses to boot with `pip install "10xgraph-api[redis]"`.
- **`/health/ready` reports `cache`, not `redis`.** The keys are `checkpointer`, `store` and `cache`. **Migration:** update monitors that read `checks.redis`.
- **Rate-limit counters reset once.** The Redis keys moved to the `10xgraph:ratelimit2` namespace. Other Redis key layouts are unchanged, so old and new pods share locks during a rolling deploy.
- **`10xgraph init` asks only the agent name, template and AI provider.** Production writes the recommended setup: `"auth": "jwt"`, `"authorization": "ownership"`, `"id_generator": "uuid"` and `"cache_store": {"type": "redis", "rate_limit": {...}, "token_revocation": true}` (100 requests per 60 seconds by user, `fail_open` false; no `url`, so Redis reads `REDIS_URL`). WebSocket and AG-UI are off. Quick Start writes no `cache_store`. The flags `--auth`, `--cache-store memory|redis`, `--rate-limit/--no-rate-limit`, `--token-revocation/--no-token-revocation` and `--websocket` override parts of it for scripts.
- **`thread_name_generator` takes `random` (the default), `first_message`, `none` or `module:attr`.** With the key unset, new threads are now named (randomly) and the name is saved; before, the default name was generated and dropped. Names are built from the user's messages first, then the replies.

### Added

- `BaseCacheStore`, `RedisCacheStore` (also Valkey, Dragonfly and KeyDB) and `InMemoryCacheStore`, importable from `tenxgraph_api`. One class holds the per-thread run lock, `runs.max_concurrent_per_user`, WebSocket caps, idempotency, the ownership cache (L2), token revocation and rate limiting. See [Bring your own backend](/docs/server/bring-your-own-backend).
- One INFO line at boot names the store and the config key it came from, for example `Cache store: RedisCacheStore (cache_store.url, localhost:6379)`.
- `tenxgraph_api.testing.cache_store_contract`: a `CacheStoreContract` pytest mixin and `run_cache_store_contract(factory)` that check an implementation against the contract.
- `id_generator` in `10xgraph.json`: `uuid`, `hex`, `short`, `int`, `bigint`, `timestamp`, `snowflake` (needs the `snowflakekit` extra and the `SNOWFLAKE_*` variables) or `module:attr`. New thread, message and memory ids all come from it. Boot refuses when the graph is also compiled with its own generator, and when a `PgCheckpointer` `id_type` cannot hold the ids.
- `thread_name_generator: "first_message"`: the user's first message, whitespace collapsed, cut to at most 60 characters on a word boundary.
- `10xgraph config` edits token revocation as a section with `enabled`, `token_lifetime` and `user_ttl`, and has a Cache store page with type cards and Rate limiting and Token revocation tabs.
- A warning at boot when token revocation uses an in-memory cache store in production or with `WEB_CONCURRENCY` above 1.

### Changed

- **The startup check and `/health/ready` only call `aping()`.** The cache store stops the boot only when a fail-closed feature uses it: `cache_store.token_revocation` is on (with auth), or `cache_store.rate_limit` is on with `fail_open` set to `false`. Otherwise an unreachable cache store logs one warning and the server starts, and `/health/ready` reports `cache: fail` with status 200. Startup errors name each component's class, the config key of the cache store and its endpoint, never credentials.
- Failure behaviour is explicit: run locks, caps, idempotency and the ownership cache fail open; token revocation fails closed (503); rate limiting follows `cache_store.rate_limit.fail_open`.
- `10xgraph revoke` writes to the cache store `cache_store` selects (`--redis-url` still overrides) and refuses with a clear error when it is the in-memory store.
- `InMemoryCacheStore` caps its memory at 50,000 slot keys and 10,000 plain values and evicts the least recently used entry, except live lease and revocation keys. It keeps expiries on the monotonic clock, so a wall clock jump does not expire a held thread lock early.
- Shutdown closes the cache store once, after the graph and after pending lease releases.

### Fixed

- A leftover `REDIS_URL` no longer stops the server from booting when nothing you configured needs Redis. In rc3 a setup with an in-memory checkpointer and an in-memory rate limiter refused to start because of it.
- A rate-limit denial stays a 429 when reading the cache store clock for `Retry-After` fails.
- `revoke_user` stores the cutoff rounded up to the microsecond, so a token issued at the cutoff itself is always revoked.
