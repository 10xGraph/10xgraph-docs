---
title: Security and Validators
description: "How input validators and PromptInjectionValidator work, how to write your own, and what the Full setup enables against injection and misuse."
section: Concepts
order: 170
group: "Platform"
updated: "2026-11-25"
---

Validators are checks that run on incoming messages before a graph executes them. A validator subclasses `BaseValidator`, is registered on a `CallbackManager`, and raises `ValidationError` to reject unsafe input. Authorization defines who can call which endpoints and which scopes a caller has inside the graph. Together, they form a two-layer security model. For the full list of what the server enforces and what it leaves to you, see the [Security model](/docs/production/security-model).

## The two protection layers

A 10xGraph system needs protection at two distinct boundaries, each with different tools.

**Server boundary: who may call what.** The API server controls access using JWT authentication or custom auth logic. Each authenticated request becomes an `Identity` with a `user_id`, permissions and a reach. Every API endpoint checks one permission in the `resource:action` format (e.g., `graph:invoke`, `threads:read`, `files:upload`). Inside a direct Python invocation (no API), the developer passes the identity in `config["user"]`. The server also enforces CORS policies, request-size limits, and rate limits.

**Model boundary: what text reaches the model.** A user can inject instructions into a message, or a tool can fetch a document containing an attack. Validators run before the model sees input and reject suspicious content. Callbacks that inspect model output, tool calls, and tool results provide a second line of defense. Tool results reach the model inside a fence by default, and `ToolGuard` can block or require approval for tool calls; see [Zero-trust agents](/docs/security/zero-trust-agents).

## Authorization model

Reach and permissions are explained in [Tenancy and access](/docs/concepts/tenancy-and-access), and the full permission list is in [Server authentication and authorization](/docs/server/auth). Inside a node or tool, check a permission with `tenxgraph.core.authz.can(config, "resource:action")`; with no identity in `config["user"]` it returns `True`.

## How validators run

When a run starts, validators are applied to the incoming messages before anything else executes. Here is the flow:

1. The caller submits messages (user input, resume values, etc.) to `invoke()` or `ainvoke()`.
2. Inside the graph, the runtime calls `validate_message_content()`, which invokes `CallbackManager.execute_validators()`.
3. Validators are called in the order they were registered, each awaited in sequence.
4. If a validator raises `ValidationError`, execution stops and the error is returned to the caller. If a publisher is configured, a rejection event is emitted.

Through the API server, a `ValidationError` becomes an HTTP 422 response with the error code `VALIDATION_ERROR`. In production mode the message is sanitized; the `violation_type` is not included in the response.

