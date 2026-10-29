---
title: Agent
seoTitle: "Agent class API reference (Python)"
description: "Reference for the Agent class: constructor parameters, providers, retry and fallback, reasoning, memory, multimodal limits, and common errors."
section: Reference
group: "Python library"
order: 30
label: Agent
updated: "2026-10-29"
---

The `Agent` class is a graph node that calls an LLM through the native OpenAI, Google, or Anthropic SDK. It handles message conversion, tool calls, memory retrieval, skills, streaming, and retries for you. Add it to a `StateGraph` as a node, and the graph supplies state and routing.

## Import path

```python
from tenxgraph.core.graph import Agent, RetryConfig, StateGraph, ToolNode
```

---

## Agent

Initializes an LLM-calling graph node for use in a StateGraph.

### Signature

```python
def __init__(
    self,
    model: str,
    output_type: str = "text",
    system_prompt: list[dict[str, Any]] | None = None,
    tool_node: str | ToolNode | None = None,
    extra_messages: list[Message] | None = None,
    trim_context: bool = False,
    tools_tags: set[str] | None = None,
    reasoning_config: dict[str, Any] | bool | None = {"effort": "medium"},
    skills: SkillConfig | None = None,
    memory: MemoryConfig | None = None,
    retry_config: RetryConfig | bool | None = True,
    fallback_models: list[str | tuple[str, str]] | None = None,
    multimodal_config: MultimodalConfig | None = None,
    output_schema: type[BaseModel] | None = None,
    **kwargs,
) -> None
```

### Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `model` | `str` | **required** | Model identifier. Examples: `"gpt-4o"`, `"gemini-2.5-flash"`, `"claude-sonnet-5"`. A recognized provider prefix (`openai/`, `gpt/`, `google/`, `gemini/`, `anthropic/`, `claude/`) selects the provider and is stripped. Any other name is sent as is to the OpenAI-compatible client. |
| `provider` | `str \| None` | `None` | (via kwargs) Provider name: `"openai"`, `"google"`, `"anthropic"`. If omitted, inferred from model name. |
| `output_type` | `str` | `"text"` | Output modality: `"text"`, `"image"`, `"video"`, `"audio"`, or `"json"` (legacy, prefer `output_schema`). Support depends on the provider: Anthropic allows only `"text"` and `"json"`, OpenAI has no `"video"`. |
| `system_prompt` | `list[dict] \| None` | `None` | System prompt as list of message dicts: `[{"role": "system", "content": "..."}]`. Supports state field interpolation with `{field_name}` placeholders filled from the state at run time. |
| `tool_node` | `str \| ToolNode \| None` | `None` | Tools for the agent. Pass a `ToolNode` instance or a string naming a graph node whose `func` is a `ToolNode`. Resolved at execution time. |
| `extra_messages` | `list[Message] \| None` | `None` | Additional messages prepended to context before each LLM call. |
| `trim_context` | `bool` | `False` | Trim conversation history to fit within the model's context window. |
| `tools_tags` | `set[str] \| None` | `None` | Filter ToolNode tools by tag. Only tools with matching tags are offered to the LLM. |
| `api_style` | `str` | `"chat"` | (via kwargs) OpenAI API style: `"chat"` (Chat Completions) or `"responses"` (Responses API). Any other value raises `ValueError`. |
| `reasoning_config` | `dict \| bool \| None` | `{"effort": "medium"}` | Reasoning config for models supporting extended thinking. `True` enables defaults, `False` or `None` disables, a dict sets model-specific options. See [Reasoning models](#reasoning-models). |
| `skills` | `SkillConfig \| None` | `None` | Agent Skills configuration per agentskills.io spec. Injects skill catalog and activation/read tools. See [`skills`](/docs/reference/python/skills). |
| `memory` | `MemoryConfig \| None` | `None` | Long-term memory config for retrieving relevant context before each LLM call. See [Memory](#memory-augmented-agent). |
| `retry_config` | `RetryConfig \| bool \| None` | `True` | Retry logic for transient API errors. `True` uses defaults; `False` or `None` disables; pass `RetryConfig` for tuning. See [Retry configuration](#retry-configuration). |
| `fallback_models` | `list[str \| tuple[str, str]] \| None` | `None` | Ordered fallback models to try if primary exhausts retries. Each entry: model string (inherits provider) or `(model, provider)` tuple. |
| `multimodal_config` | `MultimodalConfig \| None` | `None` | Image and document handling limits for multimodal requests. See [`media`](/docs/reference/python/media#multimodalconfig). |
| `output_schema` | `type[BaseModel] \| None` | `None` | Pydantic model that the final text output must conform to. Not allowed with `"image"`, `"video"`, or `"audio"` output. |
| `use_vertex_ai` | `bool` | `False` | (via kwargs) Google provider only. Route Gemini through Vertex AI instead of Gemini API. Defaults to true when `GOOGLE_GENAI_USE_VERTEXAI=true`. For Claude it selects the Vertex backend. |
| `base_url` | `str \| None` | `None` | (via kwargs) Base URL for OpenAI-compatible APIs (Ollama, vLLM, OpenRouter, DeepSeek, etc.). |
| `**kwargs` | any | none | Additional provider-specific parameters: `temperature`, `max_tokens`, `top_p`, `top_k`, `organization_id`, `project_id`, etc. |

### Returns

`None`. The constructor builds the node. When the graph runs it, the agent reads the state, calls the model, and appends the response to the message list.

### Raises

| Exception | Condition |
|---|---|
| `ImportError` | Required provider SDK not installed (e.g., `google-genai`, `openai`, `anthropic` packages). |
| `ValueError` | `output_type` is not supported by the resolved provider, `output_schema` is combined with image, video, or audio output, `api_style` is not `"chat"` or `"responses"`, or an explicit `provider` is not `google`, `openai`, or `anthropic`. |

### Example

```python
from tenxgraph.core.graph import Agent, StateGraph, ToolNode
from tenxgraph.utils import END

# Define tools (set OPENAI_API_KEY and install "10xgraph[openai]" first)
def get_weather(location: str) -> str:
    """Get weather for a location."""
    return f"Sunny in {location}"

def get_time() -> str:
    """Get current time."""
    return "3:00 PM"

# Create agent with tools
tool_node = ToolNode([get_weather, get_time])
agent = Agent(
    model="gpt-4o",
    system_prompt=[{"role": "system", "content": "You are a helpful assistant."}],
    tool_node=tool_node,
)

# Use in a graph
graph = StateGraph()
graph.add_node("MAIN", agent)
graph.add_node("TOOL", tool_node)
graph.set_entry_point("MAIN")

# Route: call tools if requested, else end
def should_continue(state):
    last = state.context[-1]
    if last.role == "assistant" and getattr(last, "tools_calls", None):
        return "TOOL"
    return END

graph.add_conditional_edges("MAIN", should_continue, {"TOOL": "TOOL", END: END})
graph.add_edge("TOOL", "MAIN")

app = graph.compile()
```

---

## Supported providers

| Provider | Backend | Models |
|---|---|---|
| [`"openai"`](/docs/integrations/openai) | OpenAI API | `gpt-4o`, `gpt-4o-mini`, `o1`, `o3`, `o4-mini`, plus OpenAI-compatible models via `base_url` |
| [`"google"`](/docs/integrations/google) | Gemini API or Vertex AI | `gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-2.0-flash` |
| [`"anthropic"`](/docs/integrations/anthropic) | Claude API (direct, Vertex AI, or Bedrock) | `claude-*` models, for example `claude-sonnet-5` |

The `"google"` provider supports both Gemini API and Vertex AI. Toggle Vertex AI with `use_vertex_ai=True` on the agent or set `GOOGLE_GENAI_USE_VERTEXAI=true`.

### Provider inference

If `provider` is omitted, the library infers it from the `model` string, after stripping a recognized `provider/` prefix:

| Model name | Provider |
|---|---|
| Starts with `claude-` or `anthropic.` | `"anthropic"` |
| Starts with `gemini-`, `imagen-`, `veo-`, or `chirp` | `"google"` |
| Starts with `gpt-`, `o1-`, `o3-`, or `o4-` | `"openai"` |
| Anything else | `"openai"` (logged at info level) |

With `use_vertex_ai=True`, every non-Claude model resolves to `"google"`. Pass `provider` explicitly for names that do not match, such as `provider="google"` for a custom Gemini deployment.

For Anthropic, the `anthropic_backend` kwarg selects the backend: `None` (direct Claude API, default), `"vertex"` (Vertex AI), or `"bedrock"` (AWS Bedrock). Bedrock model IDs keep the `anthropic.` prefix.

---

## Retry configuration

By default, `Agent` retries transient API errors (429, 500, 502, 503, 529) with exponential back-off. Configure with `retry_config`:

```python
from tenxgraph.core.graph.agent_internal.constants import RetryConfig

# Enable with defaults
agent = Agent(model="gpt-4o", retry_config=True)

# Customize retry behavior
agent = Agent(
    model="gpt-4o",
    retry_config=RetryConfig(
        max_retries=5,
        initial_delay=2.0,
        max_delay=60.0,
        backoff_factor=2.0,
    ),
)

# Disable retries
agent = Agent(model="gpt-4o", retry_config=False)
```

### RetryConfig fields

| Field | Default | Description |
|---|---|---|
| `max_retries` | `3` | Attempts against the primary model before trying fallbacks. |
| `initial_delay` | `1.0` | Seconds before the first retry. |
| `max_delay` | `30.0` | Upper bound on exponential back-off delay. |
| `backoff_factor` | `2.0` | Multiplier after each retry. |
| `retryable_status_codes` | `{429, 500, 502, 503, 529}` | HTTP status codes treated as transient. |
| `circuit_breaker_enabled` | `False` | Track consecutive failures per (provider, model) pair and skip open circuits. |
| `circuit_breaker_threshold` | `5` | Consecutive failures that open a circuit. |
| `circuit_breaker_reset_timeout` | `30.0` | Seconds a circuit stays open before retrying. |
| `jitter` | `0.25` | Fraction of each back-off delay that is randomised, so parallel runs do not retry in step. `0` disables it. |
| `max_concurrent_calls` | `None` | Opt-in cap on in-flight LLM requests per provider for one `Agent`. |
| `distributed_max_concurrent_calls` | `None` | Opt-in cap on in-flight requests per (provider, model) shared by every process on the same Redis. Off by default; fails open with a WARNING when Redis is down. Needs `distributed_redis` or `distributed_redis_url`. |
| `distributed_redis` | `None` | Async Redis client for the shared cap. |
| `distributed_redis_url` | `None` | Redis URL used to build a client when none is passed. |
| `distributed_lease_seconds` | `300.0` | How long a slot is held before it counts as abandoned. A running call renews the lease every third of this time, so it only has to outlast a crashed process. |
| `distributed_key_prefix` | `""` | Prefix for the Redis key. |

See [Cap in-flight calls across processes](/docs/concepts/errors-and-limits#cap-in-flight-calls-across-processes).

When `circuit_breaker_enabled=True`, consecutive failures to a (provider, model) pair open its circuit, causing calls to skip it and try the next fallback for `circuit_breaker_reset_timeout` seconds. After the timeout, one trial is allowed; success closes the circuit.

```python
agent = Agent(
    model="gpt-4o",
    fallback_models=["gpt-4o-mini"],
    retry_config=RetryConfig(
        circuit_breaker_enabled=True,
        circuit_breaker_threshold=5,
        circuit_breaker_reset_timeout=30.0,
    ),
)
```

---

## Reasoning models

Reasoning-capable models (for example OpenAI o-series and Gemini thinking models) are controlled with `reasoning_config`. Reasoning is on by default at medium effort:

```python
# Enable reasoning with default effort
agent = Agent(model="o4-mini", reasoning_config=True)

# Disable reasoning (False or None)
agent = Agent(model="o4-mini", reasoning_config=False)

# OpenAI: effort level
agent = Agent(model="o4-mini", reasoning_config={"effort": "high"})

# Google: explicit thinking budget (tokens)
agent = Agent(model="gemini-2.5-pro", reasoning_config={"thinking_budget": 8000})
```

`effort` applies to all providers, `summary` is OpenAI-only, and `thinking_budget` is Google-only and overrides `effort`. For Gemini, `effort` maps to a budget: `"low"` is 512 tokens, `"medium"` is 8192 (default), `"high"` is 24576.

---

## Fallback models

When the primary model fails (after exhausting retries), try fallbacks in order:

```python
agent = Agent(
    model="gpt-4o",
    fallback_models=[
        "gpt-4o-mini",                    # same provider
        ("gemini-2.5-flash", "google"),   # explicit provider
    ],
)
```

---

## Memory-augmented agent

Pass a `MemoryConfig` as `memory` to give the agent long-term memory. Here `my_qdrant_store` stands for a `BaseStore` you have created (see the memory stores reference):

```python
from tenxgraph.storage.store import MemoryConfig, ReadMode

memory_config = MemoryConfig(
    store=my_qdrant_store,
    retrieval_mode=ReadMode.POSTLOAD,
    limit=5,
)

agent = Agent(
    model="gpt-4o",
    system_prompt=[{"role": "system", "content": "You are a helpful assistant."}],
    memory=memory_config,
)

# Provide the store when compiling the graph
app = graph.compile(store=my_qdrant_store)
```

`retrieval_mode` is a `ReadMode`: `NO_RETRIEVAL`, `PRELOAD`, or `POSTLOAD` (the `MemoryConfig` default). With `POSTLOAD`, the agent also exposes user and agent memory tools to the model. `MemoryConfig` fields are `store`, `retrieval_mode`, `limit`, `score_threshold`, `max_tokens`, `inject_system_prompt`, `config`, `user_memory`, and `agent_memory`. Defaults: `limit=5`, `score_threshold=0.0`, `inject_system_prompt=True`. With `PRELOAD`, memories are added to the latest user message for that request only, not to the system prompt ([why](/docs/concepts/memory-and-store#why-memories-are-not-system-text)). See [`memory-stores`](/docs/reference/python/memory-stores) for details.

---

## Multimodal config

Use `multimodal_config` to limit image and document processing for multimodal requests:

```python
from tenxgraph.storage.media.config import MultimodalConfig

agent = Agent(
    model="gpt-4o",
    multimodal_config=MultimodalConfig(
        max_image_size_mb=10.0,
        max_image_dimension=2048,
    ),
)
```

`MultimodalConfig` fields: `image_handling` (`"base64"`, `"url"`, or `"file_id"`; default `"base64"`), `document_handling` (`"extract_text"`, `"pass_raw"`, or `"skip"`; default `"extract_text"`), `max_image_size_mb` (default 10.0), `max_image_dimension` (default 2048), `supported_image_types`, and `supported_doc_types`.

---

## Common errors

| Error | Cause | Fix |
|---|---|---|
| `AuthenticationError` | Missing or invalid API key. | Set `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, or Vertex AI credentials. See [Models and providers](/docs/integrations/models) and [provider troubleshooting](/docs/troubleshooting/providers). |
| `ValueError: GOOGLE_CLOUD_PROJECT environment variable must be set` | Vertex AI enabled without a GCP project. | Export `GOOGLE_CLOUD_PROJECT` and ensure Application Default Credentials are configured. |
| `ImportError: google-genai SDK is required` | Google provider extra not installed. | Install: `pip install "10xgraph[google-genai]"` or `pip install google-genai`. |
| `ImportError: openai SDK is required` | OpenAI provider extra not installed. | Install: `pip install "10xgraph[openai]"` or `pip install openai`. |
| `ImportError: anthropic SDK is required` | Anthropic provider extra not installed. | Install: `pip install "10xgraph[anthropic]"` or `pip install anthropic`. |
| `ValueError: Invalid api_style` | `api_style` is not `"chat"` or `"responses"`. | Use one of the two supported values. |
| `ValueError: ... doesn't support output_type` | The provider cannot generate that output, for example image output on Anthropic. | Use a provider that supports it, or switch to `output_type="text"`. |

---

## Related pages

- [How to configure an agent](/docs/guides/configure-agent)
- [How to use tools](/docs/guides/use-tool-decorator)
- [Build a graph](/docs/guides/build-a-graph)
- [ToolNode reference](/docs/reference/python/tools)
- [Prebuilt agents](/docs/guides/prebuilt-agents)
- [Agent Skills](/docs/reference/python/skills)
