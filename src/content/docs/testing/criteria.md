---
title: Evaluation Criteria
description: "Score agent outputs with deterministic criteria or LLM judges: tools, nodes, ROUGE, accuracy, safety."
section: "Testing and evaluation"
group: "Evaluation"
order: 60
label: Criteria
updated: "2026-10-08"
---

Each `EvalCase` is scored against one or more criteria. A criterion receives the agent's execution trajectory and final response, then returns a score between `0.0` (fail) and `1.0` (pass). A case passes when every enabled criterion meets its threshold. Choose from deterministic criteria (free, instant) that check tool sequences and token overlap, or LLM-judge criteria (cost API calls) that assess semantic quality, factual accuracy, safety, and custom requirements.

The built-in criteria split into two groups: **no-LLM** (deterministic, free, instant) and **LLM-judge** (semantic, costs API calls). Each heading below is the criterion's reported name, the key you will see in the report and in `EvalSummary.criterion_stats`.

For constructor signatures and how to write your own criterion, see the [criteria API reference](/docs/reference/python/evaluation-criteria).

---

## No-LLM criteria

These criteria do not call any LLM. They are deterministic, free, and run in milliseconds. Use them as a first line of defence.

### tool_name_match_score, Tool name matching

Checks that the tool names called by the agent cover the expected ones. Order and arguments are ignored; only presence and count matter.

```python
from tenxgraph.qa.evaluation import CriterionConfig

CriterionConfig.tool_name_match(threshold=1.0)
```

- Score `1.0`: every expected tool name was called
- Score `0.0`: none of the expected tools were called
- Partial scores, the fraction of expected names matched

Extra tools the agent called on top of the expected ones do **not** reduce the score. The one exception: when the case expects no tools at all, calling any tool scores `0.5` and calling none scores `1.0`.

**Use when** you want a check that the right tools were selected but do not care about order or arguments.

---

### tool_trajectory_avg_score, Tool sequence matching

Checks that the sequence of tool calls matches the expected sequence. Supports three match modes controlled by `MatchType`.

```python
CriterionConfig.trajectory(
    threshold=1.0,
    match_type=MatchType.EXACT,   # or IN_ORDER, ANY_ORDER
    check_args=False,
)
```

#### MatchType

| Value | Meaning |
|---|---|
| `EXACT` | Same tools, same order, same count. Extra or missing tools fail the case. |
| `IN_ORDER` | Expected tools must appear in order; extra tools at any position are allowed. |
| `ANY_ORDER` | All expected tools must appear; order and extras do not matter. |

#### Argument checking

When `check_args=True`, the criterion also compares the arguments passed to each tool against the `args` defined in `ToolCall`. This is off by default because slight argument variation (different key ordering, extra optional keys) is common and often acceptable.

```python
CriterionConfig.trajectory(
    threshold=1.0,
    match_type=MatchType.EXACT,
    check_args=True,   # verify arguments as well
)
```

---

### node_order_score, Node visit order

Checks that the graph visited nodes in the expected sequence. Useful for verifying that routing logic is correct (e.g., `MAIN → TOOL → MAIN → END`).

```python
CriterionConfig.node_order(
    threshold=1.0,
    match_type=MatchType.EXACT,
)
```

The same `MatchType` values apply as for trajectory matching.

---

### rouge_match, ROUGE-1 token overlap

Measures textual similarity between the actual and expected response using ROUGE-1 F1 (token overlap). No API calls, instant and free.

```python
CriterionConfig.rouge_match(threshold=0.5)
```

ROUGE-1 counts shared unigrams. A score of `0.5` means roughly half the words overlap. This is a useful fast check during development. For paraphrase-aware matching, use `response_match_score` (LLM-based) instead.

**Typical thresholds:**

| Scenario | Threshold |
|---|---|
| Loose sanity check | 0.3-0.5 |
| Moderate similarity | 0.5-0.7 |
| Near-verbatim | 0.7+ |

---

### contains_keywords, Keyword presence {#contains_keywords}

Checks that a list of required keywords appear in the actual response.

```python
CriterionConfig.contains_keywords(
    keywords=["refund", "7 days", "policy"],
    threshold=1.0,   # fraction of keywords that must be present
)
```

- `threshold=1.0`: all keywords must be present
- `threshold=0.8`: 80% of keywords must be present

This criterion is not included in any preset because keywords are domain-specific. Add it manually to `EvalConfig.criteria`:

```python
from tenxgraph.qa.evaluation import CriteriaConfig, CriterionConfig, EvalConfig

config = EvalConfig(
    criteria=CriteriaConfig(
        contains_keywords=CriterionConfig.contains_keywords(
            keywords=["refund", "policy"],
            threshold=1.0,
        ),
    )
)
```

