---
title: Anthropic
seoTitle: "Anthropic provider: Claude models"
description: Configure the Anthropic provider to run Claude models via the Claude API, Google Cloud Vertex AI, or Amazon Bedrock.
section: Integrations
group: "Models"
order: 50
label: Anthropic
updated: "2026-10-08"
---

Run Claude models through the Anthropic Messages API, or reach Claude on Google Cloud Vertex AI or Amazon Bedrock. 10xGraph manages all three backends with a single provider configuration, translating your graph code to Anthropic's API while handling defaults, sampling parameters, caching, and error recovery automatically.

## Setup and authentication

Install the Anthropic extra:

```bash
pip install "10xgraph[anthropic]"
```

Get an API key from [console.anthropic.com](https://console.anthropic.com) and set it in your environment:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

Or save it in a `.env` file that 10xGraph will read:

```text
ANTHROPIC_API_KEY=sk-ant-...
```

An unset `ANTHROPIC_API_KEY` does not cause a failure when you construct an agent. The Anthropic SDK has multiple credential paths (profiles, workload identity federation, alternative token environment variables), so 10xGraph logs an informational message and lets the SDK attempt its own resolution. For Vertex AI and Bedrock, you use your cloud platform's credential chain instead (environment variables or service account files your platform expects).

## Basic usage

Create an Agent pointing to any Claude model:

```python
from tenxgraph import Agent, END, Message, StateGraph

agent = Agent(
    model="claude-opus-5",
    system_prompt=[{"role": "system", "content": "You are a helpful assistant."}],
)

graph = StateGraph()
graph.add_node("MAIN", agent)
graph.add_edge("MAIN", END)
graph.set_entry_point("MAIN")
app = graph.compile()

result = app.invoke({"messages": [Message.text_message("Say hello.")]})
print(result["messages"][-1].text())
```

The `provider` parameter is optional because model names starting with `claude-` or `anthropic.` are recognized automatically. You can also be explicit with a prefix: `"anthropic/claude-opus-5"` or `"claude/claude-opus-5"` both work. `Agent` is a graph node, so you run it through a compiled graph (`invoke`, `ainvoke`, `astream`). 10xGraph translates your messages to Anthropic's Messages API and the response back to the standard `Message` format.

## Choosing a Claude backend

Anthropic runs Claude models in three places, each with different infrastructure and pricing. Use the `anthropic_backend` parameter to select one; the default is the direct Claude API.

| Backend | Setting | SDK client | Extra | Best for |
|---|---|---|---|---|
| **Claude API** | `None` (default) | `AsyncAnthropic` | `anthropic` | Development, most production use cases |
| **Google Vertex AI** | `"vertex"` | `AsyncAnthropicVertex` | `anthropic-vertex` | Teams already on Google Cloud |
| **Amazon Bedrock** | `"bedrock"` | `AsyncAnthropicBedrockMantle` | `anthropic-bedrock` | Teams already on AWS |

Install the extra for your chosen backend if it is not the default:

```bash
# For Vertex AI
pip install "10xgraph[anthropic-vertex]"

# For Bedrock
pip install "10xgraph[anthropic-bedrock]"
```

Use the backend by passing it through the Agent constructor (`use_vertex_ai=True` also selects the Vertex backend when `anthropic_backend` is not set):

```python
# Direct Claude API (default)
agent = Agent(model="claude-opus-5")

# Google Cloud Vertex AI
agent = Agent(model="claude-opus-5", anthropic_backend="vertex")

# Amazon Bedrock (model ids keep their anthropic. prefix)
agent = Agent(model="anthropic.claude-opus-5", anthropic_backend="bedrock")
```

The Claude API backend uses your `ANTHROPIC_API_KEY`. Vertex AI and Bedrock use your cloud platform's standard credential chain: for Vertex, your Google Cloud credentials and project ID; for Bedrock, your AWS credentials and region. You can pass credentials explicitly through `llm_kwargs` if needed, but environment variables and service account files are resolved automatically by the SDKs.

The Bedrock client uses the Messages-API endpoint (`AsyncAnthropicBedrockMantle`), not the legacy `InvokeModel` client, so you get the same feature set as the direct API.

## Output types

The `output_type` parameter controls what your agent produces:

```python
agent = Agent(
    model="claude-opus-5",
    output_type="json",  # or "text" (default)
)
```

Anthropic supports `"text"` for conversational output and `"json"` for structured responses. Any other value raises a `ValueError` when you construct the agent. Claude's Messages API has no image, audio, or video generation endpoints, so those output types belong to other providers (like Google Gemini).

For structured output, consider using `output_schema` instead of `output_type="json"`, which gives you typed results with validation:

```python
from pydantic import BaseModel

class ReportResult(BaseModel):
    title: str
    summary: str
    key_findings: list[str]

agent = Agent(
    model="claude-opus-5",
    output_schema=ReportResult,
)
```

## Extended thinking and reasoning

Claude supports extended thinking (internal reasoning before responding) through the `reasoning_config` parameter. It is on by default at effort `"low"` (the lowest); pass a dict such as `{"effort": "medium"}` for more, or pass `None` or `False` to turn it off:

```python
agent = Agent(
    model="claude-opus-5",
    reasoning_config={"effort": "high"},
)
```

Internally, 10xGraph translates `reasoning_config={"effort": "high"}` to Anthropic's `thinking={"type": "adaptive"}` plus `output_config={"effort": "high"}`. This enables longer, more deliberate reasoning for complex problems.

The parameters `budget_tokens` and `thinking_budget` are not used. Newer Claude models reject these with a 400 error when combined with the model's adaptive reasoning control. 10xGraph detects these and logs a warning without sending them. Use the `effort` setting (`"low"`, `"medium"`, or `"high"`) to control reasoning depth.

### Thinking blocks are kept and replayed

Anthropic signs each `thinking` block and returns `redacted_thinking` blocks for content it hides. A later turn that includes tool use must send these blocks back unchanged, or the API rejects the request. 10xGraph keeps them on the message as `ReasoningBlock` entries: `signature` holds the signature of a `thinking` block, and `redacted_data` holds the payload of a `redacted_thinking` block (its `summary` is empty). They are stored first in the message, in the order the model produced them, and sent back before the text and `tool_use` blocks on the next Anthropic call. Do not edit them.

Other providers never receive these blocks. A message saved before 1.0 has no signature, so its thinking is not replayed to Anthropic. See [`ReasoningBlock`](/docs/reference/python/messages#reasoningblock).

## Token limits and defaults

The Anthropic Messages API requires `max_tokens` on every request. 10xGraph provides sensible defaults that depend on the execution mode:

| Execution mode | Default `max_tokens` | Reason |
|---|---|---|
| Synchronous (invoke) | 16000 | Balances responsiveness and completeness |
| Streaming (astream) | 64000 | Streaming transfers tokens gradually; high limits are safe |

The streaming default is higher because a large `max_tokens` on a non-streaming request can exhaust your client's HTTP timeout waiting for the response. Override either default by passing `max_tokens` explicitly:

```python
agent = Agent(
    model="claude-opus-5",
    max_tokens=8000,
)
```

## Sampling parameters on newer models

Several recent Claude models (`claude-fable-5`, `claude-mythos-5`, `claude-opus-5`, `claude-opus-4-8`, `claude-opus-4-7`, and `claude-sonnet-5`) reject the traditional sampling parameters `temperature`, `top_p`, and `top_k` with a 400 error. 10xGraph automatically detects these models and strips those parameters before sending the request, logging a warning so you know it happened.

Older Claude models still accept these parameters, so they are stripped per-model rather than globally. The Bedrock model ID prefix (`anthropic.`) is stripped before checking the model name.

If your code passes sampling parameters and you see them silently dropped, switch to using `reasoning_config` with the `effort` parameter to control the model's reasoning depth, or use `temperature` on older models that accept it.

## Prompt caching

Prompt caching reduces costs and latency when your agent uses the same system prompt and tools repeatedly. Enable it with `anthropic_cache`:

```python
agent = Agent(
    model="claude-opus-5",
    anthropic_cache=True,  # Simple: ephemeral cache with default TTL
)

# Or with explicit settings
agent = Agent(
    model="claude-opus-5",
    anthropic_cache={"type": "ephemeral", "ttl": "1h"},  # 1 hour retention
)
```

Caching works at the prefix level. 10xGraph renders requests in a stable order: `tools` → `system` → `messages`. The cache breakpoint is placed at the end of the stable prefix (the last tool definition when tools are present, otherwise the last system block), leaving per-request messages after it. This means your tools and system prompt are cached across requests, but each message is fresh.

Because caching is a prefix match, any byte change after the breakpoint invalidates cached tokens. The minimum cacheable prefix is roughly 1024 tokens; shorter prefixes cache silently with no effect.

Cache hits are logged at `DEBUG` level by the `tenxgraph.agent` logger as `Cache hit: N cached tokens (Anthropic messages)`, read from `usage.cache_read_input_tokens`.

If you pass your own top-level `cache_control` keyword argument to the `Agent`, 10xGraph does not add its own breakpoints, so you can customize the caching strategy.

## Batch processing for high-volume work

For offline, asynchronous processing of many requests at reduced cost, use the `AnthropicBatch` utility:

```python
from tenxgraph.core.llm import AnthropicBatch

# Run inside an async function
batch = AnthropicBatch(model="claude-haiku-4-5")
batch.add("request-1", [{"role": "user", "content": "Summarize..."}])
batch.add("request-2", [{"role": "user", "content": "Analyze..."}])
batch.add("request-3", [{"role": "user", "content": "Extract..."}])

batch_id = await batch.submit()
results = await batch.wait(batch_id)  # keyed by custom_id
print(results["request-1"].text)
```

Results are keyed by the `custom_id` you provide because they may arrive in any order; indexing by position is a common source of silent data mismatch bugs. The batch API is well suited to processing large datasets or generating training data because it runs asynchronously and costs less. For interactive, stateful agent runs, use the compiled graph's `invoke()` or `astream()` instead.

You can also use `status(batch_id)` to poll the status once without blocking, and `results(batch_id)` to retrieve results from a batch you already know has completed. Messages you pass to `batch.add()` use 10xGraph's internal message format and go through the same translation as live calls, so system prompts and tool results are shaped correctly.

## Environment variables

| Variable | Required | When used | Notes |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | No (see below) | Direct Claude API | API key from console.anthropic.com. The SDK also checks `ANTHROPIC_AUTH_TOKEN`, profiles, and workload identity. |

For the direct Claude API, you need at least one credential source to resolve. 10xGraph reads `ANTHROPIC_API_KEY` itself; all other resolution (tokens, profiles, federation) is handled by the SDK. For Vertex and Bedrock, 10xGraph reads no variables itself: the Anthropic SDK resolves the region, project and credentials. You can pass them explicitly as keyword arguments (for example `region` and `project_id` for Vertex, `aws_region` and `aws_profile` for Bedrock). See the Anthropic SDK documentation for the environment variables it reads.

## Common errors and solutions

| Error | Cause | Fix |
|---|---|---|
| `ImportError: anthropic SDK is required` | `anthropic` extra not installed | `pip install "10xgraph[anthropic]"` |
| `ImportError: ... Vertex support` | `anthropic-vertex` extra missing | `pip install "10xgraph[anthropic-vertex]"` |
| `ImportError: ... Bedrock support` | `anthropic-bedrock` extra missing | `pip install "10xgraph[anthropic-bedrock]"` |
| `ValueError: Unsupported anthropic_backend` | Typo or unsupported backend name | Use `None` (direct API), `"vertex"`, or `"bedrock"` |
| `ValueError: Anthropic provider doesn't support output_type=...` | Invalid output type | Use `"text"` or `"json"` only |
| `401 Unauthorized` | Invalid or missing API key | Set `ANTHROPIC_API_KEY` or provide credentials for your backend |
| `Error: model not found` | Model name typo or not available in your region | Check the model name and ensure it is available in your backend region |

## Next steps

- [Configure an Agent](/docs/guides/configure-agent): Learn how to set up agents with different model parameters, tools, and reasoning modes.
- [Provider selection guide](/docs/integrations/models): See a capability matrix and compare Anthropic with other providers.
- [Installation and API keys](/docs/get-started/installation): Get all providers and extras set up.
- [Batch processing guide](/docs/guides/batch-llm-calls): Process large datasets with batch APIs for reduced cost.
