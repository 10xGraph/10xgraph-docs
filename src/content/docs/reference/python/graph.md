---
title: Graph
seoTitle: "StateGraph API reference (Python)"
description: "Reference for StateGraph, CompiledGraph, Node, Edge, BaseAgent and RemoteToolConfig: signatures, parameters, returns, config keys and errors."
section: Reference
group: "Python library"
order: 20
label: Graph
updated: "2026-10-08"
---

The graph module provides the core building blocks for constructing and executing agent workflows. `StateGraph` builds workflows, `CompiledGraph` runs them, and supporting classes like `Node`, `Edge`, `BaseAgent`, and `RemoteToolConfig` configure execution. Every 10xGraph application starts with a graph.

## Import paths

```python
from tenxgraph.core.graph import (
    Agent, BaseAgent, CompiledGraph, Edge, Node, RemoteToolConfig, StateGraph, ToolNode
)
from tenxgraph.core.state import AgentState, Message, StreamChunk
from tenxgraph.utils import END, START, ResponseGranularity
```

---

## Constants

The two sentinel names that mark where a graph starts and ends.

| Name | Value | Description |
|---|---|---|
| `START` | `"__start__"` | Sentinel node name. Use as the source of the first edge to set the entry point. |
| `END` | `"__end__"` | Sentinel node name. Add an edge to `END` from any terminal node. |

---

## `StateGraph[StateT]`

The builder class. Construct a workflow by adding nodes and edges, then call `compile()` to get an executable `CompiledGraph`. For the concept, see [State graph](/docs/concepts/state-graph).

### Constructor

The constructor takes an optional state, plus optional context manager, publisher, ID generator and DI container.

```python
from tenxgraph.core.graph import StateGraph
from tenxgraph.core.state import AgentState

graph = StateGraph()                          # default AgentState
graph = StateGraph(MyCustomState())           # custom state instance
graph = StateGraph(MyCustomState)             # custom AgentState subclass (instantiated automatically)
```

**Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `state` | `StateT \| type[StateT] \| None` | `None` | Initial state instance, or an `AgentState` subclass to instantiate. Defaults to `AgentState()`. |
| `context_manager` | `BaseContextManager \| None` | `None` | Cross-node state operation handler. |
| `publisher` | `BasePublisher \| list[BasePublisher] \| None` | `None` | Event publisher for monitoring. A list is combined into one composite publisher. |
| `id_generator` | `BaseIDGenerator \| None` | `None` | ID generator for messages and threads. Uses `DefaultIDGenerator()` when `None`. |
| `container` | `InjectQ \| None` | `None` | Dependency injection container. Uses global singleton if `None`. |

---

### Methods

#### `add_node`

Registers a node. Pass a function, or a name plus a function, `ToolNode` or `Agent`.

```python
graph.add_node(func)                          # name inferred from function.__name__
graph.add_node("my_node", func)              # explicit name
graph.add_node("agent", agent_instance)      # Agent or ToolNode instance
```

Returns `StateGraph` for chaining. Raises `ValueError` if the arguments match none of the patterns below.

| Calling pattern | When to use |
|---|---|
| `add_node(func)` | Simple function nodes where the function name is a good node name. |
| `add_node("name", func)` | When you need a custom node name. |
| `add_node("name", agent)` | When attaching an `Agent` or `ToolNode` instance. |

---

#### `add_edge`

Adds a static edge between two nodes.

```python
graph.add_edge(START, "entry")   # also sets the entry point
graph.add_edge("entry", END)
graph.add_edge("node_a", "node_b")
```

The graph always follows this route. An edge from `START` also sets the entry point. Returns `StateGraph`.

---

#### `add_conditional_edges`

Routes from a node using a function evaluated at run time. The condition receives only the current `state` (not `config`) and must be side-effect free.

```python
def route(state: AgentState) -> str:
    # Return a node name (or END) directly
    if state.context and state.context[-1].text() == "done":
        return END
    return "process"

graph.add_conditional_edges("check", route)

# With a path map: the return value is looked up in the map
graph.add_conditional_edges(
    "classify",
    lambda state: "urgent" if "urgent" in state.context[-1].text() else "normal",
    path_map={
        "urgent": "urgent_handler",
        "normal": "normal_handler",
    },
)
```

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `from_node` | `str` | Source node name. |
| `condition` | `Callable` | Function receiving `state` and returning a routing key or node name. |
| `path_map` | `dict[str, str] \| None` | Maps condition return values to node names. If `None`, the condition must return a node name directly. Returns `StateGraph`. |

