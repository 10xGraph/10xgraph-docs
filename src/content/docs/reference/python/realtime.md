---
title: Realtime audio
seoTitle: Realtime audio API reference (Python)
description: Python API reference for live audio-to-audio agent sessions with Gemini Live, including AudioAgent, RealtimeConfig, LiveInputQueue and RealtimeEvent.
section: Reference
group: Python library
order: 100
label: Realtime
updated: "2026-10-29"
---

This page is the Python API reference for live audio-to-audio sessions backed by Gemini Live: `AudioAgent`, `arealtime()`, `LiveInputQueue`, the config objects, and the `RealtimeEvent` types. Realtime is a separate runtime from `invoke` and `stream`, where the provider drives each turn. Install it with `pip install "10xgraph[realtime]"`. The matching server WebSocket route is covered in [Live WebSocket](/docs/reference/rest-api/live).

The provider owns the turn loop. 10xGraph adds input queueing, tool dispatch, transcript persistence, and automatic reconnection around it. The provider SDK is imported lazily, so importing `tenxgraph.core.realtime` does not require the extra.

## Import paths

Everything except `AudioAgent` and the sample-rate constants is exported from `tenxgraph.core.realtime`.

```python
from tenxgraph.core.realtime import (
    # Input queue
    LiveInputQueue, LiveInput, LiveInputKind,
    # Config types
    RealtimeConfig, VADConfig, ReconnectConfig,
    # Event union and all event classes
    RealtimeEvent,
    AudioDeltaEvent, InputTranscriptEvent, OutputTranscriptEvent,
    ToolCallEvent, ToolResultEvent, TurnCompleteEvent, InterruptedEvent,
    SessionUpdateEvent, GoAwayEvent, AgentChangedEvent, ErrorEvent,
    # Provider client (Gemini)
    RealtimeClient, GeminiLiveClient, normalize_message,
)

from tenxgraph.prebuilt.agent import AudioAgent
from tenxgraph.core.realtime.base import INPUT_SAMPLE_RATE, OUTPUT_SAMPLE_RATE
```

Audio formats: `INPUT_SAMPLE_RATE = 16000` Hz (PCM16), `OUTPUT_SAMPLE_RATE = 24000` Hz (PCM16).

## AudioAgent

`AudioAgent` is the prebuilt builder for realtime audio-to-audio sessions. It mirrors `ReactAgent`, but wraps a `LiveAgent` as the graph root and is driven by `CompiledGraph.arealtime()` instead of `invoke` or `stream`. Only Gemini Live is supported. For a walkthrough, see [Audio agent](/docs/guides/prebuilt/audio-agent).

```python title="audio_session.py"
import asyncio

from tenxgraph.core.realtime import LiveInputQueue
from tenxgraph.prebuilt.agent import AudioAgent


def get_time() -> str:
    """Return the current time as a string."""
    from datetime import datetime

    return datetime.now().isoformat(timespec="seconds")


agent = AudioAgent(
    model="gemini-2.5-flash",  # use the Gemini Live model your account has access to
    system_prompt=[{"role": "system", "content": "You are a helpful assistant."}],
    tools=[get_time],
)
app = agent.compile()


async def main() -> None:
    queue = LiveInputQueue()
    queue.send_text("What time is it?")
    queue.close()  # closing the queue ends the session once the provider goes idle

    async for event in app.arealtime(queue, config={"thread_id": "demo"}):
        if event.type == "output_transcript" and event.finished:
            print("Model:", event.text)
        elif event.type == "error":
            print("Error:", event.message)


asyncio.run(main())
```

Set `GEMINI_API_KEY` or `GOOGLE_API_KEY` before running.

### Constructor

