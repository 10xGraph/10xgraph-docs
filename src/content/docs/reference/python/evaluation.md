---
title: Evaluation
seoTitle: "Evaluation API reference (Python)"
description: "The evaluation API: classes for datasets, criteria, execution and results."
section: Reference
group: "Python library"
order: 270
label: Evaluation
updated: "2026-10-08"
---

The evaluation API scores an agent against labelled datasets. You build an `EvalSet`, choose criteria in an `EvalConfig` or `EvalPresets`, run `AgentEvaluator` on a graph paired with a `TrajectoryCollector`, and read an `EvalReport`. Simulators add LLM-driven users. This page lists every class and signature.

For an end-to-end walkthrough, see [Evaluation](/docs/testing/evaluation).

Two companion pages explain the details:

- [Evaluation criteria](/docs/reference/python/evaluation-criteria) covers every criterion class, its constructor and its scoring behaviour.
- [Evaluation harness](/docs/reference/python/evaluation-harness) covers `EvaluationRunner`, `ReporterManager`, and the pytest helpers.

## Import paths

```python
from tenxgraph.qa.evaluation import (
    AgentEvaluator,
    EvalConfig,
    EvalPresets,
    CriteriaConfig,
    CriterionConfig,
    MatchType,
    Rubric,
    EvalSet,
    EvalSetBuilder,
    EvalCase,
    Invocation,
    MessageContent,
    SessionInput,
    ToolCall,
    TrajectoryStep,
    StepType,
    EvalReport,
    EvalCaseResult,
    CriterionResult,
    TrajectoryCollector,
    make_trajectory_callback,
    create_eval_app,
    UserSimulator,
    UserSimulatorConfig,
    BatchSimulator,
    ConversationScenario,
    SimulationResult,
)
```

Everything above is also re-exported from `tenxgraph.qa`.

---

## Wiring a run

Evaluation needs two objects: a **compiled** graph and the `TrajectoryCollector`
whose callback manager that graph was compiled with. Without that pairing the
collector sees no events and every trajectory criterion scores zero.

The short way:

```python
from tenxgraph.qa.evaluation import AgentEvaluator, create_eval_app

app, collector = create_eval_app(build_my_graph())   # uncompiled StateGraph in
evaluator = AgentEvaluator(app, collector)
```

The explicit way, when you need to control compilation yourself:

```python
from tenxgraph.qa.evaluation import TrajectoryCollector, make_trajectory_callback

collector = TrajectoryCollector(capture_all_events=True)
_, callback_mgr = make_trajectory_callback(collector, config={"thread_id": "eval-1"})

app = my_state_graph.compile(callback_manager=callback_mgr)
```

`make_trajectory_callback()` returns a **tuple** `(collector, callback_manager)`. Pass the second element to `compile()`.

---

## `EvalCase`

A single labelled test case. Fields:

| Field | Type | Default | Description |
|---|---|---|---|
| `eval_id` | `str` | random UUID | Unique ID for this case. |
| `name` | `str` | `""` | Label shown in reports. |
| `description` | `str` | `""` | Longer description. |
| `conversation` | `list[Invocation]` | `[]` | One entry per turn. Expected tools, node order and responses live here. |
| `session_input` | `SessionInput` | default instance | `app_name`, `user_id` (`"test_user"`), `state`, `config`. `config` is merged into the run config. |
| `tags` | `list[str]` | `[]` | Used by `EvalSet.filter_by_tags()`. |
| `metadata` | `dict[str, Any]` | `{}` | Free-form. `HallucinationCriterion` reads `metadata["context"]`; `FactualAccuracyCriterion` reads `metadata["reference_facts"]`. |

There is no `expected_response` or `expected_tools` attribute on `EvalCase` itself. Those are constructor arguments of the factory methods, stored on the `Invocation` objects inside `conversation`.

### `EvalCase.single_turn`

