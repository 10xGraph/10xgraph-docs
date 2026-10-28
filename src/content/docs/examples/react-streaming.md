---
title: React Streaming
seoTitle: "Streaming tutorial: token-by-token astream"
description: Stream graph responses token-by-token using astream with ResponseGranularity, and understand the difference between invoke and stream.
section: Examples
group: "Streaming"
order: 80
label: React Streaming
updated: "2026-10-27"
faq:
  - q: What is the difference between invoke, stream and astream?
    a: "invoke runs the graph and returns the final result. stream is a synchronous generator of StreamChunk objects, and astream is the async equivalent. All three take the same input and config."
  - q: How do I tell a partial message from the final one?
    a: "Check chunk.message.delta. It is True for partial updates and False for a complete message."
---

This example streams a ReAct agent's reply with `astream`, so your UI can show text as the model produces it instead of waiting for `invoke` to finish. You run one tool, read `StreamChunk` objects, and use `ResponseGranularity` to choose how much data each chunk carries.

**Source example:** [`examples/react_stream/stream_react_agent.py`](https://github.com/10xGraph/10xGraph/blob/main/examples/react_stream/stream_react_agent.py)

## What this example shows

A ReAct agent that streams responses token-by-token using `astream`, instead of waiting for the full result with `invoke`. Each streaming chunk carries either a partial or complete message. You'll see how `ResponseGranularity` controls the size and content of each chunk, and the difference between async (`astream`), sync (`stream`), and blocking (`invoke`) execution.

## Prerequisites and setup

Python 3.12 or later. Install the dependencies:

```bash
pip install "10xgraph[google-genai]"
```

Set your Google Gemini API key:

```bash
export GEMINI_API_KEY="your-key-here"
```

Or add it to a `.env` file in your project root; the example loads it with `load_dotenv()`.

## How to run it

From the repo root:

```bash
cd examples/react_stream
python stream_react_agent.py                    # runs the default async streaming test
python stream_react_agent.py sync               # runs sync test
python stream_react_agent.py sync-stream        # runs sync stream test
python stream_react_agent.py non-stream         # runs non-streaming test
```

Each test prints every chunk with `chunk.model_dump()`, so you see the event, message, state and metadata fields.

## The code walkthrough

### Define the tool

The tool returns a `Message` object so the result carries explicit `tool_call_id` metadata. This is injectable: the framework passes `tool_call_id` and `state` automatically when the LLM calls the tool.

```python title="tools.py"
from tenxgraph.core.state import AgentState, Message

# tool_call_id and state are injected by the framework, not by the model
def get_weather(
    location: str,
    tool_call_id: str,
    state: AgentState,
) -> Message:
    """Get the current weather for a specific location."""
    res = f"The weather in {location} is sunny."
    return Message.tool_message(
        content=res,
        tool_call_id=tool_call_id,
    )
```

### Build the agent and graph

The agent takes the `ToolNode` through its `tool_node` parameter, and the graph routes to the tool node whenever the last assistant message contains tool calls. Create an agent with the tool node, and build a graph that branches to the tool node when the agent calls tools.

```python title="graph.py"
from tenxgraph.core import Agent, StateGraph, ToolNode
from tenxgraph.storage.checkpointer import InMemoryCheckpointer
from tenxgraph.utils.constants import END

checkpointer = InMemoryCheckpointer()
tool_node = ToolNode([get_weather])

main_agent = Agent(
    model="gemini-2.5-flash",
    provider="google",
    system_prompt=[
        {"role": "system", "content": "You are a helpful assistant. Use tools when needed."}
    ],
    tool_node=tool_node,
    trim_context=True,
)

def should_use_tools(state: AgentState) -> str:
    if not state.context or len(state.context) == 0:
        return "TOOL"
    last = state.context[-1]
    if (
        hasattr(last, "tools_calls")
        and last.tools_calls
        and len(last.tools_calls) > 0
        and last.role == "assistant"
    ):
        return "TOOL"
    if last.role == "tool":
        return END
    return END

graph = StateGraph()
graph.add_node("MAIN", main_agent)
graph.add_node("TOOL", tool_node)
graph.add_conditional_edges("MAIN", should_use_tools, {"TOOL": "TOOL", END: END})
graph.add_edge("TOOL", "MAIN")
graph.set_entry_point("MAIN")

app = graph.compile(checkpointer=checkpointer)
```

### Stream the response with `astream`

Call the compiled graph with `astream` to receive chunks as they are produced. Branch on `chunk.event`: `StreamEvent.MESSAGE` chunks carry a message. The snippets below continue from the previous ones and assume `app` is already defined (add `load_dotenv()` from `dotenv` at the top of your file to read your API key).

```python title="stream_react_agent.py"
import asyncio
from tenxgraph.core.state import StreamEvent
from tenxgraph.utils import ResponseGranularity

async def main():
    inp = {"messages": [Message.text_message("What is the weather in Tokyo?")]}
    config = {"thread_id": "stream-1", "recursion_limit": 10}

    async for chunk in app.astream(inp, config=config, response_granularity=ResponseGranularity.LOW):
        if chunk.event == StreamEvent.MESSAGE and chunk.message:
            print(chunk.message.text(), end="", flush=True)

asyncio.run(main())
```

## ResponseGranularity and chunk control

`ResponseGranularity` controls what data each chunk contains, letting you trade payload size for detail:

| Value | Chunk contains | Use case |
|---|---|---|
| `ResponseGranularity.LOW` (default) | Latest messages only | Token-by-token UI streaming, smallest payload |
| `ResponseGranularity.PARTIAL` | Context, summary, latest messages | Progress tracking with context |
| `ResponseGranularity.FULL` | Full state and latest messages | Debugging, audit logging |

Lower granularity means faster, smaller chunks; higher granularity gives you more context but larger payloads.

## StreamChunk structure

Every chunk is a `StreamChunk` with fields: `event`, `message`, `state`, `data`, `thread_id`, `run_id`, `metadata`, and `timestamp`. Always branch on `chunk.event` first; each event type holds different data.

| Event | Field | Content |
|---|---|---|
| `StreamEvent.MESSAGE` | `chunk.message` | A partial or complete message |
| `StreamEvent.STATE` | `chunk.state` | Agent state |
| `StreamEvent.UPDATES` | `chunk.data` | Update payload (a dict) |
| `StreamEvent.ERROR` | `chunk.data` | Error information |

The `message.delta` field is `True` for partial updates and `False` for the final, complete message.

## Async vs sync streaming

The example includes multiple execution modes. Pick the one that fits your context:

```python
# Async streaming (FastAPI, aiohttp)
async for chunk in app.astream(inp, config=config):
    process(chunk)

# Synchronous streaming (CLI scripts, no event loop)
for chunk in app.stream(inp, config=config):
    process(chunk)

# Blocking (only the final result)
result = app.invoke(inp, config=config)
```

All three take the same input shape and config. `invoke` runs the graph synchronously and returns the final result, so it does not stream. Note that the `sync`, `sync-stream` and `non-stream` options of the example script each rebuild the graph and still call `astream`; to try `stream` or `invoke` yourself, replace the loop in `run_stream_test`.

## Streaming execution flow

When you call `astream`, the graph runs one node at a time. As the LLM generates tokens, each token becomes a chunk. After all tokens arrive, the next node (e.g., a tool) runs. The sequence repeats until the graph reaches the end node.

1. User calls `astream(inp, config, response_granularity=LOW)`.
2. Graph runs the MAIN agent.
3. Agent streams tokens to the LLM client.
4. Each token becomes a `StreamChunk(delta=True)`.
5. When the LLM finishes, the agent emits the final message with `delta=False`.
6. If the agent called tools, graph runs the TOOL node.
7. Tool result becomes a message; MAIN runs again.
8. Stream repeats until the graph exits (reaches END node).

## What to try next

- Adjust `ResponseGranularity` to PARTIAL or FULL and observe the chunk payloads grow.
- Modify the conditional edge (`should_use_tools`) to add a maximum loop count and prevent infinite tool calls.
- Extend `StreamEvent` branching to handle other events like `StreamEvent.STATE`, `StreamEvent.UPDATES` or `StreamEvent.ERROR`.
- Run the different test modes (`sync`, `sync-stream`, `non-stream`) and compare their output.

## Related pages

- [Streaming](/docs/guides/stream-graph): Guide to streaming graphs and controlling chunking.
- [Stop Stream](/docs/examples/stop-stream): Cancel a running stream mid-execution.
- [Stream concepts](/docs/concepts/streaming): Detailed explanation of streaming internals and transports.
