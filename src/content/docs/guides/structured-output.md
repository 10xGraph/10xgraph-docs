---
title: "Structured output"
description: "Get typed output from LLMs with automatic validation and repair. Use output_schema with Agent or StructuredOutputAgent."
seoTitle: "Structured LLM output"
label: "Structured output"
updated: "2026-10-27"
order: 60
group: "Agents and graphs"
section: "Build agents"
faq:
  - q: "What's the difference between Agent(output_schema) and StructuredOutputAgent?"
    a: "Agent with output_schema sends the schema to the LLM but does not validate or retry. StructuredOutputAgent guarantees validation with automatic repair - if output fails validation, it re-prompts the LLM up to max_attempts times."
  - q: "Can I use TypedDict instead of Pydantic models?"
    a: "Yes. Both Pydantic BaseModel and TypedDict work as output schemas. The validation logic handles both."
  - q: "Does structured output work with tools?"
    a: "Yes. StructuredOutputAgent handles tool calls during generation, then validates the final response. Tools work during generation, not repair."
---

Get guaranteed structured output from LLMs by defining a schema and validating the response. This guide covers two approaches: using `output_schema` on an `Agent` for LLM-native structured output, and using `StructuredOutputAgent` for guaranteed validation with automatic repair.

## Why structured output matters

LLMs generate text, not objects. When you need a specific JSON shape (for a database insert, API call, or type-safe code), leaving validation to the caller is error-prone. Structured output guarantees that you get valid, typed data on the first invocation or after automatic repair attempts, eliminating null-checks and parsing errors downstream.

## Prerequisites

Install the core package with a provider extra:

```bash
pip install "10xgraph[openai]"
# or
pip install "10xgraph[google-genai]"
# or
pip install "10xgraph[anthropic]"
```

You'll also need Pydantic (installed with 10xgraph):

```python
from pydantic import BaseModel, Field
from typing import TypedDict  # alternative to a Pydantic model
```

## Approach 1: Agent with output_schema

Use `output_schema` on a plain `Agent` when you want the LLM's native structured-output feature (OpenAI, Google and Anthropic providers) but don't need validation or repair. The LLM produces `parsed_content` directly.

### Step 1: Define your schema

Create a Pydantic model that describes the shape you want:

```python
from pydantic import BaseModel, Field

class MovieReview(BaseModel):
    """Expected output schema for movie review extraction."""
    title: str = Field(description="Movie title")
    director: str = Field(description="Director's name")
    year: int = Field(description="Release year")
    rating: float = Field(description="Rating from 0.0 to 10.0")
    summary: str = Field(description="One-sentence summary of the movie")
```

### Step 2: Create an Agent with the schema

```python
from tenxgraph.core.graph import Agent

agent = Agent(
    model="gpt-4o-mini",
    output_schema=MovieReview,
    system_prompt=[
        {
            "role": "system",
            "content": "You are a film critic. Extract structured information about movies."
        }
    ],
    provider="openai",
)
```

### Step 3: Use it in a graph

```python
from tenxgraph import END
from tenxgraph.core.graph import StateGraph
from tenxgraph.core.state import Message

graph = StateGraph()
graph.add_node("AGENT", agent)
graph.add_edge("AGENT", END)
graph.set_entry_point("AGENT")

compiled = graph.compile()

# Invoke
result = await compiled.ainvoke(
    {"messages": [Message.text_message("Review The Matrix (1999).")]},
    config={"thread_id": "movie-1"}
)
```

### Step 4: Extract the parsed output

The LLM's response lands in `parsed_content` when the provider supports structured output:

```python
last_message = result["messages"][-1]

# OpenAI's gpt-4o-mini sends parsed_content as a Pydantic instance
if isinstance(last_message.parsed_content, MovieReview):
    review = last_message.parsed_content
else:
    # Fallback to JSON text if provider doesn't parse
    import json
    data = json.loads(last_message.text())
    review = MovieReview(**data)

print(f"Title: {review.title}")
print(f"Rating: {review.rating}/10")
```