Input validators see only messages entering the graph on fresh runs and continued threads (resume calls). They do not inspect model output or tool arguments. To guard those, use `register_before_invoke()` and `register_after_invoke()` callbacks (see [Callbacks and Command](/docs/concepts/callbacks-and-command)). For tool, MCP and RAG results, the guide [Validate tool, MCP and RAG output](/docs/guides/protect-against-prompt-injection#validate-tool-mcp-and-rag-output) has a working `after_invoke` example.

## Writing a validator

A validator is a subclass of `BaseValidator` with an `async validate(messages: list[Message]) -> bool` method. Raise `ValidationError(message, violation_type, details=None)` to reject input. The `violation_type` is a machine-readable string (e.g., `"pii_payment_card"`, `"content_policy"`) available on the exception for logging.

```python
from tenxgraph import StateGraph
from tenxgraph.core.state import Message
from tenxgraph.utils.callbacks import BaseValidator, CallbackManager
from tenxgraph.utils.validators import PromptInjectionValidator, ValidationError

class NoCreditCardNumbers(BaseValidator):
    """Reject messages containing known test credit card patterns."""
    
    async def validate(self, messages: list[Message]) -> bool:
        test_cards = {
            "4111111111111111",  # Visa test
            "5555555555554444",  # Mastercard test
            "378282246310005",   # American Express test
        }
        
        for message in messages:
            text = message.text().replace(" ", "").replace("-", "")
            for card in test_cards:
                if card in text:
                    raise ValidationError(
                        f"Test card number detected: {card[:4]}****",
                        "pii_payment_card",
                        details={"pattern": "credit_card"}
                    )
        return True

# Wire it into a graph
callback_manager = CallbackManager()

# Register the built-in prompt injection validator
callback_manager.register_input_validator(
    PromptInjectionValidator(strict_mode=True, max_length=2000)
)

# Register the custom validator
callback_manager.register_input_validator(NoCreditCardNumbers())

# Compile the graph with the callback manager
# (AgentState and agent_node are your own state class and node function)
graph = StateGraph(AgentState)
graph.add_node("agent", agent_node)
# ... add edges and set entry point
app = graph.compile(callback_manager=callback_manager)
```

## Built-in validators

### PromptInjectionValidator

This validator detects prompt injection and jailbreak attempts with patterns and keywords. The full list of what it catches is in [What the default validator detects](/docs/guides/protect-against-prompt-injection#what-the-default-validator-detects). NUL characters are refused even with no validator registered.

It reads message text only (text, tool results, document excerpts, tool call arguments), not state or config. Anything beyond this list is your responsibility: write a `BaseValidator` subclass and register it with `register_input_validator()` (see [Writing a validator](#writing-a-validator)).

Constructor parameters:

- `strict_mode=True` (default): Raises `ValidationError` on detection.
- `strict_mode=False`: Logs a warning and allows the message through without raising (useful for auditing without breaking the user experience). Pattern matching then covers only the first `max_length` characters.
- `max_length=10000` (default): Rejects messages longer than this. The length check runs before any pattern matching.
- `blocked_patterns=None` (optional): Add custom regex patterns to block.
- `suspicious_keywords=None` (optional): Add domain-specific suspicious keywords (e.g., `["refund", "cancel", "override"]` for a support agent).

```python
validator = PromptInjectionValidator(
    strict_mode=True,
    max_length=1000,
    suspicious_keywords=["bypass", "secret_code", "admin_key"]
)
```

### MessageContentValidator

Validates the structure of messages themselves, independent of content. It checks:

- Allowed message roles (default `"user"`, `"assistant"`, `"system"`, `"tool"`)
- Maximum number of content blocks per message (default 50)

Constructor parameters:

- `allowed_roles=None` (default: user, assistant, system, tool)
- `max_content_blocks=50` (default)

### register_default_validators

Convenience function to register both `PromptInjectionValidator` and `MessageContentValidator` with standard settings.

```python
from tenxgraph.utils.validators import register_default_validators

callback_manager = CallbackManager()
register_default_validators(callback_manager, strict_mode=True)
```

## Files and media URLs

Media that a client sends is untrusted input. Three defaults protect the server:

- **Media URLs.** Where the server downloads a client's media URL (Google GenAI, the Google File API, inline bytes), the download follows a `MediaFetchPolicy`: public hosts only, `http` and `https` only, redirects re-checked, 20 MiB and 10 seconds by default. The API checks client URLs before the run and returns `400` for a blocked one. A client `gs://` URL is refused unless its bucket is in `allowed_gcs_buckets`. See [Sending media from Python](/docs/guides/send-media#control-which-urls-the-server-downloads).
- **Uploads.** The API compares the first bytes of an upload with its declared type (`415` on a mismatch), caps text extraction, lets only the owner delete a file (`files:delete`) and deletes files when the messages and threads that use them are deleted. See [Files and multimodal on the server](/docs/server/files-and-multimodal).
- **File tools (deprecated in 1.1.0, removed in 2.0).** `file_read`, `file_write` and `file_search` hide `.env`, key files and `.ssh`, `.aws`, `.gnupg` and `.git` folders by default, and `create_file_tools(root)` fixes the root in code. See [File tools](/docs/guides/prebuilt/file-tools).

## What the Full setup generates

When you run `10xgraph init --mode full`, the generated project includes a security setup:

- `graph/validators/validators.py` defines a `PromptInjectionValidator(strict_mode=True, max_length=10000)` with a short list of suspicious keywords (`"ignore previous"`, `"forget previous"`, `"disregard previous"`, `"circumvent"`, `"remove restrictions"`, `"coupon"`). **Tune this list to your product.** Keywords match whole words.

- `graph/validators/manager.py` creates a `CallbackManager`, registers the validators, and registers an `AgentLifecycleHook` (a `GraphLifecycleHook` subclass).

- `graph/agent.py` passes the manager to `graph.compile(callback_manager=callback_manager)`.

The template also sets up `10xgraph.json` with an `auth` entry; choose the mode with `--auth none|jwt|custom`.

## How tool output and authorization fit in

- **Tool, MCP and RAG output is checked with a callback.** Input validators run on the messages entering the graph. For content a tool fetches, such as a document or web page, you add an `after_invoke` callback on `InvocationType.TOOL` and `InvocationType.MCP`. It can check, edit or replace any result before the model reads it, and it can reuse `PromptInjectionValidator` inside. For checks on graph state, register a `GraphLifecycleHook`. See [Validate tool, MCP and RAG output](/docs/guides/protect-against-prompt-injection#validate-tool-mcp-and-rag-output) and [Where each check runs](/docs/guides/protect-against-prompt-injection#where-each-check-runs).

- **Authorization is a separate layer.** Tools check access with the verified user in `config` and `can()`. Narrow tool permissions, and design tool side effects (refunds, deletions) to be idempotent and replay-safe.

## Best practices

| Practice | Why |
|---|---|
| Keep validators deterministic and fast | They run on the critical path for every message. |
| Raise `ValidationError` for policy failures, let exceptions propagate | Callers can distinguish a policy violation (422 in the API) from a system error (500). |
| Tune keyword and pattern lists to your domain | Generic keyword lists flag legitimate phrases in some products. |
| Log rejections without logging the rejected content | Rejected messages may contain secrets or PII. Use `violation_type` and metadata instead. |

## Related concepts and guides

- [Callbacks and Command](/docs/concepts/callbacks-and-command): Inspect and transform messages at other execution points.
- [Validate input and guard prompts](/docs/guides/protect-against-prompt-injection): Practical guide to using validators and callbacks.
- [Read the caller's identity and scopes](/docs/guides/authorization-scopes): How to check permissions and reach inside nodes and tools.
- [Server authentication and authorization](/docs/server/auth): API server setup for JWT, custom auth, roles, permissions and reach.
