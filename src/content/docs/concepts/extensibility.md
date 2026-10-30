---
title: Extension points
seoTitle: "Extending 10xGraph with base classes"
description: "Abstract base classes in 10xGraph let you customize storage, auth, LLM integration, and event publishing without changing graph logic."
section: Concepts
order: 210
group: "Serving"
updated: "2026-10-08"
faq:
  - q: "Why extend a base class instead of modifying the code?"
    a: "Extensions let you swap implementations at runtime without modifying the framework code or graph logic. You keep your custom backend in your own codebase and pass it to `StateGraph(...)`, `compile()` or `10xgraph.json`."
  - q: "Can I extend multiple base classes in the same graph?"
    a: "Yes. You can extend a checkpointer for storage, a publisher for events, and an authorization backend all in the same graph. They compose independently."
  - q: "Which base classes go in compile() vs 10xgraph.json?"
    a: "Checkpointer, store and media_store go in compile(). Context manager, publisher and ID generator go in the StateGraph constructor. Auth, authorization and thread_name_generator are set in 10xgraph.json; a custom rate-limit backend is bound in the InjectQ container."
---

10xGraph's major components are built on abstract base classes. Extend any of them to swap storage backends, auth mechanisms, LLM providers, ID schemes, rate limiting, or event routing. Your graph logic stays unchanged. This page explains the pattern and shows when and how to extend each.

---

## Extension points at a glance

```mermaid
flowchart TB
  subgraph "Storage"
    BCP[BaseCheckpointer]
    BS[BaseStore]
    BE[BaseEmbedding]
    BMS[BaseMediaStore]
  end
  subgraph "Agent & LLM"
    BA[BaseAgent]
    BC[BaseConverter]
    BCM[BaseContextManager]
  end
  subgraph "API / Server"
    BAUTH[BaseAuth]
    BAUTHZ[AuthorizationBackend]
    BRL[BaseRateLimitBackend]
    TNG[ThreadNameGenerator]
    BID[BaseIDGenerator]
  end
  subgraph "Events & QA"
    BP[BasePublisher]
    BV[BaseValidator]
    BCR[BaseCriterion]
    BR[BaseReporter]
  end
  YOUR[Your Subclass] -->|extend any| BCP & BS & BE & BMS
  YOUR -->|extend any| BA & BC & BCM
  YOUR -->|extend any| BAUTH & BAUTHZ & BRL & TNG & BID
  YOUR -->|extend any| BP & BV & BCR & BR
```

| ABC | File | What you override |
|---|---|---|
| `BaseAgent` | `tenxgraph/core/graph/base_agent.py` | `execute()`, `_call_llm()` |
| `BaseContextManager` | `tenxgraph/core/state/base_context.py` | `trim_context()`, `atrim_context()` |
| `BaseCheckpointer` | `tenxgraph/storage/checkpointer/base_checkpointer.py` | Async state, cache, message and thread methods |
| `BaseStore` | `tenxgraph/storage/store/base_store.py` | `astore()`, `asearch()`, `aget()`, `aget_all()`, `aupdate()`, `adelete()`, `aforget_memory()` |
| `BaseEmbedding` | `tenxgraph/storage/store/embedding/base_embedding.py` | `aembed()`, `aembed_batch()`, `dimension` |
| `BaseMediaStore` | `tenxgraph/storage/media/storage/base.py` | `store()`, `retrieve()`, `delete()`, `exists()` |
| `BasePublisher` | `tenxgraph/runtime/publisher/base_publisher.py` | `publish(EventModel)`, `close()`, `sync_close()` |
| `BaseConverter` | `tenxgraph/runtime/adapters/llm/base_converter.py` | `convert_response()`, `convert_streaming_response()` |
| `BaseValidator` | `tenxgraph/utils/callbacks.py` | `async validate(messages)` |
| `BaseIDGenerator` | `tenxgraph/utils/id_generator.py` | `id_type`, `generate()` |
| `BaseAuth` | `tenxgraph_api/src/app/core/auth/base_auth.py` | `authenticate(request, response, credential)` |
| `AuthorizationBackend` | `tenxgraph_api/src/app/core/auth/authorization.py` | `authorize(user, resource, action, resource_id=None, **context)` |
| `BaseRateLimitBackend` | `tenxgraph_api/src/app/core/middleware/rate_limit/base.py` | `check(key, limit, window)`, `close()` |
| `ThreadNameGenerator` | `tenxgraph_api/src/app/utils/thread_name_generator.py` | `generate_name(messages)` |
| `BaseCriterion` | `tenxgraph/qa/evaluation/criteria/base.py` | `async evaluate(actual, expected)` |
| `BaseReporter` | `tenxgraph/qa/evaluation/reporters/base.py` | `generate(report, output_dir=None)` |

