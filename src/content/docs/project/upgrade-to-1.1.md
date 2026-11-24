---
slug: project/upgrade-to-1.1
title: Upgrade from 1.0 to 1.1
seoTitle: "Upgrade 10xGraph to 1.1: what changes"
description: What a 10xgraph 1.0 and 10xgraph-api 1.0 user must know before moving to 1.1. Behavior changes first, then deprecations with their replacement, then new features.
section: Project
order: 19
label: Upgrade to 1.1
---

1.1 keeps the 1.0 public API (see [Stability](/docs/project/stability)). Nothing you call is
removed in this release: things are deprecated, and they keep working until 2.0. One unfinished
batch feature and the `10xgraph revoke` command are the only exceptions, listed under Removed. Some behavior does change without a
code change on your side. Read the behavior changes first.

This page covers `10xgraph` 1.0 and `10xgraph-api` 1.0. The 1.1 entries below come from the
changelogs of both packages, which still list them as unreleased.

## Install 1.1

```bash
pip install -U 10xgraph 10xgraph-api
```

`10xgraph-api` 1.1 requires `10xgraph` 1.1. Both now require `injectq` `>=0.7.0,<0.8`.

---

## Behavior changes

These work differently after the upgrade, with no code change. Check each one against your agent.

### Core

- **State copies share `Message` objects.** The state saved at a checkpoint, the `old_state` of
  an `on_state_update` hook, each parallel tool call's state and the states `InMemoryCheckpointer`
  returns own their lists and fields, but share the `Message` objects. Editing a message in
  place now also changes it in those copies. Replace the message instead:
  `msg.model_copy(update=...)`. Appending to `state.context` or changing another field in place
  still never reaches a saved state.
- **Cross-process stop needs the cache methods.** A stop from another process is now read with
  `aput_cache_value` and `aget_cache_value`. Every built-in checkpointer has them. A custom
  checkpointer without them gets no cross-process stop, and a stop flag written only into the
  cached state is no longer read. The helper `reload_state` is removed.
- **Tool results are fenced.** The text of every tool result (local, MCP and client tools) reaches
  the model inside a `<tool_output_xxxxxxxx>` fence, plus one system prompt line that says the
  content is data. This also applies to results saved before 1.1. Stored messages, API responses,
  events and traces keep the plain output. The prompt cache from 1.0 misses once. Keep the 1.0
  behavior with `ToolNode(fence_results=False)`.
- **`HAS_*` flags mean installed.** `HAS_OPENAI`, `HAS_GOOGLE_GENAI`, `HAS_QDRANT`, `HAS_GOOGLE`,
  `HAS_MCP` and `HAS_FASTMCP` now check that the package is installed, not that it imports.
  `from tenxgraph.core.graph import StateGraph` no longer imports the provider SDKs. The module
  attributes `genai` and the converters' `ChatCompletion` are gone: patch `google.genai` and
  `openai.types.chat.ChatCompletion` in tests.
- **Ids.**
  - `DefaultIDGenerator` returns a uuid4 string. An id you pass wins. Otherwise the
    `BaseIDGenerator` bound in the container makes the id, and with none bound it is a uuid4
    string.
  - A message id is no longer the provider's response id. That id is in `metadata["response_id"]`.
  - All deltas and the final message of one streamed response share one id.
  - `PgCheckpointer` takes its id column type from the generator (string by default, bigint for
    `BigIntIDGenerator` and Snowflake). `compile()` and the first run raise a `ValueError` when
    the generator and the checkpointer id type do not match. Setup refuses existing `threads` or
    `messages` tables whose id column type differs from the generator's.
  - With a text `id_type`, thread and message ids must be strings. With `int` or `bigint` they
    must be integers. A mismatch raises `ValueError` before any SQL.
- **One engine loop.** `ainvoke` and `astream` run one graph loop, and function, agent and tool
  nodes run through one node runner and one tool runner. The internal handler modules
  `invoke_handler`, `invoke_node_handler` and `stream_node_handler` are gone. Visible effects:
  - Resuming after a client tool under `ainvoke` returns and saves the client's tool result.
  - `Command(state=S)` from a node makes `S` the new state in both modes.
  - A node that returns an unsupported value fails with `NODE_001` under `astream` too.
  - An `on_error` callback recovers a node only when it returns a `Message`.
  - A node may return a `dict` as a partial state update. Returning `None` means no change.
