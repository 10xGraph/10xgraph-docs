---
package: core
version: "1.0.0rc2"
date: 2026-10-30
summary: The second 1.0 release candidate. Lowest-effort default reasoning, OpenAI Responses by default, no default tool or node timeouts, typed tool arguments, and fixes for handoffs, streaming, shutdown and eval. Breaking changes included.
breaking: true
---

The second 1.0 release candidate. It is the `1.0.0rc1` code plus the changes below. Pip skips it unless you pass `--pre`:

```bash
pip install -U --pre "10xgraph==1.0.0rc2"
```

`10xgraph-api` 1.0.0rc2 and `10xgraph-client` 1.0.0-rc.2 ship alongside. If you upgrade from 0.10.x, the [rc1 breaking list](/docs/project/upgrade-to-1.0) applies to you as well. Read **Breaking** and the [upgrade guide](/docs/project/upgrade-to-1.0) before upgrading.

### Breaking

- **Default reasoning is each provider's lowest effort.** `reasoning_config` left unset or set to `True` used to mean `{"effort": "medium"}` (Google `thinking_budget=8192`). It now resolves per request to OpenAI `"minimal"`, Anthropic `"low"` and Google `"low"` (`thinking_budget=512`), from `DEFAULT_REASONING_EFFORT_BY_PROVIDER`. **Migration:** pass `{"effort": "medium"}` to keep the old depth. `None` or `False` still turns reasoning off.
- **OpenAI Responses requests a reasoning summary by default.** With reasoning on and no `summary` set, the request sends `summary: "auto"`. If the reasoning came from the default and the model answers 400 naming the reasoning parameter (for example gpt-4o), the call is retried once without it. An explicit `reasoning_config` dict is never dropped.
- **A custom `base_url` switches to Chat Completions only when Responses is missing.** Only 404, 405 and 501 switch it; other errors, such as a 429 or a timeout, are raised.
- **`Agent` uses the OpenAI Responses API by default.** `api_style` defaults to `"responses"` (it was `"chat"`), except when `base_url` is set and `api_style` is not passed. **Migration:** pass `api_style="chat"` to keep the old behaviour. The `openai` extra is now `openai>=1.93.1,<4`; on openai 3.x an `http_client` in `llm_kwargs` must be an `httpx2.AsyncClient`.
- **Tool and node timeouts are off by default.** `DEFAULT_TOOL_TIMEOUT_SECONDS` and `DEFAULT_NODE_TIMEOUT_SECONDS` are now `None` (they were 300 s and 900 s). **Migration:** set `tool_timeout` or `node_timeout` in the run config; a value you set now applies to both `invoke` and `stream`.
- **Tool arguments are checked against the types the tool declares.** A value that converts cleanly is converted; one that cannot (a list for an `int`) gets a failed tool result.
- **Published events are snapshots.** Each event is copied before it is queued, so Kafka, Redis, RabbitMQ and OTEL consumers see the values at the moment of the event.
- **`pass_user_info_to_mcp=True` sends the user info as request metadata** (`meta`, `{"user": {...}}`), not as a `user` tool argument. A server that read `user` from the arguments must read it from the meta.
- **`LiveAgent.arun()` raises `RuntimeError` when the instance already runs a session.** **Migration:** give each concurrent session its own `LiveAgent.new_session()`.
- **A stop request is saved as `StopRequestStatus.STOPPED`.** Code that checks for `STOP_REQUESTED` after a stop must also accept `STOPPED`.
- **Sync `invoke()`, `stream()`, `stop()` and sync checkpointer methods raise `RuntimeError` inside a running event loop.** **Migration:** call `ainvoke`, `astream`, `astop` or `aget_state`.
- **`Message.reasoning` is removed.** **Migration:** read the `ReasoningBlock`s (`type == "reasoning"`) in `Message.content`. The Postgres `messages.reasoning` column is dropped (schema version 5): stop old pods, migrate, then start new ones.
- **`mem0ai` is bounded to `>=2.0,<3`.** Other extras raise their floors: `Pillow>=13.0.0`, `mcp>=1.30.0`, `opentelemetry-api` and `opentelemetry-sdk` `>=1.45.1`.

### Added

- `await graph.aclose(grace, stop_timeout, timeout)`: graceful shutdown in phases, with `GraphClosedError` for new runs, the opt-in `install_shutdown_signals`, and `compile(owns_resources=...)`.
- User simulator progress events through `on_event` on `UserSimulator.run` and `BatchSimulator.run_batch`.
- `ToolNode` options `max_result_chars`, `mcp_include`, `mcp_exclude`, `mcp_prefix`, `mcp_max_result_chars`, `mcp_max_description_chars` and `mcp_connect_timeout`, plus `refresh_mcp_tools()`. MCP tool lists are cached per `ToolNode`.
- `create_fetch_url`, `create_google_web_search` and `create_vertex_ai_search`: tool factories that fix hosts, model or datastore in code.
- `RetryConfig.jitter`, `max_concurrent_calls` and the opt-in cross-process cap `distributed_max_concurrent_calls`.
- `PgCheckpointer` `redis_key_prefix`, safe default timeouts, `aclear_state_cache`, and `aput_cache_value_if_absent` on the checkpointers.
- `compile(node_aliases=...)`, `StoredNodeMissingError`, `StateFormatVersionError`, `NothingToResumeError` and `InterruptPendingError`.
- `GoogleEmbedding(document_task_type=..., query_task_type=...)` and `BaseEmbedding.aembed_query`.
- A redesigned self-contained HTML eval report (scorecard).

### Changed

- `PgCheckpointer` skips Redis for a cool-down after a connection failure: new kwarg `redis_breaker_cooldown` (seconds, default 5.0, 0 disables).
- `GoogleEmbedding` sends `RETRIEVAL_DOCUMENT` when storing and `RETRIEVAL_QUERY` when searching; set the task types to `None` to send none.
- Large `data["state"]` in published events is replaced by a summary above `state_snapshot_limit` (default 65536).
- Realtime tool calls run once per thread, and a cancelled, crashed or shut-down run leaves a usable thread.
- Anthropic thinking blocks are stored with their signature and replayed unchanged.

### Fixed

- Multi-agent handoffs no longer leave an unanswered tool call: `SwarmAgent` gets a `<NAME>_HANDOFF` node, and the handoff result tells the receiving agent it is in charge.
- Streaming: each item gets its own chunk, so clients see the deltas instead of the final message repeated.
- `PlanActReflectAgent` shows the planner's reply, not the reflector's review (reflector messages carry `metadata["internal"] = True`).
- Cancel and shutdown edge cases: `aclose()` waits for late cancel saves and run-marker releases (reported as `cleanup_tasks`), and a late save cannot overwrite the final one.
- Eval: a failing LLM judge reports an error with the real message instead of a 0.5 score.
- A Redis outage no longer slows every run step.
