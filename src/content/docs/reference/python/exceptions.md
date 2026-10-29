---
title: "Exceptions"
description: "Exception hierarchy for graph execution, storage, timeouts, and media validation errors."
order: 120
group: "Python library"
section: Reference
updated: "2026-10-27"
---

10xGraph raises typed exceptions that distinguish retryable storage failures from permanent errors, execution faults from control flow, and capability mismatches from input corruption. Most carry an error code and a context dict, and serialize to a dictionary through `to_dict()`. This page lists every class in `tenxgraph.core.exceptions`, with signatures, defaults and examples.

```python
from tenxgraph.core.exceptions import (
    GraphError,
    GraphRecursionError,
    GraphStopRequested,
    InterruptMismatchError,
    MetricsError,
    NodeError,
    NodeTimeoutError,
    ResourceNotFoundError,
    ResumeValidationError,
    SchemaVersionError,
    SerializationError,
    StaleStateError,
    StorageError,
    TransientStorageError,
)

# Not re-exported from the package, import it from its module
from tenxgraph.core.exceptions.media_exceptions import UnsupportedMediaInputError
```

## Exception hierarchy and API status codes

Most 10xGraph exceptions carry an `error_code`, a `message` and a `context` dict, and share a `to_dict()` method. Exception context is redacted in logs, but `err.context` keeps the real values, so do not forward it to a client unfiltered. For exceptions that are not 10xGraph's own, the text a client sees (the stream `ERROR` chunk `reason` and `state.error`) shows only the exception type; server logs keep the full text. When you run the API server, its error handlers map each class to an HTTP status, shown below. Subclasses fall under their parent's handler unless the table lists them.

```text
Exception
  GraphError
    NodeError
      NodeTimeoutError
    GraphRecursionError
    InterruptMismatchError (also ValueError)
    ResumeValidationError (also ValueError)
  GraphStopRequested
  StorageError
    TransientStorageError
    SerializationError
    SchemaVersionError
    StaleStateError
    ResourceNotFoundError
  MetricsError
  UnsupportedMediaInputError
```

| Exception | HTTP status from the API server |
|---|---|
| GraphError, NodeError, NodeTimeoutError, GraphRecursionError | 500 |
| StorageError, SerializationError, ResourceNotFoundError | 500 |
| TransientStorageError | 503 |
| SchemaVersionError | 422 |
| StaleStateError | 409 |
| InterruptMismatchError | 409 (raised by a resume that names the wrong interrupt) |
| ResumeValidationError | 422 |
| MetricsError | 500 |

`str(error)` returns `"[error_code] message"`. Each constructor also logs the error on the `tenxgraph.exceptions` logger.

## GraphError

Base exception for graph-related errors.

**Signature**

```python
class GraphError(Exception):
    def __init__(
        self,
        message: str,
        error_code: str = "GRAPH_000",
        context: dict[str, Any] | None = None,
    ) -> None: ...
```

**Parameters**

| Name | Type | Default | Description |
|---|---|---|---|
| message | str | Required | Human-readable description of the error. |
| error_code | str | `"GRAPH_000"` | Unique error code for categorization. |
| context | dict[str, Any] \| None | None | Additional contextual information (JSON-serializable). |

**Attributes**

| Name | Type | Description |
|---|---|---|
| message | str | The error message. |
| error_code | str | The error code. |
| context | dict[str, Any] | Contextual data. |

**Methods**

| Name | Return | Description |
|---|---|---|
| to_dict() | dict[str, Any] | Returns structured error with error_type, error_code, message, and context. |

**Example**

```python
from tenxgraph.core.exceptions import GraphError

try:
    raise GraphError(
        message="Invalid graph structure",
        error_code="GRAPH_001",
        context={"node_count": 5},
    )
except GraphError as e:
    print(e.to_dict())
    # {'error_type': 'GraphError', 'error_code': 'GRAPH_001', ...}
```

## NodeError

Exception for node-specific errors; inherits from GraphError.

**Signature**

```python
class NodeError(GraphError):
    def __init__(
        self,
        message: str,
        error_code: str = "NODE_000",
        context: dict[str, Any] | None = None,
    ) -> None: ...
```

**Parameters**

| Name | Type | Default | Description |
|---|---|---|---|
| message | str | Required | Description of the node error. |
| error_code | str | `"NODE_000"` | Unique error code for categorization. |
| context | dict[str, Any] \| None | None | Additional contextual information. |

**Base class**: GraphError

**Example**

```python
from tenxgraph.core.exceptions import NodeError

raise NodeError(
    message="Node failed to execute",
    error_code="NODE_001",
    context={"node_name": "process_data"},
)
```

## NodeTimeoutError

Raised when a node or tool exceeds its allotted execution time; inherits from NodeError.