- **Events.**
  - Tool END and ERROR events carry `data["status"]` (`"success"` or `"error"`) and
    `data["duration_ms"]`. `ToolResultEvent` has the same two fields.
  - Each tool call sends one start and one end (or error) event. Before, it sent about five
    from two layers. Kafka, Redis and RabbitMQ consumers that counted the duplicates see fewer.
  - Tool event `node_name` is the graph node. The tool name, as the model called it, is in
    `data["function_name"]`. Read the tool name from there.
  - A pause by `interrupt()` or `interrupt_before` / `interrupt_after`, and a stop, send one
    GRAPH_EXECUTION `INTERRUPTED` event (`graph_interrupt`). The run's own `INTERRUPTED` event
    is no longer sent.
  - Lifecycle events reach publishers on every run, not only when a lifecycle hook is registered.
  - Event payloads are built only when a publisher is bound.
  - LLM end events are built from the converted reply. Google's finish reason is the enum name
    (`STOP`), and OpenAI's is `UNKNOWN` when the provider sends none.
- **Data classes are pydantic models.** `RetryConfig`, `MCPAuthContext`, `WorkerConfig`,
  `SwarmMemberConfig`, `MediaFetchPolicy`, `CallbackContext`, `GraphLifecycleContext`,
  `TaskMetadata`, `TokenUsage`, `ReporterOutput`, `NodeResponse` and `TempCacheEntry` keep their
  names, fields and defaults. `CallbackContext` and `MCPAuthContext` take keyword arguments only.
  Assigning to a frozen one raises `pydantic.ValidationError`. Use `model_dump` and `model_copy`
  instead of `dataclasses.asdict` and `dataclasses.replace`.
- **`call_llm` uses the same client code as `Agent`.** Unknown keyword arguments are dropped
  with a warning, not a `TypeError`. A Claude model with `use_vertex_ai=True` calls Vertex.
