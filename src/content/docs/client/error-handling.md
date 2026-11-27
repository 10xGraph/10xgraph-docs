---
title: "Error handling"
description: "Catch, classify, and recover from errors in the TypeScript client. Error classes, retrying transient failures, and streaming error events."
section: "TypeScript client"
group: "Features"
order: 110
updated: "2026-11-26"
---

Every client call throws a `TenxGraphError` subclass when it fails, including timeouts and network failures. This page shows which classes to catch and when to retry.

## Which error to catch

| Class | When | What to do |
|---|---|---|
| `AuthenticationError` (401) | Token missing, invalid, expired or revoked. `errorCode` is `EXPIRED_TOKEN`, `INVALID_TOKEN` or `REVOKED_TOKEN` when the server says which. | Refresh the token once on `EXPIRED_TOKEN`; otherwise sign the user in again. |
| `PermissionError` (403) | The caller's role lacks the permission. | Do not retry. |
| `NotFoundError` (404) | The thread, message, memory or file does not exist or is outside the caller's reach. `errorCode` is `THREAD_NOT_FOUND` for a thread. | For a new conversation, omit `thread_id` and use the id the server returns. |
| `ConflictError` (409) | The thread is still busy after the server's 30 second wait, or a resume's `interrupt_id` does not match. | Retry later, or send `on_busy: 'cancel'`. The client never retries it. |
| `ValidationError` (422) | Bad request body, a size limit, or a resume value that fails `response_schema`. | Fix the request. |
| `RateLimitError` (429) | The rate limit window is used up, or the user has too many runs in flight. | Wait, then retry. See [Rate limits](#rate-limits-429). |
| `ServerError` (500 to 504), `TransientStorageError` (503) | Server failure, gateway error or a storage outage. | Retry with backoff. |
| `RequestTimeoutError`, `NetworkError` (`statusCode` 0) | The client timeout fired, or no HTTP reply arrived. | Retry with backoff. |
| `StreamError`, `WebSocketError` | A stream or socket broke after it started. | Retry the call. |

`GraphError`, `NodeError`, `GraphRecursionError` and the storage classes are picked from the server's error code before the status. The full list, with fields, is in [Client errors](/docs/reference/client/errors).

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

## Show and log an error

`err.getUserMessage()` returns the message plus a recovery hint when the class has one. `err.toJSON()` returns every field and the stack trace for your logs; do not show it to users. `err.requestId` matches the server's log line for the request.

## Retrying transient errors

Some errors are temporary and safe to retry. The client itself does not retry automatically, but you can implement retry logic in your application.

**Transient errors** are those where the problem is temporary and will likely resolve on its own:
- `TransientStorageError` (503): the checkpointer or memory store is momentarily unavailable
- `ServerError` with status 502/504: a gateway or upstream service is temporarily down
- `RequestTimeoutError` and `NetworkError`: the client timeout fired, or no reply arrived
- `RateLimitError` (429): retry after `retryAfterSeconds`, not immediately (see [Rate limits](#rate-limits-429))

**Non-transient errors** should not be retried the same way:
- `AuthenticationError` (401): fix your token before retrying
- `ValidationError` (422): fix your request before retrying
- `ConflictError` (409): the client never retries it. A busy thread already waited 30 seconds on the server, so retry only if your app can wait, or use `on_busy: 'cancel'`
- `NotFoundError` (404): the resource does not exist or is outside the caller's reach
- `PermissionError` (403): the role lacks the permission

Here's a helper function for exponential backoff retry:

```ts
import { ServerError, TransientStorageError } from '10xgraph-client';

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

## Rate limits (429)

The server returns 429 when the `rate_limit` window is used up, or when one user has more graph runs in flight than `runs.max_concurrent_per_user` allows (default 10). The rate-limit response includes a `Retry-After` header in seconds and ends its message with `Retry after <n>s.` The run-cap response has no `Retry-After` header. The client throws `RateLimitError`. Its `retryAfterSeconds` holds the `Retry-After` value (or the body's `retry_after_seconds`) and is `undefined` for the run cap.

If the server's cache store (Redis) is down and `fail_open` is `false`, it answers `503` with `RATE_LIMIT_UNAVAILABLE` and `Retry-After: 5` instead. The client throws `ServerError` with `statusCode` 503; read the delay from `err.responseHeaders['retry-after']`.

```ts
import { RateLimitError } from '10xgraph-client';

async function withRateLimitBackoff<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof RateLimitError) || attempt === maxAttempts) throw err;
      const seconds = err.retryAfterSeconds ?? 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    }
  }
}
```

For server-side setup see [Rate limiting](/docs/reference/api-cli/rate-limiting).

## Streaming errors

An `'error'` chunk is yielded like any other chunk, and the stream then ends. Failures before the first chunk (401, 409, 422 and so on), a timeout and a broken stream are thrown, so handle both. Example: [Stream responses](/docs/client/stream-responses#error-handling).

## Graph and node errors

When a node raises, `invoke()` throws `NodeError` or `GraphError`, picked from the server's error code (status 500). A tool that raises does not fail the run: the model gets a failed tool result and can retry or answer.

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

## Related pages

- [Create and configure a client](/docs/client/create-client)
- [Invoke the agent](/docs/client/invoke-agent)
- [Client reference: errors](/docs/reference/client/errors)
- [Troubleshooting: client issues](/docs/troubleshooting/client)
- [API server error codes](/docs/reference/error-codes)
