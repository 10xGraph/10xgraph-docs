---
title: "realtime()"
seoTitle: "realtime() audio session in the TS client"
description: Reference for TenxGraphClient.realtime() and RealtimeSession, the transport-only audio-to-audio client for the /v1/graph/live WebSocket.
section: Reference
group: "TypeScript client"
order: 510
label: "realtime()"
updated: "2026-10-27"
---

`client.realtime()` opens a realtime, audio-to-audio session over the server's `/v1/graph/live` WebSocket and returns a `RealtimeSession`. You stream PCM16 microphone audio up and receive PCM16 model audio back, plus transcripts, tool calls, and lifecycle events.

The session is **transport only**: it moves bytes and events between your app and the server. Capturing microphone audio and playing back the model's audio are your application's responsibility, so the client deliberately ships no mic or speaker code so it stays small and runs unchanged in browsers, Node, and React Native.

**Endpoint:** `WS /v1/graph/live`  
**Source:** `src/endpoints/realtime.ts`  
**Server reference:** [`reference/rest-api/live`](/docs/reference/rest-api/live)

The endpoint is only available when the graph configured in `10xgraph.json` is rooted at a `LiveAgent` (built with `AudioAgent`). Calling it against a non-live graph sends a fatal `{ type: 'error', code: 'not_live' }` event and closes the socket with code `1008`.

---

## Signature

```ts
client.realtime(
  init: RealtimeInit,
  options?: RealtimeOptions
): RealtimeSession
```

`realtime()` is synchronous: it returns the `RealtimeSession` immediately and opens the socket in the background. Await `session.ready` before sending input if you need the connection to be established first.

---

## Parameters

### `init: RealtimeInit`

The session configuration, sent to the server as the first frame. Every field is optional and overrides the live agent's build-time `RealtimeConfig` for this session, within the limits the server sets.

| Field | Type | Description |
|---|---|---|
| `model` | `string` | The realtime model, e.g. `'gemini-2.5-flash-live'`. Honoured only when the server lists it in `websocket.realtime_models`; otherwise the agent's own model is used. |
| `thread_id` | `string` | Conversation/thread id. If omitted, the session generates one (`session.threadId`) and reuses it for reconnects so the conversation resumes from its checkpoint. |
| `voice` | `string` | Provider voice name (e.g. `'Puck'`). |
| `modalities` | `'AUDIO' \| 'TEXT' \| ('AUDIO' \| 'TEXT')[]` | Response modality. A realtime session is single-modality; a bare string is accepted and coerced server-side. Defaults to the agent's config (usually `'AUDIO'`). |
| `vad` | `RealtimeVADConfig` | Voice-activity-detection overrides. Disable for push-to-talk and drive turns with `activityStart()` / `activityEnd()`. |
| `system_prompt` | `string` | Per-session system instruction override. |
| `tools_tags` | `string[]` | Restrict which tagged tools are available this session. It can only narrow the agent's own tag filter; tags outside it are dropped. |

Unknown keys are forwarded verbatim and ignored by servers that do not understand them, so the type is forward-compatible (`[k: string]: unknown`).

```ts
interface RealtimeVADConfig {
  enabled?: boolean;
  start_sensitivity?: string | null;
  end_sensitivity?: string | null;
  prefix_padding_ms?: number | null;
  silence_duration_ms?: number | null;
}
```

### `options: RealtimeOptions` (optional)

| Field | Type | Default | Description |
|---|---|---|---|
| `reconnect` | `RealtimeReconnectOptions` | see below | Client-side reconnect/backoff policy for a dropped socket. |
| `onAudio` | `(pcm16: Uint8Array, sampleRate: number) => void` | none | Convenience handler, sugar for `session.on('audio', ...)`. |
| `onEvent` | `(e: RealtimeEvent) => void` | none | Convenience handler, sugar for `session.on('event', ...)`. |
| `onError` | `(e: Extract<RealtimeEvent, { type: 'error' }>) => void` | none | Convenience handler, sugar for `session.on('error', ...)`. |

