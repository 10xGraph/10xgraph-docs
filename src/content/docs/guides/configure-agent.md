---
title: How to configure Agent
description: Reference for the Agent constructor, including model, provider, system_prompt, tool_node, reasoning_config, retry_config, fallback_models, and output_schema.
section: "Build agents"
group: "Agents and graphs"
order: 30
label: Configure Agent
updated: "2026-10-29"
---

`Agent` is the LLM node in a `StateGraph`. This guide covers every constructor parameter with working examples to help you configure agents with different models, providers, tools, and behaviors.

## Minimal example

Install the extra for your provider, for example `pip install "10xgraph[openai]"`, `"10xgraph[google-genai]"` or `"10xgraph[anthropic]"`.

```python
from tenxgraph.core.graph import Agent

agent = Agent(model="gpt-4o")
```

10xGraph auto-detects the provider from the model name. `gpt-*`, `o1-`/`o3-`/`o4-` models use the OpenAI SDK; `gemini-*` models use the Google GenAI SDK; and `claude-*` models use the Anthropic SDK. You can also use a `provider/model` prefix (`openai/`, `google/`, `anthropic/`) to explicitly select the provider.

---

## Model and provider

### Auto-detect (recommended)

Auto-detection works for all major providers. 10xGraph infers the provider from the model name, eliminating the need to specify it explicitly.

```python
agent = Agent(model="gpt-4o")            # → OpenAI
agent = Agent(model="gemini-2.5-flash")  # → Google
agent = Agent(model="claude-3-5-sonnet-20241022")  # → Anthropic
```

### Explicit provider with `/` prefix

When auto-detection is ambiguous or you want to be explicit, prefix the model name with `provider/`.

```python
agent = Agent(model="openai/gpt-4o")
agent = Agent(model="google/gemini-2.5-flash")
agent = Agent(model="anthropic/claude-opus-5")
```

### Explicit `provider` kwarg

Pass the provider as a keyword argument to override auto-detection.

```python
agent = Agent(model="gpt-4o", provider="openai")
agent = Agent(model="gemini-2.5-flash", provider="google")
agent = Agent(model="claude-opus-5", provider="anthropic")
```

### Anthropic with Vertex AI or Bedrock

Anthropic provides three backends: the direct Claude API, Vertex AI, and Bedrock. Use the `anthropic_backend` parameter to select which one.

**Direct Claude API (default):**

```python
agent = Agent(model="claude-opus-5", provider="anthropic")
```

**Vertex AI (requires `pip install "10xgraph[anthropic-vertex]"` and Google Cloud credentials; the Anthropic SDK resolves project and region):**

```python
agent = Agent(
    model="claude-opus-5",
    provider="anthropic",
    anthropic_backend="vertex",
)
```

**Bedrock (requires `pip install "10xgraph[anthropic-bedrock]"` and AWS credentials):**

```python
agent = Agent(
    model="anthropic.claude-opus-5",  # Note: keep the anthropic. prefix for Bedrock
    provider="anthropic",
    anthropic_backend="bedrock",
    aws_region="us-east-1",
)
```

Or use `use_vertex_ai=True` as a shorthand for `anthropic_backend="vertex"`:

```python
agent = Agent(
    model="claude-opus-5",
    provider="anthropic",
    use_vertex_ai=True,  # equivalent to anthropic_backend="vertex"
)
```

For complete details on Anthropic setup, authentication, and differences between backends, see [Anthropic integration](/docs/integrations/anthropic).

### Third-party OpenAI-compatible APIs

```python
# Ollama (local)
agent = Agent(
    model="llama3.2",
    provider="openai",
    base_url="http://localhost:11434/v1",
)

# DeepSeek
agent = Agent(
    model="deepseek-chat",
    provider="openai",
    base_url="https://api.deepseek.com/v1",
)

# OpenRouter
agent = Agent(
    model="anthropic/claude-3-5-sonnet",
    provider="openai",
    base_url="https://openrouter.ai/api/v1",
)
```

---

