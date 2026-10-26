---
title: "Prebuilt tools"
description: "Reference for 10xGraph prebuilt tools: web fetch, file operations, web and semantic search, safe calculator, and long-term memory tools."
order: 250
group: "Python library"
section: Reference
updated: "2026-10-26"
---

10xGraph ships ten ready-made tools in `tenxgraph.prebuilt.tools`: URL fetching, workspace file read, write and search, Google web and Vertex AI search, a safe calculator, and long-term memory. Each is a plain function you pass to a `ToolNode`, and each returns a JSON string.

All tools return JSON strings. Failures are returned as `{"error": "..."}` instead of raised, so the model can read the message and retry. For task-oriented walkthroughs, see [Prebuilt tools](/docs/guides/prebuilt-tools).

## Import

```python
from tenxgraph.prebuilt.tools import (
    fetch_url,
    file_read, file_write, file_search,
    google_web_search, vertex_ai_search,
    safe_calculator,
    memory_tool,
    make_user_memory_tool, make_agent_memory_tool,
)
```

## Use the tools in a ToolNode

Pass any prebuilt tool to a `ToolNode`, then give that node to an `Agent`. This example wires the calculator and file tools into an agent.

```python title="agent_with_tools.py"
from tenxgraph.core.graph import Agent, StateGraph, ToolNode
from tenxgraph.prebuilt.tools import file_read, safe_calculator

# Tools are ordinary functions; ToolNode builds the schemas from them.
tool_node = ToolNode([safe_calculator, file_read])

graph = StateGraph()
graph.add_node("MAIN", Agent(model="gpt-4o", tool_node="TOOL"))
graph.add_node("TOOL", tool_node)
```

See [Tools](/docs/reference/python/tools) for `ToolNode` and the `@tool` decorator, and [Agent](/docs/reference/python/agent) for the full constructor. Each prebuilt tool carries `tags` and `capabilities` metadata (for example `web`, `file`, `math`, `memory`) that you can use with `tools_tags` to filter which tools an agent sees.

## fetch_url

Fetch a public HTTP or HTTPS URL and return its text content. Blocks hosts that resolve to private, loopback, link-local, multicast, reserved or unspecified addresses, applies a timeout, and truncates long responses. HTML is converted to plain text (script, style and noscript content is dropped). The HTTP request runs in a worker thread.

```python
async def fetch_url(
    url: str,
    timeout: float = 10.0,
    max_chars: int = 20000,
) -> str:
    """Fetch a public URL and return normalized text content."""
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | `str` | Required | URL to fetch. Must use http or https scheme. Private/local hosts are blocked. |
| `timeout` | `float` | `10.0` | Request timeout in seconds. Clamped to [1.0, 30.0]. |
| `max_chars` | `int` | `20000` | Maximum response characters. Clamped to [1, 20000]. |

**Returns:** JSON string with `url` (the final URL after redirects), `status_code`, `content_type`, `content` (text), and `truncated` boolean. Errors: `{"error": "message"}`, plus `status_code` for HTTP errors. Non-http(s) schemes, non-public or unresolvable hosts and URL errors all return an error.

**Example:**

```python
from tenxgraph.prebuilt.tools import fetch_url

import asyncio

result = asyncio.run(fetch_url("https://example.com"))
# Example result: {"url": "...", "status_code": 200, "content_type": "text/html", "content": "...", "truncated": false}
```

## file_read

Read a UTF-8 text file from the configured workspace root. Returns a slice of the file (by line number) and truncates long output.

All three file tools resolve paths under one root: the `file_tool_root` key of the injected `config` dict, then `workspace_root`, then the current directory. A path that resolves outside the root returns an error. Secret files (`.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*key*.json`, `service_account*.json`, `id_rsa*`, `id_ed25519*`, `.netrc`, `.npmrc`, `.pypirc`, and anything under `.ssh`, `.aws`, `.gnupg` or `.git`) are hidden and return `path is not allowed`.

Reading the root from the run config is deprecated and will be removed in 0.11. `create_file_tools(root, *, read=True, write=True, search=True, deny=(), use_default_deny=True)` returns the same three tools locked to a root set in code. `deny` adds glob patterns to hide, and `use_default_deny=False` drops the default list.

```python
def file_read(
    path: str,
    start_line: int = 1,
    end_line: int = 0,
    max_chars: int = 20000,
    config: dict[str, Any] | None = None,
) -> str:
    """Read a workspace-scoped text file."""
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `path` | `str` | Required | Relative or absolute path. Resolved under the workspace root. |
| `start_line` | `int` | `1` | First line to read (1-indexed). |
| `end_line` | `int` | `0` | Last line to read (1-indexed, inclusive). 0 means end of file. |
| `max_chars` | `int` | `20000` | Maximum characters to return. Clamped to [1, 20000]. |
| `config` | `dict` | `None` | Runtime config (hidden from the model) holding `file_tool_root` or `workspace_root`. |

