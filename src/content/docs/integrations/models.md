---
title: Model providers
seoTitle: "Model providers"
description: 10xGraph supports OpenAI, Google Gemini, and Anthropic Claude through a single Agent interface. Choose your model independently of your graph.
section: Integrations
group: Models
order: 20
label: Overview
updated: "2026-10-08"
---

10xGraph talks to model providers through a unified `Agent` interface. You choose a model, and the library handles provider detection and SDK interaction. The three supported providers are OpenAI (including compatible endpoints), Google (Gemini and Vertex AI), and Anthropic (direct API, Vertex AI, and Bedrock). Once you select a provider, your graph code remains the same: you pass only the model name and optional configuration to the Agent, and the rest is transparent.

Provider choice is a small decision in 10xGraph. The same tools, state, and checkpointer work across all providers. Your production infrastructure (API server, authentication, persistence) does not change when you switch models.

## How provider selection works

When you create an `Agent`, you pass a `model` string. The library detects the provider in three ways, in order:

### Explicit provider prefix

Use `provider/model` format to explicitly select a provider. The recognised prefixes are `gemini`, `google`, `openai`, `gpt`, `anthropic` and `claude`; the prefix is stripped from the model name before the request is sent:

```python
from tenxgraph import Agent

agent = Agent(model="openai/gpt-4o")
agent = Agent(model="gemini/gemini-2.5-flash")
agent = Agent(model="anthropic/claude-opus-5")
```

### Auto-detection from model name

If no prefix is given, `detect_provider()` infers the provider from the model name:

| Model prefix | Provider |
|---|---|
| `gemini-`, `imagen-`, `veo-`, `chirp` | `google` |
| `gpt-`, `o1-`, `o3-`, `o4-` | `openai` |
| `claude-`, `anthropic.` | `anthropic` |

Examples:

```python
agent = Agent(model="gpt-4o-mini")          # -> OpenAI
agent = Agent(model="gemini-2.5-pro")       # -> Google
agent = Agent(model="claude-opus-5")        # -> Anthropic
agent = Agent(model="anthropic.claude-3")   # -> Anthropic (Bedrock style)
```

### Fallback and unrecognized prefixes

If the model name does not match any known prefix and no explicit provider is given, the library defaults to `"openai"`. This allows OpenAI-compatible endpoints (Ollama, vLLM, OpenRouter, etc.) to work out of the box. The library logs that it defaulted to OpenAI:

```python
agent = Agent(
    model="my-custom-model",
    base_url="https://my-gateway.example.com/v1"
)
# Logs: "Could not auto-detect provider for model 'my-custom-model'. Defaulting to 'openai'."
```

An unrecognized `provider/` prefix is also treated as OpenAI-compatible, and the full string is kept as the model name:

```python
agent = Agent(model="meta-llama/Llama-3-70b")  # Unrecognized prefix -> OpenAI provider, name kept intact
```

## Provider backends and environments

Each provider supports different deployment environments and backend configurations.

### OpenAI

```python
# Direct API (OpenAI)
agent = Agent(
    model="gpt-4o",
    provider="openai",
    api_key="sk-..."  # Falls back to OPENAI_API_KEY env var
)
```

- Credentials: `api_key` or `OPENAI_API_KEY` environment variable.
- Installation: `pip install "10xgraph[openai]"`

### Google (Gemini API and Vertex AI)

```python
# Gemini API (Google AI Studio)
agent = Agent(
    model="gemini-2.5-flash",
    provider="google",
    # Reads GEMINI_API_KEY or GOOGLE_API_KEY from the environment
)

# Google Cloud Vertex AI
agent = Agent(
    model="gemini-2.5-flash",
    provider="google",
    use_vertex_ai=True  # Uses GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION
)
```

- Credentials (Gemini API): `GEMINI_API_KEY` / `GOOGLE_API_KEY` environment variables (the Google provider takes no `api_key` argument).
- Credentials (Vertex AI): Google Cloud authentication (ADC or service account).
- Installation: `pip install "10xgraph[google-genai]"`

