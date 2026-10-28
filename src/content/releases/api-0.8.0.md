---
package: api
version: "0.8.0"
date: 2026-10-16
summary: Security and scalability pass. Ownership checks fail closed, authorization defaults to ownership whenever auth is set, and production defaults are stricter. Read the breaking list before upgrading.
breaking: true
---

Security and scalability pass over the API, following an external review. This release has breaking changes: read the **Breaking** list before upgrading.

### Breaking

- **Ownership checks fail closed.** With auth on, an ownership or `rbac` authorization backend now refuses to start on a checkpointer that cannot resolve thread owners (`aget_thread_owner` not implemented), and denies thread requests if none is available at runtime. Implement `aget_thread_owner`, or set `"authorization": "allow_all"` or a custom backend.
- **An unowned thread only allows actions that create it** (`graph:invoke`, `graph:stream`, `checkpointer:write`). Reading, deleting, stopping or fixing a thread that does not exist, or has no owner, now answers 403 instead of an empty result.
- **Authorization defaults to `ownership` whenever auth is configured**, in every mode. It used to be `allow_all` unless `MODE=production`. Set `"authorization": "allow_all"` to keep the old development behaviour.
- **Realtime init frames can no longer replace the system prompt by default.** Add `"system_prompt"` to `websocket.realtime_client_overrides` to allow it.
- **`trusted_proxy_headers: true` without `trusted_proxies` trusts only loopback and private networks**, not every peer. List your proxy networks (or `0.0.0.0/0` and `::/0`).
- **Production defaults:** `MEDIA_REQUIRE_OWNER` is on, `graph_introspection` is `scoped` (graph structure, tools and state schema need the `graph:read` scope), and `IS_DEBUG` is forced off.
- **`/v1/graph/invoke` no longer returns `meta.thread_name`.** The name is generated in the background and appears on the thread (`GET /v1/threads`).
- **Production 4xx responses keep their message.** Only 5xx are made generic. A 422 built from an unexpected `ValueError` is still made generic.
- **`gunicorn` is no longer a dependency.** The generated Dockerfile installs it, so `10xgraph build` images are unaffected. If you run `gunicorn` yourself outside that image, install it alongside the API: `pip install gunicorn uvicorn-worker`.
- **Gunicorn's worker class is now `uvicorn_worker.UvicornWorker`** (from the `uvicorn-worker` package). `uvicorn.workers.UvicornWorker` is deprecated in uvicorn. Regenerate the Dockerfile and compose file with `10xgraph build --force`, or change `-k` in your own command.
- **`POST /v1/graph/fix` returns `state` as a JSON object.** It used to be a JSON-encoded string. Drop any `JSON.parse` or `json.loads` on that field. The TypeScript client already types it as an object.
- **Generated Dockerfiles install only the dependencies you list.** The `pyproject.toml` path no longer adds `10xgraph-api` on top of your list. `10xgraph build` warns when the requirements file or `pyproject.toml` does not list `10xgraph-api`.

### Added

- **`runs` key in `10xgraph.json`:** `thread_ids` (`client` or `server`), `config_keys` and `state_keys` allow-lists, `max_concurrent_per_user` (default 10) and `timeout`.
- **`token_revocation` key** (`redis`, `memory` or `module:attr`) and the `TokenRevocationBackend` hook. Revoked tokens are refused before they expire, on HTTP and on every WebSocket run.
- **`graph_introspection` key** (`open` or `scoped`).
- **`websocket.realtime_client_overrides` allow-list.**
- **`STRICT_PRODUCTION_CHECKS=true`:** production refuses to start on wildcard `ALLOWED_HOST` or `ORIGINS`, or enabled API docs.
- **`GET /health/ready` readiness probe** (checkpointer, Redis, store). The Kubernetes manifest uses it.
- **Run and WebSocket connection caps are shared across workers through Redis** when it is configured.

### Changed

- `10xgraph play` and `10xgraph dev` open the hosted playground at its new address, `https://play.10xgraph.com`. The previous address, `playground-463bd.web.app`, still serves the same app for older releases.
- Thread delete leaves a short tombstone so a deleted id cannot be handed to another user while other workers still cache the old owner.
- Every thread the API saves records its owner, which fixes owner lookups on the in-memory and SQLite checkpointers.
- WebSocket JSON frames over `MAX_REQUEST_SIZE` are refused (close 1009).
- Request ID, security headers and rate limiting are pure ASGI middleware. CORS is now the outermost layer, so 429, 413 and Host rejections are readable by browsers.
- Route-set security headers, such as the download sandbox CSP, are no longer overwritten.
- The JWT is verified once per request when rate limiting by user.
- Local-store downloads stream from disk. Uploads are read into memory once.
- JSON responses are serialized by pydantic-core instead of orjson. The `orjson` and `platformdirs` dependencies are dropped, and the `uvicorn` floor is now 0.36.
- Generated Dockerfiles build in two stages. Dependencies go into a virtualenv in a builder stage, and only that virtualenv and your code reach the runtime image, which has no compiler or curl.
- A requirements file in a subfolder (for example `requirements/base.txt`) keeps its path in the generated Dockerfile.
- `license` is an SPDX expression (`MIT`). Building from source needs setuptools 77 or later.

### Security

- **Log injection.** Values a client controls (user and thread ids, file ids, rate-limit keys, request paths, run config and messages) are written to logs through `log_safe()`, which escapes CR and LF, so a request cannot forge extra log lines.
- **ReDoS in the log sanitizer.** The JWT detection pattern backtracked polynomially on crafted input. It now matches in linear time.
- **Security examples.** `examples/security/` no longer prints any part of an API key or of the JWT secret. The API key example hashes keys with HMAC-SHA-256 and a server-side `API_KEY_PEPPER`. Hashes made with the previous example's plain SHA-256 must be regenerated.
