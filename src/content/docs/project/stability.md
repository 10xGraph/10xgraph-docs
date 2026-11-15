---
title: Stability and deprecation policy
seoTitle: "10xGraph 1.0 stability and deprecation policy"
description: What 10xGraph 1.0 commits to. The public API of the framework, the API server and the client does not break before 2.0, and anything removed is deprecated first.
section: Project
order: 15
label: Stability
updated: "2026-11-16"
---

10xGraph reached 1.0 on 2026-11-16. The breaking changes that came with 1.0 are done, and the
[upgrade guide](/docs/project/upgrade-to-1.0) lists every one of them. From 1.0 on, the
public API does not change in a way that breaks your code until the next major version, 2.0.
Anything that has to go is deprecated first, keeps working while it is deprecated, and is
removed only in 2.0.

This applies to all three packages: `10xgraph`, `10xgraph-api` and `10xgraph-client`.

## What does not break in 1.x

| Package | Covered |
| --- | --- |
| `10xgraph` | Every documented class, function, argument and import path. A name that starts with `_` is private. |
| `10xgraph-api` | HTTP and WebSocket routes, request and response fields, error codes, `10xgraph.json` keys, CLI commands and their flags, environment variables, and the documented Python extension points such as `BaseAuth`. |
| `10xgraph-client` | Everything exported from the package entry point, and the entry points themselves. |

In a 1.x release we do not remove or rename anything in this table, change what an argument or
key means, or change a default in a way that makes working code fail. If we get one of these
wrong, it is a bug, and we fix it in a patch release.

## What can change in a minor release

Minor releases (1.1, 1.2, ...) add things. They can bring new classes, functions, optional
arguments, config keys, routes, response fields, error codes and trace attributes. Code
written for 1.0 keeps working on any 1.x release. Read new response fields as optional in
your own code, so that a newer server never breaks an older client.

Not covered by this policy: private names (a leading `_`), the wording of log lines and of
human-readable error messages (the error codes are covered), and the internals of the
Postgres schema, which the library migrates itself.

## How a deprecation works

1. The old name or behaviour is marked deprecated: a `DeprecationWarning` in Python, a
   `@deprecated` tag in TypeScript, a notice from the CLI, and a note in the docs. Each one
   names the replacement.
2. The changelog lists it under **Deprecated**, with the migration.
3. It keeps working for at least one minor release, and in practice until 2.0.
4. It is removed only in the next major version, listed under **Breaking** with the
   migration.

A module that moves keeps working at its old import path until 2.0.

## Already deprecated, removed in 2.0

- The `agentflow` import (use `tenxgraph`) and the `agentflow_cli` import (use
  `tenxgraph_api`).
- The `agentflow` CLI command (use `10xgraph`), `agentflow.json` (use `10xgraph.json`) and the
  `AGENTFLOW_*` CLI environment variables (use `TENXGRAPH_*`).
- The `agentflow-bearer` WebSocket subprotocol on the server (use `10xgraph-bearer`).
- The `AgentFlow*` aliases in the TypeScript client (use the `TenxGraph*` names).
- The module-level file tools and their root from the run config (use
  `create_file_tools(root=...)`).
- `PgVectorStore.adrop_legacy_key_index()` and the legacy key index handling.

## Versions across the three packages

- `major.minor` is the same for `10xgraph`, `10xgraph-api` and `10xgraph-client`.
  `10xgraph` 1.1.x works with `10xgraph-api` 1.1.x and `10xgraph-client` 1.1.x.
- A new feature in any package means all three release the next `X.Y.0` together. A package
  with no changes ships that release as "version alignment, no changes".
- Patch numbers move independently. A patch release contains only bug and security fixes.

Security fixes are released as a patch on the latest 1.x minor release; see
[Security](/docs/project/security). Every release is in the [changelog](/changelog).