---

## LLM-judge criteria

These criteria send the agent's response (and optionally the context) to a language model for scoring. They are slower and cost API credits, but catch semantic errors that token-overlap metrics miss.

The default judge model is `gemini-2.5-flash`. Override per criterion with `judge_model="gpt-4o"`. If the judge call fails (bad key, unsupported provider, empty or invalid JSON reply), the criterion reports an error with the real exception message instead of a 0.5 score. With several samples, a sample that succeeds still counts; the error is reported when every sample failed. `SimulationGoalsCriterion` behaves the same way.

---

### response_match_score, Semantic response matching

Uses an LLM to judge whether the actual response is semantically equivalent to the expected response. Handles paraphrasing and differently-worded but correct answers.

```python
CriterionConfig.response_match(
    threshold=0.8,
    judge_model="gemini-2.5-flash",
    num_samples=3,
)
```

- `num_samples`: the judge is called this many times; the final score is the average. This reduces noise from non-deterministic LLM responses.

**When to use:** when you want to verify the agent answered correctly without requiring an exact match. For example, "The capital of France is Paris" and "Paris is France's capital" should both pass.

---

### final_response_match_v2, LLM judge

Configured as `llm_judge`, reported as `final_response_match_v2`. It runs the **same** semantic-equivalence check as `response_match_score`, the two differ only in the name they report under, so you can run both a stricter and a looser threshold over the same question in one report.

```python
CriterionConfig.llm_judge(
    threshold=0.8,
    judge_model="gemini-2.5-flash",
    num_samples=3,
)
```

Like `response_match_score`, it skips with score `1.0` when the case defines no expected final response, so it is not a substitute for open-ended quality scoring. For open-ended tasks where no expected answer exists, write your own criteria with `rubric_based` instead.

Its `details` include `individual_scores` (one per sample), `reasonings`, and `judge_model`.

---

### factual_accuracy_v1, Factual correctness

Checks whether all stated facts in the response are correct, numbers, dates, names, and verifiable claims.

```python
CriterionConfig.factual_accuracy(
    threshold=0.8,
    judge_model="gemini-2.5-flash",
    num_samples=3,
)
```

The judge compares the response against reference material: the case's expected final response, or `EvalCase.metadata["reference_facts"]` when no expected response is set. A score of `1.0` means all facts are correct. Errors the judge names are collected in `details["errors"]`.

**When to use:** for agents that report real-world data (stock prices, weather, historical facts, medical information).

---

### hallucinations_v1, Groundedness detection

Checks whether the response is grounded in information the agent actually retrieved (tool results, provided context). A score of `1.0` means fully grounded; `0.0` means the agent invented information.

```python
CriterionConfig.hallucination(
    threshold=0.8,
    judge_model="gemini-2.5-flash",
    num_samples=3,
)
```

The evaluator builds the grounding context from the tool results collected during execution plus `EvalCase.metadata["context"]`, then asks the judge whether the claims in the response are supported by that evidence. Anything the judge flags is listed in `details["hallucinations"]`.

**When to use:** for RAG agents, research agents, or any agent that presents retrieved information as facts.

---

### safety_v1, Safety scoring

The judge assesses the response across five safety dimensions:

| Dimension | What it checks |
|---|---|
| `harmful_content` | Instructions or encouragement for harm |
| `hate_speech` | Discriminatory or dehumanising language |
| `privacy` | Exposure of personal information |
| `misinformation` | Deliberately false or misleading claims |
| `manipulation` | Psychological manipulation or deception |

The criterion score is the judge's **overall** safety score, averaged across `num_samples` calls. The five dimensions are scored separately and averaged into `details["category_scores"]`, so you can see which dimension pulled the score down without it changing the pass/fail decision. `details["issues"]` lists the specific problems the judge named.

```python
CriterionConfig.safety(
    threshold=0.8,
    judge_model="gemini-2.5-flash",
    num_samples=3,
)
```

**When to use:** for any customer-facing agent, especially in regulated industries (healthcare, finance, legal).

---

### rubric_based_final_response_quality_v1, Custom rubric scoring

Define your own evaluation criteria as free-text rubrics. The LLM scores the response against each rubric and returns a weighted average.

```python
from tenxgraph.qa.evaluation import CriterionConfig, Rubric

CriterionConfig.rubric_based(
    rubrics=[
        Rubric(
            rubric_id="concise",
            content="The response must be under 100 words and get to the point immediately.",
            weight=1.0,
        ),
        Rubric(
            rubric_id="empathetic",
            content="The response must acknowledge the user's frustration before offering a solution.",
            weight=0.5,
        ),
    ],
    threshold=0.8,
    judge_model="gemini-2.5-flash",
)
```

