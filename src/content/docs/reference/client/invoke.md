---
title: "invoke()"
seoTitle: "invoke() in the TypeScript client"
description: "Reference for TenxGraphClient.invoke(): send messages to the agent graph, run remote tools automatically, and get the final result."
section: Reference
group: "TypeScript client"
order: 490
label: "invoke()"
updated: "2026-10-27"
faq:
  - q: "When should I use invoke() instead of stream()?"
    a: "Use invoke() when you need the complete answer before updating your UI or returning from a function. Use stream() when you want tokens or messages as they are produced."
  - q: "How do I continue a conversation across invoke() calls?"
    a: "Omit thread_id on the first call. The server starts a thread and returns its id in result.meta.thread_id. Pass that id at the top level of the config option on later calls."
  - q: "Why does invoke() make more than one HTTP request?"
    a: "When the agent asks for a remote tool, the client runs your registered handler locally and sends the result back in a new request. This repeats until no remote tool calls remain or recursion_limit is reached."
---

`client.invoke()` sends messages to the agent graph and resolves with the final result. If the agent asks for a remote tool, the client runs your registered handler and calls the server again, repeating until the agent answers or `recursion_limit` is reached. For incremental output, use [`stream()`](/docs/reference/client/stream).

**Endpoint:** `POST /v1/graph/invoke`

## Signature

`invoke()` takes an array of `Message` objects and an optional options object, and returns a promise of `InvokeResult`. It is a method of `TenxGraphClient`, so create a client first (see [Client](/docs/reference/client/client)).

```ts
import { TenxGraphClient, Message } from '10xgraph-client';

// client.invoke(messages, options?) => Promise<InvokeResult>
invoke(
  messages: Message[],
  options?: {
    initial_state?: Record<string, any>;
    config?: Record<string, any>;
    recursion_limit?: number;
    on_busy?: 'wait' | 'cancel';
    resume?: unknown;
    interrupt_id?: string;
    response_granularity?: 'full' | 'partial' | 'low';
    onPartialResult?: InvokeCallback;
  }
): Promise<InvokeResult>
```

## Parameters

The first parameter carries the conversation input and the second tunes the run. Only `messages` is required.

### messages

`messages` is an array of `Message` objects. The last one is normally the user's input, and you can add a `system` message before it. Each message is serialised before sending. If `message_id` is `null` or `undefined`, the payload uses `"0"` and the server assigns a real id.

```ts
import { Message } from '10xgraph-client';

// A system message sets the persona, the user message is the input
const systemMsg = Message.text_message('You are a concise assistant.', 'system');
const userMsg = Message.text_message('What is 2 + 2?');
```

### options

All options are optional. The defaults below are the values the client applies when you omit the option.

