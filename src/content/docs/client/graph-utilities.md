---
title: Graph utilities and human-in-the-loop
description: "Inspect graph topology and state, stop execution, repair broken threads, view execution traces, and handle interrupts for human approval workflows."
section: TypeScript client
group: Features
order: 90
label: Graph utilities
updated: "2026-10-27"
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

### GraphResponse shape

```ts
interface GraphResponse {
  data: {
    info: {
      node_count: number;
      edge_count: number;
      checkpointer: boolean;
      checkpointer_type: string;
      publisher: boolean;
      store: boolean;
      interrupt_before: string[];
      interrupt_after: string[];
      context_type: string;
      id_generator: string;
      id_type: string;
      state_type: string;
      state_fields: string[];
    };
    nodes: Array<{ id: string; name: string }>;
    edges: Array<{ id: string; source: string; target: string }>;
  };
  metadata: { request_id: string; timestamp: string; message: string };
}
```

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

### GraphToolsResponse shape

```ts
type ToolSource = 'local' | 'mcp' | 'remote';

interface GraphToolsResponse {
  data: {
    node_count: number;
    tool_count: number;
    nodes: Array<{
      node_name: string;
      tool_count: number;
      tools: Array<{
        name: string;
        description: string;
        source: ToolSource;
        parameters: Record<string, any>;   // JSON Schema, OpenAI function-calling shape
      }>;
    }>;
  };
  metadata: { request_id: string; timestamp: string; message: string };
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

### Use case: render a capability list in a UI

```ts
const { data } = await client.graphTools();

const bySource = data.nodes
  .flatMap(n => n.tools)
  .reduce<Record<string, string[]>>((acc, t) => {
    (acc[t.source] ??= []).push(t.name);
    return acc;
  }, {});

// { local: ['search_docs'], mcp: ['create_issue', 'list_repos'], remote: ['get_location'] }
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

### StateSchemaResponse shape

```ts
interface StateSchemaResponse {
  data: {
    title?: string;
    description?: string;
    type?: string;
    properties: Record<string, FieldSchema>;
    required?: string[];
    $defs?: Record<string, any>;
  };
  metadata: { request_id: string; timestamp: string; message: string };
}

interface FieldSchema {
  type?: string | string[];
  description?: string;
  default?: any;
  items?: any;
  properties?: Record<string, FieldSchema>;
  required?: string[];
  enum?: any[];
  $ref?: string;
  anyOf?: any[];
  [key: string]: any;
}
```

### Use case: generate a TypeScript interface at runtime

```ts
const result = await client.graphStateSchema();

for (const [field, def] of Object.entries(result.data.properties)) {
  const tsType = def.type === 'array'
    ? `${(def.items as any)?.type ?? 'any'}[]`
    : (def.type as string) ?? 'any';
  console.log(`  ${field}: ${tsType};`);
}
```

### Use case: validate initial_state before invoking

```ts
const schema = (await client.graphStateSchema()).data;
const required = schema.required ?? [];

const initialState = { user_id: 'abc' };
const missing = required.filter(f => !(f in initialState));

if (missing.length > 0) {
  throw new Error(`Missing required state fields: ${missing.join(', ')}`);
}

await client.invoke([Message.text_message('Hello')], { initial_state: initialState });
```

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

### ObservabilityResponse shape

```ts
interface ObservabilityResponse {
  data: {
    thread_id: string;
    run_count: number;
    run_ids: string[];
    run: ObsRun | null;     // the requested run, or the latest; null when nothing is recorded
  };
  metadata: { request_id: string; timestamp: string; message: string };
}

interface ObsRun {
  run_id: string;
  thread_id: string;
  status: string;             // e.g. 'done', 'error'
  started_at: number | null;  // UNIX seconds
  finished_at: number | null;
  duration_ms: number;
  spans: ObsSpan[];
  events: ObsEvent[];
  usage: ObsTokenUsage;
  llm_calls: number;
  tool_calls: number;
  iterations: number;
}

interface ObsSpan {
  id: string;
  name: string;
  kind: 'root' | 'node' | 'llm' | 'tool';
  parent: string | null;      // span id, or null for the root
  start_ms: number;           // offset from the run start
  duration_ms: number;
  model?: string | null;      // set on 'llm' spans
  input_tokens?: number | null;
  output_tokens?: number | null;
}

interface ObsEvent {
  id: string;
  type: string;
  node: string;
  offset_ms: number;          // offset from the run start
  summary: string;
}

interface ObsTokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
}
```

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

