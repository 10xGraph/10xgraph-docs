---
title: Stream responses
description: Process agent responses token-by-token with client.stream() and client.wsStream().
section: "TypeScript client"
group: "Basics"
order: 40
label: Stream responses
updated: "2026-10-27"
---

`client.stream()` and `client.wsStream()` let you process the agent's response as it arrives, chunk by chunk, instead of waiting for the complete response. This guide shows you how to consume streams, handle different event types, and manage long-running operations.

## Why stream

Streaming improves perceived latency. Instead of displaying nothing until the model finishes generating a complete response, you show tokens as they arrive. For a 2000-token response that takes 8 seconds to generate, streaming displays the first token within 100-200ms, letting the user see progress immediately.

Streaming also enables progressive rendering in UIs: you can parse structured content as soon as partial JSON arrives, show tool execution results before the model finishes thinking, or monitor state changes as they occur.

## Prerequisites

- A configured `10xgraph-client`. See `/docs/client/create-client`.
- The 10xGraph API server running.
- Basic familiarity with async generators and `for await`.

---

## Core concepts

The stream methods return an `AsyncGenerator` that yields `StreamChunk` objects as the server emits them. Each chunk carries:

- `event`: The type of update (`message`, `updates`, `state`, `error`)
- `message`: Partial or complete model response (when event is `message`)
- `state`: Graph state (present with `response_granularity: 'full'`)
- `data`: Extra payload for `updates` and `error` events (for example `{ status: ... }`)
- `thread_id`: Thread this chunk belongs to
- `run_id`, `timestamp` and `metadata`: Execution metadata (thread ID, run ID, timestamp)

The stream starts when you iterate with `for await`. A single run may emit dozens or hundreds of chunks, and the generator completes when the graph finishes.

---

## Start a stream

Call `client.stream()` with a list of messages. The method returns immediately; the request begins only when you start iterating:

```ts
import { TenxGraphClient, Message, StreamEventType } from '10xgraph-client';

const client = new TenxGraphClient({ baseUrl: 'http://localhost:8000' });

const stream = client.stream([
  Message.text_message('Write a haiku about mountains.'),
]);

for await (const chunk of stream) {
  console.log('Event:', chunk.event);
  console.log('Data:', chunk);
}
```

No network call happens until the `for await` loop begins. If you never iterate, the stream is never sent.

---

## Filter for message chunks

The majority of chunks you receive have `event === 'message'`. To extract and display token-by-token output, filter for message events and check the `delta` field:

```ts
for await (const chunk of stream) {
  if (chunk.event === 'message' && chunk.message) {
    const content = chunk.message.content;
    
    for (const block of content) {
      if (block.type === 'text') {
        process.stdout.write((block as any).text);
      }
    }
  }
}
```

When a message is streaming, the server sends many chunks with `message.delta === true`. After the message completes, it sends one final chunk with `delta === false`.

---

## Differentiate partial and complete messages

Most use cases require separate handling for partial tokens (e.g., display them in a text buffer) and complete messages (e.g., save them to state or swap out a loading placeholder):

```ts
let currentMessage = '';

for await (const chunk of stream) {
  if (chunk.event !== 'message' || !chunk.message) continue;

  // Extract all text blocks from this chunk
  const text = chunk.message.content
    .filter(b => b.type === 'text')
    .map(b => (b as any).text as string)
    .join('');

  if (chunk.message.delta === true) {
    // Partial token: append to current buffer and update UI
    currentMessage += text;
    updateStreamingUI(currentMessage);
  } else {
    // Final message: all tokens received, can now save or finalize
    currentMessage = text;
    saveToHistory(currentMessage);
    currentMessage = '';
  }
}
```

The distinction matters because partial chunks may be truncated mid-word or mid-token (especially with non-ASCII text), so you should not assume a partial chunk is a complete logical unit.

---

## Use a persistent thread

Pass `config.thread_id` to keep the conversation on the same thread:

```ts
const threadId = 'user-123-session-001';

const stream = client.stream(
  [Message.text_message('What can you do?')],
  {
    config: { thread_id: threadId },
    response_granularity: 'low',
  }
);

for await (const chunk of stream) {
  if (chunk.event === 'message' && chunk.message?.delta) {
    const text = chunk.message.content
      .filter(b => b.type === 'text')
      .map(b => (b as any).text as string)
      .join('');
    process.stdout.write(text);
  }
}
```

The thread ID appears on every chunk as `chunk.thread_id` and `chunk.metadata?.thread_id`, so you can track it without passing it explicitly on every call.

