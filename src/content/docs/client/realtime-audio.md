---
title: Build a realtime audio conversation
description: Capture microphone input, stream it to a live agent with client.realtime(), receive PCM16 audio output, and play it back in the browser.
section: "TypeScript client"
group: "Features"
order: 100
label: Realtime audio conversations
updated: "2026-10-27"
---

`client.realtime()` opens a WebSocket connection that carries bidirectional PCM16 audio frames and JSON control events between your browser and a live agent. The API is transport only: it handles the audio bytes and event delivery, but leaves microphone capture and speaker playback to you. This guide covers both sides: building a mic capturer to send PCM16 at 16 kHz, a PCM16 player to receive audio at 24 kHz, managing the session lifecycle, and handling interrupts.

For the complete `RealtimeSession` API (every event type, reconnect behavior, init parameters) see [`reference/client/realtime`](/docs/reference/client/realtime).

## Prerequisites

- A graph rooted at a `LiveAgent`. A turn-based graph rejects the connection: the server sends a fatal `error` event with `code: 'not_live'` and closes the socket with code `1008`. Check `info.is_realtime` from `client.graph()` before rendering an audio UI.
- A configured `TenxGraphClient` instance. On Node 18 or 20, you must pass `webSocketImpl` (the `ws` package) in the client config; see [create-client](/docs/client/create-client) for details. Browsers ship WebSocket natively.
- A secure context. `getUserMedia` requires HTTPS or `localhost`. On `http://`, `getUserMedia` rejects immediately.

## The audio contract

| Direction | Format |
|---|---|
| Up, via `sendAudio()` | PCM16, mono, **16 kHz** |
| Down, on the `'audio'` channel | PCM16, mono, **24 kHz** |

The two rates differ, and getting them backwards produces audio that plays at the wrong speed rather than an error. The package exports `REALTIME_INPUT_SAMPLE_RATE` (16000) and `REALTIME_OUTPUT_SAMPLE_RATE` (24000), use them rather than literals.

---

## Step 1: Build a PCM16 player

The agent sends audio as a stream of PCM16 frames (typically 50-200ms each). If you play each frame independently starting at the current time, you get silence between them. Instead, schedule each frame to start exactly when the previous one ends. This keeps playback continuous and eliminates the stuttering that makes the agent's voice sound broken.

```js
export const createPcmPlayer = (defaultSampleRate = 24000) => {
  let context = null;
  let nextTime = 0;

  const ensureContext = () => {
    if (!context) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      context = new Ctor();
    }
    if (context.state === 'suspended') context.resume();
    return context;
  };

  return {
    play: (pcmBytes, sampleRate = defaultSampleRate) => {
      if (!pcmBytes || pcmBytes.byteLength < 2) return;
      const c = ensureContext();
      const frames = Math.floor(pcmBytes.byteLength / 2);
      const view = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength);

      const buffer = c.createBuffer(1, frames, sampleRate);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < frames; i++) {
        channel[i] = view.getInt16(i * 2, true) / 32768;   // little-endian
      }

      const source = c.createBufferSource();
      source.buffer = buffer;
      source.connect(c.destination);

      const startAt = Math.max(c.currentTime, nextTime);
      source.start(startAt);
      nextTime = startAt + buffer.duration;
    },

    close: () => {
      if (context) {
        try { context.close(); } catch { /* already closed */ }
        context = null;
        nextTime = 0;
      }
    },
  };
};
```

Two details are critical. First, `getInt16(offset, true)` reads little-endian because that is what the server sends. Second, `nextTime` tracks the end of the previous frame so you know where to start the next one. Without it, each frame starts at `currentTime`, which may be before the previous frame finishes, causing overlap or gaps.

Always construct the player inside a user gesture (click or tap). Browsers start an `AudioContext` in a suspended state until user interaction, so building it outside the event handler results in silence. The `resume()` call wakes a suspended context on demand.

---

## Step 2: Capture the microphone as PCM16 at 16 kHz

Request a 16 kHz `AudioContext` and the browser automatically resamples the microphone input to that rate. This saves you from writing a resampler. The sample rate must be exactly 16 kHz because the agent's speech-to-text model expects that bitrate. The code also enables echo cancellation and noise suppression to improve audio quality on the server side.

```js
export const createMicCapture = async (onFrame, sampleRate = 16000) => {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });

  const Ctor = window.AudioContext || window.webkitAudioContext;
  const context = new Ctor({ sampleRate });
  if (context.state === 'suspended') await context.resume();

  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);

  // Route through a muted gain node so onaudioprocess keeps firing without
  // echoing the microphone back out of the speakers.
  const sink = context.createGain();
  sink.gain.value = 0;

  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);   // Float32, -1..1
    const pcm = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      pcm[i] = s < 0 ? s * 32768 : s * 32767;
    }
    onFrame(new Uint8Array(pcm.buffer));
  };

  source.connect(processor);
  processor.connect(sink);
  sink.connect(context.destination);

  return {
    stop: () => {
      try {
        processor.disconnect();
        source.disconnect();
        sink.disconnect();
      } catch { /* already torn down */ }
      stream.getTracks().forEach((t) => t.stop());
      try { context.close(); } catch { /* already closed */ }
    },
  };
};
```

