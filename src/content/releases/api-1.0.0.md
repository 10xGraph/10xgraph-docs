---
package: api
version: "1.0.0"
date: 2026-11-16
summary: The first stable release of the API server and CLI. HTTP API, CLI and 10xgraph.json keys do not break before 2.0. Lists every change since rc6; there was no rc7.
breaking: true
---

The first stable release of `10xgraph-api`. From 1.0 the HTTP and WebSocket API, the CLI and the `10xgraph.json` keys do not break before 2.0, and anything removed is deprecated first: see [Stability and deprecation policy](/docs/project/stability). The deprecated `agentflow` names keep working until 2.0.

```bash
pip install -U 10xgraph 10xgraph-api
```

Requires `10xgraph` 1.0. There was no 1.0.0rc7 of this package, so these notes cover every change since 1.0.0rc6. Coming from 0.9, read the [upgrade guide](/docs/project/upgrade-to-1.0) first.

### Breaking

- **`thread_name_generator` defaults to none.** New threads are saved without a name. Set `"random"` to keep the old behaviour. The value must be `none`, `random`, `first_message` or `module:attribute`; `AIThreadNameGenerator` and `DefaultThreadNameGenerator` are replaced by `RandomThreadNameGenerator`.
- **`runs.state_keys` denies by default.** Clients may set only the state keys it lists, in `initial_state`, `PUT /v1/threads/{id}/state` and AG-UI `state`; any other key is a 422. **Migration:** list every key your clients send, for example `"runs": {"state_keys": ["preferences"]}`.
- **`BaseAuth.authenticate` is async.** Change `def authenticate` to `async def authenticate` in custom auth classes.
- **With `cache_store.token_revocation` on, every token needs a `jti`.** A token without one answers 401 `INVALID_TOKEN`. **Migration:** issue tokens with a `jti` claim, or turn revocation off.

### Changed

- **`MAX_NESTING_DEPTH` setting** (default 64, range 1 to 900) for client messages, `initial_state`, `config`, `resume` and `filters`.
- **The audit log has `input` and `rate_limit` events** (422 and 413 refusals, 429 and limiter outages).
- **`10xgraph init`** writes `>=1.0,<2.0` ranges, and the Full setup writes `"thread_name_generator": "first_message"`. `10xgraph audit` and `10xgraph config` know the new values.

### Fixed

- **`meta.is_new_thread` is correct on a continued thread** (with `10xgraph` 1.0.0).
- **`10xgraph init` Quick setup writes a `requirements.txt`**, so `10xgraph build` installs the provider SDK.
- **Auth errors are clean 401s.** A missing tenant claim, a malformed roles or permissions claim, a reserved `__system__` user id and a missing credential answer 401 `INVALID_TOKEN`. Expected 401s log one WARNING line.
- **Text the database refuses answers 422.** A NUL character or lone surrogate in client input is refused before the run, and a `StorageError` from data Postgres refuses answers 422 `INVALID_REQUEST_DATA` instead of 500.
- **AG-UI refuses a client tool named like a server tool** (422).
- **File uploads:** the stored filename is cleaned, two `file` parts are refused, an upload without the `media` extra under `extract_text` answers 422, and `GET /v1/files` on a cloud store answers 501 for reach `tenant` or `all`.
- **`MEDIA_STORAGE_TYPE=cloud`** imports from the right `cloud-storage-manager` modules.
- **`10xgraph dev` falls back to `agentflow.json` again** when `10xgraph.json` is missing.
