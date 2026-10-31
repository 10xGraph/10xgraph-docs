---
title: Bring your own backend
seoTitle: "Custom checkpointer, store and cache store"
description: "The three storage classes behind a 10xGraph server, what each holds, how to plug in a custom one, the aping rules and the BaseCacheStore contract."
section: "API server"
group: "Operate"
order: 175
label: Bring your own backend
updated: "2026-10-31"
faq:
  - question: "Do I need a custom cache store to use Valkey, Dragonfly or KeyDB?"
    answer: "No. They speak the Redis protocol, so point `redis` in 10xgraph.json (or REDIS_URL) at them and RedisCacheStore works. Write a BaseCacheStore only for a store that does not speak the Redis protocol."
  - question: "Which Redis eviction policy is safe?"
    answer: "noeviction or a volatile-* policy. Any other policy can drop a lock or a revocation before its TTL, which lets two workers run the same thread."
  - question: "Can the server start if the cache store is down?"
    answer: "Yes, unless a fail-closed feature uses it: token_revocation is on, or rate_limit is on with fail_open set to false. Otherwise the server logs one warning and starts, with locks and caps per process."
---

A 10xGraph server keeps its state in three places, and each one is an abstract class you can replace. This page lists them, shows how to select a custom one, and documents the rules a replacement must keep. The default for each is enough for most deployments; read on when your infrastructure is different, for example a database the built-in classes do not cover.

Valkey, Dragonfly and KeyDB speak the Redis protocol, so you do not need any of this for them: point the Redis URL at the server and the built-in classes work.

## The three classes

| Class | Package | Default | Holds |
|---|---|---|---|
| `BaseCheckpointer` | `10xgraph` | `PgCheckpointer` (Postgres plus its own Redis hot cache) | Threads, messages and state |
| `BaseStore` | `10xgraph` | `QdrantStore` or `Mem0Store` | Long-term memory |
| `BaseCacheStore` | `10xgraph-api` | `RedisCacheStore`; `InMemoryCacheStore` when no Redis is set | Everything the API shares between workers |

Each of the three has an abstract `aping()`. The server calls it at startup and on `/health/ready`, so a replacement tells the server whether it is usable in the same way as a built-in.

### What the cache store backs

| Feature | What it keeps | If the store raises an error |
|---|---|---|
| Per-thread run lock | A timed slot, limit 1 | Fails open: the run proceeds and the error is logged |
| Run cap (`runs.max_concurrent_per_user`) | Timed slots | Fails open |
| WebSocket caps (`websocket.max_connections`, `max_connections_per_user`) | Timed slots | Fails open |
| Idempotency | The running lease and the stored records | Fails open |
| Ownership cache (L2) | Keys with a TTL | Fails open: lookups fall back to the checkpointer |
| Token revocation | Keys with a TTL; a per-user cutoff that only moves forward | Fails closed: the request gets `503` |
| Rate limiting | Timed slots that are never released | Follows `rate_limit.fail_open` (default `true`); `false` answers `503` `RATE_LIMIT_UNAVAILABLE` with `Retry-After: 5` |

## Select a custom backend

The checkpointer, store and media store are passed to `compile()` in your graph module. The server does not read the `checkpointer` or `store` keys to build them for you (see [Configure the server](/docs/server/configure)):

```python title="graph/agent.py"
app = graph.compile(checkpointer=MyCheckpointer(), store=MyStore())
```

The cache store is the one backend chosen in `10xgraph.json`. The first of these that is set wins:

1. `"cache_store": "module:attr"`: a `BaseCacheStore` instance, or a zero-argument factory (a class or function) that returns one.
2. `"redis": "redis://..."`: `RedisCacheStore` on that URL. The value supports `${VAR}`.
3. `REDIS_URL` in the environment: the same.
4. Otherwise `InMemoryCacheStore`.

```json title="10xgraph.json"
{
  "agent": "graph.agent:app",
  "cache_store": "graph.cache:store"
}
```

```python title="graph/cache.py"
from my_company.cache import MyCacheStore

store = MyCacheStore("https://cache.internal")
```

The server logs one INFO line at boot that names the store and where the choice came from, for example `Cache store: RedisCacheStore (from REDIS_URL, localhost:6379)`. A store can add its own endpoint to that line by implementing `describe()`, which returns a string such as `host:port` and never credentials.

## The `aping()` rules

All three classes use the same pattern:

- Return when the backend is reachable and usable. Raise any exception when it is not.
- Be read-only and cheap. The server may call it on every readiness probe, which is every few seconds. Do not write data, create tables or take locks.
- An in-process implementation just returns.

`PgCheckpointer.aping()` is the reference: it runs `SELECT 1`, raises `RuntimeError` when the recorded schema version is older than the code expects, and pings its own Redis. It never creates the schema; the server runs `asetup()` at boot.

