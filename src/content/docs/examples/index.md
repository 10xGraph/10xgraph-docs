---
title: Examples
description: Runnable examples and reference architectures demonstrating 10xGraph agents, tools, streaming, MCP, memory, and multi-agent patterns.
section: Examples
order: 10
label: Overview
updated: "2026-10-27"
---

The examples section provides two types of learning resources. The first are guided walkthroughs of working example scripts from the repository's `examples/` folder: each covers a specific feature or pattern (agents, custom state, tools, streaming, MCP, memory, multi-agent handoff, testing and evaluation). The second are reference architectures for five common production use cases (customer support, data extraction, coding, research and RAG agents). A Production group comes first on this page: it shows the same kind of agent served by 10xgraph-api. Together they show how 10xGraph concepts translate into real, runnable code.

These examples sit between the quickstart and the reference documentation. If you learn best from reading and running actual code, start here. If you prefer concepts first, read the Concepts section and return here to see the patterns in action.

## Getting started with examples

The examples are located in the repository at `examples/`. Each example directory contains one or more runnable Python scripts (for example `graph.py`) and sometimes a `README.md` with setup instructions.

### Clone the repository

Start by cloning the 10xGraph repository:

```bash
git clone https://github.com/10xGraph/10xGraph.git
cd 10xGraph
```

### Install with example dependencies

Most examples need a provider SDK. Install 10xGraph with the providers your examples require:

```bash
# Google Gemini examples
pip install "10xgraph[google-genai]"

# OpenAI examples
pip install "10xgraph[openai]"

# Anthropic (Claude) examples
pip install "10xgraph[anthropic]"

# MCP, memory, and other integrations
pip install "10xgraph[mcp,qdrant,pg_checkpoint]"
```

For complete functionality, install everything:

```bash
pip install "10xgraph[all]"
```

### Set environment variables

Each example requires API keys for the model provider. Create a `.env` file in the repository root (the `10xGraph/` folder):

```bash
# For Google Gemini
GEMINI_API_KEY=your-key-here

# For OpenAI
OPENAI_API_KEY=your-key-here

# For Anthropic
ANTHROPIC_API_KEY=your-key-here
```

Load these in your script or shell:

```bash
export $(cat .env | xargs)
```

### Run an example

Navigate to an example directory and run its script:

```bash
cd examples/agent-class
python graph.py
```

Some examples have additional setup (MCP servers, database initialization). Check the example's `README.md`, where one exists.

## What you'll learn

The examples are organized in groups that build on each other. If you want to see the served agent first, start with Production. Otherwise start with the Foundations group to understand the core patterns, then move into advanced integrations, streaming, multi-agent coordination, and production-ready testing and evaluation.

### Production

These examples show the agent served by `10xgraph-api`, with auth, thread isolation, approvals and replay-safe tools. Each page says which provider extra and key it needs.

- [Serve with auth](/docs/examples/serve-with-auth): `10xgraph init`, a token, curl and `TenxGraphClient`, then `10xgraph build --docker-compose`
- [Replay-safe payment tool](/docs/examples/payment-tool-replay-safe): approval before a charge, the checkpointer tool ledger and an idempotency key
- [Human approval over the API](/docs/examples/human-approval-over-api): pause with `interrupt()`, resume with `interrupt_id`, and the 409 and 422 cases
- [Multi-user isolation](/docs/examples/multi-user-isolation): two users, one server, and what each can reach
- [Safe file and web tools](/docs/examples/safe-file-and-web-tools): a fixed file root, a host-restricted fetch tool and a media download policy
- [Security regression evals](/docs/examples/security-regression-evals): fail the build when an agent calls a tool outside its allow-list

### Foundations

The basics: how to define agents and tools, custom state, and the ReAct loop. These examples form the foundation for all other patterns.

- [Agent Class Pattern](/docs/examples/agent-class): The smallest useful agent, showing the Agent class and how to invoke it
- [Custom State](/docs/examples/custom-state): Define application-specific state beyond messages
- [Tool Decorator](/docs/examples/tool-decorator): Create tools with type hints and automatic schema generation
- [ReAct Agent](/docs/examples/react-agent): Multi-turn agent loop with tool calling and routing
- [ReAct Agent with Validation](/docs/examples/react-agent-validation): Input validation and error handling in agents
- [Google GenAI](/docs/examples/google-genai): Using Google's Gemini model as the LLM provider

