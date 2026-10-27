---
title: Build a Research AI Agent in Python
description: "Build a research agent that searches the web, reads full pages and writes answers with [source-N] citations, plus a check for uncited claims."
section: Examples
group: "Use cases"
order: 260
label: Research
updated: "2026-10-27"
faq:
  - q: "Does this example need an API key besides Anthropic?"
    a: "Yes. The web_search tool calls the Tavily API, so you need a TAVILY_API_KEY in the environment. The Anthropic key is read from ANTHROPIC_API_KEY."
  - q: "Does the citation validator stop the agent from answering?"
    a: "No. It runs after the graph and only reports sentences without a [source-N] marker. You decide whether to log, retry or add a disclaimer."
---

A research agent answers questions that need outside information, and it must cite what it found. This example gives a 10xGraph agent two tools, web search and page fetch, loops until it has at least three sources, then checks that each sentence of the answer carries a `[source-N]` marker.

## What you'll build

The agent receives a question, searches the web with the Tavily API, reads promising pages in full, and writes a cited answer. A plain Python check then flags answers with uncited sentences.

| Part | Role |
|---|---|
| `web_search` tool | Calls Tavily and returns numbered sources with title, URL and snippet |
| `fetch_url` tool | The prebuilt tool: downloads a public page, strips HTML and returns up to 20,000 characters as JSON |
| `MAIN` node | An `Agent` that plans subqueries, calls tools and writes the answer |
| `TOOL` node | A `ToolNode` that runs the tool calls |
| `validate_citations` | A post-run check, outside the graph, that counts uncited sentences |

## Run the example

This page is a self-contained walkthrough: copy the code below into one file named `graph.py`. There is no matching folder in `examples/`. The code needs the Anthropic extra, `httpx` and a Tavily key.

```bash
pip install "10xgraph[anthropic]" httpx
export ANTHROPIC_API_KEY=sk-ant-...
export TAVILY_API_KEY=tvly-...
python graph.py
```

## How the graph flows

The agent loops between `MAIN` and `TOOL` until the model stops requesting tools, then the run ends and the validator inspects the final answer.

```text
[ User question ]
       |
       v
[ MAIN: Agent plans 2-3 subqueries ] <------+
       |                                    |
       | tool calls?                        |
       v                                    |
[ TOOL: web_search / fetch_url ] -----------+
       |
       | no tool calls
       v
[ END: cited answer ] --> validate_citations()
```

The loop is bounded by `recursion_limit` in the run config, not by a counter in the prompt.

## Write the code

The code lives in one file in three parts: the tools, the graph, and the citation check with a runner. Each part below is complete; together they form `graph.py`.

### Tools: search and fetch

The model gets two tools: `web_search`, which you write and which numbers every search hit so the model can cite it, and the prebuilt `fetch_url`, which reads a page. Put this at the top of `graph.py`.

```python title="graph.py (part 1: tools)"
import os
import re
import httpx
from tenxgraph.core.graph import Agent, StateGraph, ToolNode
from tenxgraph.core.state.agent_state import AgentState
from tenxgraph.core.state.message import Message
from tenxgraph.prebuilt.tools import fetch_url
from tenxgraph.utils.constants import END

# Load the Tavily key from the environment (the Anthropic key is read by 10xGraph)
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY")
if not TAVILY_API_KEY:
    raise ValueError("TAVILY_API_KEY not set in environment")

# Global counter so [source-N] tags stay unique across several searches
_source_counter = 0


def web_search(query: str, max_results: int = 5) -> str:
    """Search the web using Tavily. Returns sources with title, URL, and snippet."""
    global _source_counter
    if not query.strip():
        return "No query provided."
    
    try:
        response = httpx.post(
            "https://api.tavily.com/search",
            json={"api_key": TAVILY_API_KEY, "query": query, "max_results": max_results},
            timeout=10.0,
        )
        response.raise_for_status()
        data = response.json()
    except Exception as e:
        return f"Search error: {e}"
    
    results = data.get("results", [])
    if not results:
        return "No search results found."
    
    output = []
    for result in results:
        _source_counter += 1
        i = _source_counter
        title = result.get("title", "No title")
        url = result.get("url", "No URL")
        content = result.get("content", "No snippet")
        output.append(f"[source-{i}] {title}\n{url}\n{content}")
    
    return "\n\n".join(output)
```

