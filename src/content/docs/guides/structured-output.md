---
title: "Structured output"
description: "Get typed output from LLMs with automatic validation and repair. Use output_schema with Agent or StructuredOutputAgent."
seoTitle: "Structured LLM output"
label: "Structured output"
updated: "2026-11-26"
order: 60
group: "Agents and graphs"
section: "Build agents"
faq:
  - q: 'What is the difference between Agent(output_schema) and StructuredOutputAgent?'
    a: 'Agent with output_schema sends the schema to the provider but does not validate or retry. StructuredOutputAgent validates the reply and, if it fails, asks the model again, up to max_attempts times per turn.'
  - q: 'Can I use TypedDict instead of Pydantic models?'
    a: 'Yes. Both Pydantic BaseModel and TypedDict work as output schemas. The validation logic handles both.'
---

Get typed output by giving the model a schema: `output_schema` on an `Agent` uses the provider's structured-output mode, and `StructuredOutputAgent` adds validation and repair.

## Prerequisites

Install the core package with a provider extra:

```bash
pip install "10xgraph[openai]"
# or
pip install "10xgraph[google-genai]"
# or
pip install "10xgraph[anthropic]"
```


## Approach 1: Agent with output_schema

Use `output_schema` on a plain `Agent` when you want the provider's structured-output mode without validation or repair. OpenAI and Google set `parsed_content` on the reply; Anthropic gets the schema but returns JSON text, so read `text()` there.

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
from tenxgraph.utils import END
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

Read `parsed_content`, and fall back to the JSON text on providers that do not set it:

```python
last_message = result["messages"][-1]

# OpenAI and Google set parsed_content
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

Use `StructuredOutputAgent` when you need guaranteed validation with automatic repair. If the LLM's response fails schema validation, the agent injects a correction prompt and retries up to `max_attempts` times. A `TypedDict` works as a schema too.

`max_attempts` (default `2`) counts per turn and resets when a new message starts a turn. When the last attempt still fails validation, the run does not raise: the agent returns its last reply and marks it with `metadata["structured_output_valid"] = False` and `metadata["structured_output_error"]`, so check that before you use the output.

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

The final message holds the validated JSON; read it as in Approach 1, Step 4. Constructor options, tools, `TypedDict` schemas and LLM repair are in the [prebuilt agents reference](/docs/reference/python/prebuilt-agents#structuredoutputagent).

## Common errors and fixes

<aside class="callout callout-warning" role="note"><p class="callout-title">Validation fails with "Response is not valid JSON"</p>

The LLM returned text that isn't valid JSON. Check:
- Does your system prompt say "Output only JSON" (not "Output JSON with explanation")?
- Did you set `max_attempts` high enough (try 3+)?

Try increasing `max_attempts` and clarifying the system prompt:

```python
agent = StructuredOutputAgent(
    model="gpt-4o",
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

## What's next

- [Build a graph](/docs/guides/build-a-graph): Combine multiple nodes including agents with structured output
- [Prebuilt agents reference](/docs/reference/python/prebuilt-agents#structuredoutputagent): every `StructuredOutputAgent` parameter
- [Configure Agent](/docs/guides/configure-agent): Provider and model configuration options

## Run it in production

The server returns your schema-validated result as part of the normal response, and a request that fails validation inside the graph surfaces as an error response rather than a crash. See [Invoke and stream](/docs/server/invoke-and-stream) and [Errors and limits](/docs/concepts/errors-and-limits).