---

## Common extension pattern

Every extension follows three steps. You create a subclass, pass an instance to the framework (either during graph compilation or via config file), and the framework uses your implementation without any other changes needed.

```mermaid
flowchart LR
  SUB["1, Subclass the ABC\nimplement abstract methods"] -->
  CFG["2, Configure\npass instance or 10xgraph.json path"] -->
  RUN["3, Framework picks it up\nno other changes needed"]
```

1. Subclass the ABC and implement its abstract methods.
2. Pass the instance when building the graph (such as `graph.compile(checkpointer=...)` or `StateGraph(publisher=...)`) or set the path in `10xgraph.json` for server-layer ABCs. A checkpointer always goes to `compile()`: the server does not apply the checkpointer key in `10xgraph.json` yet.
3. The framework picks it up. Graph logic, routing, and API endpoints are unchanged.

---

## Storage extension points

10xGraph ships with an in-memory checkpointer for dev and a Postgres+Redis checkpointer for production. Extend `BaseCheckpointer` if you need to use DynamoDB, Google Cloud Datastore, or a custom backend. The other storage ABCs let you bring your own embedding models, vector stores, and file storage. The checkpointer, store and media store are passed to `compile()`; the embedding model is passed to the store implementation you build.

### BaseCheckpointer: conversational state

A checkpointer persists your graph's state and thread history to a backend. You extend `BaseCheckpointer` when your deployment requires a specific database (DynamoDB for AWS shops, Firestore for Google Cloud, or something custom like a legacy oracle system). All of the async methods below are abstract, so a subclass must implement every one; the synchronous wrappers (`put_state()` and similar) are provided by the base class.

```python
from tenxgraph.storage.checkpointer.base_checkpointer import BaseCheckpointer

class DynamoCheckpointer(BaseCheckpointer):
    # State and thread lifecycle
    async def asetup(self) -> None: ...                                  # create tables / connect
    async def aput_state(self, config, state) -> None: ...               # persist full state
    async def aget_state(self, config) -> AgentState | None: ...         # load state by thread_id
    async def aclear_state(self, config) -> None: ...                    # delete state for thread
    async def aclean_thread(self, config) -> None: ...                   # delete all thread data
    async def arelease(self) -> None: ...                                # close connections

    # Cache, messages and thread metadata
    async def aput_state_cache(self, config, state) -> None: ...         # hot-path write cache
    async def aget_state_cache(self, config) -> AgentState | None: ...   # hot-path read cache
    async def aput_messages(self, config, messages, metadata=None) -> None: ...  # store messages
    async def aget_message(self, config, message_id) -> Message: ...     # fetch single message
    async def alist_messages(self, config, search=None, offset=None, limit=None) -> list[Message]: ...
    async def adelete_message(self, config, message_id) -> None: ...     # delete single message
    async def aput_thread(self, config, thread_info) -> None: ...        # store thread metadata
    async def aget_thread(self, config) -> ThreadInfo | None: ...        # fetch thread metadata
    async def alist_threads(self, config, search=None, offset=None, limit=None) -> list[ThreadInfo]: ...

compiled = graph.compile(checkpointer=DynamoCheckpointer())
```

### BaseStore: long-term vector memory

A store holds embeddings and metadata for long-term retrieval across conversation threads. You extend `BaseStore` to integrate with a vector database your team already uses (Pinecone, Weaviate, your own Postgres pgvector setup). Your store methods handle the read/write/search lifecycle.

```python
from tenxgraph.storage.store.base_store import BaseStore

class PineconeStore(BaseStore):
    async def astore(self, config, content, memory_type=..., category="general", metadata=None, **kwargs) -> str: ...
    async def asearch(self, config, query, memory_type=None, category=None, limit=10, **kwargs) -> list: ...
    async def aget(self, config, memory_id, **kwargs): ...
    async def aget_all(self, config, limit=100, **kwargs) -> list: ...
    async def aupdate(self, config, memory_id, content, metadata=None, **kwargs): ...
    async def adelete(self, config, memory_id, **kwargs): ...
    async def aforget_memory(self, config, **kwargs): ...
    async def aping(self) -> None: ...   # raise if the backend is unreachable; read-only and cheap

compiled = graph.compile(store=PineconeStore())
```

