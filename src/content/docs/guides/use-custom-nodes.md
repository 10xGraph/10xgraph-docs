---
title: Write custom nodes
description: "Build nodes as plain Python functions with auto-injected state, config, and framework services. Route dynamically with Command."
section: "Build agents"
group: "Agents and graphs"
order: 50
label: Custom nodes
updated: "2026-10-27"
faq:
  - q: "Do all custom nodes need both state and config parameters?"
    a: "No. The runtime inspects the signature and only provides what is declared. Omit state if you only need config, and vice versa."
  - q: "How do I access checkpointer, store, or publisher inside a node?"
    a: "Use `Inject[ServiceType]` as the default value for the parameter. The dependency injection container resolves it automatically."
  - q: "Can a node route to different next nodes at runtime?"
    a: "Yes, return a `Command` object with a `goto` field to override the next node. For normal branching, prefer `add_conditional_edges`."
---

A graph node does not have to be an `Agent` or a `ToolNode`. Any plain Python function, sync or async, can be registered as a node. Nodes are the foundation for pre-processing, routing, side effects, persistence, and any logic that does not call an LLM.

For a comparison of when to use custom nodes, Agents, and prebuilt agents, see [Choosing a building block](/docs/concepts/choosing-a-building-block).

## Minimal node

```python
from tenxgraph.core.state import AgentState, Message

def greet(state: AgentState, config: dict) -> Message:
    user_id = config.get("user_id", "stranger")
    return Message.text_message(f"Hello, {user_id}!", role="assistant")
```

Register and wire it like any other node:

```python
from tenxgraph.core.graph import StateGraph
from tenxgraph.utils import END

graph = StateGraph()
graph.add_node("greet", greet)
graph.set_entry_point("greet")
graph.add_edge("greet", END)

app = graph.compile()
```

---

## Auto-injected parameters

The runtime inspects the function signature and provides two parameters by name, no import required:

| Parameter | Type | What it contains |
|---|---|---|
| `state` | `AgentState` | The current graph state - messages, context, custom fields. |
| `config` | `dict` | Runtime config: `thread_id`, `user_id`, and any keys you passed to `invoke()`. |

Declare only the ones you need. A node that only reads `config` can omit `state` entirely, and vice versa.

```python
def audit_log(config: dict) -> list:
    print(f"thread={config['thread_id']} user={config.get('user_id')}")
    return []  # no new messages
```

```python
def summarize(state: AgentState) -> str:
    return f"Conversation has {len(state.context)} messages."
```

---

## Return types

A node function can return any of the following:

| Return value | Effect |
|---|---|
| `str` | Wrapped in `Message.text_message(content, role="assistant")` and appended to state. |
| `Message` | Appended to state as-is. |
| `list[Message \| str]` | Each item is processed individually and appended. An empty list means no output. |
| `ModelResponseConverter` | Converted to a `Message` and appended (see "Calling an LLM yourself"). |
| `AgentState` | Replaces the current state; new context entries are extracted and recorded as new messages. |
| `Command` | Updates state **and** overrides the next node at runtime (see below). |

A plain `dict` is not a valid return value and raises an error. To change state fields, change them on `state` and return it.

```python
from tenxgraph.core.state import AgentState, Message

# Return a string, wrapped automatically
def node_str(state: AgentState, config: dict) -> str:
    return "Processing complete."

# Return a single Message
def node_msg(state: AgentState, config: dict) -> Message:
    return Message.text_message("done", role="assistant")

# Return a list of messages
def node_list(state: AgentState, config: dict) -> list:
    return [
        Message.text_message("step 1", role="assistant"),
        Message.text_message("step 2", role="assistant"),
    ]

# Return a modified state (custom state fields updated inline)
class FlagState(AgentState):
    processed: bool = False

def node_state(state: FlagState, config: dict) -> FlagState:
    state.processed = True
    return state
```

---

## Calling an LLM yourself

If your node calls an LLM directly you have three options.

**Option 1, return a `str`:** simplest; the framework wraps it as an assistant message.

```python
# pip install "10xgraph[openai]"
import openai

async def call_llm(state: AgentState, config: dict) -> str:
    client = openai.AsyncOpenAI()
    response = await client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": state.context[-1].text()}],
    )
    return response.choices[0].message.content
```

