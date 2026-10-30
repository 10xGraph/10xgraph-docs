---
title: stream()
seoTitle: stream() in the TypeScript client
description: "Reference for TenxGraphClient.stream(): send messages and receive StreamChunk objects in real time, with options, event types and examples."
section: Reference
group: TypeScript client
order: 500
label: stream()
updated: "2026-10-27"
---

`client.stream()` sends a list of messages to the agent graph and returns an `AsyncGenerator` that yields `StreamChunk` objects as the server produces them. Use it to show incremental output (token by token, update by update) instead of waiting for the full response. For a single final result, use `invoke()`.

**Endpoint:** `POST /v1/graph/stream`  
**Source:** `src/endpoints/stream.ts`

```ts
import { TenxGraphClient, Message, StreamEventType } from '10xgraph-client';
```

---

## Signature

```ts
client.stream(
  messages: Message[],
  options?: StreamOptions
): AsyncGenerator<StreamChunk, void, unknown>
```

`stream()` is synchronous: it returns the generator immediately without making a network call. The HTTP request starts when you begin iterating with `for await`.

---

## Parameters

### `messages`

Same as [`invoke()`](/docs/reference/client/invoke#parameters). An array of `Message` objects.

### `options` (optional)

| Field | Type | Default | Description |
|---|---|---|---|
| `initial_state` | `Record<string, any>` | `undefined` | Initial state values to seed the graph. |
| `config` | `Record<string, any>` | `undefined` | Run config. Set `thread_id` at the top level of this object to continue an existing thread. Omit it to start a new one; the server picks the id and sends it on each chunk as `thread_id`. |
| `recursion_limit` | `number` | `25` | Maximum recursion depth for the graph. |
| `on_busy` | `'wait' \| 'cancel'` | server default (`'wait'`) | What the server does when another run is active on the same thread. `'wait'` queues behind it for up to 30 seconds, then fails with `ConflictError`. `'cancel'` stops the running run and starts this one. |
| `resume` | `unknown` | none | The answer to an `interrupt()` pause on the thread (any JSON value, `null` to cancel). Pass an empty `messages` array with it. |
| `interrupt_id` | `string` | none | The id of the interrupt `resume` answers. The client does not track ids: pass the one you got from the server (`execution_meta.interrupt_data.interrupt.id` in the thread state, or the `interrupt` object of the `interrupted` update). A mismatch fails with `ConflictError`. |
| `response_granularity` | `'full' \| 'partial' \| 'low'` | `'low'` | How much data the server returns: `'full'` is state plus latest messages, `'partial'` is context, summary and latest messages, `'low'` is latest messages only. Streaming defaults to `'low'`, unlike `invoke()` which defaults to `'full'`. |

---

## Return value: `AsyncGenerator<StreamChunk>`

The generator yields `StreamChunk` objects. Iteration ends when the server closes the stream.

### `StreamChunk`

```ts
interface StreamChunk {
  event: StreamEventType | string;
  message?: Message | null;
  state?: AgentState | null;
  data?: any;
  thread_id?: string;
  run_id?: string;
  metadata?: StreamMetadata | Record<string, any>;
  timestamp?: number;
}

interface StreamMetadata {
  is_new_thread: boolean;
  thread_id: string;
  [key: string]: any;
}
```

---

## `StreamEventType`

The `event` field on a `StreamChunk` is a string matching one of these values (exported as the `StreamEventType` enum):

| Event | Enum value | Description |
|---|---|---|
| `'message'` | `StreamEventType.MESSAGE` | A new or updated `Message` from the agent. The `message` field contains the full `Message` object. On streaming models this fires multiple times with partial token content (`message.delta = true`), followed by a final chunk with `delta = false`. |
| `'updates'` | `StreamEventType.UPDATES` | A graph execution update, such as a node starting or finishing. Inspect `chunk.data`, `chunk.state` and `chunk.metadata` for details. |
| `'state'` | `StreamEventType.STATE` | A state snapshot in the `state` field. Use `'full'` granularity if you need state in your responses. |
| `'error'` | `StreamEventType.ERROR` | An error occurred during graph execution. The `data` field contains the error details. |

---

## Async iterator examples

### Basic streaming

```ts
import { TenxGraphClient, Message, StreamEventType } from '10xgraph-client';

const client = new TenxGraphClient({ baseUrl: 'http://localhost:8000' });

const stream = client.stream([
  Message.text_message('Write me a short poem about the ocean.'),
]);

for await (const chunk of stream) {
  if (chunk.event === StreamEventType.MESSAGE && chunk.message) {
    const textBlock = chunk.message.content.find(b => b.type === 'text');
    if (textBlock && 'text' in textBlock) {
      process.stdout.write(textBlock.text);
    }
  }
}
console.log('\n--- Stream complete ---');
```

### Streaming with state updates

```ts
const stream = client.stream(
  [Message.text_message('Analyse this dataset.')],
  {
    response_granularity: 'full',
  }
);

for await (const chunk of stream) {
  switch (chunk.event) {
    case StreamEventType.MESSAGE:
      if (chunk.message?.delta) {
        // Partial token: append to UI
        appendTokenToUI(chunk.message);
      } else if (chunk.message) {
        // Final message: replace partial content
        setFinalMessage(chunk.message);
      }
      break;

    case StreamEventType.UPDATES:
      console.log('State updated:', chunk.state);
      break;

    case StreamEventType.STATE:
      console.log('Full state snapshot:', chunk.state);
      break;

    case StreamEventType.ERROR:
      console.error('Stream error:', chunk.data);
      break;
  }
}
```

### Streaming in a React component

```tsx
import { useState } from 'react';
import { TenxGraphClient, Message, StreamEventType } from '10xgraph-client';

const client = new TenxGraphClient({ baseUrl: 'http://localhost:8000' });

function ChatBox() {
  const [output, setOutput] = useState('');

  async function sendMessage(text: string) {
    setOutput('');

    const stream = client.stream([Message.text_message(text)]);

    for await (const chunk of stream) {
      if (chunk.event === StreamEventType.MESSAGE && chunk.message?.delta) {
        const textBlock = chunk.message.content.find(b => b.type === 'text');
        if (textBlock && 'text' in textBlock) {
          setOutput(prev => prev + textBlock.text);
        }
      }
    }
  }

  return (
    <div>
      <button onClick={() => sendMessage('Hello!')}>Send</button>
      <pre>{output}</pre>
    </div>
  );
}
```

### Collecting the full response from a stream

This helper reads only the final (`delta: false`) messages, so partial tokens are not counted twice:

```ts
async function streamToString(messages: Message[]): Promise<string> {
  const stream = client.stream(messages);
  let fullText = '';

  for await (const chunk of stream) {
    if (chunk.event === StreamEventType.MESSAGE && chunk.message && !chunk.message.delta) {
      for (const block of chunk.message.content) {
        if (block.type === 'text' && 'text' in block) {
          fullText += block.text;
        }
      }
    }
  }

  return fullText;
}
```

### Stopping a stream mid-way

Breaking out of the loop stops reading locally, but the server keeps running the graph until you call `stopGraph()` with the thread ID:

```ts
const stream = client.stream([Message.text_message('Tell me a very long story')]);
let threadId: string | undefined; // the server picks it and sends it on each chunk
let wordCount = 0;

for await (const chunk of stream) {
  if (chunk.thread_id) threadId = chunk.thread_id;
  if (chunk.event === StreamEventType.MESSAGE && chunk.message) {
    const textBlock = chunk.message.content.find(b => b.type === 'text');
    if (textBlock && 'text' in textBlock) {
      wordCount += textBlock.text.split(' ').length;
    }
  }

  if (wordCount > 500) {
    // Request a server-side stop, then stop iterating locally
    if (threadId) await client.stopGraph(threadId);
    break;
  }
}
```

---

## `StreamRequest` (advanced)

The shape of the request body sent to `POST /v1/graph/stream`:

```ts
interface StreamRequest {
  messages: any[];
  initial_state?: Record<string, any>;
  config?: Record<string, any>;
  recursion_limit?: number;       // default 25
  on_busy?: 'wait' | 'cancel';
  resume?: unknown;
  interrupt_id?: string;
  response_granularity?: 'full' | 'partial' | 'low';
}
```

---

## Stream format

The server sends the stream as **NDJSON** (newline-delimited JSON) over HTTP. Each line is a JSON object matching the `StreamChunk` shape. The client's parser also handles concatenated JSON objects (no newlines) for compatibility with some proxy configurations.

The server sets the response header `Content-Type: application/x-ndjson`. The body is NDJSON, not Server-Sent Events framing. The client skips the blank keep-alive lines the server sends while a run is silent.

Example raw stream output:

```
{"event":"message","message":{"role":"assistant","content":[{"type":"text","text":"The"}],"delta":true},"thread_id":"abc123"}
{"event":"message","message":{"role":"assistant","content":[{"type":"text","text":" capital"}],"delta":true},"thread_id":"abc123"}
{"event":"message","message":{"role":"assistant","content":[{"type":"text","text":" of France is Paris."}],"delta":false},"thread_id":"abc123"}
{"event":"updates","data":{"node":"MAIN"},"thread_id":"abc123"}
```

### Using curl

```bash
curl --no-buffer -X POST http://localhost:8000/v1/graph/stream \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -d '{
    "messages": [{ "role": "user", "content": [{"type": "text", "text": "Hello"}], "message_id": "0" }],
    "response_granularity": "low"
  }'
```

---

## invoke() vs stream() comparison

| Aspect | `invoke()` | `stream()` |
|---|---|---|
| Network requests | One per loop iteration | One streaming connection per loop iteration |
| When result arrives | After full graph execution | Token by token in real time |
| Default `response_granularity` | `'full'` | `'low'` |
| Remote tool handling | Automatic loop | Automatic loop, chunks are still yielded as they arrive |
| Return type | `Promise<InvokeResult>` | `AsyncGenerator<StreamChunk>` |
| Best for | Background tasks, batch | Chat UIs, real-time displays |

---

## Common errors

| Error | Cause | Fix |
|---|---|---|
| `TenxGraphError` status `401` | Missing or invalid auth. | Set `auth` in the client config. See [auth](/docs/reference/client/auth). |
| `Request timeout after Nms` | The connection exceeded the client `timeout`. | Raise `timeout` in the client config or retry. |
| Stream stops mid-response | Server timeout or network issue. | Wrap the `for await` loop in try/catch and retry. |
| `ConflictError` (409) | The thread is busy with another run, or `interrupt_id` does not match the open interrupt. Thrown before any chunk arrives. | Wait and retry, set `on_busy: 'cancel'`, or fetch the current interrupt id. |
| `event: 'error'` chunks | Graph execution error. | Read `chunk.data` for the error message and check server logs. In production the message is generic. |

---

## What you learned

- `stream()` returns an `AsyncGenerator`: iterate it with `for await`.
- `StreamEventType.MESSAGE` with `delta: true` is a partial token; `delta: false` is the final message.
- `response_granularity` defaults to `'low'` for streaming; use `'full'` when you need state.
- Remote tool calls are executed automatically between stream iterations, up to `recursion_limit`.
- Use `stopGraph()` to cancel a running stream on the server.

## Next step

See [`reference/client/threads`](/docs/reference/client/threads) to learn how to manage persistent conversation threads.
