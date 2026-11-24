---
title: Evaluation Presets and Configuration
description: "Ready-made evaluation presets for common scenarios and how to build custom EvalConfig for specific needs."
section: "Testing and evaluation"
group: "Evaluation"
order: 70
label: Presets & Config
updated: "2026-10-08"
---

`EvalConfig` is the central configuration object that determines which criteria run and at what thresholds. `EvalPresets` provides factory methods to create ready-made `EvalConfig` objects for common scenarios, saving you from building configurations from scratch. Most teams start with a preset and customize it as their eval suite matures.

This page covers when to use each preset, how to combine them, and how to build fully custom configurations when the presets do not fit your needs.

## Quick decisions

If you are evaluating:

- **A tool-calling agent** (search, database, API calls): start with `EvalPresets.tool_usage()`
- **A Q&A or FAQ agent**: start with `EvalPresets.response_quality()`
- **A multi-turn dialogue agent**: start with `EvalPresets.conversation_flow()`
- **Before shipping to production**: use `EvalPresets.comprehensive()`
- **During active development** (no LLM cost): use `EvalPresets.quick_check()`

## EvalPresets factory methods

All `EvalPresets` methods are class methods that return an `EvalConfig` instance. Every preset that uses an LLM accepts an optional `judge_model` parameter (defaults to `"gemini-2.5-flash"`).

### quick_check, Fastest, no cost

Evaluates response text using ROUGE-1 token overlap. No LLM API calls, instant results. Ideal for smoke tests during active development and continuous integration pipelines where latency matters.

```python
from tenxgraph.qa.evaluation import AgentEvaluator, EvalPresets

config = EvalPresets.quick_check()

# The config is passed to AgentEvaluator, which then runs the eval set
evaluator = AgentEvaluator(graph, collector, config=config)
report = await evaluator.evaluate(eval_set)
```

**Includes:**
- `rouge_match` (threshold 0.5): token-level overlap between agent response and expected response

**Limitations:** ROUGE measures word overlap, not semantic correctness. It will miss cases where the agent says the right thing in different words.

---

### tool_usage, Verify tool correctness

Ensures the agent calls the right tools in the right order with correct arguments. No LLM required; this is the fastest semantic check. Ideal for agents with deterministic tool requirements.

```python
config = EvalPresets.tool_usage(
    threshold=1.0,          # All tools must match (1.0 = 100%)
    strict=True,            # Require exact tool sequence (False = in-order)
    check_args=True,        # Validate tool arguments
)
```

**Parameters:**
- `threshold`: Score for trajectory and tool name matching (0.0-1.0)
- `strict`: If `True`, requires exact tool sequence match (EXACT). If `False`, allows extra tools as long as required tools appear in order (IN_ORDER)
- `check_args`: If `True`, compares tool arguments; if `False`, only checks tool names

**Includes:**
- `tool_name_match`: Agent calls the required tools
- `trajectory`: Tools are called in the correct sequence with correct arguments

**When to use:** Any agent with deterministic tool requirements (weather lookups, database queries, API calls). This is the most common first-pass eval for tool-calling agents.

**Example:** If your expected run calls `[search, summarize]` and the agent called `[search, search, summarize]`, then `strict=False` passes, but `strict=True` fails.

---

### response_quality, Check semantic accuracy

Uses an LLM judge to evaluate whether the agent's response is semantically correct and relevant, independent of exact wording. Ideal for Q&A, FAQ, and retrieval agents where responses have legitimate variation.

```python
config = EvalPresets.response_quality(
    threshold=0.7,          # Minimum score to pass
    use_llm_judge=True,     # Add LLM-as-judge criterion
    judge_model="gemini-2.5-flash",
)
```

**Parameters:**
- `threshold`: Minimum score (0.0-1.0) for passing
- `use_llm_judge`: If `True`, adds an extra LLM-based evaluation as a secondary check
- `judge_model`: Which LLM to use as judge (defaults to Gemini 2.5 Flash)

**Includes:**
- `response_match`: LLM evaluates whether the agent's response is semantically correct
- `llm_judge` (optional): A secondary LLM evaluation as corroboration (1 sample by default)

