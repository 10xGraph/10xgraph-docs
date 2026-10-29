---
slug: project/upgrade-to-1.0
title: Upgrade to 1.0
seoTitle: "Upgrade 10xGraph to 1.0: breaking changes"
description: Migration guide from 10xgraph 0.10, 10xgraph-api 0.9 and 10xgraph-client 0.6 to 1.0, with every breaking change grouped by package and what to do about it.
section: Project
order: 20
label: Upgrade to 1.0
updated: "2026-10-29"
---

1.0 is the release where the public API is stable under a deprecation policy. The core
(`10xgraph`) and the API server (`10xgraph-api`) contain breaking changes, most of them
secure-by-default behaviour that now refuses what used to be allowed. The TypeScript client
(`10xgraph-client`) has one breaking change (Node.js 20 or later) and a few behaviour changes. Work through the sections for the packages you run before
upgrading a deployment.

This page covers 0.10.x (core), 0.9.x (API) and 0.6.x (client). If you are on 0.8 or earlier,
read [Upgrade to 0.9](/docs/project/upgrade-to-0.9) first.

## Install the release candidate

1.0 ships first as a release candidate. Pip skips pre-releases unless you pass `--pre`, and the
client candidate is published under the `next` dist-tag.

```bash
pip install -U --pre "10xgraph==1.0.0rc1" "10xgraph-api==1.0.0rc1"
npm install 10xgraph-client@next
```

`npm install 10xgraph-client` still installs 0.6.0 until 1.0.0 is released. `10xgraph-api`
1.0 requires `10xgraph` 1.0.

## Versioning from 1.0

- `major.minor` is identical across `10xgraph`, `10xgraph-api` and `10xgraph-client`.
  `10xgraph` 1.1.x works with `10xgraph-api` 1.1.x and `10xgraph-client` 1.1.x.
- Patch numbers are independent. A patch is only a bug or security fix.
- A new feature means all three packages release the next `X.Y.0` together.
- A public API is removed only in a major release, after at least one minor of deprecation.

---

## Core (`10xgraph`)

### Removed APIs

- **The graph-level memory API is gone** (`MemoryIntegration`, `create_memory_preload_node`,
  `get_memory_system_prompt`, `memory_tool`). Pass `Agent(memory=MemoryConfig(...))`.
- **`fetch_and_cache` is gone** from `tenxgraph.storage.media.temp_cache`. Download through
  `fetch_media_url` with a `MediaFetchPolicy`.
- **The old example folders and the `a2a_sdk` example are removed.** Use the reorganised
  `examples/` folders.

### Stores and memory

**Who is affected:** anyone using `QdrantStore`, `Mem0Store`, `Agent(memory=...)` or `RAGAgent`.

- **A missing or empty `user_id` now raises `ValueError`** on store operations. Pass a concrete
  `user_id`, or `system_user_id(name)` for shared data. Re-index records written with an empty
  owner.
- **`RAGAgent` searches as `system_user_id("knowledge_base")`** unless `store_config` sets
  `user_id`. `store_config_builder` output must include `user_id`.
- **Agent memory is owned by `system_user_id(agent_id)` (or `app_id`), not the current user.**
  `Agent(memory=...)` raises `ValueError` if agent memory is on with neither id. Memories
  written under a user by the old behaviour are not found, so re-store them.
- **A `collection` in the run config no longer overrides the memory scope's collection.** Set
  `collection` on `UserMemoryConfig` or `AgentMemoryConfig`.
- **`PRELOAD` memories are no longer a system message.** They arrive as a fenced block in the
  latest user message of each request and are never saved to `state.context`.
  `Agent._build_memory_prompts` is replaced by `Agent._build_memory_block`. Update prompts or
  tests that look for `[Long-term Memory Context]`.
- **`RAGAgent` puts retrieved documents in a request-only block** and no longer rewrites
  `state.context`. `execution_meta.internal_data["rag_docs"]` and `_RAG_DOCS_KEY` are gone. A
  custom agent passed to `RAGAgent` must accept the keyword-only `request_blocks` argument on
  `execute`, or `RAGAgent` raises `TypeError`.
- **Skill and memory text is no longer run through `str.format`.** Only your own
  `system_prompt` is interpolated, and a bad placeholder is logged instead of failing the run.
  Remove any reliance on `{placeholder}` expansion inside skill or memory text.