- **Checkpointers follow one contract.**
  - `InMemoryCheckpointer` and `SqliteCheckpointer` create the thread record on the first write.
  - `aclear_cache_value` returns `True` or `False`.
  - `aget_message` raises `MessageNotFoundError` (an `IndexError` and a `ValueError`).
  - `aput_messages(metadata=...)` is merged into each message's metadata everywhere.
  - Message and thread search match message text and `thread_name` only, and `%`, `_` and `\`
    match literally.
  - `aput_thread` raises `ValueError` when `thread_info.thread_id` differs from
    `config["thread_id"]`.
  - `PgCheckpointer` returns the caller's thread `metadata` as put. The run id is only on
    `ThreadInfo.run_id`.
  - Every checkpointer refuses text with the NUL character or a lone surrogate with `ValueError`.
  - `aclean_thread` also removes the stop request and active-run marker.
- **Stores follow one contract.**
  - `PgVectorStore` writes with an identity need a value for every tenant column the reach picks.
  - `astore(memory_id=...)` with another user's memory id raises `ValueError` ("not found").
  - `QdrantStore` result `metadata` is your metadata plus `category`, `memory_type` and
    `memory_key`. Read `content`, `user_id`, `thread_id` and `timestamp` from the result fields.
  - `QdrantStore.aget` raises when Qdrant fails. `aget_all` returns newest first and honours
    `filters`.
  - `QdrantStore` and `InMemoryStore` refuse a `filters` key that is `user_id` or a tenant column.
  - `qa.testing.InMemoryStore` follows the real stores: tests that stored memories without a
    `user_id` must now pass one.
- **Requires injectq 0.7** in core (`>=0.7.0,<0.8`). `StateGraph.compile()` builds the
  container's resolvers, so a binding that cannot be resolved fails at compile, not in a run.
  `TestContext` restores the previous container on exit.
- **Upload names.** `sanitize_filename` removes control, zero-width and bidirectional characters
  and path parts. An empty or `..` name becomes `unnamed`, and leading dots are removed.
- **Memory fields can collide with yours.** `origin` and `expires_at` are now fields of every
  memory. `PgVectorStore` and `QdrantStore` setup refuses an `extra_columns` or `tenant_columns`
  entry with either name, so rename the column first. Caller `metadata` keys named `origin` or
  `expires_at` are dropped on new writes on every built-in store. On `PgVectorStore`,
  `filters={"origin": ...}` now matches the column, not a metadata key. On `QdrantStore`, an
  existing point whose metadata held `origin` (for example `"user"`) now reads that value as its
  provenance; an unrecognized value reads as unknown. Rename such keys before you upgrade.
- **`PgVectorStore` schema version 3.** `asetup()` adds two nullable columns and a partial index
  on its own. During a rolling deploy, 1.0 processes keep working but do not hide expired rows
  and do not write `origin`. See [Schema version 3](/docs/guides/use-pgvector-store#schema-version-3).

### API

- **`"id_generator": "uuid"` maps to `DefaultIDGenerator`**, so it stays valid and does not warn.
  uuid is the default, so `10xgraph init` Production no longer writes `id_generator`.
- **Ids follow the id generator.** New thread ids and run ids come from the generator bound in
  the shared container. An id from a path, body, WebSocket frame or AG-UI message is converted to
  the generator's type: `int` for Snowflake and the other integer generators (422 on a
  non-numeric value), `str` otherwise.
- **AG-UI message ids are server ids.** `POST /v1/ag-ui` no longer keeps the client's message
  ids. The client's id is stored in `metadata["client_message_id"]`, and a retry that resends it
  is not stored twice.
- **The `checkpointer` key is removed from `10xgraph.json`.** The server never applied it. A
  config that sets it now refuses to start. Pass the checkpointer to
  `graph.compile(checkpointer=...)` in the agent module.
- **One container.** The server and the worker refuse to start when the graph was built with a
  different InjectQ container than the server's. Pass the same container to
  `StateGraph(container=...)` and to `injectq`, or set neither.
- **Config values.** Every `"module:attr"` value is checked by one rule when the config is read.
  `"graph.react:"` and `"a:b:c"` fail at once with one message, and `"mod:obj.attr"` works for
  every key.
- **Node names.** `current_node` `"start"` and `"end"` give 422 `unknown node`. Use `"__start__"`
  and `"__end__"`.
- **Public data classes are pydantic models.** `AgUiConfig`, `MediaConfig`, `RateLimitConfig`,
  `TokenRevocationConfig`, `CacheStoreConfig`, `WebSocketConfig`, `RunsConfig`, `SlotResult` and
  `RateLimitDecision` keep names, paths, fields and defaults, and now validate on construction.
  `RateLimitDecision` takes keywords only.
- **Errors and uploads.**
  - On invoke, an unknown model name answers 422 before the thread check.
  - On invoke, a recognised database or provider error answers 422, 503 with `Retry-After`, or
    429, not a generic 500.
  - Every transport gives the same error message for the same error.
  - Provider `raw` payloads and `internal_data` keys other than `error` are removed from
    messages and state.
  - Inline media in a run is checked like an upload: quota, file signature and size limits. A
    refused run answers 422 on invoke and stream.
  - An upload with an empty or `..` name is stored as `unnamed` (it was `file`).
- **Requires injectq `>=0.7.0,<0.8`**, now a direct dependency. A container workaround and the
  `current_container()` helper are removed.
- **CLI.** Every command finds `10xgraph.json` (or `agentflow.json`) in the current or nearest
  parent folder. `10xgraph eval` loads the agent as the server does. `10xgraph config` validates
  with the server's rules.

---

## Deprecations

Each one still works and emits a `DeprecationWarning`. All are removed in 2.0.

| Deprecated | Use instead |
|---|---|
| `UUIDGenerator` (now a subclass of `DefaultIDGenerator`) | `DefaultIDGenerator` |
| `AsyncIDGenerator` | Subclass `BaseIDGenerator` with your own `async def generate()` |
| `id_type` argument of `PgCheckpointer` | Drop it. The id type follows the id generator |
| `safe_calculator` | Write your own `@tool` or use an MCP server |
| `fetch_url`, `create_fetch_url` | Write your own `@tool` or use an MCP server |
| `google_web_search`, `create_google_web_search` | Write your own `@tool` or use an MCP server |
| `vertex_ai_search`, `create_vertex_ai_search` | Write your own `@tool` or use an MCP server |
| `file_read`, `file_write`, `file_search`, `create_file_tools` | Write your own `@tool` or use an MCP server |
| `tenxgraph.storage.media.temp_cache` (`TemporaryMediaCache`, `TempCacheEntry`) | Nothing. No code writes this cache |
| `MultimodalConfig.image_handling`, `document_handling`, `supported_doc_types` | Remove them. No code reads them |
| `VADConfig.start_sensitivity`, `end_sensitivity`, `prefix_padding_ms`, `silence_duration_ms` | Remove them. No code reads them |
| `EvalConfig.mock_mode`, `UserSimulatorConfig.thinking_enabled` | Remove them. No code reads them |

Setting a config field above to a non-default value warns. The `ImageHandling` and
`DocumentHandling` enums stay. `create_handoff_tool`, `is_handoff_tool`,
`make_agent_memory_tool` and `make_user_memory_tool` are not deprecated.

### Removed

`AnthropicBatch`, `OpenAIBatch` and `BatchResult` (`tenxgraph.core.llm`) are removed without a
deprecation period. They were standalone wrappers that no part of the graph runtime used, and
batch support will not continue. Call the provider SDK's batch API instead:
`client.messages.batches` for Anthropic, `client.batches` for OpenAI.

`10xgraph revoke` is removed without a deprecation period. Revocation runs in the server, and the CLI
is not in the server's Docker image, so the command could not reach its cache store. Token revocation
itself is unchanged. Call `revoke_user` or `revoke_token` (importable from `tenxgraph_api`) with the
cache store (`InjectQ.get_instance().get(BaseCacheStore)`) from your own code.

---

## New features

### Core

- **`ToolDenied`.** Raise it from a `before_invoke` callback (for `InvocationType.TOOL` or
  `InvocationType.MCP`) or from the tool. The tool does not run, and the model gets
  `"Denied by policy: <tool>. <reason>"`. The tool event status is `denied`.
- **`ToolGuard`.** A ready-made policy for local and MCP tools: an allow list of name patterns,
  required permissions per tool checked on `config["user"]`, an optional argument check, and
  `strict=True`. Client tools run in the frontend and are not covered.
- **Per-tool human approval.** `ToolGuard(approval={"refund"})` pauses the run with `interrupt()`
  before the tool runs. Resume with `True` or `{"approved": True}`. It needs a checkpointer.
- **Tool result fencing** (see behavior changes), with `ToolNode(fence_results=False)` to turn it off.
- **`QdrantStore(tenant_columns=...)`** isolates memories by tenant, like `PgVectorStore`, so
  reach `tenant` now works on Qdrant. Points written before a column was declared stay invisible
  to reach `own` and `tenant` until you backfill them.
- **`base_url`** on `OpenAIEmbedding` and `GoogleEmbedding` for a custom endpoint.
- **`MessageNotFoundError`** from `tenxgraph.core.exceptions`.
- **`BaseCheckpointer.declared_id_type`** is what a checkpointer declares for the id type check.
- **Partial state updates.** A node can return a `dict` or `Command(update={...})`: each key
  sets a state field, and `"messages"` appends.
- **Tool event fields** `status` and `duration_ms` (see behavior changes).
- **Memory origin and expiry.** Every memory has an `origin` (`user`, `agent`, `tool`, `system`,
  or unknown) and an optional `expires_at`. `MemoryConfig(ttl=...)` expires what the model
  remembers; `MemoryConfig(origins=list(TRUSTED_ORIGINS))` turns on trusted-only retrieval, which
  also hides the model's own memories. Both are off by default. Expired memories are hidden from
  every read, and `adelete_expired()` removes them. See
  [Memory origin and expiry](/docs/concepts/memory-and-store#memory-origin-and-expiry).

### API

- **`runs.max_recursion_limit`** in `10xgraph.json` (positive integer, default 100, editable in
  `10xgraph config`). A request's `recursion_limit` above it gets 422 naming the key. The schema
  no longer caps it at 100.
- **Tool permissions in roles and tokens.** A `tools` resource takes a tool name as its action:
  `tools:refund` or `tools:*`. A name is 1 to 128 of `A-Z a-z 0-9 _ - .`. They work in
  `auth.roles` and in a `permissions_claim`, and token `scope` or `scopes` narrow them. `*` also
  grants `tools:*`. With auth on and no roles, no tool permission is granted, so a tool behind a
  `ToolGuard` rule is denied until a role or claim grants it.
- **Tool calls in the audit log.** With `audit.enabled`, each server tool call records a `tool`
  event with action `tool:call` and result `success`, `failed` or `denied`. A `ToolGuard`
  approval resume records `tool:approve`. `AuditEvent` gains `thread_id`, `run_id` and
  `tool_call_id`. Tool arguments and results are never recorded.
- **Live tool audit** uses the result event's `status` and needs a core that sets it.
- **Memory provenance in the store endpoints.** The server sets `origin: "user"` on every memory
  it stores. Create and update take `expires_at`, search and list take `origins`, and responses
  carry `origin` and `expires_at`.
- **`memory_cleanup`** in `10xgraph.json` (off by default) makes `10xgraph scheduler` delete
  expired memories on a schedule. It needs a `worker` key and a store that supports expiry.
  See [memory_cleanup](/docs/reference/api-cli/configuration#memory_cleanup).

---

## Performance

The changelog states these measurements:

- Importing `StateGraph` takes about 0.36 s instead of 2.0 s.
- A 3-node run on a 1,000-message thread takes 18 ms instead of 374 ms with
  `InMemoryCheckpointer` (Postgres with Redis: 234 ms instead of 352 ms). The state is no longer
  deep-copied at each step.
- Stop checks on that run cost 0.15 ms instead of 130 ms with `InMemoryCheckpointer` (Postgres
  with Redis: 1.7 ms instead of 49 ms), and the state is read from the cache once instead of 9
  times.
- Checking a model for NUL or lone-surrogate text is about 2.5 times faster.
- A thread resume in the API reads the thread state once before the run. A stream resume read it
  up to four times.
