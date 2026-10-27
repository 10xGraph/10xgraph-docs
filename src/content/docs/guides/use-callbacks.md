---
title: Use Callbacks and Hooks
description: "Hook into graph execution to log, validate, trace, and respond to events at two levels"
section: "Build agents"
group: "Safety"
order: 370
updated: "2026-10-27"
---

Callbacks and hooks let you observe and control graph execution at critical points. 10xGraph provides two levels: **invocation-level callbacks** that fire on every LLM, tool, or MCP call, and **graph-level lifecycle hooks** that fire at structural events like start, end, error, interrupt, and checkpoint. Use them for logging, metrics, tracing, validation, and compliance.

## Goal

By the end of this guide, you will understand when to use callbacks vs lifecycle hooks, have two working examples, and know how to integrate them into your graph.

## Prerequisites

- Python 3.12+
- A compiled 10xGraph agent or graph from `/docs/guides/build-a-graph`
- `pip install "10xgraph[google-genai]"` (or your provider)

## Callbacks vs lifecycle hooks: when to use each

**Invocation-level callbacks** fire on every LLM, tool, or MCP call within a node:
- `before_invoke`: Validate or modify inputs before they are sent.
- `after_invoke`: Log, filter, or modify outputs after they return.
- `on_error`: Handle errors that occur during a call and optionally return a recovery value.

Use these for input/output validation, prompt injection protection, logging at invocation granularity, or modifying tool behavior on-the-fly.

**Graph-level lifecycle hooks** fire at structural events of the entire run:
- `on_graph_start`: Initialize state, spans, or observability before the first node runs.
- `on_graph_end`: Record metrics, send notifications, or finalize after successful completion.
- `on_graph_error`: Alert systems or mask sensitive data when the graph fails.
- `on_interrupt` / `on_resume`: Update external task queues or validate approval data.
- `on_checkpoint`: Redact sensitive data or replicate state before persistence.
- `on_state_update`: Observe every node transition (most granular).

Use lifecycle hooks for observability, compliance, state persistence policy, and human-in-the-loop coordination.

## Step 1: Set up a callback manager

Create a `CallbackManager`, register callbacks and hooks, and pass it to `compile()`:

```python
from tenxgraph.core.graph import StateGraph
from tenxgraph.utils import CallbackManager
from tenxgraph.core.state import AgentState, Message

# Create the manager
cbm = CallbackManager()

# Build your graph
builder = StateGraph(AgentState)
# ... add nodes, edges, etc. ...

# Compile with the manager
app = builder.compile(callback_manager=cbm)
```

## Step 2: Add invocation-level callbacks

Register callbacks to validate inputs, log outputs, or handle errors on every LLM/tool call.

### Before-invoke: validate or modify input

Filter or reject inputs before they reach the LLM or tool:

```python
from tenxgraph.utils.callbacks import BeforeInvokeCallback, CallbackContext
from tenxgraph.utils import InvocationType

class PromptGuardCallback(BeforeInvokeCallback):
    """Block requests that contain suspicious patterns."""
    
    async def __call__(self, context: CallbackContext, input_data):
        # For AI invocations, input_data is {"state": AgentState, "config": dict}
        for msg in input_data["state"].context or []:
            if "ignore previous" in msg.text().lower():
                raise ValueError("Prompt injection detected")
        return input_data

# Register it
cbm.register_before_invoke(InvocationType.AI, PromptGuardCallback())
```

### After-invoke: log or modify output

Inspect or transform outputs after the LLM/tool returns:

```python
from tenxgraph.utils.callbacks import AfterInvokeCallback
import logging

logger = logging.getLogger(__name__)

class AuditLogCallback(AfterInvokeCallback):
    """Log every LLM call for compliance."""
    
    async def __call__(self, context: CallbackContext, input_data, output_data):
        logger.info(
            f"[AUDIT] node={context.node_name} type={context.invocation_type} "
            f"function={context.function_name}"
        )
        return output_data

cbm.register_after_invoke(InvocationType.AI, AuditLogCallback())
```

### On-error: handle or recover from failures

Catch errors and optionally return a fallback response:

