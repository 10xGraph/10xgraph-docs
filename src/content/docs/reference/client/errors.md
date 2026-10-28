---
title: "Error handling"
seoTitle: "Error handling reference (TypeScript)"
description: "Every error class exported by the TypeScript client, its status and error code, when it is thrown, and how to handle it."
section: Reference
group: "TypeScript client"
order: 560
label: "Error handling"
updated: "2026-10-27"
---

When the server returns a non-2xx response, `TenxGraphClient` throws an `TenxGraphError` or one of its 15 subclasses. The class is chosen from the response's error code first, then from the HTTP status. Network failures and client timeouts are not API errors: they throw a plain `Error`.

**Import:** `import { TenxGraphError } from '10xgraph-client';`

For the practical guide (retries, stream errors), see [Handle errors](/docs/client/error-handling). For the codes the server can return, see [Error codes](/docs/reference/error-codes).

## How the client picks an error class

The client reads the JSON error body, then matches the error `code` by prefix, then falls back to the HTTP status. A `GRAPH_RECURSION_ERROR` returned with status 500 therefore arrives as `GraphRecursionError`, not `ServerError`.

| Order | Match | Class |
|---|---|---|
| 1 | Code starts with `GRAPH_RECURSION` | `GraphRecursionError` |
| 2 | Code starts with `GRAPH` | `GraphError` |
| 3 | Code starts with `NODE` | `NodeError` |
| 4 | Code starts with `TRANSIENT_STORAGE` | `TransientStorageError` |
| 5 | Code starts with `STORAGE` | `StorageError` |
| 6 | Code starts with `METRICS` | `MetricsError` |
| 7 | Code starts with `SCHEMA_VERSION` | `SchemaVersionError` |
| 8 | Code starts with `SERIALIZATION` | `SerializationError` |
| 9 | Status 400, 401, 403, 404, 409, 422 | `BadRequestError`, `AuthenticationError`, `PermissionError`, `NotFoundError`, `ConflictError`, `ValidationError` |
| 10 | Status 500, 502, 503, 504 | `ServerError` |
| 11 | Any other status, including 429 | `TenxGraphError` with code `UNKNOWN_ERROR` (unless the body gave one) |

If the body is not JSON or cannot be parsed, the same status mapping applies with `requestId` set to `'unknown'`.

<aside class="callout callout-note" role="note"><p class="callout-title">Subclass-only fields are not filled by the client</p>

`context`, `nodeName`, `recursionLimit`, `expectedVersion` and `actualVersion` exist on the classes, but the client's own response parsing never sets them. They are `undefined` on errors the client throws; they are set only if you construct these classes yourself.

</aside>

## TenxGraphError (base class)

`TenxGraphError` extends the built-in `Error`; every other class on this page extends it. Check it last in an `instanceof` chain, after the specific subclasses.

| Property | Type | Description |
|---|---|---|
| `message` | `string` | Server error message, or the fallback message. |
| `statusCode` | `number` | HTTP status code. |
| `errorCode` | `string` | Machine-readable code, e.g. `VALIDATION_ERROR`. |
| `requestId` | `string` | `metadata.request_id` from the response, or `'unknown'`. |
| `timestamp` | `string` | `metadata.timestamp`, or the client's ISO 8601 time when missing. |
| `details` | `ErrorDetail[]` | Field-level details from the server. Empty array by default. |
| `context` | `Record<string, any> \| undefined` | Extra context (see the note above). |
| `endpoint` | `string \| undefined` | API path. Set only for unmapped status codes, and only if passed in. |
| `method` | `string \| undefined` | HTTP method. Same condition as `endpoint`. |
| `recoverySuggestion` | `string \| undefined` | Hint on how to fix the error. Set by the graph, node, storage, metrics, schema and serialization classes. |

Two methods are available on every error:

| Method | Returns | Description |
|---|---|---|
| `getUserMessage()` | `string` | `message`, plus `"\n\nSuggestion: ..."` when `recoverySuggestion` is set. |
| `toJSON()` | `Record<string, any>` | `name`, `message`, `statusCode`, `errorCode`, `requestId`, `timestamp`, `details`, `context`, `endpoint`, `method`, `recoverySuggestion` and `stack`. |

`toJSON()` includes the stack trace, so log it on the server but do not send it to end users.