**Notes on the tools:**

- **Source IDs in output:** `[source-1]`, `[source-2]` are tags that the agent cites in the final answer. A module-level counter keeps them unique when the agent searches more than once.
- **web_search:** Calls Tavily API. Errors come back as text so the agent can see them. Check the current Tavily API reference for the request format (this code sends the key as `api_key` in the JSON body) and adjust if it has changed.
- **fetch_url:** Imported from `tenxgraph.prebuilt.tools`, not hand-written. It accepts only http and https, rejects private, loopback and link-local addresses, checks every redirect hop (at most 5), connects to the address it checked, strips HTML and limits output to 20,000 characters. Errors come back as a JSON object with an `error` key. Do not replace it with a plain `httpx.get(url, follow_redirects=True)` tool: a model-chosen URL (or a redirect) could then reach internal services such as a cloud metadata endpoint.

### The agent

The graph has two nodes. `MAIN` is an `Agent` whose prompt tells it to plan subqueries, gather sources and cite them, and `TOOL` runs whatever tools it calls.

```python title="graph.py (part 2: graph)"
tool_node = ToolNode([web_search, fetch_url])

graph = StateGraph()
graph.add_node(
    "MAIN",
    Agent(
        model="anthropic/claude-opus-5",
        system_prompt=[{
            "role": "system",
            "content": (
                "You are a research assistant. Given a question, break it into 2-3 subqueries "
                "to cover different angles. Use web_search to find sources, then fetch_url to read "
                "promising articles in full. Gather at least 3 distinct sources before synthesizing. "
                "\n"
                "When you have enough information, write a clear, concise answer. "
                "EVERY factual claim must include a citation marker like [source-1] from the search results. "
                "Inline the citations: 'According to [source-2], Python is X.' "
                "\n"
                "If you cannot find reliable sources, say so explicitly. Do not invent facts."
            )
        }],
        tool_node="TOOL",
    ),
)
graph.add_node("TOOL", tool_node)

def route_after_agent(state: AgentState) -> str:
    """Route to tools if the agent called them, otherwise end."""
    if not state.context or len(state.context) == 0:
        return END
    
    last_message = state.context[-1]
    
    # If last message is from assistant with tool calls, go to TOOL
    if hasattr(last_message, "tools_calls") and last_message.tools_calls:
        return "TOOL"
    
    # If last message is a tool result, go back to agent for synthesis
    if last_message.role == "tool":
        return "MAIN"
    
    # Otherwise end
    return END

graph.add_conditional_edges(
    "MAIN",
    route_after_agent,
    {"TOOL": "TOOL", END: END},
)
graph.add_edge("TOOL", "MAIN")
graph.set_entry_point("MAIN")
```

**Agent setup:**

- **Model:** the `anthropic/` prefix selects the Anthropic provider and `claude-opus-5` handles synthesis. Substitute `anthropic/claude-sonnet-5` for lower cost.
- **System prompt:** Guides the agent to decompose, fetch full content, and cite sources inline.
- **tool_node="TOOL":** References the `TOOL` node by name.
- **Routing:** After the agent runs, if it called tools, go to `TOOL`. After tools, go back to `MAIN` for synthesis. Otherwise, end.

### Citation validator and runner

The validator is plain Python that runs after the graph finishes. It splits the answer into sentences and counts those without a `[source-N]` marker. The runner compiles the graph, asks a question and prints the result.

