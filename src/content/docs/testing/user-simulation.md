---
title: User Simulation
seoTitle: "User simulation for agent testing"
description: "Test agents with the 10xGraph user simulator and goal-driven conversations using get_scenarios(), UserSimulator, BatchSimulator, and SimulationGoalsCriterion."
section: "Testing and evaluation"
group: "Evaluation"
order: 80
label: User Simulation
updated: "2026-10-08"
---

Standard evaluation tests agents with fixed test cases: you define the query and the expected response. User simulation flips this, an LLM **plays the role of a user** and drives a real conversation with your agent, checking whether the agent achieves a set of stated goals. This approach tests multi-turn behavior, handles unpredictable conversation paths, and verifies goals without manually writing each edge case.

User simulation is the right tool when:

- You need to test how the agent handles diverse conversation flows that evolve dynamically
- The correct answer cannot be stated as a single fixed string
- You want to verify multi-turn behavior at scale with realistic dialogue patterns
- You need to test edge cases and variations without writing each one by hand

---

## How it works

User simulation runs a loop:

```
ConversationScenario (goals + starting prompt)
       ↓
UserSimulator (LLM as user, generates messages)
       ↓  ←→  CompiledGraph (your agent)
  Turn loop: check goal achievement per turn
       ↓
SimulationGoalsCriterion scores the full transcript
       ↓
EvalCaseResult → HTML / JSON report
```

The flow in detail:

1. `UserSimulator` starts with `starting_prompt` from the scenario.
2. It sends the message to the agent graph and collects the response.
3. It checks (using an LLM) which goals from the scenario have been achieved at any point in the conversation so far.
4. If all goals are met, the simulation ends with `completed=True`.
5. If not all goals are achieved, it generates the next user message to advance toward remaining goals.
6. This repeats until all goals are achieved or `max_turns` is reached.
7. `SimulationGoalsCriterion` scores the full conversation transcript against the stated goals, producing a 0.0-1.0 score.

Each scenario gets its own `thread_id`, so checkpointer state never bleeds between runs even when simulations run in parallel.

---

## Quick start with the CLI

The simplest path is the `10xgraph eval` CLI. You write the scenarios, the CLI handles running the simulator, scoring, and generating the report, identical to regular eval cases.

Create an eval file with a `get_scenarios()` function:

```python
# evals/user_sim.py
from tenxgraph.qa.evaluation import ConversationScenario, UserSimulatorConfig

# Optional: override the simulator model and config for this file.
# If omitted, the CLI uses UserSimulatorConfig defaults (gemini-2.5-flash, max_invocations=10).
SIMULATOR_CONFIG = UserSimulatorConfig(
    model="gemini/gemini-2.5-flash",
    max_invocations=8,
    temperature=0.7,
)

def get_scenarios() -> list[ConversationScenario]:
    return [
        ConversationScenario(
            scenario_id="weather_travel_planning",
            description="User planning a trip wants weather info and packing advice",
            starting_prompt="Hi! I'm planning a trip to Paris this weekend.",
            conversation_plan=(
                "1. Ask about current weather in Paris\n"
                "2. Ask whether to bring a jacket\n"
                "3. Ask about outdoor sightseeing timing"
            ),
            goals=[
                "User receives weather information for Paris",
                "User gets clothing or packing advice",
                "User learns about outdoor activity timing",
            ],
            max_turns=8,
        ),
        ConversationScenario(
            scenario_id="flight_booking",
            description="User wants help finding a flight from London to New York",
            starting_prompt="I need to fly from London to New York next Friday.",
            goals=[
                "User receives flight options",
                "User gets pricing information",
            ],
            max_turns=10,
        ),
    ]
```

Run it:

```bash
10xgraph eval evals/user_sim.py

# Or together with all other eval files
10xgraph eval --parallel --max-concurrency 4
```

The CLI detects `get_scenarios()` (or a `SCENARIOS` module-level constant), runs each scenario with a `SimulationGoalsCriterion` attached automatically (threshold 0.7, one judge sample), and produces the same HTML + JSON report as regular eval cases. Simulation scenarios and regular eval cases are pooled together in the same report. While a scenario runs, the CLI prints a muted line per step (each simulated user message, the agent reply, newly achieved goals, and the criteria being judged), and the result line shows the real duration. `-q` hides these lines.