The exported `StopGraphResponse` TypeScript type declares `success`, `message`, `thread_id` and `stopped_at` instead. The server does not send those fields, so read `ok`, `running` and `reason`, and cast `result.data` to a type of your own (for example `result.data as unknown as { ok: boolean; running?: boolean; reason?: string }`) to get type checking.

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
- After stopping, the thread state is preserved. The next `invoke()` or `stream()` call on the same `thread_id` starts from where execution was when the stop flag was checked.
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

## Human-in-the-loop: checking and resuming after interrupts

Graph execution can be paused before or after designated nodes (`interrupt_before` / `interrupt_after`) for human review or approval. When the graph pauses, it saves the pause in the thread's `execution_meta` and stops. The client sees the pause in two places: the `updates` stream chunk, and the saved thread state.

The fields of `execution_meta` on the wire are:

| Field | Meaning |
|---|---|
| `status` | `running`, `interrupted_before`, `interrupted_after`, `completed` or `error`. |
| `interrupted_node` | Name of the node the graph paused at. `null` when not paused. |
| `interrupt_reason` | Text such as `interrupt_before: approve`. |
| `interrupt_data` | Optional extra data attached to the pause. |
| `current_node`, `step` | Execution progress. |

The exported `AgentState` TypeScript class declares an `execution_meta.interrupt` object and an `is_interrupted` flag. The server does not send those, so read the fields above from `threadState()` (cast to a type of your own for type checking).

### Detecting an interrupt in a stream

The default `response_granularity` of `stream()` is `'low'`, which yields only `message` and `error` chunks. To see the pause as it happens, request `'full'`. The final `updates` chunk then carries `data.is_interrupted`:

```ts
const stream = client.stream(
  [Message.text_message('Proceed with the high-cost operation.')],
  { response_granularity: 'full' } // no thread_id: the server starts a thread
);

let threadId: string | undefined;
for await (const chunk of stream) {
  if (chunk.thread_id) threadId = chunk.thread_id; // keep it to resume later
  if (chunk.event === 'updates' && chunk.data?.is_interrupted) {
    console.log('Execution paused; the graph is waiting for approval.');
    break;
  }

  if (chunk.event === 'message' && chunk.message) {
    console.log('Response:', chunk.message);
  }
}
```

### Resuming after human approval

To resume after an interrupt, invoke the same thread again, with the `threadId` you read from the stream. The graph clears the pause, continues from the paused node, and keeps all prior state:

```ts
// User reviews the decision and approves
const approval = await client.invoke(
  [Message.text_message('Approved. Proceed.')],
  { config: { thread_id: threadId } }
);

console.log('Final result:', approval.messages[approval.messages.length - 1]);
```

### Querying interrupt status outside of streaming

Use `threadState()` to check whether a thread is currently paused. The state is at `data.state`:

```ts
const { data } = await client.threadState(threadId);
const meta = data.state.execution_meta as unknown as {
  status: string;
  interrupted_node: string | null;
  interrupt_reason: string | null;
};

if (meta.status.startsWith('interrupted')) {
  console.log(`Thread paused at "${meta.interrupted_node}": ${meta.interrupt_reason}`);
} else {
  console.log('Thread is not paused.');
}
```

### Notes

- Interrupts are only possible if the graph was compiled with `interrupt_before` or `interrupt_after`. Check `graph().data.info.interrupt_before` and `.interrupt_after` to see which nodes pause.
- Interrupted state is saved by the checkpointer. With a durable checkpointer (such as Postgres or SQLite), it survives server restarts.
- A pause raised by the Python `interrupt()` function is different: resuming it needs a `resume` value, which `invoke()`, `stream()` and `wsStream()` take as an option. See the next section.

### Resuming an interrupt() pause

Pass `resume` with the answer, and `interrupt_id` with the id of the interrupt you are answering. Read the id from the thread state, at `execution_meta.interrupt_data.interrupt.id`. The client does not track ids for you. Send an empty `messages` array:

```ts
const { data } = await client.threadState(threadId);
const meta = data.state.execution_meta as unknown as {
  interrupt_data?: { interrupt?: { id: string } };
};
const interruptId = meta.interrupt_data?.interrupt?.id;

const result = await client.invoke([], {
  config: { thread_id: threadId },
  resume: { approved: true },
  interrupt_id: interruptId,
});
```

