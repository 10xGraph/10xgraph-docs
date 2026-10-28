---
title: Evaluation
seoTitle: "Evaluating AI agents with 10xGraph"
description: "Run evaluations to measure agent quality: correct tool usage, accurate responses, and safety."
section: "Testing and evaluation"
group: "Evaluation"
order: 40
label: Overview
updated: "2026-10-08"
faq:
  - question: "How do evaluations differ from unit tests?"
    answer: "Evaluations measure agent quality: whether it called the right tools, gave correct responses, and avoided hallucinations. Unit tests verify code behavior."
  - question: "Can I run evaluations without LLM costs?"
    answer: "Yes. Tool names, trajectory, node order, ROUGE and keywords run without an LLM (for example `EvalPresets.tool_usage()` or `quick_check()`). The default `EvalConfig` includes the LLM-judged `response_match`."
  - question: "Can I run evaluations from code or just the CLI?"
    answer: "Both. Use AgentEvaluator or QuickEval for code; use `10xgraph eval` for CLI discovery and parallel runs."
---

Evaluation runs your agent against test cases and scores the results. Unlike unit tests, evaluations measure **quality**: whether the agent called the right tools, gave a semantically correct response, avoided hallucinations, and stayed safe.

The evaluation stack has four layers:

```
EvalSet / Scenarios  →  AgentEvaluator / UserSimulator  →  Criteria  →  EvalReport
       ↑                           ↑                            ↑              ↓
  Test cases               Runs the graph               Scores results   HTML / JSON
```

---

## Quick start

### 1. Define test cases

Create an `EvalSet` with test cases using `EvalSetBuilder`:

```python
from tenxgraph.qa.evaluation import EvalSetBuilder

eval_set = (
    EvalSetBuilder("weather-agent")
    .add_tool_test(
        query="What is the weather in London?",
        tool_name="get_weather",
        tool_args={"location": "London"},
        expected_response="London",
        case_id="weather_london",
    )
    .add_tool_test(
        query="Weather in Tokyo?",
        tool_name="get_weather",
        tool_args={"location": "Tokyo"},
        expected_response="Tokyo",
        case_id="weather_tokyo",
    )
    .build()
)
```

### 2. Run programmatically

The graph must be compiled with the collector's callback manager so tool calls and node visits are captured. Build your uncompiled `StateGraph` (`graph` below), wire the collector in at compile time, then pass the compiled graph to `AgentEvaluator` and await the result:

```python
from tenxgraph.qa.evaluation import (
    AgentEvaluator,
    TrajectoryCollector,
    make_trajectory_callback,
)
from tenxgraph.qa.evaluation.config.presets import EvalPresets

collector, callback_manager = make_trajectory_callback(
    TrajectoryCollector(capture_all_events=True)
)
your_graph = graph.compile(callback_manager=callback_manager)
config = EvalPresets.tool_usage(threshold=0.6)

evaluator = AgentEvaluator(your_graph, collector, config=config)
report = await evaluator.evaluate(eval_set)

print(f"Pass rate: {report.summary.pass_rate:.0%}")
```

### 3. Quick one-liner with QuickEval

For a single test without building an `EvalSet`, use `QuickEval.check()`:

```python
from tenxgraph.qa.evaluation import QuickEval

report = await QuickEval.check(
    graph=your_graph,  # compiled as in step 2
    collector=collector,
    query="Weather in London?",
    expected_response_contains="sunny",
    expected_tools=["get_weather"],
)
```

### 4. Or use the CLI

Put eval files in an `evals/` directory and run the command:

```bash
10xgraph eval
```

The CLI discovers `*_eval.py` and `eval_*.py` files, loads your agent from `10xgraph.json`, runs all cases, and writes a JSON report to `eval_reports/` automatically. Open it in the playground (Evals > Open report file). For full CLI options, see [How to run evaluations](/docs/testing/run-evals).

---

## Core concepts

### EvalSet and EvalCase

An `EvalSet` is a named collection of test cases (`EvalCase` objects). Each case defines a user query (or multi-turn conversation), the expected response, and optionally the expected tool calls and node visit order.

See [Building eval sets](/docs/testing/eval-sets) for the full API: single-turn, multi-turn, and trajectory-based cases.