```python title="graph.py (part 3: validator and runner)"
CITATION_RE = re.compile(r"\[source-\d+\]")

def validate_citations(answer: str, max_uncited_sentences: int = 1) -> tuple[bool, str]:
    """Validate that all factual sentences have citations."""
    sentences = re.split(r"(?<=[.!?])\s+", answer)
    uncited = [s for s in sentences if s.strip() and not CITATION_RE.search(s)]
    
    if len(uncited) > max_uncited_sentences:
        return False, f"{len(uncited)} sentences lack citations: {uncited[:2]}"
    return True, "OK"

def compile_and_run():
    """Compile the graph and run a query."""
    compiled_graph = graph.compile()
    
    question = "Compare Python and Rust on performance and ease of learning."
    
    print(f"\n{'='*60}")
    print(f"Question: {question}")
    print(f"{'='*60}\n")
    
    config = {"thread_id": "research-1", "recursion_limit": 10}
    result = compiled_graph.invoke(
        {"messages": [Message.text_message(question)]},
        config=config,
    )
    
    # Extract the final answer (the last assistant message with text)
    final_answer = None
    for msg in reversed(result.get("messages", [])):
        if msg.role == "assistant" and msg.text().strip():
            final_answer = msg.text()
            break

    if final_answer:
                break
    
    if final_answer:
        print("Answer:")
        print(final_answer)
        print()
        
        is_valid, msg = validate_citations(final_answer)
        print(f"Citation validation: {'PASS' if is_valid else 'FAIL'} ({msg})")
    else:
        print("No answer generated.")

if __name__ == "__main__":
    compile_and_run()
```

**Validator:**

- **Regex match:** `[source-\d+]` matches any citation marker.
- **Sentence split:** Uses standard sentence boundaries (`[.!?]` followed by space).
- **Tolerance:** Allows up to `max_uncited_sentences` (default 1) uncited sentences, such as a greeting.
- **Fail behavior:** You can log, retry the agent with feedback, or degrade the response with "Limited sources" disclaimer.

## Check the output

A successful run prints the question, the answer and the validation result. The answer varies per run because it depends on live search results, so the output below is an illustration.

```text
============================================================
Question: Compare Python and Rust on performance and ease of learning.
============================================================

Answer:
Python and Rust serve different purposes in software development. [source-1] Python excels in rapid development and has a gentler learning curve due to its readable syntax and extensive library ecosystem. [source-2] Rust prioritizes memory safety and performance, making it ideal for systems programming where efficiency is critical, though it has a steeper learning curve [source-3] due to its ownership model and borrow checker.

Citation validation: PASS (OK)
```

## When to use this pattern

**Good fit:**

- Fact-checking and verification (every claim must cite a source).
- Competitive analysis (research multiple competitors).
- Due diligence (financials, press, reviews).
- Knowledge synthesis (aggregate multiple viewpoints).

**Not a good fit:**

- Questions answerable from the model's training data (wastes API calls).
- Real-time updates needed every request (consider caching).
- Highly specialized or proprietary information (search APIs may not reach it).
- Conversational chat (better to embed search as one tool among many).

## Harden it for production

The example is a reference architecture. Before real traffic, add the guardrails below.

- **Caching:** Cache identical queries for hours. Prevent duplicate searches within the same research session.
- **Rate limits:** Cap search calls per user per minute (a looping agent can make many paid search and model calls quickly).
- **Domain filters:** For trustworthy research, restrict to curated domains (`.edu`, `.org`, news outlets).
- **Time budget:** Lower `recursion_limit` and add your own timeout; return a best-effort answer if time runs out.
- **Better HTML parsing:** Use `trafilatura` or `readability-lxml` instead of basic tag stripping.
- **Cost tracking:** Log Tavily API calls per user/session; monitor spend.
- **Fallback sources:** Keep an internal knowledge base as a fallback when web search fails.

## Metrics to track

Track these to judge answer quality and cost. The targets are suggested starting points, not measured benchmarks.

| Metric | Suggested target |
|---|---|
| Citation coverage | > 95% of factual sentences |
| Source diversity per answer | At least 3 distinct sources |
| Hallucination rate (manual eval) | As low as your use case requires |
| p95 latency | Set a limit that fits your product |
| Cost per query | Set a budget per query and alert on outliers |

## What to try next

- **Multi-source synthesis:** Add internal knowledge base search alongside web search (see [Use the memory store](/docs/guides/use-memory-store)).
- **Human approval loop:** Interrupt before finalizing an answer; let a human review sources (see [Add human approval](/docs/guides/add-human-approval)).
- **Evaluation framework:** Run eval cases against your research agent to catch hallucinations (see [Evaluation](/docs/testing/evaluation)).
- **Streaming:** Stream the agent's research process token-by-token to show the user progress (see [Stream a graph](/docs/guides/stream-graph)).
- **Custom validators:** Extend citation checking to verify fact consistency or factual correctness with an LLM judge.
