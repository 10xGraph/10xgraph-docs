---
title: Live WebSocket endpoint
description: "Reference for WS /v1/graph/live: real-time audio WebSocket bridge for LiveAgent graphs. Init frame, binary and JSON frames, authentication, close codes."
section: Reference
group: "REST API"
order: 320
label: Live WebSocket
updated: "2026-11-25"
---

`WS /v1/graph/live` is a WebSocket bridge between a client (browser, SDK, native app) and a `CompiledGraph` rooted at a `LiveAgent` (built with `AudioAgent`).

The route accepts only a graph rooted at a `LiveAgent`; any other graph gets a fatal `not_live` event and close `1008`. It is not mounted when `websocket.enabled` is `false`. Check `info.is_realtime` on `GET /v1/graph` to decide which socket to open.

---

## Authentication

Auth is the same as for [WS /v1/graph/ws](/docs/reference/rest-api/conventions#authentication); permission `graph:stream`. An auth failure closes with `1008` before `accept()`.

The token is checked again after the init frame and every 30 seconds; on failure the server sends a fatal `session_expired` event and closes with `1008`. Reconnect with a fresh token.

---

## Connection limits

Handshake limits (`cache_store.rate_limit`, `websocket.max_connections`, `websocket.max_connections_per_user`) are described in [WebSockets](/docs/server/websockets#rate-limiting-and-concurrency). A refusal closes with `1013` before `accept()`.

---

## Init frame (client -> server, first frame)

The first frame from the client must be a JSON text frame. It configures the session and optionally overrides the agent's build-time `RealtimeConfig` values. All fields are optional. `voice`, `modalities` and `vad` apply by default; others per `websocket.realtime_client_overrides`.

```json title="init frame"
{
  "thread_id": "session-001",
  "model": "gemini-3.8-live",
  "voice": "Puck",
  "modalities": ["AUDIO"],
  "system_prompt": "You are a terse voice assistant.",
  "tools_tags": ["weather"],
  "vad": {
    "enabled": true
  }
}
```

| Field | Type | Maps to | Description |
|---|---|---|---|
| `thread_id` | string | (none) | Thread identifier for persistence and resume. Reuse to resume a previous session. `"new"`, blank or missing starts a fresh thread. |
| `model` | string | `RealtimeConfig.model` | Override the live model. Honored only if listed in `websocket.realtime_models`; otherwise it is ignored and the agent's own model is used. |
| `voice` | string | `RealtimeConfig.voice` | Override the voice (e.g. `"Puck"`). |
| `modalities` | array or string | `RealtimeConfig.response_modalities` | Override the response modalities. Exactly one entry; `["AUDIO"]` or `["TEXT"]`. A bare string (`"AUDIO"`) is coerced to a one-element list. |
| `system_prompt` | string | `RealtimeConfig.system_instruction` | Applied only when `system_prompt` is listed in `websocket.realtime_client_overrides` (off by default); otherwise ignored. |
| `tools_tags` | array | `RealtimeConfig.tools_tags` | Narrow the tools exposed to this session by tag. It can only narrow the agent's own tag filter, never widen it; tags outside that filter are dropped. |
| `vad` | object | `RealtimeConfig.vad` | Override `VADConfig` fields for this session. |

Fields not present in the init frame keep the agent's compiled values. An invalid init frame (not JSON, or JSON that is not an object) closes the socket with code `1003`.

**Thread handling.** `thread_id` is optional. When it is absent, blank or `"new"` the server generates an id for the session and persists the thread record before the first event is pumped; the generated id is sent in the `session_started` event, so a client that needs to resume later keeps it and sends it back. With the default `runs.thread_ids` of `server`, an id the server never issued is refused like a thread owned by someone else. Set `runs.thread_ids` to `client` to let the caller name a new thread. A `thread_id` the caller cannot run on (another user's, or unknown under `runs.thread_ids: server`) is refused with a fatal `THREAD_NOT_FOUND` error event and close code `1008`.

---

## Upstream frames (client -> server)

After the init frame, the client sends a mix of binary audio frames and JSON control frames.

### Binary frame: audio input

Raw PCM16 audio at 16 kHz, mono. Each frame is forwarded to `LiveInputQueue.send_audio()`.

```text
Frame: <binary PCM16 bytes>
Format: 16-bit signed integer, little-endian, mono, 16000 Hz
```

100 ms chunks (~3200 bytes) are a typical packet size. There is no minimum, but the bridge enforces three bounds because WebSocket frames never pass through the HTTP request-size middleware:

| Bound | Value | Behaviour when exceeded |
|---|---|---|
| Maximum single frame | 1 MiB (`REALTIME_MAX_FRAME_BYTES`) | The frame is dropped and a warning is logged. The session continues; no error event is sent. |
| Upstream queue depth | 1000 frames (`REALTIME_INPUT_QUEUE_MAXSIZE`) | The oldest queued frame is dropped to make room. |
| Buffered input per session | 16 MiB (`REALTIME_INPUT_QUEUE_MAX_BYTES`) | A frame that would push the buffered input past the budget is dropped and a warning is logged. The session continues; no error event is sent. |

### JSON control frames

Send a JSON text frame with a `type` field to inject non-audio input.

**Text turn**

```json
{"type": "text", "text": "What is the weather in Paris?"}
```

Injects a text turn as user input. The model responds in audio (or text if modality is `"TEXT"`).

**Manual VAD: activity start**

```json
{"type": "activity_start"}
```

Signals the start of user speech. Only meaningful when `vad.enabled=false` (push-to-talk). The model will not respond until `activity_end` is received.

**Manual VAD: activity end**

```json
{"type": "activity_end"}
```

Signals the end of user speech.

**Close**

```json
{"type": "close"}
```

Ends the session gracefully. The server closes the input queue and gives the model up to 30 seconds (`REALTIME_DRAIN_TIMEOUT`) to drain its in-flight response before cancelling and closing the socket. The same grace period applies when the client simply disconnects.

---

## Downstream frames (server -> client)

The server sends a mix of binary audio frames and JSON event frames.

### Binary frame: audio output

Raw PCM16 model audio at 24 kHz, mono. Corresponds to `AudioDeltaEvent`.

```text
Frame: <binary PCM16 bytes>
Format: 16-bit signed integer, little-endian, mono, 24000 Hz
```

### JSON event frames

All `RealtimeEvent` types other than `audio_delta` are serialized to JSON text frames. The `type` field discriminates the event.

**Session started**

```json
{"type": "session_started", "thread_id": "01J9..."}
```

The first server event of every session. `thread_id` is the id from the init frame, or the one the server created when the init frame had none (absent, blank or `"new"`). Keep it and send it as `thread_id` in the init frame of a reconnect to continue the thread.

**Input transcript (partial)**

```json
{"type": "input_transcript", "text": "What's the weath", "finished": false}
```

**Input transcript (complete)**

```json
{"type": "input_transcript", "text": "What's the weather in Paris?", "finished": true}
```

**Output transcript (partial)**

```json
{"type": "output_transcript", "text": "The weather in Par", "finished": false}
```

**Output transcript (complete)**

```json
{"type": "output_transcript", "text": "The weather in Paris is 24 degrees and sunny.", "finished": true}
```

**Tool call**

```json
{"type": "tool_call", "id": "call-abc123", "name": "get_weather", "args": {"location": "Paris"}}
```

**Tool result**

```json
{"type": "tool_result", "id": "call-abc123", "result": "24 degrees and sunny", "status": "success", "duration_ms": 120.0}
```

**Turn complete**

```json
{"type": "turn_complete"}
```

The model finished speaking for this turn.

**Interrupted (barge-in)**

```json
{"type": "interrupted"}
```

The user spoke while the model was talking.

**Session update**

```json
{"type": "session_update", "resumption_handle": "<opaque-handle>"}
```

The provider issued a session-resumption handle. The server stores this in the checkpointer thread metadata.

**Go away**

```json
{"type": "go_away", "time_left": "5s"}
```

The provider will rotate the connection soon. The server reconnects automatically; clients will see a brief gap in audio events but no explicit close.

**Agent changed**

```json
{"type": "agent_changed", "author": "billing-agent"}
```

The active agent or persona for the session changed. `author` identifies the new agent.

**Error (non-fatal)**

```json
{"type": "error", "code": null, "message": "provider rate limit", "fatal": false}
```

Transient error; the session continues.

**Error (fatal)**

```json
{"type": "error", "code": "reconnect_failed", "message": "realtime session lost and could not be resumed after 5 attempts", "fatal": true}
```

Fatal error; the session ended. The server closes the WebSocket after emitting this event.

### Error event codes

Codes the bridge itself emits, in addition to any provider code passed through:

| `code` | `fatal` | Meaning | Followed by close |
|---|---|---|---|
| `not_live` | `true` | The configured graph is not a live agent. Use `WS /v1/graph/ws`. | `1008` |
| `THREAD_NOT_FOUND` | `true` | The `thread_id` in the init frame belongs to another user (or does not exist), or (with `runs.thread_ids: server`, the default) was never issued by the server. | `1008` |
| `session_expired` | `true` | The token expired or was revoked during the session. Reconnect with a fresh token. | `1008` |
| `invalid_config` | `true` | The init frame produced an invalid `RealtimeConfig` (for example an unusable `modalities` value). | `1000` |
| `forbidden` | `true` | The caller may not stream on this thread. | `1008` |
| `VALIDATION_ERROR` | `true` | `thread_id` breaks the id rule. | `1003` |
| `thread_busy` | `true` | Another run or session holds this thread. | `1013` |
| `too_many_runs` | `true` | The user is over `runs.max_concurrent_per_user`. | `1013` |

---

## WebSocket close codes

Close codes are listed in [Conventions](/docs/reference/rest-api/conventions#websocket-close-codes). Beyond those, `1003` also closes an invalid init frame and `1009` an init frame over 1 MiB; `1013` also answers `thread_busy`, `too_many_runs` and a client that stopped reading.

---

## Scope: audio and text only

Exactly one `LiveAgent` must be present in the graph; multiple live agents per graph are not supported.

For a runnable Python client, see [Use realtime audio](/docs/guides/use-realtime-audio).
