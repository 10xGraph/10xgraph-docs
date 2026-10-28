---
title: Emit Tool Progress Updates
description: Learn how to send live progress, errors, and status updates from tools during streaming execution.
section: "Build agents"
group: "Tools and MCP"
order: 220
updated: "2026-10-27"
---

## Overview

When your tools perform long-running tasks (like API calls, file processing, or multi-step operations), you can use `StreamEmitter` to send **live progress updates** to the frontend during streaming execution. This gives users visibility into what the tool is doing and can provide a better UX for slow operations.

### Key Concepts

- **StreamEmitter** is injected into tools **only during streaming** (`app.stream()` / `app.astream()`)
- During normal execution (`app.invoke()` / `app.ainvoke()`), tools receive `emit=None`
- Updates are sent to the same stream output that the frontend consumes
- No external publisher setup required, works with the built-in streaming pipeline

---

## When to Use StreamEmitter

Use `StreamEmitter` when:

**Do use for:**
- Long-running operations (API calls, file processing, database queries)
- Retries with multiple attempts (show which attempt is running)
- Multi-step processes (report progress per step)
- External service calls with timeout risk
- Batch processing (show item count progress)

**Do not use for:**
- Fast operations that complete in under 100 ms (overhead not worth it)
- Simple tool results that don't require intermediate feedback
- Non-streaming execution paths (emit is None anyway, so safe to call but won't do anything)

---

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

---

## Example 1: Simple Progress Updates

**Scenario:** Fetching data from an external API with a known delay.

```python
import time
import requests
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

**What happens during invoke():**
- All `if emit:` blocks are skipped (emit is None)
- Only the final result is returned

---

## Example 2: Retry Logic with Attempt Tracking

**Scenario:** An API call that might fail temporarily; retry with feedback.

```python
import requests
from tenxgraph.core.state.stream_emitter import StreamEmitter

def call_external_service(
    endpoint: str,
    emit: StreamEmitter | None = None,
) -> str:
    """Call an external service with retries and progress updates."""
    
    max_retries = 3
    
    for attempt in range(max_retries):
        try:
            if emit and attempt > 0:
                # Report retry attempt
                emit.progress(
                    f"Retry attempt {attempt} of {max_retries - 1}",
                    data={
                        "attempt": attempt,
                        "max_attempts": max_retries - 1,
                    }
                )
            
            if emit and attempt == 0:
                emit.progress(f"Calling {endpoint}...")
            
            # Actual API call
            response = requests.get(endpoint, timeout=5)
            response.raise_for_status()
            
            return response.json()
        
        except requests.RequestException as e:
            if attempt == max_retries - 1:
                # Final attempt failed
                if emit:
                    emit.error(
                        f"Service unreachable after {max_retries} attempts: {e}",
                        data={"final_attempt": True}
                    )
                raise
            # Try again in next loop iteration
```

**Frontend sees:**
1. "Calling `https://api.10xgraph.com`..."
2. After timeout: "Retry attempt 1 of 2"
3. After another timeout: "Retry attempt 2 of 2"
4. If still failing: "Service unreachable after 3 attempts: ..."

**Key insight:** Retries are now visible to the user instead of hanging silently.

---

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
    tool_call_id: str | None = None,
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
config = {"thread_id": "user_123", "is_stream": True}

print("Streaming response with progress updates:")
for chunk in app.stream(inp, config=config):
    # Check if this is a progress chunk from StreamEmitter
    if chunk.event == "message" and chunk.data and chunk.data.get("status") == "tool_progress":
        print(f"  [PROGRESS] {chunk.data['message']} ({chunk.data['tool_name']})")
    else:
        print(chunk)
```

---

## Best Practices

### Do

1. **Check before emitting:** Always do `if emit:` before calling emit methods
2. **Use meaningful messages:** Messages should tell users what's happening
3. **Add metadata:** Include `data` for important metrics (attempt numbers, percentages, etc.)
4. **Report milestones:** Emit at meaningful progress points, not every step
5. **Throttle batch work:** Emit every N items, not on every item

### Do not

1. **Don't emit too frequently:** Thousands of updates per second will slow down streaming
2. **Don't rely on emit:** Tool should always return a valid result regardless
3. **Don't emit sensitive data:** Progress chunks are exposed to frontend; sanitize if needed
4. **Don't use for critical flow:** Emit is informational only; never branch on it

### Performance Tips

```python
# Bad: Emits 1000 times per second
for item in items:
    if emit:
        emit.progress(f"Processing {item}")
    process(item)

# Good: Emits once per batch
for i, item in enumerate(items):
    if (i + 1) % 100 == 0 and emit:
        emit.progress(f"Processed {i + 1} of {len(items)}")
    process(item)
```

---

## See Also

- [StreamEmitter Reference](/docs/reference/python/stream-emitter), Complete API documentation
- [Streaming Architecture](/docs/concepts/streaming), How streaming chunks and granularity work
- [Dependency Injection](/docs/concepts/dependency-injection), How parameters like `emit` and `state` are injected
- [Example: react_stream/stream_sync.py](https://github.com/10xGraph/10xGraph/blob/main/examples/react_stream/stream_sync.py), Full working example in the repository

## Run it in production

Progress events travel on the same stream the client already reads, so no extra server setup is needed. Each stream is one long HTTP request, so check idle timeouts on your load balancer. See [Invoke and stream](/docs/server/invoke-and-stream) and [Production readiness](/docs/production).