```python
AudioAgent(
    model: str,
    state: StateT | None = None,
    context_manager: BaseContextManager | None = None,
    publisher: BasePublisher | list[BasePublisher] | None = None,
    id_generator: BaseIDGenerator = DefaultIDGenerator(),
    container: Any | None = None,
    *,
    realtime_config: RealtimeConfig | None = None,
    system_prompt: list[dict[str, Any]] | None = None,
    tools: Iterable[Callable] | None = None,
    client: Any = None,
    pass_user_info_to_mcp: bool = False,
    skills: SkillConfig | None = None,
    memory: MemoryConfig | None = None,
    realtime_client_factory: Callable[[], RealtimeClient] | None = None,
    live_node_name: str = "LIVE",
    **agent_kwargs: Any,
)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `model` | str | Required | Gemini Live model name. The provider is detected from the name (an optional `gemini/` prefix works); any provider other than Google raises `ValueError`. |
| `state` | `StateT \| None` | None | Initial `AgentState` subclass instance. |
| `context_manager` | `BaseContextManager \| None` | None | Context trimming or summarization manager. |
| `publisher` | `BasePublisher \| list[BasePublisher] \| None` | None | One publisher or a list of them. |
| `id_generator` | `BaseIDGenerator` | `DefaultIDGenerator()` | ID generator for thread, run, and message IDs. |
| `container` | `Any \| None` | None | InjectQ container for dependency injection isolation. |
| `realtime_config` | `RealtimeConfig \| None` | None | Per-session config overrides; defaults to `RealtimeConfig(model=model)`. |
| `system_prompt` | `list[dict[str, Any]] \| None` | None | System prompt dicts with `role` and `content` keys. |
| `tools` | `Iterable[Callable] \| None` | None | Callable tools advertised to the provider. |
| `client` | `Any \| None` | None | MCP client (fastmcp or mcp module). |
| `pass_user_info_to_mcp` | bool | False | Forward run's user identity to MCP tool calls. |
| `skills` | `SkillConfig \| None` | None | Dynamic skill injection config. |
| `memory` | `MemoryConfig \| None` | None | Long-term memory config. |
| `realtime_client_factory` | `Callable[[], RealtimeClient] \| None` | None | Custom provider client factory (for testing or pre-auth). |
| `live_node_name` | str | "LIVE" | Name of the internal `LiveAgent` node. |
| `**agent_kwargs` | Any | none | Forwarded to the underlying `LiveAgent`. `api_key`, `use_vertex_ai`, `project` and `location` configure the Gemini client; the rest go to the base agent. |

Returns: an `AudioAgent` instance.

A `ToolNode` is created only if `tools` or `client` is provided. The graph has a single node (named by `live_node_name`) that owns the whole session loop.

For Vertex AI, pass `use_vertex_ai=True` and set `GOOGLE_CLOUD_PROJECT` (or pass `project=`); `GOOGLE_CLOUD_LOCATION` defaults to `us-central1`.

### compile()

```python
def compile(
    self,
    checkpointer: BaseCheckpointer | None = None,
    store: BaseStore | None = None,
    callback_manager: CallbackManager | None = None,
    shutdown_timeout: float = 30.0,
) -> CompiledGraph
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `checkpointer` | `BaseCheckpointer \| None` | None | Persistence layer for thread state and resumption. |
| `store` | `BaseStore \| None` | None | Long-term memory store. |
| `callback_manager` | `CallbackManager \| None` | None | Lifecycle hooks (on_graph_start, on_turn_end, etc.). |
| `shutdown_timeout` | float | 30.0 | Seconds to wait for graceful shutdown. |

Returns: a `CompiledGraph` ready to drive with `arealtime()` or `realtime()`. Unlike `ReactAgent.compile()`, it does not accept `media_store`, `interrupt_before` or `interrupt_after`. Images and video go frame by frame through `LiveInputQueue.send_image`.


## CompiledGraph.arealtime() / realtime()

`arealtime()` runs a realtime session and yields normalized events. `realtime()` is a synchronous wrapper for code with no running event loop. The session ends when the input queue is closed and the provider goes idle, or on a fatal error. Every `arealtime()` connection runs on its own copy of the `LiveAgent` (made with `LiveAgent.new_session()`), so concurrent sessions on one compiled graph do not share a client, resume handle or transcript buffers.

