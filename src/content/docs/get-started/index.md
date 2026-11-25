---
title: Get Started
seoTitle: Get started with 10xGraph in Python
description: "10xGraph is open-source, self-hosted infrastructure for AI applications. Install the library, build an agent, deploy the API server, and call it from TypeScript."
section: "Get started"
order: 20
label: Get Started
updated: "2026-11-25"
---

10xGraph is open-source, self-hosted infrastructure for AI applications. You write the agents, tools and tasks; 10xGraph runs them behind an API server with authentication, role-based access, tenant isolation, durable state in Postgres and Redis, background jobs, metrics and tracing, and generates Docker and Kubernetes deploy files. This section takes you from an empty folder to a secured, running server.

## How you work with 10xGraph

| Step | Command | What happens |
|---|---|---|
| 1 | `10xgraph init` | Scaffolds a project. It asks three questions: name, template and provider. |
| 2 | `10xgraph dev` | Starts the API server on `127.0.0.1:8000` and opens the playground in your browser. Chat with your agent and inspect threads and runs. No frontend to write. |
| 3 | `10xgraph config` | Opens a browser editor for every server setting in `10xgraph.json`. |

Later, `10xgraph build` writes the Docker and Kubernetes files for deployment. Details are in [Playground](/docs/server/playground).

## The two-step path

| Step | Time | What you get |
|---|---|---|
| 1. [Install](/docs/get-started/installation) | 5 min | The library, the API server and CLI, and the TypeScript client, with a provider key set |
| 2. [Quickstart: first agent](/docs/get-started/first-agent) | 10 min | A support agent scaffolded with `10xgraph init`, tried in the playground, called from curl and TypeScript, with JWT on and Docker files written |

After that, read [Production readiness](/docs/production) for what the server gives you and what stays your job, then the [production checklist](/docs/server/production-checklist) before you deploy.

## The three packages

- **Core library** (`10xgraph`, import `tenxgraph`): `StateGraph`, the prebuilt `ReactAgent` and other agents, tools, checkpointing and memory. You can run an agent from Python with no server.
- **API server and CLI** (`10xgraph-api`, import `tenxgraph_api`, command `10xgraph`): REST, WebSocket and realtime audio endpoints generated from your compiled graph, plus auth, authorization, rate limiting, thread and memory routes, and `10xgraph build` for Docker and Kubernetes files.
- **TypeScript client** (`10xgraph-client`, class `TenxGraphClient`): typed invoke, stream, threads, memory and files for Node.js and browsers.

## Go deeper

The tutorial builds one agent across several pages, so follow it in order. Skip it if you only want a running server.

| Page | Time | What you learn |
|---|---|---|
| [Tutorial: Mental model](/docs/get-started/tutorial/mental-model) | 10 min | Messages, state, nodes, edges, graphs, agents and threads |
| [Tutorial: Build a graph](/docs/get-started/tutorial/build-a-graph) | 15 min | A graph by hand, tools, and when to use `ReactAgent` or a custom graph |
| [Tutorial: Threads and memory](/docs/get-started/tutorial/threads-and-memory) | 10 min | Persistent memory across invocations with checkpointers |
| [Tutorial: Serve and inspect](/docs/get-started/tutorial/serve-and-inspect) | 10 min | The Swagger UI, the playground and reading thread state |
| [Tutorial: Call from your app](/docs/get-started/tutorial/call-from-your-app) | 10 min | A front end with the TypeScript client, streaming and sessions |
| [Tutorial: Stream and approve](/docs/get-started/tutorial/stream-and-approve) | 10 min | Streaming and pausing for human approval |
| [Tutorial: Test and evaluate](/docs/get-started/tutorial/test-and-evaluate) | 10 min | Offline tests with `TestAgent` and an eval run |
| [Project structure](/docs/get-started/project-structure) | 5 min | What the Full setup generates |

## Prerequisites

You need:

- Python 3.12 or newer
- An API key for one LLM provider: `OPENAI_API_KEY`, `GEMINI_API_KEY` (or `GOOGLE_API_KEY`), or `ANTHROPIC_API_KEY`
- Node 20 or newer and npm (optional, for the TypeScript client)

The next major section, [Concepts](/docs/concepts), explains how everything works under the hood. [Guides](/docs/guides) covers task-oriented recipes (add memory, use MCP, deploy to Kubernetes), and [API reference](/docs/reference) documents every class, function, and route.

## Rename note

10xGraph was called Agentflow. The old `agentflow` import and command still work until 2.0; see [Coming from agentflow](/docs/get-started/coming-from-agentflow).
