---
title: Client Troubleshooting
description: "Symptoms, causes, and fixes for common 10xGraph TypeScript client problems: failed requests, CORS, lost threads, streaming and WebSocket errors."
section: Troubleshooting
order: 50
label: Client Troubleshooting
updated: "2026-10-27"
faq:
  - q: "Why does my browser request fail when curl works?"
    a: "The usual cause is CORS. The server's ORIGINS setting must include the exact origin of your web app, and credentials must be allowed consistently. Check the preflight OPTIONS request in the browser Network tab."
  - q: "Why does my agent forget earlier messages?"
    a: "Every call after the first must send the thread_id the server returned (result.meta.thread_id, or thread_id on each stream chunk), and the server must have a checkpointer. Without either, each request starts a fresh thread."
  - q: "Why does my WebSocket close with code 1008?"
    a: "1008 means the server rejected the connection by policy: the graph type does not match the endpoint, the token is invalid, or the user is not authorized for the thread."
---

Use this page when the TypeScript client (`TenxGraphClient`) or a hand-written HTTP client cannot invoke, stream or connect to a 10xGraph API server. It walks from a quick client-versus-server triage to the five most common failures, each with symptoms, causes and a tested fix, then lists WebSocket close codes.

## Decide whether the client or the server is at fault

Start by sending the same request with curl. If curl works, the problem is in the client configuration (`baseUrl`, CORS, auth, thread id). If curl fails too, debug the server first with [API server troubleshooting](/docs/troubleshooting/api-server).

```mermaid
flowchart TD
    A[Client request fails] --> B{Does curl against the same URL work?}
    B -->|Yes| C[Client issue: check baseUrl, CORS, auth, config shape]
    B -->|No| D[Server issue: check server logs and /ping]
    C --> E{Only in the browser?}
    E -->|Yes| F[CORS or HTTPS mismatch]
    E -->|No| G[Check thread_id, endpoint and transport]
```

Run this health check before anything else. The server answers `/ping` without authentication.

```bash
# Health check: expect HTTP 200 and a body containing "pong"
curl -i http://localhost:8000/ping
```

## Fix requests that fail immediately

If every call fails with a connection error, the client is not reaching the server. Typical messages are `ECONNREFUSED`, `ENOTFOUND`, `EHOSTUNREACH`, "socket hang up" or a timeout.

**Likely causes**

- Wrong `baseUrl`, a typo in the host or port, or the server is not running.
- A reverse proxy or firewall routes to a different place than the one you configured.
- The base URL points at the backend while the app sits behind a proxy (or the reverse).

**Fix**

Confirm the exact URL with the curl check above, then make the client use it. The client also has a `ping()` method and a `debug` flag that logs each request and response.

```ts title="check-connection.ts"
import { TenxGraphClient } from '10xgraph-client';

const client = new TenxGraphClient({
  baseUrl: 'http://localhost:8000', // no trailing path, must match the curl URL
  debug: true, // logs request and response details to the console
});

// Throws if the server is unreachable or answers with an error status.
console.log(await client.ping());
```

If the API runs behind a proxy, `baseUrl` must point at the proxy address that browsers and services actually use.

## Fix 429 responses

A `TenxGraphError` with `statusCode` 429 means the server refused the call to limit load. There are two causes:

- **Rate limit.** `errorCode` is `RATE_LIMIT_EXCEEDED` and the message ends with `Retry after <n>s.` The server also sent a `Retry-After` header, but the client does not keep response headers on the error, so read the seconds from the message.
- **Per-user run cap.** One user has `runs.max_concurrent_per_user` runs in flight (default 10). `errorCode` is `HTTPException` and there is no `Retry-After`. Wait for a run to finish, for example close streams you no longer read.

A related case is `503` with `errorCode` `RATE_LIMIT_UNAVAILABLE`: the server's rate-limit backend is unreachable and `fail_open` is `false`. It is an outage, not a limit hit; retry after about 5 seconds. Added after 1.0.0rc2.