**Option 2, build a `Message` yourself:** gives full control over content blocks, role, and metadata.

```python
from tenxgraph.core.state import Message

async def call_llm_message(state: AgentState, config: dict) -> Message:
    client = openai.AsyncOpenAI()
    response = await client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": state.context[-1].text()}],
    )
    return Message.text_message(
        response.choices[0].message.content,
        role="assistant",
    )
```

**Option 3, use `ModelResponseConverter`:** lets you hand the raw SDK response to 10xGraph's built-in converters so tool calls, content blocks, and metadata are normalized automatically.

```python
from tenxgraph.runtime.adapters.llm.model_response_converter import ModelResponseConverter

async def call_llm_converter(state: AgentState, config: dict) -> ModelResponseConverter:
    client = openai.AsyncOpenAI()
    response = await client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": state.context[-1].text()}],
    )
    # Pass the raw response and a converter name: "openai", "openai_responses", "google" or "anthropic"
    return ModelResponseConverter(response, converter="openai")
```

The framework awaits `ModelResponseConverter.invoke()` internally and appends the resulting `Message` to state. Use this option when the response contains tool calls or structured content blocks that you want normalized for free.

---

## Requesting framework services via InjectQ

For anything beyond `state` and `config`, checkpointer, store, publisher, context manager, background task manager, use `Inject[T]` as the parameter default. The DI container resolves the dependency automatically at call time.

```python
from injectq import Inject
from tenxgraph.storage.checkpointer import BaseCheckpointer
from tenxgraph.storage.store import BaseStore
from tenxgraph.runtime.publisher import BasePublisher
from tenxgraph.core.state import AgentState, Message
from tenxgraph.utils.injection import fresh

async def persist_result(
    state: AgentState,
    config: dict,
    checkpointer: BaseCheckpointer = Inject[BaseCheckpointer],
    store: BaseStore = Inject[BaseStore],
    publisher: BasePublisher = Inject[BasePublisher],
) -> list:
    # Resolve each Inject default on every call. An unbound service becomes None.
    store = fresh(store)
    if store is not None:
        await store.astore(
            config,
            content=f"Thread {config['thread_id']} has {len(state.context)} messages.",
            category="results",
        )
    return []
```

### Injectable framework services

Services are injected by type through the `Inject[T]` default, not by parameter name. The graph binds these types:

| Type | Notes |
|---|---|
| `BaseCheckpointer` | Always bound; defaults to `InMemoryCheckpointer`. |
| `BaseStore` | `None` unless you pass `store=` to `compile()`. |
| `BasePublisher` | `None` unless you pass `publisher=` to `StateGraph`. |
| `BaseContextManager` | `None` unless you pass `context_manager=` to `StateGraph`. |
| `BackgroundTaskManager` | Always bound. |
| `BaseIDGenerator` | The graph's ID generator. |

The framework binds these when the graph is built and compiled. A service that was not configured resolves to `None`, so guard for it. Wrap each injected parameter in `fresh()` (from `tenxgraph.utils.injection`) so it is resolved from the active container on every call. Without it, an `Inject[...]` default keeps the first object it resolved for the life of the process.

For your own services, bind them first:

```python
from injectq import InjectQ, Inject

class Analytics:
    def record(self, event: str, meta: dict) -> None:
        print(f"[analytics] {event}", meta)

InjectQ.get_instance().bind_instance(Analytics, Analytics())

def track(state: AgentState, config: dict, analytics: Analytics = Inject[Analytics]) -> list:
    analytics.record("node_visited", {"thread": config["thread_id"]})
    return []
```

See [use-dependency-injection.md](/docs/guides/use-dependency-injection) for the full DI reference.

---

## Async nodes

Async functions work identically. The runtime awaits them automatically. Plain `def` nodes run in a worker thread, so they do not block the event loop.

```python
from injectq import Inject
from tenxgraph.core.state import AgentState
from tenxgraph.storage.store import BaseStore
from tenxgraph.utils.injection import fresh


class ProfileState(AgentState):
    profile: str = ""


async def fetch_context(
    state: ProfileState,
    config: dict,
    store: BaseStore = Inject[BaseStore],
) -> ProfileState:
    store = fresh(store)
    if store is None:
        return state
    hits = await store.asearch(config, query="user profile", category="profile", limit=1)
    if hits:
        state.profile = hits[0].content
    return state
```

