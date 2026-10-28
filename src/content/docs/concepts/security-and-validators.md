---
title: Security and Validators
description: "How input validators and PromptInjectionValidator work, the authorization model, and what the production template enables against injection and misuse."
section: Concepts
order: 170
group: Serving
updated: "2026-10-27"
---

Validators are checks that run on incoming messages before a graph executes them. A validator subclasses `BaseValidator`, is registered on a `CallbackManager`, and raises `ValidationError` to reject unsafe input. Authorization defines who can call which endpoints and which scopes a caller has inside the graph. Together, they form a two-layer security model. Both reduce risk but do not eliminate it. For the full list of what the server enforces and what it leaves to you, see the [Security model](/docs/production/security-model).

## The two protection layers

A 10xGraph system needs protection at two distinct boundaries, each with different tools.

**Server boundary: who may call what.** The API server controls access using JWT authentication or custom auth logic. Each authenticated request carries a `user_id` and a set of `scopes`. Every API endpoint checks scope permissions using the `resource:action` format (e.g., `graph:invoke`, `checkpointer:read`, `files:upload`). Inside a direct Python invocation (no API), the developer sets authorization in `config["authz"]`. The server also enforces CORS policies, request-size limits, and rate limits.

**Model boundary: what text reaches the model.** A user can inject instructions into a message, or a tool can fetch a document containing an attack. Validators run before the model sees input and reject suspicious content. Callbacks that inspect model output, tool calls, and tool results provide a second line of defense. Neither layer catches all attacks (indirect injection through tool results, for example), but combined they substantially reduce the attack surface.

## Authorization model

Authorization inside 10xGraph is built on two concepts: **isolation scope** and **scopes**.

**Isolation scope** controls multi-tenant data isolation. It can be `"owner"` (each user sees only their own threads and long-term data) or `"none"` (no isolation; data is not filtered by user, used in single-user deployments). When no explicit scope is set, storage backends apply their own default isolation policy.

**Scopes** are fine-grained permission strings in the format `resource:action`. A caller holds a list of scopes (e.g., `["graph:invoke", "checkpointer:read", "files:upload"]`). These are checked at three layers: the API server rejects calls that lack the required scope at the endpoint, nodes inside the graph can call `tenxgraph.core.authz.has_scope(config, "resource:action")` to check permissions, and tools receive the full authorization block in `config["authz"]` to enforce their own rules.

The canonical scope set (verified in `tenxgraph.core.authz`):

- **Graph execution:** `graph:invoke`, `graph:stream`, `graph:stop`, `graph:fix`, `graph:setup`, `graph:read`
- **Thread state and checkpointing:** `checkpointer:read`, `checkpointer:write`, `checkpointer:delete`, and the admin-only `checkpointer:import`
- **Long-term memory (store):** `store:read`, `store:write`, `store:delete`
- **Files and media:** `files:read`, `files:upload`, `files:delete`
- **Configuration:** `config:read`

If no authorization is present (common in direct SDK usage), the defaults are permissive: isolation is not enforced and all scopes are allowed. This means existing code without explicit auth continues to work unchanged.

## How validators run

When a run starts, validators are applied to the incoming messages before anything else executes. Here is the flow:

1. The caller submits messages (user input, resume values, etc.) to `invoke()` or `ainvoke()`.
2. Inside the graph, the runtime calls `validate_message_content()`, which invokes `CallbackManager.execute_validators()`.
3. Validators are called in the order they were registered, each awaited in sequence.
4. If a validator raises `ValidationError`, execution stops and the error is returned to the caller. If a publisher is configured, a rejection event is emitted.
5. If all validators pass, the graph continues normally.

Through the API server, a `ValidationError` becomes an HTTP 422 response with the error code `AGENTFLOW_VALIDATION_ERROR`. In production mode the message is sanitized; the `violation_type` is not included in the response.

Input validators see only messages entering the graph on fresh runs and continued threads (resume calls). They do not inspect model output or tool arguments. To guard those, use `register_before_invoke()` and `register_after_invoke()` callbacks (see [Callbacks and Command](/docs/concepts/callbacks-and-command)).

## Writing a validator

A validator is a subclass of `BaseValidator` with an `async validate(messages: list[Message]) -> bool` method. Raise `ValidationError(message, violation_type, details=None)` to reject input. The `violation_type` is a machine-readable string (e.g., `"pii_payment_card"`, `"content_policy"`) available on the exception for logging.

Here is a complete example: a validator that blocks known test credit card numbers and another that blocks offensive language.

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


class NoProfanity(BaseValidator):
    """Reject messages with offensive language from a local list."""
    
    blocked_words = {"badword1", "badword2", "offensive_term"}
    
    async def validate(self, messages: list[Message]) -> bool:
        for message in messages:
            text = message.text().lower()
            for word in self.blocked_words:
                if word in text:
                    raise ValidationError(
                        "Message contains prohibited language",
                        "content_policy"
                    )
        return True


