---
title: Graph utilities and human-in-the-loop
description: "Inspect graph topology and state, stop execution, repair broken threads, view execution traces, and handle interrupts for human approval workflows."
section: TypeScript client
group: Features
order: 90
label: Graph utilities
updated: "2026-11-26"
---

The `10xgraph-client` TypeScript client exposes utility methods for inspecting graph metadata, controlling execution, repairing state, and handling human-in-the-loop workflows. Use these methods to build observability dashboards, debugging tools, and approval interfaces.

| Method | Purpose |
|---|---|
| `graph()` | Fetch graph topology, nodes, edges, and server capabilities. |
| `graphTools()` | List all tools each tool node exposes, tagged by source (local, MCP, remote). |
| `graphStateSchema()` | Fetch the JSON Schema describing all fields in the graph's state. |
| `observability(threadId, runId?)` | Reconstruct and fetch the execution trace: spans, events, and token usage. |
| `stopGraph(threadId, config?)` | Signal a running graph to stop after the current node. |
| `fixGraph(threadId, config?)` | Remove assistant messages with unanswered tool calls, and orphaned tool results, from a thread. |

## Prerequisites

- A configured `TenxGraphClient`. See [create a client](/docs/client/create-client).
- The 10xGraph API server running.

---

## graph()

Fetches the graph topology and server capabilities from `GET /v1/graph`. Use this to verify the server started correctly and to read metadata about the loaded graph.

```ts
const info = await client.graph();

const g = info.data;

// Topology
console.log('Nodes:', g.nodes.map(n => n.name));
console.log('Edges:', g.edges.length);

// Server capabilities
console.log('Checkpointer enabled:', g.info.checkpointer);
console.log('Checkpointer type:', g.info.checkpointer_type);
console.log('Memory store enabled:', g.info.store);
console.log('Publisher enabled:', g.info.publisher);

// State
console.log('State type:', g.info.state_type);
console.log('State fields:', g.info.state_fields);

// ID generation
console.log('ID type:', g.info.id_type);
console.log('ID generator:', g.info.id_generator);

// Interrupt configuration
console.log('Interrupt before:', g.info.interrupt_before);
console.log('Interrupt after:', g.info.interrupt_after);
```

