---
title: Stream responses
description: Process agent responses token-by-token with client.stream() and client.wsStream().
section: "TypeScript client"
group: "Basics"
order: 40
label: Stream responses
updated: "2026-11-26"
---

`client.stream()` and `client.wsStream()` let you process the agent's response as it arrives, chunk by chunk, instead of waiting for the complete response. This guide shows you how to consume streams, handle different event types, and manage long-running operations.

## Prerequisites

- A configured client. See [Create the client](/docs/client/create-client).
- The 10xGraph API server running.

---

## Core concepts

The stream methods return an `AsyncGenerator` that yields `StreamChunk` objects as the server emits them. Each chunk carries:

- `event`: The type of update (`message`, `updates`, `state`, `error`)
- `message`: Partial or complete model response (when event is `message`)
- `state`: Graph state, on `state` chunks (`'partial'` and `'full'` granularity)
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

---

## Filter for message chunks

The majority of chunks you receive have `event === 'message'`. To extract and display token-by-token output, filter for message events and check the `delta` field:

When a message is streaming, the server sends many chunks with `message.delta === true`. After the message completes, it sends one final chunk with `delta === false`. Reasoning arrives as `{ type: 'reasoning' }` blocks in `content`, ordered before the text. A delta carries only the new piece of reasoning; the final message carries the full reasoning block.

---

## Differentiate partial and complete messages

Most use cases require separate handling for partial tokens (e.g., display them in a text buffer) and complete messages (e.g., save them to state or swap out a loading placeholder):

```ts
let currentMessage = '';

for await (const chunk of stream) {
  if (chunk.event !== 'message' || chunk.message?.role !== 'assistant') continue;

  const text = chunk.message.text();

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

Omit `config.thread_id` on the first call. The server starts a new thread, picks its id and sends it on every chunk. Pass that id as `config.thread_id` on later calls to keep the conversation on the same thread:

```ts
let threadId: string | undefined;

const stream = client.stream(
  [Message.text_message('What can you do?')],
  { response_granularity: 'low' }
);

for await (const chunk of stream) {
  if (chunk.thread_id) threadId = chunk.thread_id;
  if (chunk.event === 'message' && chunk.message?.delta) {
    const text = chunk.message.content
      .filter(b => b.type === 'text')
      .map(b => (b as any).text as string)
      .join('');
    process.stdout.write(text);
  }
}
```

The thread ID appears on every chunk as `chunk.thread_id` and `chunk.metadata?.thread_id`. Store it and send it back on the next call. Do not invent an id: by default the server answers `404` for a thread that does not exist.

---

## Receive state updates

At the default `'low'` granularity you get `message` and `error` chunks plus pause updates. `'partial'` adds a `state` chunk after each node; `'full'` adds every `updates` chunk and a final summary chunk:

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
    // Lifecycle update: node started or finished, pause, final summary
    console.log('Update:', chunk.data?.status);
  } else if (chunk.event === 'state') {
    // Full state snapshot at this point in execution
    console.log('Full state:', chunk.state);
  } else if (chunk.event === 'error') {
    console.error('Graph error:', chunk.data);
    break;
  }
}
```

---

## WebSocket streaming with wsStream()

`client.wsStream()` is a drop-in replacement for `client.stream()` that uses WebSocket instead of HTTP. The API is identical; the chunks, events, and options are the same. Only the underlying transport differs:

```ts
const stream = client.wsStream(
  [Message.text_message('Explain quantum computing.')],
  { response_granularity: 'low' } // no thread_id: the server starts a thread
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

`wsStream()` keeps one socket open for the whole call, so client-side tool rounds do not open new HTTP requests. Use it when the graph calls [client-side tools](/docs/client/remote-tools) often; otherwise `stream()` is enough.

Socket authentication and the `ws` package on Node 20 are covered in [Secure your frontend](/docs/client/secure-your-frontend#rule-2-websocket-authentication) and [Create the client](/docs/client/create-client#websocket-support-on-node-20).

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

To control what happens when the thread is busy, pass `on_busy` (`'wait'`, the server default, or `'cancel'`). Answering an `interrupt()` pause is covered in [Graph utilities](/docs/client/graph-utilities#human-in-the-loop-detect-and-answer-a-pause).

An `'error'` chunk is yielded, not thrown. HTTP errors, a timeout (`RequestTimeoutError`) and a stream cut mid-chunk (`StreamError`) are thrown by the generator, so also wrap the `for await` loop in `try/catch`.

---

## Variations

### Timeout and cancellation

The client `timeout` is an idle timeout on a stream: it fires when no data arrives for that long, not when the whole run takes long. To cancel, pass `signal` from an `AbortController`, or break out of the loop; both close the connection. To be sure the run stops on the server, also call `stopGraph(threadId)` ([Graph utilities](/docs/client/graph-utilities#stopgraph)).

---

## Common errors and fixes

**No output appears**

- Check that the server is running and `baseUrl` is correct.
- Enable `debug: true` in the client config to see verbose logs.
- Verify the message is not empty and the graph is defined.

**"No WebSocket implementation available"**

- You are on Node 20 and did not pass `webSocketImpl`.
- Install `npm install ws` and pass it in the config.

**Thread ID is undefined**

- Catch the thread ID from the first chunk: `if (chunk.thread_id) threadId = chunk.thread_id;`
- Pass the id of an existing thread in `config` to continue it. Do not make up a new one.

---

## Next steps

- [Create the client](/docs/client/create-client): configure and initialize the client.
- [Invoke the agent](/docs/client/invoke-agent): one request, one result.
- [Manage threads](/docs/client/manage-threads): list, inspect and delete threads.
- [Graph utilities](/docs/client/graph-utilities): stop a run, answer a pause.
- [Next.js and React](/docs/client/nextjs-and-react): streaming in React components.
- [Streaming concepts](/docs/concepts/streaming): chunk model and granularity.