All rubrics go into a single judge prompt as `"- {rubric_id}: {content}"` lines, and the judge returns one overall score for the response. That score is averaged across `num_samples` calls.

`weight` is stored on the `Rubric` model but is **not** used by this criterion, it does not produce a weighted average. To weight criteria against each other, combine them with `WeightedCriterion` (see the [criteria API reference](/docs/reference/python/evaluation-criteria#weightedcriterion)). To make one rubric matter more, say so in its `content`.

With no rubrics configured the criterion returns `1.0` and skips the judge call.

**When to use:** for product-specific quality requirements that generic criteria cannot express (tone, brand voice, compliance language, format requirements).

---

## CriterionConfig reference

All criteria are configured with `CriterionConfig`. You can also construct it directly instead of using the factory class methods:

```python
from tenxgraph.qa.evaluation import CriterionConfig, MatchType

config = CriterionConfig(
    threshold=0.8,
    match_type=MatchType.IN_ORDER,
    judge_model="gpt-4o",
    num_samples=3,
    rubrics=[],
    keywords=[],
    check_args=False,
    enabled=True,
    api_style="responses",
)
```

| Field | Default | Description |
|---|---|---|
| `threshold` | `0.8` | Minimum score to pass (0.0-1.0) |
| `match_type` | `EXACT` | Match type for trajectory and node-order criteria |
| `judge_model` | `gemini-2.5-flash` | LLM used for judge-based criteria |
| `num_samples` | `3` | Number of judge calls (average reduces noise) |
| `rubrics` | `[]` | Custom rubrics for `rubric_based` |
| `keywords` | `[]` | Required keywords for `contains_keywords` |
| `check_args` | `False` | Verify tool arguments in trajectory matching |
| `enabled` | `True` | Set to `False` to disable without removing |
| `api_style` | `"responses"` | OpenAI judge API style. Use `"chat"` for models that only support legacy Chat Completions |

---

## EvalConfig, combining criteria

Wrap criteria in an `EvalConfig` to run them together. `EvalConfig.criteria` is a typed `CriteriaConfig` model with one named field per criterion, not a free-form dict. Unknown field names raise a validation error.

```python
from tenxgraph.qa.evaluation import CriteriaConfig, CriterionConfig, EvalConfig, MatchType

config = EvalConfig(
    criteria=CriteriaConfig(
        trajectory=CriterionConfig.trajectory(
            threshold=1.0,
            match_type=MatchType.EXACT,
        ),
        rouge_match=CriterionConfig.rouge_match(threshold=0.5),
        hallucination=CriterionConfig.hallucination(threshold=0.8),
    ),
    parallel=True,
    max_concurrency=4,
    timeout=120.0,
)
```

The available `CriteriaConfig` fields are `tool_name_match`, `trajectory`, `node_order`, `response_match`, `rouge_match`, `contains_keywords`, `llm_judge`, `rubric_based`, `factual_accuracy`, `hallucination`, `safety` and `simulation_goals`. Each defaults to `None`, meaning the criterion is off. The field name is the *configuration* key; the criterion still reports under its own name, as listed in the headings above.

| EvalConfig field | Default | Description |
|---|---|---|
| `criteria` | empty `CriteriaConfig()` | Which criteria run |
| `parallel` | `False` | Run cases concurrently |
| `max_concurrency` | `4` | Max parallel cases when `parallel=True` |
| `timeout` | `300.0` | Seconds per case before timeout |
| `verbose` | `False` | Extra logging during evaluation |
| `mock_mode` | `False` | Skip actual execution (for config testing) |
| `user_simulator_config` | `None` | Settings for user simulation |
| `reporter` | default `ReporterConfig()` | Automatic report generation |

---

## Enabling and disabling criteria

These methods take the `CriteriaConfig` **field name**, not the reported criterion name:

```python
config.disable_criterion("rouge_match")   # sets enabled=False, keeps the config
config.enable_criterion("rouge_match")    # attaches a default CriterionConfig()
config.enable_criterion("rouge_match", CriterionConfig.rouge_match(0.4))  # with a specific config
```

Note that `enable_criterion(name)` without a config **replaces** whatever was there with a fresh `CriterionConfig()` (threshold `0.8`, EXACT match). To re-enable a criterion you previously disabled without losing its settings, set the flag back directly:

```python
config.criteria.rouge_match.enabled = True
```

Passing a name that is not a `CriteriaConfig` field raises `ValueError`.

---

## Next steps

- [Presets](/docs/testing/presets): ready-made configs for common scenarios
- [Reports](/docs/testing/reports): how scores are reported
- [Eval sets](/docs/testing/eval-sets): building test cases
- [Criteria API reference](/docs/reference/python/evaluation-criteria): constructors, composition, custom criteria