- **`aforget_memory` differs by store.** `QdrantStore` applies `memory_type`, `category` and
  `filters`. `Mem0Store` raises `ValueError` if any of them is passed. The `qdrant` extra needs
  `qdrant-client>=1.10.0` and a Qdrant server 1.10 or newer.

### Tools and handoffs

- **Tool arguments use lax coercion.** `"5"` for an `int` becomes `5`, and a number for a `str` becomes a string. A value that cannot convert goes back to the model as a failed tool result and the tool does not run. Unknown extra keys are ignored.
- **`pass_user_info_to_mcp` sends the user dict as request metadata (`meta`),** not as a `user` tool argument. An MCP server that read a `user` argument must read `ctx.request_context.meta`. A warning is logged if the client's `call_tool` has no `meta` parameter.
- **New `ToolNode` options, off by default:** `max_result_chars`, `mcp_include` and `mcp_exclude`. `ToolNode` warns when a different callable replaces a tool of the same name, and accepts a generator of tools.
- **Factory tools bind their targets at creation:** `create_vertex_ai_search(datastore, model)`, `create_google_web_search(model)` and `create_fetch_url(allowed_hosts)`. The allow-list is checked on every redirect hop. The module-level `file_read`, `file_write` and `file_search` still work but warn; they are removed in 2.0, so use `create_file_tools`.
- **File tools:** overwrite is atomic and create is exclusive. The deny list adds `.git-credentials`, `*.tfstate`, `*.tfstate.*` and `*.tfvars`. Error text no longer leaks paths.
- **`PromptInjectionValidator` is less noisy and leaks less:** persona patterns are upper-case only, emoji and CJK no longer trip the special-character rule, hex digests are not flagged, and keywords match whole words. Error details carry `pattern_index` instead of the regex or a sample of the input. The production template validator no longer blocks `bypass`, `override`, `disable`, `token` or `free`, and its max length is 10000.
- **Client-visible error text shows only the exception type** for exceptions that are not 10xGraph's own (stream `ERROR` chunk `reason` and `state.error`). Logs keep the full text. `err.context` keeps the real values.
- **`@tool("name")` works as the name form, and `@tool` works on bound methods.**

- **A `ToolNode` lists its MCP server's tools once.** The list is cached for the life of the node (`mcp_cache_tools=True`), which saves a connect, ping and list call per model call. Tools you add to the server later, and tools you remove, are not seen until you call `await tool_node.refresh_mcp_tools()`. If your server changes its tools while the process runs, build the node with `mcp_cache_tools=False` to list on every model call. A failed listing is never cached.
- **More `ToolNode` options for MCP, all optional:** `mcp_prefix`, `mcp_max_result_chars`, `mcp_max_description_chars`, `mcp_cache_tools` and `mcp_connect_timeout`. The connect timeout defaults to 30 seconds, so an MCP server that takes longer than that to accept a connection fails the call. Pass `mcp_connect_timeout=None` to wait without a limit. See [Tools](/docs/reference/python/tools).

- **Handoffs need a registered handoff tool.** A `transfer_to_<X>` call only jumps if a tool
  made with `create_handoff_tool` is on that `ToolNode`. A `Command.goto` to an unknown node
  raises `GraphError` (`GRAPH_007`). `SwarmAgent` now enforces `can_handoff_to`.
- **Tools hidden by `tools_tags` can no longer be called.** Add the tag or the tool if the call
  was intended.
- **An MCP tool with the same name as a local or remote tool raises `ValueError`.** Rename one
  of them.
- **Parallel tool calls are capped at 10 per turn.** Set `max_parallel_tool_calls` in the run
  config, or `TENXGRAPH_MAX_PARALLEL_TOOL_CALLS`, to change it.
- **Unexpected tool errors no longer reach the model verbatim.** The model sees
  `Tool '<name>' failed with an internal error (reference <ref>)` and the full error is logged.
  To show a message to the model, return it as a string. A raised `ValueError` is no longer
  shown.
- **A tool call with invalid JSON arguments is answered with a tool error** instead of running
  with empty arguments.
