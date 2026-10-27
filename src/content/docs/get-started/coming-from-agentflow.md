---
title: Coming from agentflow
description: Migrate from the old Agentflow package, import, command, config and environment variable names to 10xGraph, step by step.
updated: "2026-10-27"
order: 130
group: "Next steps"
section: "Get started"
faq:
  - q: Do I have to migrate now?
    a: No. The old names keep working until 2.0 and are removed then. Migrating now removes deprecation warnings and avoids a breaking upgrade later.
  - q: Do my REST API clients need changes?
    a: No. The HTTP routes are unchanged. Only a WebSocket client that sends the old agentflow-bearer subprotocol should move to 10xgraph-bearer, although the server still accepts both.
  - q: Can I keep the old and new packages installed together?
    a: No. Both ship an agentflow module, so uninstall 10xscale-agentflow and 10xscale-agentflow-cli before installing 10xgraph and 10xgraph-api.
---

10xGraph is the new name of Agentflow. The packages are now `10xgraph` (core) and `10xgraph-api` (server and CLI), imported as `tenxgraph` and `tenxgraph_api`, with the command `10xgraph` and the config file `10xgraph.json`. Old names still work until 2.0. This page walks through the rename.

## What changed

Every old name has a new one, and the old one is a deprecated alias that is removed in 2.0. Use this table as a checklist for your project.

| Item | Old | New |
|---|---|---|
| Core package (PyPI) | `10xscale-agentflow` | `10xgraph` |
| API and CLI package (PyPI) | `10xscale-agentflow-cli` | `10xgraph-api` |
| Core import | `agentflow` | `tenxgraph` |
| API import | `agentflow_cli` | `tenxgraph_api` |
| CLI command | `agentflow` | `10xgraph` |
| Config file | `agentflow.json` | `10xgraph.json` |
| CLI environment variables | `AGENTFLOW_*` | `TENXGRAPH_*` |
| WebSocket subprotocol | `agentflow-bearer` | `10xgraph-bearer` |
| Home directory | `~/.agentflow` | `~/.10xgraph` |
| Internal media scheme | `agentflow://media/` | `graph://media/` |
| Logger names | `agentflow.*` | `tenxgraph.*` |

The graph model does not change. Nodes, edges, state, messages and the checkpointer API behave as before, so this is a rename and not a rewrite. Python 3.12 or later is required.

## Replace the old packages with the new ones

Uninstall the old packages first, then install the new ones. Both generations ship a module called `agentflow`, so leaving the old packages in place causes conflicts.

```bash
# Remove the old distributions
pip uninstall 10xscale-agentflow 10xscale-agentflow-cli -y

# Install the new core and API packages (pick the provider extra you use)
pip install "10xgraph[google-genai]" 10xgraph-api
```

Other provider extras are `openai` and `anthropic`, and you can combine them, for example `"10xgraph[google-genai,openai,anthropic]"`. Add storage extras such as `pg_checkpoint` or `redis` the same way if you use them. See [Installation](/docs/get-started/installation) for the full list.

## Update Python imports

Replace `agentflow` with `tenxgraph` and `agentflow_cli` with `tenxgraph_api`. The old imports keep working because they resolve to the same module objects as the new ones, but they emit a deprecation warning.

```python
# Before
from agentflow import StateGraph, Agent, Message
from agentflow.storage.checkpointer import PgCheckpointer
from agentflow_cli import BaseAuth

# After
from tenxgraph import StateGraph, Agent, Message
from tenxgraph.storage.checkpointer import PgCheckpointer
from tenxgraph_api import BaseAuth
```

Only the top-level name changes. Submodule paths below it stay the same, so `agentflow.core.graph` becomes `tenxgraph.core.graph`. A search-and-replace of the two package names across your code and your `10xgraph.json` agent path is enough. The [reference](/docs/reference) lists the import path of every public symbol.

## Rename the config file

The server reads `10xgraph.json` first and falls back to `agentflow.json` when it is missing. Rename the file so there is no ambiguity. The keys are unchanged.

```bash
# Rename the project config (and any environment-specific variants)
mv agentflow.json 10xgraph.json
```

If you pass a path explicitly, use `--config`, for example `10xgraph dev --config ./config/prod.json`. The default value is `10xgraph.json`. See [Configure the server](/docs/server/configure) for every key.

## Rename CLI environment variables

For each CLI variable the CLI checks `TENXGRAPH_<NAME>` first and uses `AGENTFLOW_<NAME>` only when the new one is not set. Rename any you set, on your machine, in CI and in container files.