## System prompt

Pass a system prompt as a list of message dicts. System prompts shape the model's behavior and personality. The most common pattern is a single dict with `"role": "system"`.

```python
agent = Agent(
    model="gpt-4o",
    system_prompt=[{
        "role": "system",
        "content": "You are a concise assistant specialized in technical support. Reply in at most 3 sentences and be specific.",
    }],
)
```

### State interpolation

Make prompts dynamic by using placeholders like `{field_name}`. At execution time, 10xGraph replaces placeholders with values from the current `AgentState`. This is useful for personalizing responses or adapting behavior based on context.

```python
from tenxgraph.core.state import AgentState

class MyState(AgentState):
    user_name: str = "Guest"
    language: str = "English"
    user_role: str = "user"

agent = Agent(
    model="gpt-4o",
    system_prompt=[{
        "role": "system",
        "content": "You are helping {user_name} ({user_role}). Always reply in {language}. Be respectful and thorough.",
    }],
)
```

Placeholders are evaluated at graph runtime, so the prompt adapts to each invocation without recreating the agent.

---

## Tools and ToolNode

Agents use tools to interact with the world: fetch data, modify state, call APIs, or perform calculations. You pass tools to an agent via the `tool_node` parameter, either as a `ToolNode` instance or as a reference to an existing graph node.

### Using tools inline

When you pass a `ToolNode` instance directly, the agent owns the tools and calls them in-process.

```python
from tenxgraph.core.graph import ToolNode

def web_search(query: str) -> str:
    """Search the web for information."""
    return f"Search results for: {query}"

def get_weather(location: str) -> str:
    """Get the current weather at a location."""
    return f"Weather for {location}: 72F, clear"

tool_node = ToolNode([web_search, get_weather])
agent = Agent(model="gpt-4o", tool_node=tool_node)
```

### Referencing tools as a graph node

For complex graphs, define the `ToolNode` as a separate graph node and reference it by name. This lets you control the flow of tool calls (e.g., route based on tool results).

```python
from tenxgraph.core.graph import StateGraph, ToolNode, Agent
from tenxgraph.core.state import AgentState
from tenxgraph.utils import END

def my_tool(x: int) -> int:
    """A simple tool."""
    return x * 2

# Create the graph with separate tool and agent nodes
graph = StateGraph()

agent = Agent(model="gpt-4o", tool_node="TOOLS")  # Reference by name
tool_node = ToolNode([my_tool])

graph.add_node("AGENT", agent)
graph.add_node("TOOLS", tool_node)

# Set up conditional edges based on tool calls
def route_tools(state: AgentState) -> str:
    last = state.context[-1] if state.context else None
    if last and last.role == "assistant" and last.tools_calls:
        return "TOOLS"
    return END

graph.add_conditional_edges("AGENT", route_tools, {"TOOLS": "TOOLS", END: END})
graph.add_edge("TOOLS", "AGENT")
graph.set_entry_point("AGENT")
```

### Filter tools by tag

Control which tools the LLM can see with the `tools_tags` parameter. Only tools matching the specified tags are exposed; others are hidden from the model.

This is useful for role-based access: expose "safe" tools to all users but keep "admin" tools restricted.

```python
from tenxgraph.utils.decorators import tool

@tool(tags=["safe"])
def public_search(query: str) -> str:
    """Search the public knowledge base."""
    return "..."

@tool(tags=["admin"])
def delete_user(user_id: str) -> str:
    """Delete a user account (admin only)."""
    return "..."

tool_node = ToolNode([public_search, delete_user])

# Only expose safe tools to the agent
agent = Agent(model="gpt-4o", tool_node=tool_node, tools_tags={"safe"})
```

Multiple tags are supported; the agent can call any tool matching at least one tag.

---

## Reasoning configuration

