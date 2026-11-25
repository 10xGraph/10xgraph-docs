---
title: Use prebuilt tools
description: Handoff and memory tools, and the deprecated calculator, fetch, search and file tools.
section: "Build agents"
group: "Tools and MCP"
order: 170
label: Prebuilt tools
updated: "2026-11-26"
faq:
  - q: 'Can I mix prebuilt tools with custom tools?'
    a: 'Yes. Pass all tools to a single ToolNode. Prebuilt and custom tools coexist without conflict.'
  - q: 'How do I filter which tools an agent sees?'
    a: 'Use Agent(..., tools_tags={"tag_name"}) to expose only tools with that tag. Set tags with @tool(tags=[...]).'
---

<aside class="callout callout-warning" role="note"><p class="callout-title">Deprecated in 1.1.0, removed in 2.0</p>

The calculator, fetch, search and file tools (`safe_calculator`, `fetch_url`, `google_web_search`, `vertex_ai_search`, `file_read`, `file_write`, `file_search`) and their factories (`create_fetch_url`, `create_google_web_search`, `create_vertex_ai_search`, `create_file_tools`) are deprecated and will be removed in 2.0. They keep working and emit a `DeprecationWarning` when a tool is called or a factory is created. Write your own tool with [Use the tool decorator](/docs/guides/use-tool-decorator), or connect an MCP server with [Use MCP](/docs/guides/use-mcp). The handoff and memory tools stay.

</aside>

`tenxgraph.prebuilt.tools` holds the handoff and memory tools, plus the deprecated tools below. Pass them to a `ToolNode` or a prebuilt agent's `tools` list, next to your own tools.

## Hand off between agents

`create_handoff_tool` makes a `transfer_to_<agent_name>` tool. When the model calls it, the graph routes to that node instead of running a function.

```python
from tenxgraph.core.graph import ToolNode
from tenxgraph.prebuilt.tools import create_handoff_tool

transfer_to_billing = create_handoff_tool(
    agent_name="billing",
    description="Transfer the user to the billing agent for payment questions.",
)
tool_node = ToolNode([transfer_to_billing])
```

Without `description`, the model sees "Transfer control to billing agent". See [Handoff between agents](/docs/guides/handoff-between-agents).

## Memory tools

`Agent(..., memory=MemoryConfig(...))` and the prebuilt agents' `memory=` add the memory tools for you. Build them yourself only for a custom `ToolNode`:

```python
from tenxgraph.core.graph import ToolNode
from tenxgraph.prebuilt.tools import make_agent_memory_tool, make_user_memory_tool
from tenxgraph.storage.store import MemoryConfig, OpenAIEmbedding, create_local_qdrant_store

store = create_local_qdrant_store("./qdrant_data", OpenAIEmbedding())
config = MemoryConfig(store=store)
tool_node = ToolNode([make_user_memory_tool(config), make_agent_memory_tool(config)])
```

See the [memory tools guide](/docs/guides/prebuilt/memory-tools) and [Use the memory store](/docs/guides/use-memory-store).

## Deprecated tools

| Tool | What it does | Fix its settings in code with | Details |
|---|---|---|---|
| `safe_calculator` | Evaluates arithmetic with Python's `ast`, no code execution | - | [Reference](/docs/reference/python/prebuilt-tools) |
| `fetch_url` | Fetches the text of a public HTTP or HTTPS URL | `create_fetch_url(allowed_hosts)` | [Reference](/docs/reference/python/prebuilt-tools#fetch_url) |
| `google_web_search`, `vertex_ai_search` | Gemini Google Search grounding, or a Vertex AI Search datastore (`google-genai` extra) | `create_google_web_search(model)`, `create_vertex_ai_search(datastore, model)` | [Reference](/docs/reference/python/prebuilt-tools#google_web_search) |
| `file_read`, `file_write`, `file_search` | Read, write and search inside one directory | `create_file_tools(root)` | [Reference](/docs/reference/python/prebuilt-tools#file_read) |

In a graph that serves requests, build the fetch and file tools with their factory, so the allowed hosts or the root are fixed in code. Setting the file root through the run config (`file_tool_root`, `workspace_root`) is deprecated and removed in 2.0.

`create_fetch_url(allowed_hosts)` limits `fetch_url` to the hosts you list. Give `vertex_ai_search` the full datastore resource path (`projects/<project>/locations/global/collections/default_collection/dataStores/<id>`).

`create_file_tools(root, *, read=True, write=True, search=True, deny=(), use_default_deny=True)` returns the selected tools and raises `ValueError` when `root` is not an existing directory. `deny=` adds glob patterns to hide (matched ignoring case against every part of the path under the root and the whole relative path). `use_default_deny=False` drops the built-in secret patterns, so use it only when the root holds nothing sensitive.
