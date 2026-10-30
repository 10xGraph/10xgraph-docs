---
package: client
version: "1.0.0-rc.2"
date: 2026-10-30
summary: The second 1.0 release candidate, published under the next dist-tag. Drops Node.js 18, adds interrupt helpers, typed errors, abort signals and token functions, and fixes stream and realtime edge cases.
breaking: true
---

The second 1.0 release candidate, published to npm under the `next` dist-tag:

```bash
npm install 10xgraph-client@next
```

`npm install 10xgraph-client` still installs 0.6.0 until 1.0.0 is released. Use this release with `10xgraph-api` 1.0.0rc2. New response fields are typed optional, so the client still works against older servers. See the [upgrade guide](/docs/project/upgrade-to-1.0).

### Breaking

- **Node.js 18 is no longer supported.** `engines` is `node >= 20.0.0`, and CI runs Node 20 and 22. **Migration:** run the client on Node.js 20 or later.
- **Typed change:** `RealtimeSession.threadId` is `string | null`. It is `null` until the `session_started` event arrives when you passed no `thread_id`. Handle `null` or wait for the event.

### Behaviour changes

- `stream()` and `wsStream()` throw (`StreamError`, `WebSocketError`) when a stream is cut or the server closes the socket mid-run. Before, they ended as if the run had succeeded.
- `timeout` is an idle timeout on `stream()` and `wsStream()`: it limits the wait on the network, not the whole run.
- Timeouts and network failures throw `RequestTimeoutError` and `NetworkError`. Check the class, not the message text.
- A `baseUrl` with a trailing slash is accepted.

### Added

- `Interrupt` type, `getInterrupt(chunk)`, `approveInterrupt()` and `rejectInterrupt()` to answer a paused run.
- `authToken` can be a function called on every request and realtime reconnect; `setAuthToken()` and `clearAuth()`.
- A `signal` option on every request method, not only `invoke()`, `stream()` and `wsStream()`.
- Error classes `RequestTimeoutError`, `NetworkError`, `WebSocketError`, `StreamError` and `RateLimitError` (with `retryAfterSeconds`). Errors carry `cause`, `endpoint`, `method` and `requestId`.
- `validate(args)` and `maxArgsBytes` on remote tool registrations; declared `parameters` are checked before the handler runs.
- `listMemories` takes `offset` and returns `has_more` and `next_offset`; `listFiles(params?)` for `GET /v1/files`; `has_more`, `offset` and `limit` on thread lists.
- Run trace types, `GraphInfo.realtime_options` and extended eval report types.
- Live sessions without a `thread_id` use the server-created id from the `session_started` event and send it back on reconnect.

### Fixed

- Leaving a `for await` loop over `stream()` early now cancels the request instead of leaving the connection open and the thread answering 409.
- `wsStream()` no longer hangs on an error chunk, and a truncated stream line throws `StreamError`.
- A 409 throws `ConflictError` against the real server, not a `TypeError`.
- `client.realtime()` no longer crashes Node with an unhandled rejection when the connection fails.
- `searchMemory()` omits unset `memory_type`, `category` and `score_threshold`, so a search without a type covers all memory types.