| Old name | New name |
|---|---|
| `AGENTFLOW_NO_FULLSCREEN` | `TENXGRAPH_NO_FULLSCREEN` |
| `AGENTFLOW_FULLSCREEN` | `TENXGRAPH_FULLSCREEN` |
| `AGENTFLOW_NO_SPINNER` | `TENXGRAPH_NO_SPINNER` |
| `AGENTFLOW_ASCII` | `TENXGRAPH_ASCII` |

Variables that configure your own app or the server, such as `JWT_SECRET_KEY`, `REDIS_URL` or `DATABASE_URL`, are not renamed. Core also still reads `AGENTFLOW_LLM_TIMEOUT` for the LLM client timeout.

## Update the WebSocket subprotocol

Browser clients that authenticate a WebSocket with a bearer token send it in the `Sec-WebSocket-Protocol` header as two entries: the sentinel, then the token. The sentinel is now `10xgraph-bearer`. The server still accepts the legacy `agentflow-bearer` sentinel.

```ts
// Before
// new WebSocket("ws://localhost:8000/v1/graph/ws", ["agentflow-bearer", token]);

// After: the sentinel first, then the JWT
const ws = new WebSocket("ws://localhost:8000/v1/graph/ws", ["10xgraph-bearer", token]);
```

The REST routes are unchanged. For the TypeScript client, see [the client section](/docs/client).

## Check the migration

Compile a graph with the new imports and start the server. This check does not call a model, so it needs no API key.

```python
# check_migration.py
from tenxgraph import StateGraph
from tenxgraph.core.state import AgentState
from tenxgraph.storage.checkpointer import InMemoryCheckpointer
from tenxgraph.utils.constants import END


def hello(state: AgentState):
    return state


graph = StateGraph()
graph.add_node("HELLO", hello)
graph.add_edge("HELLO", END)
graph.set_entry_point("HELLO")

app = graph.compile(checkpointer=InMemoryCheckpointer())
print("Graph compiled with tenxgraph")
```

```bash
# Run the compile check, then start the API server with your renamed config
python check_migration.py
10xgraph dev --no-open
```

Seeing no deprecation warnings means all imports are migrated. If the server starts from your renamed `10xgraph.json`, the config rename worked.

## Know what still works until 2.0

The old names keep working so you can migrate in stages. They are all removed in 2.0.

- `import agentflow` and `import agentflow_cli` resolve to the new modules and emit a deprecation warning.
- The `agentflow` command prints a deprecation notice and runs the same command as `10xgraph`.
- `agentflow.json` is loaded when no `10xgraph.json` exists.
- `AGENTFLOW_*` CLI variables are used when the `TENXGRAPH_*` one is not set.
- The `agentflow-bearer` WebSocket subprotocol is accepted.
- `agentflow://media/` URIs and objects stored under the old media prefix still resolve. New media URIs are written as `graph://media/`.

## Runtime paths and names

A few runtime locations moved. They are transparent in most projects, but know where they are if you script around them.

The SQLite checkpointer stores its default database at `~/.10xgraph/checkpointer.db`. If `~/.10xgraph` does not exist and `~/.agentflow` does, it keeps using the old directory, so existing data is not orphaned. Setting an explicit path avoids the question.

Logger names changed from `agentflow.*` to `tenxgraph.*`. If you configure logging by name, for example `logging.getLogger("agentflow.core")`, change it to `tenxgraph.core`.

## Fix common errors

### ModuleNotFoundError: No module named 'agentflow'

You uninstalled the old package but some code still imports from it. Change those imports to `tenxgraph` or `tenxgraph_api`.

### The server cannot find its config file

`10xgraph dev` looks for `10xgraph.json` in the working directory. Run it from the project root, or pass `--config` with the path.

### Deprecation warnings keep appearing

Something still imports `agentflow` or `agentflow_cli`, or you still run the `agentflow` command. Search your code, scripts, Dockerfiles and CI for the old names.

### A WebSocket client fails the handshake

Check that the client offers exactly two protocol entries: `10xgraph-bearer` (or the legacy `agentflow-bearer`) followed by the token. Browsers fail the handshake if the server does not confirm one of the offered subprotocols.

## Next steps

- [State graph](/docs/concepts/state-graph): how graphs compile and run.
- [Prebuilt agents](/docs/guides/prebuilt-agents): ready-made agent patterns.
- [Configure the server](/docs/server/configure): every `10xgraph.json` key.
- [Reference](/docs/reference): import paths and signatures for the public API.
