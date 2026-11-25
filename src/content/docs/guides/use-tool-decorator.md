---
title: "How to use the @tool decorator"
description: "Mark Python functions as agent tools with metadata, parameter schemas, error handling, and dependency injection using the @tool decorator."
section: "Build agents"
group: "Tools and MCP"
order: 160
label: "@tool decorator"
updated: "2026-11-26"
---

The `@tool` decorator marks a Python function as an agent tool and attaches metadata that 10xGraph uses to build the schema the LLM sees, control tool visibility across agents, and inject context at runtime. Every tool is a regular Python function; the decorator adds no runtime behavior, only metadata that the `ToolNode` reads at schema-generation time.

Without `@tool`, 10xGraph still registers the function and falls back to its `__name__` and docstring. Use `@tool` when you need to override the description, provide custom schemas for exotic parameter types, add tags for filtering, or request injected runtime context like streaming progress or the current agent state.

---

## How the schema is built

The `ToolNode` converts your function's type hints and docstring into an OpenAI-compatible JSON schema that the LLM receives. This schema tells the LLM the tool's name, what it does, and which parameters it expects.

**Parameter schema generation** uses your type annotations. 10xGraph supports `str`, `int`, `float`, `bool`, `datetime`, `date`, `time`, `UUID`, `Path`, `Decimal`, `bytes`, `list[X]`, `dict`, `Optional[X]`, `Literal[...]`, `Enum` subclasses, Pydantic `BaseModel` subclasses, and dataclasses. If your parameter type is not in that list, pass a hand-written schema with `@tool(parameters=...)` to avoid a runtime error.

**Argument coercion.** The arguments the model sends are coerced against your type hints in lax mode. A value that converts cleanly is converted (`"5"` becomes `5` for an `int`, a number becomes a string for a `str`), and unknown extra keys are ignored. A value that cannot convert goes back to the model as a failed tool result, and the tool does not run.

**Tool name.** The function name is the tool name the model sees. To change it, rename the function; `@tool` has no `name` argument and `@tool(name=...)` raises a `TypeError`. `@tool` also works on bound methods.

**The description** comes from the function's docstring (or the `description` arg). The LLM uses this to decide when and how to call the tool, so be specific: instead of "Fetch data," say "Fetch historical stock prices for a ticker symbol over a date range."

**Injected parameters** like `tool_call_id`, `state`, `emit`, `config`, and others are excluded from the schema automatically. You declare them in your function signature to receive them at runtime, but the LLM never sees them.

---

## Basic usage

The simplest `@tool` uses the function's name and docstring:

```python
from tenxgraph.utils.decorators import tool

@tool
def get_weather(city: str, units: str = "celsius") -> str:
    """Get the current weather for a city."""
    return f"Weather in {city}: 22°C"
```

The LLM will see this tool named `get_weather`, with the docstring as its description, and two parameters: `city` (required) and `units` (optional, default "celsius").

---

## Provide a custom description

Override the description sent to the LLM:

```python
@tool(
    description="Fetch live weather data for any city worldwide, in Celsius or Fahrenheit.",
)
def get_weather(city: str, units: str = "celsius") -> str:
    return f"Weather in {city}: 22°C"
```


---

## Control which tools each agent sees with tags

Tag tools to expose different subsets to different agents without creating multiple `ToolNode` instances. Tags are simple string labels.

```python
from tenxgraph.utils.decorators import tool

@tool(tags=["search", "public"])
def web_search(query: str) -> str:
    """Search the internet."""
    return f"Results for {query}"

@tool(tags=["database", "admin"])
def run_query(sql: str) -> str:
    """Execute a SQL query."""
    return "Success"

@tool(tags=["search", "private"])
def internal_search(query: str) -> str:
    """Search the internal knowledge base."""
    return f"Internal results for {query}"
```

Pass `tools_tags` to the `Agent` to restrict which tools the LLM can call. A tool is included if it has **any** of the requested tags:

```python
from tenxgraph.core.graph import Agent, ToolNode

tool_node = ToolNode([web_search, run_query, internal_search])

# This agent only sees tools tagged "search"
search_only = Agent(
    model="gpt-4o",
    tool_node=tool_node,
    tools_tags={"search"},  # web_search and internal_search visible; run_query hidden
)

# This agent sees tools tagged "search" AND "admin"
admin_agent = Agent(
    model="gpt-4o",
    tool_node=tool_node,
    tools_tags={"search", "admin"},  # web_search, internal_search, and run_query visible
)
```

---

## Request runtime context with injected parameters

Declare these optional parameters in your function signature to receive them at runtime. The `ToolNode` fills them automatically. They do **not** appear in the schema the LLM sees.

| Parameter | Type | What it provides |
|---|---|---|
| `tool_call_id` | `str` | Unique ID for this tool invocation |
| `state` | `AgentState` | Current graph state (read-only) |
| `config` | `dict` | Run configuration: `user_id`, `thread_id`, `run_id` |
| `emit` | `StreamEmitter` | Emit progress/error updates during streaming |
| `generated_id` | `str` | Framework-generated identifier |
| `context_manager` | `BaseContextManager` | Cross-node context operations |
| `publisher` | `BasePublisher` | Publish events (logging, tracing) |
| `checkpointer` | `BaseCheckpointer` | Access persisted state |
| `store` | `BaseStore` | Access long-term memory |
| `task_manager` | `BackgroundTaskManager` | Schedule background tasks |

