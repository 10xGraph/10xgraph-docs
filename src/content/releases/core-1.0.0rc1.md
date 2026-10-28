---
package: core
version: "1.0.0rc1"
date: 2026-10-28
summary: The 1.0 release candidate. The public API is stable under a deprecation policy, with a security hardening round across tools, memory, media, checkpointers and handoffs. Breaking changes included.
breaking: true
---

The 1.0 release candidate. Pip skips it unless you pass `--pre`:

```bash
pip install -U --pre "10xgraph==1.0.0rc1"
```

`10xgraph-api` and `10xgraph-client` ship 1.0 release candidates alongside. From 1.0 the three packages share major.minor, and patch numbers move independently. This release has breaking changes: read **Breaking** and the [upgrade guide](/docs/project/upgrade-to-1.0) before upgrading.

### Breaking

- **The graph-level memory API is removed** (`MemoryIntegration`, `create_memory_preload_node`, `get_memory_system_prompt`, `memory_tool`). **Migration:** pass `Agent(memory=MemoryConfig(...))`.
- **`fetch_and_cache` is removed** from `tenxgraph.storage.media.temp_cache`. **Migration:** download through `fetch_media_url` with a `MediaFetchPolicy`.
- **Store operations with a missing or empty `user_id` raise `ValueError`** (`QdrantStore`, `Mem0Store`). **Migration:** pass a concrete `user_id`, or `system_user_id(name)` for shared data, and re-index records written with an empty owner. `RAGAgent` searches as `system_user_id("knowledge_base")` unless `store_config` sets `user_id`, and `store_config_builder` output must include `user_id`.
- **Agent memory is owned by `system_user_id(agent_id)` (or `app_id`), not the current user.** `Agent(memory=...)` raises `ValueError` if agent memory is on with neither id. **Migration:** set an `agent_id` or `app_id` and re-store memories written under a user.
- **A `collection` in the run config no longer overrides the memory scope's collection.** **Migration:** set `collection` on `UserMemoryConfig` or `AgentMemoryConfig`.
- **`PRELOAD` memories are no longer a system message.** They arrive as a fenced block in the latest user message and are never saved to `state.context`. `Agent._build_memory_prompts` is replaced by `Agent._build_memory_block`. **Migration:** update prompts or tests that look for `[Long-term Memory Context]`.
- **`RAGAgent` puts retrieved documents in a request-only block** and no longer rewrites `state.context`. `execution_meta.internal_data["rag_docs"]` and `_RAG_DOCS_KEY` are gone. **Migration:** a custom agent passed to `RAGAgent` must accept the keyword-only `request_blocks` argument on `execute`, or `RAGAgent` raises `TypeError`.
- **Skill and memory text is no longer run through `str.format`.** Only your own `system_prompt` is interpolated, and a bad placeholder is logged. **Migration:** remove reliance on `{placeholder}` expansion inside skill or memory text.
- **`QdrantStore.aforget_memory` applies `memory_type`, `category` and `filters`; `Mem0Store.aforget_memory` raises `ValueError` if any is passed.** The `qdrant` extra needs `qdrant-client>=1.10.0` and a Qdrant server 1.10 or newer.
- **Handoffs need a registered handoff tool.** A `transfer_to_<X>` call only jumps if a tool made with `create_handoff_tool` is on that ToolNode. A `Command.goto` to an unknown node raises `GraphError` (`GRAPH_007`). `SwarmAgent` enforces `can_handoff_to`.
- **Tools hidden by `tools_tags` can no longer be called.** **Migration:** add the tag or the tool if the call was intended.
- **An MCP tool with the same name as a local or remote tool raises `ValueError`.** **Migration:** rename one of them.
- **Parallel tool calls are capped at 10 per turn.** **Migration:** set `max_parallel_tool_calls` in the run config, or `TENXGRAPH_MAX_PARALLEL_TOOL_CALLS`.
- **Unexpected tool errors no longer reach the model verbatim.** The model sees `Tool '<name>' failed with an internal error (reference <ref>)` and the full error is logged. **Migration:** to show a message to the model, return it as a string; a raised `ValueError` is no longer shown.
- **A tool call with invalid JSON arguments is answered with a tool error** instead of running with empty arguments, and tool metrics label unknown tools as `"unknown"`.
- **File tools refuse secret files** (`.env`, keys, `.ssh`, `.aws`, `.git` and similar) for any root, and `file_search` stays inside the root. **Migration:** change the list with `create_file_tools(root, deny=..., use_default_deny=False)`, and prefer `create_file_tools(root=...)` to the run-config root, which is deprecated and removed in 2.0.
- **`fetch_url` no longer follows redirects to internal addresses or uses `HTTP_PROXY` and `HTTPS_PROXY`.** Fetches that relied on a proxy or an internal redirect now fail.
- **Multi-agent loop limits** (`max_rounds`, `max_iterations`, `max_attempts`) are per turn and reset on each new turn.
- **Resume is checked.** A `resume_interrupt_id` that is not the pending interrupt's raises `InterruptMismatchError`, and a value that fails the interrupt's `response_schema` raises `ResumeValidationError`.
- **`PromptInjectionValidator` behaves differently.** Non-strict mode scans only the first `max_length` characters, strict mode raises on bad base64, and text in other languages is no longer rejected.
- **Client-supplied media URLs are fetched under a `MediaFetchPolicy`:** `http` and `https` to public hosts only, 20 MB, 10 s, and `image/*` and `application/pdf` by default. **Migration:** audio and video links on Google graphs stop downloading until you allow those content types with `compile(media_policy=MediaFetchPolicy(...))`. The private `_convert_to_google_format` no longer downloads.
- **`CloudMediaStore` raises `ValueError` for storage keys that are not 32 lowercase hex characters.** Objects stored under other keys by custom code are no longer reachable through the store.
- **Local media and the SQLite checkpointer create owner-only files** (`0o700` folders, `0o600` files). Widen the mode yourself if other users or services need access.
- **`alist_messages` and `alist_threads` raise `ValueError` for a negative `limit` or `offset`,** and an explicit `limit` is lowered to `MAX_LIST_LIMIT` (1000).
- **`PgCheckpointer` schema version 4** changes the messages primary key to `(thread_id, message_id)`. `aget_message` and `adelete_message` require `thread_id` in the config, and `aget_tool_result` is scoped to the thread owner. **Migration:** runs automatically on first setup. Back up first.
- **Checkpointers apply the owner rule to state-cache writes,** and the in-memory checkpointer returns copies of state, so mutating a loaded state no longer changes the store until you save it.
- The old example folders and the `a2a_sdk` example are removed. Use the reorganised `examples/` folders.

