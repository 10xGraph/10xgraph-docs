---
title: How to use dependency injection
description: Guide to using InjectQ for binding services and injecting them into node functions, tool functions, and agents via Inject[T] parameter defaults.
section: "Build agents"
group: "State, memory and context"
order: 270
label: Dependency injection
updated: "2026-10-27"
faq:
  - q: "Do I need to use dependency injection?"
    a: "No, but it beats passing everything through config. Use it when you want to inject stateful services like databases, clients, or loggers. For simple values, config works fine."
  - q: "What happens if I don't declare an injectable parameter?"
    a: "If you don't declare it, the framework won't pass it. Tool functions get tool_call_id, state, config, and emit automatically only if they declare them as parameters."
  - q: "Can I change the container after compile()?"
    a: "No. The container is frozen when you call compile(). Create a new container and pass it to StateGraph() if you need different bindings."
---

Dependency injection in 10xGraph solves the problem of threading stateful services (databases, API clients, loggers) through your node and tool functions without polluting signatures or relying on globals. Any function registered as a node or tool can declare services as parameters with `Inject[Type]` as the default value, and the InjectQ container resolves and injects those dependencies automatically at runtime.

This guide walks you through binding services, injecting them into nodes and tools, and managing custom containers for tests and scoped execution.

## Why dependency injection matters

Without DI, you would pass every service through `config` or store it as a global variable. Both approaches become unwieldy at scale. Config dictionaries become dumping grounds for untyped values, and globals make testing harder because services persist across test boundaries.

DI inverts the problem: services are bound once in a container, and functions declare the types they need. The framework wires them in at call time, without requiring explicit passing. Tools automatically receive `tool_call_id`, `state`, `config`, and `emit` from the runtime. Any other service comes from the container.

## Built-in injectable parameters

Tool functions receive these parameters by name when they declare them. Node functions receive `state` and `config` by name; for anything else, declare an `Inject[Type]` default.

| Parameter | Type | Purpose |
|---|---|---|
| `tool_call_id` | `str` | Unique identifier for the current tool execution (tool functions only) |
| `state` | `AgentState` | Current graph state for reading or modifying context (nodes and tools) |
| `config` | `dict` | Execution configuration (thread_id, user_id, recursion_limit, etc.) (nodes and tools) |
| `emit` | `StreamEmitter` | Publishes progress events during long operations (tool functions only) |
| `generated_id` | `str` | A fresh ID generated on each call from the ID generator |
| `checkpointer` | `BaseCheckpointer` | The checkpointer bound to the compiled graph |
| `store` | `BaseStore` | The long-term memory store, if configured |
| `publisher` | `BasePublisher` | The event publisher for the graph |
| `context_manager` | `BaseContextManager` | Context manager for multi-node operations |
| `task_manager` | `BackgroundTaskManager` | Background task manager for long-running work |

Additionally, after `compile()`, these bindings are available for dependency injection:

| Binding | Type | Purpose |
|---|---|---|
| `CompiledGraph` | `CompiledGraph` | The compiled graph instance itself |
| `StateGraph` | `StateGraph` | The underlying StateGraph |
| `CallbackManager` | `CallbackManager` | Callback manager for lifecycle hooks |
| `BaseIDGenerator` | `BaseIDGenerator` | The ID generator |
| `BaseMediaStore` | `BaseMediaStore` | Media storage (if provided at compile time) |
| `get_node(name)` | factory | Returns the node by name from the graph |
| `get_entry_point_node()` | factory | Returns the entry-point node |
| `generated_id_type` | `str` | The ID type (e.g. "ulid", "uuid") |

You can register additional custom bindings before or after creating the StateGraph.

## Step 1: Access the container and register a service

Every graph uses a global InjectQ singleton by default, unless you create and pass a custom container. To bind a service, get the container and call `bind_instance()`:

```python
from injectq import InjectQ

class DatabaseClient:
    """A simple database client."""
    def __init__(self, dsn: str):
        self.dsn = dsn

    def query(self, sql: str) -> list:
        # In a real app, execute SQL here
        return []

# Register the client as a singleton
container = InjectQ.get_instance()
container.bind_instance(DatabaseClient, DatabaseClient("postgresql://localhost/mydb"))
```

You can also bind plain key-value pairs:

```python
container["api_key"] = "sk-1234..."
container["max_results"] = 10
```

Or register a factory function that is called on each injection:

```python
import uuid

container.bind_factory("request_id", lambda: str(uuid.uuid4()))
```

Once bound, these services are available to every node and tool in the graph.

