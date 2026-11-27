---
title: TypeScript client
description: "Connect browser and Node.js apps to 10xGraph over REST, streaming, and WebSockets with the typed SDK."
section: "TypeScript client"
order: 10
updated: "2026-11-26"
faq:
  - question: "What are the transport options?"
    answer: "invoke() for the final result, stream() for chunks over HTTP, wsStream() for the same chunks over one WebSocket that also carries client-side tool rounds, and realtime() for voice with a live agent."
  - question: "Do I need a WebSocket library in Node?"
    answer: "Node 22 and later have a global WebSocket. On Node 20, install the `ws` package and pass it as `webSocketImpl` in the client config."
  - question: "Can the client run tools locally?"
    answer: "Yes. Register handlers for remote tools declared in the server's 10xgraph.json and the client executes them without the server owning the implementation."
---

`10xgraph-client` is the typed TypeScript client for a running 10xGraph API server, for browser and Node.js apps. It covers invoke, streaming over HTTP and WebSocket, realtime audio, threads, memory, files, background tasks and client-side tools.

The server checks identity, thread ownership and rate limits on every request, so the part left to your frontend is to carry credentials without leaking them. Read [Secure your frontend](/docs/client/secure-your-frontend) before you ship, and see [Production readiness](/docs/production) for what the server enforces.

## What you need

Install Node 20 or later and the package:

```bash
npm install 10xgraph-client
```

On Node 20, `wsStream()` and `realtime()` also need the `ws` package; see [Create the client](/docs/client/create-client#websocket-support-on-node-20).

## Transport modes

| Method | Transport | Returns | Use it for |
|---|---|---|---|
| `invoke()` | HTTP POST | The final result | Background calls, simple chat |
| `stream()` | HTTP, NDJSON body | Chunks as they arrive | Chat UIs that show tokens |
| `wsStream()` | WebSocket | The same chunks as `stream()` | Graphs that call client-side tools often |
| `realtime()` | WebSocket, binary audio | A `RealtimeSession` | Voice conversations with a live agent |

With a `thread_id`, the server loads the thread's history, so you send only the new message.

## Core concepts

**Threads**: Omit `thread_id` to start a thread. The server picks the id and returns it in `result.thread_id` (or on each stream chunk). Pass it back to maintain a conversation across multiple API calls. The checkpointer on the server persists the full agent state, so each new request picks up where the last one stopped.

**Remote tools**: Tool schemas live on the server (in `10xgraph.json`), but implementation runs in your client. This lets you call browser APIs (clipboard, geolocation), keep secrets local, or run integrations the server cannot access.

## Pages in this section

### Basics

- [Secure your frontend](/docs/client/secure-your-frontend): Proxy or short-lived tokens, WebSocket auth, remote tool trust, and 401, 403, 409, 429
- [Create and configure a client](/docs/client/create-client): Set auth tokens, timeout, proxy headers, and environment-specific URLs
- [Invoke and get results](/docs/client/invoke-agent): Call the agent and await the final response
- [Stream responses](/docs/client/stream-responses): Consume token-by-token or message-by-message as they arrive
- [Manage threads](/docs/client/manage-threads): List threads, fetch history, update state, delete old conversations

### Features

- [Run client-side tools](/docs/client/remote-tools): Register handlers; the client runs them during invoke and stream
- [Send files and media](/docs/client/files-and-multimodal): Upload images, audio, documents; send them in messages
- [Use the memory API](/docs/client/use-memory-api): Store and search long-term memory (semantic, metadata, facts)
- [Graph utilities](/docs/client/graph-utilities): Inspect the graph, stop and repair runs, answer pauses, read run traces
- [Realtime audio](/docs/client/realtime-audio): Voice-to-voice audio over the `/v1/graph/live` WebSocket bridge
- [Handle errors](/docs/client/error-handling): Catch and retry transient failures, parse error details

### Frameworks

- [Next.js and React](/docs/client/nextjs-and-react): Route handler proxy (keep tokens server-side), streaming React components, abort patterns