### Added

- `MediaFetchPolicy`, `MediaURLError` and `fetch_media_url` in `tenxgraph.storage.media`, plus `compile(media_policy=...)` and `CompiledGraph.media_policy`.
- `collection` on `UserMemoryConfig` and `AgentMemoryConfig`: a name, or a function of the run config.
- `system_user_id`, `is_system_user_id` and `SYSTEM_USER_PREFIX` for shared, ownerless data.
- `RAGAgent(store_config_builder=...)` to scope the knowledge-base search per user or tenant.
- `user_id_mode` (`"raw"`, `"hash"`, `"mask"`) on the OTEL, Logfire and LangSmith setup, to control how the user id appears in traces.
- Opt-in TLS and SASL for `KafkaPublisher`.
- `BaseCheckpointer.aupdate_message_metadata`, `BaseMediaStore.update_metadata`, and run tracking with `abegin_run`, `aend_run` and `aget_active_run`.
- `InterruptMismatchError`, `ResumeValidationError` and the `resume_interrupt_id` resume input.
- The `checkpointer:import` scope constant (`CHECKPOINT_IMPORT`).
- `create_file_tools(root)` returns `file_read`, `file_write` and `file_search` locked to a directory set in code.
- Examples rewritten and reorganised by feature.

### Security

- Handoffs, hidden tools, MCP name clashes and parallel tool calls are now enforced or bounded.
- `fetch_url` and client-supplied media URLs go through a checked HTTP client: every redirect is verified, the connection is pinned to the checked address, and internal and cloud-metadata addresses are refused.
- `PromptInjectionValidator` and the `<think>`, `<reasoning>` and `<thought>` parsers no longer backtrack on crafted input.
- Tool failures, metrics labels and `RedisPublisher` connection errors no longer leak raw exception text, model-invented names or the Redis password.
- Memory and skill text can no longer build oversized or state-leaking prompts, and `PRELOAD` and RAG context stay out of saved history.
- Checkpointer reads, writes and paging are scoped to the owner and bounded, and local files are owner-only.

### Deprecated

- The run-config file tool root. Use `create_file_tools(root=...)`; the run-config root is removed in 2.0.
