---
title: "Test and evaluate"
seoTitle: "Test and evaluate a 10xGraph agent"
description: "Write a unit test with a mocked model, then run a small evaluation set against your weather agent with the 10xgraph eval command."
updated: "2026-10-27"
order: 110
group: "Tutorial"
section: "Get started"
faq:
  - q: "Do unit tests with TestAgent call a real model?"
    a: "No. TestAgent returns the responses you give it, so the test runs offline, instantly and with the same result every time."
  - q: "Does 10xgraph eval call a real model?"
    a: "Yes. It runs your real graph against each case, so it needs your provider API key. Cases that use only rouge_match and tool_name_match need no extra judge model."
  - q: "Where should eval files live?"
    a: "By default 10xgraph eval looks in an evals/ folder (or the directory set in 10xgraph.json) for files named *_eval.py or eval_*.py. You can also pass a file or folder path."
---

Test your agent in two layers. A unit test swaps the real model for `TestAgent`, which returns scripted replies, so you can check wiring offline in milliseconds. An evaluation runs the real graph against a small dataset and scores the results. This step adds one of each.

## What you build in this step

You write a pytest file that checks the graph without any model call, then an eval file with three cases that you run with `10xgraph eval`. Unit tests answer "is my graph wired correctly?". Evaluations answer "does my agent still behave well after I changed the prompt?".

| | Unit test | Evaluation |
|---|---|---|
| Model | Mocked (`TestAgent`) | Real, from your graph |
| Needs API key | No | Yes |
| Speed | Milliseconds | Seconds per case |
| Checks | Wiring, routing, tool calls | Response quality and tool choice |
| Run with | `pytest` | `10xgraph eval` |

## Prerequisites

- The weather agent from [Build a graph by hand](/docs/get-started/tutorial/build-a-graph), saved as `agent_with_tools.py` with the compiled graph in a variable named `app`.
- Test tooling: `pip install pytest pytest-asyncio`
- The CLI from `10xgraph-api` (`pip install 10xgraph-api`) for the `10xgraph eval` command.

## Unit test the graph with a mocked model

`TestAgent` is a drop-in replacement for `Agent`. It returns your `responses` list in order, cycling when the list runs out, and records every call so you can assert on it.

### Write the first test

Create `test_agent.py`. The test builds a one-node graph around a `TestAgent`, runs it and checks the reply.

```python
# test_agent.py
import pytest

from tenxgraph.core.graph import StateGraph
from tenxgraph.core.state import Message
from tenxgraph.qa.testing import TestAgent
from tenxgraph.utils import END


@pytest.mark.asyncio
async def test_agent_responds():
    # The mocked model: no API call is made
    test_agent = TestAgent(
        model="test-model",
        responses=["Hello! I can help you with the weather."],
    )

    # A minimal graph: MAIN -> END
    graph = StateGraph()
    graph.add_node("MAIN", test_agent)
    graph.set_entry_point("MAIN")
    graph.add_edge("MAIN", END)
    compiled = graph.compile()

    result = await compiled.ainvoke(
        {"messages": [Message.text_message("Say hello")]},
        config={},
    )

    # The last message is the assistant reply
    last_message = result["messages"][-1]
    assert "weather" in last_message.text()
    test_agent.assert_called_times(1)
```

Run it:

```bash
pytest test_agent.py -v
```

You should see the test pass:

```text
test_agent.py::test_agent_responds PASSED
```

### Use QuickTest for common patterns

`QuickTest` builds the graph for you. It has class methods for a single turn, a multi-turn conversation, a tool call and a custom agent, and each returns a `TestResult` with chainable assertions. Add these tests to `test_agent.py`:

