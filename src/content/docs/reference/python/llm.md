---
title: LLM Utilities
seoTitle: "LLM utilities API reference (Python)"
description: "Provider detection, LLM client creation, and timeout controls from tenxgraph.core.llm."
section: Reference
group: "Python library"
order: 80
label: LLM utilities
updated: "2026-10-08"
---

The `tenxgraph.core.llm` module is the provider layer under `Agent`. It detects the provider from a model name, makes single-turn calls to Google, OpenAI, or Anthropic, builds native async SDK clients, and sets the default request timeout.

## When to use this

`tenxgraph.core.llm` is the thin provider layer that `Agent` and the evaluation judges sit on. Use it directly when you need a single-turn LLM call outside a graph, when you want a raw provider SDK client, or when you need to change the default request timeout process-wide.

For agent behaviour inside a graph, use [`Agent`](/docs/reference/python/agent) instead. This module has no state, no tools, and no retries. For batch jobs, call the provider SDK's batch API directly.

## Import paths

```python
from tenxgraph.core.llm import (
    DEFAULT_LLM_TIMEOUT_SECONDS,
    call_llm,
    create_llm_client,
    detect_provider,
    get_default_llm_timeout,
    resolve_provider_and_model,
    set_default_llm_timeout,
)
```

---

## `call_llm`

```python
async def call_llm(
    model: str,
    prompt: str,
    *,
    system_prompt: str | None = None,
    max_tokens: int = 1024,
    temperature: float = 0.3,
    json_mode: bool = False,
    use_vertex_ai: bool = False,
    api_style: Literal["responses", "chat"] = "responses",
    **llm_kwargs: Any,
) -> tuple[str, int, int, int]
```

Single-turn call with provider auto-detection. The provider and model name are resolved with `resolve_provider_and_model`, a client is created for the provider, and the request is dispatched to the matching backend (Google, OpenAI, or Anthropic).

| Parameter | Type | Default | Description |
|---|---|---|---|
| `model` | `str` | **required** | Model identifier, e.g. `"gemini-2.0-flash"`, `"gpt-4o-mini"`, `"claude-haiku-4-5"`. A recognised `provider/` prefix is stripped before the request is sent. |
| `prompt` | `str` | **required** | The user-turn content. |
| `system_prompt` | `str \| None` | `None` | System instruction prepended to the request. |
| `max_tokens` | `int` | `1024` | Maximum tokens to generate. |
| `temperature` | `float` | `0.3` | Sampling temperature. |
| `json_mode` | `bool` | `False` | Ask for JSON output. Google and OpenAI use their native JSON modes. Anthropic has no equivalent, so an instruction is appended to the system prompt. |
| `use_vertex_ai` | `bool` | `False` | Use the Google Vertex AI client for Google models. Claude model names still resolve to Anthropic. |
| `api_style` | `"responses" \| "chat"` | `"responses"` | OpenAI only. `"responses"` uses `client.responses.create`. Use `"chat"` for models that only support the legacy Chat Completions endpoint. |
| `**llm_kwargs` | any | none | Provider-specific parameters forwarded to the underlying API call. `anthropic_backend` is consumed here to pick the Anthropic backend. |

For Anthropic, `temperature` is dropped for current Claude models that reject it, so it has no effect there.

**Returns:** the plain tuple `(text, input_tokens, output_tokens, cache_read_tokens)`. Token counts are `0` when the provider does not report them.

```python
import asyncio

from tenxgraph.core.llm import call_llm


async def main() -> None:
    text, in_tokens, out_tokens, cached = await call_llm(
        "gemini-2.5-flash",
        "Summarise this ticket in one sentence.",
        system_prompt="You are terse.",
        max_tokens=128,
    )
    print(text, in_tokens, out_tokens, cached)


asyncio.run(main())  # needs GEMINI_API_KEY or GOOGLE_API_KEY
```

### Provider-specific `llm_kwargs`

| Provider | Key | Effect |
|---|---|---|
| Google | `cached_content="cachedContents/abc123"` | Attach an explicit Gemini context cache created through the Google SDK. |
| OpenAI | `prompt_cache_key="my-agent-v1"` | Improve cache hit rates across requests that share a long system-prompt prefix. |
| OpenAI | `prompt_cache_retention="24h"` | Extend cache retention on models that support it (the source notes gpt-5.5 and later). The default is in-memory and short-lived. |

