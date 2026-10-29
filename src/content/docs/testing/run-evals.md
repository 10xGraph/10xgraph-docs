---
title: Run Evaluations
seoTitle: "Run agent evaluations from the CLI"
description: "Run agent evaluations with 10xgraph eval: covers parallel execution, eval file protocols, EvalPresets, and CI integration."
section: "Testing and evaluation"
group: "Evaluation"
order: 100
label: Run Evaluations
updated: "2026-10-08"
---

## What is evaluation and why it matters

Evaluation is the measurement of your agent's behavior against criteria that matter to your application. The `10xgraph eval` command discovers evaluation files in your project, runs all test cases in a single async event loop, and produces machine-readable reports so you can track agent quality over time, gate merges on minimum pass rates, and identify regressions before they reach production.

Unlike unit tests (which verify isolated functions), evaluations score your entire agent graph end-to-end against realistic scenarios, criteria like correct tool usage or response accuracy, and can include LLM-based judges to assess semantic quality. Cases run sequentially unless you pass `--parallel`. The command generates both HTML dashboards and JSON results for CI tooling, and supports everything from quick local checks to comprehensive test suites with custom scoring rules.

## Prerequisites

Your project must have been initialized with `10xgraph init`. The standard project layout includes an `evals/` directory where evaluation files live. When you choose the **Production** setup during initialization, the directory structure and a sample evaluation file are generated for you.

If you created a project without the Production setup, create an `evals/` directory manually at the project root, next to `10xgraph.json`.

## Quick start

From the folder that contains `10xgraph.json`:

```bash
10xgraph eval
```

The CLI scans `evals/` for files matching `*_eval.py` or `eval_*.py`, collects every case from every file into a single pool, runs them all, and writes timestamped JSON and HTML reports to `eval_reports/`:

```
eval_reports/
  <eval-set-id>_20260513_142301.json
```

`EvalSetBuilder` assigns a random UUID as the eval set id, so that is what appears in the file name for a single set. When a run covers more than one eval set, the results are merged into one report named `combined_eval_<timestamp>`.

The JSON report is machine-readable for CI systems or custom analysis. After the run the command prints the HTML and JSON paths and opens the HTML report in your default browser. Pass `--no-open` to skip that; it is also skipped with `--no-report`, `-q`, `--format json` or `jsonl`, `--non-interactive`, when `CI` is set, and when stdout is not a terminal. The playground Evals page shows the summary pass rate, criterion scores, and per-case results, and can download a Markdown report. A progress display updates as cases complete.

## Running evaluations

### Run a specific file or directory

To evaluate only certain cases, pass a path:

```bash
# One file
10xgraph eval evals/weather_eval.py

# All files in a subdirectory
10xgraph eval evals/regression/
```

When a file is given, only that file runs. When a directory is given, all matching `*_eval.py` and `eval_*.py` files are discovered recursively. Results from several eval sets are merged into one combined report.

### Run in parallel

By default all cases run sequentially. For faster feedback on large suites, use `--parallel`:

```bash
10xgraph eval --parallel
10xgraph eval --parallel --max-concurrency 8
```

**How it works:** All cases from all files are collected into a flat pool before execution starts. A single asyncio event loop runs the entire pool under a concurrency semaphore capped at `--max-concurrency` (default 4). Cases complete out of order as they finish; this is expected and intentional.

The run ends with a summary line such as:

```
Results: 47/50 passed (94.0%)
```

