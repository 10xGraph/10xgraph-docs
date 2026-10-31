---
title: Live WebSocket endpoint
description: "Reference for WS /v1/graph/live: real-time audio WebSocket bridge for LiveAgent graphs. Init frame, binary and JSON frames, authentication, close codes."
section: Reference
group: "REST API"
order: 320
label: Live WebSocket
updated: "2026-10-27"
---

`WS /v1/graph/live` is a WebSocket bridge between a client (browser, SDK, native app) and a `CompiledGraph` rooted at a `LiveAgent` (built with `AudioAgent`). It maps audio frames to `LiveInputQueue` calls and streams `RealtimeEvent` objects back.

The endpoint is only available when the graph configured in `10xgraph.json` contains a `LiveAgent`. Calling it against a non-live graph sends a fatal `error` event with `code: "not_live"` and closes the socket with code `1008`. Check `info.is_realtime` on `GET /v1/graph` to decide which socket to open.

Base URL: `ws://<host>/v1/graph/live`

---

## Authentication

Uses `RequirePermission("graph", "stream")`. The server looks for a bearer token in three places, in this order:

1. **`Authorization: Bearer <token>` header** for non-browser clients (Python, server-to-server).
2. **`Sec-WebSocket-Protocol: 10xgraph-bearer, <token>`** (preferred for browsers). The token rides in a request header, so it never lands in URLs, access logs, or browser history. The server echoes the sentinel back on `accept()`, which browsers require.
3. **`?token=<jwt>` query parameter** as a last-resort fallback. The token is exposed in URLs and access logs; use (2) instead when you can.

```javascript title="browser.js"
// Browser: preferred subprotocol transport
const ws = new WebSocket(
  "ws://localhost:8000/v1/graph/live",
  ["10xgraph-bearer", jwt],
);
```

```text
# Query fallback
ws://localhost:8000/v1/graph/live?token=<jwt>
```

The older `agentflow-bearer` sentinel is still accepted until 2.0.

An authentication or authorization failure closes the handshake with code `1008` before `accept()`.

The token is not trusted for the whole session. The server checks it again after the init frame and then every 30 seconds. Each check covers expiry and revocation (`token_revocation`), and it fails closed: a cache store that cannot answer the revocation check counts as revoked. When a check fails, the server sends a fatal `session_expired` error event and closes the socket with code `1008`. The client must reconnect with a fresh token.

---

## Connection limits

WebSocket handshakes bypass the HTTP rate-limit and request-size middleware (Starlette runs `BaseHTTPMiddleware` for HTTP scopes only), so the endpoint re-applies three protections at the handshake itself. Each rejection closes the handshake with code `1013` before `accept()`.

| Protection | Config key | Default | Behavior |
|---|---|---|---|
| Global rate limit | `rate_limit` | per your config | A handshake counts against the same bucket as REST requests. |
| Concurrent connections | `websocket.max_connections` | `1000` | Shared across `/v1/graph/live` and `/v1/graph/ws`. |
| Concurrent connections per user | `websocket.max_connections_per_user` | `10` | Limits how many slots one verified user can hold. |

```json
{
  "agent": "graph.audio:app",
  "websocket": {
    "max_connections": 100,
    "max_connections_per_user": 5,
    "realtime_models": ["gemini-3.8-live"]
  }
}
```

A missing key gets the default above. Set a key to `0` or `null` for unlimited. The counters are shared by all workers when Redis is configured (`redis` key or `REDIS_URL`) and per process otherwise, so without Redis size them per worker. `realtime_models` is covered under the init frame.

---

## Session lifecycle

1. Client opens the WebSocket connection.
2. Client sends a JSON init frame as the first message.
3. Server starts the realtime session. Its first event is `session_started`, which carries the thread id. Then it begins pumping events.
4. Client sends upstream frames (audio binary, control JSON) throughout the session.
5. Server sends downstream frames (audio binary, event JSON) as the model generates.
6. Either side closes the connection to end the session.

---

## Init frame (client -> server, first frame)

The first frame from the client must be a JSON text frame. It configures the session and optionally overrides the agent's build-time `RealtimeConfig` values. All fields are optional.

```json title="init frame"
{
  "thread_id": "session-001",
  "model": "gemini-3.8-live",
  "voice": "Puck",
  "modalities": ["AUDIO"],
  "system_prompt": "You are a terse voice assistant.",
  "tools_tags": ["weather"],
  "vad": {
    "enabled": true,
    "silence_duration_ms": 800
  }
}
```

| Field | Type | Maps to | Description |
|---|---|---|---|
| `thread_id` | string | (none) | Thread identifier for persistence and resume. Reuse to resume a previous session. `"new"`, blank or missing starts a fresh thread. |
| `model` | string | `RealtimeConfig.model` | Override the live model. Honored only if listed in `websocket.realtime_models`; otherwise it is ignored and the agent's own model is used. |
| `voice` | string | `RealtimeConfig.voice` | Override the voice (e.g. `"Puck"`). |
| `modalities` | array or string | `RealtimeConfig.response_modalities` | Override the response modalities. Exactly one entry; `["AUDIO"]` or `["TEXT"]`. A bare string (`"AUDIO"`) is coerced to a one-element list. |
| `system_prompt` | string | `RealtimeConfig.system_instruction` | Override the system instruction for this session. |
| `tools_tags` | array | `RealtimeConfig.tools_tags` | Narrow the tools exposed to this session by tag. It can only narrow the agent's own tag filter, never widen it; tags outside that filter are dropped. |
| `vad` | object | `RealtimeConfig.vad` | Override `VADConfig` fields for this session. |

