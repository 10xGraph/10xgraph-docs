---
title: "RAG agent example walkthrough"
description: Build a knowledge-base Q&A agent with RAGAgent, from a runnable keyword-search demo to Qdrant retrieval and optional reranking.
section: Examples
group: "Use cases"
order: 270
label: RAG
updated: "2026-10-27"
faq:
  - q: "Do I need a vector database to try RAGAgent?"
    a: "No. RAGAgent accepts any BaseStore. The example on this page uses a small in-memory store with keyword matching, so you only need an OpenAI API key. Switch to QdrantStore when you need semantic search over a real knowledge base."
  - q: "When should I add a reranker?"
    a: "Add one when the first retrieval step returns relevant documents mixed with noise. Retrieve a wide set with top_k, then let the reranker keep the best top_n for the model."
  - q: "Can RAGAgent run several retrieval rounds?"
    a: "No. It retrieves once per question. For multi-step or filtered retrieval, build a custom graph and give the agent a search tool."
---

A RAG (retrieval-augmented generation) agent answers questions from your own documents: it searches a knowledge base, optionally reranks the hits, and passes the best ones to an LLM as context. `RAGAgent` is a prebuilt graph that does this, so you supply a store and an `Agent`.

The runnable demo is based on `agentflow/examples/rag/rag_example.py` in the repository. This page adapts it, then shows how to move to Qdrant and add reranking.

## When to use RAGAgent

Use `RAGAgent` for question answering over a fixed body of text, such as product docs, FAQs or an internal wiki, where one retrieval per question is enough. The pipeline is deterministic and easy to debug, because retrieval never depends on the model's decisions.

Do not use it when:

- A question needs several searches, query rewriting or filters chosen by the model. Build a [custom graph](/docs/guides/build-a-graph) and give the agent a search tool instead.
- You want to combine retrieval with other tools in one loop.
- The answer does not live in documents (live data, calculations, actions).

For the other prebuilt graphs, see [prebuilt agents](/docs/guides/prebuilt-agents) and the [RAGAgent guide](/docs/guides/prebuilt/rag-agent).

## How the pipeline works

`RAGAgent` runs three nodes in a fixed order: RETRIEVE searches the store, RERANK (only when you pass a reranker) narrows the candidates, and SYNTHESIZE calls your agent with the documents attached.

```text
START -> RETRIEVE -> [RERANK] -> SYNTHESIZE -> END
```

RETRIEVE uses the latest user message as the query and keeps the result texts in a per-run cache on the `RAGAgent`, not in saved state. SYNTHESIZE numbers the documents, fences them in a `<retrieved_documents_...>` block with a random suffix, and adds that block to the latest user message of the request sent to the model, before the user's text. The saved user message is never changed, so the thread does not grow with retrieved text and attachments on the message are kept. If the cache has no entry (for example after a restart between nodes), SYNTHESIZE retrieves again. The agent's own `system_prompt` is left untouched, so use it to tell the model to answer only from the documents. The `agent` you pass must accept `execute(state, config, *, request_blocks=None)`, as the built-in `Agent` does.

## Run a minimal RAG agent

This script needs no vector database. A small in-memory store ranks chunks by shared words, which is enough to see the pipeline work end to end.

Install the OpenAI extra and set your key:

```bash
pip install "10xgraph[openai]"
export OPENAI_API_KEY="sk-..."
```

```python title="rag_demo.py"
import asyncio

from tenxgraph.core.graph.agent import Agent
from tenxgraph.core.state.message import Message
from tenxgraph.prebuilt.agent.rag import RAGAgent
from tenxgraph.storage.store.base_store import BaseStore
from tenxgraph.storage.store.store_schema import MemorySearchResult

# The knowledge base: a few support-policy chunks
DOCS = [
    "Our refund policy allows returns within 30 days of purchase with a receipt.",
    "Products must be in original packaging to qualify for a full refund.",
    "Digital downloads are non-refundable once accessed.",
    "Shipping costs are non-refundable unless the return is due to our error.",
    "Contact support@example.com with your order number to start a return.",
]


class StubStore(BaseStore):
    """Demo store: ranks chunks by word overlap with the query."""

    async def asetup(self):
        pass

    async def asearch(self, config, query: str, limit: int = 5, **kwargs):
        query_words = set(query.lower().split())
        scored = sorted(
            ((len(query_words & set(chunk.lower().split())), chunk) for chunk in DOCS),
            reverse=True,
        )
        return [
            MemorySearchResult(content=chunk, score=float(score))
            for score, chunk in scored[:limit]
            if score > 0
        ]

    # RAGAgent only calls asearch. The rest satisfy the abstract BaseStore API.
    async def astore(self, config, content, **kwargs):
        return "id"

    async def aget(self, config, memory_id, **kwargs):
        return None

    async def aget_all(self, config, **kwargs):
        return []

    async def aupdate(self, config, memory_id, content, **kwargs):
        pass

    async def adelete(self, config, memory_id, **kwargs):
        pass

    async def aforget_memory(self, config, **kwargs):
        pass


# The agent that writes the answer from the retrieved context
answerer = Agent(
    model="gpt-4o-mini",
    provider="openai",
    system_prompt=[
        {
            "role": "system",
            "content": (
                "You are a customer-support agent. "
                "Answer using ONLY the provided context. "
                "If the context does not contain the answer, say so."
            ),
        }
    ],
)

# Retrieve the 4 best chunks for each question
rag = RAGAgent(store=StubStore(), agent=answerer, top_k=4)
app = rag.compile()


async def main():
    question = "Can I return a digital product?"
    result = await app.ainvoke(
        {"messages": [Message.text_message(question, role="user")]},
        config={"thread_id": "demo"},
    )
    answer = next(m for m in reversed(result["messages"]) if m.role == "assistant")
    print(f"Q: {question}")
    print(f"A: {answer.text()}")


if __name__ == "__main__":
    asyncio.run(main())
```

