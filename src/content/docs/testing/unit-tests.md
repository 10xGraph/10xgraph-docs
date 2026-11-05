---
title: Unit Testing
seoTitle: "Unit testing AI agents with 10xGraph"
description: "Write fast, deterministic tests for agents using TestAgent, QuickTest, MockToolRegistry, and mock storage without making real LLM API calls."
section: "Testing and evaluation"
group: "Unit tests"
order: 20
label: Unit Testing
updated: "2026-10-08"
---

Unit testing 10xGraph agents verifies that **graph logic, routing, tool selection, and memory management** work correctly without making expensive or slow LLM API calls. Tests run fast, produce consistent results, and stay deterministic.

The `tenxgraph.qa.testing` module provides six core utilities: `TestAgent` (mock LLM), `QuickTest` (minimal setup factory methods), `MockToolRegistry` (tool call tracking), `MockMCPClient` (mock MCP servers), `InMemoryStore` (mock memory and retrieval), and `TestContext` (isolated test environment setup). `TestResult` provides fluent assertions on graph outputs. Together they let you test any combination of agents, tools, and memory without external dependencies or live models.

---

## Installation

```bash
pip install pytest pytest-asyncio
```

`tenxgraph.qa.testing` is built into `10xgraph`, no extra install needed.

---

## TestAgent

`TestAgent` is a drop-in replacement for `Agent` as a graph node. Its constructor takes `model`, `system_prompt`, `responses`, `tools` and `simulate_tool_calls`, and it never calls an LLM. Instead it returns responses from a list you provide, cycling through them on repeated calls.

### Basic usage

Create a `TestAgent` with a list of predefined responses and use it exactly as you would an `Agent`:

```python
from tenxgraph.qa.testing import TestAgent
from tenxgraph.core.graph import StateGraph
from tenxgraph.utils.constants import END

test_agent = TestAgent(
    model="test-model",
    responses=["The weather in London is sunny."],
)

graph = StateGraph()
graph.add_node("MAIN", test_agent)
graph.set_entry_point("MAIN")
graph.add_edge("MAIN", END)
app = graph.compile()
```

### Override a node in an existing graph

Replace an Agent node in a production graph with a `TestAgent`:

```python
from tenxgraph.qa.testing import TestAgent

# `graph` is your existing StateGraph that already has a "MAIN" node
test_agent = TestAgent(responses=["Mocked response"])
graph.override_node("MAIN", test_agent)
app = graph.compile()
```

This pattern is useful when you have a production graph in a separate module and want to test only the graph logic without the LLM.

### Multiple responses

When an agent is called more than once (e.g., in a ReAct loop), `TestAgent` cycles through the `responses` list:

```python
agent = TestAgent(responses=["Calling tool...", "Final answer here"])
# First invoke → "Calling tool..."
# Second invoke → "Final answer here"
# Third invoke → "Calling tool..." (wraps around)
```

### Simulating tool calls

Pass a `tools` list (tool names or functions). The first call returns a tool-call message with the arguments `{"query": "test query"}` for each tool; subsequent calls return the predefined responses. Passing a non-empty `tools` list turns this on automatically; `simulate_tool_calls=True` is the explicit flag.

```python
agent = TestAgent(
    responses=["It is 22°C in London."],
    tools=["get_weather"],
    simulate_tool_calls=True,
)
```

### Assertion helpers

After running the graph, assert on `TestAgent` state:

```python
# Assert the agent was called at least once
agent.assert_called()

# Assert exact call count
agent.assert_called_times(2)

# Assert never called
agent.assert_not_called()

# Inspect the last prompt sent to the agent
messages = agent.get_last_messages()

# Reset between test cases
agent.reset()
```

---

## QuickTest

`QuickTest` removes boilerplate by building, compiling, and invoking a graph in one call. Every method returns a `TestResult` for assertions. All `QuickTest` methods are async, use `pytest-asyncio` or `asyncio.run()`.

### Single-turn test

Test a single user message and agent response:

```python
import pytest
from tenxgraph.qa.testing import QuickTest

@pytest.mark.asyncio
async def test_greeting():
    result = await QuickTest.single_turn(
        agent_response="Hello! How can I help?",
        user_message="Hi",
    )
    result.assert_contains("Hello")
```

### Multi-turn conversation

Test a back-and-forth exchange:

```python
@pytest.mark.asyncio
async def test_conversation():
    result = await QuickTest.multi_turn(
        conversation=[
            ("Hello", "Hi there!"),
            ("What can you do?", "I can answer questions."),
        ]
    )
    result.assert_contains("answer questions")
```

### Test with tool calls

Test the agent's decision to call a tool and the tool's result:

```python
@pytest.mark.asyncio
async def test_weather_tool():
    result = await QuickTest.with_tools(
        query="What is the weather in London?",
        response="It is 22°C in London.",
        tools=["get_weather"],
        tool_responses={"get_weather": "22°C"},
    )
    result.assert_tool_called("get_weather")
    result.assert_contains("22°C")
```

