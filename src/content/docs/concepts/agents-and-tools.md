---
title: Agents and Tools
seoTitle: "Agent and ToolNode concepts"
description: "How Agent wraps a model, why ToolNode is needed, parallel tool dispatch, and error handling."
section: Concepts
order: 40
group: "Foundations"
label: Agents and Tools
updated: "2026-11-26"
---

`Agent` and `ToolNode` are the two built-in node types that handle language model interaction. `Agent` sends the current state to a language model and appends its response. `ToolNode` executes the tool calls the model requested and runs them in parallel. Together they form the core of tool-using agents.

## Why Agent exists

You can wrap an LLM call in a plain graph node function, but `Agent` exists to handle the machinery that all language model nodes need: message formatting, provider detection, retry logic with backoff, fallback models when retries are exhausted, response parsing, system prompt templating with state interpolation, streaming, tool integration, skills, memory, multimodal content, and reasoning modes.

Use `Agent` whenever a node calls an LLM; use a plain function node for everything else. See [Choosing a building block](/docs/concepts/choosing-a-building-block).

## Agent

`Agent` is a graph node that wraps any LLM provider. When the graph reaches an `Agent` node it sends the current conversation to the model and appends the response to state.

### Constructor

```python
from tenxgraph.core.graph import Agent

agent = Agent(
    model="gemini-2.5-flash",   # provider is detected from the model name
    system_prompt=[{"role": "system", "content": "You are a helpful assistant."}],
    tool_node=tool_node,        # a ToolNode, or the name of a ToolNode graph node
)
```

Every other option (output type, reasoning, retries, fallback models, multimodal, memory, skills, provider kwargs such as `temperature` or `base_url`) is covered in [Configure Agent](/docs/guides/configure-agent).