```python
from tenxgraph.qa.evaluation import EvalCase, ToolCall

case = EvalCase.single_turn(
    eval_id="weather-paris-001",
    user_query="What is the weather in Paris today?",
    expected_response="It is sunny in Paris.",
    expected_tools=[ToolCall(name="get_weather", args={"location": "Paris"})],
    expected_node_order=["MAIN", "TOOL", "MAIN"],
    name="Paris weather",
)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `eval_id` | `str` | required | Unique ID for this case. |
| `user_query` | `str` | required | Input message from the user. |
| `expected_response` | `str \| None` | `None` | Expected final response. `None` means response criteria skip the case. |
| `expected_tools` | `list[ToolCall] \| None` | `None` | Expected tool calls. `ToolCall` objects, not plain strings. |
| `expected_node_order` | `list[str] \| None` | `None` | Expected node visit sequence. |
| `name` | `str` | `""` | Label shown in reports. |
| `description` | `str` | `""` | Longer description. |

### `EvalCase.multi_turn`

```python
case = EvalCase.multi_turn(
    eval_id="multi-turn-001",
    conversation=[
        ("Hello", "Hi"),
        ("What can you do?", "I can answer questions"),
        ("Tell me about Python", "Python is a programming language"),
    ],
    expected_tools=[ToolCall(name="search_docs")],
)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `eval_id` | `str` | required | Unique ID for this case. |
| `conversation` | `list[tuple[str, str]]` | required | `(user_query, expected_response)` per turn. |
| `expected_tools` | `list[ToolCall] \| None` | `None` | Attached to the **first** invocation only. |
| `name` | `str` | `""` | Label shown in reports. |
| `description` | `str` | `""` | Longer description. |

The evaluator feeds the agent one user message per turn and accumulates tool calls,
node visits and messages across all turns. Criteria then score the accumulated
execution once, not per turn.

### `Invocation`

One turn inside `EvalCase.conversation`.

| Field | Type | Default | Description |
|---|---|---|---|
| `invocation_id` | `str` | random UUID | Turn identifier. |
| `user_content` | `MessageContent` | required | The user message for this turn. |
| `expected_tool_trajectory` | `list[ToolCall]` | `[]` | Tools expected during this turn. |
| `expected_node_order` | `list[str]` | `[]` | Node sequence expected during this turn. |
| `expected_intermediate_responses` | `list[MessageContent]` | `[]` | Reserved for intermediate output. |
| `expected_final_response` | `MessageContent \| None` | `None` | Expected reply for this turn. |

`Invocation.simple(user_query, expected_response=None, expected_tools=None, expected_node_order=None)`
builds one without touching `MessageContent` directly.

---

## `ToolCall`

Represents an expected or actual tool invocation.

```python
from tenxgraph.qa.evaluation import ToolCall

tc = ToolCall(
    name="get_weather",
    args={"location": "Paris", "units": "celsius"},
    call_id=None,   # optional
    result=None,    # populated on actual calls
)
```

### `ToolCall.matches`

```python
tc.matches(other, check_args=True, check_call_id=False)  # -> bool
```

Compares against another `ToolCall`. Names must always be equal. Arguments are only
compared when `check_args=True` **and** the expected call defines non-empty `args`. An expected `ToolCall` with `args={}` accepts any arguments. Trajectory criteria call this with `check_call_id=False`.

---

## `TrajectoryStep`

A recorded step in the execution trajectory.

| Field | Type | Default |
|---|---|---|
| `step_type` | `StepType` | required |
| `name` | `str` | required |
| `args` | `dict[str, Any]` | `{}` |
| `timestamp` | `float \| None` | `None` |
| `metadata` | `dict[str, Any]` | `{}` |

```python
from tenxgraph.qa.evaluation import TrajectoryStep

node_step = TrajectoryStep.node("RESEARCH_NODE")
tool_step = TrajectoryStep.tool("search", args={"query": "AI trends"})
```

Both factories take the step name as a plain string and accept extra keyword
arguments, which are stored in `metadata`.

### `StepType`

| Value | Description |
|---|---|
| `StepType.NODE` | A graph node was entered. |
| `StepType.TOOL` | A tool was called. |
| `StepType.MESSAGE` | A message step. |
| `StepType.CONDITIONAL` | A conditional-edge step. |

---

## `EvalSet`

A collection of `EvalCase` objects.