| Option | Type | Default | Description |
|---|---|---|---|
| `initial_state` | `Record<string, any>` | none | State values to seed the graph. Sent only on the first request of a call, not on the follow-up requests that return tool results. |
| `config` | `Record<string, any>` | none | Run configuration. Put `thread_id` at the top level of this object to continue an existing thread. Omit it to start a new one. |
| `recursion_limit` | `number` | `25` | Maximum number of requests the client makes in one `invoke()` call. The server accepts values from 1 to 100. |
| `on_busy` | `'wait' \| 'cancel'` | server default (`'wait'`) | What the server does when another run is active on the same thread. `'wait'` queues behind it for up to 30 seconds, then fails with `ConflictError`. `'cancel'` stops the running run and starts this one. Needs a `10xgraph-api` version that supports it. |
| `resume` | `unknown` | none | The answer to an `interrupt()` pause on the thread (any JSON value, `null` to cancel). Pass an empty `messages` array with it. |
| `interrupt_id` | `string` | none | The id of the interrupt `resume` answers. The client does not track ids: pass the one you got from the server (`execution_meta.interrupt_data.interrupt.id` in the thread state, or the `interrupt` object of the `interrupted` update). A mismatch fails with `ConflictError`. |
| `response_granularity` | `'full' \| 'partial' \| 'low'` | `'full'` | How much data the server returns per request. See [Response granularity](#response-granularity). |
| `onPartialResult` | `InvokeCallback` | none | Called after every request with that iteration's results. |

## Return value

`invoke()` resolves with an `InvokeResult`. The `messages`, `state`, `context`, `summary` and `meta` fields come from the last server response. `all_messages` collects everything across iterations.

| Field | Type | Description |
|---|---|---|
| `messages` | `Message[]` | Messages from the last response. |
| `state` | `AgentState` (optional) | Graph state, when the granularity includes it. |
| `context` | `Message[]` (optional) | Context messages, when the granularity includes them. |
| `summary` | `string \| null` (optional) | Conversation summary, when the granularity includes it. |
| `meta` | `InvokeMetadata` | `thread_id` (string) and `is_new_thread` (boolean). |
| `all_messages` | `Message[]` | Every message from every iteration, including your tool results. |
| `iterations` | `number` | How many requests were made. |
| `recursion_limit_reached` | `boolean` | `true` when `iterations` reached `recursion_limit`. |

`recursion_limit_reached` is computed from the iteration count, so it is also `true` when the final answer arrived exactly on the last allowed iteration. Check the last message for pending remote tool calls if you need to tell the two cases apart.

Use `meta.thread_id` to continue a conversation in a later call:

```ts
// First turn: no thread_id, so the server starts a thread and picks its id
const first = await client.invoke([Message.text_message('Hi')]);

// Second turn: reuse the id reported by the server
const followUp = await client.invoke([Message.text_message('Tell me more')], {
  config: { thread_id: first.meta.thread_id },
});
```

## Response granularity

`response_granularity` decides which parts of the graph output the server includes. Messages are always returned; the rest depends on the value.

| Value | Returns | When to use |
|---|---|---|
| `'full'` | Messages and full state | Debugging, or when your UI reads graph state. |
| `'partial'` | Messages, context and summary | When you need context or the summary but not the full state. |
| `'low'` | Messages only | Chat UIs that only render messages. Smallest payload. |

The client sends `'full'` when you omit the option. The server's own default is `low`, but a call through `TenxGraphClient` never relies on it.

## Progress callback

`onPartialResult` receives an `InvokePartialResult` after each request, before any tool handlers run. It is the way to show progress during a multi-step run without switching to streaming. The client awaits the callback, so an async callback delays the next iteration.

```ts
interface InvokePartialResult {
  iteration: number;
  messages: Message[];
  state?: AgentState;
  context?: Message[];
  summary?: string | null;
  meta: InvokeMetadata;
  has_tool_calls: boolean; // the response contains remote tool calls
  is_final: boolean;       // no remote tool calls, this is the last iteration
}

type InvokeCallback = (partial: InvokePartialResult) => void | Promise<void>;
```

```ts
// Log progress while the agent works
const result = await client.invoke([Message.text_message('Weather in Paris?')], {
  onPartialResult(partial) {
    if (partial.has_tool_calls) {
      console.log(`Iteration ${partial.iteration}: running tools`);
    }
    if (partial.is_final) {
      console.log('Final answer received');
    }
  },
});
```

## Remote tool call loop

The client resolves remote tool calls for you. When a response contains a `remote_tool_call` content block and a `ToolExecutor` is available (it is, on every `TenxGraphClient`), the client runs the matching handler and sends the results back.

1. The client posts your messages to `/v1/graph/invoke`.
2. If any response message holds a `remote_tool_call` block, the client passes those messages to its tool executor, which calls the handlers you registered with `client.registerToolHandler()`.
3. The tool result messages are added to `all_messages` and posted to the same endpoint as the next request.
4. Steps 2 and 3 repeat until a response has no remote tool calls or `recursion_limit` is reached.

Only the first request carries `initial_state`. `resume` and `interrupt_id` are sent on the first request of a call only, not on the follow-up requests that return tool results. `on_busy` is sent on every request.

Resume a paused thread like this:

```ts
const result = await client.invoke([], {
  config: { thread_id: 'order-42' },
  resume: { approved: true },
  interrupt_id: 'int_abc123',
});
```

 See [Register remote tools](/docs/client/remote-tools) for how to register handlers.

## InvokeRequest

`InvokeRequest` is the body type of one request. You only need it if you call the endpoint yourself. The client adds `messages` in serialised form and fills the other fields from your options.

```ts
interface InvokeRequest {
  messages: any[];                  // serialised Message objects
  initial_state?: Record<string, any>;
  config?: Record<string, any>;
  recursion_limit?: number;
  on_busy?: 'wait' | 'cancel';
  resume?: unknown;
  interrupt_id?: string;
  response_granularity?: 'full' | 'partial' | 'low';
}
```

## Examples

The examples assume a server running at `http://localhost:8000`.

### Minimal invoke

This call sends one user message and prints the first content block of the first returned message.

```ts
import { TenxGraphClient, Message } from '10xgraph-client';

const client = new TenxGraphClient({ baseUrl: 'http://localhost:8000' });

const result = await client.invoke([
  Message.text_message('What is the capital of Japan?'),
]);

// Example output, the text depends on your agent
console.log(result.messages[0].content[0]);
// { type: 'text', text: 'The capital of Japan is Tokyo.' }
```

### Chat on a persistent thread

Reusing one `thread_id` makes the server load the saved state, so the agent remembers earlier turns. This needs a checkpointer on the server. Do not invent the id: the first call omits it and the server returns it. By default the server answers `403` for an id that does not exist.

```ts
import { TenxGraphClient, Message } from '10xgraph-client';

const client = new TenxGraphClient({ baseUrl: 'http://localhost:8000' });
let threadId: string | undefined; // set from the first response

async function chat(userInput: string): Promise<string> {
  const result = await client.invoke([Message.text_message(userInput)], {
    config: threadId ? { thread_id: threadId } : undefined,
    response_granularity: 'low', // messages only
  });
  threadId = result.meta.thread_id;

  // Pick the assistant's text block out of the returned messages
  const assistantMsg = result.messages.find((m) => m.role === 'assistant');
  const textBlock = assistantMsg?.content.find((b) => b.type === 'text');
  return (textBlock as { text?: string } | undefined)?.text ?? '';
}

await chat('Hello!');
console.log(await chat('What did I just say?')); // sees the previous turn
```

### Seed the graph with initial state

`initial_state` sets state keys before the run. Use keys that exist in your graph's state schema. The server answers 422 for `context_summary`, `execution_meta`, an unknown `current_node`, or a value of the wrong type. Do not put identity such as a user ID in state and trust it on the server, because any client can set it.

```ts
const result = await client.invoke([Message.text_message('Continue where we left off')], {
  initial_state: { user_preferences: { language: 'en', theme: 'dark' } },
});
```

## Common errors

A non-2xx response throws a subclass of `TenxGraphError`, chosen by status code. See [Errors](/docs/reference/client/errors) for the full list and the fields on each error.

| Error | Cause | Fix |
|---|---|---|
| `AuthenticationError` (401) | Missing or invalid credentials. | Set `authToken` or `auth` in the client config. |
| `ValidationError` (422) | The server rejected the payload, for example an empty `messages` array. | Send at least one message and check `config`. |
| `ConflictError` (409) | The thread is busy with another run (after the server waited 30 seconds), or `interrupt_id` does not match the open interrupt. | Wait and send again, set `on_busy: 'cancel'`, or fetch the current interrupt id. The client never retries it. |
| `ServerError` (500, 502, 503, 504) | The graph failed or the server is unavailable. | Check the server logs, then retry. |
| `Error: Request timeout after <n>ms` | One request exceeded the client `timeout` (default 300000 ms). | Raise `timeout` in the client config or shorten the graph. |
| `recursion_limit_reached: true` | The loop used all allowed iterations. | Raise `recursion_limit` (maximum 100), or check that tools return and do not loop. |

## Related pages

- [Invoke an agent](/docs/client/invoke-agent) walks through using `invoke()` in an app.
- [Register remote tools](/docs/client/remote-tools) explains handlers for the tool loop.
- [`stream()`](/docs/reference/client/stream) returns output incrementally.
