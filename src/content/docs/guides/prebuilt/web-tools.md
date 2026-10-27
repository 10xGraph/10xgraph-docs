---
title: Web Tools
seoTitle: "Web tools: fetch_url and web search"
description: Fetch web pages and search the public web with SSRF protection, grounding sources, and datastore support.
section: "Build agents"
group: "Tools and MCP"
order: 180
label: Web Tools
updated: "2026-10-27"
---

The web tools package provides three complementary prebuilt tools for agents that research, fact-check, or ground their answers in real-time data. `fetch_url` retrieves and parses a single web page with built-in SSRF protection; `google_web_search` searches the public web with source attribution; and `vertex_ai_search` searches private datastore collections. Together they enable research workflows where agents discover relevant sources, fetch full content, and synthesize findings.

**Import path:** `tenxgraph.prebuilt.tools`

## Prerequisites

Install the core library and Google GenAI extras:

```bash
pip install "10xgraph[google-genai]"
```

Set your Google API credentials:

```bash
export GOOGLE_API_KEY="your-api-key"
# or use Application Default Credentials if running on Google Cloud
```

All tools require Python 3.12 or later.

## fetch_url: Fetch and parse web pages

Use `fetch_url` when you need the full content of a specific URL. It is async (the blocking request runs in a thread pool), implements SSRF protection to block access to private networks, and strips HTML markup to return plain text. The tool is ideal for following links that `google_web_search` surfaces, deep-reading documentation, or scraping specific data from known URLs.

### How it works

`fetch_url` performs several steps to make raw web content usable:

1. **Validates the URL**: accepts only HTTP and HTTPS schemes.
2. **Blocks private addresses**: prevents Server-Side Request Forgery (SSRF) attacks by resolving the hostname and allowing only globally routable addresses. Private, loopback, link-local, multicast, reserved and unspecified ranges (RFC 1918, 127.0.0.0/8, fe80::/10, 100.64.0.0/10, NAT64 and similar) are rejected. The connection is then pinned to the address that was checked, so a changed DNS answer cannot redirect it, and proxy environment variables are ignored.
3. **Fetches with timeout**: requests data with a 10-second timeout by default, clamped between 1 and 30 seconds.
4. **Extracts text**: if the content is HTML, parses it and strips tags and the contents of `script`, `style` and `noscript` blocks. Whitespace is collapsed, so the result is a single line of text.
5. **Truncates**: limits output to 20,000 characters by default to avoid overwhelming the LLM context.
6. **Returns metadata**: includes the final URL (after redirects; at most 5 are followed, and every redirect target goes through the same address check), HTTP status code, content type, and a `truncated` flag indicating overflow.

### Parameters

| Parameter | Type | Default | Constraints | Description |
|---|---|---|---|---|
| `url` | `str` | required | HTTP or HTTPS only | Public URL to fetch |
| `timeout` | `float` | `10.0` | 1-30 seconds | Request timeout; values outside the range are clamped |
| `max_chars` | `int` | `20000` | 1-20000 | Maximum characters in response; enforces a hard ceiling |

### Response structure

A successful call returns these fields as a JSON string:

```json
{
  "url": "https://docs.example.com/api-guide",
  "status_code": 200,
  "content_type": "text/html; charset=utf-8",
  "content": "API Guide\n\nThis guide describes the HTTP API...",
  "truncated": false
}
```

If the fetch fails (unsupported scheme, SSRF rejection, network or HTTP error), the response has an `"error"` field instead, and includes `"status_code"` only for HTTP errors:

```json
{
  "error": "URL host is not public or could not be resolved"
}
```

```json
{
  "error": "HTTP error: 404",
  "status_code": 404
}
```

### Example: Build a fact-checking agent

The following agent uses `google_web_search` to find claims and `fetch_url` to read full source articles:

```python
from tenxgraph.prebuilt.tools import fetch_url, google_web_search
from tenxgraph.prebuilt.agent import ReactAgent
from tenxgraph.core.state import Message

agent = ReactAgent(
    model="gemini-2.5-flash",
    tools=[fetch_url, google_web_search],
    system_prompt=[{
        "role": "system",
        "content": (
            "You are a fact-checker. Use google_web_search to find relevant sources, "
            "then use fetch_url to read the full content and verify claims. "
            "Always cite your sources by URL."
        ),
    }],
)

graph = agent.compile()

input_state = {
    "messages": [Message.text_message("Is Python the most popular programming language?")]
}

result = graph.invoke(input_state, config={"thread_id": "factcheck-1"})
print(result["messages"][-1].text())
```

### Common errors and fixes

**SSRF rejection:** If you see `"error": "URL host is not public or could not be resolved"`, the address is private (e.g., `192.168.1.1`, `localhost:8000`). This is intentional protection. The tool has no allowlist option, so reach private hosts with your own custom tool instead.

