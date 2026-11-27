---
title: Invoke the agent
description: Call client.invoke() to send messages to your agent and get back responses with full control over threading, error handling, and response structure.
section: TypeScript client
group: Basics
order: 30
label: Invoke the agent
updated: "2026-11-26"
faq:
  - question: How do I keep conversation history between calls?
    answer: Omit thread_id on the first call and read the id the server picked from result.thread_id. Pass that thread_id in the config object on later calls. The same thread_id replays messages in order and maintains state, so the agent has context from earlier turns.
  - question: "What's the difference between response_granularity values?"
    answer: "'low' returns only messages (fastest, production); 'partial' adds context and summary; 'full' adds the graph state (debugging). Use 'low' unless you need the extra data."
  - question: How do I see what the agent is doing step by step?
    answer: Pass an onPartialResult callback to invoke(). It fires after each iteration, telling you if tool calls were made and when the run completes.
---

`client.invoke()` sends messages to your agent and waits for the final result, running client-side tool rounds for you. The call runs under the caller's identity, so a thread belongs to the user whose token sent it.

## Prerequisites

You need a configured `TenxGraphClient` instance and a 10xGraph API server with a compiled graph running. Set up both in [Create a client](/docs/client/create-client) first.

## Build and send a message

Messages are the fundamental unit of communication with the agent. Create a message using `Message.text_message()`, then pass it to `client.invoke()` in an array:

```ts
import { Message, TenxGraphClient } from '10xgraph-client';

const client = new TenxGraphClient({
  baseUrl: 'http://localhost:8000',
  auth: { type: 'bearer', token: 'your-token' },
});

const response = await client.invoke([
  Message.text_message('What is the capital of France?'),
]);
```

The call blocks until the agent completes, including all tool calls. The return value is an `InvokeResult` containing the final `messages` array, `thread_id`, `run_id`, `meta` (thread info), `all_messages` (every message across tool iterations), `iterations`, and optionally `state`, `context` and `summary` depending on `response_granularity`.

The server accepts only `user` messages from a client; a `system` or `assistant` message answers 422. Set the system prompt in the agent on the server.

## Extract the response text

The reply is the last message of `result.messages`. `text()` joins its text blocks:

```ts
console.log(response.messages.at(-1)?.text());
```

For images, audio or documents in a reply, read each block's `type` in `content`.

## Keep conversation history with threads

By default, each `invoke()` call without a `thread_id` starts a new thread. To keep conversation history, send the id of that thread back in the `config` object on later calls.

Do not invent the id. Omit `thread_id` on the first call. The server starts a thread and returns its id in `result.thread_id`:

```ts
// First turn: no thread_id, so the server starts a new thread
const first = await client.invoke([Message.text_message('Tell me about Paris.')]);
console.log(first.messages.at(-1)?.text());
const threadId = first.thread_id;

// Second turn: the agent sees the first message and response automatically
const second = await client.invoke(
  [Message.text_message('And its history?')],
  { config: { thread_id: threadId } }
);
```

The result includes `result.thread_id` (the ID used), `result.run_id` and `result.meta.is_new_thread` (true when the server just started the thread).

<aside class="callout callout-warning" role="note"><p class="callout-title">Unknown thread ids get 404</p>
<p>By default the server only accepts the id of a thread that already exists. An id you made up answers <code>404</code>, the same as another user's thread. Store the id the server returns and reuse it. Operators can change this with <a href="/docs/reference/api-cli/configuration#thread_ids"><code>runs.thread_ids</code></a>.</p></aside>

## Control response size with granularity

`response_granularity` sets how much comes back: `'low'` returns messages only, `'partial'` adds `context` and `summary`, and `'full'` adds `state`. `invoke()` defaults to `'full'`; pass `'low'` when your UI shows only messages:

```ts
const response = await client.invoke([Message.text_message('Summarize this document.')], {
  response_granularity: 'low',
});
```

## Monitor progress with partial results

When the agent makes multiple tool calls, you can see each step with the `onPartialResult` callback. It fires after every iteration:

```ts
const response = await client.invoke(
  [Message.text_message('Research the latest breakthroughs in quantum computing.')],
  {
    onPartialResult(partial) {
      console.log(`Iteration ${partial.iteration}:`);
      console.log(`  Tool calls: ${partial.has_tool_calls}`);
      if (partial.is_final) {
        console.log('  Agent finished.');
      }
    },
  }
);
console.log(`Completed in ${response.iterations} steps.`);
```

The `InvokePartialResult` gives you iteration count, whether tool calls were made, and whether the run is complete.

## Handle errors gracefully

Failures are thrown as `TenxGraphError` subclasses, including timeouts and network errors:

```ts
import { AuthenticationError, NotFoundError, TenxGraphError } from '10xgraph-client';

try {
  const response = await client.invoke([Message.text_message('Hello')], {
    config: threadId ? { thread_id: threadId } : undefined,
  });
} catch (err) {
  if (err instanceof AuthenticationError) {
    redirectToLogin(); // token missing, expired or revoked
  } else if (err instanceof NotFoundError) {
    threadId = undefined; // unknown thread: the next call starts a new one
  } else if (err instanceof TenxGraphError) {
    console.error(`${err.statusCode} ${err.errorCode}: ${err.message}`);
  } else {
    throw err;
  }
}
```

Which errors to retry: [Handle errors](/docs/client/error-handling).

## Complete working example

This example creates a client, invokes the agent in a loop to simulate a conversation, and extracts text from each response:

```ts
import {
  TenxGraphClient,
  Message,
  TenxGraphError,
} from '10xgraph-client';

const client = new TenxGraphClient({
  baseUrl: 'http://localhost:8000',
  auth: { type: 'bearer', token: process.env.API_TOKEN || '' },
});

async function askAgent(
  question: string,
  threadId?: string
): Promise<{ text: string; threadId: string } | null> {
  try {
    const result = await client.invoke(
      [Message.text_message(question)],
      {
        // Omit thread_id on the first call. The server starts a thread and returns its id.
        config: threadId ? { thread_id: threadId } : undefined,
        response_granularity: 'low',
      }
    );

    return { text: result.messages.at(-1)?.text() ?? '', threadId: result.thread_id };
  } catch (err) {
    if (err instanceof TenxGraphError) {
      console.error(`Agent error [${err.statusCode}]: ${err.message}`);
    } else {
      console.error('Unexpected error:', err);
    }
    return null;
  }
}

// Example usage
(async () => {
  const first = await askAgent('What is quantum entanglement?');
  console.log('Agent:', first?.text);

  // Continue on the thread the server started
  const second = await askAgent('Can you explain it more simply?', first?.threadId);
  console.log('Agent:', second?.text);
})();
```

## Next steps

- Stream responses token-by-token in [Stream responses](/docs/client/stream-responses).
- Manage multiple conversations with [Manage threads](/docs/client/manage-threads).
- Run tools on the client side in [Remote tools](/docs/client/remote-tools).
- Build forms and UIs around invoke in [Next.js and React](/docs/client/nextjs-and-react).