# Wire them into a graph
callback_manager = CallbackManager()

# Register the built-in prompt injection validator
callback_manager.register_input_validator(
    PromptInjectionValidator(strict_mode=True, max_length=2000)
)

# Register custom validators
callback_manager.register_input_validator(NoCreditCardNumbers())
callback_manager.register_input_validator(NoProfanity())

# Compile the graph with the callback manager
# (AgentState and agent_node are your own state class and node function)
graph = StateGraph(AgentState)
graph.add_node("agent", agent_node)
# ... add edges and set entry point
app = graph.compile(callback_manager=callback_manager)
```

Validators run synchronously from the graph's perspective; make them fast and deterministic. Read from a database or call an LLM inside a validator only if absolutely necessary, as each call adds latency to every user message.

## Built-in validators

### PromptInjectionValidator

This validator detects prompt injection and jailbreak attempts using pattern matching, keyword analysis, and heuristics. It checks for:

- Excessive length (configurable, default 10000 characters)
- Regex patterns for common instruction-override tricks (e.g., `"ignore all previous instructions"`)
- Role manipulation attempts (e.g., `"you are now a ..."`, `"pretend as a ..."`)
- System prompt leakage techniques (e.g., `"Reveal the system prompt"`)
- Encoding obfuscation (Base64 payloads that decode to suspicious keywords, hidden Unicode tag characters, emoji variation selectors and bidirectional overrides, and Latin and Cyrillic letters mixed inside one word). Non-English text on its own is not flagged, so messages in any language pass.
- Delimiter confusion (e.g., `"--- END OF INSTRUCTIONS ---"`, `<system>` tags)
- Three or more suspicious keywords in a single message (e.g., `"bypass"`, `"override"`, `"reveal"`)

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
- **File tools.** `file_read`, `file_write` and `file_search` hide `.env`, key files and `.ssh`, `.aws`, `.gnupg` and `.git` folders by default, and `create_file_tools(root)` fixes the root in code. See [File tools](/docs/guides/prebuilt/file-tools).

## What the production template generates

When you run `10xgraph init --template production`, the generated project includes a security setup:

- `graph/validators/validators.py` defines a `PromptInjectionValidator(strict_mode=True, max_length=1000)` with domain-specific suspicious keywords: `"bypass"`, `"override"`, `"token"`, `"coupon"`, `"free"`, and others. **Tune this list to your product.** Words like `"free"` are normal in a customer-facing e-commerce app but may be red flags in a payment processing app.

- `graph/validators/manager.py` creates a `CallbackManager`, registers the validators, and registers an `AgentLifecycleHook` (a `GraphLifecycleHook` subclass).

- `graph/agent.py` passes the manager to `graph.compile(callback_manager=callback_manager)`.

The template also sets up `10xgraph.json` with an `auth` entry; choose the mode with `--auth none|jwt|custom`. The validators catch suspicious input before it reaches the model.

## Limitations and tradeoffs

- **Validators are heuristic.** A rephrased attack or one in a language the validator does not recognize may pass. A legitimate message with unlucky wording may be incorrectly rejected. Test with your real users.

- **Indirect injection is not covered.** If a tool fetches a document or web page containing malicious instructions, validators will not catch it. Mitigate by validating tool results inside tools before using them.

- **Validators do not replace authorization.** Narrow tool permissions, check scopes inside tools with `has_scope()`, and design tool side effects (refunds, deletions) to be idempotent and replay-safe so that authorization failures do not leave data in an inconsistent state.

- **Validators add latency.** Each message passes through every validator before the graph runs. Keep them fast; avoid I/O and LLM calls inside validators.

## Best practices

| Practice | Why |
|---|---|
| Keep validators deterministic and fast | They run on the critical path for every message. |
| Avoid LLM calls and I/O inside validators | Each call adds latency; nondeterminism makes debugging hard. |
| Raise `ValidationError` for policy failures, let exceptions propagate | Callers can distinguish a policy violation (422 in the API) from a system error (500). |
| Tune keyword and pattern lists to your domain | Generic keyword lists flag legitimate phrases in some products. |
| Log rejections without logging the rejected content | Rejected messages may contain secrets or PII. Use `violation_type` and metadata instead. |
| Test validators with real user messages | Validation is a safety feature that changes user experience; testing is critical. |

## Related concepts and guides

- [Callbacks and Command](/docs/concepts/callbacks-and-command): Inspect and transform messages at other execution points.
- [Validate input and guard prompts](/docs/guides/protect-against-prompt-injection): Practical guide to using validators and callbacks.
- [Read the caller's identity and scopes](/docs/guides/authorization-scopes): How to check scopes and isolation inside nodes and tools.
- [Server authentication and authorization](/docs/server/auth): API server setup for JWT, custom auth, and authorization backends.
