---
title: AI Agent Glossary
seoTitle: "AI agent glossary: definitions and examples"
description: Plain definitions of AI agent terms, from ReAct agents and state graphs to MCP, RAG, durable execution and idempotent tool calls, with Python examples.
section: Glossary
order: 10
label: Glossary
updated: "2026-10-27"
---

The glossary defines the terms that come up most often when building Python AI agents, from the ReAct loop to the production concerns that decide whether an agent survives real traffic. Each entry opens with a short definition, then shows how the concept works in [10xGraph](/docs/get-started) with Python examples.

## Start here

New to agents? Read [What is an AI agent?](/docs/glossary/what-is-an-ai-agent), then [What is a ReAct agent?](/docs/glossary/what-is-a-react-agent) for the tool-calling loop most agents are built on, and [What is a state graph?](/docs/glossary/what-is-a-state-graph) for how 10xGraph models a workflow as nodes and edges.

If you are heading to production, two terms matter most. [What is durable execution?](/docs/glossary/what-is-durable-execution) explains how a run can survive a crash and resume, and [What is an idempotent tool call?](/docs/glossary/what-is-an-idempotent-tool-call) explains how to avoid charging a card or sending an email twice when that resume happens. Both connect to [Replay-safe tools](/docs/concepts/replay-safe-tools), the 10xGraph mechanism that records finished tool calls so they are not re-executed.

For connecting an agent to the outside world, read [What is the Model Context Protocol?](/docs/glossary/what-is-model-context-protocol), and for state across turns, [What is agent memory?](/docs/glossary/what-is-agent-memory).

## Core concepts

| Term | Definition |
|------|-----------|
| [What is an AI agent?](/docs/glossary/what-is-an-ai-agent) | A program that uses an LLM to perceive inputs, reason, call tools, and take actions in a loop to complete multi-step tasks |
| [What is a ReAct agent?](/docs/glossary/what-is-a-react-agent) | An agent that alternates between Reasoning and Acting steps: calling tools, observing results, and reasoning again until it has an answer |
| [What is multi-agent orchestration?](/docs/glossary/what-is-multi-agent-orchestration) | Coordinating multiple specialized AI agents so they collaborate on a shared goal, with explicit handoffs and control flow |
| [What is a state graph?](/docs/glossary/what-is-a-state-graph) | A graph-based model for agent workflows where nodes are processing steps and edges define how state moves between them |
| [What is agent memory?](/docs/glossary/what-is-agent-memory) | The mechanisms by which an AI agent stores and retrieves information across turns, sessions, and restarts |
| [What is the Model Context Protocol (MCP)?](/docs/glossary/what-is-model-context-protocol) | An open standard that lets AI agents connect to external tools and data sources through a common interface |
| [What is RAG?](/docs/glossary/what-is-retrieval-augmented-generation) | Retrieval-Augmented Generation: a pattern where an agent retrieves relevant documents before generating a response |
| [What is durable execution?](/docs/glossary/what-is-durable-execution) | Running a workflow so progress is saved and a crashed run resumes where it stopped instead of starting over |
| [What is an idempotent tool call?](/docs/glossary/what-is-an-idempotent-tool-call) | A tool call that can run more than once without repeating its side effect, such as a second charge or email |
| [What is agent streaming?](/docs/glossary/what-is-agent-streaming) | Sending AI agent responses token-by-token to a frontend instead of waiting for the full response to complete |
| [What is thread isolation?](/docs/glossary/what-is-thread-isolation) | Each user can read and run only the conversation threads they own, enforced by the server on every request |
| [What is prompt injection?](/docs/glossary/what-is-prompt-injection) | Text that makes a model follow an attacker's instructions instead of yours, directly or through content the agent reads |

## Related

- [Compare frameworks](/docs/compare): 10xGraph vs LangGraph, CrewAI, AutoGen, Google ADK
- [Get started with 10xGraph](/docs/get-started): build your first agent in Python
- [Prebuilt agents](/docs/guides/prebuilt/react-agent): ReactAgent, RAGAgent, SwarmAgent, and more
