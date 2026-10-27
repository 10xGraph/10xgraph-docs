---
title: Get Started
seoTitle: Get started with 10xGraph in Python
description: "10xGraph is a production-grade Python framework for multi-agent AI systems. Install the library, build an agent, deploy the API server, and call it from TypeScript."
section: "Get started"
order: 20
label: Get Started
updated: "2026-10-27"
---

You build the agent in Python. `10xgraph-api` serves it with authentication, per-user thread isolation, rate limits, durable state, replay-safe tools and Docker and Kubernetes files. A tool that finished before a crash is not run twice on replay. This section takes you from an empty folder to a secured, running server.

## Secure by the third step

The quickstart server starts open so you can try it. Step 3 turns on JWT, and you watch the server return 401 without a token and 403 when a second user reads the first user's thread. With auth configured, the server also turns on owner-only thread access, so you do not write that code. [Security in five minutes](/docs/get-started/security-in-five-minutes) is the page; it needs one config key and two environment variables.

## The three-step path

| Step | Time | What you get |
|---|---|---|
| 1. [Install](/docs/get-started/installation) | 5 min | The library, the API server and CLI, and the TypeScript client, with a provider key set |
| 2. [Quickstart: first agent](/docs/get-started/first-agent) | 10 min | A support agent with two tools, served at `/v1/graph/invoke`, called from curl and TypeScript |
| 3. [Security in five minutes](/docs/get-started/security-in-five-minutes) | 5 min | JWT auth on, two users, a 401 for no token and a 403 for someone else's thread |

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
| [Project structure](/docs/get-started/project-structure) | 5 min | What the production template generates |

## Prerequisites

To get started, you need:

- Python 3.12 or newer
- An API key for one LLM provider: `OPENAI_API_KEY`, `GEMINI_API_KEY` (or `GOOGLE_API_KEY`), or `ANTHROPIC_API_KEY`
- Node 18 or newer and npm (optional, for the TypeScript client)

The next major section, [Concepts](/docs/concepts), explains how everything works under the hood. [Guides](/docs/guides) covers task-oriented recipes (add memory, use MCP, deploy to Kubernetes), and [API reference](/docs/reference) documents every class, function, and route.

## Rename note

10xGraph was published under the name "Agentflow" until 2026. The Python library now imports from `tenxgraph` (for example `from tenxgraph.core.graph import StateGraph`), the PyPI package is `10xgraph`, and the command is `10xgraph`. The old `agentflow` imports still work as a deprecated alias until version 2.0. The old package name `10xscale-agentflow` is no longer updated; install `10xgraph` instead.
