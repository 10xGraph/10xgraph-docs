---
title: Routing, Command and callbacks
description: Route execution with conditional edges, Command, or callbacks. Validate and transform invocations. Monitor and coordinate your graph.
section: Concepts
order: 60
group: "Foundations"
updated: "2026-10-08"
faq:
  - q: "When should I use a conditional edge vs Command?"
    a: "Use conditional edges for stateless, deterministic branching. Use Command inside a node when routing depends on side effects (like an API call) or when you need to update state and jump together."
  - q: "Can I use callbacks to change control flow?"
    a: "No. Callbacks observe or transform invocations (before/after LLM or tool calls). They cannot redirect execution. Use Command for routing, conditional edges for state-based branching."
  - q: "What runs first: a before_invoke callback or the LLM?"
    a: "The before_invoke callback runs first. It can validate or transform the input before the LLM receives it."
---

Your agent graph needs three kinds of control: deciding which node runs next (routing), hooking into LLM and tool invocations to validate or log (callbacks), and coordinating the entire execution (lifecycle hooks). This page covers all three and when to use each.

## Routing: three tools with different trade-offs

When the agent finishes in one node, you choose the next node. 10xGraph gives you three ways.

**Conditional edges** are the default. They evaluate a state-based function between nodes, are easy to test and visualize, and work when the decision is stateless and deterministic.

**Command** is a return value from inside a node. It combines a state update and a routing decision, and it runs the side effect (like an API call) inside the node before deciding. Use it for dynamic routing that depends on what happened in the node.

**Callbacks** are not routing. They observe or transform individual LLM, tool, or skill invocations. Use them for validation, logging, or error recovery around those invocations, not to change where execution goes next.

| Tool | Triggers | Updates state | Visible in graph | When to use |
|---|---|---|---|---|
| Conditional edge | After node completes | No; only reads state | Yes | Stateless routing logic |
| Command | Inside node (on return) | Yes | No; internal detail | Routing depends on side effects |
| Callback (on_error) | When invocation fails | No; may return a recovery `Message` | No; internal detail | Recover from LLM or tool errors |

## Routing decisions with conditional edges

A conditional edge is a function that reads state and returns the name of the next node.

```python
from tenxgraph import StateGraph, END

def route_by_topic(state):
    """Return the next node name based on the last message."""
    last_message = state.context[-1].text() if state.context else ""
    
    if "billing" in last_message.lower():
        return "billing_agent"
    elif "refund" in last_message.lower():
        return "refund_agent"
    else:
        return "general_agent"

graph = StateGraph()
graph.add_node("classifier", classify_intent)
graph.add_node("billing_agent", billing_node)
graph.add_node("refund_agent", refund_node)
graph.add_node("general_agent", general_node)

graph.add_conditional_edges("classifier", route_by_topic)
graph.set_entry_point("classifier")
```

Conditional edges are tested separately from nodes. The router function is stateless and pure: it takes state, returns a string, no side effects. The graph visualizer shows the edges on the diagram.

Use conditional edges when the routing choice depends only on state that already exists. Do not use them for choices that require fresh API calls or database queries; put that logic in a node instead.

## Dynamic routing with Command

`Command` is a return value that lets a node update state and choose the next node in one step. Inside the node, you have access to everything: state, config, side effects.

```python
from tenxgraph.utils import Command, END

def billing_handler(state: BillingState, config: dict) -> Command:
    """Handle a billing inquiry and decide next steps."""
    user_id = config.get("user_id")

    # Make API call or database query inside the node
    state.account_status = fetch_account_status(user_id)

    # Update state and route based on the result
    if state.account_status == "suspended":
        return Command(update=state, goto="reactivation_node")
    return Command(update=state, goto=END)
```

Here `BillingState` is an `AgentState` subclass with an `account_status` field, and `fetch_account_status` is your own function.

`Command` is returned from a node, not attached to an edge. No edge from this node appears in the graph diagram because the next node is chosen at runtime by the code. The `update` argument accepts an `AgentState`, a `Message`, a `str` (stored as an assistant message), or a list of messages. A plain `dict` is not supported, so change custom fields on the state object and pass it as `update`.

