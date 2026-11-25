---
title: Choose and use prebuilt agents
description: 'Choose between the seven prebuilt agents: ReactAgent, PlanActReflectAgent, StructuredOutputAgent, SupervisorTeamAgent, SwarmAgent, RAGAgent and AudioAgent.'
section: "Build agents"
group: "Prebuilt agents"
order: 80
label: Prebuilt agents
updated: "2026-11-26"
---

10xGraph ships seven prebuilt agents. Each builds a wired `StateGraph` behind one constructor, and `compile()` returns a `CompiledGraph` you run or serve like any graph you wrote by hand.

<aside class="callout callout-note" role="note"><p class="callout-title">The set is closed</p>

The prebuilt agents cover the common patterns and are not growing. For anything else, build your own graph with `StateGraph` and `Agent`. See [Build a graph](/docs/guides/build-a-graph).

</aside>

Install the core package with the provider extra your samples use, for example `pip install "10xgraph[openai]"` or `pip install "10xgraph[google-genai]"`. RAGAgent also needs a vector store extra (`qdrant` or `pgvector`), and AudioAgent needs `google-genai` and `realtime`.

## Quick comparison

| Agent | Use when | Graph shape |
|---|---|---|
| [ReactAgent](/docs/guides/prebuilt/react-agent) | One model calls tools in a loop until done | MAIN -> TOOL (conditional) -> END |
| [PlanActReflectAgent](/docs/guides/prebuilt/plan-act-reflect-agent) | Task needs a plan, execution, and reflection cycle | PLAN -> ACT -> REFLECT (conditional loop) -> END |
| [StructuredOutputAgent](/docs/guides/structured-output) | Output must match a Pydantic schema | GENERATE -> REPAIR (if invalid) -> GENERATE, with optional TOOL -> END |
| [RAGAgent](/docs/guides/prebuilt/rag-agent) | Answers must come from a document store | RETRIEVE -> (RERANK) -> SYNTHESIZE -> END |
| [SupervisorTeamAgent](/docs/guides/prebuilt/supervisor-team-agent) | One coordinator routes tasks to specialists | SUPERVISOR -> worker (conditional) -> PRE_SUPERVISOR -> SUPERVISOR, or END |
| [SwarmAgent](/docs/guides/prebuilt/swarm-agent) | Peer agents hand off to each other | Members hand off to each other, then END |
| [AudioAgent](/docs/guides/use-realtime-audio) | Real-time audio conversations (Gemini Live) | LIVE (streaming audio session) |

## Add your tools

ReactAgent, PlanActReflectAgent, StructuredOutputAgent and AudioAgent take a `tools` list of plain functions, `@tool` functions or MCP tools. Supervisor and Swarm members carry tools on their own `Agent`. See [Use the tool decorator](/docs/guides/use-tool-decorator) and [Use MCP](/docs/guides/use-mcp).

## Compile and run

Every prebuilt agent's `compile()` takes the same arguments as `StateGraph.compile()`, including `media_policy`. AudioAgent raises `ValueError` if you pass a `media_store`, because realtime media is not stored:

```python
from tenxgraph.storage.checkpointer import InMemoryCheckpointer

app = agent.compile(
    checkpointer=InMemoryCheckpointer(),  # or PgCheckpointer for production
    store=memory_store,                    # for long-term memory
    interrupt_before=["TOOL"],             # pause before tool node (ReactAgent node names)
    interrupt_after=["MAIN"],              # pause after main node
    callback_manager=callback_manager,     # lifecycle hooks
    media_store=media_store,               # for multimodal content
    shutdown_timeout=30.0,                 # graceful shutdown wait
)
```

Once compiled, use `invoke()`, `ainvoke()`, `astream()`, `stream()` or serve over the API server. See [Build a graph](/docs/guides/build-a-graph) for examples of running and routing.

## When to move to a custom graph

When you need a different control flow, parallel agent steps, custom state or a node that is not an `Agent` or `ToolNode`, read the agent's page for its graph layout and rebuild it as a `StateGraph`. See [When a prebuilt agent fits](/docs/concepts/choosing-a-building-block#when-a-prebuilt-agent-fits) and [Build a graph](/docs/guides/build-a-graph).

## Run it in production

Every prebuilt agent compiles to an ordinary graph, so `10xgraph dev` serves it with no extra code. Pass a durable checkpointer to `compile()` and turn on auth before exposing it. See [Production readiness](/docs/production) and the [production checklist](/docs/server/production-checklist).
