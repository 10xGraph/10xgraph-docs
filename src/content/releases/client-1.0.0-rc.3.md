---
package: client
version: "1.0.0-rc.3"
date: 2026-11-11
summary: The third 1.0 release candidate, under the next dist-tag. Adds me(), background task methods, filters on threads and memory, ToolResultBlock.name, and removes addThreadMessages.
breaking: true
---

The third 1.0 release candidate of `10xgraph-client`, published to npm under the `next` dist-tag:

```bash
npm install 10xgraph-client@next
```

Use it with `10xgraph-api` 1.0.0rc6, which ships alongside `10xgraph` 1.0.0rc6. New response fields are typed optional, so the client still works against older servers. A `ToolResultBlock.name` sent to an older server is ignored there. See the [upgrade guide](/docs/project/upgrade-to-1.0).

### Added

- `ToolResultBlock.name?: string`: the name of the tool that produced the result. The server sets it on results from `10xgraph` 1.0.0rc6 or later; older results have none. Results the client builds for client-side tools (`ToolExecutor`: success, thrown error, unknown tool, rejected arguments, duplicate call id) set it too.
- `me()` for `GET /v1/me`: who the caller is and what they may do. `data` is `{ user_id, tenant, roles, permissions, reach }` (`reach` is `own`, `tenant` or `all`; `permissions` is `['*']` for an unrestricted identity) or `{ auth: 'off' }` when the server runs without auth. New exported types and helper: `MeResponse`, `MeData`, `MeIdentity`, `MeAuthOff`, `MeReach`, `isAuthOff`. Needs a `10xgraph-api` with RBAC.
- Background task methods for the `/v1/tasks` routes: `runTask(name, { args, kwargs })`, `scheduleTask(name, { args, kwargs, schedule })`, `getTask(id)`, `rescheduleTask(scheduleId, schedule)` and `cancelTask(id)`. `schedule` is exactly one of `{ cron }`, `{ at }` or `{ every }` (seconds). The client does not validate it; the server answers 422. New exported types: `TaskStatus`, `TaskSchedule`, `TaskRecord`, `ScheduleRecord`, `TaskCallOptions`, `RunTaskResponse`, `ScheduleTaskRequest`, `ScheduleTaskResponse`, `GetTaskResponse`, `RescheduleTaskResponse`, `CancelTaskResponse`. Needs a `10xgraph-api` with background tasks.
- Filter support. `threads()` takes `filters` (sent as a JSON `filters` query parameter). `searchMemory()`, `listMemories()` and `forgetMemories()` take `filters` in the request body. A filter is `{ column: value }` (equality) or `{ column: { op: value } }` with the operators `eq`, `ne`, `in`, `nin`, `like`, `ilike`, `is_null`, `gt`, `gte`, `lt`, `lte`. New exported types: `Filters`, `FilterCondition`, `FilterOperator`, `FilterScalar`. The client does not validate columns; the server answers 422. Needs a `10xgraph-api` with filter support.

### Changed

- `forgetMemories()` now throws a `TenxGraphError` subclass on a failed request (`ValidationError` for 422, with the server message) instead of a plain `Error`. When the response has no JSON error body the message is still `Forget memories failed: <status> <statusText>`.

### Removed

- `addThreadMessages` and its `AddThreadMessages*` types. The `POST /v1/threads/{thread_id}/messages` route was removed from `10xgraph-api`, so the method had nothing to call. **Migration:** send messages through `invoke` or `stream`, and use `updateThreadMessageFeedback` for feedback.
