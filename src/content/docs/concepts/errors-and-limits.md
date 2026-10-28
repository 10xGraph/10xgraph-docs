---
title: Errors and limits
description: "Exception taxonomy, execution limits, retry behavior, and error recovery in graph execution."
updated: "2026-10-27"
order: 150
group: "Memory and reliability"
section: Concepts
faq:
  - q: How do I retry a failed node?
    a: Set retry_config on your Agent. LLM calls that fail with a transient error (429, 500, 502, 503, 529, or a connection or timeout error) retry with exponential back-off; other errors surface immediately.
  - q: What causes a GraphRecursionError?
    a: The default recursion limit is 25 steps. Each node execution counts as one step. Increase it when invoking, or redesign your graph to use fewer steps per run.
  - q: What should I do about StaleStateError?
    a: This is a write conflict when two runs update the same thread simultaneously. The API returns HTTP 409. Reload the latest state and retry, or serialize access to the thread.
---

## The error model

Graph execution raises structured exceptions when nodes fail, storage operations conflict, or limits are exceeded. Rather than crash the system, 10xGraph distinguishes retryable errors (which the runtime can recover from automatically) from fatal errors (which are surfaced immediately for the caller to handle).

This lets you build resilient agents: brief network glitches are invisible, but genuine problems surface quickly with enough context to diagnose and fix them.

## Exception taxonomy

Graph-level exceptions (`GraphError`, `NodeError`, `NodeTimeoutError`, `GraphRecursionError`) live in `tenxgraph.core.exceptions`. Storage exceptions derive from `StorageError`, a separate base. Both bases carry an error code, a human-readable message, and a structured context dictionary.

### Graph and node errors

**GraphError** is the base exception for graph-related failures. It includes:
- `message`: Human-readable description
- `error_code`: Unique code (e.g., `GRAPH_000`)
- `context`: Dictionary with extra details (node name, input size, etc.)

**NodeError** is raised when a node fails to execute. This includes tool errors, user code exceptions inside a custom node, and LLM call failures that cannot be retried. The exception includes the node name in context so you can see which step failed.

**GraphRecursionError** occurs when the graph exceeds its recursion limit (default 25 steps). This is a safety mechanism to prevent infinite loops. Each node execution counts as one step, including a `ToolNode` run.

### Timeout errors

**NodeTimeoutError** (a subclass of `NodeError`) is raised when a node or tool execution exceeds its timeout. Without a bound, a hanging tool (a half-open socket in an MCP server, a custom tool that never returns, a database query with no read timeout) blocks the entire graph forever. The recursion limit never trips because no step completes, and stop signals are only checked between nodes, never within them.