For full details on CLI flags, parallel execution, and integration into CI, see [How to run evaluations](/docs/testing/run-evals).

---

## ConversationScenario

A scenario defines what the user is trying to achieve and how the conversation should unfold:

```python
from tenxgraph.qa.evaluation import ConversationScenario

scenario = ConversationScenario(
    scenario_id="travel_planning",
    description="User wants to plan a weekend trip and needs weather and flight info.",
    starting_prompt="I'm thinking of going somewhere warm this weekend.",
    conversation_plan=(
        "1. Ask about weather in potential destinations\n"
        "2. Narrow down to one destination\n"
        "3. Ask about flight options\n"
        "4. Confirm the plan"
    ),
    goals=[
        "Get weather info for at least one destination",
        "Receive flight or travel suggestions",
        "Have a concrete travel plan by end of conversation",
    ],
    max_turns=8,
)
```

| Field | Type | Description |
|---|---|---|
| `scenario_id` | `str` | Unique identifier used in results and reports |
| `description` | `str` | What the user is trying to accomplish |
| `starting_prompt` | `str` | First message sent to the agent; if empty, the LLM generates one |
| `conversation_plan` | `str` | High-level flow description fed to the simulator LLM to guide natural progression |
| `goals` | `list[str]` | What must be achieved for the simulation to count as complete |
| `max_turns` | `int` | Hard cap on conversation turns (default: 10) |
| `metadata` | `dict` | Arbitrary metadata passed through to results |

**Writing effective goals:**
- Be specific: `"User gets the weather temperature for London"` rather than `"User learns about weather"`
- One idea per goal, the LLM judge checks each independently
- Goals must be verifiable from the conversation transcript alone, not from external state

---

## UserSimulator

`UserSimulator` is the core class for programmatic simulation. It generates user messages, runs the agent, checks goal achievement, and optionally scores the result with evaluation criteria.

```python
from tenxgraph.qa.evaluation import UserSimulator, UserSimulatorConfig

simulator = UserSimulator(
    model="gemini/gemini-2.5-flash",
    temperature=0.7,
    max_turns=10,
)

result = await simulator.run(graph, scenario)
```

### Constructor parameters

| Parameter | Default | Description |
|---|---|---|
| `model` | `gemini/gemini-2.5-flash` | LLM used to generate user messages and check goal achievement |
| `temperature` | `0.7` | Generation temperature, higher values produce more varied user messages |
| `max_turns` | `10` | Default turn limit (overridden by `scenario.max_turns`) |
| `config` | `None` | Pass a `UserSimulatorConfig` instead of individual parameters. When given, overrides `model`, `temperature`, and `max_turns` (from `max_invocations`) |
| `criteria` | `[]` | List of `BaseCriterion` to run against the completed conversation |
| `api_style` | `"responses"` | OpenAI API style. Use `"chat"` for models that only support the legacy Chat Completions endpoint |

### Model support

The provider is inferred from the model name:

| Model string | Provider |
|---|---|
| `gemini/gemini-2.5-flash` | Google GenAI |
| `gemini-2.5-flash` | Google GenAI |
| `gpt-4o` | OpenAI |
| `gpt-4o-mini` | OpenAI |
| `claude-opus-5` | Anthropic |
| `anthropic/claude-sonnet-5` | Anthropic |

There is no cross-provider fallback, one model name binds to one provider. If an LLM call fails or returns nothing, the simulator substitutes a neutral message (`"I have a follow-up question."`) and continues, so a misconfigured API key appears as a bland transcript rather than an exception.

### Using UserSimulatorConfig

Pass a config object to override multiple settings at once:

```python
from tenxgraph.qa.evaluation import UserSimulatorConfig, UserSimulator

config = UserSimulatorConfig(
    model="gemini/gemini-2.5-flash",
    max_invocations=12,
    temperature=0.5,
    thinking_enabled=False,
)

simulator = UserSimulator(config=config)
```

| Field | Default | Description |
|---|---|---|
| `model` | `gemini-2.5-flash` | Simulator LLM |
| `max_invocations` | `10` | Maximum conversation turns |
| `temperature` | `0.7` | Generation temperature |
| `thinking_enabled` | `False` | Enable reasoning/thinking mode if the model supports it |
| `thinking_budget` | `10240` | Token budget for thinking when enabled |
| `api_style` | `"responses"` | OpenAI API style; use `"chat"` for legacy Chat Completions |

