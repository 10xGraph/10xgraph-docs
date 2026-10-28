---
package: api
version: "1.0.0rc1"
date: 2026-10-28
summary: The 1.0 release candidate. Secure-by-default threads, production startup checks and error handling, plus resume, run-busy and file-lifecycle features. Breaking changes included.
breaking: true
---

The 1.0 release candidate. Pip skips it unless you pass `--pre`:

```bash
pip install -U --pre "10xgraph-api==1.0.0rc1"
```

It requires `10xgraph` 1.0 and pulls `10xgraph` 1.0.0rc1. From 1.0 the three packages share major.minor, and patch numbers move independently. This release has breaking changes: read **Breaking** and the [upgrade guide](/docs/project/upgrade-to-1.0) before upgrading.

### Breaking

- **`runs.thread_ids` defaults to `"server"`** (was `"client"`). REST and WebSocket clients that invent a thread id for a new thread get 403 on `/v1/graph/invoke`, `/v1/graph/stream`, `/v1/graph/ws` and the checkpointer write routes. **Migration:** omit the id on the first request and use the `meta.thread_id` the server returns from then on (`"new"` over `/v1/graph/ws`), or set `"runs": {"thread_ids": "client"}` in `10xgraph.json`. AG-UI and `/v1/graph/live` need no change.
- **Production deployments with the default or wildcard `ALLOWED_HOST` or `ORIGINS` refuse to start.** **Migration:** set explicit values, or `STRICT_PRODUCTION_CHECKS=false`. A public, token-less API in production with `ORIGINS=*` and `CORS_ALLOW_CREDENTIALS=false` also needs the opt-out.
- **Production runs longer than 300 s are cancelled** (invoke 504, stream and AG-UI error). **Migration:** raise `runs.timeout`, or set it to `null`.
- **An unknown `MODE` refuses to start,** including in `10xgraph dev`. **Migration:** use `production`, `prod`, `development`, `dev` or `local` (case-insensitive).
- **Requests over the size limits get 422:** 500 messages, 100 blocks per message, 1,000,000 characters of text. On AG-UI the limits apply to the trailing turn, with a 10,000-message cap on history.
- **`POST /v1/threads/{thread_id}/messages` is admin-only.** It needs the `checkpointer:import` scope held explicitly; an identity with no scopes gets 403. **Migration:** send normal messages through invoke or stream, and use the new `PUT .../messages/{message_id}` for feedback.
- **Assistant and system messages, and `context_summary` and `execution_meta`, are rejected with 422** on the client routes.
- **Custom authorization backends are isolated by default.** A backend that implements only `authorize()` now gets per-owner storage isolation. **Migration:** if you relied on sharing, add `def isolation_scope(self) -> str: return "none"`.
- **JWTs with an invalid `user_id` or scope claim are refused with 401.** `user_id` must be a non-empty string or an integer. A `scope` or `scopes` claim must be a string or a list of strings, and a string `scopes` is split on spaces instead of matched by substring. **Migration:** fix the issuer.

### Added

- `observability.user_id_mode` in `10xgraph.json` (`"raw"` default, `"hash"`, `"mask"`) controls how the user id appears in traces.
- `on_busy` request option (`"wait"` default, or `"cancel"`) on invoke, stream and `WS /v1/graph/ws`. With `"cancel"`, a run that finds its thread busy asks the running run to stop, then runs.
- Uploaded files live and die with the messages that use them. Deleting the last message or the thread that uses a file deletes the file. `media.delete_with_thread` (default `true`) turns the automatic delete off.
- `DELETE /v1/files/{file_id}` deletes a file you own, behind the new `files:delete` scope.
- `PUT /v1/threads/{thread_id}/messages/{message_id}` sets feedback on a message.
- `interrupt_id` on invoke, stream and WebSocket input, so a resume can name the interrupt it answers. WebSocket input also accepts `resume` again.
- `RequirePermission(..., explicit_scope=True)` and the `checkpointer:import` scope.

### Security

- Handled client errors log one WARNING line instead of an ERROR with a traceback, and Sentry no longer sends request bodies. **Migration:** alerts that matched ERROR for 4xx must match WARNING.
- AG-UI context, tools and forwarded props are server config, and `ag_ui` is a reserved key that other routes drop.
- Built-in state fields are never client-writable, client messages are user messages only, forged tool results are refused, and the server generates message ids on invoke, stream, WebSocket and `PUT state` (AG-UI keeps client ids).
- Thread ids are server-made by default, so nobody can squat an id or probe whether one exists.
- A client can no longer pick the vector store collection on a graph run: `collection` is a server-owned config key.
- Clients can no longer set `file_tool_root`, `workspace_root`, `tool_timeout` or `node_timeout` in request `config`; set them in your graph.
- `/v1/graph/live` re-checks the token during the session, and HTTP routes take the bearer token only from the `Authorization` header.
- One run at a time per thread, and external media URLs, upload types and document text extraction are checked or bounded.
- Production hides raw error text on state, stream, WebSocket and AG-UI, and OTEL no longer prints spans to stdout.
- Generated deployment files are locked down by default, and `10xgraph init` writes a `.gitignore` that keeps `.env` and credentials out of git.

### Fixed

- Client mistakes on thread routes are a 404 or 422, not a 500, and state and message responses no longer carry provider or framework internals.
- Development error responses for node and graph errors are no longer a 422 `VALIDATION_ERROR`.
- `POST /v1/graph/fix` no longer deletes healthy tool-call messages.