Timing out the node converts that indefinite hang into a reportable error. Timeouts are on by default; see [Timeouts](#timeouts).

### Storage and concurrency errors

**StorageError** is the base for persistence layer failures: database errors, serialization problems, schema version mismatches, and conflicts. It is not a subclass of `GraphError`.

**TransientStorageError** is a retryable storage error: a connection drop, timeout, or transient database unavailability. `PgCheckpointer` retries connection-level failures itself (up to 3 attempts with exponential back-off) and raises this when it still cannot store state.

**SerializationError** indicates that state or messages could not be serialized to or deserialized from the checkpointer. This is usually fatal (your state structure is corrupted or incompatible), so it does not retry.

**SchemaVersionError** occurs when the checkpointer detects a schema version mismatch, usually after a code upgrade changes the state structure. May require migration; the exact recovery depends on your checkpointer.

**StaleStateError** is raised during an optimistic-concurrency check: two graph runs tried to update the same thread simultaneously, and one write succeeded before the other. The losing write is rejected to prevent a lost update. The HTTP API returns 409 Conflict. Reload the latest state and retry. `PgCheckpointer` raises it.

**ResourceNotFoundError** indicates a resource (thread, file, stored message) does not exist. Non-retryable.

### Resume errors

**InterruptMismatchError** (`INTERRUPT_001`) is raised when a resume names an interrupt (`resume_interrupt_id`) that is not the one the thread is paused at. **ResumeValidationError** (`INTERRUPT_002`) is raised when a resume value fails the interrupt's `response_schema`. Both are also `ValueError`s, and nothing is recorded. See [Interrupts](/docs/concepts/interrupts#bind-a-resume-to-its-interrupt).

### Other errors

**GraphStopRequested** is raised when a stop signal (from the API or client) is received while a node is running. This is control flow, not a failure: the execution loop catches it, marks the run stopped, and returns cleanly. It lets the stop check reach the caller even if a node is mid-execution.

**MetricsError** is the exception type for metrics emission failures (for example, OTEL export unavailable).

**UnsupportedMediaInputError** is raised before the provider call when a model cannot accept the given media type. For example, trying to send an image to a text-only model, or a document to a model that does not support documents. Includes a suggestion to switch models or change input format.

## Limits

### Recursion limit

The default recursion limit is 25 steps. Each node execution counts as one step. An Agent node and a `ToolNode` each count, so one model call plus one round of tool calls is two steps.

This prevents accidental infinite loops. Legitimate multi-turn flows (a ReAct loop with several tool rounds, for example) can exceed it. Increase it per call:

```python
result = graph.invoke(
    {"messages": [...]},
    config={"thread_id": "t1", "recursion_limit": 50},
)
```

When the limit is hit, the run raises `GraphRecursionError`.

### Timeouts

Both timeouts are on by default:

| Config key | Default | Applies to |
|---|---|---|
| `node_timeout` | 900 seconds | One node execution |
| `tool_timeout` | 300 seconds | One tool call |

Override them per run, or disable one with `None` or `0`. A timed-out node raises `NodeTimeoutError`:

```python
result = graph.invoke(
    {"messages": [...]},
    config={"thread_id": "t1", "node_timeout": 120, "tool_timeout": 60},
)
```

Defaults are in `tenxgraph/utils/constants.py`. Individual tools can also set their own timeouts with libraries that support them (for example, HTTP clients with read timeouts).

### Parallel tool calls

When a model returns several tool calls in one message, the tool node runs them in parallel, at most 10 at a time. Set a different cap with `config["max_parallel_tool_calls"]` or the `TENXGRAPH_MAX_PARALLEL_TOOL_CALLS` environment variable (the config key wins). A value that is not an integer of at least 1 logs a warning and falls back to 10.

### Tool failures and bad tool arguments

- **Unexpected tool errors are hidden from the model.** If a local or MCP tool raises, the model receives `Tool '<name>' failed with an internal error (reference <ref>)`. The full error and the same reference go to the server log, so an operator can match a user report to the failure. A raised `ValueError` is not shown verbatim either. To give the model a message it should act on, return it from the tool as a string. Tool timeouts, "Tool not found" and argument errors still reach the model.
- **Invalid tool arguments return a retryable error.** If the model's arguments are not a valid JSON object (for example, the response was cut off), the tool does not run. The model gets "Tool call arguments were not valid JSON (they may have been cut off). Call the tool again with a complete JSON object." and can try again.
- **`tools_tags` is enforced when the tool runs.** If an `Agent` is built with `tools_tags`, the tool node records which tools the model was shown and answers a call to any other tool with "Tool '<name>' not found." Hiding a tool from the model also stops it being executed.

### Checkpointer list paging

`alist_messages` and `alist_threads` return at most 1000 items per call (`MAX_LIST_LIMIT`). A larger `limit` is lowered to 1000, and a negative `limit` or `offset` raises `ValueError`. A `limit` of `None` or `0` means no limit was given, which is how in-process code reads a whole thread. Page through long threads with `offset`.

### Stop requests target a run

A stop request records the run it is meant for. Starting a new run on the same thread no longer clears a stop meant for a run that is still going, so a runaway tool loop in run 1 can still be stopped after run 2 has started. The checkpointer tracks the active run id per thread with `abegin_run`, `aend_run` and `aget_active_run`, and `ais_stop_requested` only reports a request that targets the config's `run_id`. A config with no `run_id` still matches an untargeted flag. This works on every backend with no schema change. See [Streaming](/docs/concepts/streaming).

### Per-turn loop counters

Round, iteration and retry budgets (such as `max_rounds` or `max_attempts` on the prebuilt agents) count one turn, not the whole thread. They are cleared when a new turn starts on a thread whose previous run finished. A resumed (paused) run keeps them. If you write your own multi-agent loop that keeps a counter in `internal_data`, register its key with `register_per_turn_key("my_counter")` from `tenxgraph.core.state.execution_state` at import time so it gets the same reset.

### Owner-only files

`SqliteCheckpointer` creates its database directory with mode 0o700 and the database file with mode 0o600. SQLite gives the `-wal` and `-shm` files the database file's mode, so they are owner-only too. An existing directory or file keeps its mode. The local media store uses the same modes. Cloud object stores are not affected; use their own access controls.

### Thread import scope

When you serve with `10xgraph-api` and an authorization backend, importing thread history (any role) needs the `checkpointer:import` scope (`CHECKPOINT_IMPORT`). It is never implied by an empty scope list, so grant it only to trusted admin identities. See [Authorization scopes](/docs/guides/authorization-scopes).

### Request size (API server)

The API server limits each request: at most 500 messages, 100 content blocks per message and 1,000,000 characters of text in total. A request over a limit gets 422. On AG-UI the limits apply to the trailing turn, and the full history gets a cap of 10,000 messages. The limits are fixed. See [Graph endpoints](/docs/reference/rest-api/graph).

### State and message size

There is no enforced maximum state size, but each state snapshot is persisted to the checkpointer. Storing very large state (gigabytes of uncompressed text) will stress your database. Trim context regularly with `MessageContextManager` or `SummaryContextManager` to keep state size reasonable. See [Context management](/docs/concepts/context-management).

## Retry and fallback behavior

The `Agent` class accepts `retry_config` and `fallback_models` parameters to control LLM call retry and fallback logic.

### RetryConfig

The `RetryConfig` dataclass controls retry behavior:

```python
from tenxgraph.core.graph import Agent, RetryConfig

retry = RetryConfig(
    max_retries=3,               # 3 retry attempts for the primary model
    initial_delay=1.0,           # Start with 1 second delay
    max_delay=30.0,              # Cap delay at 30 seconds
    backoff_factor=2.0,          # Double delay after each retry (1s, 2s, 4s, 8s...)
    retryable_status_codes=frozenset({429, 500, 502, 503, 529}),  # Retryable HTTP codes
    circuit_breaker_enabled=False,   # Optional: track failures per model
    circuit_breaker_threshold=5,     # Open circuit after 5 consecutive failures
    circuit_breaker_reset_timeout=30.0,  # Try again after 30 seconds
)

agent = Agent(
    model="openai/gpt-4o",
    retry_config=retry
)
```

Retries are on by default with `RetryConfig()` (3 retries, 1s initial delay, 2x backoff). Pass `retry_config=False` to disable them.

### What gets retried

LLM calls retry on:
- HTTP status codes 429 (rate limit), 500 (server error), 502/503 (gateway/service unavailable), 529 (provider overloaded)
- Connection-level errors (`ConnectionError`, `TimeoutError`, `OSError`) and exceptions whose class name contains `timeout`, `connection` or `unavailable`

These are temporary; the same request often succeeds on the next attempt.

### What does not retry

Anything outside the retryable set surfaces immediately:
- 401/403 (authentication/authorization failure): Fix credentials or permissions
- 404 (model not found): Use a valid model name
- Serialization/schema errors in storage: The state structure is broken
- User code exceptions in a custom node: Fix the code
- GraphRecursionError: Design the graph to use fewer steps

### Fallback models

If retries are exhausted on the primary model, try fallbacks:

```python
agent = Agent(
    model="openai/gpt-4o",
    fallback_models=["gpt-4o-mini", ("gemini-2.0-flash", "google")],
    retry_config=RetryConfig(max_retries=2),
)
```

Fallback occurs after `max_retries` on the current model. Each entry is a model name or a `(model, provider)` tuple. Each fallback gets its own retry budget. This lets you degrade gracefully: use your fast/cheap primary model, but fall back to a more capable model if rate-limited or if the primary is unavailable.

### Circuit breaker

The circuit breaker is off by default. When enabled, it tracks consecutive failures per (provider, model) pair. After `circuit_breaker_threshold` failures (default 5), the circuit opens and that model is skipped for `circuit_breaker_reset_timeout` (default 30s). This avoids repeatedly hammering a known-dead provider:

```python
retry = RetryConfig(
    circuit_breaker_enabled=True,
    circuit_breaker_threshold=3,
    circuit_breaker_reset_timeout=60.0,
)
```

Enable this if you have flaky providers or your quota is exhausted and retries fail fast anyway.

## Error recovery in streams

When a run fails while you stream it with `astream()`, the stream first yields a `StreamChunk` with `event=StreamEvent.ERROR` and the failure text in `chunk.data["reason"]`, and then the original exception is raised. Wrap the loop in `try/except` to handle the exception type:

```python
from tenxgraph.core.exceptions import GraphRecursionError, NodeError, StaleStateError
from tenxgraph.core.state import Message, StreamEvent

try:
    async for chunk in app.astream(
        {"messages": [Message.text_message("Hello")]},
        config={"thread_id": "t1"},
    ):
        if chunk.event == StreamEvent.ERROR:
            print("run failed:", chunk.data["reason"])
except StaleStateError:
    # Another run updated this thread. Reload the thread and retry.
    ...
except GraphRecursionError:
    # Raise recursion_limit or simplify the graph.
    ...
except NodeError as e:
    print(e.error_code, e.message)
    raise
```

On failure, the error is recorded in the state and the state is persisted before the exception propagates.

## HTTP API error responses

The REST API maps exceptions to status codes. Notable ones:

- **401 Unauthorized** and **403 Forbidden**: missing or invalid authentication, or insufficient permissions
- **404 Not Found**: thread or resource does not exist
- **409 Conflict**: `StaleStateError` (reload state and retry); a thread that is still busy with another run after 30 seconds (`thread is busy`); or a resume whose `interrupt_id` does not match the open interrupt
- **422 Unprocessable Entity**: request or validation errors (including requests over the size limits and a resume answer that fails `response_schema`), and `SchemaVersionError`
- **429 Too Many Requests**: rate limited
- **500 Internal Server Error**: `GraphError`, `NodeError`, `GraphRecursionError`, `StorageError` and other server-side failures; messages are sanitized when `MODE=production`
- **503 Service Unavailable**: `TransientStorageError`

Most errors use this body shape:

```json
{
  "error": {
    "code": "NODE_000",
    "message": "Node failed",
    "details": []
  },
  "metadata": {}
}
```

Outside `MODE=production`, `details` lists the exception's `context`, one entry per key: `{"loc": ["node_name"], "msg": "process_data", "type": "context"}`. In production it is always empty.

A `thread is busy` or interrupt mismatch `409` uses this standard shape, with `error.code` set to `HTTPException`. Only the stale-state conflict has its own shape:

```json
{
  "error": "state_conflict",
  "detail": "This thread was updated by another run while yours was in flight. Reload the thread and retry.",
  "thread_id": "abc123"
}
```

## Best practices

**Design for transience.** Assume any network-dependent operation (LLM call, database query, tool invocation) may fail once and succeed the next time. Set `retry_config` appropriately for your use case.

**Handle StaleStateError.** If your application has concurrent runs on the same thread, catch `StaleStateError` (or handle the 409) and reload state before retrying. Or serialize access to threads to avoid the conflict in the first place.

**Log and monitor.** Errors are logged with structured context; forward logs to your observability stack (Logfire, LangSmith, Datadog) to spot patterns.

**Validate input.** Catch errors early: validate user input before invoking the graph. Invalid input will fail all retries and delay error reporting.

**Test error paths.** Unit test your error handling: mock providers to return 429 or 503, raise `TransientStorageError` from a fake checkpointer, and check that fallback models are tried when the primary fails.

## Related pages

- [Checkpointing and threads](/docs/concepts/checkpointing-and-threads): Thread isolation and durability
- [Durability and concurrency](/docs/guides/durability-and-concurrency): Handling conflicts and concurrent access
- [Memory](/docs/concepts/memory): How PgCheckpointer stores state
- [Interrupts](/docs/concepts/interrupts): Pausing and resuming execution
