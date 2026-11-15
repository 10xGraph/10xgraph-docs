---
package: client
version: "1.0.0"
date: 2026-11-16
summary: The first stable release of the TypeScript client. Its exports do not break before 2.0. Server messages are real Message instances, and typed errors keep the server's error code.
breaking: true
---

The first stable release of `10xgraph-client`. From 1.0 everything exported from the package does not break before 2.0, and anything removed is deprecated first: see [Stability and deprecation policy](/docs/project/stability). The deprecated `AgentFlow*` aliases keep working until 2.0.

```bash
npm install 10xgraph-client
```

Node.js 20 or newer. Use it with `10xgraph-api` 1.0. Coming from 0.6, read the [upgrade guide](/docs/project/upgrade-to-1.0). Coming from 1.0.0-rc.3, nothing breaks.

### Fixed

- **Server messages are real `Message` instances.** `result.messages.at(-1)?.text()` threw "text is not a function" because responses were plain objects. Messages are now hydrated on `invoke`, `stream` and WebSocket chunks, `threadMessages`, `singleMessage`, `threadState` and `updateThreadState`. Every field the server sent is kept. New exports: `hydrateMessage`, `hydrateStateContext`, `hydrateChunk`.
- **Typed HTTP errors keep the server's error code.** `errorCode` on `AuthenticationError`, `NotFoundError` and the other HTTP errors now carries what the server sent (`EXPIRED_TOKEN`, `INVALID_TOKEN`, `REVOKED_TOKEN`, `THREAD_NOT_FOUND`, ...), so an app can refresh on an expired token and log out on a revoked one. Without a code in the body, the class default is used as before.