Run it with `python rag_demo.py`. The model's wording varies, but the answer should say that digital downloads are non-refundable once accessed. If it says the context has no answer, check that your question shares words with a chunk, because the demo store matches whole words only.

`ainvoke` takes a dict with a `messages` list and returns a dict. By default (low granularity) `result["messages"]` holds the messages produced during the run.

## Use Qdrant for a real knowledge base

For production, replace the stub with `QdrantStore`, which embeds your chunks and searches by vector similarity. Index once, then reuse the store.

```bash
pip install "10xgraph[openai,qdrant]"
```

```python title="rag_qdrant.py"
import asyncio

from tenxgraph.core.graph.agent import Agent
from tenxgraph.core.state.message import Message
from tenxgraph.prebuilt.agent.rag import RAGAgent
from tenxgraph.storage import create_local_qdrant_store, system_user_id
from tenxgraph.storage.store.embedding import OpenAIEmbedding

# Replace with your own chunks (split by headings or paragraphs, not fixed size)
CHUNKS = [
    "Digital downloads are non-refundable once accessed.",
    "Returns are accepted within 30 days with a receipt.",
]

# The knowledge base is shared data, so it is owned by the reserved system_user_id("knowledge_base").
# Search and indexing must use the same user_id, because QdrantStore filters by it.
CONFIG = {"user_id": system_user_id("knowledge_base")}

store = create_local_qdrant_store(
    path="./knowledge_base",
    embedding=OpenAIEmbedding(model="text-embedding-3-small"),
)


async def main():
    # Index once; skip this step on later runs
    for chunk in CHUNKS:
        await store.astore(config=CONFIG, content=chunk)

    rag = RAGAgent(
        store=store,
        agent=Agent(model="gpt-4o-mini", provider="openai"),
        top_k=5,
        store_config=CONFIG,  # passed to every store.asearch call
    )
    app = rag.compile()
    result = await app.ainvoke(
        {"messages": [Message.text_message("Can I return a download?", role="user")]},
        config={"thread_id": "kb-demo"},
    )
    print(result["messages"][-1].text())


asyncio.run(main())
```

