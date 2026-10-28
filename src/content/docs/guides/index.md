---
title: "Build agents"
description: "Task-oriented guides for building, deploying and monitoring production agents. Step-by-step instructions, complete code examples and best practices for real applications."
label: "Build agents"
section: "Build agents"
order: 10
updated: "2026-10-27"
---

Guides are hands-on, task-oriented instructions that walk you through solving specific problems. Unlike concepts, which explain how 10xGraph works, guides show you how to do something: build a graph, add tools, set up memory, handle errors, or deploy to production.

Each guide is self-contained and runnable. You get complete code examples with all imports and no placeholders, plus how to verify the result worked. Guides assume you have read the [Get Started](/docs/get-started) section and understand the basics.

## Six most common tasks

Start here if you are building an agent for the first time. These cover the decisions you make in almost every project.

1. **[Build a graph](/docs/guides/build-a-graph)**: Construct and wire nodes, edges, and routing logic. Shows when to use a custom `StateGraph` vs a prebuilt agent.

2. **[Configure an agent](/docs/guides/configure-agent)**: Choose a model and provider (OpenAI, Google, Anthropic, or custom), set system prompts, and handle provider-specific options like reasoning or batch mode.

3. **[Add tools to an agent](/docs/guides/use-tool-decorator)**: Write tool functions, understand how the LLM sees the schema (from your type hints and docstring), inject dependencies like `state` or `db`, and handle errors.

4. **[Set up checkpointing and memory](/docs/guides/set-up-checkpointing)**: Enable thread state persistence so runs resume correctly after crashes. Choose a checkpointer for your durability needs: in-memory for development, SQLite for single-server, or Postgres+Redis for production.

5. **[Stream and monitor runs](/docs/guides/stream-graph)**: Use Python's `astream()` to emit tokens or messages as they arrive, inspect intermediate steps, and understand the streaming event types.

6. **[Secure and serve your agent](/docs/production)**: Serve the graph with `10xgraph-api`, turn on auth and request limits, and work through the [production checklist](/docs/server/production-checklist). Guides here end with a "Run it in production" section that links to the relevant server page.

## How guides are organized

Guides are grouped by topic. Click through to find what you need.

### Agents and graphs

Build the core graph logic. These guides cover the fundamental patterns: constructing graphs by hand, choosing when to use prebuilt agents, and customizing state and nodes.

- [Build a graph](/docs/guides/build-a-graph): StateGraph, nodes, edges, and routing
- [Configure an agent](/docs/guides/configure-agent): Model selection, system prompts, provider options
- [Use custom state](/docs/guides/use-custom-state): Extend AgentState with your own fields
- [Use custom nodes](/docs/guides/use-custom-nodes): Write nodes that are not agents or tool dispatchers
- [Get structured output](/docs/guides/structured-output): Output a typed, validated schema from an agent
- [Visualize a graph](/docs/guides/visualize-a-graph): Inspect and draw your compiled graph

### Prebuilt agents

10xGraph ships seven prebuilt agents that handle common patterns. Use one if it matches your needs; customize or extend it if not.

- [Prebuilt agents overview](/docs/guides/prebuilt-agents): Quick comparison and when to use each
- [ReactAgent](/docs/guides/prebuilt/react-agent): The standard tool-calling loop
- [RAGAgent](/docs/guides/prebuilt/rag-agent): Retrieval-augmented generation with vector stores
- [PlanActReflectAgent](/docs/guides/prebuilt/plan-act-reflect-agent): Plan, act, reflect, revise cycle
- [SupervisorTeamAgent](/docs/guides/prebuilt/supervisor-team-agent): Supervisor routing tasks to specialists
- [SwarmAgent](/docs/guides/prebuilt/swarm-agent): Peer agents that hand off to each other
- [StructuredOutputAgent](/docs/guides/prebuilt/structured-output-agent): Guaranteed typed output
- [AudioAgent](/docs/guides/prebuilt/audio-agent): Realtime audio input and streaming

### Tools and MCP

Give your agents the ability to take action. Covers writing custom tools, using prebuilt tools, Model Context Protocol (MCP), and emitting progress during long-running operations.

