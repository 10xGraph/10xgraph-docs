---
title: Callback Manager
seoTitle: "CallbackManager API reference (Python)"
description: "Reference for CallbackManager, InvocationType, CallbackContext, the three callback base classes, and the prompt injection and message validators."
section: Reference
group: "Python library"
order: 140
label: Callback Manager
updated: "2026-10-08"
---

`CallbackManager` is the registry that runs your hooks around every model call, tool call, MCP call and skill call, and that runs input validators on incoming messages. You register callbacks per `InvocationType`, then pass the manager to `graph.compile(callback_manager=...)`. For worked patterns see [Use callbacks](/docs/guides/use-callbacks).

## Import paths

All names below are exported from `tenxgraph.utils`. The validators are also available from `tenxgraph.utils.validators`.

```python
# Callback system
from tenxgraph.utils import (
    CallbackManager,
    InvocationType,
    CallbackContext,
    BeforeInvokeCallback,
    AfterInvokeCallback,
    OnErrorCallback,
    BaseValidator,
)

# Validators
from tenxgraph.utils.validators import (
    PromptInjectionValidator,
    MessageContentValidator,
    ValidationError,
    register_default_validators,
)
```

## CallbackManager

`CallbackManager()` takes no arguments and starts with empty registries. Callbacks for the same type run in registration order, each receiving the output of the previous one.

```python
from tenxgraph.utils import CallbackManager

cbm = CallbackManager()
# app = graph.compile(callback_manager=cbm)
```

### Registration methods

| Method | Signature | Description |
|---|---|---|
| `register_before_invoke` | `(invocation_type, callback) -> None` | Run `callback` before an invocation of that type. |
| `register_after_invoke` | `(invocation_type, callback) -> None` | Run `callback` after an invocation of that type. |
| `register_on_error` | `(invocation_type, callback) -> None` | Run `callback` when an invocation of that type fails. |
| `register_input_validator` | `(validator: BaseValidator) -> None` | Add a validator for incoming messages. |
| `register_lifecycle_hook` | `(hook: GraphLifecycleHook) -> None` | Add a graph lifecycle hook. See [Lifecycle callbacks](/docs/reference/python/lifecycle-callbacks). |
| `clear_callbacks` | `(invocation_type: InvocationType \| None = None) -> None` | Remove before, after and error callbacks for one type, or for all types when `None`. Validators are not cleared. |
| `get_callback_counts` | `() -> dict[str, dict[str, int]]` | Counts per invocation type value, with keys `before_invoke`, `after_invoke` and `on_error`. |

Each `callback` may be an instance of the matching abstract class or a plain function (sync or async) with the same arguments.

### Execution methods

The framework calls these for you. You only call them directly in tests.

| Method | Signature | Returns |
|---|---|---|
| `execute_before_invoke` | `async (context, input_data)` | The input after all before callbacks. |
| `execute_after_invoke` | `async (context, input_data, output_data)` | The output after all after callbacks. |
| `execute_on_error` | `async (context, input_data, error)` | A `Message` from an error callback, or `None`. |
| `execute_validators` | `async (messages: list[Message], config: dict \| None = None)` | `True` when every validator passes. |

If a before or after callback raises, the manager runs the error callbacks for that type and then re-raises the exception. If an error callback itself raises, the failure is logged and the next error callback runs.

## InvocationType

`InvocationType` is a string enum that selects which kind of call a callback fires on.

| Value | Fires when |
|---|---|
| `InvocationType.AI` | The model provider is called. |
| `InvocationType.TOOL` | A local Python tool function is called. |
| `InvocationType.MCP` | An MCP tool call is made. |
| `InvocationType.INPUT_VALIDATION` | Reserved type. Validators registered with `register_input_validator` do not use it. |
| `InvocationType.SKILL` | The model calls a skill tool. `context.function_name` is the tool name. Skill tools fire `SKILL` instead of `TOOL`. |

## CallbackContext

`CallbackContext` is a pydantic model (keyword arguments only) passed as the first argument to every callback.

| Field | Type | Default | Description |
|---|---|---|---|
| `invocation_type` | `InvocationType` | required | The kind of call that fired the callback. |
| `node_name` | `str` | required | Name of the graph node that is executing. |
| `function_name` | `str \| None` | `None` | Name of the tool or skill function, when applicable. |
| `metadata` | `dict[str, Any] \| None` | `None` | Extra context from the framework. |

