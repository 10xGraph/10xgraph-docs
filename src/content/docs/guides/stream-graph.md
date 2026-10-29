---
title: Stream graph responses
description: "Stream token-by-token output using astream(), handle StreamChunk events, and pause with interrupts"
section: "Build agents"
group: "Streaming, media and realtime"
order: 320
label: Stream responses
updated: "2026-10-27"
faq:
  - q: "When should I use astream() instead of ainvoke()?"
    a: "Use astream() to display tokens as they arrive (lower latency in chat UIs), observe intermediate progress during long runs, or cancel execution early. Use ainvoke() when you need the final result and can wait for the entire graph to complete."
  - q: "What's the difference between chunk.message.delta and a complete message?"
    a: "delta=True means the message is partial (token-by-token text arriving). delta=False means the complete message is ready. Both carry text in chunk.message.text()."
  - q: "Do I need to configure streaming, or does it work with any graph?"
    a: "Streaming works with any compiled graph without configuration. Just call astream() instead of ainvoke(). To pause at specific nodes, pass interrupt_before or interrupt_after to compile()."
---

## Overview

Streaming lets you emit graph responses incrementally as they execute, token by token. Instead of waiting for the full result, your frontend receives chunks in real time, enabling responsive chat interfaces, visible progress during tool use, and the ability to cancel long operations. `CompiledGraph.astream()` yields `StreamChunk` objects that you process based on the event type (message, state, tool update, error).

### When to stream

- **Chat interfaces**: Display assistant responses as they arrive, improving perceived latency.
- **Long-running workflows**: Show progress during extended operations (search, file processing, multiple tool calls).
- **Cancellation**: Stop the graph mid-execution if the user requests it or closes the connection.

When to prefer `ainvoke()` instead: if you only need the final result, do not need to show progress, and are willing to wait for the entire run to finish.

---

## Set up a graph for streaming

Streaming requires no special configuration. Any compiled graph can be streamed (`compile()` uses an `InMemoryCheckpointer` by default). Install a provider extra for the model, for example `pip install "10xgraph[openai]"`. If you want the graph to pause at specific nodes (for human-in-the-loop workflows), configure `interrupt_before` or `interrupt_after`:

```python
from tenxgraph.core.graph import StateGraph, Agent
from tenxgraph.storage.checkpointer import InMemoryCheckpointer
from tenxgraph.utils import END

# Build a simple graph
agent = Agent(model="gpt-4o")
graph = StateGraph()
graph.add_node("MAIN", agent)
graph.set_entry_point("MAIN")
graph.add_edge("MAIN", END)

# Compile with checkpointer; streaming works by default
app = graph.compile(
    checkpointer=InMemoryCheckpointer(),
    interrupt_before=["MAIN"],  # optional: pause before MAIN runs
)
```

The `checkpointer` is required to save the paused state when using interrupts. For basic streaming without pauses, `InMemoryCheckpointer` is sufficient for development; use `PgCheckpointer` in production for durable, multi-replica persistence.

---

## Stream and handle chunks

Call `astream()` with your input and iterate over chunks. Every chunk is a `StreamChunk` with an `event` field that tells you what kind of data it carries.

```python
import asyncio
from tenxgraph.core.state import Message, StreamEvent
from tenxgraph.utils import ResponseGranularity

async def stream_chat(app, user_input: str, thread_id: str):
    """Stream a single turn of conversation."""
    print(f"User: {user_input}")
    print("Assistant: ", end="", flush=True)

    async for chunk in app.astream(
        input_data={"messages": [Message.text_message(user_input)]},
        config={"thread_id": thread_id},
        response_granularity=ResponseGranularity.LOW,
    ):
        # Always check chunk.event first
        if chunk.event == StreamEvent.MESSAGE and chunk.message:
            # The stream first echoes your input message; skip it
            if chunk.message.role == "user":
                continue
            # Print the text (whether partial or complete)
            print(chunk.message.text(), end="", flush=True)

    print()  # newline after stream ends

# Run a conversation
asyncio.run(stream_chat(app, "What is 2 + 2?", thread_id="session-1"))
```

**Key patterns:**
- Always branch on `chunk.event` before reading data.
- Usually one of `chunk.message`, `chunk.state` and `chunk.data` is set, but not always. A tool result chunk has event `message` and carries both the tool `Message` and `chunk.data` (`status`, `tool_name`, `args`, `tool_call_id`). Branch on `chunk.event`, then check each field for `None` before you read it.
- `chunk.message.text()` extracts text from a message's content blocks (do not access `.content` directly).
- Use `async for` to iterate; `astream()` is an async generator.
- The first `MESSAGE` chunk is an echo of your input messages (role `user`). Skip it if you do not want to display it.
- With the default `LOW` granularity only `MESSAGE` and `ERROR` chunks are yielded.

