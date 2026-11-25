---
title: Dependency Injection
seoTitle: "Dependency injection concepts (InjectQ)"
description: How dependency injection decouples your code from the framework and manages service lifecycles in nodes and tools.
section: Concepts
order: 80
group: "Foundations"
label: Dependency Injection
updated: "2026-11-26"
---

Dependency injection (DI) lets your graph nodes and tools declare what they need without importing framework internals.

## Two kinds of injection in 10xGraph

10xGraph provides two mechanisms for dependency injection, both built on [`InjectQ`](https://github.com/Iamsdt/injectq):

### Automatic framework parameters

A few parameters are filled by name, with no registration. They represent the current execution context:

- `state`: The current `AgentState`: the full message history and custom fields. Nodes and tools.
- `config`: Thread configuration, `thread_id`, `user_id`, `run_id`, recursion limit. Nodes and tools.
- `tool_call_id` (tools only): The ID of the current tool call from the LLM.
- `emit` (tools only): A function to emit structured progress events during long-running tools.
- `credential` (tools only): The caller's `UserCredential`, or `None`.

Everything else, including `store`, `checkpointer`, `publisher`, `context_manager`, `task_manager` and `generated_id`, comes from the container through an `Inject[...]` default. A plain parameter with one of those names is hidden from the model but not filled, so the call fails at run time.

They need no registration:

```python
def my_tool(
    query: str,                    # from the LLM's tool call
    state: AgentState,             # filled by name, no setup needed
    config: dict,                  # filled by name, no setup needed
    tool_call_id: str,             # filled by name, no setup needed
) -> str:
    user_id = config.get("user_id")
    history_length = len(state.context)
    return f"Query: {query} (user: {user_id}, history: {history_length})"
```

The LLM only sees `query` in the tool schema. The other three are invisible.

### Custom service injection

For services (the store, the checkpointer, database clients, API clients, custom backends), you register them (the graph already binds its own) with the DI container and declare them with `Inject[Type]` defaults:

```python
from injectq import Inject, InjectQ

class DatabaseClient:
    def search(self, text: str) -> list: ...

# Register in the container
container = InjectQ.get_instance()
container.bind_instance(DatabaseClient, DatabaseClient())

# Inject into a tool
def search_products(
    query: str,
    db: DatabaseClient = Inject[DatabaseClient],
) -> str:
    db = fresh(db)  # from tenxgraph.utils.injection; resolves from the active container
    results = db.search(query)
    return f"Found {len(results)} products"
```

The framework resolves `Inject[DatabaseClient]` by looking up `DatabaseClient` in the container and passes the instance as `db`.

## Container lifecycle and scoping

The DI container can be global (shared across all graphs) or scoped to a single graph. This controls where services live:

**Global container** (default):
```python
container = InjectQ.get_instance()  # singleton
container.bind_instance(DatabaseClient, db)

graph = StateGraph()  # uses the global container
```

One graph per container: a second graph in the same process needs its own `InjectQ()`.

**Scoped container** (isolated per graph, useful for tests):
```python
# Each test gets a fresh container with test doubles
container = InjectQ()  # new isolated container
container.bind_instance(DatabaseClient, MockDatabaseClient())

graph = StateGraph(container=container)  # uses this container, not the global one
```

Passing `container=` to `StateGraph` activates the container and makes it the default for that graph's nodes and tools.

## Configuring the container for the API server

If you deploy your graph with the `10xgraph` CLI server, register your container in `10xgraph.json` so the server can pick it up automatically:

```json
{
  "agent": "myapp.graph:app",
  "injectq": "myapp.services:container"
}
```

The server imports `container` from the `myapp.services` module, which must be an `InjectQ` instance, and uses it as its container. Your graph module should build its `StateGraph` with the same container (`StateGraph(container=container)`) so nodes and tools resolve the same bindings. The server refuses to boot when the graph and `injectq` use different containers.

## Related concepts

- [Use dependency injection](/docs/guides/use-dependency-injection): step-by-step registration, testing with isolated containers, full example.
- [Agents and tools](/docs/concepts/agents-and-tools): DI works in both agent nodes and tool functions.
- [StateGraph and nodes](/docs/concepts/state-graph): How to pass the container to the graph.
- [Building a graph](/docs/guides/build-a-graph): Where DI fits into the full workflow.
