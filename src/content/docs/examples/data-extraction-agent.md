---
title: Build a Data Extraction AI Agent in Python
description: Build a data extraction agent in Python that turns unstructured text into validated Pydantic records and retries when validation fails, with 10xGraph.
section: Examples
group: "Use cases"
order: 240
label: Data Extraction
updated: "2026-10-08"
faq:
  - q: "How do I make extraction more reliable?"
    a: "Validate every result with a Pydantic schema, return the validation error to the model as the tool result, and let it resubmit. Add custom validators for business rules and cap retries with recursion_limit."
  - q: "When should I extract instead of summarize?"
    a: "Extract when you need structured fields in a database or downstream code. Summarize when a person will read the result. Extraction with validation is checkable, a summary is not."
  - q: "Can I use this for contracts, emails or scraped pages?"
    a: "Yes. The graph stays the same and only the schema and the system prompt change. If a single call is enough and you do not need retries, use the structured output guide instead."
---

A data extraction agent reads unstructured text, such as an invoice, and saves it as a typed record. It calls a submit tool that validates the data with Pydantic. If validation fails, the error goes back to the model, which fixes the record and resubmits, so only valid data is stored.

This page builds that loop with one agent node, one tool node and a routing function. It is a runnable script, and the in-memory list stands in for your database.

## How the validation loop works

The agent never writes data directly. It calls `submit_invoice`, and that tool validates the arguments against a Pydantic model. A valid record is saved. An invalid one returns the error text as the tool result, and the graph sends control back to the agent to try again.

```text
document text
     |
     v
  MAIN (agent) --- no tool call ---> END
     |
     | tool call
     v
  TOOL (submit_invoice) --- always returns to MAIN
```

The retry needs no special edge. The tool result lands in the message history, the agent reads the error on its next turn, and calls the tool again. The run ends when the agent replies without a tool call. A recursion limit stops a model that can never produce a valid record.

## Prerequisites

Install the core package with the Anthropic extra. Pydantic is a dependency of the core package. Set the API key your provider SDK expects (for Anthropic, `ANTHROPIC_API_KEY`) in your shell. To use OpenAI or Google instead, install that extra and change the model string.

```bash
pip install "10xgraph[anthropic]"
```

## Define the schema

The Pydantic model is both the contract and the validator. Field descriptions tell the model what each field means, and `Decimal` keeps money exact where `float` would not.

```python
# schema.py
from datetime import date
from decimal import Decimal

from pydantic import BaseModel, Field, model_validator


class InvoiceLineItem(BaseModel):
    description: str
    quantity: int
    unit_price: Decimal
    total: Decimal


class Invoice(BaseModel):
    invoice_number: str = Field(description="The invoice ID printed on the document")
    issue_date: date
    due_date: date
    vendor_name: str
    total_amount: Decimal
    line_items: list[InvoiceLineItem]

    @model_validator(mode="after")
    def check_business_rules(self) -> "Invoice":
        # Business rules the model must satisfy, reported back as errors
        if self.due_date < self.issue_date:
            raise ValueError("due_date must not be before issue_date")
        if sum(item.total for item in self.line_items) != self.total_amount:
            raise ValueError("line item totals must add up to total_amount")
        return self
```

The `model_validator` shows the real value of the loop: a rule such as "line items add up to the total" produces an error message the model can act on.

## Build the extraction graph

The graph has two nodes. `MAIN` is an `Agent` whose `tool_node="TOOL"` points at the tool node by name, and `route` sends the run to `TOOL` when the agent asked for a tool, or to `END` when it answered in text.

The system prompt is passed through Python string formatting at run time, so literal braces in the JSON schema are doubled. Without that, the schema would be treated as placeholders and the prompt would not be interpolated.