## Approach 2: StructuredOutputAgent (guaranteed validation)

Use `StructuredOutputAgent` when you need guaranteed validation with automatic repair. If the LLM's response fails schema validation, the agent injects a correction prompt and retries up to `max_attempts` times.

### Step 1: Define your schema

```python
from pydantic import BaseModel, Field

class PersonInfo(BaseModel):
    """Extracted person information."""
    name: str = Field(description="Full name")
    age: int = Field(description="Age in years")
    occupation: str = Field(description="Job title")
```

### Step 2: Create the StructuredOutputAgent

```python
from tenxgraph.core.state import Message
from tenxgraph.prebuilt.agent import StructuredOutputAgent

agent = StructuredOutputAgent(
    model="gpt-4o-mini",
    output_schema=PersonInfo,
    system_prompt=[
        {
            "role": "system",
            "content": "Extract person information as structured data."
        }
    ],
    max_attempts=3,  # Retry up to 3 times per turn if validation fails
    provider="openai",
)

# Compile the internal graph
compiled = agent.compile()

# Invoke
result = await compiled.ainvoke(
    {"messages": [Message.text_message("Alice is a 30-year-old software engineer.")]},
    config={"thread_id": "person-1"}
)
```

### Step 3: Read the validated output

```python
import json

last_message = result["messages"][-1]

# StructuredOutputAgent validates against the schema.
# Prefer parsed_content if available (provider native parse).
if isinstance(last_message.parsed_content, PersonInfo):
    person = last_message.parsed_content
else:
    # Fallback to JSON text
    data = json.loads(last_message.text())
    person = PersonInfo(**data)

print(f"Name: {person.name}")
print(f"Age: {person.age}")
print(f"Occupation: {person.occupation}")
```

## Adding tools to StructuredOutputAgent

Tools work transparently: the agent calls tools if the LLM requests them, then validates the final structured output.

```python
import json

from pydantic import BaseModel
from tenxgraph.core.state import Message
from tenxgraph.prebuilt.agent import StructuredOutputAgent


def get_current_weather(city: str) -> str:
    """Fetch current weather for a city."""
    # Simulated response
    return json.dumps({
        "city": city,
        "temp_c": 22.5,
        "condition": "partly cloudy",
        "humidity": 68,
    })

class WeatherReport(BaseModel):
    city: str
    temperature_celsius: float
    condition: str
    humidity_percent: int
    advice: str

agent = StructuredOutputAgent(
    model="gpt-4o-mini",
    output_schema=WeatherReport,
    tools=[get_current_weather],
    system_prompt=[
        {
            "role": "system",
            "content": (
                "You are a weather assistant. Use the provided tool to fetch "
                "weather data, then return a structured WeatherReport."
            )
        }
    ],
    max_attempts=2,
    provider="openai",
)

compiled = agent.compile()
result = await compiled.ainvoke(
    {"messages": [Message.text_message("What's the weather in Paris?")]},
    config={"thread_id": "weather-1"}
)
```

## Using TypedDict instead of Pydantic

Both `output_schema` and `StructuredOutputAgent` accept `TypedDict` as well as Pydantic models:

```python
from typing import TypedDict

class OrderInfo(TypedDict):
    order_id: str
    customer_name: str
    total_price: float

agent = StructuredOutputAgent(
    model="gpt-4o-mini",
    output_schema=OrderInfo,
    system_prompt=[
        {
            "role": "system",
            "content": "Extract order details."
        }
    ]
)
```

## Validation details

`StructuredOutputAgent` validates responses by:

1. Checking `parsed_content` first (if the provider set it via native structured output)
2. Attempting to parse the text as JSON
3. Validating the parsed data against the schema using Pydantic's `TypeAdapter`
4. If validation fails and attempts remain, injecting a correction message with the validation error and the JSON Schema, then retrying

The validation strips optional markdown code fences (`\`\`\`json ... \`\`\``) so responses wrapped in backticks still parse.

## Common errors and fixes

<aside class="callout callout-warning" role="note"><p class="callout-title">Validation fails with "Response is not valid JSON"</p>

