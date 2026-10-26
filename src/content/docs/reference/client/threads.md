---
title: Threads
seoTitle: "Thread methods in the TypeScript client"
description: "Reference for listing, inspecting, updating and deleting conversation threads, state and messages with the 10xGraph TypeScript client."
section: Reference
group: "TypeScript client"
order: 520
label: Threads
updated: "2026-10-26"
---

A thread is one conversation stored by the server's checkpointer: an ordered list of messages plus a state snapshot. The `TenxGraphClient` thread methods list threads, read and edit their state and messages, and delete them. They all call the `/v1/threads` routes and need a checkpointer on the server.

```ts
import { TenxGraphClient, Message } from '10xgraph-client';

const client = new TenxGraphClient({ baseUrl: 'http://localhost:8000' });
```

<aside class="callout callout-note" role="note"><p class="callout-title">A checkpointer is required</p>

If the server was started without a checkpointer, every thread route returns HTTP 503 ("Checkpointer is not configured"). To create threads from the client, pass `thread_id` in the `config` of an invoke or stream call. See [Invoke](/docs/reference/client/invoke) and [Checkpointing and threads](/docs/concepts/checkpointing-and-threads).

</aside>

Every method accepts `threadId` as `string | number`. Failed requests throw `TenxGraphError` (see [Errors](/docs/reference/client/errors)).

| Method | HTTP route | Purpose |
|---|---|---|
| `threads` | `GET /v1/threads` | List threads, with search and pagination |
| `threadDetails` | `GET /v1/threads/{thread_id}` | Fetch one thread's metadata |
| `threadState` | `GET /v1/threads/{thread_id}/state` | Read the state snapshot |
| `updateThreadState` | `PUT /v1/threads/{thread_id}/state` | Merge new values into the state |
| `clearThreadState` | `DELETE /v1/threads/{thread_id}/state` | Delete the state snapshot |
| `threadMessages` | `GET /v1/threads/{thread_id}/messages` | List messages |
| `addThreadMessages` | `POST /v1/threads/{thread_id}/messages` | Deprecated. Append messages without running the graph (admin scope) |
| `singleMessage` | `GET /v1/threads/{thread_id}/messages/{message_id}` | Fetch one message |
| `updateThreadMessageFeedback` | `PUT /v1/threads/{thread_id}/messages/{message_id}` | Set feedback on a message |
| `deleteMessage` | `DELETE /v1/threads/{thread_id}/messages/{message_id}` | Delete one message |
| `deleteThread` | `DELETE /v1/threads/{thread_id}` | Delete a thread |

Every response has the shape `{ data, metadata }`, where `metadata` is a `ResponseMetadata`.

## List and inspect threads

`threads` returns a page of threads, optionally filtered by a search string. `threadDetails` returns the stored record for one thread.

### `threads`