Echo cancellation is not optional. Without it, the agent hears its voice playing from your speakers through the microphone, interprets it as new user input, and interrupts itself in an endless loop. If a user turns off echo cancellation or is using a speaker without proper shielding, recommend headphones.

`createScriptProcessor` is deprecated but universally supported. For production apps with high-traffic requirements, use `AudioWorklet` instead (it runs in a separate thread and reduces main-thread blocking). The frame-to-PCM conversion code is identical.

Always keep the returned handle and call `stop()` when the session ends. Forgetting to call `stop()` leaves the microphone indicator on in the browser, confusing users and potentially creating a privacy issue.

---

## Step 3: Open the realtime session

Call `client.realtime()` with the model you want and audio modality. The method returns a `RealtimeSession` object immediately and begins connecting in the background.

```ts
import { TenxGraphClient } from '10xgraph-client';

const client = new TenxGraphClient({
  baseUrl: 'http://localhost:8000',
  authToken: token,
});

let player = createPcmPlayer();              // built inside the click handler

const session = client.realtime(
  { model: 'gemini-3.8-live', modalities: 'AUDIO' },
  { reconnect: { enabled: false } },
);

session.on('open', () => setStatus('live'));
session.on('audio', (pcm, rate) => player.play(pcm, rate));
session.on('error', (e) => setError(e.message));
session.on('close', () => {
  player.close();
  setStatus('ended');
});

await session.ready;
```

Wait for `session.ready` to resolve before proceeding, which confirms the WebSocket is open and the init frame has been sent. `reconnect: { enabled: false }` makes a close permanent, suitable for a "Start / End" button UI. For long-lived assistants that should survive network hiccups, leave reconnect enabled (the default) so the session reopen with the same `thread_id` and resume from the checkpoint.

The init `model` parameter is a per-session override, honoured only when the model is listed in the server's `websocket.realtime_models` setting. Any other value is ignored and the agent's own model is used. Live model availability varies by API key and region, so omit `model` unless you need to pick from that list.

---

## Step 4: Implement push-to-talk (manual turn-taking)

In push-to-talk mode, the user holds down a button to speak and releases to stop. Call `activityStart()` before opening the mic and `activityEnd()` when closing it. The server uses these signals to detect turn boundaries: it stops listening and responds.

```ts
let mic = null;

const toggleMic = async () => {
  if (status !== 'live') return;

  if (mic) {
    mic.stop();
    mic = null;
    session.activityEnd();      // ends the turn; the agent now responds
    return;
  }

  try {
    session.activityStart();
    mic = await createMicCapture((frame) => session.sendAudio(frame));
  } catch (e) {
    // getUserMedia rejects when the user denies the permission prompt,
    // or when the page is not on HTTPS/localhost.
    setError(e?.message || 'Microphone unavailable');
    session.activityEnd();      // do not leave the turn hanging open
  }
};
```

For hands-free (continuous) operation, leave voice activation detection (VAD) enabled on the server (the default) and omit `activityStart` / `activityEnd`. Stream mic frames continuously and let the server detect silence and turn boundaries automatically. Only set `vad: { enabled: false }` in the init frame if you want manual turn control as shown above.

---

## Step 5: Display live transcripts

As the user speaks and the agent responds, both sides stream in as text deltas (small chunks). Each delta event includes a `finished` flag that signals the end of a sentence or turn. Buffer consecutive deltas from the same speaker into a single message bubble to avoid a cluttered UI.

```ts
const open = { user: null, agent: null };   // id of the in-progress bubble per role

const append = (role, text, finished) => {
  setMessages((previous) => {
    const openId = open[role];
    if (openId == null) {
      const id = nextId();
      open[role] = finished ? null : id;
      return [...previous, { id, role, text }];
    }
    const next = previous.map((m) => (m.id === openId ? { ...m, text: m.text + text } : m));
    if (finished) open[role] = null;
    return next;
  });
};

session.on('input_transcript', (e) => append('user', e.text || '', e.finished));
session.on('output_transcript', (e) => append('agent', e.text || '', e.finished));
```

---

## Step 6: Handle interruption and cleanup

When a user starts talking while the agent is still speaking, the server detects this and sends an `interrupted` event. If you don't clear the audio queue, the agent's previous response will keep playing while the new one starts, creating a chaotic overlap. Always discard queued playback and create a fresh player on interrupt.

```ts
session.on('interrupted', () => {
  player.close();            // discard everything queued
  player = createPcmPlayer(); // fresh player for the next reply
});
```

Always clean up when the session ends or the component unmounts. If a user navigates away without calling `stop()` on the mic and `close()` on the session, the browser shows a microphone indicator, the socket stays open, and resources leak.

```ts
useEffect(() => () => {
  mic?.stop();
  session?.close();
  player?.close();
}, []);
```

`session.close()` sends a `close` control frame to the server, closes the WebSocket, and prevents automatic reconnection.

---

## Step 7: Check if the agent supports realtime audio