### Streaming

Real-time output and cancellation. Essential for interactive applications.

- [React Streaming](/docs/examples/react-streaming): Token-by-token streaming from the agent
- [Stop Stream](/docs/examples/stop-stream): Cancel a running agent mid-execution

### Tools and MCP

Integrating external systems via tools and the Model Context Protocol.

- [Dependency Injection](/docs/examples/dependency-injection): Pass database connections, config and user context into tools
- [MCP Server](/docs/examples/mcp-server): Implement a Model Context Protocol server
- [MCP Client](/docs/examples/mcp-client): Connect to an MCP server and use its tools
- [MCP ReAct Agent](/docs/examples/mcp-react-agent): Combine ReAct with MCP tools
- [GitHub MCP](/docs/examples/github-mcp): Real-world example using GitHub's MCP server

### Multi-agent

Patterns for agents calling other agents and handling handoffs.

- [Multiagent](/docs/examples/multiagent): Multiple agents in one graph, routing between them
- [Handoff](/docs/examples/handoff): Agent handoff patterns with context transfer

### Memory and media

Persistent agent memory and multimodal input (images, audio, documents).

- [Memory](/docs/examples/memory): Store and retrieve long-term agent memory
- [Multimodal](/docs/examples/multimodal): Process images and other media alongside text

### Testing and operations

Testing, evaluation, and graceful operation.

- [Skills](/docs/examples/skills): Load Agent Skills (SKILL.md folders) on demand alongside normal tools
- [Testing](/docs/examples/testing): Unit tests and mocked LLM calls for agent logic
- [Evaluation](/docs/examples/evaluation): Define eval sets and run evaluations against a dataset
- [Graceful Shutdown](/docs/examples/graceful-shutdown): Clean shutdown handling and resource cleanup

### Use cases

Complete reference architectures for five common agent patterns. Each one shows the graph topology, the tools needed, and what to monitor in production.

- [Customer Support Agent](/docs/examples/customer-support-agent): Multi-tool support flow with human handoff and refund handling
- [Data Extraction Agent](/docs/examples/data-extraction-agent): Structured data extraction from unstructured documents and text
- [Coding Agent](/docs/examples/coding-agent): Code generation, review, and tool-based execution
- [Research Agent](/docs/examples/research-agent): Web search combined with synthesis and citations
- [RAG Agent](/docs/examples/rag-agent): Chat-with-your-docs with retrieval, grounding and citations

## Learning path

If you are new to 10xGraph, follow this recommended order:

1. **Start with the Foundations group.** Begin with Agent Class Pattern to see the smallest useful graph. Continue with Custom State and Tool Decorator to understand state and tools, then build the ReAct Agent to assemble the core loop.

2. **Add real-time interaction.** Move to the Streaming group to learn token-by-token output and cancellation, essential for interactive UIs.

3. **Integrate external systems.** The Tools and MCP group shows how to connect APIs, databases and the Model Context Protocol.

4. **Coordinate multiple agents.** The Multi-agent group covers routing and handoff patterns.

5. **Persist and enrich data.** Memory and media examples demonstrate long-term memory and multimodal input.

6. **Test and operate.** The Testing and operations group covers testing, evaluation and clean shutdown.

   **Serve it safely.** The Production group shows the same agents behind `10xgraph-api`: auth, isolation, approvals and replay-safe tools.

7. **Pick your use case.** Once you understand the patterns, the Use cases group shows how to apply them end-to-end.

## Before you start

Most examples assume:

- Python 3.12 or later
- 10xGraph installed with the appropriate provider extra (google-genai, openai, or anthropic)
- Environment variables set for API keys
- For MCP and some advanced examples, additional system dependencies (see the example's README, where one exists)

## Related docs

- [Get started](/docs/get-started): The quickstart and tutorial path
- [Concepts](/docs/concepts): Deep dives into state graphs, agents, tools and more
- [Guides](/docs/guides): Task-focused how-tos for building agents
- [Reference](/docs/reference): Complete API documentation
