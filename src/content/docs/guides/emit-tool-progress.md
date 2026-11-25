---
title: Emit tool progress updates
description: Learn how to send live progress, errors, and status updates from tools during streaming execution.
section: "Build agents"
group: "Tools and MCP"
order: 220
updated: "2026-11-26"
---

When your tools perform long-running tasks (like API calls, file processing, or multi-step operations), you can use `StreamEmitter` to send **live progress updates** to the frontend during streaming execution. This gives users visibility into what the tool is doing and can provide a better UX for slow operations.

`emit` is injected only while streaming; under `invoke()` it is `None`, so always check `if emit:`. Progress chunks are `message` events with `status` `tool_progress` and reach the client at every granularity.

## Setup: Declare emit Parameter

The first step is to declare `emit` as an optional parameter in your tool function:

```python
from tenxgraph.core.state.stream_emitter import StreamEmitter

def my_tool(
    user_input: str,
    emit: StreamEmitter | None = None,  # Optional, auto-injected during streaming
) -> str:
    """Tool that can report progress during streaming."""
    if emit:
        emit.progress("Starting work...")
    # ... do work ...
    return "result"
```

### Key Details

- **Import:** `from tenxgraph.core.state.stream_emitter import StreamEmitter`
- **Parameter name:** Must be exactly `"emit"` (this is what the framework injects)
- **Type hint:** `StreamEmitter | None` tells type checkers it's optional
- **Always check:** Always do `if emit:` before calling emit methods (it's `None` during non-streaming)

## Example 1: Simple Progress Updates

**Scenario:** Fetching data from an external API with a known delay.

```python
import time
from tenxgraph.core.state.stream_emitter import StreamEmitter

def fetch_weather(location: str, emit: StreamEmitter | None = None) -> str:
    """Fetch weather data with progress updates."""
    
    if emit:
        emit.progress(f"Looking up weather for {location}...")
    
    # Simulate API delay
    time.sleep(2)
    
    if emit:
        emit.progress("Processing response...", data={"location": location})
    
    # Mock response for example
    result = f"Sunny, 72°F in {location}"
    
    if emit:
        emit.progress("Weather data ready")
    
    return result
```

**What happens during streaming:**
1. User sees "Looking up weather for Paris..." 
2. After 2 seconds: "Processing response..." with metadata
3. Finally: "Weather data ready"
4. Tool returns the actual result

`emit.error(message, data=...)` sends a `tool_failed` error chunk and `emit.message(...)` a plain message; see the [StreamEmitter reference](/docs/reference/python/stream-emitter#methods).

For batch work, emit every N items, not on every item; progress chunks reach the client, so never put secrets in them.

## Full Graph Example

Here's a complete graph that uses `StreamEmitter`. Install with `pip install "10xgraph[google-genai]"` and set `GEMINI_API_KEY` or `GOOGLE_API_KEY`:

```python
from tenxgraph.core.graph import StateGraph, Agent, ToolNode
from tenxgraph.core.state import AgentState, Message
from tenxgraph.storage.checkpointer import InMemoryCheckpointer
from tenxgraph.core.state.stream_emitter import StreamEmitter
from tenxgraph.utils.constants import END
import time

# Define tool with StreamEmitter
def get_weather(
    location: str,
    emit: StreamEmitter | None = None,
) -> str:
    """Get weather for a location with streaming progress."""
    if emit:
        emit.progress(f"Fetching weather for {location}...")
    
    time.sleep(1)
    
    if emit:
        emit.progress("Processing data...", data={"location": location})
    
    time.sleep(1)
    
    if emit:
        emit.progress("Finalizing...", data={"location": location})
    
    return f"Sunny, 72°F in {location}"

# Build graph
checkpointer = InMemoryCheckpointer()
tool_node = ToolNode([get_weather])

agent = Agent(
    model="gemini-2.5-flash",
    provider="google",
    system_prompt=[{
        "role": "system",
        "content": "You are a weather assistant. Use the get_weather tool when asked."
    }],
    tool_node=tool_node,
    trim_context=True,
)

graph = StateGraph()
graph.add_node("MAIN", agent)
graph.add_node("TOOL", tool_node)
graph.add_conditional_edges(
    "MAIN",
    lambda state: "TOOL" if state.context[-1].tools_calls else END,
    {"TOOL": "TOOL", END: END},
)
graph.add_edge("TOOL", "MAIN")
graph.set_entry_point("MAIN")

app = graph.compile(checkpointer=checkpointer)

# Stream with progress updates
inp = {"messages": [Message.text_message("What's the weather in Paris?")]}
config = {"thread_id": "user_123"}

print("Streaming response with progress updates:")
for chunk in app.stream(inp, config=config):
    # Check if this is a progress chunk from StreamEmitter
    if chunk.event == "message" and chunk.data and chunk.data.get("status") == "tool_progress":
        print(f"  [PROGRESS] {chunk.data['message']} ({chunk.data['tool_name']})")
    else:
        print(chunk)
```

## See also

- [StreamEmitter Reference](/docs/reference/python/stream-emitter): Complete API documentation
- [Streaming Architecture](/docs/concepts/streaming): How streaming chunks and granularity work
- [Dependency Injection](/docs/concepts/dependency-injection): How parameters like `emit` and `state` are injected
- [Example: streaming/stream_agent.py](https://github.com/10xGraph/10xGraph/blob/main/examples/streaming/stream_agent.py): a working example in the repository

## Run it in production

Progress events travel on the same stream the client already reads, so no extra server setup is needed. Each stream is one long HTTP request, so check idle timeouts on your load balancer. See [Invoke and stream](/docs/server/invoke-and-stream) and [Production readiness](/docs/production).
