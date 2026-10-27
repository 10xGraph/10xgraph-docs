---
title: "Prebuilt agents"
description: "API reference for built-in agent patterns: ReactAgent, RAGAgent, PlanActReflectAgent, StructuredOutputAgent, SupervisorTeamAgent, SwarmAgent, and AudioAgent."
order: 240
group: "Python library"
section: Reference
updated: "2026-10-27"
---

Prebuilt agents are ready-made graphs for common patterns such as tool loops, retrieval, planning and teams. Import them from `tenxgraph.prebuilt.agent`, construct one, and call `compile()` to get a `CompiledGraph`. Extra keyword arguments pass through to the internal `Agent`. To choose between them, see the [prebuilt agents guide](/docs/guides/prebuilt-agents).

```python
from tenxgraph.prebuilt.agent import (
    ReactAgent,
    RAGAgent,
    PlanActReflectAgent,
    StructuredOutputAgent,
    SupervisorTeamAgent,
    SwarmAgent,
    AudioAgent,
    BaseReranker,
    CohereReranker,
    CrossEncoderReranker,
    WorkerConfig,
    SwarmMemberConfig,
)
```

All classes in this page are exported from that package. Install the provider extra your model needs, for example `pip install "10xgraph[openai]"` or `pip install "10xgraph[google-genai]"`. Examples use `await`, so run them inside an `async def` driven by `asyncio.run(...)`, as the first example shows.

## ReactAgent

Single-agent ReAct loop: agent generates text, checks if it needs tools, executes them, and repeats until it returns a final answer. The simplest prebuilt agent; start here for tool-use problems.

### ReactAgent.__init__

```python
def __init__(
    self,
    model: str,
    state: StateT | None = None,
    context_manager: BaseContextManager[StateT] | None = None,
    publisher: BasePublisher | list[BasePublisher] | None = None,
    id_generator: BaseIDGenerator = DefaultIDGenerator(),
    container: InjectQ | None = None,
    *,
    output_type: str = "text",
    system_prompt: list[dict[str, Any]] | None = None,
    tools: Iterable[Callable] | None = None,
    client: Any = None,
    pass_user_info_to_mcp: bool = False,
    extra_messages: list[Message] | None = None,
    trim_context: bool = False,
    tools_tags: set[str] | None = None,
    reasoning_config: dict[str, Any] | bool | None = True,
    skills: SkillConfig | None = None,
    memory: MemoryConfig | None = None,
    retry_config: Any = True,
    fallback_models: list[str | tuple[str, str]] | None = None,
    multimodal_config: MultimodalConfig | None = None,
    output_schema: Any | None = None,
    main_node_name: str = "MAIN",
    tool_node_name: str = "TOOL",
    **agent_kwargs: Any,
)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `model` | `str` | required | LLM model identifier (e.g. `"gpt-4o-mini"`, `"gemini-2.0-flash"`). |
| `state` | `StateT \| None` | `None` | Custom AgentState subclass instance. |
| `context_manager` | `BaseContextManager[StateT] \| None` | `None` | Message context trimming or summarization strategy. |
| `publisher` | `BasePublisher \| list[BasePublisher] \| None` | `None` | Event publisher for streaming/logging. |
| `id_generator` | `BaseIDGenerator` | `DefaultIDGenerator()` | Run and message ID generator. |
| `container` | `InjectQ \| None` | `None` | Dependency-injection container. |
| `output_type` | `str` | `"text"` | Expected output format: `"text"`, `"json"`, `"image"`, `"audio"`, etc. |
| `system_prompt` | `list[dict[str, Any]] \| None` | `None` | List of system message dicts. |
| `tools` | `Iterable[Callable] \| None` | `None` | Tools available to the agent. |
| `client` | `Any` | `None` | MCP client (fastmcp) for tool discovery. |
| `pass_user_info_to_mcp` | `bool` | `False` | Include caller's user_id in MCP tool requests. |
| `extra_messages` | `list[Message] \| None` | `None` | Additional messages prepended to every run. |
| `trim_context` | `bool` | `False` | Enable automatic context message trimming. |
| `tools_tags` | `set[str] \| None` | `None` | Filter tools by tag (only if tools come from Skills). |
| `reasoning_config` | `dict \| bool \| None` | `True` | Extended thinking config (provider-dependent). |
| `skills` | `SkillConfig \| None` | `None` | Agent Skills configuration. |
| `memory` | `MemoryConfig \| None` | `None` | Long-term memory store configuration. |
| `retry_config` | `Any` | `True` | Retry policy for transient LLM errors. |
| `fallback_models` | `list[str \| tuple] \| None` | `None` | Fallback models if primary fails. |
| `multimodal_config` | `MultimodalConfig \| None` | `None` | Image/audio input/output handling. |
| `output_schema` | `Any` | `None` | Pydantic BaseModel or TypedDict for structured output. |
| `main_node_name` | `str` | `"MAIN"` | Graph node name for the agent. |
| `tool_node_name` | `str` | `"TOOL"` | Graph node name for tool execution. |
| `**agent_kwargs` | `Any` | `{}` | Additional arguments forwarded to the internal `Agent`. |

**Returns:** `ReactAgent[StateT]`: a configured but uncompiled agent. Call `.compile()` to get a runnable `CompiledGraph`.

**Example:**

```python
import asyncio