10xGraph provides a unified `reasoning_config` across all providers that support reasoning. By default, reasoning is enabled at medium effort for models that support it (like OpenAI's o-series, Google's Gemini, and Anthropic's Claude).

You can control reasoning mode with the `effort` key, which applies consistently across providers. Each provider translates this to its native settings. For providers without reasoning support, this parameter is safely ignored.

```python
# Default: medium effort (ON for reasoning models)
agent = Agent(model="gpt-4o")

# High effort reasoning
agent = Agent(model="gpt-4o", reasoning_config={"effort": "high"})

# Disable reasoning entirely
agent = Agent(model="gpt-4o", reasoning_config=None)

# OpenAI: low effort with auto-generated summary
agent = Agent(model="o4-mini", reasoning_config={"effort": "low", "summary": "auto"})

# Google: exact thinking budget override
agent = Agent(model="gemini-2.5-flash", reasoning_config={"thinking_budget": 5000})

# Anthropic (uses adaptive thinking)
agent = Agent(model="claude-opus-5", reasoning_config={"effort": "high"})
```

**How effort translates to provider-specific settings:**

| `effort` | OpenAI | Google `thinking_budget` | Anthropic |
|---|---|---|---|
| `"low"` | Low effort | 512 | Adaptive (conservative) |
| `"medium"` (default) | Medium effort | 8192 | Adaptive (balanced) |
| `"high"` | High effort | 24576 | Adaptive (thorough) |

When you pass `effort`, Google's equivalent `thinking_budget` is computed automatically. The `summary` key (OpenAI-only) controls how extended thinking is summarized in the response.

---

## Retry configuration

10xGraph agents automatically retry on transient LLM API failures: HTTP 429 (rate limit), 500 (server error), 502 (bad gateway), 503 (service unavailable), and 529 (overloaded). Retries use exponential back-off to avoid hammering a recovering service.

By default, agents retry 3 times with a 1-second initial delay, 2x back-off multiplier, and 30-second max delay. You can customize retry behavior or disable it entirely.

```python
from tenxgraph.core.graph.agent_internal.constants import RetryConfig

# Default behavior: 3 retries, 1s initial delay, 2x backoff, 30s max
agent = Agent(model="gpt-4o")

# Custom: 5 retries, longer delays for slow recovery
agent = Agent(
    model="gpt-4o",
    retry_config=RetryConfig(
        max_retries=5,
        initial_delay=2.0,
        max_delay=120.0,
        backoff_factor=2.5,
    ),
)

# Disable retries entirely (fail immediately on error)
agent = Agent(model="gpt-4o", retry_config=False)
```

### RetryConfig fields

| Field | Default | Purpose |
|---|---|---|
| `max_retries` | `3` | Number of retries after the initial attempt. Total attempts = max_retries + 1. |
| `initial_delay` | `1.0` | Initial wait time (seconds) before the first retry. |
| `max_delay` | `30.0` | Maximum wait time between retries (cap on exponential growth). |
| `backoff_factor` | `2.0` | Multiplier applied to delay after each retry. |
| `circuit_breaker_enabled` | `False` | Whether to enable circuit breaker (see below). |
| `circuit_breaker_threshold` | `5` | Consecutive failures before opening the circuit. |
| `circuit_breaker_reset_timeout` | `30.0` | How long (seconds) the circuit stays open before attempting recovery. |
| `jitter` | `0.25` | Fraction of each back-off delay that is randomised, so parallel runs do not retry in step. `0` disables it. |
| `max_concurrent_calls` | `None` | Opt-in cap on in-flight LLM requests per provider for one `Agent`. |
| `distributed_max_concurrent_calls` | `None` | Opt-in cap on in-flight requests per (provider, model) shared by every process on the same Redis. Off by default; fails open with a WARNING when Redis is down. Needs `distributed_redis` or `distributed_redis_url`. |
| `distributed_redis` | `None` | Async Redis client for the shared cap. |
| `distributed_redis_url` | `None` | Redis URL used to build a client when none is passed. |
| `distributed_lease_seconds` | `300.0` | How long a slot is held before it counts as abandoned. A running call renews the lease every third of this time, so it only has to outlast a crashed process. |
| `distributed_key_prefix` | `""` | Prefix for the Redis key. |

See [Cap in-flight calls across processes](/docs/concepts/errors-and-limits#cap-in-flight-calls-across-processes).

### Circuit breaker for fault isolation

The circuit breaker is an advanced feature that prevents a permanently broken provider from consuming all retry attempts. When a `(provider, model)` pair fails `circuit_breaker_threshold` consecutive times, its circuit opens: subsequent calls skip the broken provider and go directly to the next fallback, if any.

After `circuit_breaker_reset_timeout` seconds, the circuit enters half-open state and allows a trial request. If the trial succeeds, the circuit closes and normal operation resumes. If it fails, the circuit reopens.

This is especially useful with fallback models, so a dead provider doesn't delay recovery.

```python
from tenxgraph.core.graph.agent_internal.constants import RetryConfig

agent = Agent(
    model="gpt-4o",
    fallback_models=["gpt-4o-mini", ("gemini-2.0-flash", "google")],
    retry_config=RetryConfig(
        max_retries=3,
        circuit_breaker_enabled=True,
        circuit_breaker_threshold=5,
        circuit_breaker_reset_timeout=30.0,
    ),
)
```

Circuit state is per `Agent` instance and scoped to `(provider, model)` pairs. The circuit is tied to the agent's lifetime; restarting the process resets all circuit state.

---

## LLM call timeout

All LLM clients apply a 600-second (10-minute) timeout by default so a stalled provider cannot hang your graph run indefinitely. This prevents scenarios where a broken network connection or unresponsive API leaves your agent waiting forever.

You can customize the timeout globally or per-request.

### Override globally via environment variable

Set this before starting your agent or server:

```bash
export TENXGRAPH_LLM_TIMEOUT=120   # Use 2-minute timeout instead
```

### Override programmatically

```python
from tenxgraph.core.llm import set_default_llm_timeout, get_default_llm_timeout

# Set a global override
set_default_llm_timeout(120.0)

# Check the current effective timeout
current = get_default_llm_timeout()

# Reset to use env var or built-in default
set_default_llm_timeout(None)
```

### Resolution order

The timeout is determined in this order (first match wins):

1. An explicit `timeout=` kwarg passed to the `Agent` (forwarded to the SDK client).
2. A programmatic override via `set_default_llm_timeout()`.
3. The `TENXGRAPH_LLM_TIMEOUT` environment variable. The old `AGENTFLOW_LLM_TIMEOUT` is still read as a deprecated fallback when `TENXGRAPH_LLM_TIMEOUT` is unset or empty. If `TENXGRAPH_LLM_TIMEOUT` is set but invalid or not positive, it is ignored with a warning and the built-in default applies; the old variable is not consulted.
4. The built-in default of 600 seconds.

### Stream idle timeout

The request timeout covers a whole request. A stream that connects and then goes quiet would wait that full time, so streaming calls can also set `stream_idle_timeout`, the longest wait for the next chunk. It has no default and is off until you set it:

```python
from tenxgraph.core.llm import set_default_stream_idle_timeout

agent = Agent(model="gpt-4o", stream_idle_timeout=20)   # this agent only
set_default_stream_idle_timeout(45)                     # every agent in the process
```

The environment variable `TENXGRAPH_LLM_STREAM_IDLE_TIMEOUT` (seconds) sets the same process default. A per-agent value wins over the process default. When a stream stalls, it is closed and `LLMStreamIdleTimeoutError` is raised. See [LLM stream idle timeout](/docs/concepts/errors-and-limits#llm-stream-idle-timeout).

With `stream_idle_timeout` set, a stall before the first chunk is retried and can fall back to the next model like a connect timeout; a stall after any chunk raises `LLMStreamIdleTimeoutError` and is not retried, so streamed output is never duplicated.

---

## Fallback models

Fallback models provide resilience by allowing the agent to try alternative models if the primary model fails all retries. This is useful for handling provider outages, quota exhaustion, or cost optimization.

When the primary model fails exhaustively, 10xGraph tries each fallback in order until one succeeds.

### Same-provider fallback

Fallback to a cheaper or faster model from the same provider:

```python
agent = Agent(
    model="gpt-4o",                    # Primary model
    fallback_models=["gpt-4o-mini"],   # Falls back to mini if 4o fails
)
```

### Cross-provider fallback

Switch providers for redundancy or better availability:

```python
agent = Agent(
    model="gpt-4o",                              # Primary: OpenAI
    fallback_models=[
        "gpt-4o-mini",                           # Same provider fallback
        ("gemini-2.0-flash", "google"),          # Switch to Google
        ("claude-opus-5", "anthropic"),          # Final fallback: Anthropic
    ],
)
```

Or with explicit provider prefixes:

```python
agent = Agent(
    model="openai/gpt-4o",
    fallback_models=[
        "openai/gpt-4o-mini",
        "google/gemini-2.0-flash",
        "anthropic/claude-opus-5",
    ],
)
```

Fallbacks are tried in order and inherit the primary agent's configuration (system prompt, tools, reasoning settings). Each fallback is a `(model, provider)` tuple, or a bare model string that inherits the primary agent's provider.

---

## Output type

By default, agents generate text. For specialized use cases, you can configure agents to generate images, video, or audio.

| `output_type` | Models | Use case |
|---|---|---|
| `"text"` (default) | All | Natural language responses, analysis, reasoning |
| `"image"` | DALL-E 3, Gemini and Imagen image models | Image generation from prompts |
| `"video"` | Supported video models | Video generation (limited provider support) |
| `"audio"` | TTS models (e.g. OpenAI's tts-1, tts-1-hd) | Text-to-speech conversion |

```python
# Text generation (default)
chat_agent = Agent(model="gpt-4o")

# Image generation
image_agent = Agent(model="dall-e-3", output_type="image")

# Text-to-speech
voice_agent = Agent(model="tts-1", output_type="audio")
```

---

## Structured output

Force the agent to return JSON conforming to a schema using Pydantic models. This is useful when you need deterministic, machine-readable output: extracting data, parsing responses, or integrating with downstream systems.

`output_schema` cannot be combined with `output_type` of `"image"`, `"video"` or `"audio"`. Anthropic supports only `"text"` and `"json"` output types.

```python
from pydantic import BaseModel

class ReviewAnalysis(BaseModel):
    sentiment: str          # "positive", "negative", or "neutral"
    score: float            # 0.0 to 1.0
    summary: str            # Short summary of the review
    key_points: list[str]   # Main points mentioned

agent = Agent(
    model="gpt-4o",
    output_schema=ReviewAnalysis,
    system_prompt=[{
        "role": "system",
        "content": "You are a sentiment analysis expert. Analyze reviews and return structured feedback."
    }],
)
```

The agent's response message will contain a JSON string that parses to a `ReviewAnalysis` instance. The schema is passed to the provider as a response format, so the output follows it.

---

## Extra messages

Use `extra_messages` to inject static few-shot examples or standing instructions that appear in every LLM call, after the system prompt but before the conversation context. This is powerful for steering behavior or teaching the model a pattern through examples.

```python
from tenxgraph.core.state import Message

# Few-shot examples to teach the model a pattern
examples = [
    Message.text_message("Q: What is 2+2?", role="user"),
    Message.text_message("A: 4", role="assistant"),
    Message.text_message("Q: What is 5+3?", role="user"),
    Message.text_message("A: 8", role="assistant"),
]

agent = Agent(
    model="gpt-4o",
    extra_messages=examples,
    system_prompt=[{
        "role": "system",
        "content": "You are a math tutor. Follow the pattern shown in the examples."
    }],
)
```

Extra messages appear in the same order in every call, helping the model learn a consistent style or approach.

---

## API style (OpenAI only)

OpenAI provides two API surfaces; use `api_style` to select which one. Only relevant when using OpenAI models.

| `api_style` | When to use |
|---|---|
| `"chat"` (default) | Most models; standard Chat Completions API |
| `"responses"` | OpenAI Responses API (newer, structured response mode) |

```python
# Chat Completions (default, works with most OpenAI models)
agent = Agent(model="gpt-4o", api_style="chat")

# Responses API (falls back to Chat Completions when output_schema is set)
agent = Agent(model="o4-mini", api_style="responses")
```

---

## Additional LLM parameters

Any extra keyword argument is forwarded to the underlying provider SDK. This gives you access to provider-specific parameters not exposed by the `Agent` class.

```python
agent = Agent(
    model="gpt-4o",
    temperature=0.3,      # Lower = deterministic, higher = creative
    max_tokens=2048,      # Limit output length
    top_p=0.9,            # Nucleus sampling threshold
    frequency_penalty=0.5,    # Penalize repetition
)
```

For Anthropic models, you can pass Anthropic-specific parameters:

```python
agent = Agent(
    model="claude-opus-5",
    provider="anthropic",
    max_tokens=2048,      # Optional; defaults to 16000 (64000 when streaming)
)
```

Newer Claude models such as `claude-opus-5` reject `temperature`, `top_p` and `top_k`, so 10xGraph strips them before the request is sent.

Check the provider SDK documentation (OpenAI, Google GenAI, Anthropic) for the full set of supported parameters.

---

## Complete Agent constructor reference

Here is the full constructor signature with all parameters:

```python
Agent(
    model: str,
    output_type: str = "text",
    system_prompt: list[dict] | None = None,
    tool_node: str | ToolNode | None = None,
    extra_messages: list[Message] | None = None,
    trim_context: bool = False,
    tools_tags: set[str] | None = None,
    reasoning_config: dict | bool | None = {"effort": "medium"},
    skills: SkillConfig | None = None,
    memory: MemoryConfig | None = None,
    retry_config: RetryConfig | bool | None = True,
    fallback_models: list[str | tuple[str, str]] | None = None,
    multimodal_config: MultimodalConfig | None = None,
    output_schema: type[BaseModel] | None = None,
    # Keyword-only arguments:
    provider: str | None = None,
    base_url: str | None = None,
    api_style: str = "chat",
    use_vertex_ai: bool = False,   # default: GOOGLE_GENAI_USE_VERTEXAI == "true"
    anthropic_backend: str | None = None,
    temperature: float | None = None,
    max_tokens: int | None = None,
    # ... any other provider-specific kwargs
)
```

---

## Key takeaways

- **`model` is the only required parameter.** The provider is auto-detected from the model name (e.g., `gpt-4o` → OpenAI, `claude-*` → Anthropic, `gemini-*` → Google).
- **Anthropic models need explicit configuration for Vertex AI or Bedrock:** use `anthropic_backend="vertex"` or `anthropic_backend="bedrock"`.
- **Resilience is built-in:** `retry_config` handles transient failures with exponential back-off; `fallback_models` lets you switch providers on persistent failures.
- **Tools are flexible:** pass a `ToolNode` inline or reference one as a separate graph node. Use `tools_tags` to control which tools the LLM can see.
- **Structured output:** use `output_schema` with a Pydantic model to force JSON output.
- **System prompts support interpolation:** use `{field_name}` placeholders to inject state values at runtime.

## Run it in production

On the server, the model API keys come from the environment file named in `10xgraph.json`, never from the client, and the server drops client-sent run config keys that control limits (such as `tool_timeout`, `node_timeout` and `max_parallel_tool_calls`). Set those limits in your graph code or environment. See [Configure the server](/docs/server/configure) and [Errors and limits](/docs/concepts/errors-and-limits).

## Next steps

- [Create and use tools with the @tool decorator](/docs/guides/use-tool-decorator)
- [Set up thread memory with checkpointing](/docs/guides/set-up-checkpointing)
- [Add long-term memory to agents](/docs/guides/use-memory-store)
- [Explore prebuilt agents](/docs/guides/prebuilt-agents)
- [Learn how Anthropic backends work](/docs/integrations/anthropic)