The `use_vertex_ai=True` flag switches from Gemini API to Vertex AI. It also affects Anthropic when using Claude on Vertex AI (see below).

### Anthropic (Claude API, Vertex AI, and Bedrock)

```python
# Direct Claude API
agent = Agent(
    model="claude-opus-5",
    provider="anthropic",
    api_key="sk-ant-..."  # Falls back to ANTHROPIC_API_KEY env var
)

# Google Cloud Vertex AI
agent = Agent(
    model="claude-opus-5",
    provider="anthropic",
    anthropic_backend="vertex",
    # Uses Google Cloud authentication
)

# AWS Bedrock (Claude via Bedrock Messages API)
agent = Agent(
    model="anthropic.claude-opus-5",
    provider="anthropic",
    anthropic_backend="bedrock",
    # Uses AWS credentials (IAM role, environment variables, or config file)
)
```

- Credentials (Claude API): `api_key` or `ANTHROPIC_API_KEY` environment variable.
- Credentials (Vertex AI): Google Cloud authentication.
- Credentials (Bedrock): AWS authentication (IAM role, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, or profile).
- Installation: `pip install "10xgraph[anthropic]"` (Claude API), `pip install "10xgraph[anthropic-vertex]"` (Vertex), or `pip install "10xgraph[anthropic-bedrock]"` (Bedrock).

The `anthropic_backend` parameter selects the backend:
- `None` (default): Direct Claude API
- `"vertex"`: Claude on Google Cloud Vertex AI
- `"bedrock"`: Claude on AWS Bedrock (use model names like `"anthropic.claude-opus-5"`)

## Capability matrix

The table below shows which provider supports each capability. A check mark means the feature is available; a dash means it is not supported by that provider's current API.

| Feature | OpenAI | Google | Anthropic |
|---|---|---|---|
| **Tool calling** | Yes | Yes | Yes |
| **Structured output** (`output_schema`) | Yes | Yes (not combinable with tools) | Yes |
| **Streaming** | Yes | Yes | Yes |
| **Reasoning** (`reasoning_config`) | Yes | Yes (thinking) | Yes (adaptive thinking) |
| **Prompt caching** | Automatic | Implicit, plus explicit `cached_content` | `anthropic_cache` |
| **Multimodal input** | Image, audio, document | Image, video, audio, document | Image, PDF (audio and video are not supported) |
| **Other output types** (`output_type`) | image, audio | image, video, audio | none (text and json only) |
| **Batch API** | `OpenAIBatch` | - | `AnthropicBatch` |

### Tools

All three providers support tool calling. When you attach tools to an Agent, the library converts the tool schema to the provider's format and handles the request/response cycle.

```python
from tenxgraph import Agent, ToolNode

tool_node = ToolNode([my_tool_1, my_tool_2])

agent = Agent(model="gpt-4o", tool_node=tool_node)
agent = Agent(model="gemini-2.5-flash", tool_node=tool_node)
agent = Agent(model="claude-opus-5", tool_node=tool_node)
```

`Agent` is a graph node, so add `tool_node` to your `StateGraph` as well. For a ready-made loop, use `ReactAgent(model=..., tools=[...])`.

### Structured output

Pass `output_schema` to the Agent to request a specific JSON structure from the model:

```python
from pydantic import BaseModel

from tenxgraph import Agent

class Summary(BaseModel):
    title: str
    bullet_points: list[str]

agent = Agent(
    model="gpt-4o",
    output_schema=Summary,
    # Or use output_type="json" for untyped JSON
)
```

- **OpenAI** routes `output_schema` through the Chat Completions parse path.
- **Anthropic** sends the schema as `output_config.format`.
- **Google** sets a JSON response schema. Combining `output_schema` with tools raises a `ValueError`.
- `output_type` also selects image, video or audio generation where the provider supports it (see the matrix above).