from tenxgraph.core.state import Message

from tenxgraph.prebuilt.agent import ReactAgent

def web_search(query: str) -> str:
    """Search the web."""
    return f"Results for {query}"

agent = ReactAgent(
    model="gpt-4o-mini",
    tools=[web_search],
)
app = agent.compile()

async def main() -> None:
    result = await app.ainvoke(
        {"messages": [Message.text_message("What is the capital of France?")]},
        config={"thread_id": "t1"},
    )
    print(result["messages"][-1].text())

asyncio.run(main())
```

### ReactAgent.compile

```python
def compile(
    self,
    checkpointer: BaseCheckpointer[StateT] | None = None,
    store: BaseStore | None = None,
    interrupt_before: list[str] | None = None,
    interrupt_after: list[str] | None = None,
    callback_manager: CallbackManager = CallbackManager(),
    media_store: BaseMediaStore | None = None,
    shutdown_timeout: float = 30.0,
) -> CompiledGraph
```

Returns a `CompiledGraph` ready to invoke. Every prebuilt agent except `AudioAgent` has this same signature; parameters control persistence, interrupts, and callbacks. If the agent has no tools, `ReactAgent` compiles to a single `MAIN` node.

---

## RAGAgent

Retrieve-Augment-Generate pattern: retrieves documents from a knowledge base, optionally reranks them, and synthesizes a final answer. Pass a store (knowledge base) and an agent (LLM for synthesis); reranking is optional.

### RAGAgent.__init__

```python
def __init__(
    self,
    store: BaseStore,
    agent: BaseAgent,
    reranker: BaseReranker | None = None,
    top_k: int = 5,
    top_n: int = 3,
    retrieval_strategy: RetrievalStrategy = RetrievalStrategy.SIMILARITY,
    score_threshold: float | None = None,
    store_config: dict[str, Any] | None = None,
    store_config_builder: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
    state: StateT | None = None,
    context_manager: BaseContextManager[StateT] | None = None,
    publisher: BasePublisher | list[BasePublisher] | None = None,
    id_generator: BaseIDGenerator = DefaultIDGenerator(),
    container: InjectQ | None = None,
)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `store` | `BaseStore` | required | Vector store (e.g. QdrantStore) containing the knowledge base. |
| `agent` | `BaseAgent` | required | Pre-built agent for answer synthesis (e.g. `Agent(model="gpt-4o")`). |
| `reranker` | `BaseReranker \| None` | `None` | Optional reranker to improve precision. |
| `top_k` | `int` | `5` | Number of candidates to retrieve from the store. Increase when using a reranker. |
| `top_n` | `int` | `3` | Number of documents to forward to the LLM after reranking. Ignored if no reranker. |
| `retrieval_strategy` | `RetrievalStrategy` | `SIMILARITY` | Search strategy passed to `store.asearch`. Members of `RetrievalStrategy`: `SIMILARITY`, `TEMPORAL`, `RELEVANCE`, `HYBRID`, `GRAPH_TRAVERSAL`. |
| `score_threshold` | `float \| None` | `None` | Minimum similarity score; `None` = no cutoff. |
| `store_config` | `dict \| None` | `None` | Extra key/value pairs passed to every store.asearch() call. Fixed for all runs. If it has no `user_id`, the search runs as `system_user_id("knowledge_base")`; index the knowledge base with `config={"user_id": system_user_id("knowledge_base")}`. |
| `store_config_builder` | `Callable[[dict], dict] \| None` | `None` | Builds the store config for each run from the run config, for example `lambda cfg: {"user_id": cfg["user_id"]}`. When set, it is used instead of `store_config`, as is, so it must include a `user_id`. Take identity from the authenticated run config, never from state. |
| `state` | `StateT \| None` | `None` | Custom AgentState subclass. |
| `context_manager` | `BaseContextManager[StateT] \| None` | `None` | Context manager. |
| `publisher` | `BasePublisher \| list \| None` | `None` | Event publisher. |
| `id_generator` | `BaseIDGenerator` | `DefaultIDGenerator()` | ID generator. |
| `container` | `InjectQ \| None` | `None` | DI container. |