---

## Understand StreamChunk structure

Every chunk yielded by `astream()` is a `StreamChunk` with these fields:

| Field | Type | When set | What it contains |
|---|---|---|---|
| `event` | `StreamEvent` | Always | One of `MESSAGE`, `STATE`, `UPDATES`, `ERROR` (string values are lowercase: `"message"`, `"state"`, `"updates"`, `"error"`) |
| `message` | `Message \| None` | `event == MESSAGE` | A Message object; use `.text()` to extract text |
| `state` | `AgentState \| None` | `event == STATE` | Current graph state (depends on `response_granularity`) |
| `data` | `dict \| None` | `UPDATES`, `ERROR`, and some tool `MESSAGE` chunks | Event-specific metadata (tool status, error reason) |
| `thread_id` | `str \| None` | Sometimes | The thread ID from config |
| `run_id` | `str \| None` | Sometimes | The run ID from config |
| `metadata` | `dict \| None` | Sometimes | Extra metadata (e.g., `"node"` and `"step"` keys on `STATE` chunks) |

### Event types

- **`StreamEvent.MESSAGE`**: A Message from the graph (assistant response, tool result, or tool progress). Read `chunk.message`.
- **`StreamEvent.STATE`**: A snapshot of the graph state (only when `response_granularity` is `PARTIAL` or `FULL`). Read `chunk.state`.
- **`StreamEvent.UPDATES`**: Lifecycle updates such as `invoking_node`, `node_invoked`, `invoking_tool` and `graph_invoked` (only with `FULL`). Read `chunk.data` for `{"status": "...", "node": "..."}`; tool updates also carry `tool_name`.
- **`StreamEvent.ERROR`**: A tool failure. Read `chunk.data` for `{"status": "tool_failed", "reason": "...", "error": "..."}`.

---

## Differentiate partial from complete messages

The `chunk.message.delta` field is a boolean flag:
- `delta=True`: The message is partial; you are receiving tokens as they arrive. Append to your display buffer.
- `delta=False`: The message is complete; replace any streaming placeholder with the final version.

Both cases use `chunk.message.text()` to get the text:

```python
async for chunk in app.astream(
    {"messages": [Message.text_message("Explain gravity.")]},
    config={"thread_id": "physics-session"}
):
    if chunk.event != StreamEvent.MESSAGE or not chunk.message:
        continue

    if chunk.message.delta:
        # Partial message: update the live display buffer
        display_buffer.append(chunk.message.text())
        update_ui_stream(display_buffer.join(""))
    else:
        # Complete message: finalize
        final_text = chunk.message.text()
        show_final_message(final_text)
        display_buffer.clear()
```

---

## Control output detail with ResponseGranularity

The `response_granularity` parameter controls how much state information is included in chunks:

| Value | What you get | Use case |
|---|---|---|
| `ResponseGranularity.LOW` (default) | `MESSAGE` and `ERROR` chunks only | Chat UI; minimal overhead |
| `ResponseGranularity.PARTIAL` | Adds `STATE` chunks | Monitor conversation history without lifecycle noise |
| `ResponseGranularity.FULL` | Adds `STATE` and `UPDATES` chunks (node and tool lifecycle, final `graph_invoked`) | Debugging, observability, rebuilding state on the client |

```python
async for chunk in app.astream(
    {"messages": [Message.text_message("Summarize our conversation.")]},
    config={"thread_id": "session-2"},
    response_granularity=ResponseGranularity.FULL,
):
    if chunk.event == StreamEvent.STATE and chunk.state:
        # Full state; useful for complex client-side state management
        print(f"Context: {len(chunk.state.context)} messages")
        print(f"Summary: {chunk.state.context_summary}")
    elif chunk.event == StreamEvent.MESSAGE and chunk.message:
        # Still get message tokens
        print(chunk.message.text(), end="", flush=True)
```

`FULL` mode increases network traffic and processing; use it only when you need full observability.

---

## Observe tool calls and progress

`UPDATES` chunks are only yielded with `ResponseGranularity.FULL`. When the graph invokes a tool, you receive:
1. An `UPDATES` chunk when the tool starts (status = "invoking_tool").
2. A `MESSAGE` chunk with the tool result (role = "tool").
3. An `ERROR` chunk with status `tool_failed` if the tool returned an error.

The producing node name is in `chunk.metadata.get("node")` for state chunks and `chunk.data.get("node")` for update and error chunks:

```python
from tenxgraph.core.state import StreamEvent

async for chunk in app.astream(
    {"messages": [Message.text_message("What is 15 * 23?")]},
    config={"thread_id": "calc-session"},
    response_granularity=ResponseGranularity.FULL,
):
    # Extract node name (present in most chunks)
    node = (chunk.metadata or {}).get("node") or (chunk.data or {}).get("node") or "unknown"

    if chunk.event == StreamEvent.UPDATES and chunk.data:
        # Tool lifecycle event
        status = chunk.data.get("status")
        tool_name = chunk.data.get("tool_name", "")
        if status == "invoking_tool":
            print(f"[{node}] Invoking {tool_name}...")

    elif chunk.event == StreamEvent.MESSAGE and chunk.message:
        # Text or tool result
        if chunk.message.role == "tool":
            print(f"[{node}] Tool result: {chunk.message.text()}")
        elif chunk.message.role == "user":
            continue
        else:
            print(chunk.message.text(), end="", flush=True)

    elif chunk.event == StreamEvent.ERROR and chunk.data:
        reason = chunk.data.get("reason", "unknown error")
        print(f"[{node}] Error: {reason}")
```

If your tools emit progress updates using `StreamEmitter`, those arrive as `UPDATES` chunks (or `MESSAGE`/`ERROR` chunks for progress and failure helpers).

---

## Collect the full response

If you want to display tokens during the stream but also keep the final messages for later use (e.g., saving to a database), collect them as chunks arrive:

```python
from tenxgraph.core.state import StreamEvent, Message

async def stream_to_messages(
    app,
    input_messages: list[Message],
    thread_id: str
) -> list[Message]:
    """Run streaming and return the final messages."""
    final_messages: list[Message] = []
    seen: set[str] = set()

    async for chunk in app.astream(
        {"messages": input_messages},
        config={"thread_id": thread_id},
    ):
        if chunk.event != StreamEvent.MESSAGE or not chunk.message:
            continue

        # Skip partial deltas and the echoed user input
        if chunk.message.delta or chunk.message.role == "user":
            continue

        # Avoid duplicates by message ID
        msg_id = str(chunk.message.message_id)
        if msg_id in seen:
            continue

        seen.add(msg_id)
        final_messages.append(chunk.message)

    return final_messages

# Use it
messages = await stream_to_messages(
    app,
    [Message.text_message("Generate a report.")],
    thread_id="report-session"
)
# messages now contains all final messages from the run
```

Alternatively, run with `ResponseGranularity.FULL` and extract the `context` list from the last `STATE` chunk.

---

## Stop a stream early

To cancel a running stream (e.g., if the user closes the chat connection), call `astop()` from another task. The graph checks the stop flag between nodes and halts:

```python
import asyncio
from tenxgraph.core.state import Message, StreamEvent

thread_id = "long-running-session"

async def run_stream():
    """Stream a long-running query."""
    async for chunk in app.astream(
        {"messages": [Message.text_message("Write a 5000-word essay on climate change.")]},
        config={"thread_id": thread_id},
    ):
        if chunk.event == StreamEvent.MESSAGE and chunk.message:
            print(chunk.message.text(), end="", flush=True)

async def stop_after_delay():
    """Request stop after 10 seconds."""
    await asyncio.sleep(10.0)
    result = await app.astop({"thread_id": thread_id})
    print(f"\nStop requested: {result}")

async def main():
    # Run both concurrently
    await asyncio.gather(
        run_stream(),
        stop_after_delay()
    )

asyncio.run(main())
```

The sync equivalent is `app.stop(config)` for non-async contexts.

### Stop behavior

- Stop is checked between node executions; a running node or tool call finishes before the graph halts.
- `astop()` needs a thread with a checkpointer. It returns `{"ok": True, "running": True}` when a stop was recorded, or `{"ok": True, "running": False, "reason": "not-running"}` when the thread is idle or paused.

---

## Pause and resume with interrupts

For human-in-the-loop workflows, pause the graph at specific nodes to let a human review or approve the state before continuing.

### Compile with interrupts

Declare which nodes should pause:

```python
app = graph.compile(
    checkpointer=checkpointer,
    interrupt_before=["review_node"],   # pause before this node
    interrupt_after=["approval_node"],  # pause after this node
)
```

### Run until the pause

```python
async for chunk in app.astream(
    {"messages": [Message.text_message("Start the review workflow.")]},
    config={"thread_id": "review-workflow-1"},
):
    if chunk.event == StreamEvent.MESSAGE and chunk.message:
        print(chunk.message.text(), end="", flush=True)

# Graph is now paused before "review_node"
print("\nPaused. Human review happening...")
```

### Resume after approval

On the same `thread_id`, call `astream()` or `ainvoke()` again with new input. The graph resumes from the pause point. (If the pause came from an `interrupt()` call inside a node, resume with `{"resume": value}` instead; see [Add human approval](/docs/guides/add-human-approval).)

