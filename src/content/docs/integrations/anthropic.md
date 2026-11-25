---
title: Anthropic
seoTitle: "Anthropic provider: Claude models"
description: Configure the Anthropic provider to run Claude models via the Claude API, Google Cloud Vertex AI, or Amazon Bedrock.
section: Integrations
group: "Models"
order: 50
label: Anthropic
updated: "2026-11-20"
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

### Context managers and thinking signatures

Claude binds each signed thinking block to everything before it: the system prompt, the tools and the earlier messages. 10xGraph replays stored thinking blocks unchanged, so when a context manager removes or replaces earlier messages (`MessageContextManager` trimming old turns, `SummaryContextManager` replacing them with a summary, or `remove_tool_msgs=True` removing tool rounds), the kept blocks no longer verify. Changing the system prompt, for example a date line that changes each day, has the same effect. Anthropic then rejects the next request:

```
Error code: 400 - invalid_request_error: messages.1.content.2: Invalid `signature` in `thinking` block. The block is bound to a different conversation. Remove the block, or set `thinking.block_binding.prefix_mismatch_behavior` to "drop_block". Content that preceded this block when it was created is missing from this request, starting at `messages.0`.
```

The check is enforced by default for Anthropic accounts created on or after 2026-08-31 (Claude Fable 5.1, Opus 5.5, Sonnet 5.5). Older accounts are not enforced unless the request sets the field below.

No 10xGraph code change is needed. `Agent` (and `ReactAgent`, which forwards them) sends unknown keyword arguments straight to `client.messages.create`, and `reasoning_config` keeps a `thinking` value you pass (effort still comes from `reasoning_config`):

```python
agent = Agent(
    model="claude-sonnet-5-5",
    reasoning_config={"effort": "high"},
    trim_context=True,
    # Trimming or summarizing old turns invalidates Claude's stored thinking signatures.
    # drop_block tells the API to skip those blocks instead of returning a 400.
    thinking={"type": "adaptive", "block_binding": {"prefix_mismatch_behavior": "drop_block"}},
    extra_headers={"anthropic-beta": "thinking-binding-controls-2026-08-01"},
)
```

Multi-agent graphs need nothing extra. Each `Agent` node replays only the thinking blocks of its own replies (matched by `metadata["node_name"]`). Replies from other agent nodes keep their text and tool calls, so a second Claude agent with a different system prompt or tools reads the shared history without this error.

Pass the context manager to `StateGraph(context_manager=...)` as usual. Caveats:

- The header and the field go together. The field without the header is its own 400 (`block_binding: Extra inputs are not permitted`).
- Claude only. These arguments are sent to whatever provider the `Agent` uses, so do not set them for OpenAI or Google models, or when `fallback_models` includes a non-Claude model.
- Thinking must be on. Sonnet 5.5's `"between_tools"` thinking type rejects `block_binding`.
- The beta is offered on the Claude API, Claude Platform on AWS, Vertex AI and Bedrock, but only the direct Claude API was verified with 10xGraph. On Bedrock the beta is sent as an `anthropic_beta` body field rather than a header (not verified with 10xGraph).
- Effect: the model loses its earlier reasoning for the turns that were kept. Their text and tool calls stay, and new turns think normally.
- Avoid trimming in the middle of a tool round. `SummaryContextManager` with `trim_context=True` can, because its trigger counts messages or tokens, and the call in progress then loses its reasoning.

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

## Provider-specific settings

Pass any Messages API setting to `Agent(...)` (or `ReactAgent(...)`) as a keyword argument, named exactly as the Anthropic SDK names it, for example `service_tier`, `inference_geo`, `metadata` or `cache_control`:

```python
agent = Agent(
    model="claude-opus-5",
    service_tier="auto",
    metadata={"user_id": "u-123"},
)
```

10xGraph sends a setting only if the installed `anthropic` SDK defines it on the method being called. A name the SDK does not define is not sent, and a warning names the key and the provider. A new SDK parameter works after you upgrade the SDK, with no 10xGraph release. The check is by name only: if the SDK accepts the name but the API or model refuses the value, Anthropic returns its error as usual. See [`Agent` keyword arguments](/docs/reference/python/agent#provider-specific-settings).

## Client certificate or proxy

`http_client=` on `Agent(...)` passes your own async client to the Anthropic SDK. With the `anthropic` SDK 1.0 and later it must be an `httpx2.AsyncClient`. See [Use mutual TLS](/docs/security/use-mutual-tls#api-to-the-llm).

## Prompt caching

Prompt caching is on by default. Each request carries a cache breakpoint on the last system block (or on the last tool when there is no system prompt), plus top-level automatic caching. The automatic marker caches the whole conversation so far and moves forward on every call, so a long thread keeps reusing its prefix.

Turn it off, or change the lifetime, with `anthropic_cache`:

```python
agent = Agent(model="claude-opus-5", anthropic_cache=False)  # no caching

agent = Agent(
    model="claude-opus-5",
    anthropic_cache={"type": "ephemeral", "ttl": "1h"},  # 1 hour TTL for both markers
)
```

Caching is a prefix match, so any change before the breakpoint invalidates the cache. The minimum cacheable length depends on the model; a shorter prefix is not cached and is not an error. A cache write costs more than normal input (1.25x for the 5 minute TTL) and a read costs much less, so a second call that reuses the prefix already pays off.

Check that it works through `usage.cache_read_input_tokens`. 10xGraph records it on `Message.usages.cache_read_input_tokens` and logs hits at `DEBUG` level on the `tenxgraph.agent` logger as `Cache hit: N cached tokens (Anthropic messages)`.

If you set `cache_control` yourself anywhere (a top-level keyword argument, on a system block, or on a tool), 10xGraph adds nothing and keeps yours. This gives you full control and avoids errors from mixing your breakpoints with automatic ones.

## Batch processing for high-volume work

For offline, asynchronous batch jobs, call the Anthropic SDK's batch API directly (`client.messages.batches`). 10xGraph does not wrap it.

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
| 400 "Invalid `signature` in `thinking` block. The block is bound to a different conversation" | A context manager removed or replaced earlier messages (or the system prompt changed), so stored thinking signatures no longer verify | Set `block_binding` and the beta header on the `Agent`. See [Context managers and thinking signatures](/docs/integrations/anthropic#context-managers-and-thinking-signatures) |
| `Error: model not found` | Model name typo or not available in your region | Check the model name and ensure it is available in your backend region |

## Next steps

- [Configure an Agent](/docs/guides/configure-agent): Learn how to set up agents with different model parameters, tools, and reasoning modes.
- [Provider selection guide](/docs/integrations/models): See a capability matrix and compare Anthropic with other providers.
- [Installation and API keys](/docs/get-started/installation): Get all providers and extras set up.