`aping` is abstract: a store that does not implement it raises `TypeError` when created. Return when the backend is reachable and raise otherwise; an in-process store just returns. `10xgraph-api` calls it for `/health/ready` and at startup. Added after 1.0.0rc2.

### BaseEmbedding: custom embedding model

An embedding model converts text into vectors for storage and search. You extend `BaseEmbedding` when you need an embedding provider other than the framework defaults or when you want to use a fine-tuned embedding model specific to your domain.

```python
from tenxgraph.storage.store.embedding.base_embedding import BaseEmbedding

class CohereEmbedding(BaseEmbedding):
    @property
    def dimension(self) -> int:
        return 1024

    async def aembed(self, text: str) -> list[float]:
        return await cohere_client.embed(text)

    async def aembed_batch(self, texts: list[str]) -> list[list[float]]:
        return await cohere_client.embed_batch(texts)
```

### BaseMediaStore: file storage backend

A media store handles the upload and retrieval of images, audio, and documents. You extend `BaseMediaStore` to integrate with your file storage infrastructure: AWS S3, Google Cloud Storage, your own MinIO instance, or a specialized media service.

```python
from tenxgraph.storage.media.storage.base import BaseMediaStore

class S3MediaStore(BaseMediaStore):
    async def store(self, data: bytes, mime_type: str, metadata: dict | None = None) -> str:
        """Store bytes and return an opaque storage key."""
        ...

    async def retrieve(self, storage_key: str) -> tuple[bytes, str]:
        """Return (bytes, mime_type)."""
        ...

    async def delete(self, storage_key: str) -> bool:
        """Delete by storage key. Return True if deleted."""
        ...

    async def exists(self, storage_key: str) -> bool: ...
```

---

## Agent and LLM extension

### BaseAgent: bring your own LLM

The `Agent` class extends `BaseAgent`. You subclass `BaseAgent` to call any LLM provider, add pre/post-processing, or change how messages are constructed. This is useful when you need to integrate a provider or inference service that 10xGraph does not ship with built-in support for.

```python
from tenxgraph.core.graph.base_agent import BaseAgent
from tenxgraph.core.state import AgentState, Message

class AnthropicAgent(BaseAgent):
    async def execute(self, state: AgentState, config: dict) -> Message:
        # Convert 10xGraph messages to the format Anthropic expects
        messages = [
            {"role": m.role, "content": m.text()}
            for m in state.context
            if m.role in ("user", "assistant")
        ]
        response = await anthropic_client.messages.create(
            model="your-anthropic-model-id",
            max_tokens=1024,
            messages=messages,
        )
        return Message.text_message(response.content[0].text, role="assistant")

    async def _call_llm(self, messages, tools=None, **kwargs):
        # Also abstract: the low-level provider call
        ...
```

### BaseConverter: LLM response normalization

`BaseConverter` maps a raw provider response into 10xGraph's `Message` format. You implement one when integrating a provider whose output shape needs normalizing into the framework's message format.

```python
from tenxgraph.core.state import Message
from tenxgraph.runtime.adapters.llm.base_converter import BaseConverter

class MyProviderConverter(BaseConverter):
    async def convert_response(self, response) -> Message:
        return Message.text_message(response["output"], role="assistant")

    async def convert_streaming_response(self, config, node_name, response, meta=None):
        # async generator yielding EventModel or Message
        async for chunk in response:
            text = chunk.get("delta", "")
            if text:
                yield Message.text_message(text, role="assistant")
```

### BaseContextManager: custom context trimming

Context grows as the conversation continues. You extend `BaseContextManager` when the built-in trimming strategies (keep last N messages, remove old messages) do not fit your use case. Examples: keep messages tagged as important, prioritize system context, or drop messages matching a pattern.

```python
from tenxgraph.core.state.base_context import BaseContextManager
from tenxgraph.core.state import AgentState

class PriorityContextManager(BaseContextManager):
    def trim_context(self, state: AgentState) -> AgentState:
        # keep system message + last N turns + any pinned messages
        ...
        return state

    async def atrim_context(self, state: AgentState) -> AgentState:
        return self.trim_context(state)

graph = StateGraph(state=MyState(), context_manager=PriorityContextManager())
```

---

## ID generation

Several built-in generators cover most needs. Swap them globally or per-graph.