```ts title="log-error.ts"
import { TenxGraphClient, TenxGraphError, Message } from '10xgraph-client';

const client = new TenxGraphClient({ baseUrl: 'http://localhost:8000' });

try {
  await client.invoke([Message.text_message('Hi')]);
} catch (err) {
  if (err instanceof TenxGraphError) {
    // Log structured details, show a safe message to the user.
    console.error(`Error ${err.statusCode} (${err.errorCode}): ${err.getUserMessage()}`);
    console.error(JSON.stringify(err.toJSON()));
  } else {
    throw err; // network failure or client-side timeout
  }
}
```

## HTTP status errors

These six classes map to one status each. They carry no recovery suggestion, so read `message` and `details`.

| Class | Status | Error code | Thrown when |
|---|---|---|---|
| `BadRequestError` | 400 | `BAD_REQUEST` | The server rejects the request as malformed. |
| `AuthenticationError` | 401 | `AUTHENTICATION_FAILED` | Credentials are missing, invalid or expired. |
| `PermissionError` | 403 | `PERMISSION_ERROR` | The caller is authenticated but not allowed to perform the action. With the default `runs.thread_ids`, a `thread_id` that does not exist or belongs to another user also gives this error. |
| `NotFoundError` | 404 | `RESOURCE_NOT_FOUND` | The thread, message, memory or file does not exist. |
| `ConflictError` | 409 | `CONFLICT` | The thread is still busy with another run after the server's 30 second wait, or a resume's `interrupt_id` does not match the open interrupt. The client never retries it. |
| `ValidationError` | 422 | `VALIDATION_ERROR` | The request body fails schema validation, is over a size limit (500 messages, 100 blocks per message, 1,000,000 characters of text), or a resume answer fails the interrupt's `response_schema`. The message names the size limit that was hit; `details` lists the failing fields (development only). |

```ts title="http-status-errors.ts"
import {
  TenxGraphClient,
  AuthenticationError,
  NotFoundError,
  ValidationError,
} from '10xgraph-client';

const client = new TenxGraphClient({ baseUrl: 'http://localhost:8000' });

try {
  await client.threadDetails('thread-123');
} catch (err) {
  if (err instanceof AuthenticationError) {
    window.location.href = '/login'; // token missing or expired
  } else if (err instanceof NotFoundError) {
    console.error('Thread not found.');
  } else if (err instanceof ValidationError) {
    // Each detail is { loc?, msg?, type? }.
    for (const detail of err.details) {
      console.error(`Field ${detail.loc?.join('.')}: ${detail.msg}`);
    }
  } else {
    throw err;
  }
}
```

### Handle a busy thread

The server runs one graph run at a time on a thread. A second call on a busy thread waits up to 30 seconds and then fails with `ConflictError`. Retry later, or send `on_busy: 'cancel'` to stop the running run and take its place:

```ts title="busy-thread.ts"
import { ConflictError, Message } from '10xgraph-client';

try {
  await client.invoke([Message.text_message('Hi')], {
    config: { thread_id: 'order-42' },
  });
} catch (err) {
  if (err instanceof ConflictError) {
    // Busy thread, or interrupt_id did not match. Check err.message.
    await client.invoke([Message.text_message('Hi')], {
      config: { thread_id: 'order-42' },
      on_busy: 'cancel',
    });
  } else {
    throw err;
  }
}
```

The same class covers a resume whose `interrupt_id` does not match the open interrupt. Do not retry that one with `on_busy`: read the thread state and send the current id.

The server's body for these errors is the standard envelope, with `error.code` set to `HTTPException`. The client picks `ConflictError` from the 409 status.

### Rate limit and run cap (429)

The server answers 429 in two cases: the `rate_limit` sliding window is exhausted, or one user already has `runs.max_concurrent_per_user` graph runs in flight (default 10). The client has no class for 429, so both arrive as a plain `TenxGraphError` with `statusCode` 429. Check `statusCode`, not `instanceof`.

- Rate limit: the body has `error.code` `RATE_LIMIT_EXCEEDED`, so `errorCode` is `RATE_LIMIT_EXCEEDED`, and the message ends with `Retry after <n>s.` The response also carries a `Retry-After` header (seconds).
- Run cap: the body is the standard envelope with `error.code` `HTTPException`, so `errorCode` is `HTTPException`. The message says too many runs are in progress for this user. There is no `Retry-After` header; wait for a run to finish.

