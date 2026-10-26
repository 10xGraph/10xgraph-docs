---
title: "TenxGraphClient"
seoTitle: "TenxGraphClient reference (TypeScript)"
description: "Complete reference for the TenxGraphClient class, constructor config, method list, and exports."
section: Reference
group: "TypeScript client"
order: 460
label: "TenxGraphClient"
updated: "2026-10-26"
---

`TenxGraphClient` is the main class of the `10xgraph-client` package. It wraps the 10xGraph REST and WebSocket endpoints in one typed object, so a TypeScript or JavaScript app can invoke, stream, manage threads, use memory and files, and run client-side tools without writing fetch code.

The package also exports tool, authentication and error types, plus request and response types for every endpoint. The class lives in `src/client.ts` of the client source.

## Installation

Install the package with npm or any compatible package manager. The class keeps its code name, `TenxGraphClient`.

```bash
npm install 10xgraph-client
```

## Import

Every class, function and type on this page is a named export of the package root.

```ts
import { TenxGraphClient } from '10xgraph-client';
```

## Constructor

The constructor takes one `TenxGraphConfig` object. Only `baseUrl` is required. All settings are fixed for the life of the instance, so create a new client to change a token or header.

```ts
new TenxGraphClient(config: TenxGraphConfig)
```

### `TenxGraphConfig`

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `baseUrl` | `string` | Yes | none | Full base URL of your 10xGraph API server, e.g. `http://localhost:8000`. A trailing slash is stripped when building WebSocket URLs, so avoid one. |
| `authToken` | `string \| null` | No | `undefined` | Convenience shorthand for `Bearer` token auth. Equivalent to `auth: { type: 'bearer', token: '...' }`. If both `authToken` and `auth` are set, `auth` wins for HTTP and WebSocket requests. |
| `auth` | `TenxGraphAuth \| null` | No | `undefined` | Structured auth configuration. See [Client auth](/docs/reference/client/auth) and the Authentication section below. |
| `headers` | `HeadersInit` | No | `undefined` | Additional HTTP headers appended to every request. Use this for custom tracing headers or API gateway keys. |
| `credentials` | `RequestCredentials` | No | `undefined` | The `credentials` option forwarded to the underlying `fetch` call (e.g. `'include'` for cookie-based sessions). |
| `timeout` | `number` | No | `300000` | Per-request timeout in milliseconds (default 5 minutes). A falsy value such as `0` falls back to the default. Set a lower value in latency-sensitive UIs. |
| `debug` | `boolean` | No | `false` | Enable verbose `console.debug` / `console.info` logging of every request and response. Useful during development; disable in production. |
| `webSocketImpl` | `typeof WebSocket` | No | `undefined` | WebSocket implementation for `wsStream()` and `realtime()`. Browsers and Node 21+ have a global `WebSocket` and need nothing here; on Node 18/20 pass the [`ws`](https://www.npmjs.com/package/ws) package. |

<aside class="callout callout-note" role="note"><p class="callout-title">Auth on WebSocket routes</p>

`wsStream()` and `realtime()` send only a bearer token, as the `agentflow-bearer` WebSocket subprotocol (never in the URL). `auth` takes precedence over `authToken`, as for HTTP. If `auth` is `basic` or `header`, no bearer token is sent on the socket, so use a bearer token for these methods.

</aside>

### Create a client

This example builds a client with bearer auth and a shorter timeout. Run it in Node 18+ or a browser.

```ts
import { TenxGraphClient } from '10xgraph-client';

const client = new TenxGraphClient({
  baseUrl: 'http://localhost:8000',
  auth: { type: 'bearer', token: process.env.API_TOKEN! },
  timeout: 120_000, // 2 minutes
  debug: false,
});

console.log((await client.ping()).data); // server pong string
```

## Method Overview

`TenxGraphClient` groups its public methods into seven areas. The tables below list each method with its return type; the linked reference pages give the request and response shapes.

### Graph control

| Method | Returns | Description |
|---|---|---|
| `ping()` | `Promise<PingResponse>` | Health check. Returns `{ data, metadata }` where `data` is the server's pong string. |
| `graph()` | `Promise<GraphResponse>` | Fetch graph metadata including `id_type`, `id_generator`, and state schema information. |
| `graphStateSchema()` | `Promise<StateSchemaResponse>` | Fetch the schema of the graph's state type. |
| `stopGraph(threadId, config?)` | `Promise<StopGraphResponse>` | Interrupt a running graph execution for `threadId`. |
| `fixGraph(threadId, config?)` | `Promise<FixGraphResponse>` | Remove incomplete tool-call messages from a thread's state (useful after an interrupted run). |
| `graphTools()` | `Promise<GraphToolsResponse>` | List the tools every tool node exposes, grouped by node, each tagged `local`, `mcp`, or `remote`. |
| `observability(threadId, runId?)` | `Promise<ObservabilityResponse>` | Fetch the reconstructed trace (spans, events, token usage) for a thread's latest run, or a specific `runId`. |

See [Graph](/docs/reference/client/graph) for full details on the graph-control methods.

### Invoke and stream

| Method | Returns | Description |
|---|---|---|
| `invoke(messages, options?)` | `Promise<InvokeResult>` | Send messages and receive the final result. Runs remote tool call loops automatically. See [Invoke](/docs/reference/client/invoke). |
| `stream(messages, options?)` | `AsyncGenerator<StreamChunk>` | Send messages and receive a stream of chunks as they are produced. See [Stream](/docs/reference/client/stream). |
| `wsStream(messages, options?)` | `AsyncGenerator<StreamChunk>` | Same options and chunks as `stream()`, but over one persistent WebSocket (`/v1/graph/ws`), which avoids a new HTTP request for each remote tool-call round. |

### Realtime audio

| Method | Returns | Description |
|---|---|---|
| `realtime(init, options?)` | `RealtimeSession` | Open a transport-only audio session over `/v1/graph/live`. Send PCM16 in, receive PCM16 out, with transcripts, tool calls, and auto reconnect/resume. See [Realtime](/docs/reference/client/realtime). |

### Threads and state

| Method | Returns | Description |
|---|---|---|
| `threads(request?)` | `Promise<ThreadsResponse>` | List threads. `request` is `{ search?, offset?, limit? }`. |
| `threadDetails(threadId)` | `Promise<ThreadDetailsResponse>` | Fetch metadata for a single thread. |
| `threadState(threadId)` | `Promise<ThreadStateResponse>` | Fetch the full state snapshot for a thread. |
| `updateThreadState(threadId, config, state)` | `Promise<UpdateThreadStateResponse>` | Write a new state snapshot for a thread. |
| `clearThreadState(threadId)` | `Promise<ClearThreadStateResponse>` | Delete all checkpointed state for a thread. |
| `threadMessages(threadId, request?)` | `Promise<ThreadMessagesResponse>` | List messages in a thread with optional search and pagination. |
| `addThreadMessages(threadId, messages, config?, metadata?)` | `Promise<AddThreadMessagesResponse>` | Deprecated. Append messages to a thread's history. Needs the admin scope `checkpointer:import`. |
| `updateThreadMessageFeedback(threadId, messageId, feedback)` | `Promise<UpdateThreadMessageFeedbackResponse>` | Set `metadata.feedback` on a message. |
| `singleMessage(threadId, messageId)` | `Promise<ThreadMessageResponse>` | Fetch a single message by ID. |
| `deleteMessage(threadId, messageId, config?)` | `Promise<DeleteThreadMessageResponse>` | Delete a message by ID. |
| `deleteThread(threadId, config?)` | `Promise<DeleteThreadResponse>` | Delete a thread and all its state and messages. |

See [Threads](/docs/reference/client/threads) for full details.

### Memory store

| Method | Returns | Description |
|---|---|---|
| `storeMemory(request)` | `Promise<StoreMemoryResponse>` | Store a new memory entry. |
| `searchMemory(request)` | `Promise<SearchMemoryResponse>` | Vector or keyword search over stored memories. |
| `getMemory(memoryId, options?)` | `Promise<GetMemoryResponse>` | Fetch a single memory by ID. |
| `updateMemory(memoryId, content, options?)` | `Promise<UpdateMemoryResponse>` | Update an existing memory. |
| `deleteMemory(memoryId, options?)` | `Promise<DeleteMemoryResponse>` | Delete a memory by ID. |
| `listMemories(options?)` | `Promise<ListMemoriesResponse>` | List all stored memories with optional pagination. |
| `forgetMemories(options?)` | `Promise<ForgetMemoriesResponse>` | Bulk-delete memories by type, category, or filter. |

See [Memory](/docs/reference/client/memory) for full details.

### Files and media

| Method | Returns | Description |
|---|---|---|
| `uploadFile(file)` | `Promise<FileUploadResponse>` | Upload an image, audio, or document file. Returns `file_id` and access URL. |
| `getFile(fileId)` | `Promise<Blob>` | Download a file by ID as a raw `Blob`. |
| `getFileInfo(fileId)` | `Promise<FileInfoResponse>` | Fetch metadata (MIME type, size, extracted text) for a stored file. |
| `getFileAccessUrl(fileId)` | `Promise<FileAccessUrlResponse>` | Get the best access URL for a file (signed URL for cloud storage, or a direct API URL). |
| `getMultimodalConfig()` | `Promise<MultimodalConfigResponse>` | Fetch the server's multimodal configuration (storage backend, max size, etc.). |

See [Files](/docs/reference/client/files) for full details.

### Remote tools

| Method | Returns | Description |
|---|---|---|
| `registerToolHandler(name, handler)` | `void` | Register only the client-side handler for a tool whose schema is declared in the server config. |
| `registerTool(registration)` | `void` | Register a handler with optional `node`, `description` and `parameters` metadata, which stay local. |

See [Remote tools](/docs/client/remote-tools) for the how-to guide.

## Tool registration and execution

The client owns a `ToolExecutor` that stores your remote tool handlers and runs them when the server returns a remote tool call. You normally use `registerToolHandler()` and never touch the executor; it is exported for custom setups.

### ToolExecutor

```ts
export class ToolExecutor {
  constructor(tools?: ToolDefinition[]);
  registerTool(registration: ToolRegistration): void;
  getToolsForNode(node: string): ToolDefinition[];
  all_tools(): Tool[];
  executeToolCalls(messages: Message[]): Promise<Message[]>;
}
```

`executeToolCalls` finds `remote_tool_call` blocks in the messages and runs each handler. It returns tool messages with status `completed`, or `failed` when the handler throws or the tool name is unknown. `all_tools()` returns the registered tools in OpenAI function format, filling missing parameter schemas with `{ type: 'object', properties: {}, required: [] }`.

### ToolRegistration

`ToolRegistration` is the object passed to `registerTool()`. Only `name` and `handler` are required.

```ts
export interface ToolRegistration {
  node?: string;                      // optional node name
  name: string;                       // tool name
  description?: string;               // user-facing description
  parameters?: ToolParameter;         // JSON Schema for arguments
  handler: ToolHandler;               // async (args) => Promise<any>
}
```

### ToolDefinition

`ToolDefinition` is the stored form of a tool: a callable handler with metadata properties attached.

```ts
export interface ToolDefinition extends ToolHandler {
  name: string;
  description?: string;
  parameters?: ToolParameter;
  node?: string;
}

export interface ToolHandler {
  (args: any): Promise<any>;
}
```

## Authentication

The client supports bearer, basic and custom-header authentication through the `TenxGraphAuth` union. The package also exports the helpers `bearerAuth(token)`, `basicAuth(username, password)` and `headerAuth(name, value, prefix?)` that build these objects.

### TenxGraphAuth types

```ts
// Bearer token
export interface TenxGraphBearerAuth {
  type: 'bearer';
  token: string;
}

// HTTP Basic
export interface TenxGraphBasicAuth {
  type: 'basic';
  username: string;
  password: string;
}

// Custom header
export interface TenxGraphHeaderAuth {
  type: 'header';
  name: string;
  value: string;
  prefix?: string | null;  // sent as `${prefix} ${value}` when set
}

export type TenxGraphAuth = TenxGraphBearerAuth | TenxGraphBasicAuth | TenxGraphHeaderAuth;
```

### Pass auth in the config

Set `auth` in the client config. Bearer and basic set the `Authorization` header; header auth sets the header you name.

```ts
import { TenxGraphClient } from '10xgraph-client';

const client = new TenxGraphClient({
  baseUrl: 'http://localhost:8000',
  auth: {
    type: 'bearer',
    token: process.env.API_TOKEN!,
  },
});
```

Or use the shorthand for Bearer tokens:

```ts
import { TenxGraphClient } from '10xgraph-client';

const client = new TenxGraphClient({
  baseUrl: 'http://localhost:8000',
  authToken: process.env.API_TOKEN!,
});
```

## Error handling

Every method throws an `TenxGraphError` (or a specific subclass) when the server returns a non-2xx response. The error carries structured information for logging and recovery logic.

### TenxGraphError properties

| Property | Type | Description |
|---|---|---|
| `statusCode` | `number` | HTTP status code. |
| `errorCode` | `string` | Machine-readable code from the server body. |
| `requestId` | `string` | Server-generated request id, or `'unknown'` if the body could not be parsed. |
| `timestamp` | `string` | ISO timestamp of the failure. |
| `details` | `ErrorDetail[]` | Field-level validation failures (empty if none). |
| `endpoint` | `string \| undefined` | Endpoint that failed. |
| `method` | `string \| undefined` | HTTP method used. |
| `context` | `Record<string, any> \| undefined` | Extra context from the server. |
| `recoverySuggestion` | `string \| undefined` | Human-readable hint for specific error types. |

### Helper methods

| Method | Returns | Description |
|---|---|---|
| `getUserMessage()` | `string` | Message with `recoverySuggestion` appended. Safe to show in a UI. |
| `toJSON()` | `Record<string, any>` | All fields plus `name` and `stack`, for structured logging. |

### Catch and retry errors

This example retries once on a transient storage error and logs any other client error. It assumes `client` from above.

```ts
import { TenxGraphError, Message, TransientStorageError } from '10xgraph-client';

const userMessage = Message.text_message('Hello', 'user');

try {
  await client.invoke([userMessage]);
} catch (err) {
  if (err instanceof TransientStorageError) {
    // Safe to retry: call invoke again, ideally after a short delay
    await client.invoke([userMessage]);
  } else if (err instanceof TenxGraphError) {
    console.error(err.getUserMessage());
    logger.error(err.toJSON());
  } else {
    throw err;
  }
}
```

For the complete error taxonomy and helper functions, see [Client errors](/docs/reference/client/errors).

## Request helpers

The package exports `RequestContext`, `parseErrorResponse` and `createErrorFromResponse` for code that calls the API with `fetch` directly, for example a proxy server. `parseErrorResponse` returns the JSON error body or `null`; `createErrorFromResponse` turns a failed response into a typed `TenxGraphError`.

```ts
export interface RequestContext {
  baseUrl: string;
  authToken?: string | null;
  auth?: TenxGraphAuth | null;
  headers?: HeadersInit;
  credentials?: RequestCredentials;
  timeout: number;
  debug: boolean;
  webSocketImpl?: WebSocketImpl;
}

export async function parseErrorResponse(response: Response): Promise<ApiErrorResponse | null>;
export async function createErrorFromResponse(
  response: Response,
  fallbackMessage?: string,
  endpoint?: string,
  method?: string
): Promise<TenxGraphError>;
```

Use `createErrorFromResponse()` to build typed errors from a failed `fetch` response:

```ts
import { createErrorFromResponse } from '10xgraph-client';

const base = 'http://localhost:8000';
const init: RequestInit = {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ messages: [] }),
};

const response = await fetch(`${base}/v1/graph/invoke`, init);
if (!response.ok) {
  throw await createErrorFromResponse(response, 'Invoke failed', '/v1/graph/invoke', 'POST');
}
```

## Summary

The `TenxGraphClient` class wraps the 10xGraph REST API and WebSocket endpoints in a single, strongly typed interface. The package also exports `ToolExecutor` and related types for client-side tool execution, `TenxGraphAuth` types for three authentication methods, request/response structures for every endpoint, and error classes with recovery suggestions.

## Next steps

Start with [Create a client](/docs/client/create-client) to set up and configure the client. Then:

- [Invoke](/docs/reference/client/invoke) for the `invoke()` method.
- [Stream](/docs/reference/client/stream) for streaming chunks.
- [Threads](/docs/reference/client/threads) for thread and state management.
- [Graph utilities](/docs/client/graph-utilities) for `stopGraph()`, `fixGraph()` and observability.
- [Client errors](/docs/reference/client/errors) for the full error taxonomy.
