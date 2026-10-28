---
package: api
version: "0.6.0"
date: 2026-10-07
summary: Final release as 10xscale-agentflow-cli. Adds the AG-UI endpoint, interrupt resume over invoke and stream, server-declared remote tools, a browser config editor, and stricter handling of client-sent config.
breaking: true
---

This was the final release of the API server and CLI under the name `10xscale-agentflow-cli`. It continues as `10xgraph-api` from 0.7.0. The names below (`agentflow` command, `agentflow.json`) are the ones this release shipped with.

### Breaking

- **`POST /v1/graph/setup` is removed.** Declare client-executed tools under `remote_tools` in the config file instead; they are attached at startup.
- **`agentflow config list|get|set|unset|path|validate` are removed**, and stored `output.*` preferences are no longer read. Pass `--format`, `--color` and `--progress` on the command line. `agentflow config` is now the browser editor below.

### Added

- **AG-UI endpoint (`POST /v1/ag-ui`)** serves the graph over the [AG-UI protocol](https://docs.ag-ui.com), so AG-UI clients such as CopilotKit can use the agent. Off by default: set `"ag_ui": {"enabled": true}` and install the `ag-ui` extra. It uses the `graph:stream` permission, checks thread ownership when auth is configured, and streams text, reasoning, tool calls, node steps, state snapshots and `interrupt()` pauses. Browser tools the client sends are offered to the model for that run. See [AG-UI](/docs/server/ag-ui).
- **`resume` on `/v1/graph/invoke` and `/v1/graph/stream`** resumes a thread paused by `interrupt()`.
- **`remote_tools` in the config file.** Trusted schemas for client-executed tools, attached to the graph at startup. In request config, `remote_tools` is now server-owned: only protocol adapters such as AG-UI fill it.
- **`agentflow skills --validate PATH`** checks skills against the Agent Skills specification and exits `1` when any is invalid.
- **The bundled skill conforms to the Agent Skills specification**, and Codex, Claude and GitHub now receive one identical `SKILL.md`.
- **`agentflow config` opens a browser editor for the config file.** Optional sections can be switched on, filled in, validated and saved. Saving is blocked while there are errors, writes are atomic, and the previous file is kept as a `.bak`.
- **`websocket.max_connections_per_user`** caps concurrent WebSocket connections per verified user.
- **`rate_limit.trusted_proxies`** honours `X-Forwarded-For` only from listed IPs or CIDR ranges.

### Changed

- Requires `10xscale-agentflow>=0.10.0`, the first core release with `interrupt()`, per-run `remote_tools` and `validate_skill`.
- WebSocket connection limits default to finite values (`max_connections` 1000, `max_connections_per_user` 10). Set a key to `0` or `null` for unlimited. Graph runs over `/v1/graph/ws` count against the global rate limit.

### Security

- **Server-owned config keys are stripped from client requests.** `authz`, `user`, `user_id`, `remote_tools` and `_`-prefixed keys in a request's `config` are dropped on every route that forwards it.
- **Client messages can no longer carry tool calls.** A client may send a tool result only as the answer to a remote tool call still waiting for one.
- **Document extraction is bounded.** ZIP-based documents are inspected before parsing, extraction has a timeout, and extracted text is capped.
