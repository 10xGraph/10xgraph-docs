---
title: BaseCacheStore reference
seoTitle: "BaseCacheStore reference for custom backends"
description: "Reference for BaseCacheStore, the API server's shared-state interface: every method with its signature, what it must do, and the rules a custom store keeps."
section: Reference
group: "CLI and configuration"
order: 455
updated: "2026-11-25"
---

The cache store holds the state the API shares between its workers: run locks and caps, idempotency records, token revocation and rate-limit counters. Every one of those features uses two primitives, timed slots and keys with a TTL. `BaseCacheStore` is the abstract class that defines them.

Source: [`tenxgraph_api/src/app/core/cache_store/base.py`](https://github.com/10xGraph/10xgraph-api/blob/main/tenxgraph_api/src/app/core/cache_store/base.py)

Select a custom store with `cache_store.type` `custom` and `path`; see [cache_store](/docs/reference/api-cli/configuration#cache_store) and [Bring your own backend](/docs/server/bring-your-own-backend).

## Methods

`BaseCacheStore` has 10 methods: 8 abstract and 2 optional (`describe` and `aclose`). `SlotResult` is the frozen model that `acquire` returns; its fields are `granted: bool`, `count: int`, `oldest_expiry: float | None` and `slot_id: str | None`.

| Method | Required | What it must do |
|---|---|---|
| `async def aping(self) -> None` | Yes | Return when the store answers; raise otherwise. |
| `async def now(self) -> float` | Yes | Return the store's clock, in seconds since the epoch. |
| `async def acquire(self, key: str, limit: int, ttl: float) -> SlotResult` | Yes | Take one of `limit` slots for `key`, expiring `ttl` seconds from now. |
| `async def renew(self, key: str, slot_id: str, ttl: float) -> bool` | Yes | Move a held slot's expiry to `now() + ttl`. Return `False` when the slot is gone. |
| `async def release(self, key: str, slot_id: str) -> None` | Yes | Remove a slot. No error when it is already gone. |
| `async def get(self, key: str) -> bytes \| None` | Yes | Return the value stored under `key`, or `None`. |
| `async def set(self, key: str, value: bytes, ttl: float \| None, mode: SetMode = "always") -> bool` | Yes | Store `value` under `key`. `mode` is `"always"`, `"if_absent"` or `"if_greater"`. Return `True` when it wrote. |
| `async def delete(self, key: str) -> None` | Yes | Remove `key`. No error when it does not exist. |
| `def describe(self) -> str \| None` | No | Say where the store lives (for example `host:port`) for logs and startup checks. Never include credentials. Return `None` when there is nothing useful to name. |
| `async def aclose(self) -> None` | No | Release resources. Called once on app shutdown. |

`SetMode` is `Literal["always", "if_absent", "if_greater"]`.

## Rules a custom store must keep

The contract suite (`tenxgraph_api.testing.cache_store_contract`) checks these rules.

- **`acquire` is atomic.** Drop expired slots, and only if the live count is below `limit`, add a new slot expiring at `now() + ttl`. Two callers can never both take the last slot. `limit < 1` always denies.
- **A denied `acquire` adds nothing.** The rate limiter relies on this: a client over its limit does not extend its own penalty.
- **`renew` never re-creates a slot.** It returns `False` when the slot expired or was released.
- **`release` of a missing slot is not an error.**
- **`set(mode="if_absent")`** writes only when the key does not exist.
- **`set(mode="if_greater")`** treats the value as a decimal number and writes only when it is greater than the stored one, or nothing is stored. It is atomic. Token revocation uses it so an older cutoff never overwrites a newer one. A value that is not a decimal number raises `ValueError`.
- **`ttl` is in seconds and must be positive.** `set(ttl=None)` keeps the key until it is deleted. A write replaces the TTL of the key it writes.
- **TTLs are never dropped early.** A key or slot must not disappear before its TTL. A store that evicts data under memory pressure breaks locks: two workers run the same thread. For Redis this means `maxmemory-policy` must be `noeviction` or a `volatile-*` policy. Any other policy is a deployment mistake.
- **Every method touches exactly one key.** That keeps the store safe on Redis Cluster and on sharded stores.
- **Raise on errors.** When the backend fails, raise any exception. The features decide whether to fail open or closed. The store never swallows errors.
- **Use the store's clock.** All times come from `now()`, so pods with skewed clocks agree on when a slot expires.

Keys arrive as `"<feature>:<id>"`, for example `concurrency:runs:thread:42`. The store may map the feature segment to its own namespace and add a deployment prefix, but two different keys must never land on the same entry, and any string (with `:`, spaces or unicode) is a valid key. A key holds either slots or a value, never both.

## See also

- [Bring your own backend](/docs/server/bring-your-own-backend): the skeleton, the contract test suite and the `aping()` rules
- [Rate limiting reference](/docs/reference/api-cli/rate-limiting): how the limiter uses the cache store
- [Configuration reference](/docs/reference/api-cli/configuration): all `10xgraph.json` keys