The LLM returned text that isn't valid JSON. Check:
- Does your system prompt say "Output only JSON" (not "Output JSON with explanation")?
- Did you set `max_attempts` high enough (try 3+)?
- Is the LLM model known to follow JSON constraints well? (GPT-4o and Gemini 2.0 are reliable; smaller models may need more guidance.)

Try increasing `max_attempts` and clarifying the system prompt:

```python
agent = StructuredOutputAgent(
    model="gpt-4o",  # Larger model more reliable
    output_schema=MySchema,
    system_prompt=[
        {
            "role": "system",
            "content": (
                "Extract data and respond with **valid JSON only**. "
                "Output only the JSON object, no explanation, no markdown, no extra text."
            )
        }
    ],
    max_attempts=3,
)
```

</aside>

<aside class="callout callout-warning" role="note"><p class="callout-title">parsed_content is None but text is valid JSON</p>

This happens when the provider doesn't support native structured output. Fall back to parsing the text:

```python
if last_message.parsed_content:
    result = last_message.parsed_content
else:
    import json
    data = json.loads(last_message.text())
    result = MySchema(**data)
```

</aside>

## How to verify it worked

After invoking a `StructuredOutputAgent`:

```python
import json

# Check the last message
last_message = result["messages"][-1]

# Verify it's valid
assert last_message.parsed_content is not None or json.loads(last_message.text())

# Check the repair count (stored internally; needs FULL granularity to see the state)
from tenxgraph.utils import ResponseGranularity

result = await compiled.ainvoke(
    {"messages": [Message.text_message("Alice is a 30-year-old software engineer.")]},
    config={"thread_id": "person-2"},
    response_granularity=ResponseGranularity.FULL,
)
repairs = result["state"].execution_meta.internal_data.get("soa_attempts", 0)
print(f"Repair attempts used: {repairs}")
```

For a plain `Agent` with `output_schema`:

```python
# Check that parsed_content exists and is the right type
assert isinstance(last_message.parsed_content, YourSchema)
print(f"Parsed: {last_message.parsed_content}")
```

## Variations

### Repair with a dedicated LLM pass

By default, `StructuredOutputAgent` injects a lightweight correction message. For more sophisticated repair, provide a `repair_system_prompt` so the repair node runs a full LLM call:

```python
agent = StructuredOutputAgent(
    model="gpt-4o-mini",
    output_schema=MovieReview,
    system_prompt=[...],
    repair_system_prompt=[
        {
            "role": "system",
            "content": (
                "You are an expert JSON formatter. The user will give you a malformed response. "
                "Fix it to match the required schema and output only the corrected JSON."
            )
        }
    ],
    max_attempts=2,
)
```

### Custom context manager

`StructuredOutputAgent` accepts a `context_manager` to trim or summarize long message history:

```python
from tenxgraph.core.state import MessageContextManager

agent = StructuredOutputAgent(
    model="gpt-4o-mini",
    output_schema=MySchema,
    context_manager=MessageContextManager(max_messages=10),
)
```

See [Use context manager](/docs/guides/use-context-manager) for details.

### Custom ID generator

Control how message and run IDs are generated:

```python
from tenxgraph.utils import UUIDGenerator

agent = StructuredOutputAgent(
    model="gpt-4o-mini",
    output_schema=MySchema,
    id_generator=UUIDGenerator(),
)
```

## What's next

- [Build a graph](/docs/guides/build-a-graph): Combine multiple nodes including agents with structured output
- [Use StructuredOutputAgent](/docs/guides/prebuilt/structured-output-agent): Full parameter reference for the prebuilt agent
- [Configure Agent](/docs/guides/configure-agent): Provider and model configuration options
- [Use dependency injection](/docs/guides/use-dependency-injection): Inject config and services into nodes

## Run it in production

The server returns your schema-validated result as part of the normal response, and a request that fails validation inside the graph surfaces as an error response rather than a crash. See [Invoke and stream](/docs/server/invoke-and-stream) and [Errors and limits](/docs/concepts/errors-and-limits).