**Returns:** JSON string with `path`, `start_line`, `end_line`, `content`, and `truncated` boolean. Errors: file missing, path not a file, binary file (a NUL byte in the first 2048 bytes), or `end_line` below `start_line`.

**Example:**

```python
from tenxgraph.prebuilt.tools import file_read

result = file_read("src/main.py", start_line=1, end_line=50)
# Example result: {"path": "src/main.py", "start_line": 1, "end_line": 50, "content": "...", "truncated": false}
```

## file_write

Write UTF-8 text to a file under the configured workspace root. Supports create, overwrite, and append modes. Parent directories can be created if they don't exist.

```python
def file_write(
    path: str,
    content: str,
    mode: Literal["create", "overwrite", "append"] = "create",
    create_dirs: bool = False,
    config: dict[str, Any] | None = None,
) -> str:
    """Write UTF-8 text to a workspace-scoped file."""
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `path` | `str` | Required | Relative or absolute path under workspace root. |
| `content` | `str` | Required | UTF-8 text to write. Capped at 200,000 characters. |
| `mode` | `Literal` | `"create"` | `"create"` (fail if exists), `"overwrite"` (replace), or `"append"` (add to end). |
| `create_dirs` | `bool` | `False` | If True, create parent directories if they don't exist. |
| `config` | `dict` | `None` | Runtime config with the workspace root. |

**Returns:** JSON string with `status` (`"written"`), `path`, `bytes` (UTF-8 byte count), and `mode`. Errors: content over 200,000 characters, file exists in `create` mode, target is not a file, or parent directory missing while `create_dirs` is false.

**Example:**

```python
from tenxgraph.prebuilt.tools import file_write

result = file_write("output.txt", "Hello, world!", mode="create")
# Returns: {"status": "written", "path": "output.txt", "bytes": 13, "mode": "create"}
```

## file_search

Search text files in the workspace by filename and content. Returns matching file paths, line numbers, and text previews. Skips directories such as `.git`, `.venv`, `__pycache__`, `node_modules`, `build` and `dist`, binary files, and files over 1,000,000 bytes. Previews are trimmed to 240 characters.

```python
def file_search(
    query: str,
    path: str = "",
    glob: str = "**/*",
    max_results: int = 20,
    config: dict[str, Any] | None = None,
) -> str:
    """Search workspace-scoped text files by filename and content."""
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | `str` | Required | Search term (case-insensitive). |
| `path` | `str` | `""` | Relative path to start search from. Empty string means workspace root. |
| `glob` | `str` | `"**/*"` | Glob pattern. Only the final filename part is matched against file names (for example `"*.py"` or `"**/*_test.py"` match by `*.py` and `*_test.py`). |
| `max_results` | `int` | `20` | Maximum results. Clamped to [1, 100]. |
| `config` | `dict` | `None` | Runtime config with the workspace root. |

**Returns:** JSON string with `query`, `root`, and `results` array. Each result has `path`, `match_type` (`"filename"` or `"content"`), `line` (null for filename matches), and `preview`. Errors: empty `query` or a search path that does not exist.

**Example:**

```python
from tenxgraph.prebuilt.tools import file_search

result = file_search("def main", glob="**/*.py", max_results=10)
# Example result: {"query": "def main", "root": ".", "results": [
#   {"path": "src/main.py", "match_type": "content", "line": 42, "preview": "def main():"},
#   ...
# ]}
```

## google_web_search

Search the public web with Gemini Google Search grounding. Returns the LLM-grounded answer plus grounding metadata (citations, sources).

```python
async def google_web_search(
    query: str,
    model: str = "gemini-2.5-flash",
    max_chars: int = 20000,
) -> str:
    """Search the public web with Gemini Google Search grounding."""
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | `str` | Required | Web search query. |
| `model` | `str` | `"gemini-2.5-flash"` | Gemini model to use for grounding. |
| `max_chars` | `int` | `20000` | Maximum response characters. Clamped to [1, 20000]. |

**Returns:** JSON string with `content` (grounded answer), `grounding_metadata` (citations and sources), and `truncated` boolean. On error: `{"error": "message"}`.

**Requires:** `pip install "10xgraph[google-genai]"` and Google GenAI credentials in the environment, because the tool creates a default `genai.Client()`. Without the extra, the tool returns an error with the install command. An empty `query` also returns an error.

**Example:**

```python
from tenxgraph.prebuilt.tools import google_web_search

import asyncio