```python
async def arealtime(
    input_queue: LiveInputQueue,
    config: dict[str, Any] | None = None,
    state: AgentState | None = None,
) -> AsyncIterator[RealtimeEvent]

def realtime(
    input_queue: LiveInputQueue,
    config: dict[str, Any] | None = None,
    state: AgentState | None = None,
) -> Generator[RealtimeEvent]
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `input_queue` | `LiveInputQueue` | Required | Input queue fed by audio/text/control frames. |
| `config` | `dict[str, Any] \| None` | None | Runtime config: `thread_id`, `user_id`, and `realtime`, a dict of `RealtimeConfig` field overrides for this session (unknown keys and `None` values are ignored; the merged result is re-validated). |
| `state` | `AgentState \| None` | None | Initial state. Falls back to the state given to `AudioAgent`, then an empty `AgentState`. |

**Yields:** `RealtimeEvent` objects (audio chunks, transcripts, tool calls, errors).

**Raises:**

- `RuntimeError` if the graph contains no `LiveAgent`, or more than one.
- `RuntimeError` if `realtime()` is called from a running event loop (use `arealtime()` instead).

Calling `invoke` or `stream` on a graph that contains a `LiveAgent` also raises `RuntimeError`.


## LiveInputQueue

Non-blocking input queue for audio, text, and control frames. Synchronous `send_*` methods allow producers to feed frames from any thread without blocking (e.g., audio capture callbacks).

```python title="input_queue.py"
from tenxgraph.core.realtime import LiveInputQueue

queue = LiveInputQueue(maxsize=100)
queue.send_audio(b"\x00\x00" * 1600, sample_rate=16000)  # 100 ms of PCM16 silence
queue.send_text("Hello")
queue.send_activity_end()  # Manual VAD only: mark end of user turn
queue.close()


async def drain() -> None:
    async for frame in queue:  # yields LiveInput frames until the close sentinel
        print(frame.kind, frame.sample_rate)
```

### Constructor

```python
LiveInputQueue(maxsize: int = 0)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `maxsize` | int | 0 | Queue size. `0` means unbounded. A full queue drops new frames and logs a warning. |

The read-only property `closed: bool` is `True` once `close()` has been called.

### Methods

| Method | Signature | Description |
|---|---|---|
| `send_audio` | `(data: bytes, sample_rate: int = 16000) -> None` | Enqueue PCM16 audio chunk. |
| `send_text` | `(text: str) -> None` | Inject text turn. |
| `send_image` | `(data: bytes, mime_type: str = "image/jpeg") -> None` | Send image or video frame. |
| `send_activity_start` | `() -> None` | Manual VAD: mark start of user speech. Use when `vad.enabled=False`. |
| `send_activity_end` | `() -> None` | Manual VAD: mark end of user speech. Pairs with `send_activity_start`. |
| `close` | `() -> None` | Signal end of input. Idempotent; enqueues a `close` sentinel. Later sends are dropped silently. |


## LiveInput

`LiveInput` is the dataclass for a single frame enqueued by the `send_*` methods. You normally do not construct it directly.

```python
@dataclass(slots=True)
class LiveInput:
    kind: LiveInputKind  # "audio" | "text" | "image" | "activity_start" | "activity_end" | "close"
    data: bytes | None = None
    text: str | None = None
    sample_rate: int = 16000  # INPUT_SAMPLE_RATE
    mime_type: str | None = None
```

| Field | Type | Default | Notes |
|---|---|---|---|
| `kind` | `LiveInputKind` | Required | Frame type discriminator. |
| `data` | `bytes \| None` | None | Audio or image bytes (only set for `"audio"`, `"image"`). |
| `text` | `str \| None` | None | Text content (only set for `"text"`). |
| `sample_rate` | int | 16000 | Sample rate for audio frames. |
| `mime_type` | `str \| None` | None | MIME type for image frames. |


## RealtimeConfig

`RealtimeConfig` is the per-session configuration passed to the provider client at connect time. It is a Pydantic model; pass it to `AudioAgent(realtime_config=...)`.

```python title="realtime_config.py"
from tenxgraph.core.realtime import RealtimeConfig, VADConfig

config = RealtimeConfig(
    model="gemini-2.5-flash",
    response_modalities=["AUDIO"],
    voice="Puck",
    vad=VADConfig(enabled=True),
)
```

### Constructor

```python
RealtimeConfig(
    model: str,
    response_modalities: list[Literal["AUDIO", "TEXT"]] = ["AUDIO"],
    voice: str | None = None,
    system_instruction: str | None = None,
    input_audio_transcription: bool = True,
    output_audio_transcription: bool = True,
    vad: VADConfig = VADConfig(),
    reconnect: ReconnectConfig = ReconnectConfig(),
    context_window_compression: bool = False,
    session_resumption: bool = True,
    tools: list[Any] | None = None,
    tools_tags: list[str] | None = None,
)
```

