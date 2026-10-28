---
slug: project/upgrade-to-1.0
title: Upgrade to 1.0
seoTitle: "Upgrade 10xGraph to 1.0: breaking changes"
description: Migration guide from 10xgraph 0.10, 10xgraph-api 0.9 and 10xgraph-client 0.6 to 1.0, with every breaking change grouped by package and what to do about it.
section: Project
order: 20
label: Upgrade to 1.0
updated: "2026-10-28"
---

1.0 is the release where the public API is stable under a deprecation policy. The core
(`10xgraph`) and the API server (`10xgraph-api`) contain breaking changes, most of them
secure-by-default behaviour that now refuses what used to be allowed. The TypeScript client
(`10xgraph-client`) has none. Work through the sections for the packages you run before
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

### Runs and resume

- **Multi-agent loop limits are per turn.** `max_rounds`, `max_iterations` and `max_attempts`
  reset on each new turn instead of being a lifetime budget per thread.
- **Resume is checked.** A `resume_interrupt_id` that is not the pending interrupt's raises
  `InterruptMismatchError`, and a value that fails the interrupt's `response_schema` raises
  `ResumeValidationError`.
- **`PromptInjectionValidator` behaves differently.** Non-strict mode scans only the first
  `max_length` characters, strict mode raises on bad base64, and text in other languages is no
  longer rejected.

### Media and storage

- **Client-supplied media URLs are fetched under a `MediaFetchPolicy`:** only `http` and
  `https` to public hosts, 20 MB, 10 s, and `image/*` and `application/pdf` by default. Audio
  and video links on Google graphs stop downloading until you allow those content types with
  `compile(media_policy=MediaFetchPolicy(...))`. The private `_convert_to_google_format` no
  longer downloads.
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

---

## API server (`10xgraph-api`)

### Threads and clients

- **`runs.thread_ids` defaults to `"server"`** (was `"client"`). REST and WebSocket clients that
  invent a thread id for a new thread now get 403 on `/v1/graph/invoke`, `/v1/graph/stream`,
  `/v1/graph/ws` and the checkpointer write routes. Omit the id on the first request and use
  the `meta.thread_id` the server returns from then on (`"new"` over `/v1/graph/ws`), or set
  `"runs": {"thread_ids": "client"}` in `10xgraph.json`. AG-UI and `/v1/graph/live` need no
  change. Only the built-in ownership and rbac backends refuse.
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
- **Production runs longer than 300 s are cancelled** (invoke 504, stream and AG-UI error).
  Raise `runs.timeout`, or set it to `null`.

### Auth and authorization

- **Custom authorization backends are isolated by default.** A backend that implements only
  `authorize()` now gets per-owner storage isolation. If you relied on sharing, add
  `def isolation_scope(self) -> str: return "none"`.
- **JWTs with an invalid `user_id` or scope claim are refused with 401.** `user_id` must be a
  non-empty string or an integer. Null, empty, boolean, float, list and dict are rejected. A
  `scope` or `scopes` claim that is not a string or a list of strings is rejected, so fix the
  issuer. A string `scopes` is now split on spaces instead of matched by substring.

### Alerting

Handled client errors log one WARNING line instead of an ERROR with a traceback, and Sentry no
longer sends request bodies. Alerts that matched ERROR for 4xx responses must match WARNING
instead.

---

## TypeScript client (`10xgraph-client`)

**There are no breaking changes in the client.** The one thing to check is the server default
above: with `10xgraph-api` 1.0, a client that invents a thread id for a new conversation gets
HTTP 403 on `invoke()`, `stream()` and `wsStream()`.

- Omit `thread_id` from `config` on the first request of a conversation.
- Reuse the id the server returns on every later request: `result.meta.thread_id` for
  `invoke()`, `chunk.thread_id` or `chunk.metadata.thread_id` for `stream()`. `wsStream()`
  tracks the id for its own resume requests, but you keep it for your next call.
- Operators who want the old behaviour set `"runs": {"thread_ids": "client"}` in
  `10xgraph.json`.

The client-side tool loop on `invoke()` and `stream()` used to lose a server-assigned thread id
on the requests that send tool results. That is fixed: the client reuses the returned id, a
`thread_id` you pass is never replaced, and your `config` object is not modified.

`addThreadMessages` is deprecated. It needs the `checkpointer:import` scope (admin only) on
recent `10xgraph-api` releases. Use `updateThreadMessageFeedback` to attach feedback to a
message.

---

## Database migration

`PgCheckpointer` schema version 4 changes the messages primary key to
`(thread_id, message_id)`. `aget_message` and `adelete_message` now require `thread_id` in the
config, and `aget_tool_result` is scoped to the thread owner. The migration runs automatically
on first setup. Back up first:

```bash
pg_dump "$DATABASE_URL" --format=custom > 10xgraph-pre-1.0.dump

# The migration applies on first startup of the upgraded server.
10xgraph dev --no-reload
```

Roll out one instance first and confirm the schema version before scaling up. See
[backup and restore](/docs/server/backup-and-restore).

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