`aping()` is abstract on `BaseCheckpointer` (since 1.0.0rc4), `BaseStore` (since 1.0.0rc3) and `BaseCacheStore`. A subclass without it raises `TypeError` when created.

What a failed ping does:

| Component | Fatal at startup | Fails `/health/ready` |
|---|---|---|
| Checkpointer | Yes | Yes |
| Store (when one is bound) | Yes | Yes |
| Cache store | Only when a fail-closed feature uses it: `token_revocation` is on, or `rate_limit` is on with `fail_open` set to `false` | Under the same rule |

When the cache store is down and no fail-closed feature uses it, the server logs one WARNING and starts, with locks and caps per process. The readiness response then reports `"cache": "fail"` and still answers `200`. See [Ping and health](/docs/reference/rest-api/ping#get-healthready) and the [startup check](/docs/server/production-checklist#startup-check).

## The `BaseCacheStore` contract

Two primitives cover every feature above. **Timed slots** (`acquire`, `renew`, `release`) are a set of expiring slots per key, capped at `limit`. A lock is a slot set with `limit=1`; a rate limit is a slot set whose slots are never released and expire after the window. **Keys with a TTL** (`get`, `set`, `delete`) hold values such as idempotency records, ownership entries and revocations.

| Method | Meaning |
|---|---|
| `aping() -> None` | Return when the store answers; raise otherwise. |
| `now() -> float` | The store's clock, in seconds since the epoch. |
| `acquire(key, limit, ttl) -> SlotResult` | Take one of `limit` slots for `key`, expiring `ttl` seconds from now. |
| `renew(key, slot_id, ttl) -> bool` | Move a held slot's expiry to `now() + ttl`. Returns `False` when the slot is gone. |
| `release(key, slot_id) -> None` | Remove a slot. No error when it is already gone. |
| `get(key) -> bytes \| None` | The value under `key`, or `None`. |
| `set(key, value, ttl, mode="always") -> bool` | Store a value. `mode` is `"always"`, `"if_absent"` or `"if_greater"`. Returns whether it wrote. |
| `delete(key) -> None` | Remove `key`. No error when it does not exist. |
| `describe() -> str \| None` | Optional. Where the store lives, without credentials, for logs and startup messages. |
| `aclose() -> None` | Optional. Release resources; called once on shutdown. |

`acquire` returns `SlotResult(granted, count, oldest_expiry, slot_id)`: whether a slot was granted, the live slots after the call (including yours when granted), the expiry of the oldest live slot on the store's clock (or `None`), and the new slot's id when granted (or `None`).

An implementation must keep these rules. The contract test suite checks them.

- **`acquire` is atomic.** Drop expired slots, and only if the live count is below `limit`, add a new slot expiring at `now() + ttl`. Two callers can never both take the last slot. `limit < 1` always denies.
- **A denied `acquire` adds nothing.** The rate limiter relies on this: a client over its limit does not extend its own penalty.
- **`renew` never re-creates a slot.** It returns `False` when the slot expired or was released.
- **`release` of a missing slot is not an error.**
- **`set(mode="if_absent")`** writes only when the key does not exist.
- **`set(mode="if_greater")`** treats the value as a decimal number and writes only when it is greater than the stored one, or nothing is stored. It is atomic. Token revocation uses it so an older cutoff never overwrites a newer one. A value that is not a decimal number raises `ValueError`.
- **`ttl` is in seconds and must be positive.** `set(ttl=None)` keeps the key until it is deleted. A write replaces the TTL of the key it writes.
- **TTLs are never dropped early.** A key or slot must not disappear before its TTL. A store that evicts data under memory pressure breaks locks: two workers run the same thread. For Redis this means `maxmemory-policy` must be `noeviction` or a `volatile-*` policy. Any other policy is a deployment mistake.
- **Every method touches exactly one key.** That keeps the store safe on Redis Cluster and on sharded stores.
- **Raise on errors.** When the backend fails, raise any exception. The features decide whether to fail open or closed (see the table above). The store never swallows errors.
- **Use the store's clock.** All times come from `now()`, so pods with skewed clocks agree on when a slot expires.

Keys arrive as `"<feature>:<id>"`, for example `concurrency:runs:thread:42`. The store may map the feature segment to its own namespace and add a deployment prefix, but two different keys must never land on the same entry, and any string (with `:`, spaces or unicode) is a valid key. A key holds either slots or a value, never both.

### Built-in stores

`RedisCacheStore` uses Lua scripts on sorted sets for the slots, `SET` with `PX` for values, and a small script for `if_greater`. It applies `REDIS_KEY_PREFIX` and keeps the Redis key layouts of earlier releases, except for the rate limiter, which moved to the `10xgraph:ratelimit2` namespace in 1.0.0rc4 (counters reset once on upgrade). Its connection limits come from the `REDIS_*` settings; see the [environment reference](/docs/reference/api-cli/environment).

`InMemoryCacheStore` keeps everything in one process. It is correct for a single worker and wrong for several: locks, caps and revocations do not cross processes. To bound memory it caps slot keys at 50,000 and plain values at 10,000 and evicts the least recently used entry at the cap, with a warning. That is its one exception to "TTLs are never dropped early". It never evicts lease keys (`concurrency:`) or revocation keys (`revoked:`) while they are live, so a lock or a revoked token cannot disappear.

## A minimal skeleton

This skeleton shows the shape. The comments say what each method must do on your backend.

```python title="my_company/cache.py"
from typing import Literal

from tenxgraph_api import BaseCacheStore, SlotResult


class MyCacheStore(BaseCacheStore):
    def __init__(self, url: str) -> None:
        self._url = url
        self._client = ...  # your async client

    async def aping(self) -> None:
        # Read-only and cheap: one round trip. Raise if the backend does not answer.
        ...

    async def now(self) -> float:
        # The backend's own clock, not time.time() on this pod.
        ...

    async def acquire(self, key: str, limit: int, ttl: float) -> SlotResult:
        # One atomic step: drop expired slots, count live ones, add a slot only if
        # count < limit. Never add on denial. Return the count after the call, the
        # oldest live expiry on the store's clock, and the new slot id when granted.
        ...

    async def renew(self, key: str, slot_id: str, ttl: float) -> bool:
        # Move the expiry of a slot that still exists. Return False if it is gone.
        ...

    async def release(self, key: str, slot_id: str) -> None:
        # Remove the slot; a missing slot is fine.
        ...

    async def get(self, key: str) -> bytes | None:
        ...

    async def set(
        self,
        key: str,
        value: bytes,
        ttl: float | None,
        mode: Literal["always", "if_absent", "if_greater"] = "always",
    ) -> bool:
        # "if_absent": write only if missing. "if_greater": atomic compare of two
        # decimal numbers. Return True when you wrote.
        ...

    async def delete(self, key: str) -> None:
        ...

    def describe(self) -> str | None:
        return "cache.internal:443"  # no credentials

    async def aclose(self) -> None:
        ...
```

Select it with `"cache_store": "my_company.cache:store"` as shown above. `store` can be an instance or a function that takes no arguments and returns one.

## Test it with the contract suite

`tenxgraph_api.testing.cache_store_contract` ships the checks the built-in stores pass: `aping`, the slot limit, 50 concurrent `acquire` calls granting exactly the limit, `release` and `renew`, slot expiry, `get`, `set` and `delete` with all three modes (including 50 concurrent `if_greater` writes leaving the maximum), the clock, and keys with odd characters. Each check opens its own store from your factory, works under its own keys and closes the store, so it is safe to run against a shared server.

As a pytest mixin, subclass `CacheStoreContract` and implement `make_store()`:

```python title="tests/test_my_cache.py"
from tenxgraph_api.testing.cache_store_contract import CacheStoreContract

from my_company.cache import MyCacheStore


class TestMyCacheStore(CacheStoreContract):
    def make_store(self):
        return MyCacheStore("https://cache.internal")
```

Or call it from any async code:

```python
from tenxgraph_api.testing.cache_store_contract import run_cache_store_contract

await run_cache_store_contract(lambda: MyCacheStore("https://cache.internal"))
```

`make_store()` and the factory can return a store or an awaitable of one. A failed check raises `AssertionError`. The timing checks use TTLs of a few hundred milliseconds, so the store must answer well within that.

## Custom checkpointers and stores

A custom `BaseCheckpointer` implements every abstract async method, including `aping()`, and `aget_thread_owner` when auth is on. A custom `BaseStore` implements its methods and `aping()`. Both are passed to `compile()`. The method lists are in the [checkpointer reference](/docs/reference/python/checkpointers#writing-a-custom-checkpointer) and the [store reference](/docs/reference/python/memory-stores), and [Extension points](/docs/concepts/extensibility) shows where every extension class is wired.

## What changed in 1.0.0rc4

`BaseCacheStore` replaced `ConcurrencyLimiter`, `TokenRevocationBackend` and `BaseRateLimitBackend`. Those classes, `"token_revocation": "redis" | "memory" | "module:attr"` and the `rate_limit.backend` and `rate_limit.redis` keys are gone, with no aliases. See [Upgrade to 1.0](/docs/project/upgrade-to-1.0#from-100rc3-to-100rc4).

## See also

- [Production checklist](/docs/server/production-checklist) for the startup check and the Redis settings
- [Rate limiting](/docs/server/rate-limiting) for the limiter that uses the cache store
- [Scaling and reliability](/docs/production/scaling) for what the cache store shares across workers