---

## Dynamic routing with Command

Return `Command` when a node must both update state and choose the next node at runtime. `update` accepts a `str`, `Message`, list of messages, or `AgentState`; `goto` is a node name or `END`:

```python
from tenxgraph.utils import Command, END

def router(state: AgentState, config: dict) -> Command:
    last = state.context[-1].text() if state.context else ""

    if "urgent" in last.lower():
        return Command(update="Escalating to a human.", goto="ESCALATE")

    return Command(goto=END)
```

Use `Command` for exceptional branching. For normal routing, prefer `add_conditional_edges`, it is easier to visualize and test.

---

## Sync vs async, quick reference

```python
# Both are valid.

def sync_node(state: AgentState, config: dict) -> str:
    return "sync result"

async def async_node(state: AgentState, config: dict) -> str:
    await asyncio.sleep(0)   # any async work here
    return "async result"
```

---

## Complete example

Install `pip install "10xgraph[openai]"` and set `OPENAI_API_KEY`. Without a store passed to `compile()`, the profile lookup is skipped.

```python
import asyncio
from injectq import Inject
from tenxgraph.core.graph import StateGraph, Agent
from tenxgraph.core.state import AgentState, Message
from tenxgraph.storage.store import BaseStore
from tenxgraph.utils import END
from tenxgraph.utils.injection import fresh

class ProfileState(AgentState):
    profile: str = ""


# --- Custom node: runs before the agent, enriches state ---
async def load_user_profile(
    state: ProfileState,
    config: dict,
    store: BaseStore = Inject[BaseStore],
) -> ProfileState:
    store = fresh(store)
    if store is None:
        return state
    hits = await store.asearch(config, query="user profile", category="profile", limit=1)
    if hits:
        state.profile = hits[0].content
    return state


# --- Custom node: runs after the agent, logs the result ---
def log_response(state: ProfileState, config: dict) -> list:
    last = state.context[-1] if state.context else None
    if last:
        print(f"[{config.get('thread_id')}] assistant: {last.text()}")
    return []


# --- Standard agent node ---
agent = Agent(
    model="gpt-4o",
    system_prompt=[{"role": "system", "content": "You are a helpful assistant."}],
)

graph = StateGraph(ProfileState)
graph.add_node("LOAD", load_user_profile)
graph.add_node("MAIN", agent)
graph.add_node("LOG", log_response)

graph.set_entry_point("LOAD")
graph.add_edge("LOAD", "MAIN")
graph.add_edge("MAIN", "LOG")
graph.add_edge("LOG", END)

app = graph.compile()

result = app.invoke(
    {"messages": [Message.text_message("Hello!")]},
    config={"thread_id": "demo", "user_id": "user-42"},
)
print(result["messages"][-1].text())
```

---

## What you learned

- Any Python function (sync or async) can be a graph node, no class required.
- The runtime auto-injects `state` and `config` by parameter name.
- Framework services (checkpointer, store, publisher, etc.) are requested via `Inject[T]` defaults.
- Your own services are registered with `InjectQ.get_instance().bind_instance(...)` and injected the same way.
- Return a `str`, `Message`, `list`, `AgentState`, or `Command`. Update state fields by changing `state` and returning it.

---

## Run it in production

Nodes run inside the server's per-run limits (`recursion_limit`, `node_timeout`, `tool_timeout`), so a stuck custom node ends with a timeout error instead of hanging the worker. See [Errors and limits](/docs/concepts/errors-and-limits) and [Production readiness](/docs/production).

## Next steps

- [Choosing a building block](/docs/concepts/choosing-a-building-block) - when to use custom nodes, Agents, and prebuilt agents.
- [Dependency injection reference](/docs/guides/use-dependency-injection) - full guide to InjectQ bindings and injectable parameters.
- [Build a graph](/docs/guides/build-a-graph) - wire custom nodes into a full workflow.
- [Configure Agent](/docs/guides/configure-agent) - Agent constructor options and customization.
- [Routing and Command](/docs/concepts/callbacks-and-command) - control flow with conditionals and Command returns.
