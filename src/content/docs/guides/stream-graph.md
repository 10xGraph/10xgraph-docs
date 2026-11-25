---
title: Stream graph responses
description: 'Stream token-by-token output using astream(), handle StreamChunk events, and pause with interrupts'
section: "Build agents"
group: "Streaming, media and realtime"
order: 280
label: Stream responses
updated: "2026-11-26"
faq:
  - q: 'When should I use astream() instead of ainvoke()?'
    a: 'Use astream() to display tokens as they arrive (lower latency in chat UIs), observe intermediate progress during long runs, or cancel execution early. Use ainvoke() when you need the final result and can wait for the entire graph to complete.'
  - q: 'What is the difference between chunk.message.delta and a complete message?'
    a: 'delta=True means the message is partial (token-by-token text arriving). delta=False means the complete message is ready. Both carry text in chunk.message.text().'
---

`CompiledGraph.astream()` yields `StreamChunk` objects as the graph runs. Why and when to stream, and the transports, are in [Streaming](/docs/concepts/streaming).

## Set up a graph for streaming

Any compiled graph can be streamed. Install a provider extra, for example `pip install "10xgraph[openai]"`.

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

app = graph.compile(
    checkpointer=InMemoryCheckpointer(),
)
```

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
- Usually one of `chunk.message`, `chunk.state` and `chunk.data` is set, but not always. A tool result chunk has event `message` and carries both the tool `Message` and `chunk.data` (`status`, `tool_name`, `args`, `tool_call_id`). Branch on `chunk.event`, then check each field for `None` before you read it.
- The first `MESSAGE` chunk is an echo of your input messages (role `user`). Skip it if you do not want to display it.
- With the default `LOW` granularity you get `MESSAGE` and `ERROR` chunks, plus `UPDATES` chunks that announce a pause.

---

The chunk fields and event types are in [Streaming](/docs/concepts/streaming#streamchunk-model). Tool failures and denials arrive as `ERROR` chunks with `data["status"]` `tool_failed` or `tool_denied`.

## Differentiate partial from complete messages

The `chunk.message.delta` field is a boolean flag:
- `delta=True`: The message is partial; you are receiving tokens as they arrive. Append to your display buffer. A delta carries only the new piece of reasoning as a `ReasoningBlock` in `content`, ahead of the text; append it to the reasoning you already show.
- `delta=False`: The message is complete; replace any streaming placeholder with the final version. Its reasoning block holds the full reasoning, not a piece.

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
        update_ui_stream("".join(display_buffer))
    else:
        # Complete message: finalize
        final_text = chunk.message.text()
        show_final_message(final_text)
        display_buffer.clear()
```

---

## Control output detail with ResponseGranularity

`response_granularity` adds chunks: `PARTIAL` adds `STATE` chunks, `FULL` adds `UPDATES` progress chunks and a final summary chunk. The full table is in [Streaming](/docs/concepts/streaming#response-granularity).

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

---

## Observe tool calls and progress

`UPDATES` chunks are only yielded with `ResponseGranularity.FULL`. When the graph invokes a tool, you receive:
1. An `UPDATES` chunk when the tool starts (status = "invoking_tool").
2. A `MESSAGE` chunk with the tool result (role = "tool").
3. An `ERROR` chunk with status `tool_failed` (or `tool_denied` when a policy blocked it) instead of a result when the call failed.

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

---

## Stop a stream early

To cancel a running stream (e.g., if the user closes the chat connection), call `astop()` from another task:

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

- A stop cancels the running node or tool: the run polls for it about every second while a node runs and saves the thread as interrupted.
- `astop()` returns `{"ok": True, "running": True}` when a stop was recorded, or `{"ok": True, "running": False, "reason": "not-running"}` when the thread is idle or paused. It works without a checkpointer for a run in the same process.
- Leaving the `async for` loop early (`break`) also saves the thread as interrupted.

---

## Pause and resume with interrupts

### Compile with interrupts

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
# Resume on the same thread
async for chunk in app.astream(
    {"messages": [Message.text_message("Approved. Continue with execution.")]},
    config={"thread_id": "review-workflow-1"},
):
    if chunk.event == StreamEvent.MESSAGE and chunk.message:
        print(chunk.message.text(), end="", flush=True)

print("\nWorkflow completed.")
```

---

## Handle errors in streams

Tool failures emit `StreamEvent.ERROR` chunks. `chunk.data` holds `status`, `reason`, `error`, `tool_name`, `tool_call_id` and `node`.

```python
async for chunk in app.astream(
    {"messages": input_messages},
    config={"thread_id": "error-demo"},
):
    if chunk.event == StreamEvent.ERROR and chunk.data:
        reason = chunk.data.get("reason", "unknown error")
        print(f"Error occurred: {reason}")

    elif chunk.event == StreamEvent.MESSAGE and chunk.message:
        print(chunk.message.text(), end="", flush=True)
```

`ERROR` chunks report tool failures; the model sees the failed result and the run goes on. A node exception, or the recursion limit, ends the stream by raising from the `async for` loop (after one `ERROR` chunk for the recursion limit), so wrap the loop in `try/except`.

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

- [Add human approval](/docs/guides/add-human-approval): Use the `interrupt()` function for human-in-the-loop patterns.
- [Set up checkpointing](/docs/guides/set-up-checkpointing): Choose a checkpointer for production persistence.
- [Streaming](/docs/concepts/streaming): chunk model, granularity and transports.