`interrupt_id` is optional. If the thread is not paused, or is paused at a different interrupt, the server answers 409 and the client throws `ConflictError`. If the answer fails the interrupt's `response_schema`, it throws `ValidationError` (422). Send `resume: null` to cancel.

---

## Complete example: observability and approval dashboard

This example brings together graph inspection, execution monitoring, and interrupt handling:

```ts
import { TenxGraphClient, Message } from '10xgraph-client';

const client = new TenxGraphClient({ baseUrl: 'http://localhost:8000' });

async function runWithApprovalGate(userMessage: string) {
  // 1. Inspect the graph capabilities
  const graphInfo = await client.graph();
  console.log(`Graph: ${graphInfo.data.nodes.length} nodes, ` +
    `checkpointer: ${graphInfo.data.info.checkpointer_type || 'none'}`);

  const supportsApproval = graphInfo.data.info.interrupt_before.length > 0;
  console.log(`Approval gates available: ${supportsApproval}`);

  // 2. Stream the execution
  // No thread_id: the server starts a thread and sends its id on each chunk
  const stream = client.stream(
    [Message.text_message(userMessage)],
    { response_granularity: 'full' }
  );

  const finalMessages: Message[] = [];
  let paused = false;
  let threadId = '';

  for await (const chunk of stream) {
    if (chunk.thread_id) threadId = chunk.thread_id;
    // Check for interrupt (approval gate paused execution)
    if (chunk.event === 'updates' && chunk.data?.is_interrupted) {
      paused = true;
      break;
    }

    if (chunk.event === 'message' && chunk.message?.content) {
      finalMessages.push(chunk.message);
    }
  }

  // 3. If paused, show where, then observability, then resume
  console.log(`\nExecuted on thread: ${threadId}`);
  if (paused) {
    const { data } = await client.threadState(threadId);
    const meta = data.state.execution_meta as unknown as {
      interrupted_node: string | null;
      interrupt_reason: string | null;
    };
    console.log(`\nExecution paused at "${meta.interrupted_node}": ${meta.interrupt_reason}`);

    const obs = await client.observability(threadId);

    console.log(`\nObservability: ${obs.data.run?.llm_calls || 0} LLM calls, ` +
      `${obs.data.run?.tool_calls || 0} tool calls, ` +
      `${obs.data.run?.duration_ms || 0}ms total`);

    console.log('\nWaiting for approval...');
    // In a real app, this would be a user button click or external webhook
    // For now, we simulate a 2-second approval delay
    await new Promise(r => setTimeout(r, 2000));

    console.log('Approval granted. Resuming...');
    const resumed = await client.invoke(
      [Message.text_message('Approved. Continue.')],
      { config: { thread_id: threadId } }
    );
    finalMessages.push(...resumed.messages);
  }

  return finalMessages;
}

// Run the example
runWithApprovalGate('Process this high-cost operation.')
  .then(msgs => console.log(`\nFinal: ${msgs.length} messages in thread`))
  .catch(console.error);
```

---

## Common errors and debugging

| Symptom | Cause | Solution |
|---|---|---|
| `stopGraph` returns `ok: false` | The graph has no checkpointer (`reason: 'no-checkpointer'`) or the thread has no saved state (`reason: 'no-state'`). | Compile the graph with a checkpointer and verify the `threadId`. Use `threads()` to list threads. |
| `fixGraph` returns `success: false` | The thread has no saved state. | Ensure the graph has a checkpointer and the thread has been invoked at least once. |
| `403` error on `stopGraph` or `fixGraph` | Caller lacks permission to modify the thread. | Check the `AuthorizationBackend` configured on the server; the caller may have read-only access. |
| `observability` returns `run: null` | No runs have been recorded for the thread, or telemetry is disabled. | Invoke the thread at least once to generate a run. Check the server's telemetry configuration. |
| Stream never shows the interrupt even though `interrupt_before` is set | The default `'low'` granularity hides `updates` chunks, or the node is never reached. | Pass `response_granularity: 'full'`, or check `threadState()` after the stream. Verify `graph().data.info.interrupt_before` includes the node. |
| `graphTools` returns empty `nodes` array | The graph has no `ToolNode`s. | Not an error if the agent doesn't need external tools. Add a `ToolNode` if you expect to see tools. |
| `fixGraph` returns `removed_count: 0` | No unanswered tool calls or orphaned results found; nothing to repair. | No action needed. The thread can proceed with the next invoke. |