Timing out a hanging node (a half-open socket in an MCP tool, a custom tool that never returns) converts indefinite hangs into recoverable node errors that the execution loop can persist and retry.

**Signature**

```python
class NodeTimeoutError(NodeError):
    def __init__(
        self,
        message: str,
        error_code: str = "NODE_TIMEOUT_000",
        context: dict[str, Any] | None = None,
    ) -> None: ...
```

**Parameters**

| Name | Type | Default | Description |
|---|---|---|---|
| message | str | Required | Description of the timeout. |
| error_code | str | `"NODE_TIMEOUT_000"` | Unique error code for categorization. |
| context | dict[str, Any] \| None | None | Additional contextual information. |

**Base class**: NodeError

**Example**

```python
from tenxgraph.core.exceptions import NodeTimeoutError

raise NodeTimeoutError(
    message="Node 'fetch' exceeded its 300s timeout",
    error_code="NODE_TIMEOUT_001",
    context={"node_name": "fetch", "timeout": 300.0},
)
```

## GraphRecursionError

Raised when graph execution exceeds the recursion limit; inherits from GraphError.

The default recursion limit is 25. Exceeding it typically indicates an infinite loop or misconfigured conditional routing.

**Signature**

```python
class GraphRecursionError(GraphError):
    def __init__(
        self,
        message: str,
        error_code: str = "RECURSION_000",
        context: dict[str, Any] | None = None,
    ) -> None: ...
```

**Parameters**

| Name | Type | Default | Description |
|---|---|---|---|
| message | str | Required | Description of the recursion error. |
| error_code | str | `"RECURSION_000"` | Unique error code for categorization. |
| context | dict[str, Any] \| None | None | Additional contextual information (e.g., recursion_depth, max_depth). |

**Base class**: GraphError

**Example**

```python
from tenxgraph.core.exceptions import GraphRecursionError

raise GraphRecursionError(
    message="Recursion limit exceeded",
    error_code="RECURSION_001",
    context={"recursion_depth": 26, "max_depth": 25},
)
```

## InterruptMismatchError

Raised when a resume names an interrupt that is not the one the thread is paused at. Inherits from `GraphError` and `ValueError`, so handlers for a bad resume keep working.

A resume can carry `resume_interrupt_id` (the `id` of the pending interrupt). If it differs from the pending id, for example in a stale tab or a retried request, the answer is rejected and nothing is recorded.

**Signature**

```python
class InterruptMismatchError(GraphError, ValueError):
    def __init__(
        self,
        message: str,
        error_code: str = "INTERRUPT_001",
        context: dict[str, Any] | None = None,
    ) -> None: ...
```

**Base classes**: GraphError, ValueError

**Example**

```python
from tenxgraph.core.exceptions import InterruptMismatchError

try:
    await app.ainvoke(
        {"resume": {"approved": True}, "resume_interrupt_id": "int_a"},
        config,
    )
except InterruptMismatchError as e:
    print(e.context)  # {"expected": "<pending id>", "received": "int_a"}
```