```ts
interface RealtimeReconnectOptions {
  enabled?: boolean;     // default true
  baseDelay?: number;    // seconds, default 0.5
  maxDelay?: number;     // seconds, default 10
  maxAttempts?: number;  // default 5
}
```

---

## `RealtimeSession`

The object returned by `realtime()`. Long-lived and bidirectional, so it uses an event-emitter API rather than an async generator.

### Properties

| Property | Type | Description |
|---|---|---|
| `ready` | `Promise<void>` | Resolves once the socket is open and the init frame has been sent. Rejects if the initial connection fails. |
| `threadId` | `string` | The thread id in use (the one you passed, or a generated one). Stable across reconnects. |
| `resumptionHandle` | `string \| null` | The latest provider resumption handle seen on a `session_update` event. Sent back automatically on reconnect. |

### Send methods

| Method | Description |
|---|---|
| `sendAudio(pcm16: Uint8Array \| ArrayBuffer)` | Send a chunk of input audio. Expected format: PCM16 mono @ 16 kHz. Sent as a raw binary frame. |
| `sendText(text: string)` | Send a text turn into the live session (`{type:"text"}`). |
| `activityStart()` | Push-to-talk / manual-VAD: mark the start of user activity (`{type:"activity_start"}`). |
| `activityEnd()` | Push-to-talk / manual-VAD: mark the end of user activity (`{type:"activity_end"}`). |
| `close()` | Send `{type:"close"}`, close the socket, and disable reconnect. Idempotent and safe to call once you are done. |

### Subscription methods

| Method | Description |
|---|---|
| `on(event, listener)` | Subscribe to a channel. Returns the session for chaining. |
| `off(event, listener)` | Unsubscribe the exact listener reference. |

---

## Event channels

Subscribe with `session.on(channel, listener)`.

### Audio and aggregate channels

| Channel | Listener signature | Fires when |
|---|---|---|
| `'audio'` | `(pcm16: Uint8Array, sampleRate: number) => void` | The server sends a chunk of model audio. Output is PCM16 mono @ 24 kHz (`sampleRate === 24000`). |
| `'event'` | `(e: RealtimeEvent) => void` | Any non-audio JSON event arrives. Use this for a single catch-all handler. |

### Per-type event channels

Each variant of `RealtimeEvent` also has its own channel, so you can subscribe narrowly:

| Channel | Payload shape |
|---|---|
| `'input_transcript'` | `{ type: 'input_transcript'; text: string; finished: boolean }` |
| `'output_transcript'` | `{ type: 'output_transcript'; text: string; finished: boolean }` |
| `'tool_call'` | `{ type: 'tool_call'; id: string; name: string; args: Record<string, unknown> }` |
| `'tool_result'` | `{ type: 'tool_result'; id: string; result: unknown }` |
| `'turn_complete'` | `{ type: 'turn_complete' }` |
| `'interrupted'` | `{ type: 'interrupted' }` (barge-in; flush local playback) |
| `'session_update'` | `{ type: 'session_update'; resumption_handle?: string \| null }` |
| `'go_away'` | `{ type: 'go_away'; time_left?: string \| null }` |
| `'agent_changed'` | `{ type: 'agent_changed'; author: string }` |
| `'error'` | `{ type: 'error'; code?: string \| null; message: string; fatal: boolean }` |

### Lifecycle channels

| Channel | Listener signature | Fires when |
|---|---|---|
| `'open'` | `() => void` | The socket opened and the init frame was sent. |
| `'close'` | `(code: number) => void` | The socket closed (with the close code). |
| `'reconnecting'` | `(attempt: number) => void` | A reconnect attempt is scheduled (1-based attempt number). |
| `'reconnected'` | `() => void` | A reconnect attempt re-opened the socket. |

### `RealtimeEvent` type