```python
from tenxgraph.utils.callbacks import OnErrorCallback
from tenxgraph.core.state import Message

class FallbackOnLLMError(OnErrorCallback):
    """Return a fallback message if the LLM fails."""
    
    async def __call__(self, context: CallbackContext, input_data, error: Exception):
        if "rate_limit" in str(error).lower():
            # Return a recovery message instead of failing
            return Message.text_message(
                "I'm busy. Please try again in a moment.",
                role="assistant"
            )
        # Return None to re-raise the error
        return None

cbm.register_on_error(InvocationType.AI, FallbackOnLLMError())
```

## Step 3: Add graph-level lifecycle hooks

Register hooks to observe or control the entire graph run:

```python
from tenxgraph.utils.callbacks import GraphLifecycleHook, GraphLifecycleContext
import uuid
import time

class ObservabilityHook(GraphLifecycleHook):
    """Track execution from start to end with metrics."""
    
    async def on_graph_start(self, context: GraphLifecycleContext, state):
        """Initialize trace when the graph starts."""
        trace_id = str(uuid.uuid4())
        state.execution_meta.internal_data["trace_id"] = trace_id
        state.execution_meta.internal_data["start_time"] = time.time()
        print(f"[START] thread={context.thread_id} trace={trace_id}")
        return state
    
    async def on_graph_end(self, context: GraphLifecycleContext, final_state, messages, total_steps):
        """Record final metrics when the graph completes."""
        elapsed = time.time() - final_state.execution_meta.internal_data.get("start_time", 0)
        trace_id = final_state.execution_meta.internal_data.get("trace_id")
        print(
            f"[END] trace={trace_id} steps={total_steps} "
            f"messages={len(messages)} duration={elapsed:.2f}s"
        )
        return None
    
    async def on_graph_error(self, context: GraphLifecycleContext, error: Exception,
                             partial_state, messages, step, node_name):
        """Alert when the graph fails."""
        trace_id = partial_state.execution_meta.internal_data.get("trace_id")
        print(f"[ERROR] trace={trace_id} node={node_name} error={type(error).__name__}: {error}")
        # Mask sensitive fields before persistence
        partial_state.execution_meta.internal_data["error_masked"] = True
        return partial_state, f"Graph failed: {type(error).__name__}"

# Register the hook
cbm.register_lifecycle_hook(ObservabilityHook())
```

## Step 4: Run your graph and observe

Invoke the graph normally. Callbacks and hooks fire automatically:

```python
# Build and compile your graph with callbacks registered
cbm = CallbackManager()
cbm.register_before_invoke(InvocationType.AI, PromptGuardCallback())
cbm.register_after_invoke(InvocationType.AI, AuditLogCallback())
cbm.register_on_error(InvocationType.AI, FallbackOnLLMError())
cbm.register_lifecycle_hook(ObservabilityHook())

builder = StateGraph(AgentState)
# ... add nodes and edges ...
app = builder.compile(callback_manager=cbm)

# Invoke the graph
result = await app.ainvoke(
    {"messages": [Message.text_message("What is the capital of France?")]},
    config={"thread_id": "user_123", "run_id": "run_456"}
)

print(f"Final messages: {len(result['messages'])}")
```

**Expected output:**
```
[START] thread=user_123 trace=a1b2c3d4-...
[AUDIT] node=agent type=ai function=Agent
[END] trace=a1b2c3d4-... steps=1 messages=2 duration=0.45s
Final messages: 2
```

## Complete example: compliance audit trail

This example builds a graph that logs every operation and redacts sensitive data before checkpoint:

```python
import logging
import re
from tenxgraph.core.state import Message
from tenxgraph.utils import tool, CallbackManager, InvocationType
from tenxgraph.utils.callbacks import (
    GraphLifecycleHook, GraphLifecycleContext,
    BeforeInvokeCallback, AfterInvokeCallback, CallbackContext,
)
from tenxgraph.prebuilt.agent import ReactAgent

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

EMAIL_RE = re.compile(r"\b[\w.-]+@[\w.-]+\.\w+\b")

# Define a simple tool
@tool
def lookup_email(user_id: str) -> str:
    """Look up a user's email by ID."""
    return f"user_{user_id}@example.com"

# Compliance hook: redact PII before persistence
class ComplianceHook(GraphLifecycleHook):
    async def on_checkpoint(self, context: GraphLifecycleContext, state, messages, is_context_trimmed):
        """Redact email addresses before persisting."""
        for msg in messages:
            for block in msg.content:
                if getattr(block, "type", None) == "text":
                    block.text = EMAIL_RE.sub("[REDACTED_EMAIL]", block.text)
        
        logger.info(f"[COMPLIANCE] Checkpointed {len(messages)} messages (redacted)")
        return state, messages

# Audit callback: log every tool call
class ToolAuditCallback(AfterInvokeCallback):
    async def __call__(self, context: CallbackContext, input_data, output_data):
        if context.function_name:
            logger.info(f"[AUDIT] Tool called: {context.function_name}")
        return output_data

# ReactAgent builds the graph (agent node plus tool node) for you
agent = ReactAgent(
    model="gemini/gemini-2.5-flash",
    tools=[lookup_email],
)

# Register callbacks
cbm = CallbackManager()
cbm.register_lifecycle_hook(ComplianceHook())
cbm.register_after_invoke(InvocationType.TOOL, ToolAuditCallback())

app = agent.compile(callback_manager=cbm)

# Run
result = await app.ainvoke(
    {"messages": [Message.text_message("What is the email for user 42?")]},
    config={"thread_id": "audit_demo", "run_id": "run_001"}
)
```