---

## Receive state updates

By default, the server streams only message tokens. Set `response_granularity: 'full'` to also receive graph state on the chunks as the graph executes:

```ts
const stream = client.stream(
  [Message.text_message('Summarise the conversation.')],
  { response_granularity: 'full' }
);

for await (const chunk of stream) {
  if (chunk.event === 'message' && chunk.message) {
    const text = chunk.message.content
      .filter(b => b.type === 'text')
      .map(b => (b as any).text as string)
      .join('');
    console.log('Text token:', text);
  } else if (chunk.event === 'updates') {
    // State was modified (tool call, routing, etc.)
    console.log('State changed:', chunk.state);
  } else if (chunk.event === 'state') {
    // Full state snapshot at this point in execution
    console.log('Full state:', chunk.state);
  } else if (chunk.event === 'error') {
    console.error('Graph error:', chunk.data);
    break;
  }
}
```

`'partial'` adds the context and summary to the response but not the graph state.

---

## Collect the full response

If you need the complete final response but want streaming for UI responsiveness, accumulate all non-delta message chunks:

```ts
async function streamToMessages(messages: any[]) {
  const stream = client.stream(messages);
  const finalMessages: any[] = [];

  for await (const chunk of stream) {
    // Only collect final (non-delta) message chunks
    if (chunk.event === 'message' && chunk.message && !chunk.message.delta) {
      finalMessages.push(chunk.message);
    }
  }

  return finalMessages;
}

const result = await streamToMessages([Message.text_message('What is 2+2?')]);
console.log('Final messages:', result);
```

This approach gives you streaming for better UX while still having a complete Message object to store or return.

---

## WebSocket streaming with wsStream()

`client.wsStream()` is a drop-in replacement for `client.stream()` that uses WebSocket instead of HTTP. The API is identical; the chunks, events, and options are the same. Only the underlying transport differs:

```ts
const stream = client.wsStream(
  [Message.text_message('Explain quantum computing.')],
  {
    config: { thread_id: 'ws-session-001' },
    response_granularity: 'low',
  }
);

for await (const chunk of stream) {
  if (chunk.event === 'message' && chunk.message?.delta) {
    const text = chunk.message.content
      .filter(b => b.type === 'text')
      .map(b => (b as any).text as string)
      .join('');
    process.stdout.write(text);
  }
}
```

### When to use each transport

| Aspect | `stream()` | `wsStream()` |
|--------|-----------|-------------|
| **Transport** | HTTP NDJSON body | WebSocket |
| **Connection** | One per invocation | Single persistent socket |
| **Tool call overhead** | New HTTP request per iteration | Resume message over same socket |
| **Browser auth** | `Authorization` header | `10xgraph-bearer` subprotocol |
| **Best for** | Simple chat, no remote tools | Tool-heavy graphs, low overhead |

Both methods emit identical `StreamChunk` sequences. If your graph makes remote tool calls (where the server asks the client to run a tool), `wsStream()` avoids the overhead of re-establishing a connection on each iteration. For simple text-only responses, they behave identically.

### WebSocket authentication

Browsers cannot set custom headers on WebSocket connections. The client sends the bearer token via the `Sec-WebSocket-Protocol` header using the `10xgraph-bearer` subprotocol:

```ts
const client = new TenxGraphClient({
  baseUrl: 'http://localhost:8000',
  authToken: 'your-jwt-token',
});
```

On Node.js 18 and 20, you must supply a WebSocket implementation (the `ws` package):

```ts
import WebSocket from 'ws';

const client = new TenxGraphClient({
  baseUrl: 'http://localhost:8000',
  authToken: process.env.API_TOKEN,
  webSocketImpl: WebSocket as unknown as typeof globalThis.WebSocket,
});
```

Node 21+ provides `globalThis.WebSocket` automatically.

### NDJSON format

`stream()` receives the response as newline-delimited JSON (NDJSON), one chunk per line. `wsStream()` receives the same chunk objects as individual JSON WebSocket messages:

```
{"event":"message","message":{"content":[{"type":"text","text":"The"}],"delta":true},...}
{"event":"message","message":{"content":[{"type":"text","text":" answer"}],"delta":true},...}
```

The client handles parsing automatically. You only need to know this if you inspect the raw HTTP body for debugging.

---

## Error handling

The stream ends gracefully if the graph completes successfully. If an error occurs, an `'error'` event is emitted:

```ts
for await (const chunk of stream) {
  if (chunk.event === 'error') {
    // chunk.data describes the failure, for example { status, node, reason } or { status: 'tool_failed', tool_name, ... }
    console.error('Graph error:', chunk.data);
    break; // Stop processing
  }

  if (chunk.event === 'message' && chunk.message?.delta) {
    // Process tokens as normal
  }
}
```

Common errors:

- **`AuthenticationError` (401)**: Missing or invalid token. Thrown before any chunk arrives.
- **`ValidationError`**: Invalid message format or state schema, or a request over the size limits. Thrown before any chunk arrives.
- **`ConflictError` (409)**: The thread is busy with another run, or `interrupt_id` does not match the open interrupt. Thrown before any chunk arrives.
- **`'error'` chunk**: A node or tool failed mid-run. Read `chunk.data` for the status and reason.

In production, the text in an `'error'` chunk is a generic message; development shows the details.

To control what happens when the thread is busy, pass `on_busy` (`'wait'`, the server default, or `'cancel'`). To answer an `interrupt()` pause, pass `resume` and `interrupt_id`:

```ts
const stream = client.stream([], {
  config: { thread_id: 'order-42' },
  resume: { approved: true },
  interrupt_id: 'int_abc123', // from the thread state or the interrupted update
});
```

`wsStream()` takes the same options. See [stream()](/docs/reference/client/stream).

Always handle the `'error'` event to prevent silent failures. The HTTP errors above are thrown by the generator as `TenxGraphError` subclasses, so wrap the `for await` loop in `try/catch`.

---

## Variations

### Response granularity options

- `'low'` (default): Only message tokens. Minimal bandwidth, best for simple chat.
- `'partial'`: Message tokens plus context and summary.
- `'full'`: Message tokens plus the graph state on chunks. Verbose; use only if you need it.

### Timeout and cancellation

Streams do not have a built-in timeout. If you need to cancel a stream early, break from the loop. The request stays in-flight on the server until it completes; see `/docs/client/graph-utilities` for how to request cancellation via `stopGraph()`.

### Backpressure and buffering

The `for await` loop respects backpressure automatically. If you slowly consume chunks (e.g., waiting for DOM updates), the underlying fetch/WebSocket connection will naturally throttle. No explicit buffering is needed.

---

## Common errors and fixes

**No output appears**

- Check that the server is running and `baseUrl` is correct.
- Enable `debug: true` in the client config to see verbose logs.
- Verify the message is not empty and the graph is defined.

**"No WebSocket implementation available"**

- You are on Node 18 or 20 and did not pass `webSocketImpl`.
- Install `npm install ws` and pass it in the config.

**Chunks arrive very slowly or in bursts**

- Normal behavior if the model is slow or the network is congested.

**Thread ID is undefined**

- Catch the thread ID from the first chunk: `if (chunk.thread_id) threadId = chunk.thread_id;`
- Pass an explicit `thread_id` in `config` to avoid this.

---

## Verification

To verify streaming works, run this in Node:

```ts
import { TenxGraphClient, Message } from '10xgraph-client';

const client = new TenxGraphClient({ baseUrl: 'http://localhost:8000' });

const stream = client.stream([
  Message.text_message('Write a haiku about mountains.'),
]);

for await (const chunk of stream) {
  if (chunk.event === 'message' && chunk.message?.delta) {
    const text = chunk.message.content
      .filter(b => b.type === 'text')
      .map(b => (b as any).text as string)
      .join('');
    process.stdout.write(text);
  }
}

console.log('\n\nDone.');
```

You should see a haiku print token by token, followed by a newline and "Done."

---

## What you learned

- `stream()` returns an `AsyncGenerator` that yields `StreamChunk` objects.
- Filter for `event === 'message'` to get text tokens.
- Use `chunk.message.delta` to differentiate partial tokens from complete messages.
- Pass `config.thread_id` to keep conversations on the same thread.
- `wsStream()` is identical to `stream()` but uses WebSocket for lower overhead with remote tools.
- Set `response_granularity: 'full'` to receive graph state alongside messages.

## Next steps

- `/docs/client/create-client`: Configure and initialize the client.
- `/docs/client/invoke-agent`: Single request/response without streaming.
- `/docs/client/manage-threads`: List, inspect, and delete threads.
- `/docs/client/graph-utilities`: Stop a stream early, inspect graph details.
- `/docs/client/nextjs-and-react`: Use streaming in React components.
- `/docs/concepts/streaming`: Streaming architecture and granularity.
