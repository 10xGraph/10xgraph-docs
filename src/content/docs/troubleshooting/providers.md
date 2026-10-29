---
title: "Provider errors"
description: "Fix LLM provider errors: missing SDK extras, API keys, model names, rate limits, Vertex AI and Bedrock setup, and timeouts."
seoTitle: "LLM provider troubleshooting"
label: "Providers"
section: Troubleshooting
order: 30
updated: "2026-10-08"
faq:
  - q: "Which SDK extra do I need?"
    a: "Install the extra for your provider: 10xgraph[openai], 10xgraph[google-genai] or 10xgraph[anthropic]. For Claude on Vertex AI or Bedrock use 10xgraph[anthropic-vertex] or 10xgraph[anthropic-bedrock]."
  - q: "Why does my LLM call time out?"
    a: "The default request timeout is 600 seconds. Raise it with the TENXGRAPH_LLM_TIMEOUT environment variable (in seconds), or pass timeout to Agent for OpenAI and Anthropic."
  - q: "Do I need to enable retries for rate limits?"
    a: "No. Agent retries 429, 500, 502, 503 and 529 responses by default with exponential backoff. Pass a RetryConfig to change the limits."
---

When an agent fails at the provider boundary, the cause is almost always one of six things: a missing SDK extra, a missing credential, a wrong model name, a rate limit, a Vertex AI or Bedrock setup gap, or a timeout. This page maps each error to its fix, verified against the 10xGraph client factory.

<aside class="callout callout-note" role="note"><p class="callout-title">Quick reference</p>

| Symptom | First step |
|---|---|
| `ImportError: ... SDK is required` | Install the provider extra, for example `pip install "10xgraph[openai]"` |
| `ValueError: GEMINI_API_KEY or GOOGLE_API_KEY ...` | Set `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) |
| 401 or authentication error from OpenAI or Anthropic | Set `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` |
| Model not found | Check the exact model id in the provider docs |
| 429 or 529 responses | Keep retries on, or tune `RetryConfig` |
| `GOOGLE_CLOUD_PROJECT environment variable must be set` | Export `GOOGLE_CLOUD_PROJECT` for Vertex AI |
| Request times out | Raise `TENXGRAPH_LLM_TIMEOUT` or pass `timeout` |

</aside>

## Fix a missing SDK extra

The `10xgraph` base package does not install any LLM SDK. Each provider is an optional extra, and the client factory raises `ImportError` with the install command when the SDK is absent.

| Provider | Install command |
|---|---|
| OpenAI (and OpenAI-compatible endpoints) | `pip install "10xgraph[openai]"` |
| Google Gemini (API key or Vertex AI) | `pip install "10xgraph[google-genai]"` |
| Anthropic, direct API | `pip install "10xgraph[anthropic]"` |
| Anthropic on Vertex AI | `pip install "10xgraph[anthropic-vertex]"` |
| Anthropic on Bedrock | `pip install "10xgraph[anthropic-bedrock]"` |

Install several at once with one command:

```bash
# Install the OpenAI, Gemini and Anthropic SDKs together
pip install "10xgraph[openai,google-genai,anthropic]"
```

Check the install by building an agent. The client is created in the constructor, so a missing SDK fails here rather than at the first request.

```python title="check_sdk.py"
from tenxgraph.core import Agent

# Raises ImportError immediately if the OpenAI SDK is not installed
agent = Agent(
    model="gpt-4o",
    system_prompt=[{"role": "system", "content": "You are helpful."}],
)
print("SDK found, provider:", agent.provider)
```

## Fix authentication and API key errors

Each provider reads its key from an environment variable. If the key is missing or wrong, the provider rejects the request, except for Google, where 10xGraph raises a `ValueError` at construction time.

| Provider | Variable | Behavior when unset |
|---|---|---|
| OpenAI | `OPENAI_API_KEY` | Logs a warning; requests fail unless you use a `base_url` that needs no key |
| Google (Gemini API) | `GEMINI_API_KEY`, falling back to `GOOGLE_API_KEY` | Raises `ValueError` |
| Anthropic | `ANTHROPIC_API_KEY` | Logs an info message; the SDK tries `ANTHROPIC_AUTH_TOKEN`, an `ant auth login` profile or workload identity federation |

Export the key in your shell, or load it from a `.env` file before you build the agent:

```python title="load_keys.py"
from dotenv import load_dotenv

