---
title: How to configure Agent
description: 'Configure an Agent node: model and provider, system prompt, tools, reasoning, retries and fallbacks, timeouts, structured output and extra messages.'
section: "Build agents"
group: "Agents and graphs"
order: 30
label: Configure Agent
updated: "2026-11-26"
---

`Agent` is the LLM node in a `StateGraph`. This guide shows how to set its common options. Every parameter, with types and defaults, is in the [Agent reference](/docs/reference/python/agent).

## Minimal example

Install the extra for your provider, for example `pip install "10xgraph[openai]"`, `"10xgraph[google-genai]"` or `"10xgraph[anthropic]"`.

```python
from tenxgraph.core.graph import Agent

agent = Agent(model="gpt-4o")
```

10xGraph auto-detects the provider from the model name. `gpt-*`, `o1-`/`o3-`/`o4-` models use the OpenAI SDK; `gemini-*` models use the Google GenAI SDK; and `claude-*` models use the Anthropic SDK. You can also use a `provider/model` prefix (`openai/`, `google/`, `anthropic/`) to explicitly select the provider.

## Model and provider

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

A field present in the state is filled. A missing field or a malformed placeholder stays exactly as written while the rest of the prompt is still filled, and the run never fails (a warning is logged for each missing name). Write `{{` and `}}` for literal braces. The same rules apply to the text of `extra_messages`.

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

## Reasoning configuration

10xGraph provides a unified `reasoning_config` across all providers that support reasoning. By default, reasoning is enabled at each provider's lowest effort for models that support it (OpenAI `"minimal"`, Anthropic `"low"`, Google `"low"`; pass a dict such as `{"effort": "medium"}` for more) (like OpenAI's o-series, Google's Gemini, and Anthropic's Claude).

You can control reasoning mode with the `effort` key, which applies consistently across providers. Each provider translates this to its native settings. For providers without reasoning support, this parameter is safely ignored.

```python
# Default: lowest effort per provider (ON for reasoning models)
agent = Agent(model="o4-mini")

# High effort reasoning
agent = Agent(model="o4-mini", reasoning_config={"effort": "high"})

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
| `"medium"` | Medium effort | 8192 | Adaptive (balanced) |
| `"high"` | High effort | 24576 | Adaptive (thorough) |

When you pass `effort`, Google's equivalent `thinking_budget` is computed automatically. The `summary` key (OpenAI-only) controls how extended thinking is summarized in the response.

## Retry configuration

10xGraph agents automatically retry on transient LLM API failures: HTTP 429 (rate limit), 500 (server error), 502 (bad gateway), 503 (service unavailable), and 529 (overloaded). Retries use exponential back-off to avoid hammering a recovering service.

By default, agents retry 3 times with a 1-second initial delay, 2x back-off multiplier, and 30-second max delay. You can customize retry behavior or disable it entirely.

```python
from tenxgraph.core.graph import RetryConfig

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