## Step 2: Inject into a node function

Node functions receive `state` and `config` automatically. Declare any additional services with `Inject[Type]` as the parameter default:

```python
from injectq import Inject
from tenxgraph.core.state import AgentState, Message

def query_database(
    state: AgentState,
    config: dict,
    db: DatabaseClient = Inject[DatabaseClient],
) -> Message:
    """Query a database and return results as a message."""
    results = db.query("SELECT * FROM users LIMIT 5")
    content = f"Found {len(results)} users."
    return Message.text_message(content, role="assistant")
```

The framework automatically calls `query_database(state, config, db=<resolved_instance>)` at runtime. You never pass `db` manually. When you add this node to the graph, the DI system handles the wiring:

```python
from tenxgraph.core.graph import StateGraph

graph = StateGraph()
graph.add_node("query", query_database)
```

## Step 3: Inject into a tool function

Tool functions work the same way. Declare `tool_call_id`, `state`, `config`, and `emit` as plain parameters (they are filled by the runtime). Declare any other services with `Inject[Type]`:

```python
from injectq import Inject
from tenxgraph.core.state import AgentState, Message
from tenxgraph.core.state.message_block import ToolResultBlock

def search_products(
    query: str,
    limit: int = 5,
    # --- framework-provided parameters ---
    tool_call_id: str = "",
    state: AgentState = None,
    config: dict = None,
    # --- DI-injected parameters ---
    db: DatabaseClient = Inject[DatabaseClient],
) -> Message:
    """Search for products in the database."""
    results = db.query(f"SELECT * FROM products WHERE name LIKE '%{query}%' LIMIT {limit}")
    return Message.tool_message(
        content=[ToolResultBlock(call_id=tool_call_id, output=str(results))],
    )
```

The LLM only sees `query` and `limit` in the tool schema. The framework-provided and DI-injected parameters are invisible to the model and resolved internally.

## Step 4: Create and use a scoped container

For testing or when you need isolated bindings per graph, create a custom container and pass it to `StateGraph()`:

```python
from injectq import InjectQ
from tenxgraph.core.graph import StateGraph

# Create an isolated container for this graph
test_container = InjectQ()
test_container.bind_instance(
    DatabaseClient,
    DatabaseClient("postgresql://localhost/test_db")
)

# Pass the container to StateGraph
graph = StateGraph(container=test_container)
graph.add_node("query", query_database)
# ... rest of graph setup ...

app = graph.compile()
# This graph uses test_container, not the global singleton
```

This is especially useful in unit tests, where you want each test to have a fresh container with test doubles.

## Step 5: Refresh injected values on each call

An `Inject[Service]` default is a proxy created once, when the function is defined, and it caches the first object it resolves. If the container is rebound later, or a graph with its own container runs, the function keeps the old object. Use `fresh()` from `tenxgraph.utils.injection` to resolve from the active container on each call:

```python
from injectq import Inject
from tenxgraph.core.state import AgentState
from tenxgraph.storage.checkpointer import BaseCheckpointer
from tenxgraph.utils.injection import fresh

def my_node(
    state: AgentState,
    config: dict,
    checkpointer: BaseCheckpointer = Inject[BaseCheckpointer],
) -> list:
    # Without fresh(), this could be a checkpointer from an earlier graph
    checkpointer = fresh(checkpointer)
    return []
```

`fresh()` returns an explicitly passed argument unchanged. If the dependency is not bound, it returns `None`, so optional services are handled gracefully.

## Step 6: Read values from the container inside a node

When you need runtime access to container values, use `InjectQ.get_instance().try_get()`:

```python
from injectq import InjectQ
from tenxgraph.core.state import AgentState

def my_node(
    state: AgentState,
    config: dict,
) -> list:
    """Access the container to read optional values."""
    container = InjectQ.get_instance()

    # Returns None if not bound
    api_key = container.try_get("api_key")

    # Returns the provided default if not bound
    max_results = container.try_get("max_results", 50)

    # Use the values here
    if api_key:
        # Call external API
        pass

    return []
```

This pattern is useful when a value is optional or you want to check its presence before using it.

## Complete example

This example needs a provider extra, for example `pip install "10xgraph[openai]"`, and `OPENAI_API_KEY` set. It builds a small graph with a database service, a tool that queries it, and a node that logs the request:

```python
from injectq import Inject, InjectQ
from tenxgraph.core import Agent, StateGraph, ToolNode
from tenxgraph.core.state import AgentState, Message
from tenxgraph.core.state.message_block import ToolResultBlock
from tenxgraph.storage.checkpointer import InMemoryCheckpointer
from tenxgraph.utils.constants import END

class UserRepository:
    """Simple user data store."""
    def get_user(self, user_id: str) -> dict:
        # Hardcoded for the example; would query a real database
        return {"id": user_id, "name": "Alice", "plan": "pro"}

# Bind the repository to the global container
container = InjectQ.get_instance()
container.bind_instance(UserRepository, UserRepository())

# Tool that uses the injected repository
def get_user_info(
    user_id: str,
    tool_call_id: str = "",
    repo: UserRepository = Inject[UserRepository],
) -> Message:
    """Get information about a user."""
    user = repo.get_user(user_id)
    return Message.tool_message(
        content=[ToolResultBlock(call_id=tool_call_id, output=str(user))],
    )

# Node that also uses the injected repository
def log_request(
    state: AgentState,
    config: dict,
    repo: UserRepository = Inject[UserRepository],
) -> list:
    """Log the incoming request with user info."""
    user_id = config.get("user_id", "unknown")
    user = repo.get_user(user_id)
    print(f"Request from: {user['name']} ({user['plan']} plan)")
    return []

# Build the graph
tool_node = ToolNode([get_user_info])
agent = Agent(model="gpt-4o", tool_node=tool_node)

graph = StateGraph()
graph.add_node("log", log_request)
graph.add_node("MAIN", agent)
graph.add_node("TOOL", tool_node)

def should_use_tools(state: AgentState) -> str:
    last = state.context[-1] if state.context else None
    if last and last.role == "assistant" and getattr(last, "tools_calls", None):
        return "TOOL"
    return END

graph.add_edge("log", "MAIN")
graph.set_entry_point("log")
graph.add_conditional_edges("MAIN", should_use_tools, {"TOOL": "TOOL", END: END})
graph.add_edge("TOOL", "MAIN")

# Compile with a checkpointer
app = graph.compile(checkpointer=InMemoryCheckpointer())

# Run the graph
result = app.invoke(
    {"messages": [Message.text_message("Get info for user ID user-42")]},
    config={"thread_id": "di-demo", "user_id": "user-42"},
)

print(result["messages"][-1].text())
```

The `log` node prints:
```
Request from: Alice (pro plan)
```

## Common patterns and errors

**Pattern: Inject a scoped service per invocation.** Use `fresh()` to always get a new instance from the container, rather than the cached version:

```python
from tenxgraph.storage.store.base_store import BaseStore
from tenxgraph.utils.injection import fresh

def my_node(state, config, store: BaseStore = Inject[BaseStore]):
    store = fresh(store)
    # Uses the store bound to the active container
    return []
```

**Error: "Missing required parameter" or "Required injectable parameter not found".** A tool or node declared a parameter with no default that neither the runtime nor the container provides. Bind the service before the graph runs, or give the parameter an `Inject[...]` default:

```python
# Wrong: UserRepository is not bound
container = InjectQ.get_instance()
graph = StateGraph()
graph.add_node("query", my_node_using_repository)  # Will fail if UserRepository is not bound

# Right: Bind first, then add the node
container.bind_instance(UserRepository, UserRepository())
graph = StateGraph()
graph.add_node("query", my_node_using_repository)
```

**Bindings after `compile()`.** The container is compiled (frozen) at the end of `graph.compile()`. Add your own bindings before calling it, or create a new container and pass it to `StateGraph(container=...)`.

## What you learned

- Dependency injection avoids globals and reduces parameter passing in signatures.
- Tool functions automatically receive `tool_call_id`, `state`, `config`, and `emit`; nodes receive `state` and `config`.
- Declare `param: Service = Inject[Service]` to inject custom services into nodes and tools.
- Use `container.bind_instance(Type, instance)` to register a singleton or `bind_factory(name, callable)` for a function.
- Pass `StateGraph(container=container)` to use a custom, scoped container for testing.
- Use `fresh()` to resolve a dependency anew on each call, bypassing the cache.

## Run it in production

Take `user_id`, tenant and role from the authenticated identity the server injects, not from request state or message text. Register shared resources such as database pools once through `injectq` in `10xgraph.json`. See [Configure the server](/docs/server/configure) and the [Security model](/docs/production/security-model).

## Next steps

- [Build a graph](/docs/guides/build-a-graph) to see how DI fits into the full graph lifecycle.
- [Use the @tool decorator](/docs/guides/use-tool-decorator) to add metadata alongside injection.
- [Dependency injection concept](/docs/concepts/dependency-injection) explains the why and tradeoffs in more detail.
