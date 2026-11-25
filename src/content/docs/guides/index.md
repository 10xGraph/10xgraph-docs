---
title: "Build agents"
description: "Task-oriented guides for building, deploying and monitoring production agents. Step-by-step instructions, complete code examples and best practices for real applications."
label: "Build agents"
section: "Build agents"
order: 10
updated: "2026-11-26"
---

Guides are hands-on, task-oriented instructions that walk you through solving specific problems. Unlike concepts, which explain how 10xGraph works, guides show you how to do something: build a graph, add tools, set up memory, handle errors, or deploy to production.

Guides assume you have read [Get started](/docs/get-started).

## Six most common tasks

Start here if you are building an agent for the first time. These cover the decisions you make in almost every project.

1. **[Build a graph](/docs/guides/build-a-graph)**: Construct and wire nodes, edges, and routing logic. Shows when to use a custom `StateGraph` vs a prebuilt agent.

2. **[Configure an agent](/docs/guides/configure-agent)**: Choose a model and provider (OpenAI, Google, Anthropic, or an OpenAI-compatible server), set system prompts, reasoning, retries and fallbacks.

3. **[Add tools to an agent](/docs/guides/use-tool-decorator)**: Write tool functions, understand how the LLM sees the schema (from your type hints and docstring), inject dependencies like `state` or `db`, and handle errors.

4. **[Set up checkpointing and memory](/docs/guides/set-up-checkpointing)**: Keep thread state across restarts: in-memory for development, SQLite for one server, Postgres and Redis for production.

5. **[Stream and monitor runs](/docs/guides/stream-graph)**: Use `astream()` to send tokens and messages as they arrive.

6. **[Secure and serve your agent](/docs/production)**: Serve the graph with `10xgraph-api`, turn on auth and request limits, and work through the [production checklist](/docs/server/production-checklist). Guides here end with a "Run it in production" section that links to the relevant server page.

## How guides are organized

### Agents and graphs

Build the core graph logic. These guides cover the fundamental patterns: constructing graphs by hand, choosing when to use prebuilt agents, and customizing state and nodes.

- [Build a graph](/docs/guides/build-a-graph): StateGraph, nodes, edges, and routing
- [Configure an agent](/docs/guides/configure-agent): Model selection, system prompts, provider options
- [Use custom state](/docs/guides/use-custom-state): Extend AgentState with your own fields
- [Use custom nodes](/docs/guides/use-custom-nodes): Write nodes that are not agents or tool dispatchers
- [Get structured output](/docs/guides/structured-output): Output a typed, validated schema from an agent
- [Visualize a graph](/docs/guides/visualize-a-graph): Inspect and draw your compiled graph

### Prebuilt agents

Seven prebuilt agents cover common patterns. The set is closed: new patterns are built with `StateGraph` and `Agent`.

- [Prebuilt agents overview](/docs/guides/prebuilt-agents): Quick comparison and when to use each
- [ReactAgent](/docs/guides/prebuilt/react-agent): The standard tool-calling loop
- [RAGAgent](/docs/guides/prebuilt/rag-agent): Retrieval-augmented generation with vector stores
- [PlanActReflectAgent](/docs/guides/prebuilt/plan-act-reflect-agent): Plan, act, reflect, revise cycle
- [SupervisorTeamAgent](/docs/guides/prebuilt/supervisor-team-agent): Supervisor routing tasks to specialists
- [SwarmAgent](/docs/guides/prebuilt/swarm-agent): Peer agents that hand off to each other
- [StructuredOutputAgent](/docs/guides/structured-output): Guaranteed typed output
- [AudioAgent](/docs/guides/use-realtime-audio): Realtime audio input and streaming

### Tools and MCP

Give your agents the ability to take action. Covers writing custom tools, using prebuilt tools, Model Context Protocol (MCP), and emitting progress during long-running operations.

- [Use the @tool decorator](/docs/guides/use-tool-decorator): Write tools that the LLM can call
- [Prebuilt tools](/docs/guides/prebuilt-tools): Handoff and memory tools, plus the fetch, search, file and calculator tools deprecated in 1.1
- [Memory tools](/docs/guides/prebuilt/memory-tools): Store and retrieve long-term facts
- [Use MCP](/docs/guides/use-mcp): Model Context Protocol servers and clients
- [Emit tool progress](/docs/guides/emit-tool-progress): Show progress for long-running tools
- [Harness recipes](/docs/guides/harness-recipes): Tool search, large results in files, todo and notes state, long runs that resume

### State, memory and context

Manage graph state, persistence, and memory. These guides cover how messages accumulate, how to keep history across threads, and when to trim old context.

- [Set up checkpointing](/docs/guides/set-up-checkpointing): Thread state and durability options
- [Durability and concurrency](/docs/guides/durability-and-concurrency): Optimistic concurrency and the per-step save
- [Use a memory store](/docs/guides/use-memory-store): Long-term facts and retrieval
- [Use context managers](/docs/guides/use-context-manager): Trim or summarize old messages automatically
- [Use dependency injection](/docs/guides/use-dependency-injection): Inject user_id, db, config, and custom parameters into nodes and tools

### Multi-agent and control flow

Coordinate multiple agents and implement advanced control flow. Covers handoff patterns, human-in-the-loop approval, and background tasks.

- [Handoff between agents](/docs/guides/handoff-between-agents): Agent A asks agent B to take over
- [Add human approval](/docs/guides/add-human-approval): Pause runs for human review before proceeding
- [Run background tasks](/docs/guides/run-background-tasks): Spawn work that does not block the run

### Streaming, media and realtime

Streaming output, images and documents, and realtime audio.

- [Stream a graph](/docs/guides/stream-graph): Emit messages or tokens as they arrive
- [Send media](/docs/guides/send-media): Images, audio, and documents to models
- [Use realtime audio](/docs/guides/use-realtime-audio): Bidirectional audio streaming

### Safety

Protect against prompt injection and misuse. Covers input validation, guardrails, callbacks, and authorization scopes.

- [Validate input and guard prompts](/docs/guides/protect-against-prompt-injection): Prevent injection attacks
- [Zero-trust agents](/docs/security/zero-trust-agents): `ToolGuard`, tool approval and result fencing
- [Use callbacks](/docs/guides/use-callbacks): Hooks before/after invoke, on error, and on completion
- [Authorization scopes](/docs/guides/authorization-scopes): Read user identity and scopes inside tools

### Observability and operations

Monitor agents in production. Covers logging, tracing, metrics, graceful shutdown, and ID generation.

- [Use publishers](/docs/guides/use-publishers): Stream events to observability platforms
- [Send AI traces](/docs/guides/send-traces): OTLP, Arize Phoenix, Logfire and LangSmith
- [Metrics with Prometheus and Grafana](/docs/guides/metrics-prometheus-grafana): Request, task and LLM metrics by push or scrape
- [Configure ID generation](/docs/guides/configure-id-generator): Snowflake IDs for distributed systems
- [Graceful shutdown](/docs/guides/graceful-shutdown): Finish inflight requests before stopping

### Agent Skills

Give your own agent [Agent Skills](https://agentskills.io/specification): folders with a `SKILL.md` it loads on demand.

- [Give an agent Agent Skills](/docs/guides/use-skills): Add, validate and observe skills on an `Agent`