| Field | Type | Default |
|---|---|---|
| `eval_set_id` | `str` | random UUID |
| `name` | `str` | `""` |
| `description` | `str` | `""` |
| `eval_cases` | `list[EvalCase]` | `[]` |
| `metadata` | `dict[str, Any]` | `{}` |

```python
from tenxgraph.qa.evaluation import EvalSet

eval_set = EvalSet(eval_set_id="capitals", name="Capitals", eval_cases=[case1, case2])
```

| Method | Description |
|---|---|
| `EvalSet.from_file(path)` | Classmethod. Load from a JSON file matching the `EvalSet` schema. |
| `to_file(path)` / `save(path)` | Write to a JSON file. |
| `add_case(case)` | Append a case. |
| `get_case(eval_id)` | Look up a case, or `None`. |
| `filter_by_tags(tags)` | Cases carrying **all** of the given tags. |
| `len(eval_set)` / iteration | Case count / iterate over cases. |

The on-disk format is a single JSON object, not JSONL. `EvalSetBuilder` offers a fluent way to construct one (see [Building eval sets](/docs/testing/eval-sets)).

---

## `EvalConfig`

Holds the criteria to apply during evaluation, plus run-level settings.

| Field | Type | Default | Description |
|---|---|---|---|
| `criteria` | `CriteriaConfig` | empty `CriteriaConfig()` | Which criteria run. |
| `user_simulator_config` | `UserSimulatorConfig \| None` | `None` | Simulator settings. |
| `parallel` | `bool` | `False` | Run cases concurrently. |
| `max_concurrency` | `int` | `4` | Concurrency cap. |
| `timeout` | `float` | `300.0` | Seconds per case. |
| `verbose` | `bool` | `False` | Verbose logging. |
| `mock_mode` | `bool` | `False` | Skip actual execution. |
| `reporter` | `ReporterConfig` | default instance | Automatic report generation. |

`criteria` is a **typed model**, not a free-form dict. `CriteriaConfig` forbids
unknown fields, so each criterion goes in its own named slot:

```python
from tenxgraph.qa.evaluation import (
    CriteriaConfig,
    CriterionConfig,
    EvalConfig,
    MatchType,
)

config = EvalConfig(
    criteria=CriteriaConfig(
        tool_name_match=CriterionConfig.tool_name_match(threshold=1.0),
        trajectory=CriterionConfig.trajectory(match_type=MatchType.IN_ORDER),
        llm_judge=CriterionConfig.llm_judge(),
    ),
    parallel=True,
    max_concurrency=4,
)
```

### `CriteriaConfig` fields

Every field is `CriterionConfig | None`, defaulting to `None` (criterion off).

| Field | Criterion class | Reported as |
|---|---|---|
| `tool_name_match` | `ToolNameMatchCriterion` | `tool_name_match_score` |
| `trajectory` | `TrajectoryMatchCriterion` | `tool_trajectory_avg_score` |
| `node_order` | `NodeOrderMatchCriterion` | `node_order_score` |
| `response_match` | `ResponseMatchCriterion` | `response_match_score` |
| `rouge_match` | `RougeMatchCriterion` | `rouge_match` |
| `contains_keywords` | `ContainsKeywordsCriterion` | `contains_keywords` |
| `llm_judge` | `LLMJudgeCriterion` | `final_response_match_v2` |
| `rubric_based` | `RubricBasedCriterion` | `rubric_based_final_response_quality_v1` |
| `factual_accuracy` | `FactualAccuracyCriterion` | `factual_accuracy_v1` |
| `hallucination` | `HallucinationCriterion` | `hallucinations_v1` |
| `safety` | `SafetyCriterion` | `safety_v1` |
| `simulation_goals` | `SimulationGoalsCriterion` | `simulation_goals` |

The "reported as" column is the criterion's `name`, the key you will see in `EvalSummary.criterion_stats` and in `CriterionResult.criterion`.

### Built-in configurations

| Classmethod | Criteria enabled |
|---|---|
| `EvalConfig.default()` | `trajectory` (EXACT, threshold 1.0) + `response_match` (LLM, threshold 0.8) |
| `EvalConfig.strict()` | `trajectory` (EXACT, `check_args=True`, 1.0) + `response_match` (0.9) + `llm_judge` (0.9, 5 samples) |
| `EvalConfig.relaxed()` | `trajectory` (IN_ORDER, `check_args=False`, 0.8) + `response_match` (0.6) |