The error object does not keep response headers, so `Retry-After` is not available on it. Read the seconds from the message, or use your own backoff.

```ts title="rate-limit.ts"
import { TenxGraphError } from '10xgraph-client';

try {
  await client.invoke([Message.text_message('Hi')]);
} catch (err) {
  if (err instanceof TenxGraphError && err.statusCode === 429) {
    // Back off, then retry. err.errorCode is RATE_LIMIT_EXCEEDED for the rate limit.
  } else {
    throw err;
  }
}
```

### ServerError

`ServerError` covers status 500, 502, 503 and 504 when the error code does not match a more specific class. Its `errorCode` is the server's code, or `INTERNAL_SERVER_ERROR` when absent, and `statusCode` is the actual status.

Treat 502, 503 and 504 as usually transient and retry them with backoff. Do not retry a 500 blindly: it is often a bug in a node or tool.

```ts title="server-error.ts"
import { TenxGraphClient, Message, ServerError } from '10xgraph-client';

const client = new TenxGraphClient({ baseUrl: 'http://localhost:8000' });

try {
  await client.invoke([Message.text_message('Hi')]);
} catch (err) {
  if (err instanceof ServerError && [502, 503, 504].includes(err.statusCode)) {
    console.warn('Gateway or availability problem, retry later.');
  } else {
    throw err;
  }
}
```

## Graph and node errors

These classes mean the graph failed while running. Each has status 500 and its own recovery suggestion.

| Class | Error code | Extra property | Recovery suggestion |
|---|---|---|---|
| `GraphError` | `GRAPH_ERROR` | none | Check your graph configuration and ensure all nodes are properly connected. |
| `NodeError` | `NODE_ERROR` | `nodeName?: string` | Review the node implementation and ensure all required inputs are provided. |
| `GraphRecursionError` | `GRAPH_RECURSION_ERROR` | `recursionLimit?: number` | Consider increasing the recursion_limit parameter or check for infinite loops in your graph. |

`GraphRecursionError` means a run exceeded its step limit. `invoke` sends `recursion_limit` (default 25) with each request, so raise it in the options if the graph legitimately needs more steps.

```ts title="graph-errors.ts"
import { TenxGraphClient, GraphRecursionError, Message, NodeError } from '10xgraph-client';

const client = new TenxGraphClient({ baseUrl: 'http://localhost:8000' });

try {
  await client.invoke([Message.text_message('Plan my trip')], { recursion_limit: 50 });
} catch (err) {
  if (err instanceof GraphRecursionError) {
    console.error('Run exceeded its step limit. Check the graph for loops.');
  } else if (err instanceof NodeError) {
    console.error('A node failed:', err.message);
  } else {
    throw err;
  }
}
```

## Storage errors

Storage errors mean the checkpointer or memory store failed. The two classes differ in whether a retry helps.

| Class | Status | Error code | Retry | Recovery suggestion |
|---|---|---|---|---|
| `StorageError` | 500 | `STORAGE_ERROR` | No | Check your storage configuration and ensure the storage backend is accessible. |
| `TransientStorageError` | 503 | `TRANSIENT_STORAGE_ERROR` | Yes, with backoff | This is a temporary issue. Please retry your request after a short delay. |

`TransientStorageError` is matched before `StorageError` because its code starts with `TRANSIENT_STORAGE`.

```ts title="storage-errors.ts"
import { TenxGraphClient, StorageError, TransientStorageError } from '10xgraph-client';

const client = new TenxGraphClient({ baseUrl: 'http://localhost:8000' });

async function loadState(threadId: string) {
  try {
    return await client.threadState(threadId);
  } catch (err) {
    if (err instanceof TransientStorageError) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return client.threadState(threadId); // one retry after a short delay
    }
    if (err instanceof StorageError) {
      console.error('Storage backend is unavailable:', err.message);
    }
    throw err;
  }
}
```

## Serialization, schema and metrics errors

These three classes cover data format, version and telemetry failures.