```python
# extraction_agent.py
import json

from tenxgraph.core import Agent, AgentState, Message, StateGraph, ToolNode
from tenxgraph.utils import END

from schema import Invoice

# Stand-in for a database table
extracted_invoices: list[dict] = []


def submit_invoice(invoice: dict) -> str:
    """Submit the extracted invoice. Call this with the full structured data."""
    try:
        validated = Invoice.model_validate(invoice)
    except Exception as exc:
        # Returned to the model as the tool result so it can fix the data
        return f"Validation error: {exc}. Fix the issues and resubmit."
    extracted_invoices.append(validated.model_dump(mode="json"))
    return f"Saved invoice {validated.invoice_number}."


# Double the braces so Agent's prompt formatting leaves the JSON schema intact
schema_text = json.dumps(Invoice.model_json_schema()).replace("{", "{{").replace("}", "}}")

extractor = Agent(
    model="claude-sonnet-4-5",  # use any model id you have access to
    system_prompt=[
        {
            "role": "system",
            "content": (
                "Extract invoice data from the document the user sends. "
                "Call the submit_invoice tool with an object matching this JSON schema: "
                f"{schema_text}. "
                "If submit_invoice returns a validation error, fix the data and call it again. "
                "Do not summarize and do not chat."
            ),
        }
    ],
    tool_node="TOOL",
)


def route(state: AgentState) -> str:
    """Go to the tool node when the agent requested a tool, otherwise finish."""
    last = state.context[-1] if state.context else None
    if last and last.role == "assistant" and last.tools_calls:
        return "TOOL"
    return END


graph = StateGraph()
graph.add_node("MAIN", extractor)
graph.add_node("TOOL", ToolNode([submit_invoice]))
graph.add_conditional_edges("MAIN", route, {"TOOL": "TOOL", END: END})
graph.add_edge("TOOL", "MAIN")  # tool results always return to the agent
graph.set_entry_point("MAIN")

app = graph.compile()
```

## Run the agent on a sample invoice

Call `app.invoke` with the document text as a user message. The `recursion_limit` counts every node execution, so a first-try success takes three steps (agent, tool, agent) and each retry adds two more. A limit of 9 allows about three retries, and the run raises `GraphRecursionError` if it is exceeded.

```python
# run.py
from tenxgraph.core import Message

from extraction_agent import app, extracted_invoices

invoice_text = """
INVOICE #INV-2024-001
Issue Date: 2024-01-15
Due Date: 2024-02-15

Vendor: Acme Corporation
Items:
- Widget A x 10 @ $5.00 = $50.00
- Widget B x 5 @ $10.00 = $50.00

Total: $100.00
"""

result = app.invoke(
    {"messages": [Message.text_message(invoice_text)]},
    config={"thread_id": "extract-inv-001", "recursion_limit": 9},
)

# The last message is the agent's closing reply; the data is in your store
print(result["messages"][-1].text())
print(extracted_invoices[-1])
```

Check the result by inspecting `extracted_invoices`, not the agent's closing text. The model's wording varies between runs, but a stored record has always passed `Invoice.model_validate`. For this input it contains `invoice_number` `INV-2024-001`, the two line items and a `total_amount` of `100.00`.

## Operational considerations

Treat these as the checklist before you point the agent at real documents.

- **Model choice.** Use a strong tool-calling model. Smaller models miss nested fields and produce invalid arguments more often, which costs retries.
- **Preprocess the text.** Strip headers, footers, page numbers and decorative text. The model spends attention on them and may extract them as data.
- **Validate business rules.** Type checks catch format errors. Custom validators, like the totals check above, catch values that are well-formed but wrong.
- **Log failures with their input.** When a run hits the recursion limit, store the document and the last error (redact personal data first). Those cases show where to improve the prompt or schema.
- **Use idempotent thread IDs.** Set `thread_id` to a hash of the document so the same document is not processed twice under different threads.
- **Cap retries.** If the model fails three or four times, it is usually stuck on a structural problem, not a typo, and more attempts only cost money.

## Adapt the pattern to other documents

The graph shape stays the same and only the schema, tool name and prompt change.

| Task | Schema focus |
|---|---|
| Form filling | Required fields collected from a chat, with validators for each |
| Email triage | Sender, intent, action items, and an `Enum` for urgency |
| Contract review | Parties, dates and obligations as nested models |
| Scraped page cleanup | Typed records from semi-structured text |

## When to use this pattern

Use it when the output goes into a database or downstream code and you need to know it is valid. The loop gives you a hard guarantee that stored records passed validation, and a bounded cost when the model cannot comply.

Do not use it when a person will only read the result (summarize instead), or when a single call with a schema is enough. For one-shot typed output without retries, see [structured output](/docs/guides/structured-output). If the agent must also look things up, use a [ReAct agent](/docs/examples/quickstart) or a [RAG agent](/docs/guides/prebuilt/rag-agent).

## See also

- [ReAct agent with validation](/docs/examples/callbacks): input validators and callbacks on a tool-using agent
- [Custom state](/docs/examples/graph-basics): extend `AgentState` for richer workflows
- [Structured output](/docs/guides/structured-output): typed output from a single model call
- [Get started](/docs/get-started): build your first agent
