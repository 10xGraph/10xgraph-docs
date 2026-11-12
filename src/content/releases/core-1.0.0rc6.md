---
package: core
version: "1.0.0rc6"
date: 2026-11-11
summary: The sixth 1.0 release candidate. Tools and MCP servers can call services as the signed-in user, tool ledger rows are cleaned after each run, and @tool takes the function name as the tool name.
breaking: true
---

The sixth 1.0 release candidate. Tools and MCP servers can call services as the signed-in user, the tool results ledger is cleaned up after each completed run, and `@tool` takes the function name as the tool name. Pip skips it unless you pass `--pre`:

```bash
pip install -U --pre "10xgraph==1.0.0rc6"
```

`10xgraph-api` 1.0.0rc6 and `10xgraph-client` 1.0.0-rc.3 ship alongside it. Read **Breaking** and the [upgrade guide](/docs/project/upgrade-to-1.0) before upgrading.

### Breaking

- **`@tool` no longer takes `name`.** A tool's name is its Python function name. The old `name=` showed a different name to the model, but `ToolNode` routed calls by `__name__`, so calls to the renamed tool were never routed. `@tool(name=...)` and `@tool("name")` now fail. **Migration:** rename the function instead. `get_tool_metadata()` no longer returns a `name` key. The scoped factory tools (`create_file_tools`, `create_fetch_url`, `create_google_web_search`, `create_vertex_ai_search`) now have function names equal to their tool names.
- **The `mcp` extra needs fastmcp 4.1.7 and mcp 2.3 or later** (was fastmcp 2.11.3 and mcp 1.30). Per-call MCP auth depends on mcp 2.x sending each request with the caller's context. `ToolNode` itself still runs on fastmcp 3.x; only `mcp_auth=` refuses it.

### Added

- **Calling services as the user.** `UserCredential` (`tenxgraph.core.authz`) holds the caller's raw credential in `config["credential"]`: `token: SecretStr` and `scheme` (default `"Bearer"`). Its repr is redacted, `json.dumps` and pickling raise, and copies return the same object. `get_credential(config)` reads it and `public_config(config)` returns the config without it.
- **Local tools get the credential by name.** A tool parameter named `credential` receives the `UserCredential` (or None), whatever its annotation, and is hidden from the model. An annotation other than `UserCredential` or `UserCredential | None` logs one warning when the tool is registered. Before and after-invoke callbacks never see it in their input data.
- **`ToolNode(mcp_auth=...)`: per-call MCP headers.** An async `(MCPAuthContext) -> dict[str, str]` runs before every MCP tool listing and tool call with the run's `identity`, `credential`, `tool_name` (None for listing), `server`, `thread_id` and `run_id`. Its headers go on that request only, so one shared client serves many users without mixing their headers. `forward_credential` forwards the caller's own token, only for a server that accepts that same token. It needs fastmcp 4; stdio and in-memory transports are refused. `ReactAgent`, `PlanActReflectAgent`, `StructuredOutputAgent` and `AudioAgent` pass `mcp_auth` through. The MCP tool list stays cached per node and shared by all users, so it must not depend on the user.
- **Tool ledger cleanup and opt-out.** After a run completes, its tool ledger rows are deleted in the background (`aclear_tool_results(config, origin_message_ids)`). Only rows from the run's own tool-calling messages go, so a newer run on the thread keeps its rows. Paused, stopped, failed and cancelled runs keep them. `aprune_tool_results(older_than)` deletes old rows of every thread; the library never calls it, so schedule it from a worker. On Postgres with `row_level_security=True`, a role that does not bypass RLS deletes nothing and a warning is logged. `@tool(record_tool_result=False)` turns the ledger off for one tool, and the `record_tool_result=False` kwarg of `InMemoryCheckpointer`, `SqliteCheckpointer` and `PgCheckpointer` turns it off for all of them (the checkpointer setting wins). `PgCheckpointer` schema v7 adds an index on `tool_executions(created_at)`, built concurrently on an existing table. SQLite adds a `created_at` column to `af_tool_executions`.
- **`ToolResultBlock.name`:** the tool that produced the result. `ToolNode` sets it on every result; it is `None` on results saved before. The provider wire format is unchanged.
- **Eval run config.** `ConversationScenario.config` is merged into the run config of the simulated conversation (an explicit `config` passed to `run` wins), so tools that read `config["user"]` work in simulations. `EvalSetBuilder.add_case`, `add_multi_turn` and `add_tool_test` take `session_input=`.

### Changed

- **`extra_messages` are filled from the state.** `{field}` in the text of an `Agent`'s `extra_messages` is filled from the agent state, the same way the system prompt is. They are sent after the history and never saved to `state.context`, so changing context at the end of the prompt keeps the cached prefix stable. A field that is not in the state stays as written. Existing `extra_messages` that contain `{{`, `}}` or `{identifier}` text are now formatted: use `{{` and `}}` for literal braces.
- **System prompt fill is partial.** A missing state field used to send the whole prompt unfilled. Now only that placeholder stays as written and the others are filled.
- **Tracing defaults to `ObservabilityLevel.FULL`.** The OTEL, Phoenix, Logfire and LangSmith publishers and the exporter config (`"level"` unset) now send message content and graph state to the trace backend by default (was `STANDARD`). Set `level=ObservabilityLevel.STANDARD` (or `"level": "standard"`) or `SPANS` to keep content out of traces.

### Fixed

- **The run config no longer leaves the run whole.** The graph start event (`metadata["config"]`), `GraphLifecycleContext.config` and the `config` in AI, tool and MCP `CallbackContext.metadata` now carry `public_config(config)`, so the credential never reaches publishers, OTEL, Phoenix or LangSmith spans, or callbacks that ship their context.
- **`RabbitMQPublisher` no longer retries forever or hangs shutdown.** It uses a plain `aio_pika.connect` instead of `connect_robust`, whose reconnect task retried every 5 seconds forever and could keep the process from exiting. Refused credentials are logged once and later events are dropped without contacting the broker. After a network failure the next attempt waits `reconnect_interval` seconds (new config key, default 5), and a connection the broker closed is opened again by the next publish. `close()` no longer waits for a connection attempt in progress, and gives the broker at most `connection_timeout` seconds to confirm the close.
- **`pass_user_info_to_mcp` sends the full caller behind the API.** An `Identity` (any pydantic model) is now sent as its JSON dump in `meta={"user": ...}`: `user_id`, `kind`, `tenant`, `roles`, `permissions`, `reach` and the token `claims`. Before, an MCP server received only `{"user_id": ...}`. A dict is still sent as is.
- **`ToolNode` works with fastmcp 4.x.** It no longer pings the MCP server before listing tools or calling one. fastmcp 4.x negotiates MCP protocol 2026-07-28, which has no `ping` method, so every MCP call failed with "MCP Server not available. Ping failed." A server that is down now fails the listing or the call as before, without the extra round trip.