# Reads OPENAI_API_KEY, GEMINI_API_KEY or ANTHROPIC_API_KEY from .env
load_dotenv()
```

```bash
export OPENAI_API_KEY="sk-..."
export GEMINI_API_KEY="your-key"
export ANTHROPIC_API_KEY="sk-ant-..."
```

You can also pass `api_key="..."` to `Agent` for a single agent. Prefer environment variables so keys stay out of source control. If an error persists, confirm the key belongs to the same provider as the model, since `gpt-*`, `gemini-*` and `claude-*` names are routed to different SDKs.

<aside class="callout callout-tip" role="note"><p class="callout-title">Gemini mode</p>

When `use_vertex_ai` is false, 10xGraph builds the Gemini client in API-key mode explicitly. A stray `GOOGLE_GENAI_USE_VERTEXAI=true` in your environment still sets the default of `use_vertex_ai` on `Agent`, so unset it if you want the API-key path.

</aside>

## Fix model name and access errors

A "model not found" error means the provider does not recognize the id, or your account cannot use it. 10xGraph picks the provider from the model name, so a typo can also route the request to the wrong SDK.

Provider detection follows these rules:

| Model name | Provider |
|---|---|
| Starts with `claude-` or `anthropic.` | Anthropic |
| Starts with `gemini-`, `imagen-`, `veo-` or `chirp` | Google |
| Starts with `gpt-`, `o1-`, `o3-` or `o4-` | OpenAI |
| `gemini/`, `google/`, `openai/`, `gpt/`, `anthropic/` or `claude/` prefix | The named provider; the prefix is stripped |
| Anything else | OpenAI, with the full name kept (for OpenAI-compatible servers) |

If the auto-detected provider is wrong, set it explicitly with `provider="openai"`, `"google"` or `"anthropic"`. Then check the id against the provider's model list, and confirm that your account tier has access to it. Model ids change over time, so always copy the current one from the provider docs. See [Models and providers](/docs/integrations/models) for how selection works.

## Handle rate limits and transient errors

Rate limit responses (HTTP 429) are temporary. `Agent` already retries them: `retry_config` defaults to `True`, which applies the default `RetryConfig` with exponential backoff.

The default retryable status codes are 429, 500, 502, 503 and 529. Tune the behavior with `RetryConfig`:

| Field | Default | Meaning |
|---|---|---|
| `max_retries` | `3` | Retries on the primary model before moving to a fallback |
| `initial_delay` | `1.0` | Seconds before the first retry |
| `max_delay` | `30.0` | Cap on the backoff delay, in seconds |
| `backoff_factor` | `2.0` | Multiplier applied after each retry |

```python title="retry.py"
from tenxgraph.core import Agent
from tenxgraph.core.graph import RetryConfig

# Retry up to 5 times, waiting 2s, 4s, 8s, ... capped at 60s
agent = Agent(
    model="gpt-4o",
    system_prompt=[{"role": "system", "content": "You are helpful."}],
    retry_config=RetryConfig(max_retries=5, initial_delay=2.0, max_delay=60.0),
)
```

If retries are exhausted, you are likely over your quota or tier limit. Reduce concurrency, move bulk work to [batch LLM calls](/docs/guides/batch-llm-calls), or raise your account tier. Pass `retry_config=False` only if you want failures to surface immediately.

## Configure Vertex AI

Gemini on Vertex AI uses Application Default Credentials and a GCP project instead of an API key. Enable it with `use_vertex_ai=True`, or by setting `GOOGLE_GENAI_USE_VERTEXAI=true`.

| Variable | Required | Notes |
|---|---|---|
| `GOOGLE_CLOUD_PROJECT` | Yes | Missing value raises `ValueError: GOOGLE_CLOUD_PROJECT environment variable must be set for Vertex AI.` |
| `GOOGLE_CLOUD_LOCATION` | No | Defaults to `us-central1` |
| `GOOGLE_APPLICATION_CREDENTIALS` | Local machines | Path to a service account JSON key; not needed on GCP workloads with an attached service account |

```python title="vertex_gemini.py"
from tenxgraph.core import Agent