To give an agent [Agent Skills](https://agentskills.io/specification), pass `skills=SkillConfig(skills_dir=...)`; see [How to give an agent skills](/docs/guides/use-skills).

### System prompt interpolation

The system prompt supports `{field_name}` placeholders. Fields are resolved against the current `AgentState` at runtime.

A missing field stays as written and the rest is still filled. `extra_messages` text is filled the same way, which is the right place for values that change mid-conversation; see [prompt caching](/docs/guides/configure-agent#per-request-context-and-prompt-caching).

### Retry, fallback and reasoning

Retries are on by default (`retry_config=True`) and `fallback_models` takes over when they are exhausted. A plain model string inherits the agent's provider; use a `(model, provider)` tuple for another provider. See [Retry and fallback behavior](/docs/concepts/errors-and-limits#retry-and-fallback-behavior).

Reasoning is on by default at each provider's lowest effort; pass `reasoning_config=None` to turn it off or a dict for more. See [Reasoning configuration](/docs/guides/configure-agent#reasoning-configuration).

## ToolNode

`ToolNode` is a unified registry and executor for callable functions. It supports local Python functions and MCP tools.

### Basic usage

```python
from tenxgraph.core.graph import ToolNode

def lookup_order(order_id: str) -> str:
    """Look up the status of a customer order."""
    return f"Order {order_id}: shipped"

def refund_order(order_id: str, amount: float) -> str:
    """Refund an order for the given amount."""
    return f"Refunded {amount:.2f} for order {order_id}"

tool_node = ToolNode([lookup_order, refund_order])
```

The function's **docstring** becomes the tool description shown to the model. **Type annotations** define the parameter schema.

### Parallel tool dispatch

When the model requests several tool calls in one message, `ToolNode` runs them concurrently, each in its own task, at most 10 at a time (`DEFAULT_MAX_PARALLEL_TOOL_CALLS`). All results are appended to state together, so the next node sees them all. To run them one at a time, set `config["max_parallel_tool_calls"] = 1` (see [Parallel tool calls](/docs/concepts/errors-and-limits#parallel-tool-calls)).

### Adding tools after creation

```python
tool_node = ToolNode([lookup_order])

def search_db(query: str) -> str:
    """Search the internal database."""
    ...

tool_node.add_tool(search_db)
```

### Injectable parameters

A tool function receives only these parameters by name. They are invisible to the model and do not appear in the tool schema:

| Parameter | Type | What is injected |
|---|---|---|
| `state` | `AgentState \| None` | Current graph state |
| `tool_call_id` | `str \| None` | ID of this specific tool call |
| `config` | `dict` | Current execution config (includes `thread_id`, `user_id`, etc.) |
| `emit` | stream emitter | Emit custom stream chunks |
| `credential` | `UserCredential \| None` | The caller's credential from `config["credential"]` |

Services (the store, checkpointer, publisher, context manager, task manager) come from the container: declare `store: BaseStore = Inject[BaseStore]` and resolve it with `fresh()`; see [Dependency injection](/docs/concepts/dependency-injection). A plain parameter named `store` or `checkpointer` is hidden from the model but not filled, so the call fails at run time.

```python
from tenxgraph.core.state import AgentState

def lookup_order(
    order_id: str,                        # from model tool call
    state: AgentState | None = None,       # injected, invisible to model
    tool_call_id: str | None = None,       # injected, invisible to model
    config: dict | None = None,            # injected, invisible to model
) -> str:
    """Look up the status of a customer order."""
    user = config.get("user_id", "anon") if config else "anon"
    return f"Order {order_id}: shipped (requested by {user})"
```

To update state fields as well as answer the model, return a `ToolResult`; see [ToolResult](/docs/concepts/state-and-messages#toolresult-tools-that-update-state).

### MCP tools

10xGraph supports the Model Context Protocol (MCP), allowing you to expose both local Python functions and MCP server tools through the same `ToolNode`. Install with `pip install "10xgraph[mcp]"`, create an MCP client (using fastmcp or another MCP SDK), and pass it to `ToolNode(client=...)`. The same parallel execution, error handling, and injectable parameters apply to MCP tools. To tell the server who is calling, use `mcp_auth=` (an async function returning headers, such as a short-lived signed token) when the server enforces per-user or per-tenant access, because the server can verify it. `pass_user_info_to_mcp=True` sends the caller as unsigned request metadata the server cannot verify, so use it only for a trusted internal server. For details, see [Using MCP](/docs/guides/use-mcp).

## Tool errors

When a tool raises an exception, `ToolNode` catches it and returns a `ToolResultBlock` with `is_error=True` and status `"failed"`. The model gets only `Tool '<name>' failed with an internal error (reference <id>).`; the exception text stays in the server log under that reference. To give the model a reason it can act on, return `ToolResult(message=..., is_error=True)` instead of raising.

The model sees the error and decides what to do next. For details on exception taxonomy and handling, see [Errors and limits](/docs/concepts/errors-and-limits).

Every tool failure is also published as a `tool.failed` event. To block a tool by policy or require human approval, use `ToolGuard`; see [Zero-trust agents](/docs/security/zero-trust-agents#toolguard).

## The `@tool` decorator

Use `@tool` from `tenxgraph.utils` to set a tool's description, tags (for `Agent(tools_tags=...)`) or other metadata without changing the function. See [Use the tool decorator](/docs/guides/use-tool-decorator).

## The ReAct loop pattern

The standard wiring is a loop: the `Agent` node routes to the `ToolNode` while the last assistant message has `tools_calls`, and the `ToolNode` routes back to the agent. See [Wire an Agent node with a tool loop](/docs/concepts/choosing-a-building-block#wire-an-agent-node-with-a-tool-loop), or use `ReactAgent`, which builds it for you.

## Passing tool_node by name

Instead of passing the `ToolNode` instance directly to `Agent`, you can pass a string that names an existing graph node. The graph resolves it at `compile()`, which raises `GRAPH_005` when no node has that name and `GRAPH_006` when that node is not a `ToolNode`:

```python
agent = Agent(
    model="gemini-2.5-flash",
    tool_node="TOOL",          # resolved from the graph node named "TOOL"
)

graph.add_node("MAIN", agent)
graph.add_node("TOOL", tool_node)
```

This is useful when you want to share one `ToolNode` across multiple agents.

## Related concepts

- [StateGraph and nodes](/docs/concepts/state-graph)
- [Dependency injection](/docs/concepts/dependency-injection)
- [State and messages](/docs/concepts/state-and-messages)