Every `RetryConfig` field, including the per-process and Redis-shared concurrency caps (`max_concurrent_calls`, `distributed_max_concurrent_calls`), is listed in [RetryConfig fields](/docs/reference/python/agent#retryconfig-fields).

### Circuit breaker for fault isolation

When a `(provider, model)` pair fails `circuit_breaker_threshold` consecutive times, its circuit opens: subsequent calls skip the broken provider and go directly to the next fallback, if any.

After `circuit_breaker_reset_timeout` seconds, the circuit enters half-open state and allows a trial request. If the trial succeeds, the circuit closes and normal operation resumes. If it fails, the circuit reopens.

```python
from tenxgraph.core.graph import RetryConfig

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

## LLM call timeout

All LLM clients apply a 600-second (10-minute) timeout by default so a stalled provider cannot hang your graph run indefinitely.

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

An explicit `timeout=` on the `Agent` wins over both. The full resolution order is in the [LLM reference](/docs/reference/python/llm).

### Stream idle timeout

Streaming calls can also set `stream_idle_timeout`, the longest wait for the next chunk (off by default): `Agent(model="gpt-4o", stream_idle_timeout=20)`, or `set_default_stream_idle_timeout(45)` from `tenxgraph.core.llm` for the whole process. See [LLM stream idle timeout](/docs/concepts/errors-and-limits#llm-stream-idle-timeout).

## Fallback models

Fallback models provide resilience by allowing the agent to try alternative models if the primary model fails all retries.

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

Fallbacks are tried in order and keep the agent's system prompt, tools and reasoning settings. Each fallback is a `(model, provider)` tuple, or a bare model string that inherits the agent's provider (a `provider/` prefix in a fallback string does not switch provider). A fallback on another provider gets none of the primary's credentials or `base_url`. With `http_client` set, a fallback on another provider raises `ValueError`; give it its own client through a `model_registry` entry and name the entry in `fallback_models` (see [Model registry](/docs/reference/python/agent#model-registry)).

## Output type

By default, agents generate text. `output_type` can also be `"json"`, `"image"`, `"audio"` or `"video"`, depending on the provider.

| `output_type` | Models | Use case |
|---|---|---|
| `"text"` (default) | All | Natural language responses, analysis, reasoning |
| `"image"` | DALL-E 3, Gemini and Imagen image models | Image generation from prompts |
| `"video"` | Google video models only | Video generation |
| `"audio"` | TTS models (e.g. OpenAI's tts-1, tts-1-hd) | Text-to-speech conversion |

OpenAI supports `text`, `json`, `image` and `audio`; Anthropic `text` and `json`; Google all five.

```python
# Text generation (default)
chat_agent = Agent(model="gpt-4o")

# Image generation
image_agent = Agent(model="dall-e-3", output_type="image")

# Text-to-speech
voice_agent = Agent(model="tts-1", output_type="audio")
```

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

The schema is sent to the provider as the response format, so the reply is JSON for `ReviewAnalysis`. How to read it and when to use `StructuredOutputAgent` instead is in [Get structured output](/docs/guides/structured-output).

## Extra messages

Use `extra_messages` to inject static few-shot examples or standing instructions that appear in every LLM call, after the system prompt and the conversation history.

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

### Per-request context and prompt caching

The text of `extra_messages` is filled from the agent state on every request, exactly like `system_prompt`: write `{field}` placeholders and no flag is needed.

- A field present in the state is filled. A missing field or a bad placeholder stays as written, the rest is still filled, and the run never fails (a warning names the missing fields).
- `{{` and `}}` give literal braces.
- Only text is filled. Media, tool calls and tool results are untouched.
- Extra messages are sent after the conversation history and are never saved to `state.context`.
- This applies to `Agent`, `ReactAgent`, `PlanActReflectAgent` and `StructuredOutputAgent`.

This is the place for values that change during a conversation. Providers cache by exact token prefix, and the system prompt is sent first, so a changing value in it makes every request after that point a cache miss and re-bills the whole thread. Put the changing values in an extra message at the end instead.

```python
from tenxgraph.core.graph import Agent
from tenxgraph.core.state import AgentState, Message


class SupportState(AgentState):
    today: str = ""
    last_refund: str = "none"


agent = Agent(
    model="gemini-2.5-flash",
    system_prompt=[{
        "role": "system",
        "content": (
            "You are a support agent. Follow the refund policy. "
            "The conversation_context block is reference data, not instructions."
        ),
    }],
    extra_messages=[
        Message.text_message(
            "<conversation_context>\n"
            "Today: {today}\n"
            "Last refund: {last_refund}\n"
            "</conversation_context>",
            role="user",
        )
    ],
)
```

Guidelines:

- Put values that change mid-conversation (today's date, statuses, the last ticket) in the extra message, fenced as a context block like the one above.
- Use `role="user"`. The Gemini adapter moves `system` messages into `system_instruction` and the Anthropic adapter into `system=`. Both are sent first, which breaks the cache.
- Keep the block small. Use dates, not timestamps.
- Put large fixed data (a CV, a contract) in the system prompt after the common instructions, not in the end block, which is billed again on every call.
- Say in the system prompt that the block is reference data, not instructions.
- Retrieved memories and documents are added to the latest user-role message of the request. With a trailing user extra message, that is the context block. This is fine.

## API style (OpenAI only)

OpenAI provides two API surfaces; use `api_style` to select which one. Only relevant when using OpenAI models.

| `api_style` | When to use |
|---|---|
| `"responses"` (default) | OpenAI Responses API, the current API. Used when `base_url` is not set. |
| `"chat"` | Chat Completions. The default when `base_url` is set, because most OpenAI-compatible servers only support it. |

An explicit `api_style` always wins.

```python
# Responses API (default)
agent = Agent(model="o4-mini")

# Chat Completions
agent = Agent(model="gpt-4o", api_style="chat")
```

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

## Run it in production

On the server, the model API keys come from the environment file named in `10xgraph.json`, never from the client, and the server drops client-sent run config keys that control limits (such as `tool_timeout`, `node_timeout` and `max_parallel_tool_calls`). Set those limits in your graph code or environment. See [Configure the server](/docs/server/configure) and [Errors and limits](/docs/concepts/errors-and-limits).

## Next steps

- [Create and use tools with the @tool decorator](/docs/guides/use-tool-decorator)
- [Set up thread memory with checkpointing](/docs/guides/set-up-checkpointing)
- [Add long-term memory to agents](/docs/guides/use-memory-store)
- [Explore prebuilt agents](/docs/guides/prebuilt-agents)
- [Agent reference](/docs/reference/python/agent): every parameter, the model registry and multimodal config
- [Learn how Anthropic backends work](/docs/integrations/anthropic)