The full `GraphInfo` type is in [graph()](/docs/reference/client/graph#graph).

### Common use: health check at startup

```ts
try {
  const info = await client.graph();
  console.log(`Graph ready: ${info.data.info.node_count} node(s), checkpointer=${info.data.info.checkpointer}`);
} catch (err) {
  console.error('Graph not reachable:', err);
  process.exit(1);
}
```

---

## graphTools()

Fetches every tool the graph's tool nodes expose from `GET /v1/graph/tools`, grouped by node. Each tool carries a `source` tag that identifies where it comes from: a Python tool in the graph, an MCP server, or a client-side remote tool.

```ts
const result = await client.graphTools();

console.log(`${result.data.tool_count} tool(s) across ${result.data.node_count} node(s)`);

for (const node of result.data.nodes) {
  console.log(`\n${node.node_name} (${node.tool_count})`);
  for (const tool of node.tools) {
    console.log(`  [${tool.source}] ${tool.name}, ${tool.description}`);
  }
}
```

| `source` | Meaning |
|---|---|
| `local` | A Python function registered on the tool node in your graph. |
| `mcp` | Discovered at runtime from an MCP server attached to the node. |
| `remote` | Declared in server `10xgraph.json` and executed by a matching client handler. |

### Use case: confirm configured remote tools loaded

`graphTools()` reports what the graph offers the model. Check it after server startup:

```ts
client.registerToolHandler('get_location', async () => readGeolocation());

const { data } = await client.graphTools();
const remote = data.nodes
  .flatMap(n => n.tools)
  .filter(t => t.source === 'remote')
  .map(t => t.name);

if (!remote.includes('get_location')) {
  throw new Error('get_location is missing from 10xgraph.json');
}
```

`graphTools()` returns an empty `nodes` array for a graph with no tool nodes. That is a valid graph, not an error.

---

## graphStateSchema()

Fetches the full JSON Schema of `AgentState` from `GET /v1/graph:StateSchema`. The schema describes every field in the graph's state type, useful for building dynamic forms, writing client-side validators, or understanding what data the graph tracks.

```ts
const result = await client.graphStateSchema();
const schema = result.data;

console.log('State title:', schema.title);

for (const [field, def] of Object.entries(schema.properties)) {
  console.log(`  ${field}: ${def.type}, ${def.description ?? '(no description)'}`);
}
```

The response types are in [graphStateSchema()](/docs/reference/client/graph#graphstateschema).

### Use case: validate initial_state before invoking

```ts
const schema = (await client.graphStateSchema()).data;
const required = schema.required ?? [];

const initialState = { customer_tier: 'pro' };
const missing = required.filter(f => !(f in initialState));

if (missing.length > 0) {
  throw new Error(`Missing required state fields: ${missing.join(', ')}`);
}

await client.invoke([Message.text_message('Hello')], { initial_state: initialState });
```

The server accepts only keys listed in `runs.state_keys` in `10xgraph.json`, here `"runs": { "state_keys": ["customer_tier"] }`. Any other key gets `422`. Do not send identity such as a user id in state: the client controls it.

---

## observability()

Fetches the reconstructed execution trace for a thread from `GET /v1/observability/{thread_id}`. The server returns the most recent run by default; pass a `runId` to fetch a specific one. Use it to show a timeline, attribute latency to a node, or report token usage per run. It is a development aid: with `MODE=production` on the server it returns an empty result with `enabled: false`.

```ts
const result = await client.observability('thread-abc123');

const run = result.data.run;
if (!run) {
  console.log('No runs recorded for this thread yet.');
} else {
  console.log(`run ${run.run_id}, ${run.status} in ${run.duration_ms}ms`);
  console.log(`${run.llm_calls} LLM call(s), ${run.tool_calls} tool call(s), ${run.iterations} iteration(s)`);
  console.log('Tokens:', run.usage.total_tokens);

  for (const span of run.spans) {
    console.log(`  ${'  '.repeat(span.parent ? 1 : 0)}[${span.kind}] ${span.name} +${span.start_ms}ms (${span.duration_ms}ms)`);
  }
}
```

The response types are in [observability()](/docs/reference/client/graph#observabilitythreadid-runid).

A single run is returned per call, and omitting `runId` returns the **last** entry in `run_ids`. `run_ids` is ordered oldest first, so a run picker fetches the list once and then requests each run by id:

```ts
const { data } = await client.observability(threadId);

for (const runId of data.run_ids) {
  const detail = await client.observability(threadId, runId);
  console.log(runId, detail.data.run?.duration_ms, detail.data.run?.usage.total_tokens);
}
```

### Use case: find the slowest node in a run

```ts
const { data } = await client.observability(threadId);

const slowest = (data.run?.spans ?? [])
  .filter(s => s.kind === 'node')
  .sort((a, b) => b.duration_ms - a.duration_ms)[0];

if (slowest) {
  console.log(`Slowest node: ${slowest.name} (${slowest.duration_ms}ms)`);
}
```

### Notes

- Traces are reconstructed from what the server recorded during the run. A thread that has never been invoked, or a server with telemetry recording disabled, returns `run: null` and `run_count: 0` rather than an error.
- `start_ms` and `offset_ms` are offsets from the start of the run, not absolute timestamps. Add `started_at * 1000` to place them on a wall clock.
- Retention is bounded by the server's telemetry store, so old runs eventually drop out of `run_ids`.

---

## stopGraph()

Sends a stop signal to a running graph execution via `POST /v1/graph/stop`. The server sets a stop flag on the thread; the graph checks this flag after each node and halts before starting the next node.

The stop request belongs to the run that was active when you sent it, so starting a new run on the thread does not cancel a stop meant for the earlier run.

```ts
const result = await client.stopGraph('thread-abc123');

console.log('Stop accepted:', result.data.ok);
console.log('Was running:', result.data.running);
console.log('Reason:', result.data.reason); // present when nothing was stopped
```

### StopGraphResponse shape

The server returns the result of the graph's stop request as `data`:

| Field | Meaning |
|---|---|
| `ok` | `true` when the request was handled; `false` with `reason: 'no-checkpointer'` or `'no-state'` when it could not be. |
| `running` | Whether the thread was running when the request arrived. |
| `reason` | Set to `'not-running'` when the thread exists but was not running. |

### Stopping a stream in progress

The most common pattern: a user clicks a stop button while a stream is running.

```ts
// No thread_id: the server starts a thread and sends its id on every chunk.
const stream = client.stream([
  Message.text_message('Write a very long essay about the universe.'),
]);

let threadId: string | undefined;
let stopped = false;

document.getElementById('stop-btn')!.addEventListener('click', async () => {
  stopped = true;
  if (threadId) await client.stopGraph(threadId);
});

for await (const chunk of stream) {
  if (chunk.thread_id) threadId = chunk.thread_id;
  if (stopped) break;

  if (chunk.event === 'message' && chunk.message?.delta) {
    const text = chunk.message.content
      .filter(b => b.type === 'text')
      .map(b => (b as any).text as string)
      .join('');
    appendToUI(text);
  }
}
```

### Notes

- `stopGraph()` is a request, not a guarantee. The graph processes the flag between nodes, so it may produce one more response message before stopping.
- After stopping, the thread state is preserved. A later call on the same `thread_id` with a new user message starts a new turn on the saved conversation; a call without new messages resumes at the saved node.
- If the thread exists but is not running, the call returns `ok: true` with `running: false` and `reason: 'not-running'`. If the thread has no saved state, it returns `ok: false` with `reason: 'no-state'`. Stopping needs a checkpointer.

---

## fixGraph()

Repairs a thread's saved state via `POST /v1/graph/fix` when a run stopped after the model asked for tools but before the results were saved. This is a recovery operation for threads left broken by an interrupted execution, typically when the server was restarted mid-tool-call or when a network error cut a streaming connection.

```ts
const result = await client.fixGraph('thread-abc123');

console.log('Fix successful:', result.data.success);
console.log('Messages removed:', result.data.removed_count);
```

### FixGraphResponse shape

```ts
interface FixGraphResponse {
  data: {
    success: boolean;
    message: string;
    removed_count: number;
    state?: Record<string, any>;  // Updated state after the fix, when the thread has one
  };
  metadata: ResponseMetadata;
}
```

### When to call fixGraph()

Call `fixGraph()` when a thread gets stuck after an interrupted execution. The symptom is a `GRAPH_ERROR` or the graph refusing to accept new messages on a thread. The root cause is an assistant message whose tool calls have no matching tool result, left behind by a tool call that never completed.

```ts
async function invokeWithRecovery(threadId: string, message: string) {
  try {
    return await client.invoke(
      [Message.text_message(message)],
      { config: { thread_id: threadId } }
    );
  } catch (err) {
    if (err instanceof TenxGraphError && err.errorCode.startsWith('GRAPH')) {
      console.warn('Graph error, attempting state repair...');
      const fix = await client.fixGraph(threadId);
      console.log(`Removed ${fix.data.removed_count} broken message(s). Retrying.`);

      // Retry once after the fix
      return await client.invoke(
        [Message.text_message(message)],
        { config: { thread_id: threadId } }
      );
    }
    throw err;
  }
}
```

### How it works

`fixGraph()` loads the thread's saved state from the checkpointer and repairs the message history in two steps:

1. It removes an assistant message when any of its tool calls has no matching tool result, matched by tool call id.
2. It then removes tool result messages whose call no longer exists, including results left over from a message removed in step 1, so every remaining result has its call.

If the thread is paused (an `interrupt()`, a client tool call waiting for its result, or a human-approval pause), the unanswered calls of the latest assistant message are kept, because the pause is waiting on them. Earlier dangling calls are still removed. Messages without tool calls are never touched.

When nothing needs fixing, the call returns `removed_count: 0` and does not write the state. If the thread has no saved state, the call returns `success: false` with `removed_count: 0` instead of an error.

---

## Human-in-the-loop: detect and answer a pause

A run pauses before or after a node listed in `interrupt_before` / `interrupt_after`, or where graph code calls `interrupt()`. The pause arrives as an `updates` chunk at every `response_granularity`, so the default `'low'` shows it. Its `data.pause` is `'before'`, `'after'` or `'interrupt'` (a `'remote_tool'` pause is a client tool, which the client runs for you). `graph().data.info.interrupt_before` and `.interrupt_after` list the nodes that can pause.

```ts
import { Message, getInterrupt, type Interrupt } from '10xgraph-client';

let threadId: string | undefined;
let interrupt: Interrupt | null = null;
let pausedAtNode = false;

for await (const chunk of client.stream([Message.text_message('Delete the old reports.')])) {
  if (chunk.thread_id) threadId = chunk.thread_id;
  interrupt = getInterrupt(chunk) ?? interrupt; // interrupt() pause: id, reason, value, response_schema
  if (chunk.event === 'updates' && (chunk.data?.pause === 'before' || chunk.data?.pause === 'after')) {
    pausedAtNode = true;
  }
}
```

### Answer an interrupt() pause

Send `resume` with the interrupt's id and an empty `messages` array. `approveInterrupt()` and `rejectInterrupt()` build both fields:

```ts
import { approveInterrupt, rejectInterrupt } from '10xgraph-client';

await client.invoke([], { config: { thread_id: threadId }, ...approveInterrupt(interrupt!, { approved: true }) });
// or cancel: the code resumes with null, and response_schema is not checked
await client.invoke([], { config: { thread_id: threadId }, ...rejectInterrupt(interrupt!) });
```

A thread that is not paused at that interrupt answers 409 (`ConflictError`). A value that fails the interrupt's `response_schema` answers 422 (`ValidationError`).

### Continue after an interrupt_before or interrupt_after pause

These pauses take no resume value. Send the next user message on the same thread; the graph continues from the paused node with all prior state:

```ts
await client.invoke([Message.text_message('Approved. Proceed.')], { config: { thread_id: threadId } });
```

### Check whether a thread is paused

```ts
const meta = (await client.threadState(threadId!)).data.state.execution_meta;

if (meta.status?.startsWith('interrupted')) {
  console.log(`Paused at "${meta.interrupted_node}": ${meta.interrupt_reason}`);
}
```

`status` is `running`, `interrupted_before`, `interrupted_after`, `completed` or `error`. A pause is saved by the checkpointer, so with a durable checkpointer it survives a server restart.

---

## Common errors and debugging

| Symptom | Cause | Solution |
|---|---|---|
| `stopGraph` returns `ok: false` | The graph has no checkpointer (`reason: 'no-checkpointer'`) or the thread has no saved state (`reason: 'no-state'`). | Compile the graph with a checkpointer and verify the `threadId`. Use `threads()` to list threads. |
| `fixGraph` returns `success: false` | The thread has no saved state. | Ensure the graph has a checkpointer and the thread has been invoked at least once. |
| `403` on `stopGraph` or `fixGraph` | The caller's role lacks the permission. | Check the roles in the server's `auth` config; `client.me()` shows what the token grants. |
| `409` on `fixGraph` | A run is active on the thread. | Wait for it to end, or call `stopGraph()` first. |
| `observability` returns `run: null` | No runs have been recorded for the thread, or telemetry is disabled. | Invoke the thread at least once to generate a run. Check the server's telemetry configuration. |
| Stream never shows the pause even though `interrupt_before` is set | The node is never reached. | Check that `graph().data.info.interrupt_before` includes the node and that the run gets there. |
