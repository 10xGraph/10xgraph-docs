---
package: api
version: "1.0.0rc6"
date: 2026-11-11
summary: The sixth 1.0 release candidate. Tools and MCP servers can call services as the signed-in user, and 10xgraph build generates the job worker and scheduler. Tracing now defaults to full and WebSocket ?token= is gone.
breaking: true
---

The sixth 1.0 release candidate. Tools and MCP servers can call services as the signed-in user, and `10xgraph build` generates the background job worker and scheduler. Pip skips it unless you pass `--pre`:

```bash
pip install -U --pre "10xgraph-api==1.0.0rc6"
```

It requires `10xgraph` 1.0.0rc6 and ships with `10xgraph-client` 1.0.0-rc.3. Read **Breaking** and the [upgrade guide](/docs/project/upgrade-to-1.0) before upgrading.

### Breaking

- **Tracing defaults to `full`.** `OTEL_LEVEL`, `observability.level` in `10xgraph.json` and the fallback for an invalid value are now `full` (was `standard`), so message content and graph state reach the trace backend by default, also in production (the production warning for `full` is gone). **Migration:** set `OTEL_LEVEL=standard` or `"level": "standard"` (or `spans`) to keep content out. When the graph already has its own observability publisher (Phoenix, LangSmith, Logfire, OTel), the `observability` block is not applied, its level included, and a warning says so.
- **WebSocket routes no longer accept `?token=`.** `/v1/graph/ws` and `/v1/graph/live` take the bearer from the `Authorization` header or the `10xgraph-bearer` subprotocol only. A token in the URL ended up in access logs, proxy logs and HTTP trace spans. **Migration:** `10xgraph-client` already uses the subprotocol; other clients that put the token in the URL must switch.
- **`BaseAuth.downstream_credential` is async**, so an override can call an identity provider. **Migration:** declare your override with `async def` and `await` it where you call it.

### Added

- **Tools can call services as the signed-in user.** After a request authenticates, the API puts the caller's credential into the run config as `config["credential"]` (a core `UserCredential`: redacted repr, refuses JSON and pickling) for invoke and stream (resume included), `/v1/graph/ws`, `/v1/graph/live` and AG-UI. A tool reads it through a parameter named `credential`, and `ToolNode(mcp_auth=...)` sees it. Needs `10xgraph` 1.0.0rc6 or later.
- New hook `BaseAuth.downstream_credential(connection, credential, claims)`. The default returns the bearer token the request carried (header, or on a WebSocket the `10xgraph-bearer` subprotocol). Override it when `authenticate` verifies a cookie or an API key, or return None for no credential. `authenticate()` is unchanged.
- `credential` is a reserved config key: a client value is dropped, and `runs.config_keys` cannot admit it. It is never put in the identity, claims, audit events, logs, thread naming, stop or fix, and never in background tasks (`/v1/tasks` payloads, task status and results carry user data only).
- **`10xgraph build` generates the background-job processes.** With a non-`memory` `worker` key in `10xgraph.json`, `docker-compose.yml` gets `worker` and `scheduler` services and `k8s.yaml` gets `<service>-worker` and `<service>-scheduler` Deployments (the scheduler has one replica and `strategy: Recreate`). At a terminal `build` asks where you deploy, whether to run the worker and the scheduler, and whether to overwrite. The flags `--worker/--no-worker` and `--scheduler/--no-scheduler` answer them. It warns when the `jobs` extra for the broker is missing.
- **`10xgraph skills` adds always-on project instructions.** The Claude target also writes a 10xGraph section into the project-root `CLAUDE.md`, and the Codex target into `AGENTS.md`. The section tells the agent, and every subagent it starts, to load the skill first, and sets the default shape (prebuilt `ReactAgent`, one agent, business rules in tools, MCP identity through request metadata). It sits between `<!-- 10xgraph:start -->` and `<!-- 10xgraph:end -->`; text outside the markers is never changed, an existing file does not need `--force`, symlinked files are refused, and the file is written atomically.

### Changed

- **`10xgraph init` checks for existing files before writing.** It used to fail on the first existing file and leave a partial scaffold. Now it asks once before overwriting (default No; No writes nothing), or without a terminal stops before any write and lists the files. `--force` skips the question; `--dry-run` marks existing files.
- **Bundled skill: smaller apps by default.** The skill and the Copilot instructions describe 10xGraph as infrastructure for production AI agents (multi-agent is one feature), list prebuilt agents before hand-written `StateGraph` loops, add a "Default shape" section, and show how an MCP server reads the signed-in user from `ctx.request_context.meta["user"]`. New example: a support agent over MCP with `ReactAgent`.
- **Bundled skill: tool names and the tool results ledger.** The skill and docs say a tool's name is its function name (`@tool` no longer takes `name`, a breaking change in `10xgraph`), and describe `record_tool_result` and the checkpointer's tool results ledger.
- Refresh a project's copy of the skill with `10xgraph skills --agent claude --force` (or `--all --force`).

### Fixed

- **Boot in `10xgraph build` images with a `worker` key.** The tasks router no longer imports the CLI (`typer`, `rich`), which the slim image removes. The server and jobs import without them.
- **No control-socket error on a read-only root.** The generated gunicorn commands pass `--no-control-socket`, and the Dockerfile installs `gunicorn>=25.1,<27` (the flag is new in 25.1).
- **An input validator rejection is a 422, not a 500.** `/v1/graph/invoke` answers 422 `VALIDATION_ERROR`; stream and WebSocket send an error chunk with that code. Logged at WARNING.
- **A missing bearer token answers `INVALID_TOKEN`**, not `REVOKED_TOKEN`.