Example: access the calling user and current state, and emit progress:

```python
from tenxgraph.utils.decorators import tool
from tenxgraph.core.state import AgentState
from tenxgraph.core.state.stream_emitter import StreamEmitter

@tool(description="Search the knowledge base for the authenticated user.")
def search_kb(
    query: str,
    config: dict = None,  # Injected: run config
    state: AgentState = None,  # Injected: current AgentState
    emit: StreamEmitter = None,  # Injected: for progress updates during stream
) -> str:
    """Search the knowledge base."""
    user_id = (config or {}).get("user_id")
    if emit:
        emit.progress("Connecting to search engine...", data={"query": query})
    
    results = [f"{user_id}: {query} #{i}" for i in range(3)]  # replace with a real search
    
    if emit:
        emit.progress(f"Found {len(results)} results")
    
    return f"Results: {results}"
```

The `emit` parameter is only available during streaming (via `astream()` or `stream()`). During `invoke()` or `ainvoke()`, `emit` is `None`. Always check: `if emit: emit.progress(...)`.

---

## Handle and report tool errors

When a tool raises, the `ToolNode` catches the exception and the model gets a failed tool result. The text is generic, `Tool 'divide' failed with an internal error (reference 1a2b3c4d).`, and the full error is in the server log under the same reference, because an exception can carry paths, DSNs or SQL. Only an argument that does not fit your type hints reaches the model in full. To let the model read a reason and try again, return it:

```python
@tool(description="Divide two numbers.")
def divide(a: float, b: float) -> float | str:
    """Divide a by b."""
    if b == 0:
        return "Error: b must not be zero. Ask the user for another number."
    return a / b
```

To block a call by policy, raise `ToolDenied`; see [Raise ToolDenied from your own callback](/docs/security/zero-trust-agents#raise-tooldenied-from-your-own-callback). More in [Tool failures and bad tool arguments](/docs/concepts/errors-and-limits#tool-failures-and-bad-tool-arguments).

---

## Support both sync and async tools

`@tool` works on sync and async functions. Async tools run on the event loop; sync tools run in a worker thread (`asyncio.to_thread`), so they do not block it. Prefer async for I/O.

---

## Annotate capabilities and metadata

`capabilities` and `metadata` are labels for your own auditing or policy code; 10xGraph does not enforce them:


```python
@tool(
    description="Process a payment transaction.",
    tags=["payments"],
    capabilities=["write_database", "external_payment_gateway"],
    metadata={
        "rate_limit": 10,
        "timeout_seconds": 30,
        "audit_required": True,
        "pii_handling": "strict",
    },
)
async def process_payment(amount: float, currency: str) -> dict:
    """Process a payment."""
    return {"status": "ok", "transaction_id": "txn_123"}
```

Set `record_tool_result=False` on a read-only tool (search, weather, lookups) to keep it out of the checkpointer's tool execution ledger. The default is `True`, which stops a finished call from running again after a crash or a resume. With `False`, the tool can run twice in those cases. See [Replay-safe tools](/docs/concepts/replay-safe-tools).

```python
@tool(record_tool_result=False)
def get_weather(city: str) -> str:
    """Look up the weather."""
    return "sunny"
```

Retrieve metadata programmatically:

```python
from tenxgraph.utils.decorators import get_tool_metadata, has_tool_decorator

if has_tool_decorator(process_payment):
    meta = get_tool_metadata(process_payment)
    print(meta["tags"])          # {"payments"}
    print(meta["capabilities"])  # ["write_database", ...]
    print(meta["metadata"])      # {...rate_limit...}
```

---

## Custom parameter schemas

If your function uses a parameter type 10xGraph does not recognize (for example, a custom class or a union type), provide a hand-written JSON Schema:

```python
@tool(
    description="Process an order.",
    parameters={
        "type": "object",
        "properties": {
            "order_id": {"type": "string", "description": "The unique order ID"},
            "items": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "sku": {"type": "string"},
                        "quantity": {"type": "integer"},
                    },
                    "required": ["sku", "quantity"],
                },
                "description": "Items in the order",
            },
        },
        "required": ["order_id", "items"],
    },
)
def process_order(order_id: str, items: list[dict]) -> dict:
    """Process an order."""
    return {"status": "processed", "order_id": order_id}
```

The schema you provide is sent to the LLM verbatim. The function's actual type annotations are still used for runtime argument coercion (converting strings to the right types), so keep the two in sync.

---

## Run it in production

Tools run in parallel, up to 10 at a time by default. See [Errors and limits](/docs/concepts/errors-and-limits) and [Production readiness](/docs/production).

## Next steps

- [Build a graph](/docs/guides/build-a-graph) to see how tools wire into the full workflow.
- [Use prebuilt tools](/docs/guides/prebuilt-tools) for the handoff and memory tools. The web, file, search and calculator tools there are deprecated.
- [Emit tool progress](/docs/guides/emit-tool-progress) to stream live updates to the user during long operations.
- [Use dependency injection](/docs/guides/use-dependency-injection) to pass application state and services into tools.
