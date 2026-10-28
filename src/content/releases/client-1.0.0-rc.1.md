---
package: client
version: "1.0.0-rc.1"
date: 2026-10-28
summary: The 1.0 release candidate, published under the next dist-tag. No breaking changes. Adds on_busy, resume, deleteFile and message feedback, and fixes thread id loss in the client-side tool loop.
breaking: false
---

The 1.0 release candidate, published to npm under the `next` dist-tag:

```bash
npm install 10xgraph-client@next
```

`npm install 10xgraph-client` still installs 0.6.0 until 1.0.0 is released. The client has no breaking change in this release. From 1.0 the three packages share major.minor, so use the client with a `10xgraph-api` of the same major.minor. See the [upgrade guide](/docs/project/upgrade-to-1.0).

`10xgraph-api` 1.0 defaults `runs.thread_ids` to `"server"`: a client that invents an id for a new thread gets HTTP 403 on `invoke()`, `stream()` and `wsStream()`. No code change is needed if you already let the server choose. Omit `thread_id` from `config` on the first request, then reuse the returned id (`result.meta.thread_id` for `invoke()`, `chunk.thread_id` or `chunk.metadata.thread_id` for `stream()`). Operators who want the old behaviour set `"runs": {"thread_ids": "client"}` in `10xgraph.json`.

### Added

- `on_busy?: 'wait' | 'cancel'` on `invoke()`, `stream()` and `wsStream()`: what the server does when another run is active on the same thread.
- `resume` and `interrupt_id` options on `invoke()`, `stream()` and `wsStream()` to answer an open interrupt.
- `ConflictError` (HTTP 409), exported from the package root.
- `deleteFile(fileId)` for `DELETE /v1/files/{file_id}`.
- `updateThreadMessageFeedback(threadId, messageId, feedback)` for `PUT /v1/threads/{thread_id}/messages/{message_id}`.

### Fixed

- The client-side tool loop on `invoke()` and `stream()` lost a server-assigned thread id: the requests that send tool results omitted it, so the tool round-trip broke or the conversation split. The client now reuses the returned id. A `thread_id` you pass is never replaced, and your `config` object is not modified.

### Deprecated

- `addThreadMessages` needs the `checkpointer:import` scope (admin only) on recent `10xgraph-api` releases. Use `updateThreadMessageFeedback` to attach feedback to a message.
