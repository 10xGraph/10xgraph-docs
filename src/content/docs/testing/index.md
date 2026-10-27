---
title: Testing and evaluation
seoTitle: "Test and evaluate 10xGraph agents"
description: "Build confidence in agent behavior: unit test graph logic with TestAgent and mocks, then evaluate response quality and tool use with criteria and LLM-as-judge scoring."
section: "Testing and evaluation"
order: 10
label: Overview
updated: "2026-10-27"
faq:
  - q: "When should I unit test vs evaluate?"
    a: "Unit test when you want fast feedback on routing and graph logic with no LLM costs. Evaluate when you need to measure response quality and catch regressions in real behavior. Use both in CI."
  - q: "Can I skip unit tests and just evaluate?"
    a: "Yes, both layers are independent. But unit tests are faster and catch most routing bugs early. Evaluations take longer and cost more."
  - q: "Do evals require a real LLM?"
    a: "By default, yes. But criteria like tool name matching, trajectory comparison, node order, ROUGE and keywords work without an LLM. Note that the default `EvalConfig` includes `response_match`, which does use an LLM judge."
---

Testing in 10xGraph comes in two independent layers, both in the `tenxgraph.qa` package: unit tests that verify graph logic with mocked models, and evaluations that measure real agent behavior against criteria. When you build an agent, you start with unit tests to catch routing mistakes in milliseconds with zero cost. When you ship or iterate, you add evaluations to prove the agent still meets your quality bar and to catch regressions.

This section is for teams that want confidence their agents work correctly, and who want that confidence expressed in code that gates a CI pipeline.

## Quick start

Begin with [unit tests](/docs/testing/unit-tests): they show you `TestAgent`, `QuickTest`, and `MockToolRegistry`, which let you assert the right tool was called with the right arguments without any LLM. Write these first. They are fast (milliseconds per case), cost nothing, and catch most routing mistakes.

Then move to [evaluation](/docs/testing/evaluation) for scored runs against real or staged models. [Eval sets](/docs/testing/eval-sets) define the test cases and expected tool sequences. [Criteria](/docs/testing/criteria) describes what can be scored (tool accuracy, response quality, hallucination, safety, and more). [Presets](/docs/testing/presets) give ready-made criterion configurations to speed up setup. [Reports](/docs/testing/reports) explains the HTML, JSON, and JUnit output formats.

For conversational agents, [user simulation](/docs/testing/user-simulation) lets a model play the user and drives realistic multi-turn interactions. Integration with pytest is in [evals in pytest](/docs/testing/evals-in-pytest), which runs evals as part of your test suite via helpers like `eval_test` and `run_eval`.

Before you launch, follow [Test before production](/docs/testing/before-production): it adds `10xgraph audit`, a startup check in production mode, and curl smoke tests for auth (`401`), thread isolation (`403`) and rate limits (`429`).

Wiring both layers into CI pipelines is covered in [run tests](/docs/testing/run-tests) and [run evaluations](/docs/testing/run-evals).

## Why two layers

Unit testing and evaluation serve different purposes and run at different speeds. The comparison shows where each fits:

| | Unit testing | Evaluation |
|---|---|---|
| **Goal** | Verify graph logic and tool routing | Measure response quality and agent behavior |
| **LLM calls** | None; fully mocked | Yes (required by default) |
| **Speed** | Milliseconds per case | Seconds per case |
| **Entry point** | `TestAgent` in pytest, or `10xgraph test` CLI | `AgentEvaluator` in code, or `10xgraph eval` CLI |
| **Output** | pytest pass/fail with coverage reports | HTML dashboard, JSON, JUnit with criterion scores |
| **Cost** | Free | Charged by LLM provider per case |
| **Best for** | Catch regressions early; gate commits | Gate releases; measure production behavior |

Use both together in CI: quick unit tests first to fail fast, then evaluations as a later stage. Or use one without the other if your needs fit only one layer.

## Unit testing layer

Unit tests verify graph structure and tool routing without making any LLM API calls. The main classes are:

- **`TestAgent`**: A drop-in replacement for the real Agent. Returns predefined responses you give it, records every LLM call, tracks tool names.
- **`QuickTest`**: One-liner helpers for single-turn agent calls, multi-turn conversations, and tool-routing scenarios.
- **`MockToolRegistry`**: Registers mock tool functions and tracks all invocations by name and arguments.
- **`TestContext`**: Helper that sets up an isolated dependency container, in-memory store, and test graph factory.
- **`MockMCPClient`**: Mock MCP client for testing MCP tool integrations without a real server.
- **`TestResult`**: Fluent assertion helpers for the final response, tool calls, and message count.

See [unit tests](/docs/testing/unit-tests) for detailed examples and [run tests](/docs/testing/run-tests) for CLI and CI integration.

## Evaluation layer

Evaluation runs the real agent against test cases and scores results across one or more criteria. Two modes are supported:

**Fixed test cases.** You define the input and expected behavior:

- **`EvalSet` and `EvalSetBuilder`**: Fluent API for defining test cases with expected responses and expected tool sequences (trajectory).
- **`EvalConfig` and `EvalPresets`**: Configuration for which criteria to use and what score thresholds pass a case. `EvalPresets` provides one-line ready-made configurations for common patterns.
- **Criteria**: Built-in criteria cover tool accuracy (tool name and arguments match), response quality (keyword presence, exact match, ROUGE similarity), trajectory (node order and tool sequence), safety, hallucination, factual accuracy, and custom rubrics. LLM-as-judge criteria score anything with a language model.
- **`AgentEvaluator`**: Orchestrates running cases and scoring. Supports sequential and parallel execution.
- **Reports**: HTML dashboard with per-criterion scores, JSON, and JUnit XML for CI systems.

**User simulation.** An LLM plays the user and drives real conversations:

- **`ConversationScenario`**: Define goals and topics; the simulator generates realistic user messages turn by turn.
- **`UserSimulator`**: The LLM-powered user. Stops when goals are achieved or max turns is reached.
- **`SimulationGoalsCriterion`**: Scores the full conversation transcript against your stated goals.

See [evaluation](/docs/testing/evaluation) for a quick start, [criteria](/docs/testing/criteria) for the full criterion reference, and [run evaluations](/docs/testing/run-evals) for CLI and CI integration.

## Reading order

If you are new to testing agents, start here:

1. [Unit tests](/docs/testing/unit-tests): write your first test with `TestAgent`
2. [Run tests](/docs/testing/run-tests): wire unit tests into CI
3. [Evaluation](/docs/testing/evaluation): run your agent against real cases
4. [Eval sets](/docs/testing/eval-sets): define test cases
5. [Criteria](/docs/testing/criteria): understand scoring
6. [Run evaluations](/docs/testing/run-evals): automate evaluations in CI
7. [Test before production](/docs/testing/before-production): gates and smoke tests before launch

Then explore deeper topics like [presets](/docs/testing/presets), [user simulation](/docs/testing/user-simulation), and [evals in pytest](/docs/testing/evals-in-pytest) as your needs grow.

## Related concepts

Pair testing with [Replay-safe tools](/docs/concepts/replay-safe-tools): mock registries are a good way to verify that tools with side effects (like refunds or database deletes) are called only when intended and not replayed unexpectedly. See also [Stream a graph](/docs/guides/stream-graph) for capturing execution in depth.
