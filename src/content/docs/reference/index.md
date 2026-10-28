---
title: API reference
seoTitle: "10xGraph API reference: Python, REST, CLI, TS"
description: "Reference for 10xGraph: the Python library, the REST and WebSocket API, the CLI and 10xgraph.json configuration, and the typed TypeScript client."
section: Reference
order: 10
label: Overview
updated: "2026-10-27"
---

The 10xGraph reference documents four surfaces of one system: the Python library, the REST and WebSocket API that the server generates from your graph, the CLI with its `10xgraph.json` configuration, and the TypeScript client. It is for developers who already know what they want to call and need exact signatures, options and error conditions. Pick the surface you are calling from.

## Start here

Python developers should open [Graph](/docs/reference/python/graph) and [Agent](/docs/reference/python/agent) first: they define `StateGraph`, `CompiledGraph`, `invoke`, `stream` and how a model is wired into a node. [Checkpointers](/docs/reference/python/checkpointers) matters for production, because durable threads and replay-safe tool calls depend on one.

If you run the server, the [CLI commands](/docs/reference/api-cli/commands) and [configuration](/docs/reference/api-cli/configuration) pages cover every `10xgraph.json` key, with [auth](/docs/reference/api-cli/auth) and [rate limiting](/docs/reference/api-cli/rate-limiting) for the production settings. Before launch, read [Production readiness](/docs/production), the [security model](/docs/production/security-model) and [Test before production](/docs/testing/before-production). Frontend developers should start with the [client](/docs/reference/client/client) and [stream](/docs/reference/client/stream) pages. The REST contract starts at [conventions](/docs/reference/rest-api/conventions) and the [graph endpoints](/docs/reference/rest-api/graph).

If you do not yet know which call you need, the [guides](/docs/guides) are organized by task.

## Python library

The graph engine, agents, tools, state, storage, and the evaluation harness. Everything importable from `tenxgraph.*`. The `agentflow` import is a deprecated alias until version 2.0; use `tenxgraph` in new code. The A2A protocol bridge is not available yet.

### Core building blocks

| Page | Covers |
| --- | --- |
| [Graph](/docs/reference/python/graph) | `StateGraph`, `CompiledGraph`, nodes, edges, `START`, `END`, `compile`, `invoke`, `stream` |
| [Agent](/docs/reference/python/agent) | `Agent`, `BaseAgent`, `ToolNode`, how a model is wired into a node |
| [State](/docs/reference/python/state) | `AgentState`, state type hints, reducers |
| [Messages](/docs/reference/python/messages) | `Message`, content blocks, message reducers |

### Tools and control flow

| Page | Covers |
| --- | --- |
| [Tools](/docs/reference/python/tools) | `ToolNode`, tool metadata, `ToolResult`, MCP integration |
| [Control flow](/docs/reference/python/control-flow) | `Command`, `interrupt()`, handoff, conditional routing |
| [Callbacks](/docs/reference/python/callback-manager) | `CallbackManager` and invoke callbacks |
| [Lifecycle callbacks](/docs/reference/python/lifecycle-callbacks) | `GraphLifecycleHook`, `on_graph_start`, `on_graph_end`, `on_graph_error` |

### State and memory

| Page | Covers |
| --- | --- |
| [Checkpointers](/docs/reference/python/checkpointers) | `InMemoryCheckpointer`, `SqliteCheckpointer`, `PgCheckpointer`, durability |
| [Memory stores](/docs/reference/python/memory-stores) | Cross-thread memory, vector backends, search |
| [Context manager](/docs/reference/python/context-manager) | `MessageContextManager`, `SummaryContextManager`, context trimming |

### Streaming and I/O

| Page | Covers |
| --- | --- |
| [Stream emitter](/docs/reference/python/stream-emitter) | `StreamEmitter` and streaming events from inside tools |
| [Media](/docs/reference/python/media) | `MediaRef`, `MultimodalConfig`, media storage backends |

### LLM and observability

| Page | Covers |
| --- | --- |
| [LLM](/docs/reference/python/llm) | `call_llm`, provider detection, client creation, timeouts |
| [Publishers](/docs/reference/python/publishers) | Event publishers for streaming and observability |
| [ID generator](/docs/reference/python/id-generator) | Custom ID generation for distributed systems |
| [Runtime utilities](/docs/reference/python/runtime-utilities) | Graceful shutdown, logging, message conversion, metrics |

### Advanced

| Page | Covers |
| --- | --- |
| [Exceptions](/docs/reference/python/exceptions) | `GraphError`, `NodeError`, `GraphRecursionError`, `StaleStateError` |
| [Prebuilt agents](/docs/reference/python/prebuilt-agents) | Constructor options for all agent types |
| [Prebuilt tools](/docs/reference/python/prebuilt-tools) | Fetch, file, search, calculator and memory tools |
| [Background tasks](/docs/reference/python/background-tasks) | Long-running tasks during graph execution |
| [Adapters](/docs/reference/python/adapters) | Convert OpenAI, Google GenAI and Anthropic responses to `Message` |
| [Realtime](/docs/reference/python/realtime) | Realtime audio I/O |
| [Skills](/docs/reference/python/skills) | Load Agent Skills into agents |