`QdrantStore` reads `user_id`, `thread_id` and `collection` from the config dict it receives. Every store call needs a non-empty `user_id`; `system_user_id(name)` builds the reserved owner for shared data (see the [Memory stores reference](/docs/reference/python/memory-stores#the-user_id-rule-and-system_user_id)). That makes `store_config` the way to pick a collection or scope retrieval for every run, for example `store_config={"user_id": "u42", "collection": "support_docs"}`. To scope retrieval per user or tenant at run time, pass `store_config_builder`, a function from the run config to the store config, for example `store_config_builder=lambda cfg: {"user_id": cfg["user_id"]}`. Take the identity from the authenticated run config, never from state. A `tenant_id` key is not read.

<aside class="callout callout-note" role="note"><p class="callout-title">Retrieval strategy</p>

`RAGAgent` forwards `retrieval_strategy` to the store, but `QdrantStore.asearch` runs a vector similarity query whatever value you pass. Hybrid (dense plus keyword) retrieval needs a store you write yourself.

</aside>

## Add a reranker

A reranker rescoring step improves precision: retrieve many candidates with `top_k`, then keep only the best `top_n` for the model. RERANK is added to the graph only when you pass a reranker.

| Reranker | Install | Runs | Notes |
|---|---|---|---|
| `CohereReranker(api_key, model="rerank-v4.0-pro")` | `pip install cohere` | Cohere API | Needs a Cohere API key |
| `CrossEncoderReranker(model="cross-encoder/ms-marco-MiniLM-L-6-v2")` | `pip install sentence-transformers` | Locally | No API key, suits private data |

```python title="rerank.py"
import os

from tenxgraph.core.graph.agent import Agent
from tenxgraph.prebuilt.agent.rag import CohereReranker, CrossEncoderReranker, RAGAgent

# Hosted reranking: 20 candidates in, best 5 go to the model
rag = RAGAgent(
    store=store,  # the QdrantStore from the previous section
    agent=Agent(model="gpt-4o", provider="openai"),
    reranker=CohereReranker(api_key=os.environ["COHERE_API_KEY"]),
    top_k=20,
    top_n=5,
)

# Local reranking: 15 candidates in, best 4 go to the model
rag = RAGAgent(
    store=store,
    agent=Agent(model="gpt-4o-mini", provider="openai"),
    reranker=CrossEncoderReranker(),
    top_k=15,
    top_n=4,
)
```

Any object with `async def arerank(self, query, documents, top_n) -> list[str]` works as a reranker, so you can plug in your own.

## Constructor parameters

These are the retrieval options. The full reference is on the [prebuilt agents reference](/docs/reference/python/prebuilt-agents) page.

| Parameter | Default | Purpose |
|---|---|---|
| `store` | required | Knowledge-base `BaseStore` searched by RETRIEVE |
| `agent` | required | Agent that writes the final answer |
| `reranker` | `None` | Adds the RERANK node when set |
| `top_k` | `5` | Candidates retrieved from the store (must be at least 1) |
| `top_n` | `3` | Documents kept after reranking (must be at least 1, ignored without a reranker) |
| `retrieval_strategy` | `RetrievalStrategy.SIMILARITY` | Passed to `store.asearch` |
| `score_threshold` | `None` | Minimum similarity score, `None` means no cutoff |
| `store_config` | `{}` | Config dict passed to every `store.asearch` call. Without a `user_id` key it searches as `system_user_id("knowledge_base")` |
| `store_config_builder` | `None` | Function from the run config to a store config dict. When set, it replaces `store_config` for each run and is used as is, so it must include a `user_id` |

`RAGAgent` also accepts `state`, `context_manager`, `publisher`, `id_generator` and `container`, which it forwards to the underlying `StateGraph`.

## Inspect what was retrieved

Retrieved documents are not saved in state, so enable debug logging to see what was found. When a question gets a poor answer, check retrieval first: the model can only use what RETRIEVE and RERANK passed along.

```python title="debug_rag.py"
import logging

# Logs the query, the number of documents found and the number passed to the model
logging.getLogger("tenxgraph.prebuilt.rag").setLevel(logging.DEBUG)

# Inside an async function, with `app` compiled as above
result = await app.ainvoke(
    {"messages": [Message.text_message("Can I return a download?", role="user")]},
    config={"thread_id": "debug"},
)
print(result["messages"][-1].text())
```

## Keep a multi-turn conversation

Pass a checkpointer to `compile` and reuse the same `thread_id` so follow-up questions see earlier turns. Each turn still triggers a fresh retrieval for the latest user message.

```python title="multi_turn.py"
from tenxgraph.core.state.message import Message
from tenxgraph.storage.checkpointer import InMemoryCheckpointer

app = rag.compile(checkpointer=InMemoryCheckpointer())
config = {"thread_id": "user_123"}

# Inside an async function
first = await app.ainvoke(
    {"messages": [Message.text_message("What is the refund window?", role="user")]},
    config=config,
)
second = await app.ainvoke(
    {"messages": [Message.text_message("Does that apply to downloads?", role="user")]},
    config=config,
)
```

The retrieval query is only the latest user message, so a follow-up like "Does that apply to downloads?" is searched without the earlier turns. Ask self-contained questions, or rewrite follow-ups before they reach the agent. Production deployments should use a durable checkpointer, see [set up checkpointing](/docs/guides/set-up-checkpointing).

To cap how much history the model sees, pass a context manager such as `MessageContextManager(max_messages=50)` from `tenxgraph.core.state` as `context_manager`. See [use a context manager](/docs/guides/use-context-manager).

## Indexing tips

Answer quality depends on the index at least as much as on the model.

- Chunk by structure (headings, paragraphs), and keep chunks small enough to stay specific, roughly 200 to 500 tokens.
- Re-index when documents change, and track when each document was last indexed.
- Tell the model to say so when the context has no answer, as the system prompt above does, instead of letting it guess.

## Separate data per company

To keep each company's documents in its own collection, pass `store_config_builder` and build the collection from the authenticated user, never from state. The RAG guide has the full example: [A collection per company](/docs/guides/prebuilt/rag-agent#a-collection-per-company). The API ignores any `collection` a client sends.

## What to try next

- [RAGAgent guide](/docs/guides/prebuilt/rag-agent): graph shape and customization.
- [Prebuilt agents](/docs/guides/prebuilt-agents): other ready-made graphs.
- [Long-term memory](/docs/concepts/memory-and-store): how stores differ from checkpointers.
- [Prebuilt agents reference](/docs/reference/python/prebuilt-agents): full signatures.
