---
title: Google
seoTitle: "Google provider: Gemini models"
description: Configure the Google provider to run Gemini models via Google AI Studio or Vertex AI.
section: Integrations
group: "Models"
order: 40
label: Google
updated: "2026-10-08"
---

Run Gemini models through Google GenAI. The same models and features work through two backends, so you choose based on your infrastructure: a single API key for quick development, or Google Cloud integration for enterprise security and compliance.

## Choosing Your Backend

Gemini models (for example `gemini-2.0-flash`, `gemini-2.5-flash` and `gemini-3-flash-preview`) run on two backends:

- **Gemini API** (Google AI Studio): fastest path to get started; authentication is a single API key.
- **Vertex AI**: same models routed through Google Cloud; includes IAM-scoped access, audit logs, regional data residency, and VPC Service Controls.

Both backends support the same advanced features: context caching, extended thinking, and structured output. Switch between them with a single flag: `use_vertex_ai=True` on the `Agent`, or `GOOGLE_GENAI_USE_VERTEXAI=true` in the environment. If both are set, the explicit argument on `Agent` wins.

## Setup

1. Install the Google provider extra, which pulls in the Google GenAI SDK:

    ```bash
    pip install "10xgraph[google-genai]"
    ```

2. Get an API key from [Google AI Studio](https://aistudio.google.com).

3. Export it:

    ```bash
    export GEMINI_API_KEY="your-key"
    ```

    Either `GEMINI_API_KEY` or `GOOGLE_API_KEY` works; `GEMINI_API_KEY` is preferred.

## Basic usage

Create an agent with a Gemini model. You need only the model name and provider; 10xGraph reads `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) from the environment. The Google provider does not accept an `api_key=` argument.

```python
from tenxgraph.core.graph import Agent

agent = Agent(
    model="gemini-2.5-flash",
    provider="google",
    system_prompt=[{"role": "system", "content": "You are a helpful assistant."}],
)
```

## Full example with tools

Build a complete agent with tools that the model can call to fetch information. This example uses the `ReactAgent` prebuilt agent, which handles the tool loop automatically.

```python
from dotenv import load_dotenv

from tenxgraph.core.state import AgentState, Message
from tenxgraph.prebuilt.agent import ReactAgent

load_dotenv()

def get_weather(
    location: str,
    tool_call_id: str | None = None,
    state: AgentState | None = None,
) -> str:
    return f"The weather in {location} is sunny."

react_agent = ReactAgent(
    model="gemini-2.5-flash",
    provider="google",
    system_prompt=[
        {
            "role": "system",
            "content": "You are a helpful assistant. Use tools when they help answer the user.",
        }
    ],
    tools=[get_weather],
    trim_context=True,
)

if __name__ == "__main__":
    app = react_agent.compile()

    result = app.invoke(
        {"messages": [Message.text_message("What is the weather in New York City?")]},
        config={"thread_id": "google-demo", "recursion_limit": 10},
    )

    for message in result["messages"]:
        print(message.role, message)
```

---

## Context Caching

Gemini offers two caching modes. Both reduce input token costs and latency for prompts
that repeat the same large prefix across requests.

### Implicit Caching (Gemini 2.5+)

Enabled automatically on all Gemini 2.5 and later models. No code changes required.
Google detects matching prefixes on their infrastructure and passes on the savings.

Cache hit counts are read from `usage_metadata.cached_content_token_count` and logged at
`DEBUG` level by 10xGraph after every non-streaming response.

```python
from tenxgraph import Agent

long_system_prompt = "..."  # a large, stable prompt

# Implicit caching fires automatically, nothing to configure
agent = Agent(
    model="gemini-2.5-flash",
    system_prompt=[{"role": "system", "content": long_system_prompt}],
)
```

For implicit caching to hit consistently, the prompt prefix must be **stable across
requests**. In practice this means:
- `system_prompt` is set at Agent init time and does not change per request.
- Dynamic per-request context (user name, current date, state data) is kept out of the
  system prompt and injected into the conversation messages instead.

### Explicit Caching

For guaranteed savings on very large static content (multi-page PDFs, long codebases,
reference documents), create a cache explicitly using the Google SDK and pass the cache
name to the Agent via `cached_content`.

**Step 1, create the cache outside the Agent:**

```python
import asyncio
from google import genai
from google.genai import types

client = genai.Client(api_key="...")

async def create_cache():
    cache = await client.aio.caches.create(
        config=types.CreateCachedContentConfig(
            model="gemini-2.5-flash",
            display_name="legal-docs-v1",
            system_instruction="You are a legal analyst...",
            contents=[
                types.Content(
                    role="user",
                    parts=[types.Part(text=large_document_text)],
                )
            ],
            ttl="7200s",  # 2 hours
        )
    )
    return cache.name  # e.g. "cachedContents/abc123"

cache_name = asyncio.run(create_cache())
```

**Step 2, pass the cache name to the Agent:**

```python
from tenxgraph import Agent

agent = Agent(
    model="gemini-2.5-flash",
    system_prompt=[],         # static instruction is already inside the cache
    cached_content=cache_name,  # forwarded through llm_kwargs
)
```

Google enforces a minimum cached token count per model; see the Gemini API documentation for current values.

**What can be cached:** system instructions, plain text, PDF documents, video files (via
GCS URIs). The cache is stored server-side; you reference it by name.

**Cache lifecycle:** 10xGraph does not manage it. Create, refresh and delete caches via
the Google SDK directly.

### Mixing Static and Dynamic System Instructions

When using explicit caching, the Google SDK does not allow sending `system_instruction`
in `GenerateContentConfig` alongside `cached_content`, the static instruction already
lives inside the cache.

10xGraph handles this automatically:

- If `cached_content` is set, `system_instruction` is **excluded** from the config.
- Any dynamic additions to the system prompt, from memory injections, skill prompts, or
  per-request state, are **preserved** by prepending them as a leading user message in
  `contents` before the conversation history.

The recommended pattern:

```python
# Static instruction, goes into the cache at creation time
static_instruction = "You are a legal analyst. Reference the attached documents..."

agent = Agent(
    model="gemini-2.5-flash",
    system_prompt=[
        # Dynamic context injected per-request by memory/skill systems
        # e.g. {"role": "system", "content": "User preference: formal tone"}
    ],
    cached_content=cache_name,
)
```

### SummaryContextManager with explicit caching

`call_llm` (a single-turn helper) accepts `cached_content` via `**llm_kwargs`.

```python
from tenxgraph.core.state import SummaryContextManager
from tenxgraph.core.llm import call_llm

# Inside an async function:
text, inp, out, cache = await call_llm(
    "gemini-2.5-flash",
    "Summarise the attached documents.",
    cached_content=cache_name,
)

# SummaryContextManager does not accept cached_content directly.
# Implicit cache on Gemini 2.5+ already benefits the summariser
# when its system prompt prefix is stable across calls.
manager = SummaryContextManager(
    model="gemini-2.5-flash",
    token_budget=8000,
)
```

### Evaluation judge with caching

The evaluation judge calls `call_llm` via `LLMCallerMixin`. Implicit caching on Gemini
2.5+ fires automatically when the judge prompt prefix (rubric + instructions) is stable.
Explicit cache support is not yet wired through `CriterionConfig`.

```python
from tenxgraph.qa.evaluation import CriterionConfig, EvalConfig, CriteriaConfig

config = EvalConfig(
    criteria=CriteriaConfig(
        llm_judge=CriterionConfig.llm_judge(
            judge_model="gemini-2.5-flash",   # implicit cache fires automatically
        )
    )
)
```

---

## Thinking Models

Gemini thinking models support extended thinking. Control it via `reasoning_config`
(the default is effort `"low"`, which is `thinking_budget=512`; pass a dict for more). Thinking is not applied when `output_schema` is set
or `output_type` is not text or json.

```python
# Enable with defaults
agent = Agent(model="gemini-2.5-flash", reasoning_config=True)

# Set token budget explicitly (Gemini 2.5 style)
agent = Agent(
    model="gemini-2.5-flash",
    reasoning_config={"thinking_budget": 8000},  # tokens to spend on reasoning
)

# Set thinking level (Gemini 3 style)
agent = Agent(
    model="gemini-3-flash-preview",
    reasoning_config={"thinking_level": "high"},  # "minimal"|"low"|"medium"|"high"
)

# Map from effort string (works on both generations)
agent = Agent(
    model="gemini-2.5-flash",
    reasoning_config={"effort": "medium"},  # "low" | "medium" | "high"
)

# Disable
agent = Agent(model="gemini-2.5-flash", reasoning_config=False)
```

Effort-to-budget mapping used internally:

| effort | thinking_budget |
|---|---|
| `"low"` | 512 |
| `"medium"` | 8192 |
| `"high"` | 24576 |

---

## Using Vertex AI

Vertex AI runs the same Gemini models on Google Cloud, but authenticates with Application Default Credentials instead of an API key. Use it when you need:

- IAM-scoped access control instead of a shared API key
- Regional data residency (EU, Asia, etc.)
- GCP audit logging or VPC Service Controls
- To reuse the service account already attached to your GCP workload

All other configuration options (caching, thinking, structured output) work identically on both backends.

### 1. Set up GCP credentials

1. Enable the **Vertex AI API** on your GCP project.
2. Create a service account with the `roles/aiplatform.user` role and download its JSON key.
3. Export the GCP environment variables:

    ```bash
    export GOOGLE_CLOUD_PROJECT="your-gcp-project-id"
    export GOOGLE_CLOUD_LOCATION="us-central1"           # optional
    export GOOGLE_APPLICATION_CREDENTIALS="./service_account.json"
    ```

   On GCP runtimes (Cloud Run, GKE, Compute Engine, etc.) the attached service account is picked up automatically, you only need `GOOGLE_CLOUD_PROJECT`.

### 2. Enable Vertex AI

**Option A, pass `use_vertex_ai=True` on the agent:**

```python
agent = Agent(
    model="gemini-2.5-flash",
    provider="google",
    system_prompt=[{"role": "system", "content": "You are a helpful assistant."}],
    use_vertex_ai=True,
)
```

**Option B, set `GOOGLE_GENAI_USE_VERTEXAI=true` in the environment:**

```bash
export GOOGLE_GENAI_USE_VERTEXAI=true
```

With this set, every Google agent in your process uses Vertex AI without changing any code. Useful when the same code runs locally against Gemini API and on GCP against Vertex AI.

If both are set, the explicit `use_vertex_ai=True` argument wins.

---

## Structured Output

Force the model to return a specific JSON schema by passing `output_schema`. Google does
not support combining structured output with tool calls: a call with both raises a
`ValueError`.

```python
from pydantic import BaseModel

class ExtractedData(BaseModel):
    name: str
    amount: float
    currency: str

agent = Agent(
    model="gemini-2.5-flash",
    output_schema=ExtractedData,
    system_prompt=[...],
)
```

---

## `llm_kwargs` Reference

All unrecognised keyword arguments passed to `Agent(...)` land in `self.llm_kwargs` and
are stored there; for Google only the keys below reach `GenerateContentConfig`.

| kwarg | Type | Notes |
|---|---|---|
| `cached_content` | `str` | Name of an explicit Gemini cache (e.g. `"cachedContents/abc123"`). Mutually exclusive with `system_instruction` in the config, 10xGraph handles this automatically. |
| `temperature` | `float` | Sampling temperature. |
| `max_tokens` / `max_output_tokens` | `int` | Maximum output tokens. Both aliases are accepted. |

Other keyword arguments (such as `top_p` and `top_k`) are not forwarded to Gemini.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | yes (Gemini API) | API key from Google AI Studio (preferred name) |
| `GOOGLE_API_KEY` | - | Fallback name for the Gemini API key |
| `GOOGLE_GENAI_USE_VERTEXAI` | - | Set to `true` to route the Google provider through Vertex AI |
| `GOOGLE_CLOUD_PROJECT` | yes (Vertex AI) | GCP project ID with the Vertex AI API enabled |
| `GOOGLE_CLOUD_LOCATION` | - | Region for Vertex AI calls (default `us-central1`) |
| `GOOGLE_APPLICATION_CREDENTIALS` | - | Path to a service-account JSON key. Not required on GCP workloads with an attached service account |

## Common Errors

| Error | Fix |
|---|---|
| `ImportError: google-genai SDK is required` | `pip install "10xgraph[google-genai]"` |
| `ValueError: GEMINI_API_KEY or GOOGLE_API_KEY environment variable must be set` | Export one of the two variables |
| `ValueError: Google GenAI does not currently support combining tool calls ...` | Remove either `output_schema` or the tools from that agent |
| `Model not found` | Double-check the model name, Gemini model names are case-sensitive |
| `ValueError: GOOGLE_CLOUD_PROJECT environment variable must be set` | Export `GOOGLE_CLOUD_PROJECT` before creating the agent (Vertex AI only) |
| `PermissionDenied: Vertex AI API has not been used` | Enable the Vertex AI API on your GCP project |
| `403: caller does not have permission` | Grant the service account the `roles/aiplatform.user` role |