---

## `resolve_provider_and_model`

```python
def resolve_provider_and_model(
    model: str,
    use_vertex_ai: bool = False,
) -> tuple[str, str]
```

Resolves a model string into a concrete `(provider, model)` pair suitable for passing to a client. Unlike `detect_provider`, this also returns the model name to send to the provider.

A recognised `provider/` prefix (`gemini`, `google`, `openai`, `gpt`, `anthropic`, `claude`) is stripped because the provider is selected from the prefix. An unrecognised prefix is kept intact; it may be an OpenAI-compatible or HuggingFace-style identifier where the slash is part of the real model name, e.g. `meta-llama/Llama-3-70b`. Such models always resolve to the `openai` provider.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `model` | `str` | **required** | Model identifier, optionally prefixed with `"provider/"`. |
| `use_vertex_ai` | `bool` | `False` | When True, selects `"google"` unless the model is a Claude model. |

**Returns:** A `(provider, model)` tuple where provider is `"google"`, `"openai"`, or `"anthropic"`.

```python
provider, model = resolve_provider_and_model("gemini/gemini-2.5-flash")
# ("google", "gemini-2.5-flash")

provider, model = resolve_provider_and_model("openai/qwen-2.5-72b")
# ("openai", "qwen-2.5-72b")

provider, model = resolve_provider_and_model("meta-llama/Llama-3-70b")
# ("openai", "meta-llama/Llama-3-70b")  -- unrecognised prefix kept intact
```

---

## `detect_provider`

```python
def detect_provider(model: str, use_vertex_ai: bool = False) -> str
```

Infers the provider from a model name. Returns `"google"`, `"openai"`, or `"anthropic"`. It returns only the provider; use `resolve_provider_and_model` when you also need the model name to send.

Resolution order:

1. A recognised `provider/` prefix wins: `gemini/`, `google/` map to `"google"`; `openai/`, `gpt/` map to `"openai"`; `anthropic/`, `claude/` map to `"anthropic"`. An unrecognised prefix is stripped and detection continues on the remainder.
2. Names starting with `claude-` or `anthropic.` map to `"anthropic"`, even when `use_vertex_ai=True`.
3. `use_vertex_ai=True` returns `"google"`.
4. Names starting with `gemini-`, `imagen-`, `veo-`, or `chirp` map to `"google"`.
5. Names starting with `gpt-`, `o1-`, `o3-`, or `o4-` map to `"openai"`.
6. Anything else defaults to `"openai"`, logged at info level.

```python
detect_provider("gemini-2.5-flash")        # "google"
detect_provider("claude-haiku-4-5")        # "anthropic"
detect_provider("openai/qwen-2.5-72b")     # "openai"
detect_provider("llama-3.3-70b")           # "openai" (fallback, logged)
```

---

## `create_llm_client`

```python
def create_llm_client(
    provider: str,
    *,
    use_vertex_ai: bool = False,
    base_url: str | None = None,
    api_key: str | None = None,
    anthropic_backend: str | None = None,
    **extra_kwargs: Any,
) -> Any
```