**Raises:** `ValueError` if `top_k` or `top_n` is less than 1. `TypeError` at run time if documents were retrieved and `agent.execute` does not accept a `request_blocks` keyword.

**How documents reach the model:** SYNTHESIZE numbers the retrieved documents, fences them in a `<retrieved_documents_...>` block (random suffix per request, `<retrieved_documents` text inside a chunk is escaped) and passes it to `agent.execute(state, config, request_blocks=[...])`. The block is added to the latest user message of the outgoing request only, before the user's text, and after any preload memory block. The saved user message is not changed and the documents are not stored in state. A custom `agent` must accept `execute(state, config, *, request_blocks=None)`; the built-in `Agent` does.

**Returns:** `RAGAgent[StateT]`: call `.compile()` for a `CompiledGraph`.

**Example:**

```python
import asyncio

from tenxgraph.core.state import Message

from tenxgraph.core.graph import Agent
from tenxgraph.prebuilt.agent import RAGAgent
from tenxgraph.storage.store import create_local_qdrant_store
from tenxgraph.storage.store.embedding import OpenAIEmbedding

store = create_local_qdrant_store(
    path="./knowledge_base",
    embedding=OpenAIEmbedding(model="text-embedding-3-small"),
)
rag = RAGAgent(
    store=store,
    agent=Agent(model="gpt-4o-mini"),
    top_k=5,
)
app = rag.compile()

async def main() -> None:
    result = await app.ainvoke(
        {"messages": [Message.text_message("What does the documentation say about RAG?")]},
        config={"thread_id": "t1"},
    )

asyncio.run(main())
```

---

## BaseReranker

Protocol for document rerankers. Implement `async arerank(query: str, documents: list[str], top_n: int) -> list[str]` to create a custom reranker. It receives the query and candidate texts and returns the best `top_n` texts, re-ordered.

### CohereReranker

Reranker backed by the Cohere Rerank API.

```python
def __init__(
    self,
    api_key: str,
    model: str = "rerank-v4.0-pro",
)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `api_key` | `str` | required | Cohere API key. |
| `model` | `str` | `"rerank-v4.0-pro"` | Rerank model name. |

**Raises:** `ImportError` if the `cohere` package is not installed.

**Example:**

```python
from tenxgraph.core.graph import Agent
from tenxgraph.prebuilt.agent import CohereReranker, RAGAgent

# `store` is the knowledge-base store built in the RAGAgent example above.
rag = RAGAgent(
    store=store,
    agent=Agent(model="gpt-4o"),
    reranker=CohereReranker(api_key="...", model="rerank-v4.0-pro"),
    top_k=20,
    top_n=5,
)
```

### CrossEncoderReranker

Fully local reranker using sentence-transformers CrossEncoder.

```python
def __init__(
    self,
    model: str = "cross-encoder/ms-marco-MiniLM-L-6-v2",
)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `model` | `str` | `"cross-encoder/ms-marco-MiniLM-L-6-v2"` | HuggingFace model identifier. |

