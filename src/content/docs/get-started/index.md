---
title: Get Started
seoTitle: Get started with 10xGraph in Python
description: "10xGraph is a production-grade Python framework for multi-agent AI systems. Install the library, build an agent, deploy the API server, and call it from TypeScript."
section: "Get started"
order: 20
label: Get Started
updated: "2026-10-27"
---

10xGraph is an open-source Python framework for building and deploying multi-agent LLM systems. You write the agent graph in Python. 10xGraph generates the REST, WebSocket and realtime audio server around it, enforces thread ownership and access control, stores state durably, and generates Docker files. A tool that finished before a crash is not run twice on replay.

## What you get

10xGraph consists of three parts that work together: a Python library for building agents, an API server that turns agents into services, and a TypeScript client for integrating those services into applications.

### The Python library

The core library (`10xgraph`, imported as `tenxgraph`) is the orchestration engine. Nodes are computation (an agent that calls an LLM, or a plain function), edges control the flow, and state moves through the graph as it runs.

Start with the prebuilt `ReactAgent`, which loops between the model and its tools. Build a custom `StateGraph` when you need non-linear routing, custom state or multi-agent handoffs. Tools run in parallel by default, memory has three layers (working state, durable checkpoints, long-term vector stores), MCP tools load dynamically, and OpenAI, Google GenAI and Anthropic are supported through one interface.

The example below is a support agent that looks up orders and issues refunds. Run it with your provider key set, for example `GEMINI_API_KEY`.

```bash
pip install "10xgraph[google-genai]"
```

```python title="agent.py"
# A support agent with two plain Python functions as tools
from tenxgraph.prebuilt.agent import ReactAgent
from tenxgraph.storage.checkpointer import InMemoryCheckpointer


def lookup_order(order_id: str) -> dict:
    """Look up an order by id and return its status and total."""
    return {"order_id": order_id, "status": "delivered", "total": 59.0}


def refund_order(order_id: str, amount: float) -> str:
    """Refund an order. This moves money, so it must run exactly once."""
    return f"Refunded {amount:.2f} for order {order_id}"


app = ReactAgent(
    model="google/gemini-2.5-flash",
    provider="google",
    system_prompt=[{"role": "system", "content": "You are a support agent for an online shop."}],
    tools=[lookup_order, refund_order],
).compile(checkpointer=InMemoryCheckpointer())
```

### The API server and CLI

The API server (`10xgraph-api`, imported as `tenxgraph_api`) serves your compiled graph with no extra code. A config file points at the agent, and the server exposes REST and WebSocket endpoints, access control, rate limiting, thread management and a long-term memory store. The `10xgraph` CLI scaffolds projects, runs the server and generates Docker and Kubernetes files.

Install it with `pip install 10xgraph-api`. Then create a `10xgraph.json` file that points at the `app` object in `agent.py`:

```json title="10xgraph.json"
{
  "agent": "agent:app",
  "env": ".env"
}
```

Start the API server from the folder that holds both files:

```bash
# Starts on http://127.0.0.1:8000
10xgraph api
```

The server listens on `http://127.0.0.1:8000` with a Swagger UI at `/docs`. Requests pass through authentication (JWT or custom), authorization (thread ownership and role scopes) and rate limiting when you configure them. `POST /v1/graph/invoke` runs the agent and returns the result, `POST /v1/graph/stream` streams chunks as NDJSON, and `/v1/graph/ws` is a WebSocket for bidirectional streaming. The `/v1/threads` routes expose a thread's state and messages.

Test the server with curl:

```bash
curl -X POST "http://localhost:8000/v1/graph/invoke" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": [{"type": "text", "text": "Where is order 1042?"}]}]
  }'
```

Or open the interactive playground:

```bash
10xgraph play
```

### The TypeScript client

The TypeScript client (`10xgraph-client`, class `TenxGraphClient`) is a typed interface to the API. It sends the bearer token, parses the NDJSON stream into typed chunks, and covers invoke, stream, threads, memory and files. It does not ship React hooks.

```ts title="app.ts"
import { TenxGraphClient, Message } from "10xgraph-client";

// Omit authToken when the server runs without auth
const client = new TenxGraphClient({
  baseUrl: "http://localhost:8000",
  authToken: "your-jwt-token",
});

// Invoke the agent and read the final messages. With no thread_id, the
// server starts a thread and returns its id in result.meta.thread_id.
const result = await client.invoke([Message.text_message("Where is order 1042?")]);
console.log(result.messages);

// Or stream chunks as they arrive, on the same thread
for await (const chunk of client.stream(
  [Message.text_message("Refund order 1042 for $50")],
  { config: { thread_id: result.meta.thread_id } },
)) {
  console.log(chunk.event, chunk.message);
}
```

