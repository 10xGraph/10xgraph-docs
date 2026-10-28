---
title: AudioAgent
seoTitle: "AudioAgent: realtime audio agent"
description: Build realtime audio-to-audio agents with Gemini Live, driven by duplex WebSocket sessions with optional tools, memory and skills.
section: "Build agents"
group: "Prebuilt agents"
order: 150
label: AudioAgent
updated: "2026-10-27"
---

AudioAgent wraps Gemini Live into a graph-based realtime audio-to-audio conversation system. Unlike ReactAgent, which processes discrete requests, AudioAgent maintains a live WebSocket connection where the model controls the turn-taking and you send audio, text, or images in real-time via an input queue. Tools, memory, and skills are flattened into the initial system instruction and executed during the session without breaking the audio stream.

Use AudioAgent when you need low-latency, continuous audio interaction with live tool execution. The agent maintains conversational state across multiple user and model turns, handles voice-activity detection (VAD) and barge-in automatically, and persists transcripts for compliance or replay.

**Import path:** `tenxgraph.prebuilt.agent`

---

## When to use AudioAgent

AudioAgent is purpose-built for realtime audio-to-audio applications:

- **Voice assistants** with low-latency expectations and live user interruption (barge-in).
- **Customer support on voice channels** where agents need access to tools (calendar, CRM, knowledge base) during calls.
- **Voice-driven data collection** with tools to fetch or validate information in-call.
- **Interactive podcasting or automated interviewing** where the model asks questions and reacts to answers in real-time.

AudioAgent is **not** the right choice if:

- You need periodic, discrete agent invocations (use `ReactAgent` or `Agent` instead).
- Your interaction is text-only and does not require live streaming (use `ReactAgent`).
- Your tools are slow (> 1 second) and would create perceptible delays in audio output (barge-in tolerates tool latency gracefully, but transcription lag will be visible).
- You need to change the system prompt mid-session (AudioAgent flattens it at connect time; activate skills or call memory tools instead).

---

## How AudioAgent works

AudioAgent builds a single-node graph with a `LiveAgent` root, with an edge to END that exists only so the graph is well-formed for `compile()`. The graph is never executed via the normal `invoke()` path; instead, you drive it with `arealtime()` (async generator) or `realtime()` (sync wrapper), which holds a persistent WebSocket and yields events (audio chunks, transcripts, tool calls, errors) as they occur.

### Session flow

1. You create an input queue (`LiveInputQueue`) and call `app.arealtime(queue, config)`.
2. The agent connects to Gemini Live and sends a flattened system instruction (from `system_prompt`, `skills`, and `memory`).
3. For each input (audio frame, text, or image), you push to the queue via `queue.send_audio()`, `queue.send_text()`, or `queue.send_image()`.
4. The agent streams back events: `audio_delta` (model speech), `output_transcript`, tool calls, and status changes.
5. When the user interrupts (barge-in), the agent discards in-flight audio and resumes listening.
6. Close the queue and wait for `turn_complete` to finish the session, or call `app.aclose()` for hard shutdown.

### Tool execution

Tools are advertised to the model at connect time. When the model requests a tool call, the agent executes it through the same `ToolNode` used by ReactAgent, in **parallel** if the model requests multiple tools at once. The tool result is fed back over the WebSocket without breaking the audio stream.

### Transcripts and checkpointing

Audio is never stored to disk. Each completed turn (user or model speech) is saved as a `Message` object with `metadata={"modality": "audio"}` containing the transcription. If you provide a `checkpointer` at compile time, these transcripts and a resumption handle are persisted, allowing you to reconnect and resume the session from that point.

---

## Installation

Install the realtime extra to get the Gemini Live client:

```bash
pip install "10xgraph[realtime]"
```

Set your Google credentials. For the Gemini API:

```bash
export GEMINI_API_KEY=your-api-key
```

For Vertex AI:

```bash
export GOOGLE_GENAI_USE_VERTEXAI=1
# Use standard Application Default Credentials (gcloud auth application-default login)
```

