---
title: Integrations
description: Connect 10xGraph agents to your existing stack. Guides for LLM providers, frameworks, storage, and observability backends.
section: Integrations
order: 10
label: Overview
updated: "2026-10-27"
---

10xGraph integrations help you connect agent graphs to the stack you already run: your LLM provider, backend framework, data store, and observability tools. The core library is provider-agnostic and supports optional integrations for persistence, memory, messaging, and tracing. This section covers what the library includes and how to wire each integration into your system.

## What you get

10xGraph lets you choose every layer: the LLM provider (OpenAI, Google, Anthropic), the backend framework (FastAPI, your own service), the storage (Postgres, SQLite, or in-memory), and the observability tools (OTEL, Logfire, LangSmith). You install only what you use.

**LLM providers.** The library detects your model string and calls the provider SDK. Use `"openai/gpt-4o"`, `"gemini/gemini-2.5-flash"`, or `"claude-opus-5"` to switch providers in one line. Anthropic supports three backends: the direct API, Vertex AI, and Bedrock.

**Backend frameworks.** Serve graphs over the REST API (the `10xgraph-api` server), embed them directly in your FastAPI app, or call them from TypeScript with the `10xgraph-client` SDK. The API server handles auth, rate limiting, and streaming out of the box.

**Storage and memory.** Persist thread state to PostgreSQL with Redis as a hot cache, use SQLite for local development, or keep everything in memory for tests. Long-term memory integrations (Qdrant, Mem0) store facts across sessions for your agents to retrieve.

**Observability and debugging.** Publish execution events to Redis, Kafka, or RabbitMQ. Send traces to OpenTelemetry, Logfire, or LangSmith. The API server logs all requests and can redact secrets.

## Organize your reading

Pick your use case below, or read the categories in order: models first (to understand provider selection), then frameworks (how to wire in a backend), then storage (thread persistence), then coding assistants (if you're building for Claude Code).

### I have a Python service and want to add agents

Start with [Models](/docs/integrations/models) to see provider support and pick your LLM. Then choose how to serve:

- [FastAPI guide](/docs/integrations/fastapi): embed a graph in your existing app, with auth and streaming patterns for both embedded and sidecar deployments.
- [Postgres guide](/docs/integrations/postgres-and-redis): set up durable threads with `PgCheckpointer` so runs survive restarts and crashes.

### I have a frontend and want to call agents

Read [Models](/docs/integrations/models) first. Then:

- [Next.js/React guide](/docs/client/nextjs-and-react): call the agent API from a Next.js route handler or React component, stream tokens, and keep threads between messages.
- [CopilotKit guide](/docs/integrations/copilotkit): if you already use CopilotKit, serve your graph over the AG-UI protocol (off by default, needs an extra) to feed a CopilotKit chat with shared state and frontend tools.

### I need to scale and persist state

- [Postgres and Redis guide](/docs/integrations/postgres-and-redis): `PgCheckpointer` with connection pooling, schema setup, backup. Also gives the replay-safe tool ledger durable storage (see [Replay-safe tools](/docs/concepts/replay-safe-tools)).

### I want to give agents long-term memory

- Vector stores: [Qdrant](https://qdrant.tech) or [Mem0](https://mem0.ai) store and retrieve agent facts across sessions.
- Storage guide: `/docs/guides/use-memory-store` shows how to wire a store into your graph.

### I want to observe and debug in production

- [Publishers guide](/docs/guides/use-publishers): emit events to Redis, Kafka, RabbitMQ, or composite publishers.
- [Traces guide](/docs/guides/send-traces-to-logfire-langsmith): send traces to Logfire or LangSmith for inspection.
- [Observability reference](/docs/server/observability): logs, metrics, OTEL, and secret redaction on the API server.

### I'm building Claude Code skills

- [Coding assistants guide](/docs/integrations/coding-assistants): how the `10xgraph skills` command installs your graph into Claude Code.

## Optional extras

The core library includes support for many backends. Install only the extras you use:

| What | Where | Extra | Install if |
|---|---|---|---|
| **Models** |
| OpenAI, GPT-4, o1, o3 | Direct API | `openai` | you use OpenAI models |
| Google Gemini, Flash | Direct API or Vertex AI | `google-genai` | you use Google GenAI or Vertex AI |
| Anthropic, Claude | Direct API, Vertex AI, or Bedrock | `anthropic`, `anthropic-vertex`, `anthropic-bedrock` | you use Anthropic models |
| Realtime audio | Google GenAI (Gemini Live) | `realtime` | you use realtime audio with Gemini |
| **Persistence** |
| PostgreSQL + Redis | Dual-layer: Redis (hot), Postgres (durable) | `pg_checkpoint` | threads must survive restarts |
| SQLite | Local file-based | `sqlite_checkpoint` | developing or running single-instance |
| In-memory | RAM (default) | - | tests or ephemeral runs |
| **Long-term memory** |
| Qdrant | Vector database | `qdrant` | agents need persistent facts across sessions |
| Mem0 | Memory management API | `mem0` | you prefer a managed memory service |
| **Tools and protocols** |
| Model Context Protocol | MCP servers and clients | `mcp` | your tools run in separate processes |
| **Event publishing** |
| Redis Pub/Sub | Redis channels | `redis` | you have Redis and want local pub/sub |
| Kafka | Kafka topics | `kafka` | high-scale event streaming |
| RabbitMQ | AMQP queues | `rabbitmq` | traditional message broker |
| **Observability** |
| OpenTelemetry | Traces and metrics | `otel` | you use OTEL in your infrastructure |
| Logfire | Pydantic-hosted observability | `logfire` | you want a managed OTEL collector |
| LangSmith | LangChain's observability | `langsmith` | you already use LangSmith for tracing |
| **Multimodal** |
| Images | Processing and cloud offload | `images` | you send images to models or store them |
| Cloud storage | S3, GCS, Azure offload | `cloud-storage` | you offload media to cloud buckets |

Install with the extras you need:

```bash
# Anthropic + Postgres for production
pip install "10xgraph[anthropic,pg_checkpoint]"

# OpenAI + development stack
pip install "10xgraph[openai,sqlite_checkpoint,logfire]"

# All backends (development and testing)
pip install "10xgraph[all]"
```

## Integration pages

### Models and providers

- [**Models**](/docs/integrations/models): capability matrix (tools, structured output, streaming, reasoning, caching, multimodal, batch), OpenAI-compatible models, Ollama.
- [**OpenAI**](/docs/integrations/openai): configure models, keys, batching, common errors.
- [**Google**](/docs/integrations/google): Gemini, Vertex AI, API keys, quotas.
- [**Anthropic**](/docs/integrations/anthropic): direct API, Vertex AI, Bedrock, thinking models, model specifications.

### Backend frameworks

- [**FastAPI**](/docs/integrations/fastapi): embed graphs in your FastAPI routes, lifespan management, streaming, auth patterns.
- [**CopilotKit**](/docs/integrations/copilotkit): serve over AG-UI, shared state, frontend tools.

### Storage and state

- [**Postgres and Redis**](/docs/integrations/postgres-and-redis): `PgCheckpointer` configuration, connection pooling, schema, disaster recovery.

### Tools and AI coding

- [**Coding assistants**](/docs/integrations/coding-assistants): `10xgraph skills` command, Claude Code integration, updating.

## Next steps

- Learn [how provider selection works](/docs/integrations/models) before your first agent.
- Set up a checkpointer early: [choose a checkpointer](/docs/guides/set-up-checkpointing).
- For building in production: [server production checklist](/docs/server/production-checklist).
