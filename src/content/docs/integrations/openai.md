---
title: OpenAI
seoTitle: "OpenAI provider: GPT models"
description: "Configure the OpenAI provider in 10xGraph to run GPT and reasoning models, including the install extra, API key, and model settings."
section: Integrations
group: "Models"
order: 30
label: OpenAI
updated: "2026-10-08"
faq:
  - question: "Which OpenAI models work with 10xGraph?"
    answer: "Any model your OpenAI account can call, for example gpt-4o, gpt-4o-mini and o4-mini. Names starting with gpt-, o1-, o3- or o4- are detected as OpenAI automatically. See platform.openai.com for the current list."
  - question: "How do I enable caching for OpenAI?"
    answer: "Prompt caching is automatic on OpenAI. Cache hits are logged at DEBUG level. Pass prompt_cache_key for stable cross-request hits."
  - question: "Do I need to change code to use the Responses API?"
    answer: "No. The Responses API is the default for the Agent. With a base_url the default is Chat Completions. Pass api_style='chat' to use Chat Completions, or api_style='responses' to force the Responses API."
---

Run GPT-class models (`gpt-4o`, `gpt-4o-mini`) and reasoning models (`o3-mini`, `o4-mini`) through the OpenAI API. 10xGraph handles response conversion, tool calling, and prompt caching automatically.

## Prerequisites

Install the OpenAI provider extra:

```bash
pip install "10xgraph[openai]"
```