**Timeout:** If the request times out, the call fails with an error (for connection failures the tool returns `"error": "URL error: ..."`). Increase the `timeout` parameter up to 30 seconds, or implement retry logic in your agent.

**Content truncated:** Check the `"truncated": true` flag. If essential content was cut off, increase `max_chars` (up to 20,000) or handle multi-part fetching in your agent by asking for specific sections.

**Encoding errors:** HTML with unusual encodings may produce garbled text in the `content` field. This is normal; the tool uses UTF-8 with error replacement, so decoding issues are replaced with fallback characters.

## google_web_search: Search the public web with grounding

Use `google_web_search` to discover relevant information without needing exact URLs. It calls the Google GenAI API with the Gemini Google Search tool enabled, so answers are grounded in real-time search results with source attribution. Unlike traditional search APIs that return a list of links, `google_web_search` returns a synthesized answer directly, making it faster for agents to extract facts.

### How it works

The tool sends your query to the Gemini API with Google Search integration enabled. The model performs a web search, synthesizes an answer, and returns both the text and grounding metadata (search queries used, source chunks with attribution).

### Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `query` | `str` | required | Your search question or query |
| `model` | `str` | `"gemini-2.5-flash"` | Gemini model used for grounded synthesis |
| `max_chars` | `int` | `20000` | Maximum characters in the synthesized content (capped at 20000) |

### Response structure

The response includes the synthesized answer and grounding metadata for citation:

```json
{
  "content": "Python is consistently ranked as one of the top programming languages...",
  "grounding_metadata": {
    "web_search_queries": ["most popular programming languages 2024"],
    "grounding_chunks": [
      {
        "web": {
          "uri": "https://example.com/rankings",
          "title": "2024 Programming Language Rankings"
        }
      }
    ]
  },
  "truncated": false
}
```

If an error occurs (missing SDK, invalid query, network failure), you receive an error object:

```json
{
  "error": "google-genai is required for google_web_search. Install with: pip install 10xgraph[google-genai]"
}
```

### Example: Research assistant with source tracking

```python
from tenxgraph.prebuilt.tools import google_web_search
from tenxgraph.prebuilt.agent import ReactAgent
from tenxgraph.core.state import Message

agent = ReactAgent(
    model="gemini-2.5-flash",
    tools=[google_web_search],
    system_prompt=[{
        "role": "system",
        "content": (
            "You are a research assistant. Answer questions using web search. "
            "Always include sources from the grounding metadata."
        ),
    }],
)

graph = agent.compile()

result = graph.invoke(
    {"messages": [Message.text_message("What is the current state of AI safety research?")]},
    config={"thread_id": "research-1"},
)

print(result["messages"][-1].text())
```

### When to use google_web_search vs. fetch_url

| Scenario | Tool | Reason |
|---|---|---|
| You know the exact URL | `fetch_url` | Faster, no API call needed |
| You need current, real-time answers | `google_web_search` | Includes live search results |
| You need source attribution | `google_web_search` | Returns grounding metadata with URIs |
| You need full page content | `fetch_url` | Extract all text and structure |
| Budget is tight (fewer API calls) | `fetch_url` | Avoids a Gemini API call |

### Common errors and fixes

**Missing google-genai:** If you see the install error, run `pip install "10xgraph[google-genai]"` and ensure `GOOGLE_API_KEY` is set.

**Empty grounding_metadata:** If `grounding_metadata` is `null`, the response carried no grounding data (the model answered without searching). Rephrase the query.

**Rate limits:** Google GenAI API has usage limits. If you hit limits, add a retry delay in your agent or lower `max_chars` to shorten responses.

## vertex_ai_search: Search private datastores

