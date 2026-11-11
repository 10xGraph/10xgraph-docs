---
title: Building Eval Sets
seoTitle: "Build eval sets with EvalSetBuilder"
description: How to build evaluation datasets with EvalSetBuilder, single-turn cases, multi-turn conversations, tool call assertions, and loading from files.
section: "Testing and evaluation"
group: "Evaluation"
order: 50
label: Eval Sets
updated: "2026-10-08"
faq:
  - q: "How do I specify what tool calls an agent should make?"
    a: "Use `expected_tools` with a list of tool names or `ToolCall` objects. The evaluator will check that the agent called these tools during execution."
  - q: "Can I check that tool arguments match exactly?"
    a: "Yes. Include `args` in `ToolCall` objects, then enable `check_args=True` in the criterion config when running evaluations."
  - q: "What's the difference between a single-turn and multi-turn case?"
    a: "Single-turn cases have one user message and one expected response. Multi-turn cases contain a conversation with multiple exchanges, and criteria score the accumulated tool calls and messages across all turns."
---

An `EvalSet` is a named collection of test cases, each defining a scenario that an agent should handle in a specific way. Each case specifies user input, expected behavior (response text, tool calls, node visits), and metadata. You build eval sets using the fluent `EvalSetBuilder` API, load them from JSON files, or construct them directly.

Eval sets are the input to evaluations: you pass an `EvalSet` to the evaluator, which runs your agent against each case and compares the actual behavior to the expected behavior using criteria. The result is a report showing how many cases passed, which criteria failed, and why.

## Creating eval sets with EvalSetBuilder

The `EvalSetBuilder` class provides a fluent, chainable API for building eval sets incrementally. Every call to `add_case`, `add_multi_turn`, or `add_tool_test` returns the builder itself, so you can chain many calls before calling `build()`.

### Single-turn case

The simplest eval case is a single user message and an expected response. Use `add_case`:

```python
from tenxgraph.qa.evaluation import EvalSetBuilder

eval_set = (
    EvalSetBuilder("customer-support")
    .add_case(
        query="How do I reset my password?",
        expected="visit the account settings page",
        case_id="reset_password",
    )
    .build()
)
```

The `query` is the user's input. The `expected` string is the response the agent should produce (used by response-matching criteria like `ExactMatchCriterion` and `RougeMatchCriterion`). The `case_id` is an optional identifier; if omitted, it is auto-generated. Other optional fields: `name` and `description` for human-readable labels in reports.

### Adding expected tool calls

Most agents use tools. Specify which tools the agent should call with `expected_tools`. Pass either tool names as strings or `ToolCall` objects for finer control:

```python
from tenxgraph.qa.evaluation import EvalSetBuilder, ToolCall

eval_set = (
    EvalSetBuilder("weather-agent")
    .add_case(
        query="Weather in London?",
        expected="The weather in London is sunny.",
        expected_tools=["get_weather"],  # tool name only, args not checked
    )
    .add_case(
        query="Weather in Tokyo?",
        expected="Raining in Tokyo.",
        expected_tools=[
            ToolCall(name="get_weather", args={"location": "Tokyo"}),
        ],  # with expected args
    )
    .build()
)
```

When `ToolCall` objects include `args`, the trajectory matching criterion can optionally verify that the agent passed the correct arguments, controlled by setting `check_args=True` in the criterion config. By default, argument checking is off.

### Verifying node execution order

Some tests require that the agent visit nodes in a specific sequence. Use `expected_node_order` to define the exact path through the graph:

```python
.add_case(
    query="Search and summarise the latest AI news",
    expected="Here is a summary of recent developments...",
    expected_tools=["search_web"],
    expected_node_order=["MAIN", "TOOL", "MAIN"],
)
```

The evaluator will check that nodes were visited in this exact sequence. This is useful for ensuring graph logic is working as expected (e.g., agent -> tool -> agent -> END).

### Shortcut for tool-focused tests

When the primary concern is that a specific tool is called with specific arguments, use `add_tool_test`. It is a convenience method that automatically sets the expected response to a placeholder:

```python
.add_tool_test(
    query="What is the weather in Berlin?",
    tool_name="get_weather",
    tool_args={"location": "Berlin"},
    expected_response="Berlin",  # optional; defaults to "Result from get_weather"
    case_id="berlin_weather",
)
```

