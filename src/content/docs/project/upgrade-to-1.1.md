---
slug: project/upgrade-to-1.1
title: Upgrade from 1.0 to 1.1
seoTitle: "Upgrade 10xGraph to 1.1: what changes"
description: What a 10xgraph 1.0 and 10xgraph-api 1.0 user must know before moving to 1.1. Behavior changes first, then deprecations with their replacement, then new features.
section: Project
order: 19
label: Upgrade to 1.1
updated: "2026-11-27"
---

1.1 keeps the 1.0 public API (see [Stability](/docs/project/stability)). Nothing you call is
removed in this release: things are deprecated, and they keep working until 2.0. One unfinished
batch feature, the `10xgraph revoke` command and the tracing `setup_*` helpers are the only
exceptions, listed under Removed. Some behavior does change without a
code change on your side. Read the behavior changes first.

This page covers `10xgraph` 1.0, `10xgraph-api` 1.0 and `10xgraph-client` 1.0. The 1.1 entries
below come from the changelogs of the three packages, which still list them as unreleased. The
client has one change: `invoke()` returns `thread_id` and `run_id` (see the API section).

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
- **Tracing publishers write only their own keys.** `OtelPublisher` writes the OTEL GenAI
  `gen_ai.*` keys and the `tenxgraph.*` keys (thread id, run id, user id, node, tool, usage),
  span names, status and errors. It no longer writes OpenInference, `langsmith.*` or
  `logfire.msg` keys. `PhoenixPublisher` adds the OpenInference keys (`session.id` is the thread
  id, `user.id`, and a `metadata` JSON with `thread_id` and `run_id`). `LangsmithPublisher` adds
  `langsmith.*` and `LogfirePublisher` adds `logfire.msg`. All three take `user_id_mode`. To
  add the keys of another backend, subclass `OtelPublisher` and override
  `span_attributes(role, phase, name, event, attrs)`. If you sent a plain `OtelPublisher` to
  Phoenix, switch to `PhoenixPublisher`.
- **Several tracing publishers.** `StateGraph(publisher=[...])` and `CompositePublisher` still
  work, but every tracing publisher creates its own span, so each span is built once per backend.
  For several tracing backends at once, use the API `observability` block. A list or
  `CompositePublisher` is how you combine one tracing publisher with event publishers (Redis,
  Kafka, RabbitMQ, console).
- **Fewer events, routed by publisher kind.** Event consumers see a different stream, and no
  setting restores the old one. Each event has a tag. `all` events go to event publishers (Kafka,
  Redis, RabbitMQ, custom) and to tracing publishers (OTEL, Phoenix, LangSmith, Logfire).
  `observability` events (node start, LLM calls, node errors) go to tracing publishers only.
  `ConsolePublisher` gets every event. The domain name is in `metadata["event_name"]`. A 3-node
  run (model, tool, model) sends event publishers 7 events instead of 48: `run.started`,
  `node.completed` three times, `tool.started`, `tool.completed` and `run.completed`.
  - **State only on run-end events.** `data["state"]` is on `run.completed`, `run.failed`,
    `run.interrupted` and `run.stopped`, still bounded by `state_snapshot_limit`. `run.started`
    carries no state and no run config (`metadata["config"]` and
    `metadata["response_granularity"]` are removed).
  - **Run-level events have an empty `node_name`.** The node is in `metadata["current_node"]`
    (`data["interrupted_node"]` for a stop). `run.interrupted` keeps the interrupted node.
  - **Old to new.**

    | Before | Now |
    |---|---|
    | GRAPH START | `run.started` |
    | GRAPH END | `run.completed` (not sent for a paused or stopped run) |
    | GRAPH ERROR (sent more than once) | `run.failed`, once |
    | NODE END (twice per node) | `node.completed`, once per node, with the node's new messages and `next_node` |
    | TOOL START / END / ERROR | `tool.started`, `tool.completed`, `tool.failed` |
    | GRAPH INTERRUPTED, `graph_interrupt` lifecycle event | `run.interrupted` (interrupt before or after, `interrupt()`, client tools), `run.stopped` (stop or cancel) |
    | Crash recovery | `run.recovered` (`dead_run_id`, no state) |
    | Validation rejection | `input.rejected` |
    | PROGRESS, GRAPH UPDATE, `graph_start`, `graph_end`, `graph_error`, `state_update`, `checkpoint` | Removed |

  - **Tracing.** The OTEL graph span ends on every run-end event and carries
    `tenxgraph.graph.run_status` (`completed`, `failed`, `interrupted`, `stopped`,
    `input_rejected`). An interrupted or stopped run no longer leaves it open. The
    `graph.lifecycle.*`, `graph.checkpoint` and `node.state_update` span events are gone.
  - **Realtime.** A `LiveAgent` session sends `run.started` and `run.completed` (or `run.failed`
    or `run.stopped`) instead of `graph_start` and `graph_end`.
  - **Tool events.** END and ERROR carry `data["status"]` (`"success"` or `"error"`) and
    `data["duration_ms"]`. `ToolResultEvent` has the same two fields. Each tool call sends one
    start and one end (or error) event, not about five. A call cancelled by `tool_timeout`, a stop
    or a shutdown now sends its ERROR event too. An MCP result with `isError` set is an error
    result.
  - **Tool event `node_name`** is the graph node. The tool name, as the model called it, is in
    `data["function_name"]`. Read the tool name from there.
  - **Payloads** are built only when a publisher is bound, and only for a tag that a bound
    publisher takes.
  - **LLM end events** are built from the converted reply. Google's finish reason is the enum name
    (`STOP`), and OpenAI's is `UNKNOWN` when the provider sends none.

  See [Events and observability](/docs/concepts/events-and-observability) and
  [Use publishers](/docs/guides/use-publishers) for the event list and fields.