```python
# test_agent.py (additional tests)
from tenxgraph.qa.testing import QuickTest


@pytest.mark.asyncio
async def test_single_turn():
    result = await QuickTest.single_turn(
        user_message="What's the weather?",
        agent_response="I'll check the weather for you.",
    )
    result.assert_contains("weather").assert_no_errors()


@pytest.mark.asyncio
async def test_multi_turn():
    # Each tuple is (user message, scripted agent reply)
    result = await QuickTest.multi_turn(
        [
            ("Hi", "Hello there!"),
            ("How are you?", "I'm doing great!"),
        ]
    )
    result.assert_contains("great")
```

Note that `single_turn` takes `agent_response` first and `user_message` second (default `"Hello"`). Use keyword arguments, as above, to avoid mixing them up.

### Test that a tool is called

`QuickTest.with_tools` wires a `TestAgent` and a `ToolNode` together. For every name in `tools` it creates a mock function that records the call and returns the text from `tool_responses` (or `"Mock result from <name>"`). The scripted agent calls each tool on its first turn, then returns `response`.

```python
# test_agent.py (additional test)
@pytest.mark.asyncio
async def test_tool_call():
    result = await QuickTest.with_tools(
        query="What's the weather in NYC?",
        response="It's sunny in New York today.",
        tools=["get_weather"],
        tool_responses={"get_weather": "Sunny, 22C"},
    )
    result.assert_tool_called("get_weather")
    result.assert_contains("sunny")
```

The `TestResult` assertions are `assert_contains`, `assert_not_contains`, `assert_equals`, `assert_tool_called`, `assert_tool_not_called`, `assert_message_count` and `assert_no_errors`. Each returns the result so you can chain them.

### Isolate a node with TestContext

`TestContext` is an optional helper that gives each test its own dependency container and in-memory store. Use `ctx.create_graph()` and `ctx.create_test_agent()` to keep tests from sharing state.

```python
# test_agent.py (additional test)
from tenxgraph.qa.testing import TestContext


@pytest.mark.asyncio
async def test_with_context():
    with TestContext() as ctx:
        test_agent = ctx.create_test_agent(responses=["Test response from agent"])

        graph = ctx.create_graph()
        graph.add_node("MAIN", test_agent)
        graph.set_entry_point("MAIN")
        graph.add_edge("MAIN", END)

        compiled = graph.compile()
        await compiled.ainvoke(
            {"messages": [Message.text_message("Test")]},
            config={},
        )

        # TestAgent records how often it ran
        test_agent.assert_called()
        assert test_agent.call_count == 1
```

Run the whole file with `pytest test_agent.py -v`. All tests should pass without any API key set. For `MockToolRegistry`, `MockMCPClient` and `InMemoryStore`, see [Unit tests](/docs/testing/unit-tests).

## Evaluate the agent on a dataset

An evaluation runs your real graph on each case in an `EvalSet` and scores the result against what you expected. Because it uses the real model, results can vary between runs, so you set thresholds instead of exact matches. Use it to catch regressions when you change a prompt, a tool or a model.

### Create the eval file

`10xgraph eval` discovers files named `*_eval.py` or `eval_*.py` under `evals/` (or the directory set in `10xgraph.json`). Each file must expose `get_eval_set()`, and may expose `get_eval_config()`. The CLI uses a module-level `app` as the graph; if there is none, it loads the graph from the `agent` entry in `10xgraph.json`. Create `evals/weather_eval.py`:

```python
# evals/weather_eval.py
from agent_with_tools import app  # the compiled graph from the previous step
from tenxgraph.qa.evaluation import (
    CriteriaConfig,
    CriterionConfig,
    EvalCase,
    EvalConfig,
    EvalSet,
    ToolCall,
)


def get_eval_set() -> EvalSet:
    """Three cases: a weather question, a tool call and a greeting."""
    return EvalSet(
        eval_set_id="weather-agent-basic",
        name="Basic weather agent",
        description="Simple checks for the weather agent",
        eval_cases=[
            EvalCase.single_turn(
                eval_id="weather-1",
                user_query="What is the weather in London?",
                expected_response="The weather in London is sunny and 22C.",
                expected_tools=[ToolCall(name="get_weather")],
                description="Calls the weather tool and reports the result",
            ),
            EvalCase.single_turn(
                eval_id="weather-2",
                user_query="Is it nice in Paris today?",
                expected_response="The weather in Paris is sunny and 22C.",
                expected_tools=[ToolCall(name="get_weather")],
                description="Calls the weather tool for a different city",
            ),
            EvalCase.single_turn(
                eval_id="weather-3",
                user_query="Hello",
                expected_response="Hello! How can I help you?",
                description="Answers a greeting",
            ),
        ],
    )


def get_eval_config() -> EvalConfig:
    """Score tool choice exactly and responses by word overlap (no judge model)."""
    return EvalConfig(
        criteria=CriteriaConfig(
            tool_name_match=CriterionConfig.tool_name_match(threshold=1.0),
            rouge_match=CriterionConfig.rouge_match(threshold=0.4),
        )
    )
```

`tool_name_match` checks that the tools called match `expected_tools`. `rouge_match` scores token overlap with `expected_response` and needs no extra model call. For paraphrase-aware scoring, `CriterionConfig.response_match` uses an LLM judge instead (it calls a judge model, so it costs tokens). If you leave out `get_eval_config()`, the CLI uses built-in defaults (`tool_name_match` at 1.0, `rouge_match` at 0.5, `node_order` at 0.8) and a `confeval.py` next to your evals overrides them globally.

### Run the evaluation

Point `10xgraph eval` at the folder. It runs every case, prints a summary and writes a JSON report to `eval_reports/` unless you pass `--no-report`.

```bash
10xgraph eval evals/
```

The output varies with your scores, but looks like this (example):

```text
Criteria  weather_eval.py  (source: per-file)
  tool_name_match    threshold=1.0
  rouge_match        threshold=0.4
...
JSON report: eval_reports/<report file>.json
Open it in the playground: Evals > Open report file.
```

Each case passes only when every criterion meets its threshold. Open the JSON file in the playground (Evals > Open report file) to see the conversation, tool calls and per-criterion scores of each failed case.

| Flag | Short | Default | Purpose |
|---|---|---|---|
| `--output` | `-o` | `eval_reports` | Directory for reports |
| `--no-report` | | off | Print the summary only |
| `--threshold` | `-t` | none | Exit with an error if the overall pass rate is below this value (0.0 to 1.0) |
| `--parallel` | `-p` | off | Run cases concurrently |
| `--max-concurrency` | `-c` | 4 | Concurrent cases with `--parallel` |

Add `--threshold 0.8` in CI so a drop in quality fails the build. To run evaluations from inside pytest instead, see [Evals in pytest](/docs/testing/evals-in-pytest).

## When to use each approach

Use both. They catch different failures, and the unit tests keep your feedback loop fast.

- **Unit tests** cover graph structure, routing, tool wiring and error handling. They are free and deterministic, so run them on every commit.
- **Evaluations** cover answer quality, tool choice and regressions after prompt or model changes. They cost API calls and vary slightly, so run them before a release or on a schedule.

Do not use evaluations to test wiring bugs: a failing case does not tell you whether the cause is the graph or the model. Do not use `TestAgent` to judge answer quality: it only returns what you scripted.

## What you learned

- `TestAgent` replaces the model with scripted replies, and `QuickTest` builds common test graphs in one call.
- `TestResult` assertions are chainable, and `TestContext` isolates each test.
- An `EvalSet` of `EvalCase` objects plus an `EvalConfig` describes an evaluation, and `10xgraph eval` runs it against your real graph and writes reports.

## Next steps

You have finished the tutorial track. Continue with:

- [Testing](/docs/testing) for unit test patterns, criteria, presets and user simulation.
- [Run the server](/docs/server/run-the-server) to serve the agent over HTTP with `10xgraph dev`.
- [Production checklist](/docs/server/production-checklist) before you deploy.
- [Prebuilt agents](/docs/guides/prebuilt-agents) and [Concepts](/docs/concepts) for the next level of detail.