### Criteria

A criterion scores one evaluation case by comparing the agent's trajectory and response against the expected outcome. Each criterion returns a score between 0 and 1. A case passes if all criteria meet their thresholds.

10xGraph provides 12 criteria:

| Criterion | Type | What it checks |
|---|---|---|
| `tool_name_match` | No-LLM | Tool names called match expected |
| `trajectory` | No-LLM | Tool sequence matches (EXACT / IN_ORDER / ANY_ORDER) |
| `node_order` | No-LLM | Graph nodes visited in expected order |
| `rouge_match` | No-LLM | ROUGE-1 token overlap between actual and expected response |
| `contains_keywords` | No-LLM | Required keywords appear in the response |
| `response_match` | LLM judge | Semantic equivalence of actual and expected response |
| `llm_judge` | LLM judge | Same semantic check, reported separately |
| `rubric_based` | LLM judge | Your own written grading rules |
| `factual_accuracy` | LLM judge | Factual correctness of stated facts |
| `hallucination` | LLM judge | Is the response grounded in tool results? |
| `safety` | LLM judge | Safety across harmful content, hate speech, privacy, misinformation |
| `simulation_goals` | LLM judge | Goal achievement in a multi-turn user simulation |

See [Criteria reference](/docs/testing/criteria) for details and thresholds.

### EvalConfig and EvalPresets

`EvalConfig` specifies which criteria to run and their thresholds. `EvalPresets` offers ready-made configs:

```python
from tenxgraph.qa.evaluation.config.presets import EvalPresets

config = EvalPresets.tool_usage(threshold=0.6)       # No LLM: tool names + sequence
config = EvalPresets.response_quality(threshold=0.7) # LLM judge on response accuracy
config = EvalPresets.quick_check()                   # ROUGE-only, no LLM cost
config = EvalPresets.comprehensive(threshold=0.8)    # Tool, trajectory, ROUGE and LLM-judged criteria
```

See [Presets and configuration](/docs/testing/presets) for how to build custom configs.

### User simulation

`UserSimulator` uses an LLM to play a user role and drive dynamic multi-turn conversations with your agent. You define a `ConversationScenario` with goals; the simulator generates messages turn by turn and scores goal achievement.

```python
from tenxgraph.qa.evaluation import ConversationScenario, UserSimulatorConfig

SIMULATOR_CONFIG = UserSimulatorConfig(
    model="gemini/gemini-2.5-flash",
    max_invocations=8,
)

def get_scenarios() -> list[ConversationScenario]:
    return [
        ConversationScenario(
            scenario_id="travel_planning",
            description="User planning a trip wants weather and packing advice",
            starting_prompt="Hi! I'm planning a trip to Paris this weekend.",
            goals=[
                "User receives weather information for Paris",
                "User gets clothing or packing advice",
            ],
            max_turns=8,
        ),
    ]
```

See [User simulation](/docs/testing/user-simulation) for the full API and the `get_scenarios()` protocol.

### Reports

By default, an evaluation run writes a JSON report to `eval_reports/`, which the playground Evals page opens for review (pass rates, criterion scores, failure details). HTML, and JUnit XML for CI integrations, are opt-in through `ReporterConfig(html=True)` and `ReporterConfig(junit_xml=True)` when you call the library directly. JUnit XML for CI integrations is opt-in through `ReporterConfig(junit_xml=True)`.

See [Reports](/docs/testing/reports) for output formats and CI setup.

---

## Running evaluations

For quick local evaluation, use `AgentEvaluator` or `QuickEval` as shown above. For repeatable, production evaluations with CLI commands, parallel execution, configuration, and CI integration, see [How to run evaluations](/docs/testing/run-evals).

---

## Next steps

- [Building eval sets](/docs/testing/eval-sets): define test cases and multi-turn scenarios
- [Criteria reference](/docs/testing/criteria): all 12 criteria explained
- [Presets and configuration](/docs/testing/presets): ready-made configs and custom thresholds
- [User simulation](/docs/testing/user-simulation): LLM-driven multi-turn testing
- [Reports](/docs/testing/reports): HTML, JSON, JUnit XML output formats
- [How to run evaluations](/docs/testing/run-evals): CLI commands, parallel runs, CI integration