## BeforeInvokeCallback

`BeforeInvokeCallback` runs before the call and may modify its input. Implement `async __call__(self, context, input_data)` and return the input to use, which can be the same object. Raise an exception to stop the call.

```python
from tenxgraph.utils import (
    BeforeInvokeCallback,
    CallbackContext,
    CallbackManager,
    InvocationType,
)


class BlockEmptyInput(BeforeInvokeCallback):
    """Reject a model call that has no messages."""

    async def __call__(self, context: CallbackContext, input_data):
        if not input_data:
            raise ValueError(f"Empty input at node {context.node_name}")
        return input_data  # always return the input, modified or not


cbm = CallbackManager()
cbm.register_before_invoke(InvocationType.AI, BlockEmptyInput())
```

| Parameter | Type | Description |
|---|---|---|
| `context` | `CallbackContext` | Invocation metadata. |
| `input_data` | `Any` | The data about to be sent to the model, tool or MCP server. |

Returns the (possibly modified) input. Raises any exception to abort the invocation; the error callbacks run first.

To block a local or MCP tool call by policy, raise [`ToolDenied`](/docs/reference/python/exceptions#tooldenied) from a `before_invoke` callback for `InvocationType.TOOL` or `InvocationType.MCP`. The tool does not run, `on_error` recovery is skipped, and the model gets a failed result `"Denied by policy: <tool>. <reason>"`. A `before_invoke` callback of a tool or MCP call may also call `interrupt()`. `CallbackContext.node_name` for a tool call is the graph node that runs the tool.

## AfterInvokeCallback

`AfterInvokeCallback` runs after a successful call and may modify its output. Implement `async __call__(self, context, input_data, output_data)` and return the output to use.

```python
from tenxgraph.utils import (
    AfterInvokeCallback,
    CallbackContext,
    CallbackManager,
    InvocationType,
)


class AuditLogger(AfterInvokeCallback):
    """Log every completed model call."""

    async def __call__(self, context: CallbackContext, input_data, output_data):
        print(f"[audit] node={context.node_name} type={context.invocation_type.value}")
        return output_data  # keep the same type the framework expects


cbm = CallbackManager()
cbm.register_after_invoke(InvocationType.AI, AuditLogger())
```

| Parameter | Type | Description |
|---|---|---|
| `context` | `CallbackContext` | Invocation metadata. |
| `input_data` | `Any` | The input that was sent. |
| `output_data` | `Any` | The result returned by the call. |

Returns the (possibly modified) output. Return the same type you received, or the graph may fail downstream.

## OnErrorCallback

`OnErrorCallback` runs when an invocation fails. Implement `async __call__(self, context, input_data, error)`. Return a `Message` to offer a recovery value, or `None` to leave the error unhandled. Any other return value is ignored with a warning.

```python
from tenxgraph.core.state import Message
from tenxgraph.utils import (
    CallbackContext,
    CallbackManager,
    InvocationType,
    OnErrorCallback,
)


class FriendlyFallback(OnErrorCallback):
    """Substitute a plain message when a model call fails."""

    async def __call__(self, context: CallbackContext, input_data, error: Exception):
        print(f"Error in {context.node_name}: {error}")
        return Message.text_message("Sorry, something went wrong.", role="assistant")


cbm = CallbackManager()
cbm.register_on_error(InvocationType.AI, FriendlyFallback())
```

| Parameter | Type | Description |
|---|---|---|
| `context` | `CallbackContext` | Invocation metadata. |
| `input_data` | `Any` | The input that caused the error. |
| `error` | `Exception` | The exception that occurred. |

Returns `Message | None`. When several error callbacks run, the manager keeps the result of the last one.

## BaseValidator

`BaseValidator` is the abstract base for message validators. A validator needs one method, `async validate(self, messages: list[Message]) -> bool`, which returns `True` when the messages are acceptable and raises (usually `ValidationError`) when they are not. Validators run on new input messages before the graph executes.

```python
from tenxgraph.core.state import Message
from tenxgraph.utils import BaseValidator, CallbackManager
from tenxgraph.utils.validators import ValidationError


class TopicPolicyValidator(BaseValidator):
    """Reject messages that mention a blocked term."""

    async def validate(self, messages: list[Message]) -> bool:
        for msg in messages:
            if "competitor" in msg.text().lower():
                raise ValidationError(
                    "Off-topic content detected",
                    "topic_policy",
                    {"content": msg.text()[:100]},
                )
        return True


cbm = CallbackManager()
cbm.register_input_validator(TopicPolicyValidator())
```

## ValidationError

`ValidationError` is the exception validators raise. Its constructor is `ValidationError(message: str, violation_type: str, details: dict[str, Any] | None = None)`.

| Attribute | Type | Description |
|---|---|---|
| `violation_type` | `str` | Category of the failure, for example `"injection_pattern"`, `"length_exceeded"`, `"encoding_attack"`, `"suspicious_keywords"`, `"payload_splitting"`, `"invalid_role"` or `"too_many_blocks"`. |
| `details` | `dict[str, Any]` | Extra context such as the matched pattern or a content sample. Empty dict when not given. |

The human-readable message is available through `str(error)`.

## PromptInjectionValidator

`PromptInjectionValidator` checks message text against built-in patterns for prompt injection, jailbreak phrases, role manipulation, system prompt leakage, delimiter confusion and template injection (OWASP LLM01:2025). It also checks for oversized input, encoded payloads (base64, hex, heavy non-ASCII), several suspicious keywords in one message, and payload splitting markers.

```python
from tenxgraph.utils import CallbackManager
from tenxgraph.utils.validators import PromptInjectionValidator

validator = PromptInjectionValidator(
    strict_mode=True,                        # raise ValidationError on a violation
    max_length=10000,                        # longest allowed message text
    blocked_patterns=[r"(?i)internal\s+only"],  # extra regex patterns
    suspicious_keywords=["exfiltrate"],      # extra keywords
)

cbm = CallbackManager()
cbm.register_input_validator(validator)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `strict_mode` | `bool` | `True` | `True` raises `ValidationError`. `False` logs a warning and lets the message through. |
| `max_length` | `int` | `10000` | Maximum message text length in characters. |
| `blocked_patterns` | `list[str] \| None` | `None` | Extra regex patterns, added to the built-in set. |
| `suspicious_keywords` | `list[str] \| None` | `None` | Extra keywords, added to the built-in list. |

`validate(messages)` returns `True` or raises `ValidationError`. The built-in patterns are broad, so expect some false positives on legitimate text (for example words like "sudo" or very long tokens). Test with your real traffic before enabling strict mode in production.

## MessageContentValidator

`MessageContentValidator` checks message structure: the role must be allowed, and list content may not exceed a block limit.

```python
from tenxgraph.utils import CallbackManager
from tenxgraph.utils.validators import MessageContentValidator

validator = MessageContentValidator(
    allowed_roles=["user", "assistant", "system", "tool"],
    max_content_blocks=50,
)

cbm = CallbackManager()
cbm.register_input_validator(validator)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `allowed_roles` | `list[str] \| None` | `["user", "assistant", "system", "tool"]` | Roles accepted in input messages. |
| `max_content_blocks` | `int` | `50` | Maximum number of content blocks in one message. |

Raises `ValidationError` with `violation_type` `"invalid_role"` or `"too_many_blocks"`.

## register_default_validators

`register_default_validators(callback_manager, strict_mode=True)` registers a `PromptInjectionValidator` (with the given `strict_mode`) and a `MessageContentValidator` (with defaults) on the manager in one call.

```python
from tenxgraph.utils import CallbackManager
from tenxgraph.utils.validators import register_default_validators

cbm = CallbackManager()
register_default_validators(cbm, strict_mode=True)
# app = graph.compile(callback_manager=cbm)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `callback_manager` | `CallbackManager` | required | The manager to register on. |
| `strict_mode` | `bool` | `True` | Passed to `PromptInjectionValidator`. |

## Common errors

| Symptom | Cause | Fix |
|---|---|---|
| Callbacks never fire | The manager was not passed to `compile()`. | Call `graph.compile(callback_manager=cbm)`. |
| `ValidationError` escapes to the caller | Validators raise before the graph runs. | Wrap `invoke`, `ainvoke` or `astream` in `try/except ValidationError`. |
| Before callback sees an empty input | The call has no messages or arguments. | Check for empty `input_data` before iterating. |
| Graph breaks after an after callback | The callback returned a different type than `output_data`. | Return the same type you received. |
| Error callback result has no effect | It returned something other than a `Message` or `None`. | Return a `Message` to recover, or `None`. |
| Skill calls do not reach the `TOOL` callback | Skill tools fire `InvocationType.SKILL`. | Register the callback for `SKILL` as well. |