Use Command when:
- The routing decision depends on a side effect (API call, database query, file read).
- You need to update state and route together as an atomic unit.
- You are recovering from an error inside a node and need to jump to a recovery path.

Do not use Command for every node. Use conditional edges for simple cases because they are faster to test and the graph structure is visible.

## Introspecting and transforming invocations with callbacks

Callbacks hook into individual LLM, tool, MCP, and skill invocations. They are not for routing; they are for validation, transformation, logging, and error recovery *around* those calls.

### Callback types

Pass a `CallbackManager` when you compile the graph:

```python
from tenxgraph.utils import CallbackManager, InvocationType

callback_manager = CallbackManager()
app = graph.compile(callback_manager=callback_manager)
```

Register callbacks for four kinds of events. The three invocation hooks take the `InvocationType` they apply to as their first argument:

| Hook | When it fires | What you get | Returns |
|---|---|---|---|
| `before_invoke` | Before LLM, tool, MCP, or skill call | Input data | Transformed input or original |
| `after_invoke` | After the call succeeds | Input and output | Transformed output or original |
| `on_error` | When the call fails | Input and exception | A recovery `Message`, or `None` to let the error propagate |
| `input_validator` | Before message validation | List of messages | Raises ValidationError or passes |

Invocation types are `AI`, `TOOL`, `MCP`, `INPUT_VALIDATION`, and `SKILL`. `AI` fires for `Agent` nodes and plain function nodes; its input is a dict with `state` and `config`. For `TOOL` and `MCP` the input is the tool's argument dict. Every callback receives a `CallbackContext` with `invocation_type`, `node_name`, `function_name` and `metadata`.

### Before and after hooks

Use `before_invoke` to validate, redact, or enrich the input before it reaches the LLM or tool.

```python
from tenxgraph.utils import CallbackContext, CallbackManager, InvocationType

callback_manager = CallbackManager()

async def clamp_search_query(context: CallbackContext, input_data: dict) -> dict:
    """Cap the length of the model-supplied query before the tool runs."""
    if context.function_name == "search_docs" and "query" in input_data:
        input_data["query"] = str(input_data["query"])[:200]
    return input_data

callback_manager.register_before_invoke(InvocationType.TOOL, clamp_search_query)
```

Use `after_invoke` to log, cache, or transform the output before it is stored in state.

When you stream (`stream` or `astream`), an Agent node's chunks are already with the client when `after_invoke` runs. What the callback returns replaces the saved result only. It cannot redact output that was already streamed, so do not rely on `after_invoke` to hide content from a streaming client.

```python
async def log_tool_results(context: CallbackContext, input_data: dict, output_data):
    """Log every tool result."""
    print(f"Tool {context.function_name} returned: {str(output_data)[:100]}")
    return output_data

callback_manager.register_after_invoke(InvocationType.TOOL, log_tool_results)
```

### Error recovery with on_error

Use `on_error` to catch failures in LLM or tool calls and recover with a fallback `Message`. Any other return value is ignored with a warning.

```python
from tenxgraph.core.state import Message

async def recover_from_tool_failure(
    context: CallbackContext, input_data: dict, error: Exception
) -> Message | None:
    """Recover from a tool timeout with a cached value."""
    if isinstance(error, TimeoutError):
        print(f"Tool {context.function_name} timed out; using cached result")
        return Message.text_message(get_cached_result(context.function_name), role="tool")
    # Return None when there is no recovery
    return None

callback_manager.register_on_error(InvocationType.TOOL, recover_from_tool_failure)
```

### Input validators

Validators are a simpler callback type focused on message validation. Use them for content policy, prompt-injection defense, or business rules.

```python
from tenxgraph.utils import CallbackManager
from tenxgraph.utils.validators import PromptInjectionValidator

callback_manager = CallbackManager()
callback_manager.register_input_validator(PromptInjectionValidator(strict_mode=True))
```