## What's included

The framework comes with production-ready features out of the box, no configuration needed unless you want to customize them:

| Feature | What you get |
|---|---|
| API server | REST endpoints (`/v1/graph/invoke`, `/v1/graph/stream`), WebSocket (`/v1/graph/ws`), realtime audio (`/v1/graph/live`), Swagger UI, and a memory store API |
| Security | JWT or custom authentication, owner-only thread access, role-based access control on every endpoint, rate limiting (memory, Redis, or custom backend) |
| Reliability | [Replay-safe tools](/docs/concepts/replay-safe-tools) ensure no double execution, versioned state writes prevent race conditions, configurable node and tool timeouts |
| State and memory | Working state in memory, durable checkpoints in SQLite or Postgres+Redis, long-term facts in Qdrant or Mem0 vector stores |
| Prebuilt agents | Ready-made agents for common patterns: ReactAgent (tool-calling loop), RAGAgent (retrieval), SupervisorTeamAgent (task routing), SwarmAgent (peer handoff), PlanActReflectAgent (multi-step reasoning), StructuredOutputAgent (typed output), AudioAgent (audio) |
| Deployment | `10xgraph build --docker-compose --k8s` generates a Dockerfile, docker-compose.yml and k8s.yaml; `10xgraph init` scaffolds a production-ready project structure |
| Observability | Logs, traces (OTEL, Logfire, LangSmith), metrics, Sentry error tracking, and a callback system for custom monitoring |
| Tools | A prebuilt tool library covering web (fetch, search), files, memory, calculator and handoff, plus support for the Model Context Protocol (MCP) for dynamic tools |

## Prerequisites

To get started, you need:

- Python 3.12 or newer
- An API key for one LLM provider: `OPENAI_API_KEY`, `GEMINI_API_KEY` (or `GOOGLE_API_KEY`), or `ANTHROPIC_API_KEY`
- Node 18 or newer and npm (optional, for the TypeScript client)

## Reading order

Follow this path to go from zero to a deployed agent:

| Step | Duration | What you'll learn |
|---|---|---|
| [Installation](/docs/get-started/installation) | 5 min | Install the Python library, API server, and TypeScript client; set up API keys |
| [Quickstart: First agent](/docs/get-started/first-agent) | 10 min | Build a working agent with two tools, serve it over HTTP, and call it from curl and TypeScript |
| [Tutorial: Mental model](/docs/get-started/tutorial/mental-model) | 10 min | Understand the core concepts: messages, state, nodes, edges, graphs, agents, and threads |
| [Tutorial: Build a graph](/docs/get-started/tutorial/build-a-graph) | 15 min | Build a graph by hand, add tools, and understand when to use ReactAgent vs custom graphs |
| [Tutorial: Threads and memory](/docs/get-started/tutorial/threads-and-memory) | 10 min | Run agents with persistent memory across invocations using checkpointers |
| [Tutorial: Serve and inspect](/docs/get-started/tutorial/serve-and-inspect) | 10 min | Serve your graph with the API server, use the Swagger UI and playground, and read thread state |
| [Tutorial: Call from your app](/docs/get-started/tutorial/call-from-your-app) | 10 min | Build a front-end with the TypeScript client, handle streaming, and manage sessions |
| [Project structure](/docs/get-started/project-structure) | 5 min | See what the production template generates and where each piece lives |

The tutorial builds on one agent across its steps, so follow it in order. Skip it if you only want a running server: the quickstart is enough.

The next major section, [Concepts](/docs/concepts), explains how everything works under the hood. [Guides](/docs/guides) covers task-oriented recipes (add memory, use MCP, deploy to Kubernetes), and [API reference](/docs/reference) documents every class, function, and route.

## Rename note

10xGraph was published under the name "Agentflow" until 2026. The Python library now imports from `tenxgraph` (for example `from tenxgraph.core.graph import StateGraph`), the PyPI package is `10xgraph`, and the command is `10xgraph`. The old `agentflow` imports still work as a deprecated alias until version 2.0. The old package name `10xscale-agentflow` is no longer updated; install `10xgraph` instead.