result = asyncio.run(google_web_search("latest Python releases"))
# Example result: {"content": "...", "grounding_metadata": {...}, "truncated": false}
```

## vertex_ai_search

Search a Vertex AI Search datastore with Gemini grounding. Requires a configured datastore and Google Cloud credentials. The client uses API version `v1`.

```python
async def vertex_ai_search(
    query: str,
    datastore: str,
    model: str = "gemini-2.5-flash",
    max_chars: int = 20000,
) -> str:
    """Search a Vertex AI Search datastore with Gemini grounding."""
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | `str` | Required | Search query. |
| `datastore` | `str` | Required | Full Vertex AI Search datastore resource path (e.g. `projects/PROJECT_ID/locations/global/collections/default_collection/dataStores/DATASTORE_ID`). |
| `model` | `str` | `"gemini-2.5-flash"` | Gemini model for grounding. |
| `max_chars` | `int` | `20000` | Maximum response characters. Clamped to [1, 20000]. |

**Returns:** JSON string with `content`, `grounding_metadata`, and `truncated`. On error: `{"error": "message"}`.

**Requires:** `pip install "10xgraph[google-genai]"`, Vertex AI Search datastore, and Google Cloud credentials.

**Example:**

```python
from tenxgraph.prebuilt.tools import vertex_ai_search

import asyncio

result = asyncio.run(
    vertex_ai_search(
        "internal documentation",
        "projects/my-project/locations/global/collections/default_collection/dataStores/my-datastore",
    )
)
# Example result: {"content": "...", "grounding_metadata": {...}, "truncated": false}
```

## safe_calculator

Safely evaluate a basic arithmetic expression. Supports numbers, parentheses, and the operators `+`, `-`, `*`, `/`, `//`, `%`, and `**`. Enforces conservative size limits to prevent abuse.

```python
def safe_calculator(
    expression: str,
    precision: int | None = None,
) -> str:
    """Evaluate a basic arithmetic expression safely."""
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `expression` | `str` | Required | Arithmetic expression. Max 500 characters. Numbers and results are capped at an absolute value of 10^12, and `**` exponents at 12. |
| `precision` | `int` | `None` | Decimal places for float results. Clamped to [0, 12]. |

**Returns:** JSON string with `result` (int or float). Errors: empty or too long expression, unsupported syntax (names, calls, comparisons), values out of range, or division by zero. A unary `+` or `-` is allowed. `precision` only rounds float results.

**Example:**

```python
from tenxgraph.prebuilt.tools import safe_calculator

result = safe_calculator("(10 + 5) * 2")
# Returns: {"result": 30}

result = safe_calculator("3.14159 * 2", precision=2)
# Returns: {"result": 6.28}
```

## memory_tool

Legacy long-term memory tool for manual graph wiring or `MemoryIntegration`. Supports search, store, update, and delete operations. For new code, pass `memory=MemoryConfig(...)` to an `Agent` instead, which creates `user_memory_tool` and `agent_memory_tool` automatically. `memory_tool` needs a `BaseStore` and a `BackgroundTaskManager` registered in the InjectQ container; without a store it returns `{"error": "no memory store configured"}`.

```python
async def memory_tool(
    action: Literal["search", "store", "update", "delete"] = "search",
    content: str = "",
    memory_key: str = "",
    memory_id: str = "",
    query: str = "",
    memory_type: str | None = None,
    category: str | None = None,
    metadata: dict[str, Any] | None = None,
    limit: int = 5,
    score_threshold: float | None = None,
    write_mode: Literal["merge", "replace"] = "merge",
    config: dict[str, Any] | None = None,
    store: BaseStore | None = Inject[BaseStore],
    task_manager: BackgroundTaskManager = Inject[BackgroundTaskManager],
) -> str:
    """Search, store, update, or delete long-term memories."""
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `action` | `Literal` | `"search"` | `"search"` (retrieve), `"store"` (save new), `"update"` (modify), or `"delete"` (remove). |
| `content` | `str` | `""` | Memory content. Required for store and update. |
| `memory_key` | `str` | `""` | Short snake_case identifier used to detect duplicates. Added to metadata as `memory_key`. |
| `memory_id` | `str` | `""` | ID of memory to update or delete. Required for update and delete. |
| `query` | `str` | `""` | Search query. Required for search. |
| `memory_type` | `str` | `None` | Memory type. Falls back to `config["memory_type"]`, then `"episodic"`. |
| `category` | `str` | `None` | Memory category for organization. Falls back to `config["category"]`, then `"general"`. |
| `metadata` | `dict` | `None` | Custom metadata for the memory entry. |
| `limit` | `int` | `5` | Maximum search results. |
| `score_threshold` | `float` | `None` | Minimum similarity score for search results. |
| `write_mode` | `Literal` | `"merge"` | `"merge"` (upsert) or `"replace"` (overwrite). |
| `config` | `dict` | `None` | Runtime memory config. |
| `store` | `BaseStore` | Injected | Memory store instance (Qdrant, Mem0, etc.). |
| `task_manager` | `BackgroundTaskManager` | Injected | Task manager for async write operations. |