| Field | Type | Default | Description |
|---|---|---|---|
| `model` | str | Required | Gemini Live model string. |
| `response_modalities` | `list[Literal["AUDIO", "TEXT"]]` | `["AUDIO"]` | Exactly one modality per session (validated). Use `["TEXT"]` for text-only. |
| `voice` | `str \| None` | None | Provider voice name (e.g. `"Puck"`, `"Breeze"`). Provider default when None. |
| `system_instruction` | `str \| None` | None | System instruction fixed at connect time. Used only when `AudioAgent.system_prompt` is empty. |
| `input_audio_transcription` | bool | True | Enable provider-side transcription of user speech. |
| `output_audio_transcription` | bool | True | Enable provider-side transcription of model speech. |
| `vad` | `VADConfig` | `VADConfig()` | Voice-activity detection settings. |
| `reconnect` | `ReconnectConfig` | `ReconnectConfig()` | Reconnect/backoff policy for drops. |
| `context_window_compression` | bool | False | Enable provider-side context compression. |
| `session_resumption` | bool | True | Use provider resumption handles. Loading and saving a handle across sessions requires a checkpointer and `thread_id`. |
| `tools` | `list[Any] \| None` | None | Override auto-derived tool schemas. |
| `tools_tags` | `list[str] \| None` | None | Filter tools by tag. |

**Validation:** `response_modalities` must contain exactly one entry; `["AUDIO", "TEXT"]` raises `ValueError`.


## VADConfig

`VADConfig` holds voice-activity detection settings. Disable it for push-to-talk workflows and drive turns with `send_activity_start` and `send_activity_end`.

```python title="vad_config.py"
from tenxgraph.core.realtime import VADConfig

vad = VADConfig(
    enabled=False,  # Manual VAD
    start_sensitivity="HIGH",
)
```

### Constructor

```python
VADConfig(
    enabled: bool = True,
    start_sensitivity: str | None = None,
    end_sensitivity: str | None = None,
    prefix_padding_ms: int | None = None,
    silence_duration_ms: int | None = None,
)
```

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | bool | True | Automatic VAD. Set False for manual push-to-talk via `send_activity_start`/`end`. |
| `start_sensitivity` | `str \| None` | None | Provider-neutral hint (mapped per provider). None = provider default. |
| `end_sensitivity` | `str \| None` | None | Provider-neutral hint. None = provider default. |
| `prefix_padding_ms` | `int \| None` | None | Audio prepended before detected speech onset. |
| `silence_duration_ms` | `int \| None` | None | Silence duration triggering end-of-speech detection. |


## ReconnectConfig

`ReconnectConfig` sets the reconnect and exponential backoff policy for dropped sessions. All three fields must be zero or greater.

```python title="reconnect_config.py"
from tenxgraph.core.realtime import ReconnectConfig

reconnect = ReconnectConfig(
    base_delay=1.0,
    max_delay=30.0,
    max_attempts=10,
)
```

### Constructor

```python
ReconnectConfig(
    base_delay: float = 0.5,
    max_delay: float = 10.0,
    max_attempts: int = 5,
)
```

| Field | Type | Default | Description |
|---|---|---|---|
| `base_delay` | float | 0.5 | Base delay in seconds for exponential backoff. |
| `max_delay` | float | 10.0 | Maximum delay cap in seconds. |
| `max_attempts` | int | 5 | Maximum error-driven reconnect attempts. Set 0 to disable. |

**Reconnect rules:**

- `go_away` (provider-initiated rotation): reconnect immediately, attempts counter not incremented.
- Transient drop / receive error: attempt `n` waits `min(base_delay * 2^(n-1), max_delay)` seconds, up to `max_attempts`. After cap, fatal `ErrorEvent(code="reconnect_failed")` is emitted.
- Any successful receive resets attempts counter to 0.


## RealtimeEvent

`RealtimeEvent` is a discriminated union of event types keyed on the `type` field. Every event is a Pydantic model, and `arealtime()` yields them in provider order.

```python title="handle_events.py"
from tenxgraph.core.realtime import RealtimeEvent

async for event in app.arealtime(queue):
    if event.type == "audio_delta":
        speaker.write(event.data)
    elif event.type == "input_transcript":
        print(f"User: {event.text}" if event.finished else f"User (partial): {event.text}")
    elif event.type == "error":
        if event.fatal:
            break
```

### AudioDeltaEvent

```python
type: Literal["audio_delta"]
data: bytes        # PCM16 chunk
sample_rate: int   # 24000
```

Model audio output (PCM16). Write it to a speaker or file.

