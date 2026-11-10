---
title: Roadmap and known gaps
description: What 10xGraph does not do yet, which surfaces are incomplete, and where dated release planning actually lives.
section: Project
order: 30
label: Roadmap
updated: "2026-11-10"
---

This page is the honest inventory: things that are announced, half-built, or
deliberately absent. It exists so you can tell whether 10xGraph fits your
project before you find out the hard way.

Dated planning and prioritisation happen in the open on GitHub:

- [Issues](https://github.com/10xGraph/10xGraph/issues) for tracked work
- [Discussions](https://github.com/10xGraph/10xGraph/discussions) for proposals
- [Releases](https://github.com/10xGraph/10xGraph/releases) for what actually shipped

Nothing on this page is a delivery commitment. If a gap blocks you, say so in an
issue: real demand reorders the list.

---

## Shipping in 1.0

These ship in 1.0. They are not in 1.0.0rc4; check the [changelog](/changelog) for the release candidate that includes each one.

- **Background jobs, worker and scheduler.** `10xgraph worker`, `10xgraph scheduler`, the `/v1/tasks` routes and the `worker` config key, on a TaskIQ broker. See [Run background tasks with a worker](/docs/server/background-tasks).
- **Audit log and JSON logs.** Metadata-only audit events (the `audit` config block) and `LOG_FORMAT=json`. 10xGraph writes the lines to stdout and stores nothing; your log pipeline keeps them. See [Audit log](/docs/server/audit-log).

The [control mapping](/docs/production/control-mapping) lists what 10xGraph does and does not provide for SOC 2 and ISO 27001 audits. It is a docs page, not a product feature.

---

## Not implemented yet

### Per-tool permissions

Permissions apply per route (for example `graph:invoke`), not per tool. A role cannot allow one tool and deny another.

**Today:** restrict tools with tool tags or separate graphs, and check authorization inside the tool. See [authentication and authorization](/docs/server/auth).

### Agent-to-Agent (A2A) serving

The core package ships an optional `a2a_sdk` extra, but the API server does not
expose an A2A endpoint. The `a2a` routers were removed from the CLI package in a
recent release because they were commented out, never mounted, and shipping as
dead code in the wheel. They can be restored from git history when the surface is
actually built.

**Today:** agents talk to each other in-process through
[handoffs](/docs/guides/handoff-between-agents) and
[supervisor or swarm topologies](/docs/guides/prebuilt/supervisor-team-agent).
Cross-process agent calls go over the normal REST API.

### File attachments in the playground

The playground's **Files** page is a placeholder marked "Soon", and the paperclip
button in the chat composer is inert.

**Today:** file upload works over the REST API and the TypeScript client. See
[send images and documents](/docs/client/files-and-multimodal).

### Server-owned schemas for client tools

`registerToolHandler()` stores a handler locally. Tools the browser can execute
must be declared under `remote_tools` in server `10xgraph.json`.

See [register remote tools](/docs/client/remote-tools).

---

## Partial support

| Area | What works | What does not |
| --- | --- | --- |
| Gemini explicit context caching | Caching through the provider directly | `SummaryContextManager` does not accept `cached_content`, and caching is not wired through `CriterionConfig`. See [Google provider](/docs/integrations/google). |
| OpenAI evaluation judge | The judge calls `call_llm` normally | Extra kwargs are not forwarded from the judge configuration. See [OpenAI provider](/docs/integrations/openai). |
| `ExactMatchCriterion` | Usable by constructing it directly | Not reachable through `CriteriaConfig`, which forbids unknown keys and has no `exact_match` field. |
| Light theme on this docs site | Readable and complete | Tuned less carefully than the dark theme, which is canonical. |

---

## Deliberately out of scope

These are not gaps. They are decisions, and they are unlikely to change.

- **No hosted control plane.** 10xGraph is a library plus a server you run. There
  is no account, no telemetry phoning home, and no paid tier gating features.
- **No LangChain dependency.** Provider clients are implemented directly. That is
  why the dependency tree is small and why LangChain integrations do not drop in
  unchanged.
- **No sandboxing of tools.** Tools run with the privileges of the host process
  by design. Isolation is your deployment's job. See the
  [security policy](/docs/project/security).
- **No prompt-injection guarantee.** The framework gives you validators,
  per-tool authorization, and human-in-the-loop interrupts. It does not claim to
  make a language model safe to point at untrusted input.

---

## Stability commitments

From 1.0 on, the public API is covered by a deprecation policy: nothing public is
removed without at least one minor release of warning, and moved modules keep a
shim.