| Class | Status | Error code | Thrown when | Recovery suggestion |
|---|---|---|---|---|
| `SerializationError` | 500 | `SERIALIZATION_ERROR` | A payload cannot be serialized or deserialized. | Ensure your data format is compatible with the API schema. |
| `SchemaVersionError` | 422 | `SCHEMA_VERSION_ERROR` | Client and server schema versions disagree. Has `expectedVersion?` and `actualVersion?` (`string`). | Update your client to match the server schema version or contact support. |
| `MetricsError` | 500 | `METRICS_ERROR` | Metrics collection or reporting failed. | Check your metrics configuration. This error typically doesn't affect core functionality. |

`SchemaVersionError` shares status 422 with `ValidationError`; the code prefix is what separates them. A `MetricsError` may mean the operation itself worked, so log it and decide per call whether to treat it as fatal.

```ts title="schema-errors.ts"
import { TenxGraphClient, MetricsError, SchemaVersionError } from '10xgraph-client';

const client = new TenxGraphClient({ baseUrl: 'http://localhost:8000' });

try {
  await client.updateThreadState('thread-1', {}, { context: [] });
} catch (err) {
  if (err instanceof SchemaVersionError) {
    console.error('Client and server schemas differ. Update the client.');
  } else if (err instanceof MetricsError) {
    console.warn('Metrics failed; the request may have succeeded.');
  } else {
    throw err;
  }
}
```

## A complete recovery strategy

Check specific subclasses first and the base class last. This handler routes each failure to the right response: log in again, show field errors, retry once, or surface a safe message.

```ts title="handle-errors.ts"
import {
  TenxGraphClient,
  TenxGraphError,
  AuthenticationError,
  GraphRecursionError,
  Message,
  TransientStorageError,
  ValidationError,
} from '10xgraph-client';

const client = new TenxGraphClient({ baseUrl: 'http://localhost:8000' });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function ask(text: string, attempt = 0): Promise<unknown> {
  try {
    return await client.invoke([Message.text_message(text)]);
  } catch (err) {
    if (err instanceof AuthenticationError) {
      window.location.href = '/login';
    } else if (err instanceof ValidationError) {
      console.error('Invalid request:', err.details);
    } else if (err instanceof TransientStorageError && attempt < 3) {
      await sleep(1000 * 2 ** attempt); // exponential backoff
      return ask(text, attempt + 1);
    } else if (err instanceof GraphRecursionError) {
      console.error('Step limit exceeded. Raise recursion_limit or fix the loop.');
    } else if (err instanceof TenxGraphError) {
      console.error(err.getUserMessage());
    } else {
      throw err; // network error or timeout
    }
  }
}

await ask('Hello');
```

## Build errors in your own proxy

`parseErrorResponse` and `createErrorFromResponse` are exported for code that calls the API itself, for example a server route that proxies requests. Use them to get the same error classes the client produces.

| Function | Parameters | Returns |
|---|---|---|
| `parseErrorResponse` | `response: Response` | `Promise<ApiErrorResponse \| null>`. `null` if the content type is not JSON or parsing fails. |
| `createErrorFromResponse` | `response: Response`, `fallbackMessage?: string`, `endpoint?: string`, `method?: string` | `Promise<TenxGraphError>`, the most specific subclass. |

```ts title="app/api/invoke/route.ts"
import { createErrorFromResponse } from '10xgraph-client';

export async function POST(req: Request) {
  const upstream = await fetch('http://localhost:8000/v1/graph/invoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: await req.text(),
  });

  if (!upstream.ok) {
    const error = await createErrorFromResponse(
      upstream,
      'Invoke failed',
      '/v1/graph/invoke',
      'POST'
    );
    // Return a safe subset. toJSON() includes the stack trace.
    return Response.json(
      { code: error.errorCode, message: error.message, requestId: error.requestId },
      { status: error.statusCode }
    );
  }

  return Response.json(await upstream.json());
}
```

## Response shapes

These exported types describe the error body the server sends and the field-level detail entries.

```ts
interface ErrorDetail {
  loc?: string[]; // field path, e.g. ['body', 'messages']
  msg?: string;   // human-readable message
  type?: string;  // failure type, e.g. 'value_error'
}

interface ApiErrorResponse {
  metadata: { message: string; request_id: string; timestamp: string };
  error: { code: string; message: string; details: ErrorDetail[] };
}
```

## Related pages

- [Handle errors](/docs/client/error-handling): retries, error blocks and error chunks in streams.
- [Create a client](/docs/client/create-client): configuration, auth and timeout.
- [Error codes](/docs/reference/error-codes): the codes the server returns.