Creates a native async SDK client for the given provider.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `provider` | `str` | **required** | `"google"`, `"openai"`, or `"anthropic"`. Anything else raises `ValueError`. |
| `use_vertex_ai` | `bool` | `False` | Google only. Builds a Vertex AI client from `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_LOCATION`. Has no effect on other providers. |
| `base_url` | `str \| None` | `None` | Custom base URL, for example for OpenAI-compatible APIs such as Ollama or vLLM. For Google it sets `HttpOptions.base_url`. |
| `api_key` | `str \| None` | `None` | Explicit API key. Falls back to the provider's environment variable when omitted. |
| `anthropic_backend` | `str \| None` | `None` | Anthropic only. Backend selector: `None` (Claude API), `"vertex"` (Anthropic on Vertex AI), or `"bedrock"` (Anthropic on AWS Bedrock). |
| `**extra_kwargs` | any | none | Forwarded to the OpenAI or Anthropic SDK constructor. Only recognised constructor keys (for example `timeout`, `max_retries`, `default_headers`, `http_client`) are passed through; others are ignored. The Google client reads only `timeout` and `http_client`. `http_client` is an `httpx2.AsyncClient` for openai 3.x and anthropic 1.x, an `httpx.AsyncClient` for google-genai 1.x and 2.x (3.x takes either). See [Use mutual TLS](/docs/security/use-mutual-tls#api-to-the-llm). |

**Raises:** `ImportError` when the provider SDK is not installed, `ValueError` for an unsupported provider, an unsupported `anthropic_backend`, or missing required configuration (for example `GOOGLE_CLOUD_PROJECT` for Vertex AI, or no Gemini key for Google).

The Anthropic extras are `10xgraph[anthropic]`, `10xgraph[anthropic-vertex]`, and `10xgraph[anthropic-bedrock]`.

```python
from tenxgraph.core.llm import create_llm_client

# OpenAI-compatible local server
client = create_llm_client(
    "openai",
    base_url="http://localhost:11434/v1",
    api_key="ollama",
)

# Claude on AWS Bedrock (needs the anthropic-bedrock extra)
client = create_llm_client(
    "anthropic",
    anthropic_backend="bedrock",
)
```

---

## Request timeout

### `DEFAULT_LLM_TIMEOUT_SECONDS`

The built-in default, `600.0` seconds.

### `get_default_llm_timeout`

```python
def get_default_llm_timeout() -> float
```

Returns the timeout in seconds actually in effect. First match wins:

1. An override set through `set_default_llm_timeout`.
2. The `TENXGRAPH_LLM_TIMEOUT` environment variable, in seconds (invalid or non-positive values are ignored with a warning). The old `AGENTFLOW_LLM_TIMEOUT` is still read as a deprecated fallback when `TENXGRAPH_LLM_TIMEOUT` is unset or empty. If `TENXGRAPH_LLM_TIMEOUT` is set but invalid or not positive, it is ignored with a warning and the built-in default applies; the old variable is not consulted.
3. `DEFAULT_LLM_TIMEOUT_SECONDS`.

### `set_default_llm_timeout`

```python
def set_default_llm_timeout(seconds: float | None) -> None
```

Overrides the default timeout process-wide. Pass `None` to clear the override and fall back to the environment variable or built-in default. Raises `ValueError` when `seconds` is not positive.

```python
from tenxgraph.core.llm import get_default_llm_timeout, set_default_llm_timeout

set_default_llm_timeout(120.0)
get_default_llm_timeout()  # 120.0

set_default_llm_timeout(None)
get_default_llm_timeout()  # 600.0, or TENXGRAPH_LLM_TIMEOUT if set
```

This bounds the provider request only. Node and tool execution have their own deadlines: see `node_timeout` and `tool_timeout` in the [graph reference](/docs/reference/python/graph#execution-deadlines). If you set `node_timeout`, keep it above the LLM default (600s), so a slow LLM call fails with its own error instead of being masked by the node deadline.

---

## Common errors

| Error | Cause | Fix |
|---|---|---|
| `ValueError: Unsupported provider: '...'` | A provider other than `"google"`, `"openai"`, or `"anthropic"` was passed to `create_llm_client`. | Use one of the three. Reach other models through an OpenAI-compatible `base_url`. |
| `ValueError: Unsupported anthropic_backend` | `anthropic_backend` is not `None`, `"vertex"`, or `"bedrock"`. | Use a supported value. |
| `ImportError: google-genai SDK is required` | Google provider selected without the SDK. | `pip install "10xgraph[google-genai]"`. |
| `ImportError` on the OpenAI client | OpenAI provider selected without the SDK. | `pip install "10xgraph[openai]"`. |
| `ValueError: LLM timeout must be a positive number of seconds.` | `set_default_llm_timeout` called with `0` or a negative value. | Pass a positive number, or `None` to clear the override. |
| Wrong provider auto-detected | Model name matches no known prefix, so detection falls back to `"openai"`. | Prefix the model, e.g. `"gemini/my-model"`, or call `create_llm_client` with the provider directly. |

---

## Related docs

- [Agent reference](/docs/reference/python/agent)
- [Integrations and models](/docs/integrations/models)