**When to use:** Q&A systems, FAQ bots, summarization agents, or any scenario where the agent's answer matters more than exact wording.

**Example:** For a Q&A agent answering "What is the capital of France?", both "Paris" and "The capital of France is Paris" count as correct, even though the text differs.

---

### conversation_flow, Multi-turn dialogue validation

Validates both response quality and tool sequencing in conversation scenarios where the agent must maintain context across multiple turns and call tools in a logical sequence.

```python
config = EvalPresets.conversation_flow(
    threshold=0.8,
    judge_model="gemini-2.5-flash",
)
```

**Parameters:**
- `threshold`: Minimum score to pass
- `judge_model`: LLM model for semantic evaluation

**Includes:**
- `response_match`: Each response is semantically correct in context
- `trajectory`: Tools are called in-order (allows extra tools, not just exact sequence)

**When to use:** Customer support agents, assistant agents, or any multi-turn dialogue where the agent must maintain coherence and follow a logical flow.

**Example:** A customer support agent should answer clarifying questions before making a decision, not jump to a solution immediately.

---

### safety_check, Production safety gate

Focuses on what the agent outputs, not whether it answers correctly. Detects hallucinations, unsafe content, and guardrail violations. Essential before shipping to production.

```python
config = EvalPresets.safety_check(
    threshold=0.8,
    judge_model="gemini-2.5-flash",
)
```

**Parameters:**
- `threshold`: Minimum score to pass
- `judge_model`: LLM model for evaluation

**Includes:**
- `hallucination`: Detects unsupported claims (are statements grounded in the provided data?)
- `safety`: Detects harmful content, hate speech, privacy violations, misinformation, manipulation

**When to use:** Any customer-facing agent, regulated industries (finance, healthcare), or before major releases. Pair this with `response_quality()` or `tool_usage()` for a complete gate.

**Example:** Detects when a financial advisor agent makes unsupported claims or recommends unsafe products.

---

### comprehensive, All criteria

Runs all available criteria including no-LLM checks and full LLM-based evaluation. Use before major releases or for thorough regression testing.

```python
config = EvalPresets.comprehensive(
    threshold=0.8,
    use_llm_judge=True,
    judge_model="gemini-2.5-flash",
)
```

**Parameters:**
- `threshold`: Minimum score for `rouge_match` and the LLM criteria. `tool_name_match` and `trajectory` always use a threshold of 1.0 (`trajectory` is IN_ORDER with `check_args=True`)
- `use_llm_judge`: If `True`, includes all LLM-based criteria
- `judge_model`: LLM model for evaluation

**Includes (no-LLM):**
- `tool_name_match`: Tool names match
- `trajectory`: Tool sequence and arguments match
- `rouge_match`: Token-level response overlap

**Includes (LLM, when `use_llm_judge=True`):**
- `llm_judge`: General semantic evaluation
- `factual_accuracy`: Are facts correct?
- `hallucination`: Are statements grounded?
- `safety`: Is the response safe?

**When to use:** Pre-release gates, comprehensive regression testing, or as a baseline for new eval pipelines. The trade-off is higher LLM cost and longer evaluation time.