---

#### `set_entry_point`

Sets the first node to run.

```python
graph.set_entry_point("my_node")
# equivalent to graph.add_edge(START, "my_node")
```

---

#### `override_node`

Replaces an existing node with a new function, Agent, or ToolNode. Raises `KeyError` if the node does not exist. Useful for swapping production nodes with test doubles before compilation.

```python
graph.override_node("MAIN", test_agent)
```

---

#### `compile`

Validates the graph and returns an executable `CompiledGraph`.

```python
app: CompiledGraph = graph.compile()

app = graph.compile(
    checkpointer=my_checkpointer,
    store=my_store,
    media_store=my_media_store,
    interrupt_before=["review_node"],
    interrupt_after=["tool_node"],
    shutdown_timeout=30.0,
    node_aliases={"old_node": "new_node"},  # after renaming a node
)
```

**Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `checkpointer` | `BaseCheckpointer \| None` | `None` | State persistence backend. Defaults to `InMemoryCheckpointer`. |
| `store` | `BaseStore \| None` | `None` | Long-term memory store. |
| `media_store` | `BaseMediaStore \| None` | `None` | Media/file storage backend. |
| `interrupt_before` | `list[str] \| None` | `None` | Node names to pause execution **before**. |
| `interrupt_after` | `list[str] \| None` | `None` | Node names to pause execution **after**. |
| `callback_manager` | `CallbackManager` | `CallbackManager()` | Hooks for evaluation collectors and monitoring. |
| `shutdown_timeout` | `float` | `30.0` | Total seconds `aclose()` splits between the grace, stop and cancel phases (50%, 25%, 25%). |
| `node_aliases` | `dict[str, str] \| None` | `None` | Opt-in map `{old_name: new_name}` for threads stored at a node that a deploy renamed or removed. A thread stored at `old_name` resumes at `new_name`, in `invoke` and `stream`. Without an alias such a thread fails with `StoredNodeMissingError` (`GRAPH_NODE_MISSING_001`). A stored state newer than the code raises `StateFormatVersionError` (`STATE_FORMAT_001`). |
| `owns_resources` | `bool` | `True` | Whether `aclose()` may close the checkpointer, store and publisher. A resource shared by several live graphs is closed only when the last of them closes. Pass `False` when you manage the resource yourself, for example your own connection pool. |

**Raises:** `GraphError` with `GRAPH_002` if no entry point is set, `GRAPH_003` if a node is orphaned (no edge touches it), or `GRAPH_004` if an edge target or an interrupt node does not exist.

**One graph per container.** A process runs one graph per DI container. Without `container=`, every `StateGraph` uses the global `InjectQ` singleton, so a second graph shares the first graph's checkpointer, store and context manager. Its threads then land in the first graph's database. `compile()` logs a WARNING when a checkpointer is already used by another compiled graph in the process.

Passing `container=InjectQ()` alone is not enough, because a second graph that reuses the same checkpointer object still shares its threads. To run two graphs in one process, give each graph its own container and its own checkpointer instance (and its own store, if you use one):

```python
from injectq import InjectQ
from tenxgraph.storage.checkpointer import InMemoryCheckpointer

graph_a = StateGraph(container=InjectQ())
# ... add nodes and edges to graph_a ...
app_a = graph_a.compile(checkpointer=InMemoryCheckpointer())

graph_b = StateGraph(container=InjectQ())
# ... add nodes and edges to graph_b ...
app_b = graph_b.compile(checkpointer=InMemoryCheckpointer())
```

With `PgCheckpointer`, create one instance per graph, each with its own DSN or `schema=`. The simplest and safest setup is one graph per process or container, which is also how the API server runs.

---

## `CompiledGraph[StateT]`

The executable graph produced by `StateGraph.compile()`. Do not instantiate directly.

### `invoke`

Runs the graph synchronously and returns the result.

```python
result = app.invoke(
    {"messages": [Message.text_message("Hello")]},
    config={"thread_id": "session-1", "user_id": "alice"},
    response_granularity=ResponseGranularity.LOW,
)
```

Blocks until the graph finishes. It then waits up to `shutdown_timeout` for pending background work.

