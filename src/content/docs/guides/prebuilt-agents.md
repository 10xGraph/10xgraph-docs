---
title: Choose and use prebuilt agents
description: "Overview of ReactAgent, PlanActReflectAgent, StructuredOutputAgent, SupervisorTeamAgent, SwarmAgent, RAGAgent, and AudioAgent with quick comparison and code snippets."
section: "Build agents"
group: "Prebuilt agents"
order: 80
label: Prebuilt agents
updated: "2026-10-27"
---

10xGraph ships seven prebuilt agent classes that wrap a fully wired `StateGraph` behind a single constructor and `compile()` call. Each is a ready-made pattern for a common orchestration task. They compile to a `CompiledGraph` you can `invoke()`, `astream()`, or serve over the API server just like any graph you wrote by hand. This page helps you choose the right agent and points to detailed guides for each.

Install the core package with the provider extra your samples use, for example `pip install "10xgraph[openai]"` or `pip install "10xgraph[google-genai]"`. RAGAgent also needs the `qdrant` extra, and AudioAgent needs `google-genai` and `realtime`.

## Why prebuilt agents

A prebuilt agent solves the wiring problem: routing logic, message handling, loop termination, state reduction, and error recovery are already implemented. You provide the model, tools, and optional system prompt. When a prebuilt agent no longer fits your use case, move to a custom `StateGraph` and reuse the same components (you can read the agent's source to see exactly how it builds the graph).

## Quick comparison

| Agent | Use when | Graph shape |
|---|---|---|
| [ReactAgent](/docs/guides/prebuilt/react-agent) | One model calls tools in a loop until done | MAIN -> TOOL (conditional) -> END |
| [PlanActReflectAgent](/docs/guides/prebuilt/plan-act-reflect-agent) | Task needs a plan, execution, and reflection cycle | PLAN -> ACT -> REFLECT (conditional loop) -> END |
| [StructuredOutputAgent](/docs/guides/prebuilt/structured-output-agent) | Output must match a Pydantic schema | GENERATE -> REPAIR (if invalid) -> GENERATE, with optional TOOL -> END |
| [RAGAgent](/docs/guides/prebuilt/rag-agent) | Answers must come from a document store | RETRIEVE -> (RERANK) -> SYNTHESIZE -> END |
| [SupervisorTeamAgent](/docs/guides/prebuilt/supervisor-team-agent) | One coordinator routes tasks to specialists | SUPERVISOR -> worker (conditional) -> PRE_SUPERVISOR -> SUPERVISOR, or END |
| [SwarmAgent](/docs/guides/prebuilt/swarm-agent) | Peer agents hand off to each other | Members hand off to each other, then END |
| [AudioAgent](/docs/guides/prebuilt/audio-agent) | Real-time audio conversations (Gemini Live) | LIVE (streaming audio session) |

## Each prebuilt agent

### ReactAgent

The most common pattern. A single LLM calls tools in a loop, processes results, and decides what to do next until it has enough information to answer the user's question.

```python
from tenxgraph.prebuilt.agent import ReactAgent
from tenxgraph.prebuilt.tools import fetch_url, safe_calculator

agent = ReactAgent(
    model="gpt-4o",
    tools=[fetch_url, safe_calculator],
)
app = agent.compile()
```

**When to use:** Answering questions, research, data gathering, or any task where the agent needs to choose its own tools and loop until done. This is the default starting point.

See [ReactAgent](/docs/guides/prebuilt/react-agent) for customization, system prompts, MCP integration, and the full constructor.

### PlanActReflectAgent

Breaks complex multi-step tasks into three phases: first the LLM plans the steps, then it executes each using tools, then a reflector evaluates success and decides whether to continue or replan.

```python
from tenxgraph.prebuilt.agent import PlanActReflectAgent
from tenxgraph.prebuilt.tools import fetch_url, google_web_search

agent = PlanActReflectAgent(
    model="gpt-4o",
    tools=[fetch_url, google_web_search],
)
app = agent.compile()
```

**When to use:** Complex research, report writing, multi-part analysis, or any task where you want explicit visibility into planning and self-correction. Costs more (three LLM calls per task) but better for intricate goals.

See [PlanActReflectAgent](/docs/guides/prebuilt/plan-act-reflect-agent) for step configuration and graph layout.

### StructuredOutputAgent

Guarantees the response is a JSON object matching a Pydantic schema. The agent tries once, and if the output is invalid JSON or fails schema validation, a repair node tries to fix it before returning.

```python
from pydantic import BaseModel
from tenxgraph.prebuilt.agent import StructuredOutputAgent

class ReviewData(BaseModel):
    sentiment: str
    score: float
    summary: str

agent = StructuredOutputAgent(
    model="gpt-4o",
    output_schema=ReviewData,
)
app = agent.compile()
```

**When to use:** Data extraction, classification, form filling, or any task where you need reliable structured output. The schema is also forwarded to the LLM as a constraint, improving accuracy.

See [StructuredOutputAgent](/docs/guides/prebuilt/structured-output-agent) for repair strategies and options.

### RAGAgent

Retrieval-augmented generation. Queries a document store to find relevant context, optionally reranks results, and passes them to a wrapped agent so answers come from your documents. The documents are added to the model request only, not to the saved thread.

```python
from tenxgraph.prebuilt.agent import RAGAgent
from tenxgraph.core.graph import Agent
from tenxgraph.storage import create_local_qdrant_store
from tenxgraph.storage.store.embedding import OpenAIEmbedding

store = create_local_qdrant_store(
    path="./knowledge_base",
    embedding=OpenAIEmbedding(model="text-embedding-3-small"),
)

agent = RAGAgent(
    store=store,
    agent=Agent(model="gpt-4o-mini"),
    top_k=5,
)
app = agent.compile()
```

**When to use:** Customer support bots, internal knowledge bases, company-specific Q&A, or any task where the answer must come from a known set of documents. Reduces hallucination and ensures sources.

See [RAGAgent](/docs/guides/prebuilt/rag-agent) for store setup, reranking, and retrieval strategies.

### SupervisorTeamAgent

A supervisor LLM receives the request and routes it to one of several specialist worker agents. Each worker is a fully configured agent with its own model, tools, and prompt. The supervisor orchestrates routing based on the task.

```python
from tenxgraph.prebuilt.agent import SupervisorTeamAgent, WorkerConfig
from tenxgraph.core.graph import Agent, ToolNode

supervisor = SupervisorTeamAgent(
    supervisor_model="gpt-4o",
    workers={
        "ORDERS": WorkerConfig(
            agent=Agent(model="gpt-4o-mini", tool_node=ToolNode([lookup_order])),
            description="Handles order lookups.",
        ),
        "REFUNDS": WorkerConfig(
            agent=Agent(model="gpt-4o-mini", tool_node=ToolNode([refund_order])),
            description="Handles refunds.",
        ),
    },
)
app = supervisor.compile()
```

**When to use:** Multi-domain systems where different tasks require different tools or expertise (e.g., a support agent with orders, refunds, billing). A centralized router keeps decisions clear.

See [SupervisorTeamAgent](/docs/guides/prebuilt/supervisor-team-agent) for worker configuration, custom routing prompts, and scaling.

### SwarmAgent

Peer agents hand off directly to each other without a central supervisor. Each member decides which other member (if any) should handle the task next. Handoff tools are injected automatically.

```python
from tenxgraph.prebuilt.agent import SwarmAgent, SwarmMemberConfig
from tenxgraph.core.graph import Agent, ToolNode

swarm = SwarmAgent(
    members={
        "TRIAGE": SwarmMemberConfig(
            agent=Agent(model="gpt-4o-mini"),
            can_handoff_to=["ORDERS", "REFUNDS"],
            description="Routes requests.",
        ),
        "ORDERS": SwarmMemberConfig(
            agent=Agent(model="gpt-4o", tool_node=ToolNode([lookup_order])),
            can_handoff_to=["REFUNDS"],
            description="Handles orders.",
        ),
        "REFUNDS": SwarmMemberConfig(
            agent=Agent(model="gpt-4o", tool_node=ToolNode([refund_order])),
            can_handoff_to=[],
            description="Handles refunds.",
        ),
    },
    entry="TRIAGE",
)
app = swarm.compile()
```

**When to use:** Systems where agents collaborate and hand off to peers (vs. one central router). Good for flexible workflows and decentralized decision-making.

See [SwarmAgent](/docs/guides/prebuilt/swarm-agent) for member configuration, handoff permissions, and parallel thinking.

### AudioAgent

Enables real-time audio-to-audio conversations through Gemini Live (streaming audio sessions). The agent listens, processes, and responds with audio in a single bidirectional stream.

```python
from tenxgraph.prebuilt.agent import AudioAgent
from tenxgraph.prebuilt.tools import fetch_url, safe_calculator

agent = AudioAgent(
    model="gemini-2.5-flash",
    tools=[fetch_url, safe_calculator],
)
# Driven by CompiledGraph.arealtime(), not invoke() or stream()
```

**When to use:** Real-time voice applications, audio chatbots, conversational interfaces, or any task where low-latency audio I/O is critical. Requires Gemini Live and WebSocket or similar transport.

See [AudioAgent](/docs/guides/prebuilt/audio-agent) for realtime configuration, stream handling, and tools.

## Extending with custom tools

ReactAgent, PlanActReflectAgent, StructuredOutputAgent and AudioAgent accept a `tools` list. (Supervisor and Swarm members carry tools on their own `Agent`, as shown above.) Pass prebuilt tools together with your own functions:

```python
from tenxgraph.prebuilt.agent import ReactAgent
from tenxgraph.prebuilt.tools import safe_calculator

def lookup_order(order_id: str) -> str:
    """Fetch the status of an order."""
    return f"Order {order_id}: shipped."

agent = ReactAgent(
    model="gpt-4o-mini",
    tools=[lookup_order, safe_calculator],
)
app = agent.compile()
```

Type hints and the docstring tell the LLM the tool's schema automatically; the optional `@tool` decorator adds metadata such as tags. See [Use the tool decorator](/docs/guides/use-tool-decorator) for how to define tools with parameters, error handling, and dependency injection.

## Compile and run

The tool-calling agents (ReactAgent, PlanActReflectAgent, StructuredOutputAgent, RAGAgent) share this `compile()` signature. AudioAgent's `compile()` accepts only `checkpointer`, `store`, `callback_manager` and `shutdown_timeout`. Specify persistence and callbacks here:

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

Prebuilt agents are opinionated. If you need:
- A different control flow (e.g., branching that is not tool calls)
- Multiple independent agent steps in parallel
- Custom state fields beyond messages
- A node that is not an Agent or ToolNode

then read the agent's page for its graph layout, and move to a custom `StateGraph`. You get the same execution runtime, checkpointing, and streaming tools; you just define the nodes and edges yourself. See [Build a graph](/docs/guides/build-a-graph) for the pattern.

## Next steps

- Pick an agent from the table above and read its detailed guide.
- [Use the tool decorator](/docs/guides/use-tool-decorator) to write custom tools.
- [Set up checkpointing](/docs/guides/set-up-checkpointing) for state persistence.
- [Stream a graph](/docs/guides/stream-graph) to get incremental results.
