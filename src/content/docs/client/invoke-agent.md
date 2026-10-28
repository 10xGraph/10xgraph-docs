---
title: Invoke the agent
description: Call client.invoke() to send messages to your agent and get back responses with full control over threading, error handling, and response structure.
section: TypeScript client
group: Basics
order: 30
label: Invoke the agent
updated: "2026-10-27"
faq:
  - question: How do I keep conversation history between calls?
    answer: Omit thread_id on the first call and read the id the server picked from result.meta.thread_id. Pass that thread_id in the config object on later calls. The same thread_id replays messages in order and maintains state, so the agent has context from earlier turns.
  - question: "What's the difference between response_granularity values?"
    answer: "'low' returns only messages (fastest, production); 'partial' adds context and summary; 'full' adds the graph state (debugging). Use 'low' unless you need the extra data."
  - question: How do I see what the agent is doing step by step?
    answer: Pass an onPartialResult callback to invoke(). It fires after each iteration, telling you if tool calls were made and when the run completes.
---

`client.invoke()` sends a message to your agent and waits for the final response. It handles multiple tool calls automatically, returns full state information, and supports persistent threads so conversations can span multiple API calls. This guide walks you through the core operations.

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

The call blocks until the agent completes, including all tool calls. The return value is an `InvokeResult` containing the final `messages` array, `meta` (thread info), `all_messages` (every message across tool iterations), `iterations`, and optionally `state`, `context` and `summary` depending on `response_granularity`.

You can also provide a system prompt by creating a message with role `'system'`:

```ts
const response = await client.invoke([
  Message.text_message('You are a helpful geography assistant.', 'system'),
  Message.text_message('What is the capital of France?'),
]);
```

## Extract the response text

The assistant's response is in `result.messages`. Find the last message with `role: 'assistant'`, then extract text from its `content` array:

```ts
const assistantMsg = [...response.messages].reverse().find(m => m.role === 'assistant');
if (assistantMsg) {
  const text = assistantMsg.content
    .filter(block => block.type === 'text')
    .map(block => (block as any).text)
    .join('');
  console.log(text);
}
```

For multimodal responses (images, audio, documents), the agent may include other block types. Check `block.type` to handle each one appropriately.

## Keep conversation history with threads

By default, each `invoke()` call without a `thread_id` starts a new thread. To keep conversation history, send the id of that thread back in the `config` object on later calls. The same thread replays all prior messages in order.

Do not invent the id. Omit `thread_id` on the first call. The server starts a thread and returns its id in `result.meta.thread_id`:

```ts
// First turn: no thread_id, so the server starts a new thread
const first = await client.invoke([Message.text_message('Tell me about Paris.')]);
console.log(first.messages[first.messages.length - 1].content);
const threadId = first.meta.thread_id;

// Second turn: the agent sees the first message and response automatically
const second = await client.invoke(
  [Message.text_message('And its history?')],
  { config: { thread_id: threadId } }
);
```

The result includes metadata about the thread: `result.meta.thread_id` (the ID used) and `result.meta.is_new_thread` (true when the server just started the thread).

<aside class="callout callout-warning" role="note"><p class="callout-title">Unknown thread ids get 403</p>
<p>By default the server only accepts the id of a thread that already exists. An id you made up answers <code>403</code>, the same as another user's thread. Store the id the server returns and reuse it. Operators can change this with <a href="/docs/reference/api-cli/configuration#thread_ids"><code>runs.thread_ids</code></a>.</p></aside>

## Control response size with granularity

The `response_granularity` option tells the server how much data to include in the response:

```ts
const response = await client.invoke(
  [Message.text_message('Summarize this document.')],
  {
    response_granularity: 'low',  // Fastest, messages only
  }
);
```

| Level | Includes | Best for |
|-------|----------|----------|
| `'low'` | Latest messages only | Production chat, minimal latency |
| `'partial'` | Messages + context + summary | Chats that show summaries or context |
| `'full'` | Messages + state | Debugging, admin dashboards |

In production, use `'low'` for the fastest response. Move to `'partial'` or `'full'` only if your UI needs the extra data. The `state` field of the result is only filled with `'full'`. The default for `invoke()` is `'full'`.

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

The `InvokePartialResult` gives you iteration count, whether tool calls were made, and whether the run is complete. This is useful for showing progress bars or logging in production.

## Handle errors gracefully

Network errors, authentication failures, and validation errors are thrown as exceptions. Catch `TenxGraphError` to handle specific HTTP status codes:

```ts
import { TenxGraphError } from '10xgraph-client';

try {
  const response = await client.invoke([
    Message.text_message('What is the meaning of life?'),
  ]);
  displayResponse(response.messages);
} catch (err) {
  if (err instanceof TenxGraphError) {
    switch (err.statusCode) {
      case 401:
        // Auth failed: token invalid or expired
        console.error('Not authenticated. Re-login.');
        redirectToLogin();
        break;
      case 403:
        // Auth succeeded but user lacks permission
        console.error('Permission denied for this agent.');
        break;
      case 500:
        console.error('Server error. Try again later.');
        break;
      default:
        console.error(`HTTP ${err.statusCode}: ${err.message}`);
    }
  } else {
    // Network error, timeout, etc.
    console.error('Connection failed:', err);
  }
}
```

See [Error handling](/docs/client/error-handling) for the full error type reference.

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

    const assistantMsg = [...result.messages].reverse().find(
      m => m.role === 'assistant'
    );
    if (!assistantMsg) return null;

    const text = assistantMsg.content
      .filter(block => block.type === 'text')
      .map(block => (block as any).text)
      .join('');
    return { text, threadId: result.meta.thread_id };
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

Compile the file to JavaScript with your usual TypeScript setup and run it with `node`.

## Verify the setup

If you see these errors, here are the fixes:

| Error | Cause | Fix |
|-------|-------|-----|
| `TypeError: Failed to fetch` | Server not running | Start it with `10xgraph api` |
| `TenxGraphError 401` | Token invalid or missing | Check `API_TOKEN` env var |
| Empty messages array | Agent has no output | Check the agent code for issues |

The agent should respond within seconds. If responses take too long, check the graph's tool calls and model configuration.

## What you learned

- Create messages with `Message.text_message()` and pass them to `client.invoke()`.
- Extract text from the response by filtering for `role === 'assistant'` and `block.type === 'text'`.
- Omit `thread_id` on the first call, then pass the returned `meta.thread_id` in the config to continue the conversation.
- Set `response_granularity` to 'low' for production, 'full' for debugging.
- Monitor progress with `onPartialResult` callbacks for multi-step agent runs.
- Catch `TenxGraphError` by status code to handle auth, permission, and server errors.

## Next steps

- Stream responses token-by-token in [Stream responses](/docs/client/stream-responses).
- Manage multiple conversations with [Manage threads](/docs/client/manage-threads).
- Run tools on the client side in [Remote tools](/docs/client/remote-tools).
- Build forms and UIs around invoke in [Next.js and React](/docs/client/nextjs-and-react).