- **Tool metrics label unknown tools as `"unknown"`** instead of the model-invented name.
- **File tools refuse secret files** (`.env`, keys, `.ssh`, `.aws`, `.git` and similar) for any
  root, and `file_search` stays inside the root. Change the list with
  `create_file_tools(root, deny=..., use_default_deny=False)`. Prefer
  `create_file_tools(root=...)` to the run-config root, which is deprecated and will be removed
  in 2.0.
- **`fetch_url` no longer follows redirects to internal addresses or uses `HTTP_PROXY` and
  `HTTPS_PROXY`.** Fetches that relied on a proxy or an internal redirect now fail.

### Publishers and multi-agent

- **Background work is best-effort.** Sync `invoke()` and `stream()` wait up to `shutdown_timeout` (30 s) for pending events, memory writes and thread naming. `ainvoke()` and `astream()` do not wait: call `await graph.aclose()` before exit. At most 1000 background tasks can be pending; beyond that new ones are dropped (WARNING at most every 5 s, counter `background_task_manager.tasks_dropped`). Delivery is at-most-once with no retry.
- **Sync calls inside a running event loop raise `RuntimeError`.** `invoke()`, `stream()`, `stop()` and sync checkpointer methods such as `get_state()` name the async method to use. Async id factories (`AsyncIDGenerator`) now work.
- **A run refused while the graph is closing** sends a terminal error chunk with `data.code = "SERVICE_UNAVAILABLE"` and `retry_after_seconds`, and no `done` chunk. A WebSocket then closes with 1012.
- **Queued events are snapshots,** so consumers see the real `START` and `PROGRESS` events. LLM failures publish an `ERROR` event. Kafka and Redis publishers retry after a failed first start. The optional `publish_timeout` config key bounds one send and has no default.
- **A streaming LLM span ends when the stream ends.** The `LLM_CALL` `END` event is published after the last chunk, with `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens`, `reasoning_tokens`, `finish_reason` and `response_model`. A stream that fails publishes `ERROR` instead. The duration and token counts that tracing backends show for streaming calls now cover the whole stream, so dashboards and alerts built on those numbers will change. See [LLM span events](/docs/reference/python/publishers#llm-span-events).
- **Large `data["state"]` is replaced by a summary in published events.** When the state is longer than `state_snapshot_limit` JSON characters (publisher config, default 65536), consumers get `{"truncated": true, "bytes", "fields", "context_count", "context", ...}` instead of the full state. A consumer that reads message text from `data["state"]` needs a higher limit, or `0` or `None` to turn the summary off. See [Large state snapshots](/docs/reference/python/publishers#large-state-snapshots).
- **`RabbitMQPublisher` honors `publish_timeout`,** and `connection_timeout` (default 10 s) now also bounds opening the channel and declaring the exchange. If a broker accepts the connection but stalls there, that publish fails after 10 seconds, the connection is closed, and the next publish starts clean.
- **Swarm member names match case-insensitively,** and names that differ only in case raise `ValueError`. Supervisor `FINISH` matches only as a whole word. A RAG reranker error falls back to the retriever's order.

### Runs and resume

- **Multi-agent loop limits are per turn.** `max_rounds`, `max_iterations` and `max_attempts`
  reset on each new turn instead of being a lifetime budget per thread.
- **Resume is checked.** A `resume_interrupt_id` that is not the pending interrupt's raises
  `InterruptMismatchError`, and a value that fails the interrupt's `response_schema` raises
  `ResumeValidationError`. A `resume` sent to a thread that is not paused raises
  `NothingToResumeError` (`INTERRUPT_003`), and a plain new message sent to a thread paused at
  `interrupt()` raises `InterruptPendingError` (`INTERRUPT_004`). The API answers 409 for both.
- **There are no default node or tool timeouts.** `node_timeout` and `tool_timeout` are off until
  you set them, and a value you set applies to both invoke and stream. Streaming runs also use
  the tool ledger now.
- **Realtime tool calls are deduplicated per thread.** A call replayed after a reconnect, or repeated by a new session on the same thread, returns the recorded result and does not run the tool again. The key is the thread id, a hash of the tool name and arguments, and the provider call id. This needs a checkpointer on the session. `GeminiLiveClient` also takes `connect_timeout` (default 30 s), so a connect that hangs fails after 30 seconds. See [Tool call deduplication](/docs/reference/python/realtime#tool-call-deduplication).
- **New opt-in LLM limits, all off by default:** `stream_idle_timeout` (per agent, `set_default_stream_idle_timeout()` or `TENXGRAPH_LLM_STREAM_IDLE_TIMEOUT`; a stalled stream raises `LLMStreamIdleTimeoutError`) and the cross-process cap on `RetryConfig` (`distributed_max_concurrent_calls` and related fields; it fails open with a WARNING when Redis is down). See [Errors and limits](/docs/concepts/errors-and-limits).
- **`LiveAgent.arun()` raises `RuntimeError` when the same instance already runs a session.** `arealtime()` runs each connection on its own copy (`LiveAgent.new_session()`). If you call `arun()` yourself, give each concurrent session its own `new_session()`.
- **A stop request is saved as `StopRequestStatus.STOPPED`.** Code that checks `execution_meta.stop_current_execution` for `STOP_REQUESTED` after a stop must also accept `STOPPED`.
- **`mem0ai` is bounded to `>=2.0,<3`.** mem0ai 1.x is no longer supported.
- **A cancelled or crashed run leaves a usable thread.** A new message after a cut-off run starts
  a new turn. `await graph.aclose(grace, stop_timeout, timeout)` ends active runs in phases, and
  new runs raise `GraphClosedError`. Nothing installs signal handlers unless you call
  `install_shutdown_signals(graph)`. See [Graceful shutdown](/docs/guides/graceful-shutdown).
- **A stream `after_invoke` callback cannot redact output that was already streamed.** What it
  returns is used for the saved result only.
- **`PromptInjectionValidator` behaves differently.** Non-strict mode scans only the first
  `max_length` characters, strict mode raises on bad base64, and text in other languages is no
  longer rejected.

### Media and storage

- **Client-supplied media URLs are fetched under a `MediaFetchPolicy`:** only `http` and
  `https` to public hosts, 20 MB, 10 s, and `image/*` and `application/pdf` by default. Audio
  and video links on Google graphs stop downloading until you allow those content types with
  `compile(media_policy=MediaFetchPolicy(...))`. The private `_convert_to_google_format` no
  longer downloads.
- **Anthropic thinking blocks are stored first in the message and replayed unchanged.**
  `ReasoningBlock` gains `signature` and `redacted_data`. Code that reads `message.content`
  and assumed thinking could follow text now sees it first. Messages saved before 1.0 carry no
  signature and are not replayed to Anthropic. Other providers never receive these blocks.
- **Cloud media stores keep a per-owner index.** `GET /v1/files`, per-user quotas and release on
  thread delete now work on S3 and GCS, but only for files stored with 1.0 or later and with an
  owner. A custom `BaseMediaStore` inherits `modify_metadata` (not atomic) and
  `list_keys_for_owner` (built on `list_keys`). A media folder shared by workers now holds a
  `.meta.lock` file.
- **`CloudMediaStore` raises `ValueError` for storage keys that are not 32 lowercase hex
  characters.** Objects stored under other keys by custom code are no longer reachable through
  the store.
- **Local media and the SQLite checkpointer create owner-only files** (`0o700` folders, `0o600`
  files). Other OS users or services that read them lose access. Widen the mode yourself if
  that is intended.

### Checkpointers

- **`alist_messages` and `alist_threads` raise `ValueError` for a negative `limit` or
  `offset`,** and an explicit `limit` is lowered to `MAX_LIST_LIMIT` (1000).
- **Checkpointers apply the owner rule to state-cache writes,** and the in-memory checkpointer
  returns copies of state, so mutating a loaded state no longer changes the store until you
  save it.
- **`PgCheckpointer` schema version 4.** See [Database migration](#database-migration).
- **The checkpointer's Redis pool is capped at 50 connections** and a caller past the cap waits up
  to 5 s for a free one, instead of opening a new connection. Raise `max_connections` or
  `timeout` through `redis_pool_config` if a busy worker needs more.
- **A thread stored at a node the graph no longer has fails with `StoredNodeMissingError`**
  (`GRAPH_NODE_MISSING_001`, API 409), naming the node and the thread. After renaming a node, add
  `compile(node_aliases={"old": "new"})`. Stored state written by a newer version raises
  `StateFormatVersionError` (`STATE_FORMAT_001`, API 500), so roll forward instead of back.

---

## API server (`10xgraph-api`)

### Threads and clients

- **`runs.thread_ids` defaults to `"server"`** (was `"client"`). REST and WebSocket clients that
  invent a thread id for a new thread now get 403 on `/v1/graph/invoke`, `/v1/graph/stream`,
  `/v1/graph/ws` and the checkpointer write routes. Omit the id on the first request and use
  the `meta.thread_id` the server returns from then on (`"new"` over `/v1/graph/ws`), or set
  `"runs": {"thread_ids": "client"}` in `10xgraph.json`. Only the built-in ownership and rbac
  backends refuse.
- **AG-UI and `/v1/graph/live` follow `runs.thread_ids` too.** Under the default `"server"`, an
  AG-UI `threadId` the server never issued gets 403, and a live `thread_id` it never issued gets
  an error event with code `not_authorized` and close 1008. A blank or `"new"` id, or none, makes
  the server create the thread: AG-UI returns the id in `RUN_STARTED`, and live sends
  `{"type": "session_started", "thread_id": "..."}` as its first server event. Frontends that
  make their own ids (CopilotKit does by default) must set `"runs": {"thread_ids": "client"}`.
  The TypeScript client reads the live id into `session.threadId`, which is `string | null`
  until `session_started` arrives.
- **Client dicts and lists have size caps:** 1000 keys per object, 10000 items per list and
  200000 values in all, beside the 64-level depth cap. A larger body gets 422. The thread id
  rule now also covers the WebSocket `config.thread_id`, the live init frame and the AG-UI
  `threadId`.
- **Upload bodies are parsed after authentication,** and an upload with no `file` part answers
  422.
- **New opt-in settings, nothing to do unless you want them:** `Idempotency-Key` on invoke,
  stream and AG-UI (`idempotency_key` in the WebSocket run frame, `IDEMPOTENCY_TTL_SECONDS`),
  `JWT_SECRET_KEYS` for key rotation and `JWT_MAX_TOKEN_AGE_SECONDS`.
- **Requests over the size limits get 422:** 500 messages, 100 blocks per message, 1,000,000
  characters of text. On AG-UI the limits apply to the trailing turn, with a 10,000-message cap
  on history.
- **Assistant and system messages, and `context_summary` and `execution_meta`, are rejected
  with 422** on the client routes.
- **`POST /v1/threads/{thread_id}/messages` is now admin-only.** It needs the
  `checkpointer:import` scope held explicitly: an identity with no scopes gets 403, and a `"*"`
  role has it. Send normal messages through invoke or stream, and use the new
  `PUT .../messages/{message_id}` for feedback.

### Production startup and timeouts

- **Production deployments with the default or wildcard `ALLOWED_HOST` or `ORIGINS` refuse to
  start.** Set explicit values, or `STRICT_PRODUCTION_CHECKS=false`. A public, token-less API
  that runs in production with `ORIGINS=*` and `CORS_ALLOW_CREDENTIALS=false` also needs the
  opt-out.
- **An unknown `MODE` refuses to start,** including in `10xgraph dev`. Use one of `production`,
  `prod`, `development`, `dev`, `local` (case-insensitive). Values such as `staging` or `test`
  fail at startup.
- **`IS_DEBUG` is removed.** Debug mode follows `MODE`: on in development, off in production. A
  leftover `IS_DEBUG` in the environment is ignored with a warning.
- **Production runs longer than 300 s are cancelled** (invoke 504, stream and AG-UI error).
  This is the API's `runs.timeout`, which still defaults to 300 s in production and to no limit
  in development. Raise it, or set it to `null`. Only the core tool and node timeouts
  (`tool_timeout`, `node_timeout`) lost their defaults.

### Auth and authorization

- **Custom authorization backends are isolated by default.** A backend that implements only
  `authorize()` now gets per-owner storage isolation. If you relied on sharing, add
  `def isolation_scope(self) -> str: return "none"`.
- **JWTs with an invalid `user_id` or scope claim are refused with 401.** `user_id` must be a
  non-empty string or an integer. Null, empty, boolean, float, list and dict are rejected. A
  `scope` or `scopes` claim that is not a string or a list of strings is rejected, so fix the
  issuer. A string `scopes` is now split on spaces instead of matched by substring.
- **`JWT_ALGORITHM` must be on an allowlist** (`HS256`, `HS384`, `HS512`, `RS256`, `RS384`,
  `RS512`, `ES256`, `ES384`, `ES512`, `PS256`, `PS384`, `PS512`, `EdDSA`). `none`, an empty value
  or any other value stops startup. Startup also stops if PyJWT is missing with `"auth": "jwt"`,
  and the `auth` value must be exactly `"jwt"`.
- **`graph:setup` is gone from the scope list.** The setup endpoint no longer exists.
- **Graph validation errors use the code `VALIDATION_ERROR`.** The duplicate `AGENTFLOW_VALIDATION_ERROR` is gone; match on `VALIDATION_ERROR`.
- **A run that hits its recursion limit answers 422 (`GRAPH_RECURSION_LIMIT`),** not 500.
- **`POST /v1/graph/stream` is labelled `application/x-ndjson`,** not `text/event-stream`. The body was always newline-delimited JSON, so a client that parsed it as NDJSON is unaffected; one that selected on the content type must change.
- **`10xgraph build` refuses `--docker-compose` together with `--k8s`.** The combined image had no start command. Run it once for each target.
- **Uploads are checked against default limits:** images over 50,000,000 pixels and PDFs over 10 MB or 500 pages answer 413 (`MEDIA_MAX_IMAGE_PIXELS`, `MEDIA_MAX_PDF_MB`, `MEDIA_MAX_PDF_PAGES`). Per-user quotas (`MEDIA_MAX_FILES_PER_USER`, `MEDIA_MAX_USER_STORAGE_MB`) are off by default.
- **The generated Gunicorn command uses `TenxGraphUvicornWorker`** (`tenxgraph_api.src.app.uvicorn_worker.TenxGraphUvicornWorker`). Regenerate Docker and Kubernetes files with `10xgraph build`, or point your own command at it. Keep the Gunicorn `--graceful-timeout` above the sum of the three `SHUTDOWN_*_SECONDS` settings (50 s by default) and the pod grace period above that.
- **Nested `initial_state`, `config` and `resume` deeper than 64 levels get 422**
  (`VALIDATION_ERROR`).
- **`/health/ready` answers 503 while the server shuts down** (`status: draining`), and while the database schema version is below what the code expects.
- **Thread, message and memory ids must match `^[A-Za-z0-9._:@-]{1,128}$`,** in the path and in the body (`thread_id`, `config.thread_id`). Anything else gets 422 `VALIDATION_ERROR`. This breaks clients that make their own thread ids with spaces, slashes or more than 128 characters.
- **Shutdown is configured with `SHUTDOWN_GRACE_SECONDS` (10), `SHUTDOWN_STOP_SECONDS` (10) and `SHUTDOWN_TIMEOUT_SECONDS` (30).** The lifespan calls `graph.aclose()` once with them; the old separate 30 second background drain is gone. A run started during shutdown gets 503 `SERVICE_UNAVAILABLE` with `Retry-After: 5`.
- **Thread delete can answer `success: false`** with `data.cleanup_failed` when file, trace or cache cleanup fails, and also releases files linked to the thread by their metadata (local and memory stores).
- **State-changing thread routes answer 409 while a run holds the thread** (PUT and DELETE state, POST and DELETE messages, DELETE thread, POST `/v1/graph/fix`).
- **New WARNING logs:** `compile()` with no checkpointer, the first run of a graph with no `user_id`, and in production or with `WEB_CONCURRENCY` above 1 an in-memory or SQLite checkpointer or no Redis.

### Alerting

Handled client errors log one WARNING line instead of an ERROR with a traceback, and Sentry no
longer sends request bodies. Alerts that matched ERROR for 4xx responses must match WARNING
instead.

---

## TypeScript client (`10xgraph-client`)

**Node.js 18 is no longer supported:** `engines` is `node >= 20.0.0`. Nothing else in the client API changes signature. Also check the server default
above: with `10xgraph-api` 1.0, a client that invents a thread id for a new conversation gets
HTTP 403 on `invoke()`, `stream()` and `wsStream()`.

- Omit `thread_id` from `config` on the first request of a conversation.
- Reuse the id the server returns on every later request: `result.meta.thread_id` for
  `invoke()`, `chunk.thread_id` or `chunk.metadata.thread_id` for `stream()`. `wsStream()`
  tracks the id for its own resume requests, but you keep it for your next call.
- Operators who want the old behaviour set `"runs": {"thread_ids": "client"}` in
  `10xgraph.json`.

Behaviour you may notice, none of it a signature change:

- `stream()` and `wsStream()` now throw (`StreamError`, `WebSocketError`) when a stream is cut or the server closes the socket mid-run. Before, they ended as if the run had succeeded.
- The `timeout` option is an idle timeout on `stream()` and `wsStream()`: it limits how long the client waits on the network, not how long the whole run takes.
- Timeout and network failures are `RequestTimeoutError` and `NetworkError`, not plain `Error`. Code that matched on message text should check the class.
- `listMemories` takes `offset` and returns `has_more` and `next_offset`. It needs `10xgraph-api` 1.0.

The client-side tool loop on `invoke()` and `stream()` used to lose a server-assigned thread id
on the requests that send tool results. That is fixed: the client reuses the returned id, a
`thread_id` you pass is never replaced, and your `config` object is not modified.

`addThreadMessages` is deprecated. It needs the `checkpointer:import` scope (admin only) on
recent `10xgraph-api` releases. Use `updateThreadMessageFeedback` to attach feedback to a
message.

---

## Database migration

`PgCheckpointer` schema version 4 changes the messages primary key to
`(thread_id, message_id)` and builds its index under an `ACCESS EXCLUSIVE` lock. `aget_message` and `adelete_message` now require `thread_id` in the
config, and `aget_tool_result` is scoped to the thread owner. The migration runs automatically
on first setup. Old and new code cannot run against the same database at the same time: once v4 has run, every message insert from a 0.10.x pod fails. Back up first:

```bash
pg_dump "$DATABASE_URL" --format=custom > 10xgraph-pre-1.0.dump
```

Do not roll the upgrade pod by pod. The migration runs under a Postgres advisory lock, so two new pods starting together do not collide, but a 0.10.x pod running beside a new one breaks. `10xgraph-api` calls the checkpointer's `asetup()` at boot, so starting a new pod runs the migration. Use this procedure:

1. Stop all old (0.10.x / 0.9.x) pods.
2. Start one new pod. It runs the migration at boot. `/health/ready` answers 503 while the schema version is below what the code expects, so wait until it is ready.
3. Start the remaining new pods.

If you do not run the API server, call `await checkpointer.asetup()` once instead of step 2.

The migration is not reversible. A rollback to 0.10.x needs a restore of the database from the dump taken before the migration. See [backup and restore](/docs/server/backup-and-restore).

### Dependency minimums

The extras raise these floors. A fresh install resolves them; an existing environment must be upgraded.

- `10xgraph`: `images` needs `Pillow>=13.0.0`, `mcp` needs `mcp>=1.30.0`, `otel` and `langsmith` need `opentelemetry-api>=1.45.1` and `opentelemetry-sdk>=1.45.1`, and `mem0` needs `mem0ai>=2.0,<3`.
- `10xgraph-api`: `python-multipart>=0.0.31`, `starlette>=1.3.1`, `PyJWT>=2.15.0` (the `jwt` extra), and `opentelemetry-api` and `opentelemetry-sdk` `>=1.45.1` (the `otel` extra).

---

## Verification checklist

After upgrading, before sending production traffic:

1. `10xgraph version` reports 1.0.0rc1 for core and the CLI.
2. The server starts with `MODE=production` and explicit `ALLOWED_HOST` and `ORIGINS`.
3. A new conversation without a `thread_id` succeeds, and a client-invented id for a new thread
   gets 403 (unless you set `runs.thread_ids` to `"client"`).
4. An existing thread can still be read by its owner and is not visible to anyone else.
5. Memory and store calls pass a concrete `user_id` or `system_user_id(...)`, and no `ValueError`
   appears in the logs.
6. Handoffs, hidden tools and MCP tools behave as before. Look for `GRAPH_007` and
   name-clash `ValueError`s on startup.
7. Alerts on 4xx responses match WARNING lines, not ERROR.

## Related

- [Changelog](/changelog)
- [Upgrade to 0.9](/docs/project/upgrade-to-0.9)
- [Production checklist](/docs/server/production-checklist)
- [Deployment](/docs/server/deploy)