- **Publishers batch events, always.** `RabbitMQPublisher`, `KafkaPublisher` and `RedisPublisher`
  put each event in a bounded queue, and one worker per publisher sends a batch every
  `batch_size` events (default 100) or `flush_interval_ms` (default 20), in order. `queue_size`
  (default 2048) bounds the queue and `publish_timeout` bounds one batch. A full queue drops the
  event, counts it in the `tenxgraph.publish.dropped` metric and warns at most every 10 seconds.
  `CompiledGraph.aclose()`, sync `invoke` and `stream`, and the publisher's `close()` flush the
  queue. `publisher.publish(event)` still sends one event at once. The Kafka message key is now
  the thread id, so one thread's events keep their order. All three encode an event with
  `model_dump_json()`: the payload parses to the same value, but the bytes differ (compact
  separators, UTF-8 instead of `\uXXXX` escapes). See [Use publishers](/docs/guides/use-publishers)
  and the [publishers reference](/docs/reference/python/publishers).
- **A run saves the next node.** The durable save after each step names the node that runs
  next. It named the node that had just finished, so a crash after that save with the Redis cache
  lost resumed at the finished node and ran it, and its tool calls, twice. In `astream`, the
  state in the chunk after each step names the next node too.
- **`astop` writes only the stop key.** It no longer copies the stop request into the cached
  state. A run reads the stop key.
- **Closing `astream` early saves the thread.** If the consumer breaks out while a node or tool
  runs, the thread is saved as interrupted, like a cancel, not left `running`.
- **Other fixes you may notice.**
  - A node named `start` or `end` is no longer renamed when a run resumes from a stored
    `current_node`. Node `before_invoke` and `after_invoke` callbacks no longer fire for
    `__start__` and `__end__`.
  - `compile()` without `callback_manager` gives each graph its own `CallbackManager`, not one
    shared default.
  - The tool result of a handoff tool in a hand-built `StateGraph` streams as a `tool` chunk under
    `astream`, as `ainvoke` already returned it.
  - A tool that raises a `BaseException` that is not an `Exception` gets a failed tool result
    under `astream` too.
  - Gemini: non-streaming calls report tokens, response id and model. Large media uploads use the
    Agent's own client (`base_url`, `api_key`, Vertex settings, `http_client`).
  - Claude: Haiku 4.5, Sonnet 4.5, Opus 4.5 and older models no longer get a 400 on the default
    reasoning config. `temperature`, `top_p` and `top_k` are removed for Bedrock cross-region
    ids and Vertex ids with an `@date` suffix when the model rejects them.
  - MCP: tool schemas from a fastmcp 4 server load, and `tools_tags` reads tags under
    `meta["fastmcp"]`.
  - Realtime tool calls honour `tool_timeout`, record tool metrics, and run in their own task.
  - Assistant messages from the OpenAI and Google converters are stamped with local time, so
    `PgCheckpointer` no longer lists a reply before its question.
  - The in-memory checkpointer keeps the first of two `aput_tool_result` calls for one tool call,
    and compares message ids as text.
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
  and do not write `origin`. See [Schema version 3](/docs/guides/use-pgvector-store#table-layout).

- **A cross-provider fallback with `http_client` raises `ValueError`.** An Agent with `http_client`
  refuses a `(model, provider)` fallback on another provider when it is built. That fallback was
  handed the primary's client, built for another SDK and host, so it failed at call time or, with
  Google, left without mTLS. A fallback on the same provider reuses the client. Give a fallback on
  another provider its own client with a `model_registry` entry and name it in `fallback_models`.
- **`SummaryContextManager.trim_context` is async.** It was a sync method wrapping `asyncio.run`;
  it is now `async def`, so call it with `await`. `atrim_context` still works but is deprecated
  (see Deprecations). `MessageContextManager.trim_context` stays sync.

### API

- **`"id_generator": "uuid"` maps to `DefaultIDGenerator`**, so it stays valid and does not warn.
  uuid is the default, so `10xgraph init` Production no longer writes `id_generator`.
- **Ids follow the id generator.** New thread ids and run ids come from the generator bound in
  the shared container. An id from a path, body, WebSocket frame or AG-UI message is converted to
  the generator's type: `int` for Snowflake and the other integer generators (422 on a
  non-numeric value), `str` otherwise.
