---
title: Batch LLM calls
description: Use OpenAI and Anthropic batch APIs for cost-effective processing of large request volumes.
label: Batch LLM calls
updated: "2026-10-27"
order: 350
group: Streaming, media and realtime
section: Build agents
faq:
  - q: When should I use batches instead of normal calls?
    a: "Provider batch APIs are priced below normal calls (check each provider's pricing page) and are ideal for offline workloads: processing datasets, content generation, data extraction. They are not suited for interactive use cases where low latency is required, since batch processing typically takes hours."
  - q: Can I use batches with tools?
    a: "Yes. Both OpenAIBatch and AnthropicBatch accept a `tools` parameter in the `add()` method, and both support the full tool calling protocol."
  - q: What happens if one request in a batch fails?
    a: "Individual request failures do not stop the batch. Each result has a `status` field (succeeded, errored, canceled, or expired) and an optional `error` field. You process results based on their individual status."
---

Batch processing through OpenAI and Anthropic reduces LLM call costs when you have offline workloads: summarizing datasets, extracting information from documents, generating content at scale, or scoring many items. This guide shows you how to queue requests, submit them, and retrieve results using the unified batch interface.

## Why use batches

Batch APIs are fundamentally different from streaming or interactive calls. You submit requests and collect results hours later, trading latency for cost. Batches fit these scenarios:

- **Dataset processing:** Summarizing 10,000 articles, extracting entities from a corpus, or classifying documents.
- **Bulk generation:** Creating variations of content, generating test data, or producing reports.
- **Offline evaluation:** Scoring agent outputs, comparing alternatives, or auditing past conversations.

Batch processing is not suitable for interactive applications where users wait for a response. It is also not suitable for use inside a graph run: a graph is stateful and interactive, while a batch is neither. For graph integration, see the related pages section below.

## The batch interface

Both OpenAI and Anthropic offer batch APIs with different mechanics underneath: OpenAI requires uploading a JSONL file and downloading results from another file, while Anthropic takes requests inline. 10xGraph abstracts these differences away with a unified surface so you can switch providers without relearning the interface.

```python
from tenxgraph.core.llm import OpenAIBatch, AnthropicBatch

# Both have the same methods and chain from add()
batch = OpenAIBatch(model="gpt-4o-mini")
# or
batch = AnthropicBatch(model="claude-haiku-4-5")

batch.add("row-1", messages=[{"role": "user", "content": "Summarise: ..."}])
batch.add("row-2", messages=[{"role": "user", "content": "Summarise: ..."}])

# Run inside an async function (for example via asyncio.run)
batch_id = await batch.submit()
results = await batch.wait(batch_id)  # dict keyed by custom_id, not position
print(results["row-1"].text)
```

Results are keyed by `custom_id` (not position), because batch results arrive in any order. Each result is a `BatchResult` with fields: `custom_id`, `status` (succeeded/errored/canceled/expired), `text`, `stop_reason`, `input_tokens`, `output_tokens`, `error`, and an `ok` property that is true only for succeeded status.

## Prerequisites

Install 10xGraph with the provider extra:

```bash
pip install "10xgraph[openai]"     # For OpenAI batches
pip install "10xgraph[anthropic]"  # For Anthropic batches
```

Set your API keys in the environment:

```bash
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
```

## Complete example: OpenAI batch

This example summarizes a list of articles using OpenAI batches. Save it as `batch_openai.py`:

```python
import asyncio
from tenxgraph.core.llm import OpenAIBatch

async def main():
    articles = [
        {
            "id": "article-1",
            "title": "The State of AI",
            "text": "Recent advances in large language models have..."
        },
        {
            "id": "article-2",
            "title": "Climate Change",
            "text": "Global temperatures continue to rise due to..."
        },
        {
            "id": "article-3",
            "title": "Quantum Computing",
            "text": "Quantum computers leverage superposition and..."
        },
    ]

    # Create a batch and add requests
    batch = OpenAIBatch(model="gpt-4o-mini")
    for article in articles:
        messages = [
            {
                "role": "user",
                "content": f"Summarise this article in one sentence:\n\n{article['text']}"
            }
        ]
        batch.add(article["id"], messages)

    # Submit the batch
    print(f"Submitting {len(articles)} requests...")
    batch_id = await batch.submit()
    print(f"Batch submitted with id: {batch_id}")

    # Poll until complete (may take minutes or hours)
    print("Waiting for batch to complete...")
    results = await batch.wait(batch_id, poll_interval=10)

    # Process results
    print("\nResults:")
    for article in articles:
        result = results[article["id"]]
        status = "ok" if result.ok else "failed"
        print(f"[{status}] {article['title']}")
        if result.ok:
            print(f"   Summary: {result.text}")
            print(f"   Tokens: {result.input_tokens} in, {result.output_tokens} out")
        else:
            print(f"   Error: {result.error}")

if __name__ == "__main__":
    asyncio.run(main())
```

Run it:

```bash
python batch_openai.py
```

Example output (your text and token counts will differ):

```
Submitting 3 requests...
Batch submitted with id: batch_abcd1234efgh5678
Waiting for batch to complete...

Results:
[ok] The State of AI
   Summary: Large language models have made significant recent advances.
   Tokens: 23 in, 15 out
[ok] Climate Change
   Summary: Global temperatures are increasing due to greenhouse gas emissions.
   Tokens: 19 in, 13 out
[ok] Quantum Computing
   Summary: Quantum computers use superposition to solve certain problems faster.
   Tokens: 20 in, 14 out
```

## Complete example: Anthropic batch

The same workflow with Anthropic:

```python
import asyncio
from tenxgraph.core.llm import AnthropicBatch

async def main():
    articles = [
        {
            "id": "article-1",
            "title": "The State of AI",
            "text": "Recent advances in large language models have..."
        },
        {
            "id": "article-2",
            "title": "Climate Change",
            "text": "Global temperatures continue to rise due to..."
        },
    ]

    # Create a batch and add requests
    batch = AnthropicBatch(model="claude-haiku-4-5")
    for article in articles:
        messages = [
            {
                "role": "user",
                "content": f"Summarise this article in one sentence:\n\n{article['text']}"
            }
        ]
        batch.add(article["id"], messages)

    # Submit and wait
    print(f"Submitting {len(articles)} requests...")
    batch_id = await batch.submit()
    print(f"Batch submitted with id: {batch_id}")

    print("Waiting for batch to complete...")
    results = await batch.wait(batch_id, poll_interval=10)

    # Process results
    print("\nResults:")
    for article in articles:
        result = results[article["id"]]
        status = "ok" if result.ok else "failed"
        print(f"[{status}] {article['title']}: {result.text}")

if __name__ == "__main__":
    asyncio.run(main())
```

## How to verify it worked

After `wait()` returns, you have a dictionary of results keyed by `custom_id`. Verify:

1. **All requests are present:** `len(results) == len(articles)`
2. **Success rate:** Count how many have `status == "succeeded"` or use the `ok` property.
3. **Token usage:** Sum `input_tokens` and `output_tokens` across results.
4. **Error details:** For any failed result, inspect the `error` field.

```python
# Verification snippet
total_in, total_out = 0, 0
succeeded, failed = 0, 0

for result in results.values():
    if result.ok:
        succeeded += 1
        total_in += result.input_tokens
        total_out += result.output_tokens
    else:
        failed += 1
        print(f"Failed {result.custom_id}: {result.error}")

print(f"Success: {succeeded}, Failed: {failed}")
print(f"Total tokens: {total_in} in, {total_out} out")
```

## Polling strategies

The `wait()` method polls the batch status at regular intervals. Customize the polling behavior:

```python
# Poll every 60 seconds (batches are not latency-sensitive; save rate limit)
results = await batch.wait(batch_id, poll_interval=60.0)

# Give up after 12 hours
results = await batch.wait(batch_id, timeout=12 * 3600)

# Check status manually without waiting
status = await batch.status(batch_id)
print(f"Batch status: {status}")

# Retrieve results after checking manually.
# OpenAI terminal statuses: completed, failed, expired, cancelled.
# Anthropic terminal status: ended.
if status in ("completed", "failed", "expired", "cancelled", "ended"):
    results = await batch.results(batch_id)
```

## Adding tools to batch requests

Both batch helpers support tools in the same way as live calls. Pass the `tools` parameter to `add()`:

```python
from tenxgraph.core.llm import OpenAIBatch

# Define tools (OpenAI function-calling format; AnthropicBatch converts them)
tools = [
    {
        "type": "function",
        "function": {
            "name": "extract_info",
            "description": "Extract structured information from text.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "date": {"type": "string"}
                }
            }
        }
    }
]

# Add a request that expects tool use
batch = OpenAIBatch(model="gpt-4o-mini")
batch.add(
    "row-1",
    messages=[{"role": "user", "content": "Extract the event date from: John's party on Dec 25."}],
    tools=tools
)
```

The batch only sends the tool definitions. Tools are not executed for you: a `BatchResult` carries `text` only, so a response that is purely a tool call has empty `text` (the full provider entry is in `result.raw`).

## Using Anthropic backend variants

For Anthropic, specify which backend to use:

```python
# Direct Claude API (default)
batch = AnthropicBatch(model="claude-opus-5")

# Vertex AI
batch = AnthropicBatch(
    model="claude-opus-5",
    anthropic_backend="vertex"
)

# Bedrock
batch = AnthropicBatch(
    model="anthropic.claude-opus-5",  # Bedrock model IDs keep the anthropic. prefix
    anthropic_backend="bedrock"
)
```

Ensure you have installed the correct extras: `[anthropic]`, `[anthropic-vertex]`, or `[anthropic-bedrock]`. Whether the Message Batches endpoint is available on Vertex AI or Bedrock depends on the provider.

## Error handling

Batch submission and result collection can fail. Handle errors gracefully:

```python
import asyncio

try:
    batch_id = await batch.submit()
except ValueError as e:
    print(f"Batch validation failed: {e}")
    # submit() raises ValueError for an empty batch; add() raises it for a duplicate custom_id
except Exception as e:
    print(f"Submission failed: {e}")
    # Network error, auth error, etc.

try:
    results = await batch.wait(batch_id, timeout=3600)
except TimeoutError:
    print(f"Batch {batch_id} did not complete within 1 hour")
    # Check status manually later
    status = await batch.status(batch_id)
    print(f"Current status: {status}")
```

Individual request failures within a batch do not raise exceptions. Instead, check the `status` field of each result:

```python
for custom_id, result in results.items():
    if result.status == "succeeded":
        print(f"{custom_id}: {result.text}")
    elif result.status == "errored":
        print(f"{custom_id}: Error - {result.error}")
    elif result.status == "canceled":
        print(f"{custom_id}: Canceled (batch or request was canceled)")
    elif result.status == "expired":
        print(f"{custom_id}: Expired (batch window or TTL exceeded)")
```

## Common errors and fixes

**ValueError: Cannot submit an empty batch; call add() first.**

You called `submit()` without adding any requests. Add requests before submitting:

```python
batch.add("row-1", messages=[...])
await batch.submit()  # OK
```

**ValueError: Duplicate custom_id in batch: 'row-1'**

Raised by `add()`. You added the same `custom_id` twice. Each request must have a unique identifier:

```python
batch.add("row-1", ...)
batch.add("row-1", ...)  # ERROR: duplicate

# Fix: use unique IDs
batch.add("row-1", ...)
batch.add("row-2", ...)
```

**KeyError when accessing results**

You are indexing results by position instead of `custom_id`. Results arrive out of order:

```python
# Wrong
for i, article in enumerate(articles):
    print(results[i])  # ERROR: results is a dict keyed by custom_id

# Correct
for article in articles:
    print(results[article["id"]])  # Use the custom_id
```

**TimeoutError: Batch still 'processing' after...**

The batch did not complete within the timeout window. Batches typically take hours. Increase the timeout or poll again later:

```python
# Increase timeout to 24 hours
results = await batch.wait(batch_id, timeout=24 * 3600)

# Or retrieve by batch_id later
batch_new = OpenAIBatch(model="gpt-4o-mini")
results = await batch_new.results(batch_id)
```

**Empty results dict**

The batch completed with no output file (for OpenAI) or all requests were canceled. Check the batch status:

```python
status = await batch.status(batch_id)
print(f"Batch status: {status}")
```

## Processing large datasets

For datasets with thousands of items, split them into multiple batches:

```python
async def process_in_batches(items, batch_size=10000):
    all_results = {}
    batches = []
    
    # Create batches
    for i in range(0, len(items), batch_size):
        batch_chunk = items[i:i + batch_size]
        batch = OpenAIBatch(model="gpt-4o-mini")

        for item in batch_chunk:
            batch.add(item["id"], messages=[...])

        batch_id = await batch.submit()
        batches.append((batch_id, batch, batch_chunk))
        print(f"Submitted batch {batch_id} with {len(batch_chunk)} items")
    
    # Wait for all batches
    for batch_id, batch, batch_chunk in batches:
        results = await batch.wait(batch_id)
        all_results.update(results)
        print(f"Completed batch {batch_id}")
    
    return all_results
```

## Storing batch IDs for later retrieval

A batch may take hours or days to complete. Save the batch ID so you can retrieve results later:

```python
import json

# Submit and save the ID
batch_id = await batch.submit()
with open("batch_ids.json", "w") as f:
    json.dump({"batch_id": batch_id, "model": "gpt-4o-mini"}, f)

# Later, retrieve results
with open("batch_ids.json") as f:
    config = json.load(f)

batch = OpenAIBatch(model=config["model"])
results = await batch.results(config["batch_id"])
```

## Not suitable for graph runs

Batch processing and graph execution are fundamentally mismatched. A graph is interactive and stateful; a batch is fire-and-forget and offline. Do not use batches inside a graph run (e.g., in a node or tool):

```python
# Anti-pattern: do not do this
async def my_node(state):
    batch = OpenAIBatch(model="gpt-4o-mini")
    batch.add("row-1", ...)
    batch_id = await batch.submit()
    results = await batch.wait(batch_id)  # Graph waits hours; not interactive
    return {"messages": ...}
```

If you need to process data at scale as part of your agent system, consider:

- Using the normal LLM call interface with a loop over your dataset and the graph's [`astream()` method](/docs/guides/stream-graph) for real-time feedback.
- Running batch processing **before** your graph (preprocess data, populate a database, then query it from your graph).
- Using background tasks or a job queue to process data asynchronously outside the graph and store results for the graph to query.

See [Background tasks](/docs/guides/run-background-tasks) and [Streaming](/docs/guides/stream-graph) for these patterns.

## Run it in production

Batch jobs are long and not tied to one HTTP request, so give them their own timeout and watch them through your publishers or OTEL rather than the in-memory trace endpoint, which is disabled in production. See [Observability](/docs/server/observability) and [Scaling and reliability](/docs/production/scaling).

## Next steps

- **Reference:** See the full [batch API signatures](/docs/reference/python/llm) for detailed parameter documentation.
- **Evaluation:** Use batches for evaluating agent outputs at scale with [Evaluation](/docs/testing/evaluation).
- **Error handling:** Learn more about [Errors and limits](/docs/concepts/errors-and-limits).
- **Working with LLMs:** Explore [Configure an agent](/docs/guides/configure-agent) and [Provider integrations](/docs/integrations/models) for model selection and cost trade-offs.