Fields not present in the init frame keep the agent's compiled values. An invalid init frame (not JSON, or JSON that is not an object) closes the socket with code `1003`.

**Thread handling.** `thread_id` is optional. When it is absent, blank or `"new"` the server generates an id for the session and persists the thread record before the first event is pumped; the generated id is sent in the `session_started` event, so a client that needs to resume later keeps it and sends it back. With the default `runs.thread_ids` of `server`, an id the server never issued is refused like a thread owned by someone else. Set `runs.thread_ids` to `client` to let the caller name a new thread. When `thread_id` **is** present it is ownership-checked before the session starts (only when auth is configured): a thread owned by another user is rejected with a fatal `error` event (`code: "not_authorized"`) and close code `1008`.

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
| Upstream queue depth | 1000 frames (`REALTIME_INPUT_QUEUE_MAXSIZE`) | The oldest queued frame is dropped to make room. At ~50 frames/second this is roughly 20 seconds of buffered audio. |
| Buffered input per session | 16 MiB (`REALTIME_INPUT_QUEUE_MAX_BYTES`) | A frame that would push the buffered input past the budget is dropped and a warning is logged. The session continues; no error event is sent. About 8 minutes of 16 kHz PCM16 audio, so a healthy session never reaches it. |

Send audio in normal chunks (tens of KB). A 1 MiB frame is around 30 seconds of 16 kHz PCM16 in one message, far beyond any realistic capture buffer.

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

Informational only. 10xGraph dispatches the tool automatically on the server side.

**Tool result**

```json
{"type": "tool_result", "id": "call-abc123", "result": {"result": "24 degrees and sunny"}}
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

The user spoke while the model was talking. Flush any buffered audio playback and discard audio already queued for the speaker.

**Session update**

```json
{"type": "session_update", "resumption_handle": "<opaque-handle>"}
```

The provider issued a session-resumption handle. The server stores this in the checkpointer thread metadata. Clients can ignore this frame; no action required.

**Go away**

```json
{"type": "go_away", "time_left": "5s"}
```

The provider will rotate the connection soon. The server reconnects automatically; clients will see a brief gap in audio events but no explicit close.

**Agent changed**

```json
{"type": "agent_changed", "author": "billing-agent"}
```

The active agent or persona for the session changed. `author` identifies the new agent. Informational; use it to relabel the transcript in the UI.

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
| `not_authorized` | `true` | The `thread_id` in the init frame belongs to another user, or (with `runs.thread_ids: server`, the default) was never issued by the server. | `1008` |
| `session_expired` | `true` | The token expired or was revoked during the session. Reconnect with a fresh token. | `1008` |
| `invalid_config` | `true` | The init frame produced an invalid `RealtimeConfig` (for example an unusable `modalities` value). | server close |

---

## WebSocket close codes

| Code | Meaning |
|---|---|
| `1000` | Normal closure: the session ended. |
| `1003` | Invalid init frame: the first frame was not JSON, or was JSON that is not an object. |
| `1008` | Policy violation: authentication or authorization was rejected at the handshake, or the graph is not a live agent (`not_live`), or the requested `thread_id` is owned by another user (`not_authorized`), or the token expired or was revoked during the session (`session_expired`). |
| `1011` | Unexpected server error during the session (provider failure, checkpointer error). This code is used only for unhandled failures. |
| `1013` | Try again later: the global rate limit or `websocket.max_connections` was exceeded. The handshake is refused before `accept()`. |

---

## Scope: audio and text only

This socket carries **binary PCM16 audio frames and JSON control frames**. The upstream pump recognises binary audio plus the `text`, `activity_start`, `activity_end`, and `close` control types, and forwards nothing else. There is no image frame type in the live protocol.

Image and document input belongs on the turn-based run endpoints (`POST /v1/graph/invoke`, `POST /v1/graph/stream`, `WS /v1/graph/ws`), which accept `ImageBlock`/`DocumentBlock` content referencing an uploaded `file_id`. See [Files and multimodal](/docs/server/files-and-multimodal).

Exactly one `LiveAgent` must be present in the graph; multiple live agents per graph are not supported.

---

## Minimal client example (Python websockets)

This script sends a WAV file (16 kHz, mono, PCM16) as audio, writes the model's reply to `out.wav`, and closes after the first turn. Install the dependencies with `pip install "10xgraph" websockets`.

```python title="live_client.py"
import asyncio
import json
import wave
import websockets

from tenxgraph.core.realtime.base import OUTPUT_SAMPLE_RATE

async def main():
    uri = "ws://localhost:8000/v1/graph/live?token=<jwt>"

    async with websockets.connect(uri) as ws:
        # 1. Send init frame.
        await ws.send(json.dumps({
            "thread_id": "demo-001",
            "voice": "Puck",
        }))

        # 2. Load and stream audio input.
        with wave.open("input.wav", "rb") as wf:
            pcm = wf.readframes(wf.getnframes())

        chunk = 3200  # 100 ms at 16 kHz, 2 bytes/sample
        for offset in range(0, len(pcm), chunk):
            await ws.send(pcm[offset : offset + chunk])

        # 3. Receive events.
        out = wave.open("out.wav", "wb")
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(OUTPUT_SAMPLE_RATE)

        async for message in ws:
            if isinstance(message, bytes):
                out.writeframes(message)
            else:
                event = json.loads(message)
                print(event)
                if event["type"] == "turn_complete":
                    await ws.send(json.dumps({"type": "close"}))
                    break

        out.close()

asyncio.run(main())
```