---

## SimulationResult

`simulator.run()` returns a `SimulationResult` with the full conversation and scores:

```python
result = await simulator.run(graph, scenario)

print(result.completed)           # True if all goals achieved before max_turns
print(result.turns)               # Number of conversation turns that ran
print(result.goals_achieved)      # List of goal strings that were met
print(result.error)               # None if successful, else error message

# Full conversation transcript
for turn in result.conversation:
    print(f"{turn['role'].upper()}: {turn['content']}")

# Criterion scores (if criteria were passed to UserSimulator)
print(result.criterion_scores)    # {"simulation_goals": 0.8}
print(result.criterion_details)   # {"simulation_goals": {"achieved_goals": [...], ...}}
```

| Attribute | Type | Description |
|---|---|---|
| `scenario_id` | `str` | From the scenario |
| `turns` | `int` | Number of turns that ran |
| `conversation` | `list[dict]` | Full history: `[{"role": "user"/"assistant", "content": "..."}]` |
| `goals_achieved` | `list[str]` | Goals confirmed achieved by the LLM goal-checker |
| `completed` | `bool` | `True` when all goals achieved before `max_turns` |
| `error` | `str \| None` | Error message if simulation failed mid-way |
| `criterion_scores` | `dict[str, float]` | Score per criterion (0.0-1.0) |
| `criterion_details` | `dict[str, Any]` | Full criterion output including reasoning and details |
| `criterion_results` | `list[CriterionResult]` | Full result objects with per-criterion token usage |
| `simulator_token_usage` | `TokenUsage` | Tokens consumed by simulator LLM calls (user-turn generation and goal checks) |

---

## SimulationGoalsCriterion

`SimulationGoalsCriterion` is a specialized LLM-judge criterion for `UserSimulator`. It receives the **full conversation transcript** and checks whether each goal was addressed at any point, not just in the final message.

The CLI attaches this criterion automatically when it detects `get_scenarios()`. For programmatic use:

```python
from tenxgraph.qa.evaluation import (
    SimulationGoalsCriterion,
    CriterionConfig,
    UserSimulator,
)

judge = SimulationGoalsCriterion(
    config=CriterionConfig(
        threshold=0.7,
        judge_model="gemini-2.5-flash",
    )
)

simulator = UserSimulator(
    model="gemini/gemini-2.5-flash",
    criteria=[judge],
)

result = await simulator.run(graph, scenario)
# result.criterion_scores["simulation_goals"] → 0.67 (2 of 3 goals met)
```

**Score calculation:** `achieved_goals / total_goals` (0.0-1.0). The criterion makes a single judge call regardless of `num_samples`.

The criterion details include:
- `achieved_goals`: list of goals confirmed as addressed in the transcript
- `unachieved_goals`: list of goals not found
- `reasoning`: the judge's explanation covering each goal

> **Important:** `SimulationGoalsCriterion` is designed **exclusively for `UserSimulator`**. Do not add it to a regular `EvalConfig` with `AgentEvaluator`, in the standard flow, `actual_response` contains only the agent's final response, not the full multi-turn transcript, so the goal check would not see prior turns.

---

## BatchSimulator

Run multiple scenarios concurrently with `BatchSimulator`. Manage concurrency, gather summary statistics, and access results by index:

```python
from tenxgraph.qa.evaluation import (
    BatchSimulator,
    ConversationScenario,
    SimulationGoalsCriterion,
    CriterionConfig,
    UserSimulator,
)

judge = SimulationGoalsCriterion(config=CriterionConfig(threshold=0.7))
simulator = UserSimulator(model="gemini/gemini-2.5-flash", criteria=[judge])

batch = BatchSimulator(simulator=simulator, max_concurrency=5)

results = await batch.run_batch(graph, [scenario_a, scenario_b, scenario_c])

summary = batch.summary(results)
print(f"Completion rate: {summary['completion_rate']:.0%}")
print(f"Average turns: {summary['average_turns']:.1f}")
print(f"Errors: {summary['errors']}")
```

### BatchSimulator parameters

| Parameter | Default | Description |
|---|---|---|
| `simulator` | auto-created | Pre-configured `UserSimulator`; pass your own to include criteria |
| `max_concurrency` | `5` | Maximum scenarios running in parallel |
| `**kwargs` | - | Forwarded to `UserSimulator` if no `simulator` is given |