### Custom graph

Test with a custom graph you build:

```python
@pytest.mark.asyncio
async def test_custom_graph():
    from tenxgraph.qa.testing import TestAgent

    agent = TestAgent(responses=["Done"])
    result = await QuickTest.custom(
        agent=agent,
        user_message="Run the task",
    )
    result.assert_contains("Done")
    agent.assert_called_times(1)
```

---

## TestResult

Every `QuickTest` method returns a `TestResult`. All assertion methods return `self` for chaining:

```python
result = await QuickTest.single_turn(
    agent_response="The capital of France is Paris.",
    user_message="What is the capital of France?",
)

(
    result
    .assert_contains("Paris")
    .assert_not_contains("London")
    .assert_no_errors()
)
```

| Method | What it checks |
|---|---|
| `assert_contains(text)` | Final response contains `text` |
| `assert_not_contains(text)` | Final response does not contain `text` |
| `assert_equals(expected)` | Final response equals `expected` exactly |
| `assert_tool_called(name, **kwargs)` | Tool `name` was called; optionally with specific kwargs |
| `assert_tool_not_called(name)` | Tool `name` was not called |
| `assert_message_count(n)` | Total messages in the conversation equals `n` |
| `assert_no_errors()` | No error messages in the conversation |

Also available: `final_response`, `messages`, `tool_calls`, and `state` attributes for custom assertions.

---

## MockToolRegistry

Use `MockToolRegistry` to register mock tool implementations and track every call made to them. This gives you full control over tool behavior and call history.

### Register tools

```python
from tenxgraph.qa.testing import MockToolRegistry
from tenxgraph.core.graph import ToolNode

tools = MockToolRegistry()

tools.register("get_weather", lambda city: f"22°C in {city}")
tools.register("send_email", lambda to, body: "Sent")

tool_node = ToolNode(tools.get_tool_list())
```

### Inspect and assert tool calls

After running the graph, check which tools were called and with what arguments:

```python
# Boolean check
assert tools.was_called("get_weather")

# Call count
assert tools.call_count("send_email") == 1

# Full call history
calls = tools.get_calls("get_weather")
assert calls[0]["kwargs"]["city"] == "London"

# Last call only
last = tools.get_last_call("get_weather")

# Fluent assertions
tools.assert_called("get_weather")
tools.assert_called_with("get_weather", city="London")
tools.assert_call_count("send_email", 1)
```

### Async tools

Register async tool implementations:

```python
tools.register_async("search_web", async_search_func)
```

### Reset between tests

```python
# Clear call history, keep registered functions
tools.reset()

# Full reset: clear functions and history
tools.clear()
```

---

## MockMCPClient

`MockMCPClient` simulates an MCP client for tests without a real MCP server. It implements `list_tools()` and `call_tool(name, arguments)` and records every call.

### Register mock MCP tools

```python
from tenxgraph.qa.testing import MockMCPClient

mock_client = MockMCPClient()
mock_client.add_tool(
    name="search",
    description="Search the web",
    parameters={"query": {"type": "string"}},
    handler=lambda query: f"Results for: {query}",
)

# Inside an async test
result = await mock_client.call_tool("search", {"query": "climate change"})
```

Each key in `parameters` becomes a required property of the tool's input schema. Handlers may be sync or async. Calling an unknown tool raises `ValueError`.

### Assert MCP tool calls

After running the graph, check which MCP tools were called:

```python
# Check if called
mock_client.assert_called("search")

# Check call arguments
mock_client.assert_called_with("search", query="climate change")

# Get call history (each record is {"arguments": {...}})
calls = mock_client.get_calls("search")
last_call = mock_client.get_last_call("search")
assert mock_client.call_count("search") == 1
```

### Method chaining

`add_tool()` returns `self`, so you can chain registrations:

```python
mock_client\
    .add_tool("search", description="Search", parameters={"query": {"type": "string"}}, handler=...)\
    .add_tool("email", description="Send email", parameters={...}, handler=...)
```

### Reset between tests

```python
# Clear call history, keep tool registrations
mock_client.reset()

# Full reset: clear tools and history
mock_client.clear()
```

---

## InMemoryStore

`InMemoryStore` provides an in-memory implementation of the memory store for testing graphs that use memory retrieval (memory tools, long-term storage) without requiring Postgres or Qdrant.

### Basic setup

```python
from tenxgraph.qa.testing import InMemoryStore
from tenxgraph.core.graph import StateGraph

store = InMemoryStore()

graph = StateGraph()
compiled = graph.compile(store=store)
```

### Pre-configure search results

For testing retrieval-dependent behavior, pre-set the results your graph should find:

```python
from tenxgraph.storage.store.store_schema import MemorySearchResult

store = InMemoryStore()
store.set_search_results([
    MemorySearchResult(id="1", content="User mentioned budget of $5000", score=0.95),
    MemorySearchResult(id="2", content="Preferred timeline is Q4", score=0.88),
])

# When the graph calls store.asearch(...), it gets these results
```

### Store and retrieve manually

For more control, store and retrieve memories directly:

```python
from tenxgraph.storage.store.store_schema import MemoryType

config = {"user_id": "user123", "thread_id": "thread456"}

# Store a memory
mem_id = await store.astore(
    config=config,
    content="User prefers email over phone",
    memory_type=MemoryType.EPISODIC,
)

# Retrieve it
result = await store.aget(config, mem_id)
print(result.content)

# Search by text
results = await store.asearch(config, query="contact preferences")
```

### Clear between tests

```python
# Clear all memories and pre-configured results
store.clear()
```

---

## TestContext

`TestContext` provides a helper for setting up isolated test environments. It bundles a dependency container, in-memory store, and mock tools together so you can focus on your test logic.

### Context manager usage

```python
from tenxgraph.core.state import Message
from tenxgraph.qa.testing import TestContext
from tenxgraph.utils.constants import END

# Inside an async test
with TestContext() as ctx:
    # Create a graph with the test container
    graph = ctx.create_graph()
    
    # Create a test agent
    agent = ctx.create_test_agent(responses=["Hello!"])
    
    # Build the graph
    graph.add_node("MAIN", agent)
    graph.set_entry_point("MAIN")
    graph.add_edge("MAIN", END)
    
    # Compile and run
    compiled = graph.compile(store=ctx.get_store())
    result = await compiled.ainvoke({"messages": [Message.text_message("Hi")]})
    
    # Assertions work on agent and tools
    agent.assert_called()
```

### Use the bundled components

Access the context's store and mock tools:

```python
with TestContext() as ctx:
    # Get the in-memory store
    store = ctx.get_store()
    
    # Register mock tools
    ctx.register_mock_tool("get_weather", lambda city: f"Sunny in {city}")
    mock_tools = ctx.get_mock_tools()
    
    # After running...
    assert mock_tools.was_called("get_weather")
```

### Reset between tests

```python
ctx.reset()  # Clears store, tools, and all tracking
```

---

## Complete pytest example

Here is a full example that combines `TestAgent`, `MockToolRegistry`, and `TestContext`:

```python
# tests/unit/test_weather_agent.py
import pytest
from tenxgraph.qa.testing import MockToolRegistry, QuickTest, TestAgent, TestContext
from tenxgraph.core.graph import StateGraph, ToolNode
from tenxgraph.core.state import Message
from tenxgraph.utils.constants import END

@pytest.mark.asyncio
async def test_weather_query_routes_to_tool():
    """Test that a weather query triggers the tool."""
    tools = MockToolRegistry()
    # The simulated tool call passes {"query": "test query"}
    tools.register("get_weather", lambda query: "22°C")

    agent = TestAgent(
        responses=["The weather is 22°C."],
        tools=tools.get_tool_list(),
    )

    graph = StateGraph()
    graph.add_node("MAIN", agent)
    graph.add_node("TOOL", ToolNode(tools.get_tool_list()))
    graph.set_entry_point("MAIN")

    def route(state):
        last = state.context[-1] if state.context else None
        if last and getattr(last, "tools_calls", None):
            return "TOOL"
        return END

    graph.add_conditional_edges("MAIN", route, {"TOOL": "TOOL", END: END})
    graph.add_edge("TOOL", "MAIN")

    app = graph.compile()
    result = await app.ainvoke({"messages": [Message.text_message("Weather in London?")]})

    # Assert tool was called
    tools.assert_called("get_weather")

    # Assert agent was called twice (once for tool call, once for final response)
    agent.assert_called_times(2)

@pytest.mark.asyncio
async def test_quick_fact_lookup():
    """Test with QuickTest for minimal setup."""
    result = await QuickTest.single_turn(
        agent_response="Paris is the capital of France.",
        user_message="What is the capital of France?",
    )
    result.assert_contains("Paris").assert_not_contains("London")

@pytest.mark.asyncio
async def test_with_context_helper():
    """Test using TestContext for isolated setup."""
    with TestContext() as ctx:
        agent = ctx.create_test_agent(responses=["Task complete"])
        
        graph = ctx.create_graph()
        graph.add_node("MAIN", agent)
        graph.set_entry_point("MAIN")
        graph.add_edge("MAIN", END)
        
        compiled = graph.compile()
        result = await compiled.ainvoke({"messages": [Message.text_message("Go")]})
        
        agent.assert_called()
```

---

## Further reading

- [Run tests with 10xgraph test](/docs/testing/run-tests): executing tests and coverage configuration
- [Evaluation guide](/docs/testing/evaluation): scoring agent behavior with evals