This is equivalent to calling `add_case` with `expected_tools=[ToolCall(name="get_weather", args={"location": "Berlin"})]`, but shorter when you do not care about the final response text.

### Multi-turn conversations

Eval cases can also be multi-turn conversations, where the agent receives multiple user messages and must maintain state across turns:

```python
.add_multi_turn(
    conversation=[
        ("Hello", "Hi! How can I help?"),
        ("What can you do?", "I can check weather, search the web, and more."),
        ("Check weather in Paris", "It is 18°C in Paris."),
    ],
    expected_tools=["get_weather"],
    case_id="multi_turn_weather",
)
```

The `conversation` parameter is a list of `(user_query, expected_response)` tuples. The evaluator will send each user message in sequence and accumulate tool calls, node visits, and messages across all turns. Criteria then score that entire conversation once, not once per turn. The `expected_tools` is attached to the first turn; trajectory criteria will check for these tools to be called at any point in the conversation.

### Quick builders from pairs

For rapid prototyping, use `EvalSetBuilder.quick` to create eval sets from a series of `(query, expected)` pairs:

```python
from tenxgraph.qa.evaluation import EvalSetBuilder

eval_set = EvalSetBuilder.quick(
    ("Hello", "Hi!"),
    ("What is 2+2?", "4"),
    ("Capital of France?", "Paris"),
)
```

Each pair becomes a single-turn case with auto-generated IDs. This method returns a built `EvalSet` directly (not a builder).

### Creating from conversation logs

If you have conversation logs in a standard format (list of dicts with `"user"` and `"assistant"` keys), use `from_conversations`:

```python
conversations = [
    {"user": "Hello", "assistant": "Hi!"},
    {"user": "Bye", "assistant": "Goodbye!"},
]
eval_set = EvalSetBuilder.from_conversations(conversations, name="smoke-tests")
```

This method also returns a built `EvalSet` directly.

## Persisting eval sets to files

Eval sets are Pydantic models that serialize to JSON. You can save and load them to share across teams or version-control them.

### Saving to JSON

Build and save in one operation:

```python
eval_set = (
    EvalSetBuilder("weather-tests")
    .add_case(query="London weather", expected="sunny")
    .save("evals/weather.json")
)
```

Or save an existing eval set:

```python
eval_set.to_file("evals/weather.json")
```

Both methods write a JSON file with all cases and metadata. The JSON is human-readable and can be edited by hand.

### Loading from JSON

Load an eval set from disk:

```python
from tenxgraph.qa.evaluation import EvalSet

eval_set = EvalSet.from_file("evals/weather.json")
```

### Loading and modifying

You can also load an eval set into a builder, add more cases, and rebuild:

```python
builder = EvalSetBuilder.from_file("evals/weather.json")
builder.add_case(query="Weather in Seoul?", expected="Seoul weather")
eval_set = builder.build()
```

This pattern is useful for extending existing eval sets without manually editing JSON.

## Constructing eval cases directly

For advanced use cases, construct `EvalCase` objects without the builder using the class factory methods `single_turn` and `multi_turn`. This gives you full control over all fields:

### Single-turn case

```python
from tenxgraph.qa.evaluation import EvalCase, ToolCall

case = EvalCase.single_turn(
    eval_id="london_weather",
    user_query="Weather in London?",
    expected_response="It is sunny in London.",
    expected_tools=[ToolCall(name="get_weather", args={"location": "London"})],
    expected_node_order=["MAIN", "TOOL", "MAIN"],
    name="London weather check",
    description="Verifies the weather tool is called for London queries",
)
```

### Multi-turn case

```python
case = EvalCase.multi_turn(
    eval_id="multi_weather",
    conversation=[
        ("Weather in London?", "Sunny."),
        ("And in Tokyo?", "Rainy."),
    ],
    expected_tools=[ToolCall(name="get_weather")],
)
```

You can then add these cases to an `EvalSet` manually:

```python
eval_set = EvalSet(name="my-cases", eval_cases=[case])
```

## Understanding the data model

### EvalSet structure

An `EvalSet` is a container of evaluation cases with metadata:

| Attribute | Type | Description |
|---|---|---|
| `eval_set_id` | `str` | Unique ID for this eval set (UUID, auto-generated) |
| `name` | `str` | Human-readable name shown in reports |
| `description` | `str` | Optional description of what this set tests |
| `eval_cases` | `list[EvalCase]` | The test cases |
| `metadata` | `dict[str, Any]` | Free-form metadata for your use |

### EvalCase structure

Each case in an eval set represents one test scenario:

| Attribute | Type | Description |
|---|---|---|
| `eval_id` | `str` | Unique ID for this case |
| `name` | `str` | Optional human-readable name |
| `description` | `str` | Optional details about what the case tests |
| `conversation` | `list[Invocation]` | One invocation per turn (single-turn case has one) |
| `session_input` | `SessionInput` | Initial session config: `app_name`, `user_id` (default `"test_user"`), `state`, `config` |
| `tags` | `list[str]` | Optional tags used by `EvalSet.filter_by_tags()` |
| `metadata` | `dict[str, Any]` | Free-form metadata; read by some criteria (e.g., `hallucinations_v1` expects `"context"`) |

### Invocation structure

An `Invocation` is a single turn in a conversation. The builder's `add_case` and `add_multi_turn` methods create these automatically, but you can inspect them:

| Attribute | Type | Description |
|---|---|---|
| `user_content` | `MessageContent` | The user's message for this turn |
| `expected_tool_trajectory` | `list[ToolCall]` | Tools expected to be called during this turn |
| `expected_node_order` | `list[str]` | Nodes expected to be visited during this turn |
| `expected_final_response` | `MessageContent \| None` | Expected assistant response for this turn (or None) |

To read the expected response text of a single-turn case:

```python
case.conversation[0].expected_final_response.get_text()
```

### ToolCall structure

`ToolCall` represents a tool invocation, either expected or actual:

```python
from tenxgraph.qa.evaluation import ToolCall

# Tool name only (args not checked in evaluation)
tool_call = ToolCall(name="get_weather")

# With arguments (args can be checked when check_args=True)
tool_call = ToolCall(name="get_weather", args={"location": "London"})
```

The `args` field defaults to `{}`. Argument checking is disabled by default; enable it per criterion in the evaluation config with `CriterionConfig.trajectory(check_args=True)`.

## Common patterns

### Case with tags

Use tags to group related cases for filtering:

```python
builder = EvalSetBuilder("customer-support")
for topic in ["password", "billing", "refund"]:
    builder.add_case(
        query=f"Help with {topic}",
        expected="Here is how to...",
        case_id=f"case_{topic}",
    )
    # Add tags to the case after building (requires manual construction)

# Or build cases with tags by constructing EvalCase directly
case = EvalCase.single_turn(
    eval_id="support_billing",
    user_query="How do I get a refund?",
    expected_response="You can request a refund...",
)
case.tags = ["billing", "support"]
```

### Case with session settings

`session_input` holds per-case session settings. The evaluator passes `session_input.user_id` and the entries of `session_input.config` into the run config for each case. For example, to run a case as a specific user:

```python
case = EvalCase.single_turn(
    eval_id="user_context_test",
    user_query="What can you tell me?",
    expected_response="Based on your account...",
)
case.session_input.user_id = "premium_user"
case.session_input.config = {"tier": "premium"}
```

`EvalSetBuilder.add_case`, `add_multi_turn` and `add_tool_test` accept the same thing as `session_input=SessionInput(...)`. To sign in as a user that tools read from `config["user"]`:

```python
from tenxgraph.qa.evaluation import EvalSetBuilder, SessionInput

EvalSetBuilder(name="orders").add_case(
    "Show my orders",
    "Here are your orders",
    session_input=SessionInput(
        user_id="u1",
        config={"user": {"user_id": "u1", "org_id": "acme", "roles": ["agent"]}},
    ),
)
```

The `session_input.state` field exists on the model, but the evaluator does not currently apply it to the agent's state.

## Next steps

- [Criteria reference](/docs/testing/criteria): the scoring criteria available and how to use them
- [Presets](/docs/testing/presets): ready-made evaluation configurations for common patterns
- [Running evaluations](/docs/testing/run-evals): how to execute eval sets with `10xgraph eval` and the API
- [Evaluation overview](/docs/testing/evaluation): conceptual background on evaluation as a testing methodology
