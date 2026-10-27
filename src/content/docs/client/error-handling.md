---
title: "Error handling"
description: "Catch, classify, and recover from errors in the TypeScript client. Error classes, retrying transient failures, and streaming error events."
section: "TypeScript client"
group: "Features"
order: 110
updated: "2026-10-27"
---

Every API call from the client can fail: the server can reject authentication, return validation errors, encounter internal issues, or experience temporary storage outages. The 10xGraph TypeScript client exports a hierarchy of error classes to help you classify failures and respond appropriately.

## Error hierarchy

All errors inherit from `TenxGraphError`, which gives you structured access to the status code, error code, request ID, and recovery suggestions.

```ts
import {
  TenxGraphError,
  BadRequestError,
  AuthenticationError,
  PermissionError,
  NotFoundError,
  ConflictError,
  ValidationError,
  ServerError,
  GraphError,
  NodeError,
  StorageError,
  TransientStorageError,
} from '10xgraph-client';
```

| Error Class | HTTP Status | Meaning | Recovery |
|---|---|---|---|
| `BadRequestError` | 400 | Malformed request or invalid data | Fix the request and retry immediately |
| `AuthenticationError` | 401 | Missing or invalid auth credentials | Check token, refresh if expired, retry |
| `PermissionError` | 403 | User lacks access to the resource, or the `thread_id` does not exist or belongs to another user | Check authorization scope. For a new conversation, omit `thread_id` and use the id the server returns |
| `NotFoundError` | 404 | Resource (thread, file) does not exist | Verify the ID, create the resource, or move on |
| `ConflictError` | 409 | The thread is busy with another run, or a resume's `interrupt_id` does not match | Wait and retry, or send `on_busy: 'cancel'`. For a mismatch, fetch the current interrupt id |
| `ValidationError` | 422 | Request failed schema validation, is over a size limit, or a resume answer fails `response_schema` | Fix field types, ranges and sizes, retry |
| `ServerError` | 500, 502, 503, 504 | Server-side failure or transient issue | Retry with exponential backoff |
| `GraphError` | 500 | Error during graph execution | Check graph configuration, inspect logs |
| `NodeError` | 500 | Error in a specific graph node | Review node implementation and inputs |
| `StorageError` | 500 | Checkpointer or memory store is unavailable | Verify storage backend is online, retry |
| `TransientStorageError` | 503 | Temporary storage issue | Retry immediately or after brief delay |

The client automatically instantiates the appropriate error class based on HTTP status code and error code from the server.

## Catching errors

Wrap `invoke()` or `stream()` in a try-catch block:

```ts
import { TenxGraphClient, Message, TenxGraphError, TransientStorageError } from '10xgraph-client';

const client = new TenxGraphClient({
  baseUrl: 'http://localhost:8000',
  authToken: process.env.TENXGRAPH_TOKEN,
});

try {
  const result = await client.invoke([Message.text_message('Hello', 'user')]);
  console.log('Response:', result.messages);
} catch (err) {
  if (err instanceof TransientStorageError) {
    console.log('Storage temporarily unavailable. Try again in a moment.');
  } else if (err instanceof TenxGraphError) {
    console.error(`Request failed: ${err.message}`);
    console.error(`Request ID: ${err.requestId}`);
    console.error(`Status: ${err.statusCode}`);
  } else {
    // Network or other non-API error
    console.error('Unexpected error:', err);
  }
}
```

## Using getUserMessage and toJSON

`TenxGraphError` provides two utility methods for displaying and debugging errors.

**`getUserMessage()`** returns a user-friendly message that includes a recovery suggestion if one is available:

```ts
try {
  await client.invoke([Message.text_message('Hello', 'user')]);
} catch (err) {
  if (err instanceof TenxGraphError) {
    // Suitable for displaying to an end user
    console.log(err.getUserMessage());
    // Output: "Invoke request failed\n\nSuggestion: Check your graph configuration..."
  }
}
```

**`toJSON()`** returns a detailed object with all error fields for logging or debugging. Use this when reporting errors to a monitoring system:

```ts
if (err instanceof TenxGraphError) {
  console.log(JSON.stringify(err.toJSON(), null, 2));
  // {
  //   "name": "GraphError",
  //   "message": "Node 'search_tool' failed",
  //   "statusCode": 500,
  //   "errorCode": "GRAPH_ERROR",
  //   "requestId": "req-abc123...",
  //   "timestamp": "2026-10-08T14:32:01.234Z",
  //   "details": [...],
  //   "recoverySuggestion": "Check your graph configuration...",
  //   "stack": "..."
  // }
}
```

## Retrying transient errors

Some errors are temporary and safe to retry. The client itself does not retry automatically, but you can implement retry logic in your application.

**Transient errors** are those where the problem is temporary and will likely resolve on its own:
- `TransientStorageError` (503): the checkpointer or memory store is momentarily unavailable
- `ServerError` with status 502/504: a gateway or upstream service is temporarily down
- Network timeouts or connection resets (a plain `Error`, such as `Request timeout after 300000ms`, not a `TenxGraphError`)

**Non-transient errors** should not be retried the same way:
- `AuthenticationError` (401): fix your token before retrying
- `ValidationError` (422): fix your request before retrying
- `ConflictError` (409): the client never retries it. A busy thread already waited 30 seconds on the server, so retry only if your app can wait, or use `on_busy: 'cancel'`
- `NotFoundError` (404): the resource does not exist; create it first
- `PermissionError` (403): request new permissions before retrying

Here's a helper function for exponential backoff retry:

```ts
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelayMs: number = 500
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isTransient =
        err instanceof TransientStorageError ||
        (err instanceof ServerError && [502, 504].includes(err.statusCode));

      if (!isTransient || attempt === maxAttempts) {
        throw err; // Re-throw non-transient errors and final attempt
      }

      const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
      console.log(`Attempt ${attempt} failed. Retrying in ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

// Usage
const result = await retryWithBackoff(() =>
  client.invoke([Message.text_message('Query', 'user')])
);
```

## Streaming errors

When you call `stream()`, errors appear as part of the stream event sequence, not as thrown exceptions. The stream is NDJSON: one JSON object per line, and each object is a `StreamChunk`.

```ts
export enum StreamEventType {
  MESSAGE = 'message',
  UPDATES = 'updates',
  STATE = 'state',
  ERROR = 'error',
}
```

Iterate through the stream and check the `event` field. When an error occurs, the server sends a chunk with `event: 'error'`:

```ts
const stream = client.stream([Message.text_message('Hello', 'user')]);

try {
  for await (const chunk of stream) {
    if (chunk.event === 'error') {
      // Error in the stream
      console.error('Stream error:', chunk.data);
      // chunk.data carries the failure reason, for example:
      // { "reason": "..." }
      break; // Stop processing stream
    } else if (chunk.event === 'message') {
      console.log('Message:', chunk.message);
    } else if (chunk.event === 'updates') {
      console.log('State:', chunk.state);
    }
  }
} catch (err) {
  // Network errors or stream parsing errors
  if (err instanceof TenxGraphError) {
    console.error('Request failed:', err.message);
  } else {
    console.error('Stream error:', err);
  }
}
```

## Graph and node errors

When a graph node raises an exception or a tool fails, the error is captured by the server and returned as `GraphError` or `NodeError`. These errors are returned as HTTP 500 responses. The error message describes which node failed and why.

```ts
try {
  const result = await client.invoke([Message.text_message('Search for X', 'user')]);
} catch (err) {
  if (err instanceof NodeError) {
    console.error('Node failed:', err.message);
  } else if (err instanceof GraphError) {
    console.error('Graph execution failed:', err.message);
  }
}
```

## Debugging and logging

Set `debug: true` in the client config to enable detailed logging:

```ts
const client = new TenxGraphClient({
  baseUrl: 'http://localhost:8000',
  debug: true, // Logs every request, response, and chunk
});
```

In logs, look for:
- `request_id` in every error: use this to correlate client logs with server logs
- `timestamp`: when the error occurred on the server
- `details`: validation errors or field-specific issues
- `recoverySuggestion`: guidance on what to do next

When reporting errors to your team or to 10xGraph support, include the full error JSON from `toJSON()` and the request ID.

## Related pages

- [Create and configure a client](/docs/client/create-client)
- [Invoke and stream](/docs/client/invoke-agent)
- [Client reference: errors](/docs/reference/client/errors)
- [Troubleshooting: client issues](/docs/troubleshooting/client)
- [API server error codes](/docs/reference/error-codes)