**Raises:** `ImportError` if the `sentence-transformers` package is not installed.

**Example:**

```python
from tenxgraph.core.graph import Agent
from tenxgraph.prebuilt.agent import CrossEncoderReranker, RAGAgent

# `store` is the knowledge-base store built in the RAGAgent example above.
rag = RAGAgent(
    store=store,
    agent=Agent(model="gpt-4o-mini"),
    reranker=CrossEncoderReranker(),
    top_k=15,
    top_n=4,
)
```

---

## PlanActReflectAgent

Self-contained looping agent: PLAN (break down the task), ACT (execute tools), REFLECT (evaluate progress, decide to iterate or finish). Useful for complex multi-step reasoning.

### PlanActReflectAgent.__init__

```python
def __init__(
    self,
    model: str,
    tools: Iterable[Callable] | None = None,
    plan_system_prompt: list[dict[str, Any]] | None = None,
    reflect_system_prompt: list[dict[str, Any]] | None = None,
    max_iterations: int = 3,
    state: StateT | None = None,
    context_manager: BaseContextManager[StateT] | None = None,
    publisher: BasePublisher | list[BasePublisher] | None = None,
    id_generator: BaseIDGenerator = DefaultIDGenerator(),
    container: InjectQ | None = None,
    *,
    plan_model: str | None = None,
    reflect_model: str | None = None,
    plan_reasoning_config: dict[str, Any] | bool | None = None,
    reflect_reasoning_config: dict[str, Any] | bool | None = None,
    client: Any = None,
    pass_user_info_to_mcp: bool = False,
    extra_messages: list[Message] | None = None,
    trim_context: bool = False,
    tools_tags: set[str] | None = None,
    reasoning_config: dict[str, Any] | bool | None = True,
    skills: SkillConfig | None = None,
    memory: MemoryConfig | None = None,
    retry_config: Any = True,
    fallback_models: list[str | tuple[str, str]] | None = None,
    multimodal_config: MultimodalConfig | None = None,
    **agent_kwargs: Any,
)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `model` | `str` | required | Primary LLM model. |
| `tools` | `Iterable[Callable] \| None` | `None` | Tools available to the PLAN agent. |
| `plan_system_prompt` | `list[dict] \| None` | `None` | Override planner system prompt. |
| `reflect_system_prompt` | `list[dict] \| None` | `None` | Override reflector system prompt. |
| `max_iterations` | `int` | `3` | Max PLAN→ACT→REFLECT cycles per turn. The count is per turn (one invoke or stream of a user message): it resets when a new turn starts after a completed run, and is kept when a paused run resumes (interrupt or client tool) or the last run ended in an error or was stopped. |
| `state` | `StateT \| None` | `None` | Custom AgentState. |
| `context_manager` | `BaseContextManager[StateT] \| None` | `None` | Context manager. |
| `publisher` | `BasePublisher \| list \| None` | `None` | Event publisher. |
| `id_generator` | `BaseIDGenerator` | `DefaultIDGenerator()` | ID generator. |
| `container` | `InjectQ \| None` | `None` | DI container. |
| `plan_model` | `str \| None` | `None` | Override model for the planner (falls back to `model`). |
| `reflect_model` | `str \| None` | `None` | Override model for the reflector. |
| `plan_reasoning_config` | `dict \| bool \| None` | `None` | Override reasoning config for planner. |
| `reflect_reasoning_config` | `dict \| bool \| None` | `None` | Override reasoning config for reflector. |
| `client` | `Any` | `None` | MCP client. |
| `pass_user_info_to_mcp` | `bool` | `False` | Include user_id in MCP requests. |
| `extra_messages` | `list[Message] \| None` | `None` | Prepended messages. |
| `trim_context` | `bool` | `False` | Enable automatic trimming. |
| `tools_tags` | `set[str] \| None` | `None` | Filter tools by tag. |
| `reasoning_config` | `dict \| bool \| None` | `True` | Reasoning config for all phases. |
| `skills` | `SkillConfig \| None` | `None` | Skills config. |
| `memory` | `MemoryConfig \| None` | `None` | Memory config. |
| `retry_config` | `Any` | `True` | Retry policy. |
| `fallback_models` | `list[str \| tuple] \| None` | `None` | Fallback models. |
| `multimodal_config` | `MultimodalConfig \| None` | `None` | Multimodal config. |
| `**agent_kwargs` | `Any` | `{}` | Additional Agent kwargs. |

**Returns:** `PlanActReflectAgent[StateT]`: call `.compile()` for a `CompiledGraph`.

**Example:**

```python
import asyncio