# Requires GOOGLE_CLOUD_PROJECT and Application Default Credentials
agent = Agent(
    model="gemini-2.5-flash",
    use_vertex_ai=True,
    system_prompt=[{"role": "system", "content": "You are helpful."}],
)
```

For a 403 `PermissionDenied`, grant the service account a role that allows Vertex AI predictions (`roles/aiplatform.user` is the usual choice) and enable the API:

```bash
# Enable the Vertex AI API on the project
gcloud services enable aiplatform.googleapis.com --project=PROJECT_ID

# Confirm Application Default Credentials resolve
gcloud auth application-default print-access-token
```

Claude models also run on Vertex AI, but you select that with `anthropic_backend="vertex"`, not `use_vertex_ai`. Claude model names always route to the Anthropic provider.

## Configure Claude on Vertex AI or Bedrock

Anthropic reaches three backends, chosen with `anthropic_backend`: `None` for the direct API, `"vertex"`, or `"bedrock"`. Any other value raises `ValueError: Unsupported anthropic_backend`.

| Backend | Install extra | Model id style |
|---|---|---|
| Direct API | `anthropic` | `claude-opus-5` |
| Vertex AI | `anthropic-vertex` | Bare id, `claude-opus-5` |
| Bedrock | `anthropic-bedrock` | Keeps the prefix, `anthropic.claude-opus-5` |

```python title="claude_backends.py"
from tenxgraph.core import Agent

prompt = [{"role": "system", "content": "You are helpful."}]

# Vertex AI: the SDK resolves project and region from the environment
vertex_agent = Agent(model="claude-opus-5", anthropic_backend="vertex", system_prompt=prompt)

# Bedrock: keep the anthropic. prefix on the model id
bedrock_agent = Agent(
    model="anthropic.claude-opus-5",
    anthropic_backend="bedrock",
    system_prompt=prompt,
)
```

10xGraph resolves region, project and AWS credentials through the Anthropic SDK unless you pass them in `llm_kwargs`. The accepted keys are `region`, `project_id`, `access_token` and `credentials` for Vertex, and `aws_access_key`, `aws_secret_key`, `aws_session_token`, `aws_region`, `aws_profile` and `api_key` for Bedrock. For example, `Agent(..., anthropic_backend="bedrock", aws_region="us-west-2", aws_profile="default")`.

For a Bedrock `ValidationException`, check that the model id keeps its `anthropic.` prefix, that the model is enabled for your AWS account in the chosen region, and that the IAM identity may invoke it. For authentication failures, confirm the AWS profile or credentials resolve outside 10xGraph first.

## Fix timeouts and slow responses

Every LLM client is built with a request timeout of 600 seconds. If a call exceeds it, the request fails; raise the limit when you use slow models or long outputs.

The timeout is resolved in this order, first match wins:

1. A value set with `set_default_llm_timeout(seconds)` from `tenxgraph.core.llm.client_factory`.
2. The `TENXGRAPH_LLM_TIMEOUT` environment variable, in seconds. Invalid or non-positive values are ignored with a warning. The old `AGENTFLOW_LLM_TIMEOUT` is still read as a deprecated fallback when `TENXGRAPH_LLM_TIMEOUT` is unset or empty. If `TENXGRAPH_LLM_TIMEOUT` is set but invalid or not positive, it is ignored with a warning and the built-in default applies; the old variable is not consulted.
3. The built-in default of 600 seconds.

```bash
# Allow up to 30 minutes per request
export TENXGRAPH_LLM_TIMEOUT=1800
```

For OpenAI and Anthropic you can also pass `timeout` to a single agent, which overrides the default for that client:

```python title="timeout.py"
from tenxgraph.core import Agent

# timeout is forwarded to the SDK client constructor (seconds)
agent = Agent(
    model="gpt-4o",
    system_prompt=[{"role": "system", "content": "You are helpful."}],
    timeout=1800,
)
```

The Google client always uses the global default, so use the environment variable or `set_default_llm_timeout` for Gemini. If calls are consistently slow, try a smaller model, shorten the prompt, or stream the response so users see output earlier.

## Related pages

- [Models and providers](/docs/integrations/models) explains provider selection and capabilities.
- [Anthropic](/docs/integrations/anthropic), [Google](/docs/integrations/google) and [OpenAI](/docs/integrations/openai) cover each provider in depth.
- [Troubleshooting installation](/docs/troubleshooting/installation) covers package install problems.