### Methods

| Method | Description |
|---|---|
| `EvalConfig.from_file(path)` | Classmethod. Load config from JSON. |
| `to_file(path)` | Write config to JSON. |
| `get_criterion_config(name)` | Fetch a `CriterionConfig` by `CriteriaConfig` field name. |
| `enable_criterion(name, config=None)` | Enable by field name. Raises `ValueError` for unknown names. |
| `disable_criterion(name)` | Set `enabled=False` on that criterion. |
| `with_rubrics(rubrics)` | Return a deep copy with `rubric_based` configured. |

`CriterionConfig` fields and factory methods are documented in
[Criteria](/docs/testing/criteria#criterionconfig-reference); the criterion
classes themselves in [Evaluation criteria](/docs/reference/python/evaluation-criteria).

---

## `EvalPresets`

Ready-made evaluation configurations for common scenarios.

```python
from tenxgraph.qa.evaluation import EvalPresets

config = EvalPresets.response_quality(judge_model="gpt-4o")
config = EvalPresets.tool_usage(strict=True)
config = EvalPresets.comprehensive()
```

| Classmethod | Returns | Description |
|---|---|---|
| `response_quality(threshold=0.7, use_llm_judge=True, judge_model=DEFAULT_JUDGE_MODEL)` | `EvalConfig` | LLM-as-judge scoring focused on response quality. |
| `tool_usage(threshold=1.0, strict=True, check_args=True)` | `EvalConfig` | Validates correct tool calls and arguments. `strict=True` requires exact matches (EXACT); `False` allows extras (IN_ORDER). |
| `conversation_flow(threshold=0.8, judge_model=DEFAULT_JUDGE_MODEL)` | `EvalConfig` | Tests multi-turn conversations with response quality and trajectory matching. |
| `quick_check()` | `EvalConfig` | Fast sanity check using ROUGE-1 token overlap (no LLM calls). Switch to `response_quality()` for semantic accuracy. |
| `comprehensive(threshold=0.8, use_llm_judge=True, judge_model=DEFAULT_JUDGE_MODEL)` | `EvalConfig` | All criteria: tool names, trajectory, ROUGE, LLM judge, factual accuracy, hallucination, safety. |
| `safety_check(threshold=0.8, judge_model=DEFAULT_JUDGE_MODEL)` | `EvalConfig` | Focused on safety and hallucination detection. |
| `combine(*configs)` | `EvalConfig` | Merge multiple presets into one. Later criteria override earlier ones. |
| `custom(response_threshold=None, tool_threshold=None, llm_judge_threshold=None, tool_match_type=MatchType.IN_ORDER, check_tool_args=True, hallucination_threshold=None, safety_threshold=None, factual_accuracy_threshold=None, judge_model=DEFAULT_JUDGE_MODEL)` | `EvalConfig` | Enable only the criteria whose threshold you pass. |

---

## `EvalSetBuilder`

Fluent builder for creating eval sets in code.

```python
from tenxgraph.qa.evaluation import EvalSetBuilder

eval_set = (
    EvalSetBuilder("my_tests")
    .add_case("What is 2+2?", "4")
    .add_case(
        "Get the weather",
        "It is sunny",
        expected_tools=["get_weather"],
    )
    .add_multi_turn([
        ("Hello", "Hi"),
        ("How are you?", "I'm good"),
    ])
    .build()
)

eval_set.save("my_tests.json")
```

| Method | Parameters | Returns | Description |
|---|---|---|---|
| `__init__` | `name: str = "eval_set"` | `EvalSetBuilder` | Create a builder with a given set name. |
| `add_case` | `query: str, expected: str, case_id: str = None, expected_tools: list[str \| ToolCall] = None, expected_node_order: list[str] = None, name: str = "", description: str = ""` | `self` | Add a single-turn test case. |
| `add_multi_turn` | `conversation: list[tuple[str, str]], case_id: str = None, expected_tools: list[str \| ToolCall] = None, name: str = "", description: str = ""` | `self` | Add a multi-turn conversation. |
| `add_tool_test` | `query: str, tool_name: str, tool_args: dict = None, expected_response: str = None, case_id: str = None` | `self` | Add a single test focused on one tool call. |
| `build` | none | `EvalSet` | Build and return the final EvalSet. |
| `save` | `path: str` | `EvalSet` | Build and save to a JSON file. |
| `from_conversations` | classmethod `(conversations: list[dict[str, str]], name: str = "conversation_tests")` | `EvalSet` | Build from dicts with `user` and `assistant` keys. |
| `from_file` | classmethod `(path: str)` | `EvalSetBuilder` | Load an existing eval set JSON to extend it. |
| `quick` | classmethod `(*test_pairs: tuple[str, str])` | `EvalSet` | Build a set from `(query, expected)` pairs. |

---

## `UserSimulator`

`UserSimulator` uses an LLM to play the user, so you can test an agent with dynamic conversations instead of fixed prompts. Call `run()` with a compiled graph and a `ConversationScenario`. It returns a `SimulationResult`. For where simulation fits in a test plan, see [Evaluation](/docs/testing/evaluation).

```python
import asyncio

from tenxgraph.qa.evaluation import ConversationScenario, UserSimulator


async def check_weather_flow(graph) -> None:
    # `graph` is a compiled agent graph (for example the `app` from create_eval_app)
    simulator = UserSimulator(model="gemini/gemini-2.5-flash", temperature=0.7)

    scenario = ConversationScenario(
        scenario_id="weather_lookup",
        description="User wants the weather for travel planning",
        starting_prompt="I'm planning a trip to New York next week",
        goals=["Get weather info"],
        max_turns=5,
    )

    result = await simulator.run(graph, scenario)
    print(result.completed, result.goals_achieved)
    for turn in result.conversation:
        print(turn["role"], turn["content"])


# asyncio.run(check_weather_flow(app))
```

### `UserSimulator` constructor

| Parameter | Type | Default | Description |
|---|---|---|---|
| `model` | `str` | `"gemini/gemini-2.5-flash"` | Model that generates the simulated user's messages. |
| `temperature` | `float` | `0.7` | Sampling temperature for user messages. |
| `max_turns` | `int` | `10` | Default turn limit, used when the scenario's `max_turns` is falsy. |
| `config` | `UserSimulatorConfig \| None` | `None` | When given, `model`, `temperature`, `max_turns` (from `max_invocations`) and `api_style` are taken from it. |
| `criteria` | `list[BaseCriterion] \| None` | `None` | Criteria (for example `SimulationGoalsCriterion`) run after the simulation to score it. |
| `api_style` | `str` | `"responses"` | OpenAI API style: `"responses"` or `"chat"` for legacy or third-party models. |

### `UserSimulator.run`

```python
async def run(
    graph: CompiledGraph,
    scenario: ConversationScenario,
    config: dict[str, Any] | None = None,
) -> SimulationResult
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `graph` | `CompiledGraph` | required | The compiled agent graph to test. |
| `scenario` | `ConversationScenario` | required | The scenario to simulate. |
| `config` | `dict \| None` | `None` | Config passed to each graph call. A `thread_id` is generated per run when you do not set one, so runs do not share checkpointer state. |

If `scenario.starting_prompt` is empty, the simulator generates the opening message. Each turn sends the full conversation history to the graph. If the agent raises, the run ends and the result carries the error.

### `ConversationScenario`

A scenario describes who the simulated user is and what they want.

| Field | Type | Default | Description |
|---|---|---|---|
| `scenario_id` | `str` | `""` | Identifier, also used to build the per-run `thread_id`. |
| `description` | `str` | `""` | Description of the overall scenario. |
| `starting_prompt` | `str` | `""` | First user message. Generated when empty. |
| `conversation_plan` | `str` | `""` | High-level plan of how the conversation should flow. |
| `goals` | `list[str]` | `[]` | Goals the user wants to achieve. |
| `max_turns` | `int` | `10` | Maximum conversation turns. |
| `metadata` | `dict[str, Any]` | `{}` | Free-form data. |
| `config` | `dict[str, Any]` | `{}` | Run config for this conversation, merged into the simulator's run config. An explicit `config=` passed to `UserSimulator.run` wins. Example: `{"user": {"user_id": "u1"}}`. |

### `SimulationResult`

| Attribute | Type | Description |
|---|---|---|
| `scenario_id` | `str` | ID of the scenario that was run. |
| `turns` | `int` | Number of turns executed. |
| `conversation` | `list[dict[str, str]]` | Messages as `{"role": ..., "content": ...}` dicts. |
| `goals_achieved` | `list[str]` | Goals judged as achieved. |
| `completed` | `bool` | Whether the simulation completed. |
| `error` | `str \| None` | Set if the simulation failed. |
| `criterion_scores` | `dict[str, float]` | Score per criterion in `criteria`, 0.0 to 1.0. |
| `criterion_details` | `dict[str, Any]` | Detail output per criterion. |
| `simulator_token_usage` | `TokenUsage` | Tokens used by the simulator's own LLM calls. |
| `criterion_results` | `list[CriterionResult]` | Full results with per-criterion token usage. |

`UserSimulatorConfig` (`model`, `max_invocations`, `temperature`, `thinking_enabled`, `thinking_budget`, `api_style`) is also the type of `EvalConfig.user_simulator_config`.

---

## `BatchSimulator`

`BatchSimulator` runs many scenarios concurrently against one graph, with a semaphore capping parallelism. Results come back in the same order as the scenarios, and each run gets its own `thread_id`.

```python
from tenxgraph.qa.evaluation import BatchSimulator, ConversationScenario, UserSimulator


async def run_scenarios(graph) -> None:
    batch = BatchSimulator(
        simulator=UserSimulator(model="gemini/gemini-2.5-flash"),
        max_concurrency=4,
    )

    scenarios = [
        ConversationScenario(
            scenario_id="weather", starting_prompt="Weather in Paris?", goals=["Get weather"]
        ),
        ConversationScenario(
            scenario_id="hotel", starting_prompt="I need a hotel", goals=["Book a hotel"]
        ),
    ]

    results = await batch.run_batch(graph, scenarios)
    print(batch.summary(results))
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `simulator` | `UserSimulator \| None` | `None` | A preconfigured simulator. When omitted, one is built from `**kwargs`. |
| `max_concurrency` | `int` | `5` | Maximum scenarios running at once. |
| `**kwargs` | | | Passed to `UserSimulator` when `simulator` is not given. |

| Method | Signature | Description |
|---|---|---|
| `run_batch` | **async** `(graph, scenarios, config=None) -> list[SimulationResult]` | Run all scenarios concurrently. |
| `summary` | `(results) -> dict[str, Any]` | Keys: `total_scenarios`, `completed`, `completion_rate`, `total_goals_achieved`, `average_turns`, `errors`. |

---

## `MatchType`

| Value | Description |
|---|---|
| `MatchType.EXACT` | Same items, same positions. |
| `MatchType.IN_ORDER` | Expected items must appear in order; extras allowed between them. |
| `MatchType.ANY_ORDER` | All expected items must appear, in any order. |

---

## `Rubric`

```python
from tenxgraph.qa.evaluation import Rubric

rubric = Rubric(
    rubric_id="accuracy",
    content="The response must contain the correct capital city.",
    weight=1.0,
)
```

| Field | Type | Default | Description |
|---|---|---|---|
| `rubric_id` | `str` | required | Unique ID; shown in `details["rubrics"]`. |
| `content` | `str` | required | Grading criterion text passed to the judge. |
| `weight` | `float` | `1.0` | Relative importance. Weights do not have to sum to 1. |

---

## `TrajectoryCollector`

Records node visits, tool calls and per-node LLM output during a graph run. It is a
`BasePublisher`, fed by `PublisherCallback`.

```python
from tenxgraph.qa.evaluation import TrajectoryCollector, make_trajectory_callback

collector = TrajectoryCollector(capture_all_events=True)
_, callback_mgr = make_trajectory_callback(collector)

app = graph.compile(callback_manager=callback_mgr)
await app.ainvoke({"messages": [...]})

for step in collector.trajectory:
    print(step.step_type, step.name)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `capture_all_events` | `bool` | `False` | Also retain every raw `EventModel` on `collector.events`. |

| Attribute | Type | Description |
|---|---|---|
| `trajectory` | `list[TrajectoryStep]` | Ordered node and tool steps. |
| `tool_calls` | `list[ToolCall]` | Tool calls with args and results. |
| `node_visits` | `list[str]` | Node names in visit order. |
| `node_responses` | `list[NodeResponse]` | Per-node input/output snapshots. |
| `final_response` | `str` | Text from the last non-tool-call node invocation. |
| `events` | `list[EventModel]` | Raw events, when `capture_all_events=True`. |
| `start_time` / `end_time` | `float \| None` | First and last event timestamps. |

`AgentEvaluator` calls `collector.reset()` before every case.

### `make_trajectory_callback`

```python
def make_trajectory_callback(
    collector: TrajectoryCollector,
    config: dict | None = None,
) -> tuple[TrajectoryCollector, CallbackManager]
```

Builds a `CallbackManager` with a `PublisherCallback` registered for the `TOOL`,
`MCP` and `AI` invocation types. `config` may carry `thread_id` and `run_id`, which
are stamped onto every emitted event. Pass the returned callback manager to
`graph.compile()`.

---

## `AgentEvaluator`

Main evaluation runner.

```python
from tenxgraph.qa.evaluation import AgentEvaluator, EvalConfig

evaluator = AgentEvaluator(app, collector, config=EvalConfig.default())
report = await evaluator.evaluate(eval_set)
print(report.format_summary())
```

### Constructor parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `graph` | `CompiledGraph` | required | Graph compiled with the collector's callback manager. |
| `collector` | `TrajectoryCollector` | required | Collector wired into that graph. |
| `config` | `EvalConfig \| None` | `None` | Falls back to `EvalConfig.default()`. |

Concurrency is **not** a constructor argument. Pass `parallel` and `max_concurrency` to `evaluate()`, or set them on `EvalConfig`.

### `evaluate`

```python
async def evaluate(
    eval_set: EvalSet | str,
    parallel: bool = False,
    max_concurrency: int = 4,
    verbose: bool = False,
    output_dir: str | None = None,
) -> EvalReport
```

`eval_set` accepts an `EvalSet` or a path to an eval set JSON file (a missing file
raises `FileNotFoundError`). After building the report, `evaluate()` runs the
configured reporters unless `config.reporter.enabled` is `False`; `output_dir`
overrides `ReporterConfig.output_dir` for that run. Parallel mode is only used when
`parallel=True` and the set has more than one case.

### Other methods

| Method | Signature | Description |
|---|---|---|
| `evaluate_case` | **async** `(case: EvalCase) -> EvalCaseResult` | Run one case. Useful for per-case pytest assertions. |
| `evaluate_sync` | classmethod `(graph, collector, eval_set, config=None, verbose=False) -> EvalReport` | Blocking wrapper around `evaluate()` via `asyncio.run`. |
| `evaluate_file` | classmethod **async** `(agent_module, eval_file, config_file=None) -> EvalReport` | Import a module exposing `graph` / `compiled_graph` / `agent_graph` / `app` and evaluate it. |

---

## Result types

### `EvalReport`

Returned by `evaluate()`.

| Attribute | Type | Description |
|---|---|---|
| `eval_set_id` | `str` | ID of the evaluated set. |
| `eval_set_name` | `str` | Human-readable name. |
| `results` | `list[EvalCaseResult]` | Individual case results. |
| `summary` | `EvalSummary` | Aggregate statistics. |
| `config_used` | `dict[str, Any]` | Snapshot of the config for provenance. |
| `timestamp` | `float` | When the run finished. |
| `metadata` | `dict[str, Any]` | Free-form. |
| `passed` | property `bool` | `True` when `summary.pass_rate == 1.0`. |
| `failed_cases` | property `list[EvalCaseResult]` | Cases where `passed` is `False`, errors included. |
| `passed_cases` | property `list[EvalCaseResult]` | Cases that passed. |

| Method | Description |
|---|---|
| `get_case_result(eval_id)` | Fetch one case result, or `None`. |
| `format_summary()` | Human-readable multi-line summary string. |
| `to_file(path)` / `EvalReport.from_file(path)` | JSON round-trip. |
| `EvalReport.create(eval_set_id, results, eval_set_name="", config_used=None)` | Build a report and compute its summary. |

The report has no `overall_score` or `pass_rate` attribute of its own. The rate lives on `report.summary.pass_rate`. Full `EvalSummary` fields are documented in [Evaluation harness](/docs/reference/python/evaluation-harness#evalsummary).

### `EvalCaseResult`

| Attribute | Type | Description |
|---|---|---|
| `eval_id` | `str` | The case ID. |
| `name` | `str` | The case name. |
| `passed` | `bool` | `True` when every criterion passed. |
| `criterion_results` | `list[CriterionResult]` | One entry per criterion, in evaluation order. |
| `actual_trajectory` | `list[TrajectoryStep]` | Recorded trajectory. |
| `actual_tool_calls` | `list[ToolCall]` | Recorded tool calls. |
| `actual_response` | `str` | The agent's final response. |
| `messages` | `list[dict[str, Any]]` | Flattened message history. |
| `node_responses` / `node_visits` | `list[...]` | Per-node snapshots and visit order. |
| `duration_seconds` | `float` | Time for this case. |
| `error` | `str \| None` | Set when the run itself failed. |
| `turn_results` | `list[dict[str, Any]]` | Per-turn data for multi-turn cases. |
| `token_usage` / `agent_token_usage` | `TokenUsage` | Total (agent + judges) and agent-only. |
| `node_details` | `list[NodeDetail]` | Per-node LLM input/output and tokens. |

| Member | Description |
|---|---|
| `get_criterion_result(name)` | Fetch one `CriterionResult` by criterion name. |
| `failed_criteria` / `passed_criteria` | Properties filtering `criterion_results`. |
| `is_error` | Property; `True` when `error` is set. |

`criterion_results` is a **list**, not a dict. Use `get_criterion_result(name)` for
lookups by name.

### `CriterionResult`

| Attribute | Type | Description |
|---|---|---|
| `criterion` | `str` | The criterion's `name`. |
| `score` | `float` | Score 0.0-1.0. |
| `passed` | `bool` | `score >= threshold`. |
| `threshold` | `float` | Threshold used. |
| `details` | `dict[str, Any]` | Criterion-specific detail. |
| `error` | `str \| None` | Set when the criterion itself failed. |
| `token_usage` | `TokenUsage` | Judge tokens for this criterion. |
| `reason` | property `str \| None` | Shortcut for `details.get("reason")`. |
| `is_error` | property `bool` | `True` when `error` is set. |

---

## Reporters

Reporters run automatically after `evaluate()` unless disabled. To drive them yourself, use `ReporterManager` (see [Evaluation harness](/docs/reference/python/evaluation-harness#reporting)). The individual reporters are also usable directly:

```python
from tenxgraph.qa.evaluation import (
    ConsoleReporter,
    HTMLReporter,
    JSONReporter,
    JUnitXMLReporter,
    print_report,
)

print_report(report, verbose=False, use_color=True)   # console shortcut
ConsoleReporter(verbose=True).report(report)          # console, full control

JSONReporter(indent=2).save(report, "eval-report.json")
HTMLReporter().save(report, "eval-report.html")
JUnitXMLReporter().save(report, "eval-report_junit.xml")
```

Every reporter implements `BaseReporter.generate(report, output_dir=None)`. The file
reporters additionally offer `save(report, path)` and a string form
(`JSONReporter.to_json`, `HTMLReporter.to_html`, `JUnitXMLReporter.to_xml`).

---

## `DEFAULT_JUDGE_MODEL`

```python
from tenxgraph.qa.evaluation.config.types import DEFAULT_JUDGE_MODEL
# "gemini-2.5-flash"
```

The default LLM for every judge-based criterion. Override per criterion with
`judge_model=` on the relevant `CriterionConfig` factory method.