from tenxgraph.core.state import Message

from tenxgraph.prebuilt.agent import PlanActReflectAgent

def web_search(query: str) -> str:
    return f"Results for {query}"

agent = PlanActReflectAgent(
    model="gpt-4o-mini",
    tools=[web_search],
    max_iterations=4,
)
app = agent.compile()

async def main() -> None:
    result = await app.ainvoke(
        {"messages": [Message.text_message("Research AI trends in 2026.")]},
        config={"thread_id": "t1"},
    )

asyncio.run(main())
```

---

## StructuredOutputAgent

Agent that guarantees output conforms to a schema. Passes a Pydantic model or TypedDict; on validation failure, automatically injects a repair prompt and retries up to max_attempts times.

### StructuredOutputAgent.__init__

```python
def __init__(
    self,
    model: str,
    output_schema: type,
    tools: Iterable[Callable] | None = None,
    system_prompt: list[dict[str, Any]] | None = None,
    max_attempts: int = 2,
    repair_system_prompt: list[dict[str, Any]] | None = None,
    state: StateT | None = None,
    context_manager: BaseContextManager[StateT] | None = None,
    publisher: BasePublisher | list[BasePublisher] | None = None,
    id_generator: BaseIDGenerator = DefaultIDGenerator(),
    container: InjectQ | None = None,
    *,
    output_type: str = "text",
    client: Any = None,
    pass_user_info_to_mcp: bool = False,
    extra_messages: list[Message] | None = None,
    trim_context: bool = False,
    tools_tags: set[str] | None = None,
    reasoning_config: dict[str, Any] | bool | None = True,
    skills: SkillConfig | None = None,
    memory: MemoryConfig | None = None,
    retry_config: Any = True,
    fallback_models: list[str | tuple[str, str]] | None = None,
    multimodal_config: MultimodalConfig | None = None,
    **agent_kwargs: Any,
)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `model` | `str` | required | LLM model identifier. |
| `output_schema` | `type` | required | Pydantic BaseModel or TypedDict subclass. |
| `tools` | `Iterable[Callable] \| None` | `None` | Tools available during generation. |
| `system_prompt` | `list[dict] \| None` | `None` | System prompt for the generator. |
| `max_attempts` | `int` | `2` | Max repair+retry attempts per turn before accepting best response. The count is per turn (one invoke or stream of a user message): it resets when a new turn starts after a completed run, and is kept when a paused run resumes (interrupt or client tool) or the last run ended in an error or was stopped. |
| `repair_system_prompt` | `list[dict] \| None` | `None` | System prompt for dedicated repair agent (if provided). |
| `state` | `StateT \| None` | `None` | Custom AgentState. |
| `context_manager` | `BaseContextManager[StateT] \| None` | `None` | Context manager. |
| `publisher` | `BasePublisher \| list \| None` | `None` | Event publisher. |
| `id_generator` | `BaseIDGenerator` | `DefaultIDGenerator()` | ID generator. |
| `container` | `InjectQ \| None` | `None` | DI container. |
| `output_type` | `str` | `"text"` | Output format. |
| `client` | `Any` | `None` | MCP client. |
| `pass_user_info_to_mcp` | `bool` | `False` | Include user_id in MCP requests. |
| `extra_messages` | `list[Message] \| None` | `None` | Prepended messages. |
| `trim_context` | `bool` | `False` | Enable automatic trimming. |
| `tools_tags` | `set[str] \| None` | `None` | Filter tools by tag. |
| `reasoning_config` | `dict \| bool \| None` | `True` | Reasoning config. |
| `skills` | `SkillConfig \| None` | `None` | Skills config. |
| `memory` | `MemoryConfig \| None` | `None` | Memory config. |
| `retry_config` | `Any` | `True` | Retry policy. |
| `fallback_models` | `list[str \| tuple] \| None` | `None` | Fallback models. |
| `multimodal_config` | `MultimodalConfig \| None` | `None` | Multimodal config. |
| `**agent_kwargs` | `Any` | `{}` | Additional Agent kwargs. |

