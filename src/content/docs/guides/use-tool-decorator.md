---
title: "How to use the @tool decorator"
description: "Mark Python functions as agent tools with metadata, parameter schemas, error handling, and dependency injection using the @tool decorator."
section: "Build agents"
group: "Tools and MCP"
order: 160
label: "@tool decorator"
updated: "2026-10-27"
---

The `@tool` decorator marks a Python function as an agent tool and attaches metadata that 10xGraph uses to build the schema the LLM sees, control tool visibility across agents, and inject context at runtime. Every tool is a regular Python function; the decorator adds no runtime behavior, only metadata that the `ToolNode` reads at schema-generation time.

Without `@tool`, 10xGraph still registers the function and falls back to its `__name__` and docstring. Use `@tool` when you need to override the defaults, provide custom schemas for exotic parameter types, add tags for filtering, or request injected runtime context like streaming progress or the current agent state.

---

## How the schema is built

The `ToolNode` converts your function's type hints and docstring into an OpenAI-compatible JSON schema that the LLM receives. This schema tells the LLM the tool's name, what it does, and which parameters it expects.

**Parameter schema generation** uses your type annotations. 10xGraph supports `str`, `int`, `float`, `bool`, `datetime`, `date`, `time`, `UUID`, `Path`, `Decimal`, `bytes`, `list[X]`, `dict`, `Optional[X]`, `Literal[...]`, `Enum` subclasses, Pydantic `BaseModel` subclasses, and dataclasses. If your parameter type is not in that list, pass a hand-written schema with `@tool(parameters=...)` to avoid a runtime error.

**Argument coercion.** The arguments the model sends are coerced against your type hints in lax mode. A value that converts cleanly is converted (`"5"` becomes `5` for an `int`, a number becomes a string for a `str`), and unknown extra keys are ignored. A value that cannot convert goes back to the model as a failed tool result, and the tool does not run.

**Name forms.** `@tool("name")` works as a shorthand for `@tool(name="name")`, and `@tool` also works on bound methods.

**The description** comes from the function's docstring (or the `description` arg). The LLM uses this to decide when and how to call the tool, so be specific: instead of "Fetch data," say "Fetch historical stock prices for a ticker symbol over a date range."

**Injected parameters** like `tool_call_id`, `state`, `emit`, `config`, and others are excluded from the schema automatically. You declare them in your function signature to receive them at runtime, but the LLM never sees them.

Here is a tool the LLM sees:

```python
@tool(
    name="search_web",
    description="Search the internet and return the top results with titles and summaries.",
)
def search_web(
    query: str,
    limit: int = 10,
) -> str:
    """Search for query and return results."""
    # LLM receives schema: name="search_web", description="...", parameters with query (required string) and limit (optional int, default 10).
    return f"Top {limit} results for {query}"
```

To access the request context inside the tool, for example, to know which user called it, ask for injected parameters:

```python
@tool(description="Search the web as the authenticated user.")
def search_web(
    query: str,
    config: dict = None,  # Injected at runtime
) -> str:
    # config is NOT in the schema the LLM sees. The ToolNode fills it with the run config.
    user_id = (config or {}).get("user_id")
    return f"Search for {query} as user {user_id}"
```

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

## Provide a custom name and description

Override the function name and docstring sent to the LLM:

```python
@tool(
    name="weather_lookup",
    description="Fetch live weather data for any city worldwide, in Celsius or Fahrenheit.",
)
def get_weather(city: str, units: str = "celsius") -> str:
    return f"Weather in {city}: 22°C"
```

The LLM will call this tool as `weather_lookup`, not `get_weather`. Use custom names to disambiguate similar functions or provide a more descriptive name than your Python function name.

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

