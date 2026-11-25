---
title: Stream and approve
description: "Stream an agent run in Python with astream(), pause it for human approval with interrupt(), then resume the same thread with a decision."
order: 100
group: "Tutorial"
section: "Get started"
label: Stream and approve
updated: "2026-11-25"
faq:
  - q: "How do I pause a 10xGraph agent for human approval?"
    a: "Call interrupt() inside a tool or node. The graph saves its state and ends the run. Run the same thread again with {\"resume\": value} and interrupt() returns that value."
  - q: "Does the tool run again when I resume?"
    a: "Yes. The paused tool or node runs again from the start, and interrupt() returns the resume value instead of pausing. Keep side effects after the interrupt() call."
  - q: "Do I need a checkpointer to resume?"
    a: "Yes. The paused state is stored in the checkpointer, so resuming needs one and the same thread_id."
---

You pause an agent for human approval by calling `interrupt()` inside a tool, streaming the run with `astream()`, and resuming the same thread with `{"resume": decision}`. The graph saves its state at the pause, so you can wait as long as you need before answering.

## What you build

You build a financial advisor agent with two tools: `check_balance` and `transfer_funds`. The transfer tool pauses the graph to ask for approval before it moves money. Your script streams the run, reads the approval request from the stream, then resumes the thread with a decision.

This pattern suits any action you cannot undo: payments, deletions, outbound emails.

## Prerequisites

Install 10xGraph with Google GenAI support and set your key:

```bash
pip install "10xgraph[google-genai]"
export GOOGLE_API_KEY=your-api-key
```

The code below is complete; it combines the graph from [Build a graph by hand](/docs/get-started/tutorial/build-a-graph) with the checkpointer from [Add memory with threads](/docs/get-started/tutorial/threads-and-memory).

## Build the agent with an approval tool

The graph is the same shape as before: an agent node, a tool node and a router. Two things change. `transfer_funds` calls `interrupt()`, and the graph compiles with a checkpointer, which a pause needs in order to save state.

```python title="approve_agent.py"
import asyncio

from tenxgraph.core.graph import Agent, StateGraph, ToolNode
from tenxgraph.core.state import AgentState, Message, StreamEvent
from tenxgraph.storage.checkpointer import InMemoryCheckpointer
from tenxgraph.utils import END, interrupt


def check_balance() -> str:
    """Check the account balance."""
    return "Current balance: $50,000"


def transfer_funds(amount: float, recipient: str) -> str:
    """Transfer funds to a recipient. Asks a human to approve first."""
    # First run: this call stops the graph.
    # Resumed run: it returns the value passed as {"resume": ...}.
    decision = interrupt(
        {"amount": amount, "recipient": recipient},
        message=f"Approve transfer of ${amount} to {recipient}?",
        reason="transfer_approval",
    )
    if not decision or not decision.get("approved"):
        return "Transfer cancelled by user"
    return f"Transferred ${amount} to {recipient}"


tool_node = ToolNode([check_balance, transfer_funds])

agent = Agent(
    model="gemini-2.5-flash",
    system_prompt=[
        {
            "role": "system",
            "content": (
                "You are a helpful financial advisor. Help users check their balance "
                "and transfer funds when requested."
            ),
        }
    ],
    tool_node=tool_node,
)


def should_use_tools(state: AgentState) -> str:
    """Route to TOOL when the assistant asked for tools, else END."""
    if not state.context:
        return END

    last_message = state.context[-1]

    if last_message.role == "assistant" and last_message.tools_calls:
        return "TOOL"

    return END


graph = StateGraph(AgentState)
graph.add_node("MAIN", agent)
graph.add_node("TOOL", tool_node)
graph.add_conditional_edges("MAIN", should_use_tools, {"TOOL": "TOOL", END: END})
graph.add_edge("TOOL", "MAIN")
graph.set_entry_point("MAIN")

# A pause is saved in the checkpointer, so one is required to resume.
app = graph.compile(checkpointer=InMemoryCheckpointer())
```

`interrupt()` takes a `value` (what the human needs to see), plus optional `message`, `reason` and `response_schema` keyword arguments. It only works while a node or tool is running; elsewhere it raises `RuntimeError`.

## Stream the run until it pauses

`astream()` yields `StreamChunk` objects as the graph runs. When `interrupt()` fires, the stream emits one `updates` chunk with `status` set to `"interrupted"`, carries the request in `chunk.data["interrupt"]`, and then ends. Add this to `approve_agent.py`:

```python title="approve_agent.py"
async def run_until_pause(thread_id: str) -> dict | None:
    """Stream the first run. Return the interrupt request, or None if none was raised."""
    request = None
    async for chunk in app.astream(
        {"messages": [Message.text_message("Transfer $5,000 to Alice")]},
        config={"thread_id": thread_id},
    ):
        if chunk.event == StreamEvent.MESSAGE and chunk.message:
            if chunk.message.role == "assistant" and chunk.message.text():
                print(f"Assistant: {chunk.message.text()}")
        elif chunk.event == StreamEvent.UPDATES and chunk.data.get("status") == "interrupted":
            request = chunk.data["interrupt"]
    return request
```

The request is a dictionary with the fields of the `Interrupt` model: `id`, `key`, `node`, `value`, `message`, `reason`, `response_schema` and `tool_call_id`. Your UI reads `message` and `value` to show the human what is being approved.

## Resume the thread with a decision

To resume, call `astream()` again with the same `thread_id` and an input of `{"resume": decision}`. No new messages are sent. The paused tool runs again from the start, and this time `interrupt()` returns your decision.

```python title="approve_agent.py"
async def resume_with(thread_id: str, decision: dict) -> None:
    """Resume the paused thread and stream the rest of the run."""
    async for chunk in app.astream(
        {"resume": decision},
        config={"thread_id": thread_id},
    ):
        if chunk.event == StreamEvent.MESSAGE and chunk.message:
            if chunk.message.role == "assistant" and chunk.message.text():
                print(f"Assistant: {chunk.message.text()}")


async def main() -> None:
    thread_id = "approval-demo-1"

    print("=== Streaming until approval is needed ===")
    request = await run_until_pause(thread_id)

    if request is None:
        print("The agent finished without asking for approval.")
        return

    print(f"\nPaused: {request['message']}")
    print(f"Details: {request['value']}")

    # In a real app a person answers here. This tutorial approves automatically.
    print("\n=== Resuming with approval ===")
    await resume_with(thread_id, {"approved": True})


if __name__ == "__main__":
    asyncio.run(main())
```

## Run it

```bash
python approve_agent.py
```

The model words its replies differently on each run, so your output will differ. It looks like this:

```text
=== Streaming until approval is needed ===
Assistant: I'll set up that transfer for you.

Paused: Approve transfer of $5000.0 to Alice?
Details: {'amount': 5000.0, 'recipient': 'Alice'}

=== Resuming with approval ===
Assistant: The transfer of $5,000 to Alice is complete.
```

To check the other branch, change the decision to `{"approved": False}`. The tool returns "Transfer cancelled by user" and the assistant tells you the transfer did not happen.

If the first run prints "finished without asking for approval", the model answered without calling the tool. Rephrase the request to be explicit, for example "Use transfer_funds to send $5,000 to Alice".

## How it works

A pause is not an error. `interrupt()` stops the graph by raising `GraphInterrupt`, which derives from `BaseException` so your tools' `except Exception` blocks do not swallow it. The graph catches it, saves the state and ends the stream.

1. **Run:** the agent asks for `transfer_funds`, and the `ToolNode` starts it.
2. **Pause:** `interrupt()` raises, the graph stores the request in the thread's checkpoint, and `astream()` emits the `interrupted` update, then stops.
3. **Resume:** your `{"resume": decision}` input is recorded as the answer. The tool runs again from the top, and `interrupt()` returns the decision instead of raising.

<aside class="callout callout-warning" role="warning"><p class="callout-title">Code before interrupt() runs twice</p>

The resumed tool starts from its first line, so anything before the `interrupt()` call executes on both runs. Put side effects such as payments and writes after the call, as `transfer_funds` does.

</aside>

## Key API details

| Name | Import | What it does |
|---|---|---|
| `interrupt(value=None, *, message=None, reason="input_required", response_schema=None)` | `tenxgraph.utils` | Pauses the graph and returns the resume value on the next run, or `None` if the client cancelled. |
| `pending_interrupt(state)` | `tenxgraph.utils` | Returns the `Interrupt` a paused state waits on, or `None`. Use it on a state from `invoke` or the checkpointer. |
| `{"resume": value}` | input to `astream`, `ainvoke`, `invoke` | Resumes a thread paused by `interrupt()`. The value goes back to the waiting call. |

Resuming a thread that is not paused at an `interrupt()` raises a `ValueError`.

The same pause works without streaming. With `ainvoke(..., response_granularity=ResponseGranularity.FULL)` the result contains the state, and `pending_interrupt(result["state"])` returns the request. The full model, including `interrupt_before` and `interrupt_after`, is in [Interrupts](/docs/concepts/interrupts), and a task-focused version is in [Add human approval](/docs/guides/add-human-approval).

## Next step

Learn how to unit test your agent in [Test and evaluate](/docs/get-started/tutorial/test-and-evaluate). For streaming internals, see [Streaming](/docs/concepts/streaming).