**Returns:** `StructuredOutputAgent[StateT]`: call `.compile()` for a `CompiledGraph`.

**Example:**

```python
import asyncio

from tenxgraph.core.state import Message

from pydantic import BaseModel
from tenxgraph.prebuilt.agent import StructuredOutputAgent

class MovieReview(BaseModel):
    title: str
    rating: float
    summary: str

agent = StructuredOutputAgent(
    model="gpt-4o-mini",
    output_schema=MovieReview,
    system_prompt=[{"role": "system", "content": "You are a film critic."}],
    max_attempts=3,
)
app = agent.compile()

async def main() -> None:
    result = await app.ainvoke(
        {"messages": [Message.text_message("Review Inception.")]},
        config={"thread_id": "t1"},
    )

asyncio.run(main())
```

---

## SupervisorTeamAgent

Supervisor routes tasks to specialist workers. The supervisor is a dedicated Agent built from supervisor_model; each worker is a pre-built Agent provided by the caller. Workers can have different models, tools, skills, memory, etc.

### WorkerConfig

Configuration for a single worker.

```python
@dataclass
class WorkerConfig:
    agent: BaseAgent
    description: str = ""
```

| Field | Type | Default | Description |
|---|---|---|---|
| `agent` | `BaseAgent` | required | Pre-built agent (e.g. `Agent(model="gpt-4o")`). |
| `description` | `str` | `""` | Short description injected into supervisor's system prompt. |

### SupervisorTeamAgent.__init__

```python
def __init__(
    self,
    supervisor_model: str,
    workers: dict[str, WorkerConfig],
    supervisor_system_prompt: list[dict[str, Any]] | None = None,
    max_rounds: int = 10,
    state: StateT | None = None,
    context_manager: BaseContextManager[StateT] | None = None,
    publisher: BasePublisher | list[BasePublisher] | None = None,
    id_generator: BaseIDGenerator = DefaultIDGenerator(),
    container: InjectQ | None = None,
    **supervisor_kwargs: Any,
)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `supervisor_model` | `str` | required | LLM model for the supervisor. |
| `workers` | `dict[str, WorkerConfig]` | required | Mapping of UPPER-CASE names to WorkerConfigs. |
| `supervisor_system_prompt` | `list[dict] \| None` | `None` | Override auto-generated supervisor prompt. |
| `max_rounds` | `int` | `10` | Max supervisor→worker delegations per turn. The count is per turn (one invoke or stream of a user message): it resets when a new turn starts after a completed run, and is kept when a paused run resumes (interrupt or client tool) or the last run ended in an error or was stopped. |
| `state` | `StateT \| None` | `None` | Custom AgentState. |
| `context_manager` | `BaseContextManager[StateT] \| None` | `None` | Context manager. |
| `publisher` | `BasePublisher \| list \| None` | `None` | Event publisher. |
| `id_generator` | `BaseIDGenerator` | `DefaultIDGenerator()` | ID generator. |
| `container` | `InjectQ \| None` | `None` | DI container. |
| `**supervisor_kwargs` | `Any` | `{}` | Extra kwargs for the supervisor Agent. |

**Raises:** `ValueError` if no workers provided, or if a worker is named `"SUPERVISOR"`.

**Returns:** `SupervisorTeamAgent[StateT]`: call `.compile()` for a `CompiledGraph`.

**Example:**

```python
from tenxgraph.core.state import Message
from tenxgraph.core.graph import Agent, ToolNode
from tenxgraph.prebuilt.agent import SupervisorTeamAgent
from tenxgraph.prebuilt.agent.supervisor_team import WorkerConfig