### Streaming

All three providers support streaming. Streaming runs through the compiled graph, not the `Agent` node:

```python
from tenxgraph.core.state import Message

async for chunk in app.astream({"messages": [Message.text_message("Hello")]}):
    print(chunk)
```

Here `app` is your compiled graph.

### Reasoning models

Some models include explicit reasoning or thinking capabilities:

`reasoning_config` is on by default with `{"effort": "medium"}`. Pass `None` or `False` to turn it off.

- **OpenAI:** `effort` is sent as `reasoning_effort` (Chat Completions) or `reasoning` (Responses API).
- **Anthropic:** `effort` becomes `thinking={"type": "adaptive"}` plus `output_config={"effort": ...}`.
- **Google:** `effort` maps to a `thinking_budget`; you can also pass `thinking_budget` or `thinking_level`.

```python
agent = Agent(model="o4-mini", reasoning_config={"effort": "high"})
agent = Agent(model="claude-opus-5", reasoning_config={"effort": "high"})
agent = Agent(model="gemini-2.5-flash", reasoning_config=None)  # off
```

### Prompt caching

Caching reduces cost and latency for repeated requests with long context:

- **OpenAI:** Automatic prefix caching. Pass `prompt_cache_key` to improve hit rates.
- **Google:** Implicit caching is automatic; pass `cached_content` for an explicit cache.
- **Anthropic:** Pass `anthropic_cache=True` (or a `cache_control` dict) to cache the tools and system prompt.

See each provider page for details.

### Multimodal input

Each provider supports different input types:

- **OpenAI:** Images, audio and documents. Attach via `ImageBlock`, `AudioBlock` or `DocumentBlock` in the message content. Video is passed as a text reference only.
- **Google:** Images, video, audio and documents, using the matching content block types.
- **Anthropic:** Images and documents (such as PDF) via `ImageBlock` or `DocumentBlock`. Audio and video parts are not sent.

See `/docs/guides/send-media` for detailed examples.

### Batch API

For cost-sensitive bulk processing, OpenAI and Anthropic offer batch APIs:

- **OpenAI:** `OpenAIBatch` class.
- **Anthropic:** `AnthropicBatch` class. Same interface: `add`, `submit`, `status`, `wait`, `results`.

Both live in `tenxgraph.core.llm`.

Batch is not for interactive workloads; use the regular invoke/stream API for agent interactions. See `/docs/guides/batch-llm-calls` for examples.

## Other models: OpenAI-compatible endpoints

Any model served behind an OpenAI-compatible API can be used with 10xGraph:

```python
agent = Agent(
    model="my-model",
    provider="openai",
    base_url="https://my-gateway.example.com/v1",
    api_key="...",
)
```

Common examples:

- **Ollama:** `base_url="http://localhost:11434/v1"`
- **vLLM:** `base_url="http://localhost:8000/v1"`
- **OpenRouter:** `base_url="https://openrouter.ai/api/v1"`
- **Self-hosted:** Any private gateway that mimics the OpenAI Chat Completions API.

Most gateways only support the legacy Chat Completions endpoint, so an Agent with a `base_url` uses Chat Completions by default. Pass `api_style="responses"` if your gateway implements the Responses API. To state the default explicitly:

```python
agent = Agent(
    model="my-model",
    provider="openai",
    base_url="https://legacy-gateway.example.com/v1",
    api_style="chat",
)
```

## Related pages

- [OpenAI integration](/docs/integrations/openai): model list, pricing, keys, and options.
- [Google integration](/docs/integrations/google): Gemini and Vertex AI setup.
- [Anthropic integration](/docs/integrations/anthropic): Claude, Vertex, and Bedrock setup.
- [Agents and tools](/docs/concepts/agents-and-tools): how Agent works with tool calling.
- [LLM utilities reference](/docs/reference/python/llm): `detect_provider`, `create_llm_client`, and batch classes.