---

## Constructor parameters

AudioAgent accepts most of the same parameters as `ReactAgent`, with provider fixed to Google and the execution model different (realtime vs. request-response).

| Parameter | Type | Default | Description |
|---|---|---|---|
| `model` | `str` | required | Gemini Live model identifier, e.g. `"gemini-live-2.5-flash-preview"`. Only Google models are supported. |
| `realtime_config` | `RealtimeConfig \| None` | `None` | Voice, modalities, VAD, reconnect backoff, and audio format settings. If `None`, a default config is created from the model string. |
| `system_prompt` | `list[dict] \| None` | `None` | List of system-role message dicts (e.g. `[{"role": "system", "content": "..."}]`). Flattened at connect time; supports `{field}` placeholders from state. |
| `tools` | `Iterable[Callable] \| None` | `None` | Tool functions exposed to the model. Can be plain functions or decorated with `@tool`. Executed in parallel during the session. |
| `client` | `Any` | `None` | FastMCP client for remote MCP-hosted tools. |
| `pass_user_info_to_mcp` | `bool` | `False` | Forward `user_id` and `config` to MCP tool calls. |
| `skills` | `SkillConfig \| None` | `None` | Dynamic skills (Agent Skills spec); flattened into system instruction at connect. Activate new skills mid-session via `activate_skill()`. |
| `memory` | `MemoryConfig \| None` | `None` | Long-term semantic memory; loaded once at connect as a fenced `<user_memories_...>` block (see [why](/docs/concepts/memory-and-store#why-memories-are-not-system-text)). Use memory tools to add facts mid-session. |
| `realtime_client_factory` | `Callable[[], RealtimeClient] \| None` | `None` | Override the default Gemini Live client factory. Useful for testing with a mock. |
| `live_node_name` | `str` | `"LIVE"` | Name of the graph node running the `LiveAgent`. Rarely changed. |
| `state` | `AgentState \| None` | `None` | Custom `AgentState` subclass for your domain. |
| `context_manager` | `BaseContextManager \| None` | `None` | Custom context manager (e.g. for trimming across reconnect). |
| `publisher` | `BasePublisher \| list[BasePublisher] \| None` | `None` | Event publishers (Console, Redis, OTEL, etc.) for observability and event replay. |
| `id_generator` | `BaseIDGenerator` | `DefaultIDGenerator()` | Snowflake or custom ID generator for runs and messages. |
| `container` | `Any \| None` | `None` | InjectQ DI container for dependency injection into tools. |

For the full list of `compile()` parameters (checkpointer, store, callback_manager, shutdown_timeout), see [`compile()` parameters](#compile-parameters) below.

---

## `compile()` Parameters

Call `.compile()` on the AudioAgent to produce a `CompiledGraph`:

| Parameter | Type | Default | Description |
|---|---|---|---|
| `checkpointer` | `BaseCheckpointer \| None` | `None` | Persist transcripts and session resumption handles. Enables reconnect and replay. |
| `store` | `BaseStore \| None` | `None` | Long-term cross-thread storage (in addition to memory preload). |
| `callback_manager` | `CallbackManager \| None` | default | Lifecycle hooks and callbacks (register a `GraphLifecycleHook` with `register_lifecycle_hook`). |
| `shutdown_timeout` | `float` | `30.0` | Seconds to wait before forcing shutdown if the WebSocket is stuck. |

AudioAgent does **not** accept `media_store`, `interrupt_before`, or `interrupt_after`. Realtime media (images, video frames) is sent frame-by-frame directly to the model via `LiveInputQueue.send_image()`, there is no media store involvement. Interrupt hooks do not apply to the realtime execution model; use events instead (e.g. listen for `interrupted` or `error` types).


---

## Examples

### Simple text conversation

Start with a text prompt to test the agent's responsiveness. This example shows the basic flow: create the agent, compile it, feed input via a queue, and listen for transcript events.

```python
import asyncio
from tenxgraph.core.realtime.base import RealtimeConfig
from tenxgraph.core.realtime.queue import LiveInputQueue
from tenxgraph.prebuilt.agent import AudioAgent

MODEL = "gemini-live-2.5-flash-preview"

app = AudioAgent(
    MODEL,
    realtime_config=RealtimeConfig(model=MODEL, voice="Puck"),
    system_prompt=[{"role": "system", "content": "You are a concise, helpful voice assistant."}],
).compile()

async def main():
    queue = LiveInputQueue()
    queue.send_text("Hello, what can you help me with?")

    async for event in app.arealtime(queue, {"thread_id": "demo-1"}):
        # Print model output as transcription completes each sentence
        if event.type == "output_transcript" and event.finished:
            print(f"Agent: {event.text}")
        elif event.type == "turn_complete":
            # Session finished; close the queue
            queue.close()

    await app.aclose()

asyncio.run(main())
```

Expected output:
```
Agent: Hello! I'm here to help with any questions or tasks you need assistance with. What would you like to know or do?
```

### Agent with tools

Tools become available to the model immediately at connect time. When the model requests a tool, it is executed during the session and the result is sent back over the audio stream.

```python
import asyncio
from tenxgraph.core.realtime.base import RealtimeConfig
from tenxgraph.core.realtime.queue import LiveInputQueue
from tenxgraph.prebuilt.agent import AudioAgent

MODEL = "gemini-live-2.5-flash-preview"

def get_weather(city: str) -> str:
    """Get the current weather for a city."""
    # In practice, call a real weather API
    return f"Sunny, 24°C in {city}"

app = AudioAgent(
    MODEL,
    realtime_config=RealtimeConfig(model=MODEL, voice="Aoede"),
    system_prompt=[{
        "role": "system",
        "content": "You are a helpful voice assistant. Use the weather tool to answer questions about the weather.",
    }],
    tools=[get_weather],
).compile()

async def main():
    queue = LiveInputQueue()
    queue.send_text("What's the weather in Tokyo?")

    async for event in app.arealtime(queue, {"thread_id": "tools-1"}):
        # Observe tool calls for debugging
        if event.type == "tool_call":
            print(f"[Tool] Calling {event.name}({event.args})")
        elif event.type == "tool_result":
            print(f"[Tool] Result: {event.result}")
        # Listen for the agent's final answer
        elif event.type == "output_transcript" and event.finished:
            print(f"Agent: {event.text}")
        elif event.type == "turn_complete":
            queue.close()

    await app.aclose()

asyncio.run(main())
```

Expected output:
```
[Tool] Calling get_weather({'city': 'Tokyo'})
[Tool] Result: Sunny, 24°C in Tokyo
Agent: The weather in Tokyo is sunny with a temperature of 24 degrees Celsius. It's a beautiful day there!
```

### Persistent sessions with checkpointer

A checkpointer saves the transcript and a resumption handle, allowing you to reconnect later and continue the conversation. This is essential for compliance (call recording) and for graceful reconnect if the network drops.

```python
import asyncio
from tenxgraph.core.realtime.base import RealtimeConfig
from tenxgraph.core.realtime.queue import LiveInputQueue
from tenxgraph.prebuilt.agent import AudioAgent
from tenxgraph.storage.checkpointer import InMemoryCheckpointer

MODEL = "gemini-live-2.5-flash-preview"

# For production, use PgCheckpointer (needs postgres_dsn, redis_url and a user_id in config)
checkpointer = InMemoryCheckpointer()

app = AudioAgent(
    MODEL,
    realtime_config=RealtimeConfig(model=MODEL, voice="Puck"),
    system_prompt=[{"role": "system", "content": "Remember important details the user tells you."}],
).compile(checkpointer=checkpointer)

async def main():
    # First session: establish context
    print("=== Session 1 ===")
    queue = LiveInputQueue()
    queue.send_text("My name is Alex and I work in Berlin.")

    async for event in app.arealtime(queue, {"thread_id": "user-1"}):
        if event.type == "output_transcript" and event.finished:
            print(f"Agent: {event.text}")
        elif event.type == "turn_complete":
            queue.close()

    await app.aclose()

    # Second session: resume with the saved context
    print("\n=== Session 2 (reconnect) ===")
    app2 = AudioAgent(
        MODEL,
        realtime_config=RealtimeConfig(model=MODEL, voice="Puck"),
        system_prompt=[{"role": "system", "content": "Remember important details the user tells you."}],
    ).compile(checkpointer=checkpointer)

    queue = LiveInputQueue()
    queue.send_text("Remind me where I work.")

    async for event in app2.arealtime(queue, {"thread_id": "user-1"}):
        if event.type == "output_transcript" and event.finished:
            print(f"Agent: {event.text}")
        elif event.type == "turn_complete":
            queue.close()

    await app2.aclose()

asyncio.run(main())
```

### Handling user interruption (barge-in)

When the user speaks over the model (barge-in), the agent receives an `interrupted` event. You should discard any buffered audio playback on your client and resume listening for the user's new input.

```python
import asyncio
from tenxgraph.core.realtime.base import RealtimeConfig
from tenxgraph.core.realtime.queue import LiveInputQueue
from tenxgraph.prebuilt.agent import AudioAgent

MODEL = "gemini-live-2.5-flash-preview"

app = AudioAgent(MODEL).compile()

async def main():
    playback_buffer = bytearray()
    queue = LiveInputQueue()
    queue.send_text("Tell me a long story.")

    async for event in app.arealtime(queue, {"thread_id": "barge-1"}):
        if event.type == "audio_delta":
            # Queue audio for playback
            playback_buffer.extend(event.data)
        elif event.type == "interrupted":
            # User spoke over the model; discard pending audio
            print("[Interrupt] Flushing audio buffer")
            playback_buffer.clear()
        elif event.type == "turn_complete":
            # Play remaining buffer and close
            print(f"[Done] Playback {len(playback_buffer)} bytes")
            queue.close()

    await app.aclose()

asyncio.run(main())
```

### Voice activity detection and push-to-talk

By default, the agent uses voice-activity detection (VAD) to automatically detect when the user stops speaking. For applications that need manual control (push-to-talk style), disable VAD and signal activity boundaries explicitly.

```python
import asyncio
from tenxgraph.core.realtime.base import RealtimeConfig, VADConfig
from tenxgraph.core.realtime.queue import LiveInputQueue
from tenxgraph.prebuilt.agent import AudioAgent

MODEL = "gemini-live-2.5-flash-preview"

config = RealtimeConfig(
    model=MODEL,
    vad=VADConfig(enabled=False),  # Disable automatic detection
)
app = AudioAgent(MODEL, realtime_config=config).compile()

async def main():
    queue = LiveInputQueue()

    # Simulate push-to-talk: signal start of user activity
    queue.send_activity_start()

    # Send audio (e.g., from microphone or WAV file)
    # pcm_bytes = read_audio_samples()  # 16-bit PCM, 16 kHz mono
    pcm_bytes = b"\x00" * 16000  # 1 second of silence for demo
    queue.send_audio(pcm_bytes, sample_rate=16000)

    # Signal end of user activity
    queue.send_activity_end()

    async for event in app.arealtime(queue, {"thread_id": "ptt-1"}):
        if event.type == "output_transcript" and event.finished:
            print(f"Agent: {event.text}")
        elif event.type == "turn_complete":
            queue.close()

    await app.aclose()

asyncio.run(main())
```

---

## Configuration: RealtimeConfig

When you create an AudioAgent, you can customize the realtime session with `RealtimeConfig`. Most options affect audio codec, voice selection, and reconnect behavior.

| Field | Type | Default | Description |
|---|---|---|---|
| `model` | `str` | required | Gemini Live model name (e.g. `"gemini-live-2.5-flash-preview"`). |
| `voice` | `str \| None` | `None` | Voice to use for model output. Examples: `"Puck"` (neutral), `"Aoede"` (calm), `"Charon"` (expressive). Omit for the provider's default. |
| `response_modalities` | `list[str]` | `["AUDIO"]` | Output modality. Must be exactly one of `["AUDIO"]` or `["TEXT"]`. |
| `system_instruction` | `str \| None` | `None` | Direct system instruction string. Overridden by `system_prompt` / `skills` / `memory` if provided. |
| `input_audio_transcription` | `bool` | `True` | Emit `input_transcript` events for user speech. Disable to save bandwidth if you don't need transcriptions. |
| `output_audio_transcription` | `bool` | `True` | Emit `output_transcript` events for model speech. Disable to reduce event volume. |
| `vad` | `VADConfig` | enabled | Voice-activity detection config. Set `VADConfig(enabled=False)` for push-to-talk mode. |
| `session_resumption` | `bool` | `True` | Allow the provider to issue a resumption handle on reconnect. Disable only if you never reconnect. |
| `context_window_compression` | `bool` | `False` | Ask Gemini to compress its context window (internal optimization). Rarely needed. |
| `reconnect` | `ReconnectConfig` | see below | Backoff policy for automatic reconnects on transient errors. |
| `tools_tags` | `list[str] \| None` | `None` | Filter which tools are advertised to the model by tag (e.g. `["search", "calendar"]` to exclude others). |

**ReconnectConfig:** Controls exponential backoff for automatic reconnects. Defaults: `base_delay=0.5` sec, `max_delay=10.0` sec, `max_attempts=5`. Provider-initiated `go_away` rotations always reconnect immediately (no backoff).

---

## Event reference

The `arealtime()` generator yields events as they occur during the session. Listen for specific types based on your use case.

| Event type | Field name | When emitted | How to use |
|---|---|---|---|
| `audio_delta` | `data: bytes`, `sample_rate: int` | Model is speaking. Chunks arrive as 24 kHz PCM16. | Buffer for playback; watch for `interrupted` to flush. |
| `input_transcript` | `text: str`, `finished: bool` | User speech is transcribed. `finished=True` = complete turn. | Log or display user input in real-time; `finished=True` = final turn. |
| `output_transcript` | `text: str`, `finished: bool` | Model speech is transcribed. `finished=True` = complete turn. | Log or display agent output in real-time; `finished=True` = final turn. |
| `tool_call` | `name: str`, `args: dict` | Model requested a tool. | Observability only; the agent executes it automatically. |
| `tool_result` | `result: str \| dict` | Tool execution finished. | Observability; result was sent back to the model. |
| `turn_complete` | - | Model finished a turn. | Safe point to close queue or prompt for next input. |
| `interrupted` | - | User spoke over model (barge-in). | Flush audio playback buffer; resume listening for new user input. |
| `session_update` | `resumption_handle: str` | Provider issued a resumption handle. | Save it if you want to reconnect later (use a checkpointer). |
| `go_away` | - | Provider closing socket (rotation or error). | Reconnect is triggered automatically; no action needed. |
| `error` | `message: str`, `fatal: bool` | Transient or fatal error. | Log it; if `fatal=True`, the session ended. |

---

## Reference and related guides

- **Full parameter table:** [`prebuilt-agents` reference](/docs/reference/python/prebuilt-agents) lists every parameter for AudioAgent and other prebuilt agents.
- **Realtime API reference:** [`realtime` reference](/docs/reference/python/realtime) covers `RealtimeConfig`, `VADConfig`, `ReconnectConfig`, `LiveInputQueue`, event types, and `RealtimeClient`.
- **Step-by-step guide:** [Use realtime audio](/docs/guides/use-realtime-audio) shows how to wire AudioAgent into a microphone or WAV file pipeline, build a WebSocket bridge for the API server, and set up resilient reconnect.
- **Testing:** See [Testing](/docs/testing/unit-tests) for how to mock a realtime client in unit tests.

## Run it in production

Audio runs over a long-lived connection, so authenticate the socket and rate limit it. See [WebSockets](/docs/server/websockets) and [Server auth](/docs/server/auth).
