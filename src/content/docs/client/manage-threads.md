---
title: Manage threads
description: List, inspect, update, and delete conversation threads and messages from the TypeScript client.
section: "TypeScript client"
group: "Basics"
order: 50
label: Manage threads
updated: "2026-11-26"
faq:
  - question: "What happens if no checkpointer is configured?"
    answer: "The server falls back to InMemoryCheckpointer, so threads live only in that server process and are lost on restart. For persistence, compile the graph with a SQLite, Postgres+Redis, or custom checkpointer."
  - question: "Can I update thread state while a run is active?"
    answer: "No. State and message writes, deletes and fixGraph() take the thread's run lock, so while a run is active they fail at once with 409 (ConflictError). Call them after the run ends, or stop it first with stopGraph()."
  - question: "What's the difference between clearThreadState() and deleteThread()?"
    answer: "clearThreadState() removes only the state snapshot, keeping all messages. deleteThread() removes everything: state, messages, and thread metadata. Both are irreversible."
---

10xGraph stores conversation history and state in **threads**. This guide shows you how to manage threads from the TypeScript client: listing and searching threads, inspecting their messages and state, updating or clearing state, and deleting threads.

<aside class="callout callout-note" role="note"><p class="callout-title">Requires a configured checkpointer</p>

All thread operations use the checkpointer your graph was compiled with (`compile(checkpointer=...)`). If none is configured, threads live only in the server process memory and are lost on restart. For durable threads across server restarts, use a SQLite, Postgres+Redis, or custom checkpointer.

</aside>

## Prerequisites

- A configured `TenxGraphClient` instance. See [Create a client](/docs/client/create-client).

---

## List all threads

List the caller's threads (with reach `tenant` or `all`, every thread that reach covers). `threads()` also takes `filters` on your thread columns; see [threads()](/docs/reference/client/threads#threads).

```ts
const response = await client.threads();
const threads = response.data.threads;

console.log(`Found ${threads.length} thread(s)`);
for (const t of threads) {
  console.log(`  [${t.thread_id}] ${t.thread_name ?? '(no name)'}, updated: ${t.updated_at}`);
}
```

### Filter threads by name

Search for threads containing a keyword in their name:

```ts
const response = await client.threads({ search: 'Paris' });
const matchingThreads = response.data.threads;

for (const thread of matchingThreads) {
  console.log(`Matched: ${thread.thread_name}`);
}
```

### Paginate through threads

Retrieve threads in pages to handle large thread lists:

```ts
const response = await client.threads({ offset: 0, limit: 20 });
const firstPage = response.data.threads;
```

For iterating through all threads, use an async generator:

```ts
async function* allThreads(pageSize = 50) {
  let offset = 0;
  while (true) {
    const res = await client.threads({ offset, limit: pageSize });
    const page = res.data.threads;
    yield* page;
    if (!res.data.has_more) break;
    offset += page.length;
  }
}

// Iterate through all threads
for await (const thread of allThreads()) {
  console.log(`Processing: ${thread.thread_id}`);
}
```

---

## Fetch thread details

Get metadata for a single thread, including its ID, name, user, and timestamps:

```ts
const details = await client.threadDetails('thread-abc123');
const thread = details.data.thread_data.thread;

console.log(`Thread ID: ${thread.thread_id}`);
console.log(`Name: ${thread.thread_name ?? '(unnamed)'}`);
console.log(`Updated: ${thread.updated_at}`);
```

This is useful for displaying thread information in a UI or validating that a thread exists before performing operations on it.

---

## List and search messages in a thread

Retrieve all messages from a thread, optionally searching by content:

```ts
const messages = await client.threadMessages('thread-abc123', {});

for (const msg of messages.data.messages) {
  console.log(`[${msg.role.toUpperCase()}] ${msg.text().slice(0, 80)}`);
}
```

To search messages by keyword:

```ts
const results = await client.threadMessages('thread-abc123', {
  search: 'capital of France',
  limit: 10,
  offset: 0,
});

console.log(`Found ${results.data.messages.length} matching message(s)`);
```

Messages can be paginated using `offset` and `limit` parameters.

---

## Fetch a single message

Retrieve a specific message by its ID:

```ts
const msg = await client.singleMessage('thread-abc123', 'msg-001');
console.log(`Role: ${msg.data.role}`);
console.log(`Content: ${JSON.stringify(msg.data.content)}`);
```

Use this when you need to read or inspect a specific message without fetching the entire thread.

---

## Delete a message

Remove one message from the thread's history. To repair unanswered tool calls, use [`fixGraph()`](/docs/client/graph-utilities#fixgraph) instead:

```ts
await client.deleteMessage('thread-abc123', 'msg-001');
console.log('Message deleted');
```

The thread continues to exist with the remaining messages. `deleteMessage()` also accepts an optional third `config` argument.

---

## Inspect and update thread state

The thread state is the graph's state snapshot at the last checkpoint. You can read it, modify it, or reset it.

### Read the current state

```ts
const stateResponse = await client.threadState('thread-abc123');
const state = stateResponse.data.state;

console.log('Current state:', JSON.stringify(state, null, 2));
```

The state object shape depends on your graph's `StateGraph` definition. It contains the message context and any custom fields your graph stores.

### Update the state

Merge a partial state into a thread's stored state. Use this to inject values, repair state, or seed initial data. The server appends `context` messages to the existing context, deep-merges dictionaries, and ignores `null` values:

```ts
await client.updateThreadState(
  'thread-abc123',
  {},  // config (the thread_id comes from the path)
  {
    user_preferences: { language: 'fr', timezone: 'Europe/Paris' },
  }
);

console.log('State updated. Next invoke() will use this state.');
```

<aside class="callout callout-warning" role="note"><p class="callout-title">State updates are immediate</p>

`updateThreadState()` merges your values into the stored state and saves it. The next `invoke()` call continues from the merged state. Messages sent in `context` are appended, and the server rejects client-authored tool calls, assistant or system messages, and the built-in fields `context_summary` and `execution_meta` with a 422. Use with care: incorrect state can cause the agent to fail or behave unexpectedly. While a run is active on the thread, the call answers 409.

</aside>

### Clear the state

Remove the state snapshot without deleting messages. The thread exists but will start fresh on the next `invoke()` call:

```ts
await client.clearThreadState('thread-abc123');
console.log('State cleared. Thread messages remain.');
```

This is useful if you want to reset a conversation while keeping the message history.

---

## Set feedback on a message

Attach a rating or comment to a message with `updateThreadMessageFeedback`. It stores your object in `message.metadata.feedback` and replaces any earlier feedback. Nothing else on the message changes.

```ts
await client.updateThreadMessageFeedback('thread-abc123', 'msg-001', {
  rating: 'up',
  comment: 'Clear answer',
});
```

The object can be at most 8192 bytes serialized and 10 levels deep, otherwise the server returns 422. A missing message returns 404, and the API returns 501 when the checkpointer lacks `aupdate_message_metadata`. See [`updateThreadMessageFeedback`](/docs/reference/client/threads#updatethreadmessagefeedback).

---

## Delete a thread

Delete a thread and all its associated state and messages permanently. This operation is irreversible:

```ts
await client.deleteThread('thread-abc123');
console.log('Thread deleted');
```

After deletion the server no longer accepts the id (it answers 404). If you want to keep the message history but reset the state, use `clearThreadState()` instead.

---

## Troubleshooting: common errors

| Error | Cause | Solution |
|---|---|---|
| `NotFoundError` (404) | The thread does not exist or is outside the caller's reach. | Use an id the server returned. |
| `ConflictError` (409) | A run is active on the thread. | Retry after the run ends. |
| `422 Unprocessable Entity` | Invalid parameter, such as an empty or whitespace thread ID. | Ensure the thread ID is a non-empty string or a positive integer. |
| Empty `threads` list | No threads have been created yet, or the server restarted with the default in-memory checkpointer. | Run a test invocation to create a thread, and compile with a durable checkpointer for persistence. |
| `State is null` | The thread exists but has no state snapshot (e.g., after `clearThreadState()`). | Call `updateThreadState()` to set a state, or send a message with `invoke()`. |

---

## Next step

Learn how to store and retrieve long-term memories separate from conversation history. See [Memory API](/docs/client/use-memory-api).