Use `vertex_ai_search` to ground answers in a private document collection without exposing it to the public internet. This tool searches a Vertex AI Search datastore (Google Cloud's enterprise search solution) using Gemini, making it ideal for agents that need to answer questions about proprietary documentation, internal knowledge bases, or sensitive data.

### How it works

The tool queries your configured Vertex AI Search datastore with the Gemini API (v1 API version), which returns grounded results similar to `google_web_search` but scoped to your datastore. The `datastore` argument is a required tool parameter the model fills in, so give it the full resource path in the system prompt.

### Prerequisites

1. Create a Vertex AI Search datastore in Google Cloud Console (go to Vertex AI > Search and Information Retrieval > Datastores).
2. Index your documents (structured or unstructured).
3. Ensure your Google Cloud credentials can query the datastore.
4. Obtain the full datastore resource path (shown in the console or via `gcloud`):

```
projects/YOUR_PROJECT_ID/locations/global/collections/default_collection/dataStores/YOUR_DATASTORE_ID
```

### Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `query` | `str` | required | Question or search text |
| `datastore` | `str` | required | Full Vertex AI Search datastore resource path |
| `model` | `str` | `"gemini-2.5-flash"` | Gemini model for synthesis |
| `max_chars` | `int` | `20000` | Maximum characters in the response (capped at 20000) |

### Response structure

The response has the same `content`, `grounding_metadata` and `truncated` fields as `google_web_search`. The contents of `grounding_metadata` come from the Gemini response, so its inner structure varies:

```json
{
  "content": "Our internal policy on remote work states...",
  "grounding_metadata": { "...": "provider-defined grounding data" },
  "truncated": false
}
```

### Example: Internal knowledge base agent

```python
from tenxgraph.prebuilt.tools import vertex_ai_search
from tenxgraph.prebuilt.agent import ReactAgent
from tenxgraph.core.state import Message

DATASTORE = "projects/my-company-123/locations/global/collections/default_collection/dataStores/policies-store"

agent = ReactAgent(
    model="gemini-2.5-flash",
    tools=[vertex_ai_search],
    system_prompt=[{
        "role": "system",
        "content": (
            "You are an HR assistant. Answer questions about company policies using "
            "the internal knowledge base. If you find relevant documents, cite them. "
            f"When calling vertex_ai_search, always pass datastore={DATASTORE!r}."
        ),
    }],
)

app = agent.compile()
result = app.invoke(
    {"messages": [Message.text_message("What is our remote work policy?")]},
    config={"thread_id": "hr-1"},
)
print(result["messages"][-1].text())
```

### When to use vertex_ai_search

- Your data is sensitive and must stay within Google Cloud.
- You have large document collections (thousands of documents) that need efficient indexing.
- Your agent requires consistent, controlled answers from a fixed knowledge base.
- You want to avoid exposing internal URLs or document structures.

### Common errors and fixes

**Datastore not found:** Double-check the resource path format and that the datastore exists in your project and region. The path must include `locations/global` and the correct `dataStores/ID`.

**Permission denied:** Ensure your Google Cloud service account or user has the `discoveryengine.datastores.search` role. Run `gcloud projects get-iam-policy YOUR_PROJECT_ID` to verify.

**Empty results:** If your datastore returns no matches, your documents may not be indexed yet or the query is too specific. Test the datastore directly in the Google Cloud Console.

## Building multi-tool research workflows

The real power emerges when you combine these tools. A typical workflow:

1. **Discover:** `google_web_search` identifies relevant sources and pages.
2. **Deep-read:** `fetch_url` retrieves full content from those pages.
3. **Synthesize:** The agent combines findings into a comprehensive answer.

Here is a complete example:

```python
from tenxgraph.prebuilt.tools import fetch_url, google_web_search
from tenxgraph.prebuilt.agent import ReactAgent
from tenxgraph.core.state import Message

agent = ReactAgent(
    model="gemini-2.5-flash",
    tools=[fetch_url, google_web_search],
    system_prompt=[{
        "role": "system",
        "content": (
            "You are a research analyst. For complex questions: "
            "1. Use google_web_search to find relevant pages. "
            "2. Use fetch_url to read the full content of the most promising sources. "
            "3. Synthesize a detailed answer citing your sources."
        ),
    }],
)

graph = agent.compile()

query = "What are the latest developments in quantum computing?"
result = graph.invoke(
    {"messages": [Message.text_message(query)]},
    config={"thread_id": "quantum-1"},
)

print(result["messages"][-1].text())
```

The agent autonomously decides when to search broadly (with `google_web_search`), dig deeper into specific sources (with `fetch_url`), and how to structure its findings. This pattern scales to larger research tasks like competitive analysis, due diligence, or continuous monitoring.

## Error handling and resilience

All three tools return JSON responses. Failures from the tool itself come back as a JSON object rather than an exception, though network timeouts during a read can still raise. Check for the presence of `"error"` field:

```python
import json

from tenxgraph.prebuilt.tools import google_web_search

async def safe_web_search(query: str) -> dict:
    result = await google_web_search(query)
    data = json.loads(result)
    
    if "error" in data:
        print(f"Search failed: {data['error']}")
        return None
    
    return data
```

In production agents, implement retry logic at the graph level (using `RetryConfig`) or at the tool level (wrap the tool to add exponential backoff). For network timeouts, increase the `timeout` parameter on `fetch_url` or add retry steps to your agent's system prompt.

## Run it in production

`fetch_url` is built to resist server-side request forgery, which matters most when the server runs inside your network. Search tools call Google with your credentials, so keep them in the environment file and not in the image. See the [Security model](/docs/production/security-model).

## See also

- `/docs/guides/prebuilt-tools`: overview of all prebuilt tools and how to choose.
- `/docs/guides/use-tool-decorator`: how to write and integrate your own tools alongside prebuilt ones.
- `/docs/integrations/models`: verify that your chosen Gemini model supports the required features.
- `/docs/server/files-and-multimodal`: if you need to send web content (images, PDFs) to the model.