### Testing and evaluation

| Page | Covers |
| --- | --- |
| [Testing](/docs/reference/python/testing) | `TestAgent`, `QuickTest`, `MockToolRegistry`, `MockMCPClient` |
| [Evaluation](/docs/reference/python/evaluation) | `EvalSet`, `EvalCase`, `EvalCaseResult`, `EvalReport` |
| [Evaluation criteria](/docs/reference/python/evaluation-criteria) | Every criterion class and how to choose one |
| [Evaluation harness](/docs/reference/python/evaluation-harness) | Pytest helpers, batch runners and reporters |

## REST and WebSocket API

What the API server exposes once the server is running (`10xgraph dev` locally, Gunicorn in the image from `10xgraph build`).

The server generates its own OpenAPI schema, so the authoritative contract for your build is always available locally:

| Surface | Default path | Setting |
| --- | --- | --- |
| Swagger UI | `http://127.0.0.1:8000/docs` | `DOCS_PATH` |
| ReDoc | `http://127.0.0.1:8000/redocs` | `REDOCS_PATH` |
| OpenAPI JSON | `http://127.0.0.1:8000/openapi.json` | On while either `DOCS_PATH` or `REDOCS_PATH` is set |

Set both `DOCS_PATH` and `REDOCS_PATH` to empty values in production to turn off the interactive docs and the raw schema at `/openapi.json`.

| Page | Covers |
| --- | --- |
| [Conventions](/docs/reference/rest-api/conventions) | HTTP contract, error shape, status codes |
| [Graph](/docs/reference/rest-api/graph) | `/v1/graph/invoke`, `/v1/graph/stream`, `/v1/graph/stop`, `/v1/graph/fix` |
| [Live WebSocket](/docs/reference/rest-api/live) | `/v1/graph/live` for bidirectional streams and realtime audio |
| [Threads](/docs/reference/rest-api/threads) | `/v1/threads`, conversation history and management |
| [Memory store](/docs/reference/rest-api/memory-store) | `/v1/store`, cross-thread memory operations |
| [Files](/docs/reference/rest-api/files) | `/v1/files`, upload, download and signed URLs |
| [Config](/docs/reference/rest-api/config) | `/v1/config/multimodal`, server configuration |
| [Observability](/docs/reference/rest-api/observability) | `/v1/observability/{thread_id}`, run inspection |
| [Evals](/docs/reference/rest-api/evals) | `/v1/evals/runs`, evaluation runs |
| [AG-UI](/docs/reference/rest-api/ag-ui) | `/v1/ag-ui`, AG-UI protocol |
| [Ping](/docs/reference/rest-api/ping) | `/ping`, health checks |

## CLI and configuration

| Page | Covers |
| --- | --- |
| [Commands](/docs/reference/api-cli/commands) | `init`, `dev`, `build`, `config`, `eval`, `test`, `skills`, `audit`, `demo`, `version` |
| [Configuration](/docs/reference/api-cli/configuration) | Every `10xgraph.json` key and per-environment overrides |
| [Environment](/docs/reference/api-cli/environment) | Every environment variable the server reads |
| [Auth](/docs/reference/api-cli/auth) | JWT configuration and custom `BaseAuth` extension |
| [Rate limiting](/docs/reference/api-cli/rate-limiting) | Rate limit backends and configuration |

## TypeScript client

The `10xgraph-client` package, framework-agnostic and fully typed.

### Basics

| Page | Covers |
| --- | --- |
| [Client](/docs/reference/client/client) | Construction, options, and authentication |
| [Invoke](/docs/reference/client/invoke) | Synchronous agent invocation |
| [Stream](/docs/reference/client/stream) | Event streaming and NDJSON chunks |

### State and threads

| Page | Covers |
| --- | --- |
| [Threads](/docs/reference/client/threads) | Thread creation and history |
| [Graph](/docs/reference/client/graph) | Graph information and utilities |
| [Message](/docs/reference/client/message) | Message type definitions |

### Features

| Page | Covers |
| --- | --- |
| [Memory](/docs/reference/client/memory) | Long-term memory operations |
| [Files](/docs/reference/client/files) | File upload and multimodal content |
| [Realtime](/docs/reference/client/realtime) | Realtime audio sessions |
| [Auth](/docs/reference/client/auth) | Authentication options |
| [Errors](/docs/reference/client/errors) | Error classes and error handling |

## Errors

| Page | Covers |
| --- | --- |
| [Error codes](/docs/reference/error-codes) | Full catalog of error codes and causes |

## Conventions used here

- Signatures are the real ones. If a page and the source disagree, the source is right and the page is a bug. Please [report it](/docs/project/support).
- Defaults are stated explicitly, including when the default is `None`.
- Error codes are listed with the condition that raises them. The full index is in [error codes](/docs/reference/error-codes).

Reference pages describe what things *are*. For task-shaped questions, start from the [guides](/docs/guides).
