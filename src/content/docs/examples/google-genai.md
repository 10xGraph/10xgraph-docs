---
title: Google GenAI Adapter
description: "Convert google-genai SDK responses to 10xGraph Message format with GoogleGenAIConverter"
section: Examples
group: "Foundations"
order: 70
label: Google GenAI Adapter
updated: "2026-10-27"
faq:
  - q: "When should I use GoogleGenAIConverter instead of Agent?"
    a: "Use it when you call the google-genai SDK yourself, outside a StateGraph or in a custom node, and still want 10xGraph Message objects. Inside a graph, the Agent class handles the conversion for you."
  - q: "Does the converter support streaming?"
    a: "Yes. convert_streaming_response yields Message objects with delta set to True for each chunk, followed by a final assembled message with delta set to False."
---

`GoogleGenAIConverter` turns raw google-genai SDK responses into 10xGraph `Message` objects, so you can call Gemini directly and still work with one message format. This walkthrough covers a standard response, a streamed response, and function calling, using the example at `examples/google_genai_example.py` in the [10xGraph repository](https://github.com/10xGraph/10xGraph).

## Prerequisites

Install 10xGraph with the Google GenAI provider extra:

```bash
pip install "10xgraph[google-genai]"
```

Set your Google API key:

```bash
export GEMINI_API_KEY="your-key-here"
# or
export GOOGLE_API_KEY="your-key-here"
```

Run the full example with `python examples/google_genai_example.py` from the `agentflow` folder. It prints an install message if google-genai is missing and returns early if no key is set.

## How GoogleGenAIConverter works

The converter lives in `tenxgraph.runtime.adapters.llm` and maps an SDK response to a `Message`. It extracts content blocks, tool calls, token usage and reasoning into one structure. The three examples below share the imports shown in the first one.

## Example 1: Standard response

Convert a single model response to a `Message`:

```python title="google_genai_example.py"
import asyncio
import os

from google import genai
from google.genai import types

from tenxgraph.runtime.adapters.llm import GoogleGenAIConverter


async def standard_response_example():
    """Convert a standard Google GenAI response to a Message."""
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        print("Error: GEMINI_API_KEY or GOOGLE_API_KEY environment variable not set")
        return

    client = genai.Client(api_key=api_key)

    try:
        # Call the model
        response = client.models.generate_content(
            model="gemini-2.0-flash-exp",
            contents="Write a haiku about Python programming",
            config=types.GenerateContentConfig(
                temperature=0.7,
                max_output_tokens=100,
            ),
        )

        # Convert to 10xGraph Message
        converter = GoogleGenAIConverter()
        message = await converter.convert_response(response)

        # Inspect the message
        print(f"Message ID: {message.message_id}")
        print(f"Role: {message.role}")
        print(f"Content blocks: {len(message.content)}")
        for block in message.content:
            if hasattr(block, "text"):
                print(f"Text: {block.text}")

    finally:
        client.close()


asyncio.run(standard_response_example())
```

The `convert_response()` method is async and returns a single `Message` with:

- `message_id`: ID for the message
- `role`: Always `"assistant"` for model responses
- `content`: List of content blocks (TextBlock, ImageBlock, ToolCallBlock, etc.)
- `tools_calls`: List of function call objects if the model called functions
- `usages`: Token count summary (prompt, completion, cached)
- `metadata`: A dict with `provider` (`google_genai`), `model` and `finish_reason`

## Example 2: Streaming response

Handle streaming responses that yield chunks as they arrive:

```python title="google_genai_example.py (continued)"
async def streaming_response_example():
    """Convert a streaming response, emitting chunks as they arrive."""
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        print("Error: GEMINI_API_KEY or GOOGLE_API_KEY environment variable not set")
        return

    client = genai.Client(api_key=api_key)

    try:
        # Request a streaming response
        stream = client.models.generate_content_stream(
            model="gemini-2.0-flash-exp",
            contents="Count from 1 to 5, one number at a time",
            config=types.GenerateContentConfig(temperature=0.7),
        )

        # Convert the stream
        converter = GoogleGenAIConverter()
        config = {"thread_id": "example-thread"}

        print("Streaming chunks:")
        async for message in converter.convert_streaming_response(
            config=config,
            node_name="google_genai_node",
            response=stream,
        ):
            # Each message has a delta flag
            if message.delta:
                # This is a streaming chunk, show it immediately
                for block in message.content:
                    if hasattr(block, "text"):
                        print(block.text, end="", flush=True)
            else:
                # This is the final assembled message
                print(f"\n\nFinal message ID: {message.message_id}")
                print(f"Total blocks: {len(message.content)}")

    finally:
        client.close()


asyncio.run(streaming_response_example())
```

The `convert_streaming_response()` method yields multiple `Message` objects. Check `message.delta`:

- `delta=True`: A partial chunk; buffer or display immediately
- `delta=False`: The final complete message with full context

This pattern lets you display tokens as they arrive while still having the complete message at the end.

## Example 3: Function calling

Inspect tool calls when the model requests them:

```python title="google_genai_example.py (continued)"
async def function_calling_example():
    """Extract and inspect function calls from a model response."""
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        print("Error: GEMINI_API_KEY or GOOGLE_API_KEY environment variable not set")
        return

    client = genai.Client(api_key=api_key)

    try:
        # Define a tool function
        def get_weather(location: str) -> str:
            """Get the weather for a location.

            Args:
                location: The city and state, e.g. San Francisco, CA
            """
            return "sunny"

        # Request a response with function calling enabled
        response = client.models.generate_content(
            model="gemini-2.0-flash-exp",
            contents="What's the weather like in Boston?",
            config=types.GenerateContentConfig(
                tools=[get_weather],
                automatic_function_calling=types.AutomaticFunctionCallingConfig(
                    disable=True  # Disable auto-calling to see the function call
                ),
            ),
        )

        # Convert the response
        converter = GoogleGenAIConverter()
        message = await converter.convert_response(response)

        # Inspect tool calls
        print(f"Tool calls in message: {len(message.tools_calls or [])}")
        if message.tools_calls:
            for tool_call in message.tools_calls:
                print(f"\nTool call:")
                print(f"  Function: {tool_call.get('function', {}).get('name')}")
                print(f"  Arguments: {tool_call.get('function', {}).get('arguments')}")

        # Also available as ToolCallBlock objects in message.content
        for block in message.content:
            if hasattr(block, "name"):
                print(f"\nToolCallBlock:")
                print(f"  Name: {block.name}")
                print(f"  Args: {block.args}")

    finally:
        client.close()


asyncio.run(function_calling_example())
```

The `Message.tools_calls` field contains function calls as a list of dicts in OpenAI format, and `message.content` contains them as `ToolCallBlock` objects. Both represent the same information.

## When to use GoogleGenAIConverter directly

The `Agent` class already integrates Google GenAI when you set `provider="google"`. Use `GoogleGenAIConverter` directly when:

- You call the SDK outside of a StateGraph (background jobs, utilities)
- You need fine-grained control over model parameters that `Agent` does not expose
- You are building a custom graph node that calls the SDK

For the common case (an LLM inside a graph that calls tools), use `Agent` instead. See [Agent Class Pattern](/docs/examples/agent-class).

## Key takeaways

- `GoogleGenAIConverter` translates raw SDK responses to 10xGraph `Message` format
- `convert_response()` handles single responses
- `convert_streaming_response()` handles streams with delta chunks
- Both extract content, tool calls, and token usage automatically
- The converter module imports without google-genai installed, but you need the extra to call the SDK

## Next step

Read [Tool Decorator](/docs/examples/tool-decorator) to learn how to decorate functions as tools with metadata, tags, and error handling.