Get an API key from [platform.openai.com](https://platform.openai.com) and set it as an environment variable:

```bash
export OPENAI_API_KEY="sk-..."
```

Or load it from a `.env` file:

```bash
OPENAI_API_KEY=sk-...
```

Pass `api_key=` to the `Agent` instead if you prefer. Without a key, 10xGraph logs a warning and the call fails unless your `base_url` needs no authentication. 10xGraph detects the provider from the model name or an explicit `provider="openai"` parameter.

## Basic usage

`Agent` is a graph node, so put it in a `StateGraph`:

```python
from tenxgraph import Agent, END, Message, StateGraph

agent = Agent(
    model="gpt-4o",
    provider="openai",
    system_prompt=[{"role": "system", "content": "You are a helpful assistant."}],
)

graph = StateGraph()
graph.add_node("MAIN", agent)
graph.add_edge("MAIN", END)
graph.set_entry_point("MAIN")
app = graph.compile()

result = app.invoke({"messages": [Message.text_message("What is 2 + 2?")]})
for message in result["messages"]:
    print(f"{message.role}: {message.text()}")
```

The `provider="openai"` parameter is optional if your model name starts with `gpt-`, `o1-`, `o3-` or `o4-`. Both Chat Completions (the default) and the Responses API are supported; see [API Style](#api-style) below.

## Full example with tools

Here is a complete example using ReactAgent with a weather tool:

```python
from dotenv import load_dotenv

from tenxgraph.core.state import Message
from tenxgraph.prebuilt.agent import ReactAgent

load_dotenv()

def get_weather(location: str) -> str:
    """Get the current weather for a location."""
    return f"The weather in {location} is sunny."

# Create a ReactAgent with OpenAI
react_agent = ReactAgent(
    model="gpt-4o",
    provider="openai",
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

    # Invoke the agent
    result = app.invoke(
        {"messages": [Message.text_message("What is the weather in New York City?")]},
        config={"thread_id": "openai-demo", "recursion_limit": 10},
    )

    # Print the messages in the result
    for message in result["messages"]:
        print(f"{message.role}: {message.content}")
```

Run the example:

```bash
python your_script.py
```

You should see the agent call the tool and summarize the weather.

## Verify it worked

After running, you will see:
1. A user message with your question.
2. An assistant message with a tool call to `get_weather`.
3. A tool result message with the weather data.
4. A final assistant message with the answer.

This confirms the agent is routing tool calls correctly.

---

## API Style

OpenAI exposes two distinct APIs for text generation. 10xGraph supports both.

| `api_style` | Underlying call | When to use |
|---|---|---|
| `"responses"` (default) | `client.responses.create` | The current OpenAI API and the default for the Agent class (unless `base_url` is set), `SummaryContextManager` and the evaluation judge. Required for function tools on some newer models when reasoning is on. |
| `"chat"` | `client.chat.completions.create` | Older models and OpenAI-compatible servers that only speak Chat Completions. Default for an Agent with `base_url`. |

### Agent

```python
from tenxgraph import Agent

# Default, Responses API
agent = Agent(model="gpt-4o")

# Opt out to Chat Completions
agent = Agent(model="gpt-4o", api_style="chat")
```

### SummaryContextManager

```python
from tenxgraph.core.state import SummaryContextManager

# Default is "responses" for the context manager
manager = SummaryContextManager(model="gpt-4o-mini", token_budget=8000)

# Older or third-party-hosted models that only support Chat Completions
manager = SummaryContextManager(
    model="gpt-4o-mini",
    api_style="chat",
    token_budget=8000,
)
```

### Evaluation judge

The evaluation judge reads `api_style` from `CriterionConfig.api_style` (defaults to
`"responses"`). Set it per-criterion when using a model that only supports Chat Completions:

```python
from tenxgraph.qa.evaluation import CriterionConfig, EvalConfig, CriteriaConfig

config = EvalConfig(
    criteria=CriteriaConfig(
        llm_judge=CriterionConfig(
            judge_model="gpt-4o",
            api_style="chat",   # override if needed
        )
    )
)
```

---

## Prompt Caching

OpenAI caches the prompt prefix automatically, no code changes required. Cache hits are
reported back in `usage.input_tokens_details.cached_tokens` and logged at `DEBUG` level
by 10xGraph. You only need to act if you want to improve hit rates.

**How it works:** OpenAI hashes the first N tokens of your request (system prompt +
conversation history + tool definitions). Requests sharing an identical prefix are routed
to a server that already has the KV cache in GPU memory. You always send the full prompt;
OpenAI serves the cached computation.

**Minimum size:** 1,024 tokens. Requests below this threshold report zero cached tokens.

**TTL:** set by OpenAI (short, in-memory). Some models support extended retention through
`prompt_cache_retention="24h"`; check OpenAI's documentation for which.

### `prompt_cache_key`

When multiple Agent instances (or multiple processes) share the same long system prompt,
pass a stable key to colocate them on the same cached server and raise the hit rate.

```python
agent = Agent(
    model="gpt-4o",
    system_prompt=[{"role": "system", "content": very_long_prompt}],
    prompt_cache_key="legal-analyst-v2",  # passed through llm_kwargs
)
```

This is an OpenAI request-level parameter forwarded directly through `llm_kwargs`. It is
**not** in `CALL_EXCLUDED_KWARGS` so it reaches the API unchanged.

### `prompt_cache_retention`

Requests extended cache retention. OpenAI only honours it on models that support it.

```python
agent = Agent(
    model="gpt-4o",
    system_prompt=[...],
    prompt_cache_key="assistant-v1",
    prompt_cache_retention="24h",
)
```

### SummaryContextManager with caching

`SummaryContextManager` does not accept extra LLM keyword arguments, so it cannot
send `prompt_cache_key`. The implicit cache still applies when its prompt prefix is stable.

### Evaluation judge with caching

Extra kwargs are not forwarded from `CriterionConfig` to the judge call. The implicit
cache still fires automatically when the judge prompt prefix is stable (same rubric, same model).

---

## Reasoning Models

Reasoning models such as `o4-mini` are controlled via `reasoning_config`. The default is
effort `"minimal"` (the lowest); pass a dict for more.

```python
# Enable with defaults (effort="minimal")
agent = Agent(model="o4-mini", reasoning_config=True)

# Set effort level
agent = Agent(
    model="o4-mini",
    reasoning_config={"effort": "high"},  # "low" | "medium" | "high"
)

# Disable
agent = Agent(model="o4-mini", reasoning_config=False)
```

On Chat Completions, `effort` is sent as `reasoning_effort`; on the Responses API the whole
dict is sent as `reasoning` (so `summary` is also allowed). When reasoning is on and you set no
`summary`, the Responses request asks for `summary: "auto"`. If the reasoning came from the default
and the model answers with a 400 that names the reasoning parameter (for example `gpt-4o`), the
call is retried once without it and the model is remembered for the process. An explicit
`reasoning_config` dict is never dropped and still raises, so pass `reasoning_config=None` for a
model that does not accept reasoning parameters.

---

## Structured Output

Force the model to return a Pydantic model by passing `output_schema`. The Agent routes
this through `responses.parse` with `api_style="responses"` and `chat.completions.parse` with
`api_style="chat"`. Either way the validated model is on `Message.parsed_content`. Streaming
is turned off for these calls.

```python
from pydantic import BaseModel

class MyOutput(BaseModel):
    answer: str
    confidence: float

agent = Agent(
    model="gpt-4o",
    output_schema=MyOutput,
    system_prompt=[...],
)
```

Caching still applies to both parse paths, cache hits are logged the same way.

---

## OpenAI-Compatible Endpoints

Any OpenAI-compatible server (ollama, vllm, LM Studio, etc.) can be used by setting
`base_url`:

```python
agent = Agent(
    model="llama3.2",
    base_url="http://localhost:11434/v1",
    api_style="chat",  # the default when base_url is set; shown for clarity
)
```

When `base_url` is set and you do not pass `api_style`, the Agent uses Chat Completions,
because most local servers only support it. If you pass `api_style="responses"` with a
`base_url`, the Agent tries the Responses API on the first call. If the server answers 404,
405 or 501 (no Responses API), the Agent logs one warning and uses Chat Completions for the rest
of its lifetime. Other errors, such as a 429 or a timeout, are raised and do not switch it.

Prompt caching params (`prompt_cache_key`, `prompt_cache_retention`) have no effect on
local servers unless the server explicitly implements them.

---

## `llm_kwargs` Reference

All unrecognised keyword arguments passed to `Agent(...)` land in `self.llm_kwargs` and
are forwarded to the underlying API call.

| kwarg | Type | Applies to | Notes |
|---|---|---|---|
| `prompt_cache_key` | `str` | Chat + Responses | Improves cross-request cache hit rate |
| `prompt_cache_retention` | `"in_memory"` / `"24h"` | Chat + Responses | 24h only on supporting models |
| `temperature` | `float` | Chat + Responses | Sampling temperature (0.0-2.0) |
| `max_tokens` | `int` | Chat | Max output tokens |
| `max_output_tokens` | `int` | Responses | Max output tokens (Responses API name) |
| `reasoning_effort` | `str` | Chat | Normally derived from `reasoning_config`; dropped on the Responses API |
| `top_p` | `float` | Chat + Responses | Nucleus sampling |
| `frequency_penalty` | `float` | Chat | Penalise repeated tokens |
| `presence_penalty` | `float` | Chat | Penalise already-seen tokens |

Keys in `CALL_EXCLUDED_KWARGS` (`organization`, `project`, `timeout`, `max_retries`,
`default_headers`, `default_query`, `http_client`, `api_key`, `base_url`) are stripped
before the request is sent and must be passed to the client constructor instead.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | yes | API key from platform.openai.com |

## Common Errors

| Error | Fix |
|---|---|
| `AuthenticationError` | `OPENAI_API_KEY` missing or invalid |
| `RateLimitError` | You hit a rate limit. Retries are on by default; tune them with `retry_config=RetryConfig(max_retries=5)` (`from tenxgraph.core import RetryConfig`) |
| `Model not found` | Check the model name; some models require tier-gated access |

## Next steps

- See [Models](/docs/integrations/models) for a full capability matrix comparing OpenAI with Google and Anthropic.
- Read [Configure an Agent](/docs/guides/configure-agent) to learn about fallbacks, retries, and other provider-agnostic settings.
- Explore [Structured output](/docs/guides/structured-output) for typed responses with `output_schema`.