**Note:** `contains_keywords` is not included because keywords are domain-specific. Add it manually to check for required phrases like "consult a professional" (see [Custom configuration](#build-custom-configuration-from-scratch) below).

---

### custom, Build from individual parameters

Fine-tune evaluation by enabling exactly the criteria you need. Any threshold set to `None` excludes that criterion.

```python
from tenxgraph.qa.evaluation import EvalPresets, MatchType

config = EvalPresets.custom(
    response_threshold=0.7,              # Enable response matching
    tool_threshold=1.0,                  # Enable tool matching at 100%
    llm_judge_threshold=None,            # Exclude LLM judge
    hallucination_threshold=0.8,         # Enable hallucination check
    safety_threshold=0.8,                # Enable safety check
    factual_accuracy_threshold=None,     # Exclude factual accuracy
    tool_match_type=MatchType.IN_ORDER,  # Allow extra tools, not just exact
    check_tool_args=True,                # Validate tool arguments
    judge_model="gpt-4o",                # Use OpenAI as judge
)
```

**Parameters:**
- `response_threshold`: Enable response matching at this threshold (or `None` to skip)
- `tool_threshold`: Enable tool matching at this threshold
- `llm_judge_threshold`: Enable LLM-as-judge at this threshold
- `tool_match_type`: a `MatchType` value (`EXACT`, `IN_ORDER` or `ANY_ORDER`); defaults to `IN_ORDER`
- `check_tool_args`: Whether to validate tool arguments (default `True`)
- `hallucination_threshold`: Enable hallucination detection
- `safety_threshold`: Enable safety checking
- `factual_accuracy_threshold`: Enable factual accuracy checking
- `judge_model`: Which LLM to use

**When to use:** When presets are too rigid. For example, you might want tool checking without response checking, or hallucination detection without safety checking.

---

### combine, Merge multiple presets

Combine multiple preset configurations. Later arguments override earlier ones when criteria conflict.

```python
config = EvalPresets.combine(
    EvalPresets.tool_usage(threshold=1.0),
    EvalPresets.safety_check(threshold=0.8),
)
```

This combines tool validation and safety checks into a single config. If both presets defined the same criterion, the second would win.

**When to use:** You want multiple concerns (tools + safety, responses + hallucinations) in one evaluation run.

---

## EvalConfig class-method presets

In addition to `EvalPresets`, the `EvalConfig` class itself has three presets for structured evaluation:

```python
from tenxgraph.qa.evaluation import EvalConfig

config1 = EvalConfig.default()   # Balanced: exact tools + semantic responses
config2 = EvalConfig.strict()    # Maximum strictness: exact tools + high thresholds
config3 = EvalConfig.relaxed()   # Loose: in-order tools + lower thresholds
```

| Preset | Trajectory | Threshold | Response | LLM Judge |
|---|---|---|---|---|
| `default()` | EXACT, args not checked | 1.0 | `response_match` threshold 0.8 | No |
| `strict()` | EXACT, args checked | 1.0 | `response_match` threshold 0.9 | Yes, 5 samples, threshold 0.9 |
| `relaxed()` | IN_ORDER, args not checked | 0.8 | `response_match` threshold 0.6 | No |

All three use `response_match`, which is LLM-based semantic comparison. None use ROUGE. For a fully no-LLM config, use `EvalPresets.quick_check()` instead.

---

## Save and load configurations

Configurations can be serialized to JSON and loaded back, making it easy to version and share eval configurations.

```python
from tenxgraph.qa.evaluation import EvalConfig

# Create and save
from tenxgraph.qa.evaluation import EvalPresets

config = EvalPresets.tool_usage(threshold=1.0)
config.to_file("my_eval_config.json")

# Load from file
loaded_config = EvalConfig.from_file("my_eval_config.json")

# Both configs are identical
assert config.criteria.tool_name_match.threshold == loaded_config.criteria.tool_name_match.threshold
```

**Use case:** Store your eval configurations in version control alongside your agent code. Different branches can have different strictness levels, and you can compare eval results across releases using the same config.

---

## Build custom configuration from scratch

For full control, construct an `EvalConfig` directly by specifying criteria and their configuration. This is how to enable domain-specific checks like keyword presence.

```python
from tenxgraph.qa.evaluation import (
    CriteriaConfig,
    CriterionConfig,
    EvalConfig,
    MatchType,
    Rubric,
)

config = EvalConfig(
    criteria=CriteriaConfig(
        # No-LLM: verify tool usage
        trajectory=CriterionConfig.trajectory(
            threshold=1.0,
            match_type=MatchType.EXACT,
            check_args=True,
        ),

        # No-LLM: token overlap as sanity check
        rouge_match=CriterionConfig.rouge_match(threshold=0.5),

        # LLM: semantic accuracy
        response_match=CriterionConfig.response_match(
            threshold=0.8,
            judge_model="gemini-2.5-flash",
            num_samples=3,
        ),

        # LLM: hallucination detection
        hallucination=CriterionConfig.hallucination(
            threshold=0.9,
            judge_model="gemini-2.5-flash",
        ),

        # LLM: domain-specific rubric (all rubrics share one slot)
        rubric_based=CriterionConfig.rubric_based(
            rubrics=[
                Rubric(
                    rubric_id="professional_tone",
                    content=(
                        "The response must use professional, formal language. "
                        "Avoid colloquialisms, slang, and casual phrasing."
                    ),
                    weight=1.0,
                ),
                Rubric(
                    rubric_id="conciseness",
                    content="The response must be under 150 words.",
                    weight=0.5,
                ),
            ],
            threshold=0.8,
        ),

        # No-LLM: keyword presence check
        contains_keywords=CriterionConfig.contains_keywords(
            keywords=["consult a professional", "not financial advice"],
            threshold=1.0,  # All keywords must be present
        ),
    ),
    parallel=True,           # Run eval cases concurrently
    max_concurrency=4,       # Maximum concurrent evaluations
    timeout=120.0,           # 120-second timeout per case
)
```

**Criterion slots available:**
`tool_name_match`, `trajectory`, `node_order`, `response_match`, `rouge_match`, `contains_keywords`, `llm_judge`, `rubric_based`, `factual_accuracy`, `hallucination`, `safety`, `simulation_goals`.

**Key point:** There is exactly one `rubric_based` slot. If you have multiple rubrics, they all go into a single `rubrics` list rather than separate criteria (as shown above).

### Add rubrics to an existing config

Instead of building from scratch, you can add rubrics to an existing config:

```python
from tenxgraph.qa.evaluation import Rubric

# Start with a preset
config = EvalPresets.response_quality()

# Add domain-specific rubrics
config = config.with_rubrics([
    Rubric(
        rubric_id="compliance",
        content="The response must mention compliance with SEC regulations.",
        weight=2.0,
    ),
])
```

---

## Choosing a strategy for your agent

Different agents require different evaluation strategies. Use this table to pick a starting point:

| Agent type | Primary concern | Recommended preset | Add to it |
|---|---|---|---|
| Tool-calling (search, API, database) | Tools are called correctly | `tool_usage()` | `safety_check()` for production |
| Q&A / FAQ | Answers are accurate | `response_quality()` | nothing needed |
| RAG / document retrieval | Answers are grounded in sources | `response_quality()` | `hallucination` criterion |
| Customer support | Accurate, safe, helpful | `conversation_flow()` | `safety_check()` |
| Multi-turn dialogue | Coherent conversation flow | `conversation_flow()` | keyword checks for tone |
| Before shipping | Comprehensive check | `comprehensive()` | nothing needed |
| During development (fast feedback) | Sanity check, no cost | `quick_check()` | upgrade to other presets as coverage matures |

**Recommended approach:** Start with no-LLM criteria (`quick_check` or `tool_usage`) to get fast feedback during development. As your eval set grows and you need higher confidence, add LLM-based criteria (`response_quality`, `safety_check`). Run `comprehensive` before releases.

---

## Configuration reference

### EvalConfig fields

| Field | Type | Default | Description |
|---|---|---|---|
| `criteria` | `CriteriaConfig` | empty | Which criteria to run and their thresholds |
| `parallel` | bool | `False` | Run eval cases concurrently |
| `max_concurrency` | int | `4` | Max concurrent evaluations when `parallel=True` |
| `timeout` | float | `300.0` | Timeout per evaluation case (seconds) |
| `verbose` | bool | `False` | Print detailed logging |
| `mock_mode` | bool | `False` | Deprecated, no effect, removed in 2.0. Setting it to `True` emits a `DeprecationWarning`. |
| `reporter` | `ReporterConfig` | default | Report generation settings (see [Reports](/docs/testing/reports)) |

### MatchType

Controls how tool trajectories are compared:
- `MatchType.EXACT`: Required tools must appear in exact order; no extra tools allowed
- `MatchType.IN_ORDER`: Required tools must appear in order, but extra tools are permitted
- `MatchType.ANY_ORDER`: Required tools must all appear in any order; extra tools are permitted

---

## Next steps

- [Run evaluations](/docs/testing/run-evals): execute configs with `10xgraph eval` or inside pytest
- [Criteria reference](/docs/testing/criteria): detailed explanation of each criterion and how scores are calculated
- [Eval sets](/docs/testing/eval-sets): structure test cases for your agent
- [Reports](/docs/testing/reports): view and share evaluation results in HTML, JSON, or JUnit format