You can enable parallel by default in `10xgraph.json` (see [Configure evaluation defaults](#configure-evaluation-defaults-in-10xgraphjson)).

### Reports and output

Every run produces one JSON file and one HTML file in `eval_reports/` (or a custom directory via `--output`):

| File | Format | Purpose |
| --- | --- | --- |
| `<eval-id>_<timestamp>.json` | JSON | Machine-readable results for CI tooling, dashboards, or programmatic analysis. Open it in the playground Evals page for review |

The progress display shows each case as `<file>::<case>` with its status and duration. The report file is written after all cases finish. To skip writing files and see only console output:

```bash
10xgraph eval --no-report
```

The HTML report opens automatically. To review the JSON report instead, open the playground, go to Evals, and choose Open report file (or drag the JSON file onto the page). Nothing is served by the API, so no server is needed for viewing. The page can also download a Markdown report.

### Exit codes and thresholds

The command exits with code 0 only when every case passes (100% pass rate) and 1 otherwise. For CI this already gates merges on any regression.

```bash
10xgraph eval --threshold 0.8
```

`--threshold` makes the command print an error ("Pass rate ... is below threshold ...") when the overall pass rate is under 80%. It does not relax the exit code: a run at 90% still exits 1. The threshold can also be set in `10xgraph.json` (see below).

### Custom output directory

```bash
10xgraph eval --output ci/reports
```

Reports are written to `ci/reports/` instead of the default `eval_reports/`.

## Configure evaluation defaults in 10xgraph.json

Add an `evaluation` block to `10xgraph.json` to set project-level defaults. CLI flags always take precedence over these settings.

```json
{
  "agent": "graph.agent:app",
  "evaluation": {
    "directory": "evals",
    "output_dir": "eval_reports",
    "threshold": 0.75,
    "parallel": false,
    "max_concurrency": 4
  }
}
```

| Field | Default | Description |
| --- | --- | --- |
| `directory` | `"evals"` | Directory scanned when no `TARGET` argument is given |
| `output_dir` | `"eval_reports"` | Directory where the JSON and HTML reports are written |
| `threshold` | (none) | Pass rate below which an error message is printed; the exit code is 1 for any pass rate under 100% |
| `parallel` | `false` | Run all cases concurrently instead of sequentially |
| `max_concurrency` | `4` | Maximum cases running simultaneously when `parallel` is true |
| `open_report` | `true` | Open the HTML report in the browser when the run ends; `--open` / `--no-open` overrides it |

Report filenames always include a timestamp; there is no configuration setting for it.

### Enforce minimum quality in CI

```yaml
# .github/workflows/ci.yml
- name: Run evaluations
  run: 10xgraph eval --parallel
```

The step fails (exit code 1) whenever any case fails, which gates the merge.

## How criteria work and what the defaults are

Every evaluation case is scored against one or more criteria. A criterion is a rule that produces a pass/fail or a numeric score. The CLI applies default criteria when none are specified; you can override them per-file, globally, or use preset configurations.

### Default criteria (applied when no config is specified)

When an eval file has no `get_eval_config()` or `EVAL_CONFIG`, and no `confeval.py` is found, these built-in defaults apply:

| Criterion | Threshold | Purpose |
| --- | --- | --- |
| `tool_name_match` | 1.0 | Agent must call the correct tool (exact match required) |
| `rouge_match` | 0.5 | Agent response must have at least 50% token overlap with expected response (fast, no LLM) |
| `node_order` | 0.8 | Agent must visit graph nodes in the expected order (score of at least 0.8) |

These defaults are intentionally strict on tool correctness (1.0) but lenient on response content (0.5 ROUGE), because the order of tool calls often matters more than exact text matching. For applications where response wording must match precisely, you would override with stricter criteria.

## Eval file protocols

An eval file is any module matching `*_eval.py` or `eval_*.py`. The CLI auto-detects which protocol you are using. Each protocol suits different evaluation needs.

### `get_eval_set()`, standard fixed cases

The simplest protocol: define your test cases once, the CLI runs them repeatedly. You only provide the cases; the CLI loads the agent from `10xgraph.json`, applies criteria, and produces results.

```python
# evals/weather_eval.py
from tenxgraph.qa.evaluation import EvalSet, EvalSetBuilder

def get_eval_set() -> EvalSet:
    return (
        EvalSetBuilder(name="weather-regression")
        .add_tool_test(
            query="What is the weather in London?",
            tool_name="get_weather",
            tool_args={"location": "London"},
            expected_response="London",
            case_id="london_forecast",
        )
        .add_tool_test(
            query="What is the weather in Tokyo?",
            tool_name="get_weather",
            tool_args={"location": "Tokyo"},
            expected_response="Tokyo",
            case_id="tokyo_forecast",
        )
        .build()
    )
```

**When to use:** Regression suites with fixed inputs and known good outputs. Best for deterministic behavior like tool selection, API behavior, or structured data extraction.

### `get_eval_config()` or `EVAL_CONFIG`, per-file criteria

Override the criteria and thresholds for a specific file. The recommended approach is to use one of the preset configurations, which cover common patterns:

```python
from tenxgraph.qa.evaluation import EvalConfig, EvalSet, EvalSetBuilder
from tenxgraph.qa.evaluation.config.presets import EvalPresets

def get_eval_config() -> EvalConfig:
    return EvalPresets.tool_usage(threshold=0.6)

def get_eval_set() -> EvalSet:
    return (
        EvalSetBuilder(name="weather-regression")
        .add_tool_test(...)
        .build()
    )
```

Or as a constant instead of a function:

```python
from tenxgraph.qa.evaluation.config.presets import EvalPresets

EVAL_CONFIG = EvalPresets.tool_usage(threshold=0.6)
```

### Available EvalPresets

| Preset | Default threshold | What it checks |
| --- | --- | --- |
| `response_quality(threshold, use_llm_judge=True)` | 0.7 | LLM response match plus LLM judge on response quality |
| `tool_usage(threshold, strict=True, check_args=True)` | 1.0 | Tool name match plus trajectory match (exact order by default, arguments checked) |
| `conversation_flow(threshold)` | 0.8 | LLM response match plus in-order tool trajectory |
| `quick_check()` | 0.5 (fixed) | Fast ROUGE token overlap, no LLM cost, instant feedback |
| `comprehensive(threshold, use_llm_judge=True)` | 0.8 | Tool name match and trajectory (fixed 1.0), ROUGE, plus LLM judge, factual accuracy, hallucination and safety |
| `safety_check(threshold)` | 0.8 | Hallucination and safety criteria via LLM judge |

Presets that use an LLM judge accept an optional `judge_model` parameter (defaults to `"gemini-2.5-flash"`; `tool_usage` and `quick_check` use no judge):

```python
config = EvalPresets.response_quality(threshold=0.7, judge_model="gpt-4o")
```

You can combine multiple presets:

```python
from tenxgraph.qa.evaluation.config.presets import EvalPresets

def get_eval_config():
    return EvalPresets.combine(
        EvalPresets.tool_usage(threshold=0.7),
        EvalPresets.response_quality(threshold=0.6),
    )
```

### `confeval.py`, global evaluation config

Place a file named exactly `confeval.py` in your `evals/` directory (or the project root) to set a global default `EvalConfig` that applies to every eval file that does not define its own `get_eval_config()` or `EVAL_CONFIG`. If a file does provide its own config, that takes precedence.

The file must expose either a module-level `EVAL_CONFIG` variable or a callable `get_eval_config()` that returns an `EvalConfig`:

```python
# evals/confeval.py
from tenxgraph.qa.evaluation import CriteriaConfig, CriterionConfig, EvalConfig

EVAL_CONFIG = EvalConfig(
    criteria=CriteriaConfig(
        tool_name_match=CriterionConfig.tool_name_match(threshold=1.0),
        rouge_match=CriterionConfig.rouge_match(threshold=0.5),
        node_order=CriterionConfig.node_order(threshold=0.8),
    )
)
```

Or as a function:

```python
# confeval.py
from tenxgraph.qa.evaluation import CriteriaConfig, CriterionConfig, EvalConfig

def get_eval_config() -> EvalConfig:
    return EvalConfig(
        criteria=CriteriaConfig(
            tool_name_match=CriterionConfig.tool_name_match(threshold=1.0),
            rouge_match=CriterionConfig.rouge_match(threshold=0.5),
        )
    )
```

This is useful for enforcing consistent evaluation standards across many eval files without repeating the config in each one.

### Annotated functions `-> EvalSet`, multiple eval sets per file

Any module-level function with return type annotation `-> EvalSet` is auto-discovered as an eval set. This lets you organize multiple related eval sets in one file:

```python
from tenxgraph.qa.evaluation import EvalSet, EvalSetBuilder
from tenxgraph.qa.evaluation.config.presets import EvalPresets

def get_eval_config():
    return EvalPresets.tool_usage(threshold=0.6)

def weather_cases() -> EvalSet:
    return EvalSetBuilder(name="weather").add_tool_test(...).build()

def booking_cases() -> EvalSet:
    return EvalSetBuilder(name="booking").add_tool_test(...).build()
```

Both `weather_cases` and `booking_cases` are discovered and run, and their cases are merged into the report. A file that has `get_eval_set()` uses that instead of annotation discovery. A function annotated `-> EvalConfig` is also picked up as the file's config.

### `get_scenarios()` or `SCENARIOS`, user simulator (dynamic conversations)

Use this protocol when you want the LLM to drive a multi-turn conversation against your agent, rather than using fixed prompt/response pairs. The simulator generates contextual follow-up messages after each agent response, letting you test realistic conversation flows.

You define the scenarios; the CLI handles running the simulator, scoring goal achievement, and writing results:

```python
# evals/simulator_eval.py
from tenxgraph.qa.evaluation import ConversationScenario, UserSimulatorConfig

# Optional: configure simulator model and settings for this file.
# If omitted, defaults are used (gemini-2.5-flash, max 10 invocations, temperature 0.7).
SIMULATOR_CONFIG = UserSimulatorConfig(
    model="gemini/gemini-2.5-flash",
    max_invocations=8,
    temperature=0.7,
)

def get_scenarios() -> list[ConversationScenario]:
    return [
        ConversationScenario(
            scenario_id="weather_travel",
            description="User planning a trip wants weather and packing advice",
            starting_prompt="Hi! I'm planning a trip to Paris this weekend.",
            conversation_plan=(
                "1. Ask about current weather in Paris\n"
                "2. Ask whether to bring a jacket\n"
                "3. Ask about outdoor activity timing"
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
            description="User wants help finding a flight",
            starting_prompt="I need to fly from London to New York next Friday.",
            goals=[
                "User receives flight options",
                "User gets pricing information",
            ],
            max_turns=10,
        ),
    ]
```

**How it works:**

1. The CLI detects `get_scenarios()` or a `SCENARIOS` constant and switches to simulator mode.
2. Each `ConversationScenario` becomes one eval case.
3. The simulator drives up to `max_turns` turns, generating contextual user messages after each agent response.
4. An LLM judge scores how many of the stated `goals` were achieved across the conversation.
5. Pass/fail and results appear in the report like regular eval cases.

**`ConversationScenario` fields:**

| Field | Required | Description |
| --- | --- | --- |
| `scenario_id` | Yes | Unique ID for the scenario (appears in reports) |
| `description` | No | Human-readable name shown in the report |
| `starting_prompt` | Yes | First user message to start the conversation |
| `conversation_plan` | No | Hints to the simulator about how to progress |
| `goals` | Yes | List of outcomes the user wants to achieve (scored by LLM judge) |
| `max_turns` | No | Maximum conversation turns (default: 10) |

**`SIMULATOR_CONFIG` fields:**

| Field | Default | Description |
| --- | --- | --- |
| `model` | `"gemini-2.5-flash"` | LLM used to generate user messages |
| `max_invocations` | `10` | Maximum turns per scenario |
| `temperature` | `0.7` | Temperature for user message generation |

**When to use:** Multi-turn conversations where the exact dialogue matters. Useful for customer support agents, question-answering over sessions, or any scenario where realistic back-and-forth is important.

## Config priority and precedence

When the same setting is configured in multiple places, this precedence applies (highest first):

```
Run settings (parallel, max concurrency, threshold, output directory):
1. CLI flags
2. 10xgraph.json "evaluation" section
3. Built-in defaults

Criteria (the 10xgraph.json "evaluation" section holds no criteria):
1. Per-file config   get_eval_config() / EVAL_CONFIG inside the eval file
2. confeval.py       get_eval_config() / EVAL_CONFIG (global fallback)
3. Built-in defaults (tool_name_match 1.0, rouge_match 0.5, node_order 0.8)
```

A CLI flag overrides `10xgraph.json` for run settings. For criteria, the eval file wins over `confeval.py`, which wins over the built-in defaults.

## Common scenarios and recipes

**Fast local check on a single file:**

```bash
10xgraph eval evals/weather_eval.py
```

Run one file sequentially, and write the JSON report; open it in the playground Evals page for inspection.

**Parallel run with 8 concurrent cases:**

```bash
10xgraph eval --parallel --max-concurrency 8
```

All cases run concurrently (up to 8 at a time) for faster feedback on large suites.

**Strict CI gate at 80% pass rate:**

In `10xgraph.json`:

```json
{
  "evaluation": {
    "threshold": 0.8,
    "parallel": true,
    "max_concurrency": 8
  }
}
```

Then in your CI:

```bash
10xgraph eval
```

The command prints an error when the pass rate is below 80% and exits with code 1 (it also exits 1 for any pass rate under 100%).

**Run only a regression suite in a subdirectory:**

```bash
10xgraph eval evals/regression/ --output reports/regression
```

All eval files under `evals/regression/` run, reports go to `reports/regression/`.

**Mix regular eval cases and user simulator in one run:**

```
evals/
  weather_eval.py        ← get_eval_set() protocol
  user_simulator_eval.py ← get_scenarios() protocol
```

```bash
10xgraph eval --parallel
```

Both files are discovered. Cases and scenarios are collected into the same flat pool and run concurrently. Results appear in a single merged report.

## Troubleshooting

**"Eval directory 'evals/' not found"**

The CLI cannot find your evaluation directory. Either:
- Create an `evals/` directory at the project root
- Pass the correct path: `10xgraph eval path/to/evals`
- Run `10xgraph init` and choose the Production setup to scaffold the standard layout

**"No eval cases found"**

Eval files were discovered but contained no test cases. Ensure:
- At least one file exposes `get_eval_set()`, `get_scenarios()`, `SCENARIOS`, or a function annotated `-> EvalSet`
- Files match `*_eval.py` or `eval_*.py` (rename if needed, or pass the file explicitly)

**"File skipped with warning"**

A file was found but does not expose any recognized entry point. Add `get_eval_set()` or `get_scenarios()` to the file.

**Exit code 1 although most cases pass**

The exit code is 1 whenever the pass rate is below 100%, including cases that errored. Check the summary line and the report in the playground Evals page for cases with status `error`.

**Simulator scenarios always fail**

Ensure:
- The agent is reachable (either `app` is exported in the eval file, or `"agent"` is set in `10xgraph.json`)
- Goals are specific enough for the LLM judge to verify. Vague goals like "have a conversation" will not score well
- `max_turns` is large enough for the agent to satisfy all goals (increase if needed)

**Different results on different runs**

Simulator scenarios and LLM-based criteria include randomness (temperature > 0). Exact reproducibility is not guaranteed. For deterministic evaluation, use `quick_check()` or fixed `get_eval_set()` cases only.
