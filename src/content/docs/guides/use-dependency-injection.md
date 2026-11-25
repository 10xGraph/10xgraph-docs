---
title: How to use dependency injection
description: Guide to using InjectQ for binding services and injecting them into node functions, tool functions, and agents via Inject[T] parameter defaults.
section: "Build agents"
group: "Context and dependencies"
order: 240
label: Dependency injection
updated: "2026-11-26"
faq:
  - q: "Do I need to use dependency injection?"
    a: "No, but it beats passing everything through config. Use it when you want to inject stateful services like databases, clients, or loggers. For simple values, config works fine."
  - q: "Can I change the container after compile()?"
    a: "Bind everything before compile(): compile() checks every binding then. To run with other bindings, build the graph with its own container, StateGraph(container=InjectQ())."
---

Bind a service in the InjectQ container and declare it as `param: Service = Inject[Service]` in a node or tool; the container fills it at call time. Why DI and how containers are scoped are in [Dependency injection](/docs/concepts/dependency-injection).

## What a tool or node receives

A tool function receives only these parameters by name. They are hidden from the model's schema.

| Parameter | Type | What it is |
|---|---|---|
| `tool_call_id` | `str` | Unique ID of this tool call |
| `state` | `AgentState` | Current graph state |
| `config` | `dict` | Run config: `thread_id`, `user_id`, `run_id` and more |
| `emit` | `StreamEmitter` | Progress updates while streaming; `None` under `invoke()` |
| `credential` | `UserCredential \| None` | The caller's credential from the run; see [Call services as the user](/docs/guides/call-services-as-the-user) |

A node function receives only `state` and `config` by name.

Everything else comes from the container: declare `param: Service = Inject[Service]`. A plain parameter named `store`, `checkpointer`, `publisher`, `generated_id`, `context_manager` or `task_manager` is hidden from the model but not filled, so the call fails at run time. Declare it with an `Inject[...]` default instead.

The graph binds these services, so you can request them by type:

| Type | Purpose |
|---|---|
| `BaseCheckpointer` | The checkpointer bound to the compiled graph |
| `BaseStore` | The long-term memory store, if configured |
| `BasePublisher` | The event publisher for the graph, if configured |
| `BaseContextManager` | The context manager, if configured |
| `BackgroundTaskManager` | Background task manager for long-running work |

After `compile()`, these bindings are also available:

| Binding | Type | Purpose |
|---|---|---|
| `CompiledGraph` | `CompiledGraph` | The compiled graph instance itself |
| `StateGraph` | `StateGraph` | The underlying StateGraph |
| `CallbackManager` | `CallbackManager` | Callback manager for lifecycle hooks |
| `BaseIDGenerator` | `BaseIDGenerator` | The ID generator |
| `BaseMediaStore` | `BaseMediaStore` | Media storage (if provided at compile time) |
| `get_node(name)` | factory | Returns the node by name from the graph |
| `get_entry_point_node()` | factory | Returns the entry-point node |
| `"generated_id"` / `"generated_id_type"` | factory / `str` | Keys for `Inject["generated_id"]`; core reads only `BaseIDGenerator` |

Add your own bindings before `compile()`.

## Step 1: Access the container and register a service

Every graph uses a global InjectQ singleton by default, unless you create and pass a custom container. To bind a service, get the container and call `bind_instance()`:

```python
from injectq import InjectQ

class DatabaseClient:
    """A simple database client."""
    def __init__(self, dsn: str):
        self.dsn = dsn

    def query(self, sql: str, *params) -> list:
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

## Step 3: Inject into a tool function

Tool functions work the same way. `tool_call_id`, `state`, `config` and `emit` are filled by name. Declare any service with an `Inject[Type]` default and resolve it with `fresh()`:

```python
from injectq import Inject
from tenxgraph.core.state import AgentState
from tenxgraph.utils.injection import fresh

def search_products(
    query: str,
    limit: int = 5,
    # --- filled by name ---
    tool_call_id: str = "",
    state: AgentState = None,
    config: dict = None,
    # --- filled from the container ---
    db: DatabaseClient = Inject[DatabaseClient],
) -> str:
    """Search for products in the database."""
    db = fresh(db)
    results = db.query("SELECT * FROM products WHERE name LIKE $1 LIMIT $2", f"%{query}%", limit)
    return str(results)
```

The LLM only sees `query` and `limit` in the tool schema. A tool that declares `db: DatabaseClient` with no `Inject` default is not filled and fails at call time.

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

`fresh()` returns an explicitly passed argument unchanged. An unbound abstract service (a store, a publisher) resolves to `None`; an unbound concrete class is built by injectq.

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
    repo: UserRepository = Inject[UserRepository],
) -> str:
    """Get information about a user."""
    return str(repo.get_user(user_id))

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

**Bind before `compile()`.** `compile()` builds every resolver and fails at once on a binding it cannot resolve, so a broken binding shows up at startup instead of mid-run.

## Run it in production

Take `user_id`, tenant and role from the authenticated identity the server injects, not from request state or message text. Point `injectq` in `10xgraph.json` at your container; the server refuses to start when it differs from the graph's container. See [Configure the server](/docs/server/configure) and the [Security model](/docs/production/security-model).

## Next steps

- [Build a graph](/docs/guides/build-a-graph) to see how DI fits into the full graph lifecycle.
- [Use the @tool decorator](/docs/guides/use-tool-decorator) to add metadata alongside injection.
- [Dependency injection](/docs/concepts/dependency-injection)