```ts
type RealtimeEvent =
  | { type: 'input_transcript'; text: string; finished: boolean }
  | { type: 'output_transcript'; text: string; finished: boolean }
  | { type: 'tool_call'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; id: string; result: unknown }
  | { type: 'turn_complete' }
  | { type: 'interrupted' }
  | { type: 'session_update'; resumption_handle?: string | null }
  | { type: 'go_away'; time_left?: string | null }
  | { type: 'agent_changed'; author: string }
  | { type: 'error'; code?: string | null; message: string; fatal: boolean };
```

---

## Authentication

The bearer token is sent using the browser-safe `10xgraph-bearer` WebSocket subprotocol, and it is never placed in the URL. On Node runtimes the `Authorization` header is also set. You provide the token the same way as for every other client call, via `authToken` or `auth` on the `TenxGraphClient` config (see [`reference/client/auth`](/docs/reference/client/auth)); `realtime()` reuses it automatically.

The server accepts the token via the `Authorization` header, the `10xgraph-bearer` subprotocol, or a `?token=` query fallback. The client uses the subprotocol so the token is never logged in a URL.

---

## Reconnect and resume

If the socket drops unexpectedly (not from your `close()` call and not after a `fatal` error event), the session reconnects automatically:

- Backoff: attempt `n` waits `min(baseDelay · 2^(n-1), maxDelay)` seconds. Defaults `0.5` / `10` / `5` mirror the Python core's `ReconnectConfig`.
- On each attempt the session emits `'reconnecting'` with the attempt number, then re-opens and re-sends the init frame with the same `thread_id`, so the conversation continues from its checkpoint. On success it emits `'reconnected'` and resets the attempt counter.
- The latest `resumptionHandle` (from `session_update`) is included in the reconnect init frame so the provider can resume server-side.
- After `maxAttempts` is exhausted, the session emits a single fatal error on both the `'error'` and `'event'` channels: `{ type: 'error', code: 'reconnect_failed', message: '...', fatal: true }`.

The session does **not** reconnect after an explicit `close()` or after receiving a `fatal` error event. Set `reconnect: { enabled: false }` to disable client reconnect entirely.

---

## Examples

### Basic audio session

```ts
import { TenxGraphClient } from '10xgraph-client';

const client = new TenxGraphClient({
  baseUrl: 'http://localhost:8000',
  authToken: process.env.API_TOKEN!,
});

// Placeholders you implement: audio playback and microphone capture.
declare function playback(pcm16: Uint8Array, sampleRate: number): void;
declare const micChunk: Uint8Array; // PCM16 mono @ 16 kHz

const session = client.realtime(
  { model: 'gemini-2.5-flash-live', modalities: 'AUDIO' },
  { reconnect: { maxAttempts: 5 } }
);

session.on('audio', (pcm16, sampleRate) => playback(pcm16, sampleRate)); // PCM16 @ 24 kHz
session.on('output_transcript', (e) => console.log('model:', e.text));
session.on('input_transcript', (e) => console.log('you:', e.text));
session.on('error', (e) => console.error('realtime error:', e.message));

await session.ready;          // socket open + init sent

// Feed microphone audio (PCM16 @ 16 kHz). Capture is your responsibility.
session.sendAudio(micChunk);

// End the session gracefully.
session.close();
```

### Push-to-talk (manual VAD)

```ts
declare const micChunk: Uint8Array; // PCM16 mono @ 16 kHz, from your capture code

const session = client.realtime({
  model: 'gemini-2.5-flash-live',
  vad: { enabled: false },
});

await session.ready;

// While the user holds the talk button:
session.activityStart();
session.sendAudio(micChunk);   // send chunks as they arrive
// ...
// When the user releases:
session.activityEnd();
```

### Handling tool calls and interruptions

```ts
// Placeholder you implement: stop and clear queued audio playback.
declare function stopPlayback(): void;

// `session` is the RealtimeSession from the basic example above.
session.on('tool_call', (e) => {
  console.log('tool requested:', e.name, e.args);
  // The live agent runs server-side tools itself; tool_call/tool_result are
  // emitted for observability.
});

session.on('interrupted', () => {
  // Barge-in: the user spoke over the model. Flush any queued playback.
  stopPlayback();
});

session.on('go_away', (e) => {
  console.log('server will rotate the connection soon:', e.time_left);
  // No action needed: the session reconnects and resumes automatically.
});
```