The client does not retry 429 on its own. Back off in your app (see [Error handling](/docs/client/error-handling#rate-limits-429)). If every user hits the limit at once from behind a proxy, the server is counting the proxy's IP: set `trusted_proxies` on the server ([API server troubleshooting](/docs/troubleshooting/api-server)).

## Fix browser requests that fail while curl works

When the browser console shows "CORS error", "net::ERR_FAILED" or "Failed to fetch" but curl succeeds, the browser is blocking the response. Browsers enforce CORS, curl does not.

**Likely causes**

- The server's `ORIGINS` setting does not include the page's origin. The server default is `*`.
- Credentials are sent to a server that allows any origin. The server setting `CORS_ALLOW_CREDENTIALS` defaults to `true`, and in production the combination of `ORIGINS="*"` with credentials is refused at startup. A wildcard `ORIGINS` alone is also refused in production unless `STRICT_PRODUCTION_CHECKS=false`.
- The page is served over `https://` while the API is on `http://` (mixed content is blocked).
- The auth header never reaches the server because the token is missing in the client.

**Fix**

List explicit origins on the server, then open the browser DevTools Network tab and inspect the failing request and its preflight `OPTIONS` call. The response must carry `Access-Control-Allow-Origin` with your page's origin.

```bash
# Server environment: comma-separated origins, never * in production
export ORIGINS=https://my-app.com,https://www.my-app.com
```

Then configure the client with the token and, only if you rely on cookies, `credentials`.

```ts title="browser-client.ts"
import { TenxGraphClient } from '10xgraph-client';

const client = new TenxGraphClient({
  baseUrl: 'https://api.my-app.com', // same scheme (https) as the page
  authToken: 'your-jwt-token', // sent as a Bearer token
  credentials: 'include', // only needed when you use cookies
});
```

Do not expose long-lived tokens in browser code. See [Create a client](/docs/client/create-client) for auth options.

## Fix lost conversations and thread continuity

If each request feels like a new conversation, the server is not seeing the same thread or is not saving state. The server needs both the same `config.thread_id` on every call after the first and a checkpointer. The server picks the id of a new thread, so the client reads it from the first response.

**Likely causes**

- `thread_id` is missing from the second call onward, so each call starts a new thread.
- You sent an id you made up. By default the server refuses an id that does not exist with `403` (`PermissionError`), the same as another user's thread. Omit `thread_id` on the first call and use the one the server returns.
- `thread_id` is nested in the wrong place. The API reads `config.thread_id` at the top level of `config`. A LangGraph style `config.configurable.thread_id` is not read.
- The server has no checkpointer, so nothing is persisted between calls.
- Reading a thread that does not exist returns `STORAGE_NOT_FOUND_000`.

**Fix**

Build messages with `Message.text_message`, omit `thread_id` on the first call, and reuse the returned `thread_id` for the rest of the conversation.

```ts title="thread-continuity.ts"
import { TenxGraphClient, Message } from '10xgraph-client';

const client = new TenxGraphClient({ baseUrl: 'http://localhost:8000' });

// First call has no thread_id, so the server starts a thread and returns its id.
const first = await client.invoke([Message.text_message('My name is Sam.')]);
const threadId = first.meta.thread_id;

// Second call reuses the same thread, so the agent can recall the name.
const result = await client.invoke([Message.text_message('What is my name?')], {
  config: { thread_id: threadId }, // top level of config
});
console.log(result.messages);
console.log(result.meta.thread_id, result.meta.is_new_thread); // is_new_thread is false here
```

Check whether the server has a checkpointer with `graph()`. The response holds `data.info.checkpointer` (a boolean) and `data.info.checkpointer_type`.

```ts title="check-checkpointer.ts"
import { TenxGraphClient } from '10xgraph-client';

const client = new TenxGraphClient({ baseUrl: 'http://localhost:8000' });
const graph = await client.graph();
console.log(graph.data.info.checkpointer, graph.data.info.checkpointer_type);
```

If `checkpointer` is `false`, configure one: see [Set up checkpointing](/docs/guides/set-up-checkpointing).

## Fix streaming that behaves differently from invoke

`invoke()` returns one result, while `stream()` yields chunks as the graph runs. When one works and the other does not, the cause is usually the endpoint, a parser that expects the wrong wire format, or a proxy that buffers or cuts long responses.

**Likely causes**

- Different routes: `invoke()` calls `POST /v1/graph/invoke`, `stream()` calls `POST /v1/graph/stream`.
- A hand-written parser expects SSE `data:` frames. The stream endpoint is sent with `Content-Type: application/x-ndjson`, and the client parses it as newline-delimited JSON chunks.
- A proxy buffers the response or times out long-lived connections.

**Fix**

Use the client methods, which parse the stream for you.

```ts title="stream-vs-invoke.ts"
import { TenxGraphClient, Message } from '10xgraph-client';

const client = new TenxGraphClient({ baseUrl: 'http://localhost:8000' });
const messages = [Message.text_message('Hello')];

// One response, after the graph finishes.
const result = await client.invoke(messages);
console.log(result.messages);

// Chunks as they are produced.
for await (const chunk of client.stream(messages)) {
  if (chunk.event === 'message') {
    console.log(chunk.message?.content);
  }
}
```

To isolate the transport from your client code, read the raw stream with curl. Each line of output should be one JSON object.

```bash
# --no-buffer prints chunks as they arrive
curl --no-buffer -X POST http://localhost:8000/v1/graph/stream \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": [{"type": "text", "text": "Hello"}]}]}'
```

If curl streams but your app receives everything at once or loses the tail, a proxy is buffering or timing out. Disable response buffering and raise the read timeout for the stream route (for nginx, `proxy_buffering off` and a larger `proxy_read_timeout`). See [Stream responses](/docs/client/stream-responses) for chunk types.

## Fix WebSocket connection failures

`wsStream()` (turn-based, `/v1/graph/ws`) and `realtime()` (audio, `/v1/graph/live`) share the same auth and similar failure modes. Most failures are a missing WebSocket implementation, the wrong endpoint for the graph type, or an auth problem.

### Provide a WebSocket implementation on older Node

Browsers and Node 21 or later have a global `WebSocket`. On older Node versions the client reports that no WebSocket implementation is available. Install `ws` and pass it in.

```bash
npm install ws
```

```ts title="node-websocket.ts"
import WebSocket from 'ws';
import { TenxGraphClient, Message } from '10xgraph-client';

const client = new TenxGraphClient({
  baseUrl: 'http://localhost:8000',
  authToken: 'your-jwt-token',
  webSocketImpl: WebSocket as never, // needed on Node < 21
});

for await (const chunk of client.wsStream([Message.text_message('Hello')])) {
  console.log(chunk.event);
}
```

### Read the WebSocket close code

When a socket closes right after opening, the numeric close code tells you why. These codes are set by the server in `/v1/graph/ws` and `/v1/graph/live`.

| Code | Endpoint | Cause | Fix |
|------|----------|-------|-----|
| 1008 | `/v1/graph/live` | The graph is not a live (realtime) agent. An `error` event with `code: 'not_live'` arrives first. | Use `stream()` or `wsStream()`. `graph()` shows the graph type. |
| 1008 | `/v1/graph/ws` | The graph is a live agent, or the token expired or was revoked after the socket opened. | Use `realtime()` for live agents, or refresh the token. |
| 1008 | Either | Not authorized for the requested `thread_id` (on `/live`, an error event with `code: 'not_authorized'` arrives first). | Check the token and the server's authorization rules for that thread. |
| 1003 | `/v1/graph/live` | The init frame was not valid JSON or not a JSON object. | Only relevant if you write the protocol by hand. The client sends valid frames. |
| 1013 | Either | Rate limit or `websocket.max_connections` cap exceeded (default 1000 per server process). | Back off and retry, or raise the cap in the server config. |
| 1011 | `/v1/graph/ws` | Unexpected server error. | Check the server logs. |

### Send the token through the subprotocol

The bearer token never goes in the URL. In browsers it travels in the `Sec-WebSocket-Protocol` header as a subprotocol pair, and on Node the client also sets an `Authorization` header. This client version (0.6.0 and later) sends the `10xgraph-bearer` subprotocol, which needs `10xgraph-api` 0.7.0 or later. A server older than 0.7.0 only knows `agentflow-bearer` and rejects the WebSocket handshake; upgrade the server.

If a reverse proxy strips `Sec-WebSocket-Protocol`, the browser handshake arrives without a token and is rejected. Configure the proxy to forward upgrade headers, including `Sec-WebSocket-Protocol`.

### Tune realtime reconnection

`realtime()` reconnects automatically after an unexpected drop and resumes the same `thread_id`. `wsStream()` does not reconnect. The delay before attempt `n` is `min(baseDelay * 2^(n-1), maxDelay)` seconds. Defaults are `enabled: true`, `baseDelay: 0.5`, `maxDelay: 10` and `maxAttempts: 5`.

After `maxAttempts` failures the session emits a fatal `error` event with `code: 'reconnect_failed'`. No reconnect happens after you call `close()` or after any fatal error. Set `reconnect: { enabled: false }` to turn it off.

```ts title="realtime-reconnect.ts"
import { TenxGraphClient } from '10xgraph-client';

const client = new TenxGraphClient({
  baseUrl: 'http://localhost:8000',
  authToken: 'your-jwt-token',
});

const session = client.realtime(
  { thread_id: 'voice-session-1' },
  { reconnect: { enabled: true, baseDelay: 1, maxDelay: 30, maxAttempts: 10 } }
);

session.on('reconnecting', (attempt) => console.log(`Reconnecting, attempt ${attempt}`));
session.on('reconnected', () => console.log('Reconnected'));
session.on('error', (e) => {
  if (e.fatal) console.log(`Giving up: ${e.code ?? e.message}`);
});

await session.ready; // resolves when the session is open
```

See [Realtime audio](/docs/client/realtime-audio) for sending and receiving audio.

## Error code quick reference

These codes appear in error responses the client surfaces as typed errors. The full catalog is in [Error codes](/docs/reference/error-codes).

| Error code | Meaning | Action |
|------------|---------|--------|
| `STORAGE_NOT_FOUND_000` | The thread or stored resource does not exist. | Check the `thread_id` and that a checkpointer is enabled. |
| `STORAGE_TRANSIENT_000` | A temporary storage failure, such as an unreachable database. | Retry after a short delay. |
| `VALIDATION_ERROR` | The request body failed validation (HTTP 422). | Check the message format and `config` shape against [Invoke and stream](/docs/client/invoke-agent). |
| `RATE_LIMIT_UNAVAILABLE` | The rate limiter's backend is unreachable and `fail_open` is `false` (HTTP 503, `Retry-After: 5`). Added after 1.0.0rc2. | Retry after a short delay and restore the server's rate-limit Redis. See [Fix 429 responses](#fix-429-responses). |
| `RATE_LIMIT_EXCEEDED` | The server's rate limit is used up (HTTP 429). Arrives as a plain `TenxGraphError`, not a typed subclass. | Wait for the `Retry-After` interval, which the message also states, then retry. See [Fix 429 responses](#fix-429-responses). |

## Related pages

- [Create a client](/docs/client/create-client)
- [Invoke an agent](/docs/client/invoke-agent)
- [Stream responses](/docs/client/stream-responses)
- [Manage threads](/docs/client/manage-threads)
- [Client error handling](/docs/client/error-handling)
- [API server troubleshooting](/docs/troubleshooting/api-server)
- [Set up checkpointing](/docs/guides/set-up-checkpointing)

## What you learned

- How to separate client problems from server problems with curl and `/ping`.
- Why CORS, `ORIGINS` and HTTPS decide whether browser requests succeed.
- Why `thread_id` belongs at the top level of `config`, and how to confirm a checkpointer exists.
- How `invoke()` and `stream()` differ on the wire and how to debug a stream.
- What each WebSocket close code means and how realtime reconnection behaves.