## Monitoring and coordinating with graph lifecycle hooks

Lifecycle hooks observe graph-level events: when the graph starts, ends, errors, pauses, resumes, updates state, or checkpoints. They fire once per event, not once per invocation. Use them for observability, human-in-the-loop coordination, compliance logging, and notifications.

```python
from tenxgraph.utils import CallbackManager
from tenxgraph.utils.callbacks import GraphLifecycleHook, GraphLifecycleContext
from tenxgraph.core.state import AgentState, Message

class MyHook(GraphLifecycleHook):
    async def on_graph_start(self, context: GraphLifecycleContext, state: AgentState) -> AgentState | None:
        """Initialize traces, observability, or state enrichment."""
        print(f"Starting run {context.run_id} in thread {context.thread_id}")
        return None

    async def on_graph_end(
        self, context: GraphLifecycleContext, final_state: AgentState, 
        messages: list[Message], total_steps: int
    ) -> AgentState | None:
        """Record metrics, send notifications."""
        print(f"Completed in {total_steps} steps")
        return None

    async def on_graph_error(
        self, context: GraphLifecycleContext, error: Exception,
        partial_state: AgentState, messages: list[Message],
        step: int, node_name: str
    ) -> tuple[AgentState, str] | None:
        """Alert on failures; mask sensitive data before persistence."""
        print(f"Failed at node {node_name}: {error}")
        return None

    async def on_state_update(
        self, context: GraphLifecycleContext, node_name: str,
        old_state: AgentState, new_state: AgentState, step: int
    ) -> AgentState | None:
        """Observe each node transition."""
        print(f"Step {step}: {node_name}")
        return None

    async def on_checkpoint(
        self, context: GraphLifecycleContext, state: AgentState,
        messages: list[Message], is_context_trimmed: bool
    ) -> tuple[AgentState, list[Message]] | AgentState | None:
        """Redact PII or replicate to cache before state is persisted."""
        return None

callback_manager = CallbackManager()
callback_manager.register_lifecycle_hook(MyHook())
app = graph.compile(callback_manager=callback_manager)
```

### Lifecycle hook use cases

- **Observability**: Start/stop OTEL spans, send metrics to Prometheus or Datadog.
- **Human-in-the-loop**: React to interrupts, log approvals, coordinate resume workflows.
- **Compliance**: Redact PII at checkpoint time, write audit logs, snapshot failures.
- **Notifications**: Send Slack or email when the graph completes, fails, or needs approval.
- **Debugging**: Observe state mutations per node, detect infinite loops, profile performance.

### Lifecycle hooks vs callbacks

| Aspect | CallbackManager | GraphLifecycleHook |
|---|---|---|
| Fires | Once per LLM/tool/MCP invocation | Once per graph lifecycle event |
| Context | Function name, invocation type | Thread ID, run ID, entire state |
| Use case | Transform/validate individual calls | Monitor/coordinate entire run |
| Access to state | Limited (input/output of one call) | Full access to current state |

## Guidelines and rules

Keep callbacks and lifecycle hooks bounded. They run inside the execution loop; expensive operations block graph execution.

Avoid global mutable request state. Use config metadata instead: pass values through `config` or store them in state.

Return the expected shape from transforming callbacks. If `before_invoke` returns a list when a dict is expected, downstream code fails.

Validate `Command` routes in tests. Missing node names or recursion loops are runtime failures.

Use `on_error` in callbacks to recover from errors; do not suppress errors in lifecycle hooks. `on_graph_error` can change the persisted error snapshot, but the exception is always re-raised. For error recovery, use `on_error` callbacks or handle exceptions inside nodes.

## Next steps

- Learn how to [validate input and guard prompts](/docs/guides/protect-against-prompt-injection)
- Set up [callbacks for observability and recovery](/docs/guides/use-callbacks)
- Read [callbacks reference](/docs/reference/python/callback-manager) for the full API
- See [lifecycle hooks reference](/docs/reference/python/lifecycle-callbacks) for all hook signatures
