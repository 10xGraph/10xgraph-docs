---
title: Remote tools
description: Execute client-side tools from the agent graph, handling geolocation, clipboard, and other browser capabilities.
section: "TypeScript client"
group: "Features"
order: 60
updated: "2026-11-26"
---

Remote tools let your agent call functions that run in the browser or on the client machine. Use them for capabilities that only the client owns: geolocation, clipboard access, DOM manipulation, local file system access, or device sensors. Keep database, secrets, and backend work in server-side tools defined in your Python graph.

## How it works

When you invoke or stream the agent:

1. The Python graph calls a remote tool (one you declared in `10xgraph.json`).
2. The server returns a `RemoteToolCallBlock` to the client.
3. The client SDK finds your registered handler by name.
4. Your handler executes locally and returns a result.
5. The SDK wraps the result in a tool result message and sends it back.
6. The server continues the graph with the tool result.

This loop repeats until the graph is done or hits the recursion limit (default 25 calls).

## Step 1: Declare schemas in `10xgraph.json`

Declare each tool's `name`, `description`, JSON Schema `parameters` and the `node` of the `ToolNode` that offers it in `remote_tools` in the server's `10xgraph.json`, then restart the server. The server validates the entries at startup. Fields and rules: [Remote tools on the server](/docs/server/remote-tools#declaring-remote-tools-in-10xgraphjson).

## Step 2: Register matching handlers

On the client, register a handler function for each declared tool. Do this before calling `invoke()`, `stream()`, or `wsStream()`:

```ts
import { TenxGraphClient, Message } from '10xgraph-client';

const client = new TenxGraphClient({
  baseUrl: 'http://localhost:8000',
  authToken: 'your-bearer-token', // if auth is enabled
});

// Geolocation handler
client.registerToolHandler('get_location', async ({ high_accuracy = false }) => {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      reject,
      { enableHighAccuracy: high_accuracy }
    );
  });
});

// Clipboard handler
client.registerToolHandler('read_clipboard', async () => {
  const text = await navigator.clipboard.readText();
  return { content: text };
});
```

Handler requirements:

- **Signature:** `async (args: any) => Promise<any>`: the async function receives the tool arguments as a single object and must return a JSON-serializable value.
- **Arguments:** The model generates arguments based on the schema you declared in `10xgraph.json`. Destructure them as shown, or access them as properties: `args.high_accuracy`.
- **Return value:** Return JSON-safe data. `JSON.stringify` drops functions and `undefined`, and a circular value makes the `invoke()` or `stream()` call throw.
- **Errors:** If the handler throws, the error is caught and converted to a failed tool result. The agent sees the error message and can retry or handle it.

To check arguments in the client before your handler runs, register with `registerTool()` instead. `parameters` checks top-level types and `required`, `validate` refuses a call when it returns `false` or throws, and `maxArgsBytes` caps the argument size (default 1 MiB). A refused call reaches the model as a failed tool result, and the handler does not run.

```ts
client.registerTool({
  name: 'read_clipboard',
  handler: async () => ({ content: await navigator.clipboard.readText() }),
  validate: () => document.hasFocus(), // refuse while the tab is in the background
});
```

## Step 3: Invoke normally

Call `invoke()` or `stream()` as usual. The client detects remote tool calls and handles them internally:

```ts
// Simple invoke
const result = await client.invoke([
  Message.text_message("Where am I right now?", "user")
]);

console.log(result.messages);
// The agent has seen the location and replied.
```

Or stream with an async loop:

```ts
const stream = client.stream([
  Message.text_message("What's on my clipboard?", "user")
]);

for await (const chunk of stream) {
  if (chunk.event === 'message') {
    console.log('Agent:', chunk.message?.content);
  } else if (chunk.event === 'updates') {
    console.log('Update:', chunk.data);
  }
}
```

If a handler is missing, the SDK creates a failed tool result with the message `Tool '{name}' not found`. The agent sees this and may retry or ask for clarification.

## Recursion limit

Each `invoke()`, `stream()` or `wsStream()` call runs at most `recursion_limit` tool rounds (default 25); pass another value in the options, for example `{ recursion_limit: 50 }`. When the limit stops a loop that still has tool calls, `invoke()` returns `recursion_limit_reached: true` and `stream()` yields an `error` chunk with `data.recursion_limit_reached`.

## Errors and missing handlers

If a handler throws, is not registered, or its arguments are refused (see `registerTool()` above), or a call id repeats:

- The exception is caught at the client.
- A failed `ToolResultBlock` is created with `is_error: true` and the error message.
- The result is sent back to the server as a failed tool call.
- The agent sees the failure and can retry, ask for clarification, or continue.

Example:

```ts
// Handler throws
client.registerToolHandler('risky_tool', async () => {
  throw new Error('Something went wrong');
});

// When called, the error is caught and sent to the agent as a ToolResultBlock:
// output: { error: 'Something went wrong' }, is_error: true, status: 'failed'
```

Missing handlers produce a similar failure message:

```ts
// No handler registered for 'unregistered_tool'
// Agent receives output { error: "Tool 'unregistered_tool' not found" }, is_error: true, status: 'failed'
```

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Agent never calls the tool | Tool not declared in `remote_tools` or wrong `node` | Add it to `10xgraph.json` with the correct ToolNode name, then restart the API. |
| `Tool 'X' not found` error | Handler not registered or name mismatch | Register the handler with the exact name from `remote_tools[].name` before calling `invoke()` or `stream()`. Names are case-sensitive. |
| API startup fails with validation error | Typo in schema, duplicate tool name, or malformed parameters | Fix the `remote_tools` entry in `10xgraph.json`. The startup log names the entry. |

## Next steps

- See [create-client](/docs/client/create-client) for auth token options.
- See [stream-responses](/docs/client/stream-responses) for streaming patterns.
- See [graph-utilities](/docs/client/graph-utilities) for stop, fix, and other utilities.
- See [concepts/remote-tools](/docs/concepts/remote-tools) for the underlying design.