**Returns:** For search, a JSON list of formatted results. For store, update and delete, `{"status": "scheduled", "action": "..."}`, because writes run in the background. Errors: `query` missing for search, `content` missing for store or update, `memory_id` missing for update or delete.

**Example:**

```python
from tenxgraph.prebuilt.tools import memory_tool

# Inside an async node or after wiring a store through InjectQ:
# search
result = await memory_tool(action="search", query="user preferences")

# store (scheduled in the background)
result = await memory_tool(
    action="store",
    content="User prefers Python over JavaScript",
    memory_key="language_preference",
)
```

## make_user_memory_tool

Factory function that creates a user-scoped memory tool for an Agent. Returns a callable named `user_memory_tool` that agents can invoke to search and remember user facts. The tool is added when `MemoryConfig.user_memory` is enabled (it is by default) and retrieval mode is the default post-load mode.

```python
def make_user_memory_tool(memory_config: Any) -> Callable:
    """Create the user-scoped model-facing memory tool for an Agent."""
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `memory_config` | `Any` | MemoryConfig instance with user_memory scope settings. |

**Returns:** Callable that accepts:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `action` | `Literal` | `"search"` | `"search"` (retrieve user facts) or `"remember"` (save facts). |
| `text` | `str` | `""` | Search query or fact to remember. Empty text returns an error. |
| `memory_type` | `str` | `None` | Falls back to the scope config (`"episodic"` by default). |
| `category` | `str` | `None` | Falls back to the scope config (`"general"` by default). |
| `limit` | `int` | `None` | Maximum results. Falls back to the scope limit, then `MemoryConfig.limit` (5). |
| `config` | `dict` | `None` | Runtime config, merged over the memory config. |
| `store` | `BaseStore` | Injected | Fallback store when none is set in the memory config. |
| `task_manager` | `BackgroundTaskManager` | Injected | Task manager. |

Returns JSON search results, or `{"status": "scheduled", "action": "remember"}` for saves. Returns an error if user memory is disabled or no store is available.

**Example:**

```python title="user_memory_agent.py"
from tenxgraph.core.graph import Agent
from tenxgraph.storage.store import MemoryConfig, OpenAIEmbedding, create_local_qdrant_store

# Local Qdrant store. Install: pip install "10xgraph[openai,qdrant]" and set OPENAI_API_KEY.
store = create_local_qdrant_store(
    path="./qdrant_data",
    embedding=OpenAIEmbedding(),
    collection="user_memory",
)

# user_memory is enabled by default, so user_memory_tool is added to the agent.
agent = Agent(model="gpt-4o", memory=MemoryConfig(store=store))
```

## make_agent_memory_tool

Factory function that creates a read-only, agent/app-scoped memory tool for an Agent. Returns a callable named `agent_memory_tool` that agents can query but not modify. The tool is added only when `MemoryConfig.agent_memory` is enabled, which is off by default.

```python
def make_agent_memory_tool(memory_config: Any) -> Callable:
    """Create the read-only agent-scoped model-facing memory tool for an Agent."""
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `memory_config` | `Any` | MemoryConfig instance with agent_memory scope settings. |

**Returns:** Callable that accepts:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | `str` | Required | Search query. |
| `memory_type` | `str` | `None` | Falls back to the scope config (`"episodic"` by default). |
| `category` | `str` | `None` | Falls back to the scope config (`"general"` by default). |
| `limit` | `int` | `None` | Maximum results. Falls back to the scope limit, then `MemoryConfig.limit` (5). |
| `config` | `dict` | `None` | Runtime config, merged over the memory config. |
| `store` | `BaseStore` | Injected | Fallback store when none is set in the memory config. |
| `task_manager` | `BackgroundTaskManager` | Injected | Task manager. |

Returns JSON search results only; the tool cannot write, update or delete. Returns an error if agent memory is disabled, no store is available or `query` is empty.

**Example:**

```python title="agent_memory_agent.py"
from tenxgraph.core.graph import Agent
from tenxgraph.storage.store import (
    AgentMemoryConfig,
    MemoryConfig,
    OpenAIEmbedding,
    create_local_qdrant_store,
)

store = create_local_qdrant_store(
    path="./qdrant_data",
    embedding=OpenAIEmbedding(),
    collection="agent_memory",
)

# Agent memory is off by default; enable it to add agent_memory_tool.
memory = MemoryConfig(
    agent_memory=AgentMemoryConfig(enabled=True, store=store, agent_id="support-bot"),
)
agent = Agent(model="gpt-4o", memory=memory)
```

For retrieval modes, scoping and when to prefer memory tools over preloading, see [Long-term memory](/docs/concepts/memory-and-store) and [Memory tools](/docs/guides/prebuilt/memory-tools).