# This agent sees all tools (no tools_tags filter)
full_agent = Agent(
    model="gpt-4o",
    tool_node=tool_node,
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

Pass the injected values at runtime via the config:

```python
from tenxgraph.core.graph import CompiledGraph

result = compiled_graph.invoke(
    {"messages": [...]},
    config={"user_id": "user_123", "thread_id": "t1"},
)
```

The `emit` parameter is only available during streaming (via `astream()` or `stream()`). During `invoke()` or `ainvoke()`, `emit` is `None`. Always check: `if emit: emit.progress(...)`.

---

## Handle and report tool errors

When a tool raises an exception, the `ToolNode` catches it and returns a `ToolResultBlock` with the error. The LLM receives the error message and can decide to retry, ask for clarification, or take a different path.

```python
@tool(description="Divide two numbers.")
def divide(a: float, b: float) -> float:
    """Divide a by b."""
    if b == 0:
        raise ValueError("Division by zero")
    return a / b
```

When the LLM calls `divide(10, 0)`, the `ToolNode` catches the `ValueError`, wraps it in a `ToolResultBlock`, and the LLM sees the error message and can retry with different inputs. The error is not surfaced to the user; the run continues with the error message in the conversation.

For custom error messages, raise a descriptive exception:

```python
import httpx

@tool(description="Fetch a web page.")
async def fetch_url(url: str) -> str:
    """Fetch the HTML of a URL."""
    if not url.startswith("http"):
        raise ValueError(f"Invalid URL: {url}. Must start with 'http' or 'https'.")
    
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(url, timeout=5)
            response.raise_for_status()
            return response.text[:5000]
        except httpx.TimeoutException:
            raise TimeoutError(f"Request to {url} timed out after 5 seconds")
        except httpx.HTTPError as e:
            raise RuntimeError(f"Failed to fetch {url}: {e}")
```

The LLM will see clear, actionable error messages and can adjust its approach.

---

## Support both sync and async tools

The `@tool` decorator works on both sync and async functions. The `ToolNode` handles both transparently. Use async for I/O-bound operations (network requests, database queries) and sync for CPU-bound or simple tasks.

**Sync tool:**

```python
@tool(description="Calculate the sum of two numbers.")
def add(a: int, b: int) -> int:
    """Add a and b."""
    return a + b
```

**Async tool:**

```python
import httpx

@tool(
    description="Fetch the current weather.",
    tags=["web", "network"],
)
async def fetch_weather(city: str) -> str:
    """Fetch weather from an API."""
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"https://api.weather.example.com/weather?city={city}",
            timeout=5,
        )
        response.raise_for_status()
        return response.text
```

When the `ToolNode` calls async tools, it runs them in the asyncio event loop. Sync tools are run via `asyncio.to_thread` so they do not block the event loop. For this reason, async tools are preferred for I/O.

---

## Annotate capabilities and metadata

Use `capabilities` to document what permissions or side effects the tool has. This is informational only; 10xGraph does not enforce it at runtime. Use it for auditing or policy checks.

```python
@tool(
    description="Send an email to a user.",
    capabilities=["network_access", "external_communication", "sends_email"],
)
async def send_email(to: str, subject: str, body: str) -> str:
    """Send an email."""
    # ... send email ...
    return "Email sent"
```

Use `metadata` for any application-specific fields:

```python
@tool(
    name="process_payment",
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

Retrieve metadata programmatically:

```python
from tenxgraph.utils.decorators import get_tool_metadata, has_tool_decorator

if has_tool_decorator(process_payment):
    meta = get_tool_metadata(process_payment)
    print(meta["name"])          # "process_payment"
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

## Complete example: a multi-feature tool

Here is a realistic tool that demonstrates multiple features:

```python
from tenxgraph.utils.decorators import tool
from tenxgraph.core.state.stream_emitter import StreamEmitter

@tool(
    name="search_documentation",
    description="Search the product documentation for topics, how-tos, and API references.",
    tags=["search", "documentation"],
    capabilities=["read_files"],
    metadata={"ratelimit": 20, "timeout_seconds": 10},
)
async def search_docs(
    query: str,
    limit: int = 5,
    config: dict = None,
    tool_call_id: str = None,
    emit: StreamEmitter = None,
) -> str:
    """Search documentation."""
    if emit:
        emit.progress("Preparing search...", data={"query": query})
    
    try:
        if not query or not query.strip():
            raise ValueError("Query cannot be empty")
        
        if emit:
            emit.progress(f"Searching for '{query}'...")
        
        # Simulate search
        results = [f"Result {i+1}: {query}" for i in range(limit)]
        
        if emit:
            emit.progress(f"Found {len(results)} results", data={"count": len(results)})
        
        return "\n".join(results)
    
    except Exception as e:
        if emit:
            emit.error(f"Search failed: {str(e)}")
        raise RuntimeError(f"Documentation search failed: {str(e)}")
```

This tool:
- Has a clear name and description for the LLM.
- Is tagged so agents can choose to include or exclude it.
- Documents its capabilities and metadata.
- Is async for I/O efficiency.
- Accepts optional injected parameters (`config`, `tool_call_id`, `emit`).
- Emits progress updates during streaming.
- Validates input and raises descriptive errors.

---

## What you learned

- The `@tool` decorator attaches metadata that 10xGraph uses to build the LLM schema and control tool behavior.
- Parameter types are automatically converted to JSON schema; complex types need `@tool(parameters=...)`.
- Injected parameters like `state`, `emit`, `config` are available at runtime but excluded from the LLM schema.
- Errors in tools are caught and reported to the LLM, which can retry or adjust its approach.
- Tools can be sync or async; async is preferred for I/O operations.
- Tags allow fine-grained control over which tools each agent can call.

## Run it in production

The model sees only a generic failure message when a tool raises, with a reference ID that matches the full error in the server log; return a string if the model should read the message. Tools run in parallel up to a cap of 10 by default. See [Errors and limits](/docs/concepts/errors-and-limits) and [Production readiness](/docs/production).

## Next steps

- [Build a graph](/docs/guides/build-a-graph) to see how tools wire into the full workflow.
- [Use prebuilt tools](/docs/guides/prebuilt-tools) for ready-made web, file, and search tools.
- [Emit tool progress](/docs/guides/emit-tool-progress) to stream live updates to the user during long operations.
- [Use dependency injection](/docs/guides/use-dependency-injection) to pass application state and services into tools.