### Batch summary fields

| Field | Description |
|---|---|
| `total_scenarios` | Total number of scenarios run |
| `completed` | Number of scenarios where all goals were achieved |
| `completion_rate` | `completed / total_scenarios` |
| `total_goals_achieved` | Sum of goals achieved across all scenarios |
| `average_turns` | Mean turns per scenario |
| `errors` | Number of scenarios that errored |

---

## Complete programmatic example

This example creates a batch of scenarios, runs them with a goal-checking criterion, and prints summary statistics:

```python
import asyncio
from tenxgraph.qa.evaluation import (
    BatchSimulator,
    ConversationScenario,
    CriterionConfig,
    SimulationGoalsCriterion,
    UserSimulator,
)
from graph.agent import app   # your compiled graph

async def run_simulation():
    # Set up the goal-checking criterion
    judge = SimulationGoalsCriterion(
        config=CriterionConfig(threshold=0.7, judge_model="gemini-2.5-flash")
    )
    
    # Create the simulator with the criterion
    simulator = UserSimulator(
        model="gemini/gemini-2.5-flash",
        temperature=0.6,
        criteria=[judge],
    )
    
    # Batch runner for concurrency
    batch = BatchSimulator(simulator=simulator, max_concurrency=3)

    # Define two scenarios
    scenarios = [
        ConversationScenario(
            scenario_id="customer_refund",
            description="Customer wants to initiate a refund for a damaged item.",
            starting_prompt="I received a damaged item and want a refund.",
            conversation_plan=(
                "1. Explain the damage\n"
                "2. Provide order details when asked\n"
                "3. Confirm refund is processed"
            ),
            goals=[
                "Agent acknowledges the damage",
                "Agent initiates or confirms a refund",
                "Customer has a clear resolution",
            ],
            max_turns=8,
        ),
        ConversationScenario(
            scenario_id="product_recommendation",
            description="Customer wants a laptop recommendation for video editing.",
            starting_prompt="I need a laptop for professional video editing.",
            goals=[
                "Agent asks about budget or requirements",
                "Agent recommends at least one specific product",
                "Recommendation includes RAM or GPU specs",
            ],
            max_turns=6,
        ),
    ]

    # Run all scenarios
    results = await batch.run_batch(app, scenarios)

    # Print per-scenario results
    for result, scenario in zip(results, scenarios):
        status = "PASS" if result.completed else "FAIL"
        n_goals = len(scenario.goals)
        n_achieved = len(result.goals_achieved)
        print(f"{result.scenario_id}: {status} | {result.turns} turns | {n_achieved}/{n_goals} goals")

        # Print criterion details if available
        sim_score = result.criterion_scores.get("simulation_goals")
        if sim_score is not None:
            print(f"  SimulationGoals score: {sim_score:.2f}")
            details = result.criterion_details.get("simulation_goals", {})
            print(f"  Achieved: {details.get('achieved_goals', [])}")
            print(f"  Missing:  {details.get('unachieved_goals', [])}")

    # Print summary statistics
    summary = batch.summary(results)
    print(f"\nCompletion rate: {summary['completion_rate']:.0%}")
    print(f"Average turns: {summary['average_turns']:.1f}")

asyncio.run(run_simulation())
```

---

## Simulation vs standard evaluation

| | Standard eval (`EvalSet`) | User simulation |
|---|---|---|
| Input | Fixed query string | LLM-generated messages that evolve |
| Expected output | Defined explicitly in the test case | Inferred from stated goals |
| Turn count | Single turn (or explicit multi-turn) | Dynamic, up to `max_turns` |
| Best for | Regression testing known inputs | Open-ended dialogue and goal achievement |
| CLI protocol | `get_eval_set()` | `get_scenarios()` |
| Scoring | Per-criterion scores | Goal achievement rate (0.0-1.0) |

Run both in CI to get full coverage:

```bash
# All evals and simulations in one run
10xgraph eval --parallel --max-concurrency 8
```

---

## Next steps

- [How to run evaluations](/docs/testing/run-evals): full CLI reference including `get_scenarios()` protocol and CI integration
- [Criteria reference](/docs/testing/criteria): understand `SimulationGoalsCriterion` alongside other evaluation criteria
- [Eval sets](/docs/testing/eval-sets): fixed test cases for regression testing
- [Reports](/docs/testing/reports): how to read and interpret eval results