### InputTranscriptEvent

```python
type: Literal["input_transcript"]
text: str
finished: bool     # True on final chunk
```

The user's speech transcript. Chunks arrive with `finished=False`, then the finished marker. The runtime turns the accumulated transcript into a message on the finished marker.

### OutputTranscriptEvent

```python
type: Literal["output_transcript"]
text: str
finished: bool
```

Model's speech transcript. Same streaming/finished semantics as `InputTranscriptEvent`.

### ToolCallEvent

```python
type: Literal["tool_call"]
id: str
name: str
args: dict[str, Any]
```

Provider requests tool invocation. 10xGraph dispatches automatically via `ToolNode`.

### ToolResultEvent

```python
type: Literal["tool_result"]
id: str
result: Any
```

Tool execution finished. Result already sent to model.

### TurnCompleteEvent

```python
type: Literal["turn_complete"]
```

Model finished generating a turn (audio and transcription complete).

### InterruptedEvent

```python
type: Literal["interrupted"]
```

Barge-in: the user spoke while the model was talking. Flush any queued playback.

### SessionUpdateEvent

```python
type: Literal["session_update"]
resumption_handle: str | None
```

Provider issued a session-resumption handle. Stored in checkpointer thread metadata automatically.

### GoAwayEvent

```python
type: Literal["go_away"]
time_left: str | None    # Provider duration string, e.g. "5s"
```

Provider will close socket soon (planned rotation). Runtime reconnects automatically with cached resumption handle.

### AgentChangedEvent

```python
type: Literal["agent_changed"]
author: str
```

The active agent or persona changed. Reserved for a future multi-agent persona swap; the single-agent runtime does not emit it.

### ErrorEvent

```python
type: Literal["error"]
code: str | None
message: str
fatal: bool
```

Normalized provider error. Non-fatal errors are transient (session continues). Fatal errors (`fatal=True`) end session. `code="reconnect_failed"` means reconnect attempts exhausted.


## RealtimeClient (Protocol)

`RealtimeClient` is the provider-neutral, runtime-checkable protocol that every realtime provider client implements. Application code rarely uses it directly; use `AudioAgent` instead, and implement this protocol only to supply a custom or fake client.

```python
from tenxgraph.core.realtime import RealtimeClient
```

| Method | Signature | Description |
|---|---|---|
| `connect` | `async (config: RealtimeConfig, resume_handle: str \| None = None) -> None` | Open provider socket. |
| `send_audio` | `async (pcm: bytes, sample_rate: int) -> None` | Send PCM16 audio input. |
| `send_text` | `async (text: str) -> None` | Send text turn. |
| `send_image` | `async (data: bytes, mime_type: str) -> None` | Send image frame. |
| `send_activity_start` | `async () -> None` | Manual VAD: start marker. |
| `send_activity_end` | `async () -> None` | Manual VAD: end marker. |
| `send_tool_response` | `async (call_id: str, name: str, result: Any) -> None` | Return tool result to model. |
| `reseed_history` | `async (messages: list[Any]) -> None` | Seed conversation history into fresh session. |
| `receive` | `() -> AsyncIterator[RealtimeEvent]` | Yield normalized events from provider. |
| `close` | `async () -> None` | Close socket. Safe to call multiple times. |

### GeminiLiveClient

`GeminiLiveClient` implements `RealtimeClient` for Gemini Live. `LiveAgent` creates one per connection by default, so you only need it to customize how the client is built.

```python
from tenxgraph.core.realtime import GeminiLiveClient, normalize_message

from tenxgraph.prebuilt.agent import AudioAgent


# Inject a custom client per connection (for tests or pre-built credentials).
def client_factory() -> GeminiLiveClient:
    return GeminiLiveClient(api_key="YOUR_API_KEY")  # placeholder, load from your secret store


app = AudioAgent("gemini-2.5-flash", realtime_client_factory=client_factory).compile()
```

The constructor is `GeminiLiveClient(client=None, *, connector=None, api_key=None, use_vertex_ai=False, project=None, location=None, connect_timeout=30.0)`. `connect_timeout` is the number of seconds to wait for the live connection to open; pass `None` to wait without a limit. Only the connect is bounded, never the session. A timeout raises `TimeoutError("Gemini Live connect timed out after ...s")`. This applies to the first connect and to each reconnect. Without `api_key`, it reads `GEMINI_API_KEY` or `GOOGLE_API_KEY`.