```python
# Simulate human approval
await asyncio.sleep(2.0)

# Resume on the same thread
async for chunk in app.astream(
    {"messages": [Message.text_message("Approved. Continue with execution.")]},
    config={"thread_id": "review-workflow-1"},
):
    if chunk.event == StreamEvent.MESSAGE and chunk.message:
        print(chunk.message.text(), end="", flush=True)

print("\nWorkflow completed.")
```

The new message is appended to the conversation history and the graph continues from where it paused. The checkpoint preserves everything between pauses, so your state is consistent.

---

## Handle errors in streams

Errors from nodes or tools emit `StreamEvent.ERROR` chunks. The `chunk.data` dict contains:
- `"reason"`: Human-readable error description.
- `"error"`: The error message from the failed tool.
- `"status"`, `"tool_name"`, `"tool_call_id"`, `"node"`: which tool failed.

```python
async for chunk in app.astream(
    {"messages": input_messages},
    config={"thread_id": "error-demo"},
):
    if chunk.event == StreamEvent.ERROR and chunk.data:
        reason = chunk.data.get("reason", "unknown error")
        print(f"Error occurred: {reason}")

        # Decide whether to retry, fallback, or fail
        if "rate_limit" in reason.lower():
            print("Rate limited. Retrying in 5 seconds...")
            await asyncio.sleep(5.0)
        else:
            print("Fatal error. Stopping.")
            break

    elif chunk.event == StreamEvent.MESSAGE and chunk.message:
        print(chunk.message.text(), end="", flush=True)
```

`ERROR` chunks report tool failures. Node exceptions are raised from the `async for` loop, so wrap the loop in `try/except` if you need to handle them.

---

## Complete example: streaming chat app

```python
import asyncio
from tenxgraph.core.graph import StateGraph, Agent, ToolNode
from tenxgraph.core.state import AgentState, Message, StreamEvent
from tenxgraph.storage.checkpointer import InMemoryCheckpointer
from tenxgraph.utils import ResponseGranularity, END

# Define a tool
def get_current_time() -> str:
    from datetime import datetime
    return datetime.now().isoformat()

# Build the graph
tool_node = ToolNode([get_current_time])
agent = Agent(
    model="gpt-4o",
    system_prompt=[
        {
            "role": "system",
            "content": "You are a helpful assistant. Use tools when the user asks for the time."
        }
    ],
    tool_node=tool_node,
)

graph = StateGraph()
graph.add_node("MAIN", agent)
graph.add_node("TOOL", tool_node)

def should_use_tools(state: AgentState) -> str:
    if state.context and state.context[-1].role == "assistant":
        if state.context[-1].tools_calls:
            return "TOOL"
    return END

graph.add_conditional_edges("MAIN", should_use_tools, {"TOOL": "TOOL", END: END})
graph.add_edge("TOOL", "MAIN")
graph.set_entry_point("MAIN")

# Compile and stream
app = graph.compile(checkpointer=InMemoryCheckpointer())

async def chat_session():
    """Multi-turn streaming conversation."""
    thread_id = "user-session-1"
    messages = []

    async def turn(user_input: str):
        """Run a single conversation turn."""
        print(f"\nYou: {user_input}")
        print("Assistant: ", end="", flush=True)

        async for chunk in app.astream(
            {"messages": [Message.text_message(user_input)]},
            config={"thread_id": thread_id},
            response_granularity=ResponseGranularity.LOW,
        ):
            if chunk.event == StreamEvent.MESSAGE and chunk.message:
                if chunk.message.role == "user":
                    continue  # skip the echoed input
                print(chunk.message.text(), end="", flush=True)

        print()  # newline

    # Run multiple turns
    await turn("Hello! What's your name?")
    await turn("What time is it right now?")
    await turn("Thanks for your help!")

asyncio.run(chat_session())
```

Output varies by model. Each turn prints the assistant text as it streams, and the second turn also runs the `get_current_time` tool before the final answer.

---

## Run it in production

Over HTTP the same events arrive as NDJSON from the stream endpoint, or over WebSocket. Apply the rate limit to streams, since each one holds a connection open, and note that a stop request is bound to the run it was sent for. See [Invoke and stream](/docs/server/invoke-and-stream), [WebSockets](/docs/server/websockets) and [Rate limiting](/docs/server/rate-limiting).

## Related guides

- [Build a graph](/docs/guides/build-a-graph): Construct and run graphs without streaming.
- [Add human approval](/docs/guides/add-human-approval): Use the `interrupt()` function for human-in-the-loop patterns.
- [Set up checkpointing](/docs/guides/set-up-checkpointing): Choose a checkpointer for production persistence.
- [Concepts: Streaming](/docs/concepts/streaming): Why streaming, transports (REST, WebSocket), and client-side handling.