```ts
client.threads(): Promise<ThreadsResponse>
client.threads(request: ThreadsRequest): Promise<ThreadsResponse>
client.threads(search?: string, offset?: number, limit?: number): Promise<ThreadsResponse>
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `search` | `string` | none | Search string passed to the checkpointer. |
| `offset` | `number` | none | Records to skip. Must be 0 or more. |
| `limit` | `number` | 100 | Page size. Must be above 0. The server caps it at 1000. |

Returns `ThreadsResponse`, with the threads at `response.data.threads`:

```ts
interface ThreadItem {
  thread_id: string;
  thread_name: string | null;
  user_id: string | null;
  metadata: Record<string, any> | null;
  updated_at: string | null;
  run_id: string | null;
}
```

```ts
// List threads three ways: defaults, request object, positional arguments
const first = await client.threads();
const searched = await client.threads({ search: 'paris', offset: 0, limit: 20 });
const positional = await client.threads('paris', 0, 20);
console.log(first.data.threads.length, searched.data.threads[0]?.thread_id, positional.metadata);
```

### `threadDetails`

```ts
client.threadDetails(threadId: string | number): Promise<ThreadDetailsResponse>
```

Returns the thread record at `response.data.thread_data.thread`, a `Record<string, any>`.

```ts
const response = await client.threadDetails('thread-123');
console.log(response.data.thread_data.thread);
```

## Read and edit thread state

The state snapshot holds the graph's `AgentState` for a thread. Read it with `threadState`, merge values into it with `updateThreadState`, and remove it with `clearThreadState`. The thread's messages are separate and are not touched by these calls.

### `threadState`

```ts
client.threadState(threadId: string | number): Promise<ThreadStateResponse>
```

Returns the snapshot at `response.data.state`.

```ts
const response = await client.threadState('thread-123');
console.log(response.data.state);
```

### `updateThreadState`

```ts
client.updateThreadState(
  threadId: string | number,
  config: Record<string, any>,
  state: any
): Promise<UpdateThreadStateResponse>
```

| Parameter | Type | Description |
|---|---|---|
| `threadId` | `string \| number` | The thread to update. |
| `config` | `Record<string, any>` | Config sent in the request body. Pass `{}` if you have nothing to add. |
| `state` | `any` | Partial state to merge in. |

The server merges `state` into the stored snapshot instead of replacing it. Dictionaries are deep-merged, other values overwrite, `null` values do not erase existing ones, and `context` messages are appended. The server answers 422 for `context_summary` or `execution_meta` in `state`, for `context` messages that are not user messages (a `tool` message is accepted only as `tool_result` blocks answering a pending client tool call), for `context` messages that carry tool calls, and for a value that does not match its state field type. Custom fields are allowed unless the operator set `runs.state_keys`. Any `message_id` you send is replaced by the server. Returns the merged state at `response.data.state`.

```ts
// Merge one key into the stored state
const response = await client.updateThreadState('thread-123', {}, {
  user_preferences: { lang: 'fr' },
});
console.log(response.data.state);
```

### `clearThreadState`

```ts
client.clearThreadState(threadId: string | number): Promise<ClearThreadStateResponse>
```

Deletes the state snapshot. Returns `response.data` as `{ success, message, data }`, where `data` is a boolean.

```ts
const response = await client.clearThreadState('thread-123');
console.log(response.data.success);
```

## List and manage messages

Messages are the thread's conversation history. You can read them with search and pagination, append messages without running the graph, and delete single messages.

### `threadMessages`

```ts
client.threadMessages(threadId, request: { search?: string; offset?: number; limit?: number })
client.threadMessages(threadId, search?: string, offset?: number, limit?: number)
```

Both forms return `Promise<ThreadMessagesResponse>`, with the list at `response.data.messages`. `search`, `offset` and `limit` follow the same rules and defaults as `threads`.

```ts
// Search a thread's messages, 50 at a time
const response = await client.threadMessages('thread-123', {
  search: 'capital',
  offset: 0,
  limit: 50,
});
console.log(response.data.messages.length);
```

### `addThreadMessages`

```ts
client.addThreadMessages(
  threadId: string | number,
  messages: Message[],
  config: Record<string, any> = {},
  metadata?: Record<string, any>
): Promise<AddThreadMessagesResponse>
```

Deprecated. Appends messages to the thread without running the graph. The server route needs the `checkpointer:import` scope, which only admin identities hold. A normal user gets HTTP 403. The server rejects any message that carries a tool call (HTTP 422), because only the model may request tools. To attach feedback to a message, use [`updateThreadMessageFeedback`](#updatethreadmessagefeedback). Returns `response.data` as `{ success, message, data }`.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `threadId` | `string \| number` | required | The thread to append to. |
| `messages` | `Message[]` | required | Build text messages with `Message.textMessage(text, role)`. |
| `config` | `Record<string, any>` | `{}` | Config sent in the request body. |
| `metadata` | `Record<string, any>` | `{}` sent | Optional metadata stored with the messages. |

```ts
// Admin identities only: append a system message to an existing thread
await client.addThreadMessages(
  'thread-123',
  [Message.textMessage('You are a travel guide.', 'system')],
  {},
  { injected_by: 'setup' }
);
```

### `updateThreadMessageFeedback`

```ts
client.updateThreadMessageFeedback(
  threadId: string | number,
  messageId: string,
  feedback: Record<string, any>
): Promise<UpdateThreadMessageFeedbackResponse>
```

Sets `message.metadata.feedback` to the object you pass, replacing any earlier feedback. Nothing else on the message changes. Needs the `checkpointer:write` scope. Returns the updated message at `response.data`, in the same shape as `singleMessage`.

The server answers HTTP 422 when `feedback` is larger than 8192 serialized bytes or nested deeper than 10 levels, 404 when the thread has no such message, and 501 when the server's core library is older than `10xgraph` 0.10.4.

```ts
const response = await client.updateThreadMessageFeedback('thread-123', 'msg-001', {
  rating: 'down',
  comment: 'Wrong city',
});
console.log(response.data.metadata?.feedback);
```

### `singleMessage`

```ts
client.singleMessage(threadId: string | number, messageId: string): Promise<ThreadMessageResponse>
```

Returns the message itself at `response.data`. The message ID must not be empty or whitespace.

```ts
const response = await client.singleMessage('thread-123', 'msg-001');
console.log(response.data.role, response.data.content);
```

### `deleteMessage`

```ts
client.deleteMessage(
  threadId: string | number,
  messageId: string,
  config?: Record<string, any>
): Promise<DeleteThreadMessageResponse>
```

Deletes one message. `config` is sent in the request body and defaults to `{}`. Returns `response.data` as `{ success, message, data }`.

```ts
await client.deleteMessage('thread-123', 'msg-001');
```

## Delete a thread

`deleteThread` removes the thread and cannot be undone. Use `clearThreadState` instead if you only want to drop the state snapshot.

```ts
client.deleteThread(threadId: string | number, config?: Record<string, any>): Promise<DeleteThreadResponse>
```

`config` is sent in the request body and defaults to `{}`. Returns `response.data` as `{ success, message, data }`.

```ts
await client.deleteThread('thread-123');
```

## Validation rules

The server checks these constraints and answers HTTP 422 when one fails.

| Input | Rule |
|---|---|
| `threadId` (string) | Not empty or whitespace. |
| `threadId` (number) | 1 or more. |
| `messageId` | Not empty or whitespace. |
| `offset` | 0 or more. |
| `limit` | Above 0. Values over 1000 are capped at 1000. |
| Messages and `context` you write | No tool calls. User messages only: `assistant` and `system` roles are refused, and a `tool` message must be `tool_result` blocks answering a pending client tool call. |
| State you write | No `context_summary` or `execution_meta`. Custom fields must match their state field types. |
| `feedback` | An object of at most 8192 serialized bytes and 10 levels deep. |

## Examples

### Page through every thread

```ts
import { TenxGraphClient } from '10xgraph-client';