def web_search(query: str) -> str:
    return f"Results for {query}"

def run_code(code: str) -> str:
    return f"Executed: {code}"

agent = SupervisorTeamAgent(
    supervisor_model="gpt-4o",
    workers={
        "RESEARCHER": WorkerConfig(
            agent=Agent(model="gpt-4o-mini", tool_node=ToolNode([web_search])),
            description="Searches the web for information.",
        ),
        "CODER": WorkerConfig(
            agent=Agent(model="gpt-4o", tool_node=ToolNode([run_code])),
            description="Writes and runs Python code.",
        ),
    },
    max_rounds=8,
)
app = agent.compile()

# Run inside an async function: the supervisor delegates to workers until done.
# result = await app.ainvoke({"messages": [Message.text_message("Find the latest Python release.")]}, config={"thread_id": "t1"})
```

---

## SwarmAgent

Peer-to-peer multi-agent handoff. Each member is a pre-built Agent; members can hand off to other designated members. Handoff tools are auto-injected; no manual graph wiring needed.

### SwarmMemberConfig

Configuration for a single swarm member.

```python
@dataclass
class SwarmMemberConfig:
    agent: BaseAgent
    can_handoff_to: list[str] | None = None
    description: str = ""
```

| Field | Type | Default | Description |
|---|---|---|---|
| `agent` | `BaseAgent` | required | Pre-built agent. Do not include handoff tools; they are auto-injected. |
| `can_handoff_to` | `list[str] \| None` | `None` | Names of members this agent may hand off to. `None` = all others. |
| `description` | `str` | `""` | Short description appearing in handoff tool docstrings. |

### SwarmAgent.__init__

```python
def __init__(
    self,
    members: dict[str, SwarmMemberConfig],
    entry: str,
    state: StateT | None = None,
    context_manager: BaseContextManager[StateT] | None = None,
    publisher: BasePublisher | list[BasePublisher] | None = None,
    id_generator: BaseIDGenerator = DefaultIDGenerator(),
    container: InjectQ | None = None,
)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `members` | `dict[str, SwarmMemberConfig]` | required | Mapping of UPPER-CASE names to SwarmMemberConfigs. |
| `entry` | `str` | required | Name of the member that receives the initial message. |
| `state` | `StateT \| None` | `None` | Custom AgentState. |
| `context_manager` | `BaseContextManager[StateT] \| None` | `None` | Context manager. |
| `publisher` | `BasePublisher \| list \| None` | `None` | Event publisher. |
| `id_generator` | `BaseIDGenerator` | `DefaultIDGenerator()` | ID generator. |
| `container` | `InjectQ \| None` | `None` | DI container. |

**Raises:** `ValueError` if no members provided, or if `entry` is not in members.

**Returns:** `SwarmAgent[StateT]`: call `.compile()` for a `CompiledGraph`.

**Example:**

```python
from tenxgraph.core.state import Message
from tenxgraph.core.graph import Agent, ToolNode
from tenxgraph.prebuilt.agent import SwarmAgent
from tenxgraph.prebuilt.agent.swarm import SwarmMemberConfig

def web_search(query: str) -> str:
    return f"Results for {query}"

def draft_document(topic: str) -> str:
    return f"Draft on {topic}"

swarm = SwarmAgent(
    members={
        "TRIAGE": SwarmMemberConfig(
            agent=Agent(model="gpt-4o-mini"),
            can_handoff_to=["RESEARCHER", "WRITER"],
            description="Routes requests.",
        ),
        "RESEARCHER": SwarmMemberConfig(
            agent=Agent(model="gpt-4o", tool_node=ToolNode([web_search])),
            can_handoff_to=["WRITER"],
            description="Performs research.",
        ),
        "WRITER": SwarmMemberConfig(
            agent=Agent(model="gpt-4o-mini", tool_node=ToolNode([draft_document])),
            description="Writes documents.",
        ),
    },
    entry="TRIAGE",
)
app = swarm.compile()

# Run inside an async function: TRIAGE receives the message first.
# result = await app.ainvoke({"messages": [Message.text_message("Write a short report on Qdrant.")]}, config={"thread_id": "t1"})
```