- [Use the @tool decorator](/docs/guides/use-tool-decorator): Write tools that the LLM can call
- [Prebuilt tools overview](/docs/guides/prebuilt-tools): Built-in tools for common tasks
- [Web tools](/docs/guides/prebuilt/web-tools): Fetch, search, and parse HTML
- [File tools](/docs/guides/prebuilt/file-tools): Read, write, and manipulate files
- [Memory tools](/docs/guides/prebuilt/memory-tools): Store and retrieve long-term facts
- [Use MCP](/docs/guides/use-mcp): Model Context Protocol servers and clients
- [Emit tool progress](/docs/guides/emit-tool-progress): Show progress for long-running tools

### State, memory and context

Manage graph state, persistence, and memory. These guides cover how messages accumulate, how to keep history across threads, and when to trim old context.

- [Set up checkpointing](/docs/guides/set-up-checkpointing): Thread state and durability options
- [Durability and concurrency](/docs/guides/durability-and-concurrency): Optimistic concurrency, retries, and the tool ledger
- [Use a memory store](/docs/guides/use-memory-store): Long-term facts and retrieval
- [Use context managers](/docs/guides/use-context-manager): Trim or summarize old messages automatically
- [Use dependency injection](/docs/guides/use-dependency-injection): Inject user_id, db, config, and custom parameters into nodes and tools

### Multi-agent and control flow

Coordinate multiple agents and implement advanced control flow. Covers handoff patterns, human-in-the-loop approval, and background tasks.

- [Handoff between agents](/docs/guides/handoff-between-agents): Agent A asks agent B to take over
- [Add human approval](/docs/guides/add-human-approval): Pause runs for human review before proceeding
- [Run background tasks](/docs/guides/run-background-tasks): Spawn work that does not block the run

### Streaming, media and realtime

Handle continuous output and multimodal input. Covers streaming tokens, sending images and documents to models, realtime audio, and batch processing for cost savings.

- [Stream a graph](/docs/guides/stream-graph): Emit messages or tokens as they arrive
- [Send media](/docs/guides/send-media): Images, audio, and documents to models
- [Use realtime audio](/docs/guides/use-realtime-audio): Bidirectional audio streaming
- [Batch LLM calls](/docs/guides/batch-llm-calls): Batch processing for cost optimization

### Safety

Protect against prompt injection and misuse. Covers input validation, guardrails, callbacks, and authorization scopes.

- [Validate input and guard prompts](/docs/guides/protect-against-prompt-injection): Prevent injection attacks
- [Use callbacks](/docs/guides/use-callbacks): Hooks before/after invoke, on error, and on completion
- [Authorization scopes](/docs/guides/authorization-scopes): Read user identity and scopes inside tools

### Observability and operations

Monitor agents in production. Covers logging, tracing, metrics, graceful shutdown, and ID generation.

- [Use publishers](/docs/guides/use-publishers): Stream events to observability platforms
- [Send traces to Logfire and LangSmith](/docs/guides/send-traces-to-logfire-langsmith): Production tracing and debugging
- [Configure ID generation](/docs/guides/configure-id-generator): Snowflake IDs for distributed systems
- [Graceful shutdown](/docs/guides/graceful-shutdown): Finish inflight requests before stopping

### Agent Skills

Extend 10xGraph with special capabilities for coding assistants (Claude Code, GitHub Copilot, and similar).

- [Give an agent Agent Skills](/docs/guides/use-skills): Enable agents to create and modify 10xGraph projects

## Guides vs concepts vs reference

**Concepts** explain how 10xGraph works: the architecture, the execution model, memory layers, and design decisions. Read them to understand the "why" before building.

**Guides** show you how to do something: how to build a graph, add tools, set up memory, stream responses. Each guide is a complete, working example that solves a specific problem. Read them when you know what you want to do and need the steps.

**Reference** documents every class, function, parameter, and option in the API. Use it to look up details: what parameters does `Agent` accept? What exceptions can be raised? What fields are in the request payload? Reference pages are not tutorials.

## Getting the most from guides

- Start with [Get Started](/docs/get-started) if you are brand new to 10xGraph.
- Pick a guide that matches your current task. Guides are independent; you do not have to read them in order.
- Every guide has complete, runnable code. Copy it and try it; modify it for your use case.
- If a guide references a concept you do not know, read that concept first (links point there).
- If you need to know all the options for something, the reference page has the full list (links point there).