`normalize_message(message)` maps a Google `LiveServerMessage` (the SDK object, not a dict) to a `list[RealtimeEvent]` in wire order.


### Tool call deduplication

A realtime tool call runs at most once per thread. Before running a tool, `LiveAgent` looks up the call in the same tool ledger the text path uses, in the run's checkpointer. The key is made of the thread id (the session id when there is no thread id), a hash of the tool name and arguments, and the provider's call id. If the key already has a recorded result, the tool does not run again and the recorded result is sent back to the model.

This covers a call that the provider re-sends after a reconnect, and a call that a new session on the same thread repeats. Pairing the call id with the call's content means a provider that reuses an id for a different call in a later session does not skip the new call. The dedupe needs a checkpointer on the session; without one, or when the provider sends no call id, every call runs. See [Replay-safe tools](/docs/concepts/replay-safe-tools).

## Lifecycle hooks

Realtime sessions fire `GraphLifecycleHook` methods: the session acts as the graph run, and each model turn fires turn hooks. Register a hook with `CallbackManager.register_lifecycle_hook()` and pass the manager to `compile()`.

```python title="lifecycle_hooks.py"
from tenxgraph.utils.callbacks import CallbackManager, GraphLifecycleHook

class MyHook(GraphLifecycleHook):
    async def on_graph_start(self, context, state):
        print("Session started")
        return None  # None keeps the current state

    async def on_turn_end(self, context, state, turn_index):
        print(f"Turn {turn_index} complete")
        return None

cb = CallbackManager()
cb.register_lifecycle_hook(MyHook())
app = AudioAgent("gemini-2.5-flash").compile(callback_manager=cb)
```

| Hook | When | Notes |
|---|---|---|
| `on_graph_start` | Once, before first turn | Session opened. |
| `on_graph_end` | Once, when the session ends | Signature `(context, final_state, messages, total_steps)`; `total_steps` is the number of turns. |
| `on_turn_start` | On the first content event of a turn | `turn_index` is 1-based. |
| `on_turn_end` | After `turn_complete` or `interrupted` | Same `turn_index` as the matching start. |

`on_turn_start` and `on_turn_end` fire only in realtime sessions, never for `invoke` or `stream`. See [Lifecycle callbacks](/docs/reference/python/lifecycle-callbacks) for the full hook list.


## API server integration

The API server exposes the WebSocket route `/v1/graph/live` for graphs that contain a `LiveAgent`. The frame protocol, auth and close codes are documented in [Live WebSocket](/docs/reference/rest-api/live), and the connection settings in [WebSockets](/docs/server/websockets).


## Common errors

| Error | Cause | Fix |
|---|---|---|
| `ImportError: google-genai SDK is required for Gemini realtime` | Extra not installed. | `pip install "10xgraph[realtime]"`. |
| `ValueError: Gemini realtime requires credentials` | No API key found. | Set `GEMINI_API_KEY` or `GOOGLE_API_KEY`, pass `api_key=`, or use `use_vertex_ai=True` with `GOOGLE_CLOUD_PROJECT`. |
| `ValueError: LiveAgent v1 supports only Gemini Live (google provider)` | Model resolved to a non-Google provider. | Use a Gemini model name, optionally prefixed with `"gemini/"`. |
| `RuntimeError: This graph contains a LiveAgent; use .arealtime() / .realtime()...` | Called `invoke`/`stream` on realtime graph. | Switch to `arealtime()` or `realtime()`. |
| `RuntimeError: arealtime() requires a graph rooted at a LiveAgent` | No `LiveAgent` in the graph. | Build the graph with `AudioAgent`. |
| `RuntimeError: This LiveAgent already runs a session` | You called `LiveAgent.arun()` a second time on one instance while its first session was still running. | Use `LiveAgent.new_session()` to get a fresh copy for each concurrent session. `arealtime()` does this for you. |
| `RuntimeError: realtime() (sync) cannot be called from a running event loop` | Called `realtime()` in async context. | Use `await arealtime()` instead. |
| `ValueError: response_modalities must contain exactly one modality` | Passed two modalities. | Pass `["AUDIO"]` or `["TEXT"]`, not both. |
| `ErrorEvent(code="reconnect_failed", fatal=True)` | Reconnect attempts exhausted. | Check network; increase `max_attempts` or `max_delay`. |