| Class | Output |
|---|---|
| `DefaultIDGenerator` | Empty string, so the framework substitutes its UUID-based default (used when none is set) |
| `UUIDGenerator` | UUID string |
| `BigIntIDGenerator` | Big integer |
| `IntIDGenerator` | 32-bit random integer |
| `TimestampIDGenerator` | Integer of microseconds since the Unix epoch |
| `HexIDGenerator` | Hex string |
| `ShortIDGenerator` | 8-character alphanumeric string |
| `AsyncIDGenerator` | Async `generate()` returning a string |

You extend `BaseIDGenerator` when you need IDs in a specific format: employee IDs matching your company's naming scheme, snowflake IDs for distributed systems, or UUIDs with a custom prefix.

```python
from tenxgraph.utils.id_generator import TimestampIDGenerator

graph = StateGraph(id_generator=TimestampIDGenerator())
compiled = graph.compile()
```

Custom generator:

```python
from tenxgraph.utils.id_generator import BaseIDGenerator

import uuid

from tenxgraph.utils.id_generator import BaseIDGenerator, IDType


class PrefixedIDGenerator(BaseIDGenerator):
    @property
    def id_type(self) -> IDType:
        return IDType.STRING

    def generate(self) -> str:
        return f"run_{uuid.uuid4().hex[:8]}"
```

---

## API and server extension

Server-layer ABCs are wired via `10xgraph.json` (or the InjectQ container for rate-limit backends), with no code changes to the server required. You extend these to enforce your deployment's security policies, integrate custom identity systems, or implement rate limiting specific to your infrastructure.

### BaseAuth

Extend `BaseAuth` when you need custom authentication beyond JWT: API key lookup, LDAP integration, OAuth2 with your identity provider, or a legacy auth system. The `authenticate` method is synchronous and receives the request, response, and credential. Return a dict with at least `user_id`, or raise an exception to reject the request.

```python
from tenxgraph_api import BaseAuth

class ApiKeyAuth(BaseAuth):
    def authenticate(self, request, response, credential) -> dict | None:
        key = request.headers.get("X-API-Key")
        return lookup_api_key(key)   # dict with user_id; raise an exception to reject
```

### AuthorizationBackend

You extend `AuthorizationBackend` when the built-in authorization models (allow-all, ownership, RBAC) do not fit your permission model. Examples: attribute-based access control (ABAC), graph-based permissions, or integration with an external policy engine.

```python
from tenxgraph_api.src.app.core.auth.authorization import AuthorizationBackend

class RBACBackend(AuthorizationBackend):
    async def authorize(self, user, resource, action, resource_id=None, **context) -> bool:
        return f"{resource}:{action}" in ROLE_PERMISSIONS[user["role"]]
```

For simple role-to-scope mapping, you do not need a class. Set `authorization` to an RBAC config block (`{"backend": "rbac", "roles": {...}}`). The built-in `"ownership"` selector gives owner-only threads with no code, and `"allow_all"` permits any authenticated user.

### BaseRateLimitBackend

You extend `BaseRateLimitBackend` when you need rate limiting with custom logic: tiered limits based on user tier, graceful degradation, or integration with an external rate limiter service.

```python
from tenxgraph_api.src.app.core.middleware.rate_limit.base import (
    BaseRateLimitBackend,
    RateLimitDecision,
)

class RedisClusterRateLimiter(BaseRateLimitBackend):
    async def check(self, key: str, *, limit: int, window: int) -> RateLimitDecision: ...
    async def close(self) -> None: ...
```

The `check` method returns a `RateLimitDecision(allowed, remaining, reset_after)` (import it from the same `base` module). Bind an instance of your backend in the InjectQ container and set `backend: custom`; there is no import-path key for rate-limit backends.

### ThreadNameGenerator

You extend `ThreadNameGenerator` when you want custom thread names: date-prefixed names, user-specific prefixes, or names derived from the conversation topic. If none is configured, a default generator produces varied adjective-noun style names.

```python
from tenxgraph_api.src.app.utils.thread_name_generator import ThreadNameGenerator

class DatePrefixNameGenerator(ThreadNameGenerator):
    async def generate_name(self, messages: list[str]) -> str:
        return f"{date.today()}: {messages[0][:30]}"
```

Wire any of these in `10xgraph.json`. Auth, authorization, and thread naming each have a dedicated top-level key. Custom rate-limit backends are bound in the InjectQ container instead:

```json
{
  "auth": { "method": "custom", "path": "auth.my_auth:ApiKeyAuth" },
  "authorization": "auth.my_auth:RBACBackend",
  "thread_name_generator": "services.naming:DatePrefixNameGenerator",
  "rate_limit": {
    "enabled": true,
    "backend": "custom",
    "requests": 100,
    "window": 60
  }
}
```

The string format for class references is `module.path:ClassName` (dot-separated module path, colon, then the class or instance name). For the custom rate-limit backend, bind it in the module your injectq key points to:

```python
from injectq import InjectQ
from tenxgraph_api.src.app.core.middleware.rate_limit.base import BaseRateLimitBackend

container = InjectQ.get_instance()
container.bind_instance(BaseRateLimitBackend, RedisClusterRateLimiter())
```

---

## Event stream extension

You extend `BasePublisher` to send execution events to a custom endpoint: your internal event bus, a webhook, a monitoring system, or a custom log aggregator. Multiple publishers can run together: pass a list to `StateGraph(publisher=[...])` or wrap them in `CompositePublisher`.

```python
from tenxgraph.runtime.publisher.base_publisher import BasePublisher
from tenxgraph.runtime.publisher.events import EventModel

import httpx


class WebhookPublisher(BasePublisher):
    def __init__(self, url: str):
        super().__init__({"url": url})
        self.url = url

    async def publish(self, event: EventModel) -> None:
        async with httpx.AsyncClient() as client:
            await client.post(self.url, json=event.model_dump(mode="json"))

    async def close(self) -> None:
        pass

    def sync_close(self) -> None:
        pass
```

Compose multiple publishers:

```python
from tenxgraph import StateGraph
from tenxgraph.runtime.publisher import CompositePublisher, ConsolePublisher

graph = StateGraph(
    publisher=CompositePublisher([ConsolePublisher(), WebhookPublisher("https://...")])
)
compiled = graph.compile()
```

---

## Validation and evaluation extension

### BaseValidator: input screening

You extend `BaseValidator` to add custom input validation before messages reach the graph: length checks, content filtering, or PII detection. Register validators with the callback manager.

```python
from tenxgraph.core.state import Message
from tenxgraph.utils.callbacks import BaseValidator, CallbackManager
from tenxgraph.utils.validators import ValidationError

class LengthValidator(BaseValidator):
    async def validate(self, messages: list[Message]) -> bool:
        for m in messages:
            if len(m.text()) > 10_000:
                raise ValidationError(
                    "Message exceeds maximum length", "length_exceeded"
                )
        return True

cb = CallbackManager()
cb.register_input_validator(LengthValidator())
graph.compile(callback_manager=cb)
```

### BaseCriterion: custom evaluation criterion

You extend `BaseCriterion` to score agent responses against custom metrics when running evaluations. Examples: keyword presence, output format compliance, or domain-specific quality signals.

```python
from tenxgraph.qa.evaluation.criteria.base import BaseCriterion
from tenxgraph.qa.evaluation.eval_result import CriterionResult

class KeywordCriterion(BaseCriterion):
    def __init__(self, keywords: list[str], config=None):
        super().__init__(config)
        self.keywords = keywords

    async def evaluate(self, actual, expected) -> CriterionResult:
        text = actual.actual_response
        hits = sum(1 for kw in self.keywords if kw in text)
        score = hits / len(self.keywords)
        return CriterionResult.success(
            criterion="keywords", score=score, threshold=0.5
        )
```

### BaseReporter: custom evaluation report

You extend `BaseReporter` to generate evaluation reports in a custom format or send them to your internal systems: post to Slack, write to a database, generate a PDF, or integrate with your BI tools.

```python
from tenxgraph.qa.evaluation.reporters.base import BaseReporter

class SlackReporter(BaseReporter):
    def generate(self, report, output_dir: str | None = None) -> str | None:
        summary = f"Pass rate: {report.summary.pass_rate:.2f}"
        post_to_slack("#evals", summary)  # your own helper
        return summary
```

---

## What's next

| Page | What it covers |
|---|---|
| [Callbacks and Command](/docs/concepts/callbacks-and-command) | BaseValidator, CallbackManager, GraphLifecycleHook in practice |
| [Serving Agents](/docs/concepts/serving-agents) | BaseAuth, AuthorizationBackend, BasePublisher wired to a running server |
| [Memory and store](/docs/concepts/memory-and-store) | BaseCheckpointer, BaseStore, BaseEmbedding in the memory layer context |
| [Testing and evaluation](/docs/testing) | BaseCriterion, BaseReporter in the evaluation pipeline |
