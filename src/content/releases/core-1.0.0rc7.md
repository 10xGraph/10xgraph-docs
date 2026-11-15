---
package: core
version: "1.0.0rc7"
date: 2026-11-15
summary: The seventh 1.0 release candidate. The model can forget a memory by key, tracing produces one trace per run with standard span names, and multi-agent graphs on Claude no longer fail on thinking blocks.
breaking: true
---

The seventh 1.0 release candidate. The model can forget a memory by key, tracing produces one trace per run with standard span names, Anthropic errors at stream open are retried, and multi-agent graphs on Claude no longer fail on thinking blocks. Pip skips it unless you pass `--pre`:

```bash
pip install -U --pre "10xgraph==1.0.0rc7"
```

Use it with `10xgraph-api` 1.0.0rc6 (there is no API rc7) and `10xgraph-client` 1.0.0-rc.3.

### Changed

- **Tracing: one trace per run, with standard span names.** Spans follow the OTEL GenAI conventions: the run is `invoke_agent 10xgraph` (was `tenxgraph.graph`), an LLM call `chat {model}` (was `tenxgraph.llm`), a tool call `execute_tool {tool}` (was `tenxgraph.tool`), and a node span carries the node's name (was `tenxgraph.node`). A tool span is a child of the node that ran it, and spans from the provider SDK, fastmcp and `mcp` nest under the run. **Migration:** update dashboards and filters that match the old span names.
- **Failed LLM, tool and MCP events carry the exception** (`error_type`, `error_message`, `error_traceback`), with secrets masked. The message and traceback go to observability publishers only; event streams get the error type.
- **Memory types are strict.** An unknown `memory_type` is an error instead of silently `episodic`, in the model-facing tools and in `UserMemoryConfig` / `AgentMemoryConfig`.
- **Memory search no longer filters by the scope's `memory_type` and `category`** unless the model passes them, so a memory saved under another type or category is found. Preload mode follows the same rule and can now `remember` and `forget`.

### Added

- **`forget` and `memory_key` on `user_memory_tool`.** `forget` deletes the memories saved under a key, and `remember` with a key replaces the earlier memory under it.
- **A warning for an unsupported retrieval strategy.** `PgVectorStore` and `QdrantStore` declare which strategies they can run, and one warning is logged when a memory config asks for another.

### Fixed

- **Multi-agent graphs on Claude no longer fail with `Invalid signature in thinking block`.** Each Agent node replays signed thinking only from its own replies; replies from other agent nodes keep their text and tool calls.
- **Anthropic errors at stream open are retried**, and the stream is closed when the consumer stops early.
- **The Anthropic SDK no longer adds a second span for every request.**
- **Error logs name the error when it has no message**, for example `TimeoutError()` from a pool acquire.