### Single catch-all handler

```ts
// Placeholders you implement.
declare function playback(pcm16: Uint8Array, sampleRate: number): void;
declare function appendTranscript(text: string): void;

const session = client.realtime(
  { model: 'gemini-2.5-flash-live' },
  {
    onAudio: (pcm16) => playback(pcm16, 24000),
    onEvent: (e) => {
      if (e.type === 'output_transcript') appendTranscript(e.text);
    },
    onError: (e) => console.error(e.message),
  }
);
```

### Running on Node < 21

Browsers and Node 21+ have a global `WebSocket`. On Node 18 or 20, pass an implementation (the [`ws`](https://www.npmjs.com/package/ws) package) via `webSocketImpl` on the client config. It is used for both `realtime()` and `wsStream()`:

```ts
import WebSocket from 'ws';
import { TenxGraphClient } from '10xgraph-client';

const client = new TenxGraphClient({
  baseUrl: 'http://localhost:8000',
  authToken: process.env.API_TOKEN!,
  webSocketImpl: WebSocket,
});
```

---

## Audio format

| Direction | Format |
|---|---|
| Input (`sendAudio`) | PCM16, mono, 16 kHz |
| Output (`'audio'`) | PCM16, mono, 24 kHz (`sampleRate === 24000`) |

Constants `REALTIME_INPUT_SAMPLE_RATE` (16000) and `REALTIME_OUTPUT_SAMPLE_RATE` (24000) are exported from the package. The maximum upstream frame size enforced by the server is 1 MiB; chunk your audio accordingly.

---

## Common issues

| Symptom | Cause | Fix |
|---|---|---|
| Socket closes with code `1008` immediately, after an `error` event with `code: 'not_live'` | The configured graph is not rooted at a `LiveAgent`. | Point `10xgraph.json` at an `AudioAgent`-based graph. |
| Socket closes with code `1008` after the init frame | Not authorized for the requested `thread_id`. Preceded by an `error` event with `code: 'not_authorized'`. | Check the token and the server's `AuthorizationBackend`. |
| Socket closes with code `1008` in the middle of a session, after an `error` event with `code: 'session_expired'` | The token expired or was revoked. The server re-checks it every 30 seconds. | Reconnect with a fresh token. |
| Socket closes with code `1011` | An unexpected server-side error ended the session. | Check the server logs. |
| Socket closes with code `1003` | Invalid init frame (e.g. an unsupported `modalities` value). | Check `model` and `modalities`; read the `error` event for the reason. |
| `No WebSocket implementation available` thrown | Running on Node < 21 without a global `WebSocket`. | Pass `webSocketImpl` (the `ws` package) in the client config. |
| No audio plays | The client is transport-only. | Wire the `'audio'` channel to your own audio output. |
| Repeated `'reconnecting'` then a fatal `reconnect_failed` | The server is unreachable past `maxAttempts`. | Check the server and network; raise `maxAttempts` or handle the fatal error. |

---

## What you learned

- `client.realtime(init, options?)` returns a transport-only `RealtimeSession` over `/v1/graph/live`.
- Send PCM16 @ 16 kHz with `sendAudio`; receive PCM16 @ 24 kHz on the `'audio'` channel; capture and playback are your responsibility.
- Subscribe to typed events (`output_transcript`, `tool_call`, `interrupted`, ...) with `session.on(...)`.
- Auth uses the browser-safe `10xgraph-bearer` subprotocol automatically (needs `10xgraph-api` 0.7.0 or later); pass `webSocketImpl` on Node < 21.
- The session auto-reconnects with backoff and resumes the same `thread_id`, unless you call `close()` or a fatal error occurs.

## Next step

See the server-side wire protocol in [`reference/rest-api/live`](/docs/reference/rest-api/live), or the Python live-agent reference in [`reference/python/realtime`](/docs/reference/python/realtime).