const client = new TenxGraphClient({ baseUrl: 'http://localhost:8000' });

// Yield threads page by page until a short page signals the end
async function* allThreads(pageSize = 50) {
  let offset = 0;
  while (true) {
    const response = await client.threads({ offset, limit: pageSize });
    const { threads } = response.data;
    yield* threads;
    if (threads.length < pageSize) break;
    offset += threads.length;
  }
}

for await (const thread of allThreads()) {
  console.log(thread.thread_id, thread.thread_name);
}
```

### Print a conversation

```ts
import { TenxGraphClient } from '10xgraph-client';

const client = new TenxGraphClient({ baseUrl: 'http://localhost:8000' });

// Join the text blocks of each message into one line
const response = await client.threadMessages('thread-123', { offset: 0, limit: 100 });

for (const msg of response.data.messages) {
  const text = msg.content
    .filter((block) => block.type === 'text')
    .map((block) => (block as { text: string }).text)
    .join('');
  console.log(`[${msg.role}] ${text}`);
}
```

### Reset a thread

```ts
import { TenxGraphClient } from '10xgraph-client';

const client = new TenxGraphClient({ baseUrl: 'http://localhost:8000' });

// Drop only the state snapshot, keep the thread and its messages
await client.clearThreadState('thread-123');

// Or delete the thread entirely
await client.deleteThread('thread-123');
```

## Common errors

| Status | Cause | Fix |
|---|---|---|
| 503 | The server has no checkpointer configured. | Configure a checkpointer on the server. |
| 422 | A validation rule above failed, or a message carries a tool call. | Check the IDs, pagination values and message content. |

All of these surface as `TenxGraphError` with `statusCode` set. See [Errors](/docs/reference/client/errors).

## Next step

For long-term memories that outlive a single thread, see the [Memory reference](/docs/reference/client/memory).