See [Interrupts](/docs/concepts/interrupts#bind-a-resume-to-its-interrupt).

## ResumeValidationError

Raised when a resume value does not satisfy the pending interrupt's `response_schema`. Nothing is recorded. Inherits from `GraphError` and `ValueError`. A `None` resume (a cancel) is never checked.

The check supports the JSON Schema keywords `type`, `enum`, `properties`, `required` and `items` (a single schema), and ignores any other keyword.

**Signature**

```python
class ResumeValidationError(GraphError, ValueError):
    def __init__(
        self,
        message: str,
        error_code: str = "INTERRUPT_002",
        context: dict[str, Any] | None = None,
    ) -> None: ...
```

**Base classes**: GraphError, ValueError

The `context` holds `interrupt_id` and `errors`, a list of problems such as `$.approved: expected boolean`.

## GraphStopRequested

Signals that a stop was requested while a node was still running; not a failure but control flow.

This is raised internally to distinguish a cooperative stop from a genuine error. The execution loop catches it, marks the run stopped, persists that state, and returns normally without raising.

**Signature**

```python
class GraphStopRequested(Exception):
    def __init__(self, node_name: str | None = None) -> None: ...
```

**Parameters**

| Name | Type | Default | Description |
|---|---|---|---|
| node_name | str \| None | None | Name of the node that was running when stop was requested. |

**Attributes**

| Name | Type | Description |
|---|---|---|
| node_name | str \| None | The name of the node, if known. |

**Example**

```python
from tenxgraph.core.exceptions import GraphStopRequested

# Typically raised by the execution loop during stop handling
raise GraphStopRequested(node_name="fetch_data")
```

## StorageError

Base exception for non-retryable storage layer errors; inherits from Exception.

Provides structured error handling with error codes and context. Subclasses distinguish retryable transient failures from permanent ones.

**Signature**

```python
class StorageError(Exception):
    def __init__(
        self,
        message: str,
        error_code: str = "STORAGE_000",
        context: dict[str, Any] | None = None,
    ) -> None: ...
```

**Parameters**

| Name | Type | Default | Description |
|---|---|---|---|
| message | str | Required | Description of the error. |
| error_code | str | `"STORAGE_000"` | Unique error code for categorization. |
| context | dict[str, Any] \| None | None | Additional contextual information. |

**Attributes**

| Name | Type | Description |
|---|---|---|
| message | str | The error message. |
| error_code | str | The error code. |
| context | dict[str, Any] | Contextual data. |

**Methods**

| Name | Return | Description |
|---|---|---|
| to_dict() | dict[str, Any] | Returns structured error with error_type, error_code, message, and context. |

**Example**

```python
from tenxgraph.core.exceptions import StorageError

raise StorageError(
    message="Database connection failed",
    error_code="STORAGE_001",
    context={"host": "db.example.com"},
)
```

## TransientStorageError

Retryable storage error (connection drops, timeouts); inherits from StorageError.

These errors indicate temporary failures that may succeed on retry. The caller should retry with exponential backoff. The API server returns HTTP 503 for it.

**Signature**

```python
class TransientStorageError(StorageError):
    def __init__(
        self,
        message: str,
        error_code: str = "STORAGE_TRANSIENT_000",
        context: dict[str, Any] | None = None,
    ) -> None: ...
```

**Parameters**

| Name | Type | Default | Description |
|---|---|---|---|
| message | str | Required | Description of the transient error. |
| error_code | str | `"STORAGE_TRANSIENT_000"` | Unique error code for categorization. |
| context | dict[str, Any] \| None | None | Additional contextual information. |

**Base class**: StorageError

**Example**

```python
from tenxgraph.core.exceptions import TransientStorageError

raise TransientStorageError(
    message="Redis connection timeout",
    error_code="STORAGE_TRANSIENT_001",
    context={"timeout": 5.0},
)
```

## SerializationError

Raised when serialization or deserialization of state and messages fails; inherits from StorageError.

This is a permanent failure in data marshaling, not a transient issue. It typically indicates corrupted data or a schema mismatch.

**Signature**

```python
class SerializationError(StorageError):
    def __init__(
        self,
        message: str,
        error_code: str = "STORAGE_SERIALIZATION_000",
        context: dict[str, Any] | None = None,
    ) -> None: ...
```

**Parameters**

| Name | Type | Default | Description |
|---|---|---|---|
| message | str | Required | Description of the serialization error. |
| error_code | str | `"STORAGE_SERIALIZATION_000"` | Unique error code for categorization. |
| context | dict[str, Any] \| None | None | Additional contextual information. |

**Base class**: StorageError

**Example**

```python
from tenxgraph.core.exceptions import SerializationError

raise SerializationError(
    message="Failed to deserialize message content",
    error_code="STORAGE_SERIALIZATION_001",
    context={"message_id": "msg_123"},
)
```

## SchemaVersionError

Raised when schema version detection or migration fails; inherits from StorageError.

This indicates a mismatch between the database schema and the code expectations, typically during startup or upgrade.

**Signature**

```python
class SchemaVersionError(StorageError):
    def __init__(
        self,
        message: str,
        error_code: str = "STORAGE_SCHEMA_000",
        context: dict[str, Any] | None = None,
    ) -> None: ...
```

**Parameters**

| Name | Type | Default | Description |
|---|---|---|---|
| message | str | Required | Description of the schema version error. |
| error_code | str | `"STORAGE_SCHEMA_000"` | Unique error code for categorization. |
| context | dict[str, Any] \| None | None | Additional contextual information. |

**Base class**: StorageError

**Example**

```python
from tenxgraph.core.exceptions import SchemaVersionError

raise SchemaVersionError(
    message="Database schema version 3 not supported by code version 2.0",
    error_code="STORAGE_SCHEMA_001",
    context={"db_version": 3, "code_version": 2},
)
```

## StaleStateError

Raised when a durable state write loses an optimistic-concurrency check; inherits from StorageError.

The writer based its update on a state version that is no longer current because another execution committed a newer state for the same thread in the meantime. Committing anyway would silently discard that other execution's work, so the write is rejected. The caller should reload the latest state and retry.

**Signature**

```python
class StaleStateError(StorageError):
    def __init__(
        self,
        message: str,
        error_code: str = "STORAGE_CONFLICT_000",
        context: dict[str, Any] | None = None,
    ) -> None: ...
```

**Parameters**

| Name | Type | Default | Description |
|---|---|---|---|
| message | str | Required | Description of the concurrency conflict. |
| error_code | str | `"STORAGE_CONFLICT_000"` | Unique error code for categorization. |
| context | dict[str, Any] \| None | None | Additional contextual information (e.g., thread_id, expected_version, actual_version). |

**Base class**: StorageError

**API response**: HTTP 409 Conflict

**Example**

```python
from tenxgraph.core.exceptions import StaleStateError

raise StaleStateError(
    message="State was updated by another execution",
    error_code="STORAGE_CONFLICT_001",
    context={"thread_id": "thread_abc", "expected_version": 5, "actual_version": 6},
)
```

## ResourceNotFoundError

Raised when a requested resource is not found in storage; inherits from StorageError.

**Signature**

```python
class ResourceNotFoundError(StorageError):
    def __init__(
        self,
        message: str,
        error_code: str = "STORAGE_NOT_FOUND_000",
        context: dict[str, Any] | None = None,
    ) -> None: ...
```

**Parameters**

| Name | Type | Default | Description |
|---|---|---|---|
| message | str | Required | Description of the not found error. |
| error_code | str | `"STORAGE_NOT_FOUND_000"` | Unique error code for categorization. |
| context | dict[str, Any] \| None | None | Additional contextual information (e.g., thread_id, resource_type). |

**Base class**: StorageError

**Example**

```python
from tenxgraph.core.exceptions import ResourceNotFoundError

raise ResourceNotFoundError(
    message="Thread not found",
    error_code="STORAGE_NOT_FOUND_001",
    context={"thread_id": "thread_xyz"},
)
```

## MetricsError

Raised when metrics emission fails; inherits from Exception.

Metrics failures are typically non-critical and should be logged but not propagated. Catch and log it rather than letting it stop a run.

**Signature**

```python
class MetricsError(Exception):
    def __init__(
        self,
        message: str,
        error_code: str = "METRICS_000",
        context: dict[str, Any] | None = None,
    ) -> None: ...
```

**Parameters**

| Name | Type | Default | Description |
|---|---|---|---|
| message | str | Required | Description of the metrics error. |
| error_code | str | `"METRICS_000"` | Unique error code for categorization. |
| context | dict[str, Any] \| None | None | Additional contextual information. |

**Attributes**

| Name | Type | Description |
|---|---|---|
| message | str | The error message. |
| error_code | str | The error code. |
| context | dict[str, Any] | Contextual data. |

**Methods**

| Name | Return | Description |
|---|---|---|
| to_dict() | dict[str, Any] | Returns structured error with error_type, error_code, message, and context. |

**Example**

```python
from tenxgraph.core.exceptions import MetricsError

try:
    raise MetricsError(
        message="Failed to send metrics to collector",
        error_code="METRICS_001",
        context={"collector": "prometheus"},
    )
except MetricsError:
    # Log and continue; do not fail execution
    pass
```

## UnsupportedMediaInputError

Raised when a provider or model cannot accept a given media input; inherits from Exception.

This error is raised before the provider call when the target model does not support the media type or no viable transport path exists. If you omit `message`, one is built from the other parameters and ends with a suggestion, such as using a vision-capable model for images or uploading the file first for URLs.

**Signature**

```python
class UnsupportedMediaInputError(Exception):
    def __init__(
        self,
        provider: str,
        model: str,
        media_type: str,
        source_kind: str,
        transports_attempted: list[MediaTransportMode] | None = None,
        message: str | None = None,
    ) -> None: ...
```

**Parameters**

| Name | Type | Default | Description |
|---|---|---|---|
| provider | str | Required | Provider identifier (e.g. "openai", "google", "anthropic"). |
| model | str | Required | Model name (e.g. "gpt-4o", "gemini-1.5-pro"). |
| media_type | str | Required | Type of media (e.g. "image", "document", "audio"). |
| source_kind | str | Required | How the media was provided: "url", "file_id", "data", or "internal_ref". |
| transports_attempted | list[MediaTransportMode] \| None | None | List of transport modes that were tried before giving up. |
| message | str \| None | None | Custom error message; if None, one is built from the parameters. |

**Attributes**

| Name | Type | Description |
|---|---|---|
| provider | str | Provider identifier. |
| model | str | Model name. |
| media_type | str | Type of media. |
| source_kind | str | Source kind (url, file_id, data, internal_ref). |
| transports_attempted | list[MediaTransportMode] | The transports that were attempted. |
| message | str | The error message. |

**Methods**

| Name | Return | Description |
|---|---|---|
| to_dict() | dict[str, Any] | Returns error_type, provider, model, media_type, source_kind, transports_attempted (as a list of string values), and message. |

**Example**

```python
from tenxgraph.core.exceptions import UnsupportedMediaInputError
from tenxgraph.storage.media.capabilities import MediaTransportMode

raise UnsupportedMediaInputError(
    provider="openai",
    model="gpt-4o",
    media_type="audio",
    source_kind="url",
    transports_attempted=[MediaTransportMode.remote_url],
)
```