Sync `invoke()`, `stream()` and `stop()` raise `RuntimeError` when they are called inside a running event loop (a Jupyter notebook, or an async web handler). The message names the async method to use: `ainvoke()`, `astream()` or `astop()`. Sync checkpointer methods such as `get_state()` raise the same way; use their async versions (`aget_state()`) there.

Publisher events are best-effort background work. Sync `invoke()` and `stream()` wait up to `shutdown_timeout` (default 30 s) for pending events, memory writes and thread naming before they return. The async `ainvoke()` and `astream()` do not wait: call `await graph.aclose()` before the process exits. At most 1000 background tasks can be pending. Beyond that, new ones are dropped, a WARNING is logged at most every 5 s, and the `background_task_manager.tasks_dropped` counter increases. Delivery is at-most-once, with no retry. A slow or unreachable sink loses events and never blocks a run.

---

### `ainvoke`

The asynchronous form of `invoke`. It starts fresh or resumes an interrupted run.

```python
result = await app.ainvoke(
    {"messages": [Message.text_message("Hello")]},
    config={"thread_id": "session-1"},
    response_granularity=ResponseGranularity.FULL,
)
```

**Parameters (both `invoke` and `ainvoke`):**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `input_data` | `dict[str, Any]` | required | Input dict. Must contain `"messages"` for new runs. |
| `config` | `dict[str, Any] \| None` | `None` | Execution config. Keys listed in [Config dictionary keys](#config-dictionary-keys). |
| `response_granularity` | `ResponseGranularity` | `LOW` | Controls how much is included in the response. See table below. |

**`ResponseGranularity` values:**

| Value | Import | What is returned |
|---|---|---|
| `LOW` | `from tenxgraph.utils import ResponseGranularity` | `messages` only |
| `PARTIAL` | same import | `messages`, `context`, `summary` |
| `FULL` | same import | `messages`, `context`, `summary`, full `state` object |

**Returns:** `dict` with keys depending on granularity. A graph that contains a `LiveAgent` raises `RuntimeError`; drive it with `arealtime()`. For streaming and interrupts, see [Stream a graph](/docs/guides/stream-graph).

---

### `stream` / `astream`

Run the graph and yield `StreamChunk` objects as it executes.

```python
# Sync
for chunk in app.stream({"messages": [msg]}, config={"thread_id": "t1"}):
    if chunk.event == "message":
        print(chunk.message.content)

# Async
async for chunk in app.astream({"messages": [msg]}, config={"thread_id": "t1"}):
    if chunk.event == "message":
        print(chunk.message.content)
```

**`StreamChunk` fields:**

| Field | Type | Description |
|---|---|---|
| `event` | `StreamEvent` | One of `MESSAGE`, `STATE`, `UPDATES`, `ERROR` (string values `"message"`, `"state"`, `"updates"`, `"error"`). |
| `message` | `Message \| None` | Populated for `MESSAGE` events. |
| `state` | `AgentState \| None` | Populated for `STATE` events. |
| `data` | `dict \| None` | Populated for `UPDATES` and `ERROR` events. |
| `thread_id` | `str \| None` | Thread ID for this execution. |
| `run_id` | `str \| None` | Run ID for this execution. |
| `metadata` | `dict \| None` | Optional extra metadata. |
| `timestamp` | `float` | UNIX timestamp of chunk creation. |

---

### `stop` / `astop`

Request that a running thread stop.

```python
# Async: call from within an async route handler
resp = await app.astop(config={"thread_id": "session-1"})
# {"ok": True, "running": True}

# Sync
resp = app.stop(config={"thread_id": "session-1"})
```

Sets a stop flag on the running execution. The graph checks this flag between node transitions and halts cleanly. `config` must carry the `thread_id` of the run. Without a checkpointer it returns `{"ok": False, "reason": "no-checkpointer"}`.

**Returns:** `dict` with `ok`, `running`, and optional `reason` keys.

---

### `override_node` (on CompiledGraph)

```python
compiled.override_node("MAIN", test_agent)
```

Same semantics as `StateGraph.override_node()` but on an already-compiled graph. Useful when testing a compiled production graph without rebuilding it.

---

### Async context manager

Use `async with` on a compiled graph so resources are released on exit. `CompiledGraph` implements the async context manager protocol. Use `async with` to ensure `aclose()` runs automatically on exit, even when an exception is raised:

```python
async def main():
    graph = graph_builder.compile()
    async with graph:
        result = await graph.ainvoke({"messages": [msg]})

# aclose() has been called here, even if ainvoke raised
```

When your graph is built by an async factory function, await the factory first, then use `async with`:

```python
async def main():
    async with await build_and_compile_graph() as graph:
        result = await graph.ainvoke(input_data)
```

---

### `aclose`

Releases the graph's resources.

```python
await app.aclose()
```

```python
stats = await app.aclose(grace=10, stop_timeout=5, timeout=5)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `grace` | `float \| None` | 50% of `shutdown_timeout` | Seconds to let active runs finish on their own. |
| `stop_timeout` | `float \| None` | 25% of `shutdown_timeout` | Seconds to wait after the stop flag is set. Each run saves its thread INTERRUPTED (reason `stop_requested`). |
| `timeout` | `float \| None` | 25% of `shutdown_timeout` | Seconds for the hard cancel (half) and the background drain (the rest). The cancel saves the thread INTERRUPTED (reason `shutdown`). |

Order: refuse new runs (they raise `GraphClosedError`, code `GRAPH_CLOSED_001`), wait for `grace`, set the stop flag, wait for `stop_timeout`, hard-cancel what still runs, drain background tasks, then release the checkpointer, the publisher and the store by the resource ownership rules. Always call this when shutting down a long-lived application.

The returned dict has `runs` (`active`, `finished`, `stopped`, `cancelled`), `background_tasks` and one entry per released component. To call `aclose()` on SIGTERM and SIGINT, see [`install_shutdown_signals`](/docs/reference/python/runtime-utilities#install_shutdown_signalsgraph-).

`aclose()` is idempotent: calling it a second time is a no-op and returns `{"status": "already_closed"}` rather than raising. This means calling `aclose()` explicitly inside an `async with` block, then having `__aexit__` call it again, is safe.

---

### `generate_graph`

Returns a dictionary describing the graph structure.

```python
graph_info = app.generate_graph()
```

**Returns:** `dict` with keys `nodes` (list of node objects with `id` and `name`), `edges` (list of edge objects with `id`, `source`, `target`), and `info` (metadata including node and edge counts, checkpointer and store presence, interrupt lists, context manager type, ID generator type, state type and state fields). Node and edge `id` values are random UUIDs generated on each call.

---

### `attach_remote_tools`

Attaches client-executed tools to a `ToolNode`.

```python
from tenxgraph.core.graph import RemoteToolConfig

tools = [
    RemoteToolConfig(
        node="tool_node",
        name="read_clipboard",
        description="Read the current clipboard text",
        parameters={
            "type": "object",
            "properties": {},
            "required": [],
        },
    )
]
app.attach_remote_tools(tools)

# Or pass OpenAI-compatible schemas with a node name
openai_schemas = [{
    "type": "function",
    "function": {
        "name": "read_clipboard",
        "description": "Read the current clipboard text",
        "parameters": {"type": "object", "properties": {}, "required": []},
    },
}]
app.attach_remote_tools(openai_schemas, node_name="tool_node")
```

Remote tools run on the client, not the server. The graph advertises their schemas to the model and emits a `RemoteToolCallBlock` when one is called.

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `tools` | `list[dict or RemoteToolConfig]` | Tool configurations. Each can be a `RemoteToolConfig` with `node`, `name`, `description`, `parameters`, or an OpenAI function schema. |
| `node_name` | `str or None` | ToolNode name when passing OpenAI schemas. Omit if each tool carries its own `node` value. |

**Raises:** `GraphError` (`GRAPH_004`) if the node does not exist, `GraphError` (`GRAPH_005`) if it is not a `ToolNode`, and `ValueError` for duplicate tool names or a tool whose `node` differs from `node_name`.

---

### `is_realtime`

Reports whether the graph must be driven in realtime mode.

```python
if app.is_realtime():
    # arealtime(input_queue, config=None, state=None) yields realtime events
    async for event in app.arealtime(input_queue):
        print(event)
else:
    result = app.invoke({"messages": [msg]})
```

Returns `True` if the graph contains at least one `LiveAgent`, meaning it must be driven via `arealtime()` or `realtime()` rather than `invoke()` or `stream()`. See [Use realtime audio](/docs/guides/use-realtime-audio).

**Returns:** `bool`

---

## `Node`

Represents an executable unit within a graph. It wraps a function, `ToolNode`, or `Agent` that processes state and returns output.

**Constructor:**

```python
from tenxgraph.core.graph import Node

node = Node("processor", my_function)
```

| Parameter | Type | Description |
|---|---|---|
| `name` | `str` | Unique identifier for the node within the graph. |
| `func` | `Callable, ToolNode, or BaseAgent` | The function, ToolNode, or Agent to execute. Functions must accept at least `state` and `config` as positional arguments. |

Nodes are typically added to a graph via `StateGraph.add_node()` rather than instantiated directly.

---

## `Edge`

Represents a connection between two nodes in the graph, defining routing logic and execution flow.

**Constructor:**

```python
from tenxgraph.core.graph import Edge

# Static edge
edge = Edge("process", "approval")

# Conditional edge: the condition receives only the state
def needs_approval(state):
    return bool(state.context) and "approve" in state.context[-1].text()

conditional_edge = Edge("process", "approval", condition=needs_approval)
```

| Parameter | Type | Description |
|---|---|---|
| `from_node` | `str` | Name of the source node. |
| `to_node` | `str` | Name of the destination node or special constant (`END`). |
| `condition` | `Callable or None` | Optional function receiving `state` that returns a node name, a routing key or a boolean. If `None`, the edge is static and always followed. |

Edges are typically added to a graph via `StateGraph.add_edge()` or `StateGraph.add_conditional_edges()` rather than instantiated directly.

---

## `BaseAgent`

Abstract base class for all agents (production and test). Subclasses must implement `execute()` and `_call_llm()`. `Agent` is the concrete production subclass; its own constructor accepts more options (see [Agent](/docs/reference/python/agent)).

**Constructor:**

```python
from tenxgraph.core.graph import Agent

# Agent is a concrete subclass of BaseAgent
agent = Agent(
    model="gpt-4o",
    provider="openai",
    system_prompt=[{"role": "system", "content": "You are helpful."}],
)
```

**`BaseAgent` parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `model` | `str` | required | LLM model identifier (for example `"gpt-4o"`). |
| `provider` | `str or None` | `None` | Explicit provider override. Inferred from model if not set. |
| `system_prompt` | `list[dict] or None` | `None` | System prompt as a list of message dicts. |
| `tool_node` | `str, ToolNode, or None` | `None` | ToolNode instance or name of an existing graph node whose func is a ToolNode. |
| `extra_messages` | `list[Message] or None` | `None` | Additional messages to prepend to the context. |
| `client` | `Any` | `None` | Escape hatch: custom LLM client. |
| `base_url` | `str or None` | `None` | For OpenAI-compatible APIs (Ollama, vLLM). |
| `trim_context` | `bool` | `False` | Whether to trim long contexts. |
| `tools_tags` | `set[str] or None` | `None` | Filter tools by tags. |
| `**llm_kwargs` | `Any` | | Extra provider-specific parameters. |

**Methods:**

| Method | Description |
|---|---|
| `async execute(state, config)` | Main execution logic. Must be implemented by subclasses. |
| `get_tool_node()` | Returns the agent's internal ToolNode, or None if not configured (the base class always returns `None`; `Agent` overrides it). |
| `async __call__(state, config)` | Makes the agent callable like a function. Delegates to `execute()`. |

---

## `RemoteToolConfig`

Validated Pydantic model for a tool executed by the client rather than the server. Unknown fields are rejected, so typos fail at startup.

**Constructor:**

```python
from tenxgraph.core.graph import RemoteToolConfig

config = RemoteToolConfig(
    node="tool_node",
    name="read_clipboard",
    description="Read the current clipboard text",
    parameters={
        "type": "object",
        "properties": {
            "full": {
                "type": "boolean",
                "description": "Return full history if true",
            }
        },
        "required": ["full"],
    },
)
```

| Parameter | Type | Description |
|---|---|---|
| `node` (alias `node_name`) | `str` | ToolNode name where this tool will be registered. |
| `name` | `str` | Tool name (1+ characters, non-blank after stripping). |
| `description` | `str` | Tool description (1+ characters, non-blank after stripping). |
| `parameters` | `dict` | JSON Schema for tool parameters. Must have `type: "object"`, a `properties` dict and a `required` list of strings; missing keys are filled in. Defaults to an empty object schema. |

**Methods:**

| Method | Description |
|---|---|
| `to_tool_schema()` | Returns the OpenAI-compatible function schema consumed by ToolNode. |

---

## Config dictionary keys

The `config` dict passed to `invoke`, `ainvoke`, `stream`, `astream` and `stop` accepts these keys. Missing identifiers are generated for you.

| Key | Type | Auto-generated if missing | Description |
|---|---|---|---|
| `thread_id` | `str \| int` | Yes (UUID or from ID generator) | Identifies the conversation thread for checkpointing. |
| `user_id` | `str` | Yes (`"anonymous"`) | User identifier. Override in production. |
| `run_id` | `str \| int` | Yes | Unique run identifier. |
| `recursion_limit` | `int` | No (framework default: 25) | Maximum node transitions before `GraphRecursionError`. |
| `timestamp` | `str` | Yes | ISO 8601 timestamp of the run. |
| `node_timeout` | `float \| None` | No (default: `None`, no limit) | Deadline for a single node execution. |
| `tool_timeout` | `float \| None` | No (default: `None`, no limit) | Deadline for a single tool call inside a `ToolNode`. |
| `durable_checkpoint_every_step` | `bool` | No (default `True`) | Persist state and new messages after each completed step. See [Set up checkpointing](/docs/guides/set-up-checkpointing). |

### Execution deadlines

You can put a deadline on every node and tool call, so a hung call cannot block a run forever. There is no default deadline. A value you set applies to both invoke and stream.

Nothing else bounds a node or a tool. The provider SDK's own timeout does not cover custom tools, MCP calls, or condition functions, so without a deadline a hung call blocks the run forever: the loop never advances a step, the recursion limit never trips, and the between-nodes stop check is never reached.

Treat them as a backstop against hangs, not a latency budget. Keep the node deadline above the LLM client timeout (600s) so a slow LLM call fails with its own error rather than being masked by the node deadline.

```python
result = app.invoke(
    input_data,
    config={
        "thread_id": "t-1",
        "node_timeout": 120.0,   # tighten the node deadline
        "tool_timeout": 30.0,    # tighten the tool deadline
    },
)

# Disable a deadline entirely: pass None, or any non-positive number
config = {"thread_id": "t-1", "node_timeout": None}
```

An absent key means no deadline. An explicit `None` also means no deadline. A non-positive value (`0`) disables it too. A value that cannot be parsed as a float logs a warning and falls back to no deadline.

When a deadline expires the node task is cancelled and a `NodeTimeoutError` is raised, which the execution loop persists and reports as a normal node error.

---

## Node function signature

Node functions receive the current state and config as their first two positional arguments. Additional keyword arguments are resolved from the dependency injection container (see [Dependency injection](/docs/concepts/dependency-injection)):

```python
from tenxgraph.core.state import AgentState, Message
from tenxgraph.storage.store import BaseStore

def my_node(state: AgentState, config: dict, store: BaseStore) -> list:
    # Return a list of Message objects to append to state.context
    return [Message.text_message("response", role="assistant")]
```

Alternatively, functions can return an updated state dict:

```python
def my_node(state: AgentState, config: dict) -> dict:
    return {"context_summary": "Updated summary"}
```

---

## Common errors

| Error | Cause | Fix |
|---|---|---|
| `GraphError GRAPH_002` | `compile()` called with no entry point. | Call `set_entry_point()` or `add_edge(START, "node")`. |
| `GraphError GRAPH_003` | A node has no edge touching it. | Connect the node or remove it. |
| `GraphError GRAPH_004` | An edge target, an interrupt node, or an `attach_remote_tools` node does not exist. | Check node names against `graph.nodes.keys()`. |
| `GraphError GRAPH_005` | `attach_remote_tools` targeted a node that is not a `ToolNode`. | Pass the name of a `ToolNode` node. |
| `GraphError GRAPH_ROUTING_001` | A conditional edge function raised while routing. | Fix the condition function; it receives only `state`. |
| `GraphRecursionError` | Execution exceeded `recursion_limit`. | Increase `recursion_limit` in config or fix a cycle in the graph. |
| `RuntimeError` in async context | `invoke()` called inside a running event loop. | Use `ainvoke()` instead. |
| `RuntimeError` on a realtime graph | `invoke` or `stream` called on a graph with a `LiveAgent`. | Use `arealtime()`. |
| `NodeTimeoutError` | A node or tool exceeded `node_timeout` / `tool_timeout`. | Raise the relevant deadline in config, or fix the hanging call. |