- **A resent message is not stored twice.** Invoke, stream and the WebSocket keep the client's
  `message_id` in `metadata["client_message_id"]` (the stored id is still the server's). A user
  message whose id the thread already stores is a retry: if it is the latest user message and
  its run did not finish (failed, `409 state_conflict`, cancelled, stopped, crashed), the run
  continues from where it stopped without saving it again; if the run completed or the message is
  older, the request gets `409` `MESSAGE_ALREADY_PROCESSED`; a thread paused for input gets `409`
  (resume it instead).
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
- **Tracing keys on the server.** With several backends enabled in the `observability` block
  (`phoenix`, `langsmith`, `logfire`, `otlp`), the server creates one span and writes the keys of
  every enabled backend on it. `otlp` alone writes the basic attributes only. The legacy
  `OTEL_ENABLED` path uses a plain `OtelPublisher`, so it no longer writes OpenInference,
  `langsmith.*` or `logfire.msg` keys. For Phoenix, use the `phoenix` block of `observability`.
- **Invoke returns the ids.** `POST /v1/graph/invoke` returns `thread_id` and `run_id` at the top
  level of `data`, with the same names every stream event carries. `data.meta`
  (`is_new_thread`, `thread_id`) is unchanged. The client's `invoke()` result has `thread_id`
  (falling back to `meta.thread_id` on a server older than 1.1) and `run_id`. Read `thread_id`
  instead of `meta.thread_id`.
- **Requires injectq `>=0.7.0,<0.8`**, now a direct dependency. A container workaround and the
  `current_container()` helper are removed.
- **Trace export outages log once.** When a trace backend is down (Phoenix, LangSmith, plain OTLP
  over HTTP, or the legacy `OTEL_ENABLED` gRPC exporter), the `tenxgraph.trace_export` logger
  writes one WARNING when exports start failing and one INFO when they recover, not a line per
  batch.
- **Uploads and logs.** File names and signatures are checked by core's `sanitize_filename` and
  `validate_magic_bytes`, so the API and core apply one rule. Log lines escape U+2028 and U+2029.
- **Worker shutdown.** The worker closes the same resources as the API server, in the same order
  (graph, lease manager, cache store, auth, telemetry).
- **WebSocket container.** A WebSocket connection no longer replaces an app's own InjectQ container
  with the global one, so an app on its own container keeps it on `/v1/graph/ws` and
  `/v1/graph/live`.
- **CLI.** Every command finds `10xgraph.json` (or `agentflow.json`) in the current or nearest
  parent folder. `10xgraph eval` loads the agent as the server does. `10xgraph config` validates
  with the server's rules.

### Jobs

Changes to the worker and the scheduler. See [Run background tasks with a worker](/docs/server/background-tasks) for each.

- **`worker.retries` means retries.** `"retries": 3` now gives 3 retries (4 runs). Before, it gave
  2, and `"retries": 1` never retried. Cancelled, refused, bad-argument and over-delivered runs
  are never retried. See [Retries](/docs/server/background-tasks#retries).
- **The scheduler runs nothing at start.** An `every` schedule first runs one interval after the
  scheduler starts, so a daily job no longer reruns at each deploy. `10xgraph scheduler` also
  passes `--send-timeout 30` and refuses the `memory` broker. See
  [What runs at start](/docs/server/background-tasks#what-runs-at-start).
- **One scheduler, enforced by a Redis lease.** A second scheduler waits as a standby and takes
  over when the first stops. There are at most 100 schedules per user (429 above that).
- **Schedules are strict and UTC only.** Cron must have 5 fields with every value in range, `every`
  must be 10 seconds to one year, and a bad schedule answers 422 on create and on PATCH. Cron is
  always UTC, an `at` with an offset is converted to UTC, and an `at` without one is UTC. Other
  time zones are not supported. See
  [Time zones](/docs/server/background-tasks#time-zones).
- **A call that does not fit the task is 422.** An unknown, missing or repeated argument answers
  422 on `POST /v1/tasks/{name}` (run and schedule). Before, it answered 202 and the worker failed
  with a `TypeError`.
- **A result that cannot be saved is a failure.** A return value that is not JSON-serialisable, or
  a result backend that is down, ends the task as `failure` with an `error`. Before, it showed
  `success` with `result: null`. The final status is written after the result is saved.
- **`REDIS_KEY_PREFIX` now applies to jobs keys.** The stream, results, schedules and the
  scheduler lease get the prefix. If you set one, drain the queue and move your schedules before
  you deploy. Without a prefix nothing changes. See
  [Key names](/docs/server/background-tasks#key-names).
- **The worker waits like the build image.** `10xgraph worker` passes `--wait-tasks-timeout 600`
  and `--shutdown-timeout 60`. The generated worker's kill grace is 720 seconds (was 660).
- **The Redis worker takes one message at a time**, survives a Redis restart, and fails a message
  delivered more than `worker.broker.options.max_deliveries` times (default 5). `xread_count` and
  `unacknowledged_batch_size` other than 1 refuse to start.
- **New fields and routes.** `GET /v1/tasks/{schedule_id}` adds `status` (`scheduled` or `sent`)
  and `runs` (the last 20 run ids, readable and cancellable). PATCH of a sent one-time schedule
  answers 409.
- **The worker writes the audit log**, and `authorize` on `/v1/tasks` gets the task name as the
  resource.
- **`auth.method: jwt` needs a key at boot.** With neither `JWT_SECRET_KEY` nor `JWT_SECRET_KEYS`
  set, the server and the worker refuse to start. Before, they started and every request answered
  500.
- **A warning for memory state with a remote broker.** The API and the worker log it at boot when
  `cache_store.type` or `worker.result_backend.type` is `memory` and the broker is not.

---

## Deprecations

Each one still works and emits a `DeprecationWarning`. All are removed in 2.0.

| Deprecated | Use instead |
|---|---|
| `UUIDGenerator` (now a subclass of `DefaultIDGenerator`) | `DefaultIDGenerator` |
| `AsyncIDGenerator` | Subclass `BaseIDGenerator` with your own `async def generate()` |
| `BaseContextManager.atrim_context` | Call `trim_context`. A custom manager now implements only `trim_context`, sync or async |
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

`setup_phoenix`, `setup_langsmith`, `setup_logfire`, `setup_otlp`, `setup_observability` and
`setup_tracing` are removed without a deprecation period. Pass the publisher when you create the
graph instead: `StateGraph(publisher=PhoenixPublisher(...))`, or `LangsmithPublisher`,
`LogfirePublisher` or `OtelPublisher`. On the API server, use the `observability` block in
`10xgraph.json`.

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
- **Gemini `http_client`.** `Agent(provider="google", http_client=...)` sends Gemini requests
  through your own async httpx client, on the Gemini Developer API and on Vertex AI, so a client
  certificate (mTLS) or a proxy works as for OpenAI and Anthropic. It must be an
  `httpx.AsyncClient` with google-genai 1.x and 2.x; 3.x also takes an `httpx2.AsyncClient`. See
  [Use mutual TLS](/docs/security/use-mutual-tls).
- **`Agent(provider="google", api_key=...)` is honoured.** The Google client ignored it and read
  only `GEMINI_API_KEY` and `GOOGLE_API_KEY`.
- **`MessageNotFoundError`** from `tenxgraph.core.exceptions`.
- **`BaseCheckpointer.declared_id_type`** is what a checkpointer declares for the id type check.
- **Partial state updates.** A node can return a `dict` or `Command(update={...})`: each key
  sets a state field, and `"messages"` appends.
- **Tool event fields** `status` and `duration_ms` (see behavior changes).
- **Publish timers.** `tenxgraph.publish.duration` (one event send, or one batch for the Kafka,
  Redis and RabbitMQ publishers, with a `publisher` attribute), `tenxgraph.publish.batches`,
  `tenxgraph.publish.events` and `pg_checkpointer.save_state_cache.duration`.
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
- With `PgCheckpointer`, the run start writes its run marker and reads the saved state together (3
  round trips instead of 5 for a new thread). A stop from another process is read once per step,
  not before and after every node. A save on an existing thread, the history prune and the
  messages use fewer statements.
- A run writes the state cache once less per node when `durable_checkpoint_every_step` is on (the
  default). Paths that end the run before the per-step save (client tools, stop, interrupt, error,
  cancel) save on their own.
- Checking a model for NUL or lone-surrogate text is about 2.5 times faster.
- A thread resume in the API reads the thread state once before the run. A stream resume read it
  up to four times.