## Common errors and fixes

| Error | Cause | Fix |
|---|---|---|
| `callbacks never fire` | `callback_manager` not passed to `compile()`. | Use `graph.compile(callback_manager=cbm)` explicitly. |
| `KeyError` or `TypeError` in a before_invoke callback | `input_data` is a dict, not a message list. AI calls get `{"state", "config"}`; tool calls get the tool arguments. | Read `input_data["state"].context` for messages. |
| `on_error callback changes return type` | An `on_error` callback returned something other than a `Message` or `None`. | Non-`Message` values are ignored with a warning. Return a `Message` to recover, or `None` to re-raise. |
| `lifecycle hook never fires` | Hook registered after `compile()`. | Register hooks before calling `compile(callback_manager=cbm)`. |
| `on_graph_error doesn't suppress error` | Hooks cannot suppress graph errors. | Use `on_error` callbacks for invocation-level recovery. |
| `callback blocks the graph` | A callback does slow synchronous work. | Class-based callbacks must define `async def __call__`; avoid blocking I/O inside them. |

## Variations and options

### Multiple callbacks of the same type

Register several callbacks; they execute in order:

```python
cbm.register_before_invoke(InvocationType.AI, GuardCallback())
cbm.register_before_invoke(InvocationType.AI, LoggingCallback())
# Both fire before every LLM call, in order
```

### Selective callback registration

Callbacks can check `context.node_name` to apply only to specific nodes:

```python
class SelectiveAudit(AfterInvokeCallback):
    async def __call__(self, context: CallbackContext, input_data, output_data):
        if context.node_name == "sensitive_node":
            logger.critical(f"Sensitive operation detected")
        return output_data
```

### Validators as a simpler alternative

For message validation, use `BaseValidator` instead of before-invoke callbacks:

```python
from tenxgraph.utils import BaseValidator
from tenxgraph.utils.validators import ValidationError

class SimpleValidator(BaseValidator):
    async def validate(self, messages):
        for msg in messages:
            if "bad_word" in msg.text().lower():
                raise ValidationError("Content policy violation", "policy")
        return True

cbm.register_input_validator(SimpleValidator())
```

### Combining callbacks and lifecycle hooks

Use callbacks for invocation-level logic and lifecycle hooks for graph-level coordination:

```python
# Callbacks log each LLM call
cbm.register_after_invoke(InvocationType.AI, AuditLogCallback())

# Hooks correlate all calls in one run
cbm.register_lifecycle_hook(ComplianceHook())

app = graph.compile(callback_manager=cbm)
```

## Run it in production

Hooks and validators resolve from the global InjectQ container, so graphs in one server process share the same `CallbackManager` unless you give each graph its own container. Hooks run on every request, so keep them fast and do not put secrets in logged payloads. See the [Security model](/docs/production/security-model).

## Related pages

- [Concepts: Callbacks and Command](/docs/concepts/callbacks-and-command): understand when to use callbacks vs conditional edges
- [Reference: Callback Manager](/docs/reference/python/callback-manager): full API
- [Reference: Lifecycle Callbacks](/docs/reference/python/lifecycle-callbacks): all hook signatures and patterns
- [Guides: Add human approval](/docs/guides/add-human-approval): use lifecycle hooks for interrupt/resume workflows
- [Guides: Protect against prompt injection](/docs/guides/protect-against-prompt-injection): validate input with callbacks