---

## AudioAgent

Prebuilt realtime audio agent for streaming audio input/output. Uses the LiveAgent runtime (not the standard invoke/stream loops). Mirrors ReactAgent's interface but runs over a RealtimeClient instead.

### AudioAgent.__init__

```python
def __init__(
    self,
    model: str,
    state: StateT | None = None,
    context_manager: BaseContextManager[StateT] | None = None,
    publisher: BasePublisher | list[BasePublisher] | None = None,
    id_generator: BaseIDGenerator = DefaultIDGenerator(),
    container: Any | None = None,
    *,
    realtime_config: RealtimeConfig | None = None,
    system_prompt: list[dict[str, Any]] | None = None,
    tools: Iterable[Callable] | None = None,
    client: Any = None,
    pass_user_info_to_mcp: bool = False,
    skills: SkillConfig | None = None,
    memory: MemoryConfig | None = None,
    realtime_client_factory: Callable[[], RealtimeClient] | None = None,
    live_node_name: str = "LIVE",
    **agent_kwargs: Any,
)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `model` | `str` | required | LLM model supporting realtime audio. |
| `state` | `StateT \| None` | `None` | Custom AgentState. |
| `context_manager` | `BaseContextManager[StateT] \| None` | `None` | Context manager. |
| `publisher` | `BasePublisher \| list \| None` | `None` | Event publisher. |
| `id_generator` | `BaseIDGenerator` | `DefaultIDGenerator()` | ID generator. |
| `container` | `Any` | `None` | DI container. |
| `realtime_config` | `RealtimeConfig \| None` | `None` | Realtime audio configuration. |
| `system_prompt` | `list[dict] \| None` | `None` | System prompt. |
| `tools` | `Iterable[Callable] \| None` | `None` | Tools available to the agent. |
| `client` | `Any` | `None` | MCP client. |
| `pass_user_info_to_mcp` | `bool` | `False` | Include user_id in MCP requests. |
| `skills` | `SkillConfig \| None` | `None` | Skills config. |
| `memory` | `MemoryConfig \| None` | `None` | Memory config. |
| `realtime_client_factory` | `Callable[[], RealtimeClient] \| None` | `None` | Factory function for the realtime client. |
| `live_node_name` | `str` | `"LIVE"` | Graph node name for the live agent. |
| `**agent_kwargs` | `Any` | `{}` | Additional kwargs forwarded to the internal LiveAgent. |

**Returns:** `AudioAgent[StateT]`: call `.compile()` for a `CompiledGraph`.

**Drives with:** `CompiledGraph.arealtime(input_queue, config)`, an async generator of realtime events. Use `LiveInputQueue` to feed audio. `AudioAgent.compile()` takes only `checkpointer`, `store`, `callback_manager` and `shutdown_timeout`. Calling `arealtime()` on a graph without a `LiveAgent` raises `RuntimeError`.

**Example:**

```python
import asyncio

from tenxgraph.core.realtime.base import RealtimeConfig
from tenxgraph.core.realtime.queue import LiveInputQueue
from tenxgraph.prebuilt.agent import AudioAgent

MODEL = "gemini-live-2.5-flash-preview"

agent = AudioAgent(
    MODEL,
    realtime_config=RealtimeConfig(model=MODEL, voice="Puck"),
)
app = agent.compile()

async def main() -> None:
    queue = LiveInputQueue()
    # Feed PCM16 audio bytes, for example from a microphone callback.
    queue.send_audio(b"\x00\x00" * 1600)
    queue.close()  # ends the session once the provider goes idle
    async for event in app.arealtime(queue, {"thread_id": "t1"}):
        print(type(event).__name__)

asyncio.run(main())
```

For a full microphone and speaker loop, see `agentflow/examples/realtime/audio_agent_mic.py` in the repository. Install the `realtime` extra: `pip install "10xgraph[realtime]"`.