Not all agents are configured for realtime conversations. Before rendering an audio UI, fetch the graph info once at startup and check the `is_realtime` flag. If it is false, show a notice and use the standard chat interface instead.

```ts
const { info } = (await client.graph()).data;
const liveCapable = Boolean((info as { is_realtime?: boolean }).is_realtime);

if (!liveCapable) {
  showNotice('This agent is not a realtime agent. Use the chat interface instead.');
}
```

If you skip this check and try to open a realtime session against a turn-based agent, the server sends a fatal `not_live` error event and closes the connection. The playground's **Live** page implements this gate (through its connection capabilities) to prevent users from seeing a broken interface.

---

## Reference implementation

The 10xGraph playground (`agentflow-playground/`) includes a complete, production-ready implementation of realtime audio:

| File | Contains |
|---|---|
| `src/lib/realtime-audio.js` | `createPcmPlayer(24000)` and `createMicCapture(onFrame, 16000)` (the code from Steps 1 and 2). |
| `src/pages/live/components/live-session.jsx` | Session lifecycle, push-to-talk button handler, transcript coalescing, interruption handling, and cleanup. |
| `src/pages/live/live-page.jsx` | The live-capable UI gate (Step 7), based on the `is_realtime` flag. |

To run it: `10xgraph dev` (starts the API server and opens the hosted playground), then open the **Live** page to test the realtime audio session.

---

## Troubleshooting common issues

| Symptom | Cause | Fix |
|---|---|---|
| Playback is too fast or too slow. | Playing output frames intended for 24 kHz at 16 kHz playback rate, or vice versa. The audio itself is correct; only the playback speed is wrong. | Pass the `sampleRate` argument of the `'audio'` listener to the player, as in Step 3. |
| No audio at all, no errors in the console. | The `AudioContext` was created before the first user interaction and is in suspended state. Browsers enforce this for security and battery reasons. | Create the `AudioContext` and player inside the click handler, and call `resume()` on a suspended context. |
| Choppy playback with audible gaps between frames. | Each frame starts at the current time instead of when the previous frame ends. With typical frame durations of 50-200ms, this creates noticeable silence. | Schedule frames using `max(currentTime, nextTime)` and update `nextTime` by the buffer duration. See Step 1. |
| The agent constantly interrupts itself mid-sentence. | Echo cancellation is disabled. The agent hears its own voice playing from the speaker, mistakes it for new user input, and stops to respond. | Enable `echoCancellation: true` in the `getUserMedia` call (Step 2). If echo is still a problem, recommend headphones. |
| `getUserMedia` rejects immediately with a permission error. | The user denied the permission prompt, or the page is not on HTTPS or localhost. | Handle the rejection in a catch block, show the user a clear error message, and call `activityEnd()` to clean up the pending turn. |
| Socket closes immediately after opening, error code `not_live`. | The graph is turn-based, not a live agent. | Check `info.is_realtime` before offering the audio UI. |
| Live session fails even though the graph is a `LiveAgent`. | The live model is not available for your API key, region, or quota. | Omit the `model` field so the agent's own model is used, or pick one listed in `websocket.realtime_models`. |
| `No WebSocket implementation available` error in Node.js. | Node 18 and 20 do not have a global `WebSocket` object. | Pass `webSocketImpl` in the `TenxGraphClient` config: `{ webSocketImpl: require('ws') }`. |
| Microphone indicator remains on after ending the session. | The `mic.stop()` method was not called or an exception prevented it from running. | Always call `stop()` in the "End" button handler and in a React `useEffect` cleanup. Wrap calls in try/catch or use optional chaining (`mic?.stop()`). |

---

## Summary

You now understand the full lifecycle of a realtime audio conversation:

- **Sample rates are intentional.** Input at 16 kHz optimizes speech-to-text quality; output at 24 kHz is what the model produces. Using the browser's automatic resampling avoids decoder complexity.
- **Playback scheduling prevents gaps.** Tracking the end time of the previous frame and scheduling the next one there keeps the audio stream seamless.
- **Echo cancellation is essential.** Without it, the agent hears its own voice and loops. Always enable it in the `getUserMedia` constraints.
- **Turn-taking has two modes.** Push-to-talk (manual `activityStart/activityEnd`) suits voice-assistant UIs. Hands-free (server VAD) suits always-listening assistants.
- **Interruption and cleanup are critical.** The `interrupted` event requires clearing the audio queue. Cleanup on unmount and on error prevents resource leaks and privacy issues.
- **Runtime checks prevent broken experiences.** Always verify `is_realtime` before offering the audio UI, and omit the `model` field unless you need one from `websocket.realtime_models`.

## Next steps

- See the [reference](/docs/reference/client/realtime) for the complete `RealtimeSession` API: every event type, reconnect configuration, and resumption behavior.
- Explore the playground's [Live page implementation](https://github.com/10xHub/agentflow-playground/tree/main/src/pages/live) for a production example.
- For Python server-side realtime audio, see [use-realtime-audio](/docs/guides/use-realtime-audio) (the guide for building a `LiveAgent`).
