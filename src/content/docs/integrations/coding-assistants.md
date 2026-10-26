---
title: Coding assistants
seoTitle: "10xGraph skills for Codex, Claude, Copilot"
description: Install the bundled 10xGraph skill for Codex, Claude, or GitHub Copilot so they understand the framework and write correct code.
section: Integrations
group: "Coding assistants"
order: 90
updated: "2026-10-26"
faq:
  - question: "Do I need to install the skill?"
    answer: "No. The skill is optional. If your coding assistant already knows 10xGraph, you do not need it. Install the skill when you want better suggestions and fewer mistakes in generated 10xGraph code."
  - question: "How is this different from Agent Skills?"
    answer: "This page is about teaching your coding assistant (Claude Code, Codex, Copilot). Agent Skills are a runtime feature your agents load on demand. See the [Agent Skills guide](/docs/guides/use-skills) for that."
  - question: "What if I upgrade the CLI?"
    answer: "Run `10xgraph skills --agent claude --force` to update the installed skill to the latest version bundled with your CLI."
---

The 10xGraph CLI ships with bundled coding-assistant skills that teach your coding assistant (Claude Code, Codex, GitHub Copilot) how to build with 10xGraph. A skill is a folder of instructions and reference documentation following the [Agent Skills specification](https://agentskills.io/specification). When you install a 10xGraph skill, your assistant gains knowledge of the framework's graph model, tool patterns, API routes, CLI commands, and production best practices without explaining them every session.

## Why install a coding-assistant skill

When you run `10xgraph skills --agent claude`, the CLI copies a folder into your project containing a `SKILL.md` entry point and 33 reference documents. Your assistant reads `SKILL.md` to understand when to use the 10xGraph skill, which packages exist, and which reference to consult before changing each subsystem. The reference documents cover architecture, agents and tools, state graphs, checkpointing, dependency injection, media handling, streaming, the API server, CLI commands, TypeScript client conventions, and testing. This makes your assistant much more likely to generate correct code that follows 10xGraph patterns.

Install the skill when you want:

- Fewer mistakes in generated 10xGraph code (correct imports, API usage, patterns)
- Better autocomplete and suggestions inside your IDE
- Quick answers about framework concepts without leaving your editor
- Consistent guidance across multiple team members' assistants

## Install the skill for your assistant

Run from your project root:

```bash
10xgraph skills --agent claude
10xgraph skills --agent codex
10xgraph skills --agent github
```

The `--agent` flag accepts `codex`, `claude`, `github` (case-insensitive) or the menu number `1`, `2`, `3`. If you omit it in an interactive terminal, the CLI shows a checkbox list (Codex, Claude, GitHub) where you pick one or more agents; agents that already have the skill are pre-checked. Without a terminal it fails and asks for `--agent` or `--all`, so always pass one in CI:

```bash
10xgraph skills --agent claude  # Non-interactive mode
```

If the skill is already installed, naming that agent with `--agent` fails with "Skill already installed" unless you pass `--force`. In an interactive terminal the CLI offers to overwrite instead.

## Where the skill gets installed

The same base skill bundle is copied into the assistant-specific directory. Each assistant looks for skills in a different location, so one 10xGraph installation works with all three.

| Assistant | Install path |
|---|---|
| Claude Code | `.claude/skills/10xgraph/` |
| Codex | `.agents/skills/10xgraph/` |
| GitHub Copilot | `.github/skills/10xgraph/` and `.github/instructions/10xgraph.instructions.md` |

The CLI also writes a manifest file (`.10xgraph-skill.json`) into the installed directory, recording the target agent, CLI version, and installation timestamp.

For GitHub Copilot, the `.github/instructions/10xgraph.instructions.md` file is a single instruction file that points Copilot at the full skill bundle under `.github/skills/10xgraph/`. This lets Copilot understand the 10xGraph skill even if it does not read all the reference documents.

## What the skill contains

Every skill installation contains a `SKILL.md` entry point and a `references/` directory with 33 topic-specific documents. The structure is identical regardless of which assistant you are installing for.

```text
10xgraph/
+-- SKILL.md
+-- references/
    +-- architecture.md
    +-- agents-and-tools.md
    +-- state-graph.md
    +-- state-and-messages.md
    +-- checkpointing-and-threads.md
    +-- dependency-injection.md
    +-- media-and-files.md
    +-- memory-and-store.md
    +-- streaming.md
    +-- stream-emitter.md
    +-- callbacks-and-command.md
    +-- prebuilt-agents-and-tools.md
    +-- publishers-and-runtime-protocols.md
    +-- context-id-background.md
    +-- providers-and-adapters.md
    +-- security-and-validators.md
    +-- realtime.md
    +-- cli-commands.md
    +-- api-configuration.md
    +-- auth-and-authorization.md
    +-- rate-limiting.md
    +-- api-settings-and-middleware.md
    +-- rest-api-and-errors.md
    +-- id-and-thread-name-generators.md
    +-- production-runtime.md
    +-- api-client.md
    +-- remote-tools.md
    +-- client-auth-and-errors.md
    +-- client-messages-invoke-stream.md
    +-- client-threads-memory-files.md
    +-- unit-testing.md
    +-- evaluation.md
    +-- testing-and-evaluation.md
```

`SKILL.md` serves as the entry point. It tells your coding assistant when to use the 10xGraph skill, which packages and repositories exist, where the public docs live (https://10xgraph.com/), and which reference file to read before changing a subsystem. The SKILL.md uses relative paths, so the same folder works in all installation locations.

The reference files are grouped by domain:

- **Core Python SDK**: Architecture, agents, tools, state graphs, messages, checkpointing, dependency injection, media, memory, streaming, callbacks, prebuilt agents, publishers, context and ID generation, provider internals, security, and realtime audio
- **API and CLI**: Commands, `10xgraph.json` configuration, auth, authorization, rate limiting, settings, middleware, REST routes, error handling, ID generation, and deployment
- **TypeScript client**: REST client, tool execution, auth, messages, invoke, stream, threads, memory, and files
- **Testing and evaluation**: Unit testing without LLM calls, evaluation framework, and testing overview

## Install for all assistants at once

To install the skill for Codex, Claude, and GitHub Copilot in a single command:

```bash
10xgraph skills --all
```

The command installs for every assistant that does not already have the skill installed and skips those that do. `--all` cannot be combined with `--agent`. Pass `--force` to overwrite existing installations:

```bash
10xgraph skills --all --force
```

## Install into a different project

By default, skills are installed in the current working directory. Use `--path` to target a different project:

```bash
10xgraph skills --agent claude --path ./my-other-project
```

The CLI refuses to install at the filesystem root or directly in your home directory. It also refuses when any existing part of the destination (`.claude`, `.agents`, `.github` and the paths under them) is a symlink, or when the resolved destination is outside `--path`, so a repository cannot make the install write files elsewhere. Restart your coding assistant after installing so it loads the new skills directory.

## Update the skill after upgrading the CLI

When you upgrade `10xgraph-api`, the bundled skill is updated but the existing installation in your project is not touched. To update your installed skills to the latest version:

```bash
10xgraph skills --agent claude --force
```

Use `--force` to replace the existing installation. You can update all three assistants at once:

```bash
10xgraph skills --all --force
```

## List supported assistants

To see which coding assistants the CLI supports and where each installs:

```bash
10xgraph skills --list
```

## Validate your own skills

The `--validate` flag checks skills you write yourself (for your own agents) or for a 10xGraph Agent against the [Agent Skills specification](https://agentskills.io/specification):

```bash
10xgraph skills --validate ./.agents/skills
```

Validation is optional for the bundled 10xGraph skill. It is useful when you create your own skills or when you want to ensure a skill meets the spec before sharing it with your team.

## Coding-assistant skills vs Agent Skills

This page describes coding-assistant skills, which teach your IDE or coding assistant how to write 10xGraph code. They are different from Agent Skills, which are a runtime feature that lets your agents load skills on demand.

**Coding-assistant skills** (this page):
- Installed locally in your project (`/.claude/skills/10xgraph/`, `/.agents/skills/10xgraph/`, etc.)
- Read by Codex, Claude Code, GitHub Copilot, and other coding assistants
- Help your assistant generate correct 10xGraph code
- Static documentation bundles

**Agent Skills** (runtime feature):
- Loaded by your agents at runtime when the graph executes
- Follow the same [Agent Skills specification](https://agentskills.io/specification) so they are portable
- Allow your agents to acquire new capabilities dynamically
- Can be bundled, fetched from a server, or generated on the fly

To add skills to your agents, read [How to give an agent Agent Skills](/docs/guides/use-skills). To validate or write your own skills, use the same `10xgraph skills --validate` command.

## Related pages

- [CLI reference](/docs/reference/api-cli/commands): All `10xgraph` commands and flags
- [How to give an agent Agent Skills](/docs/guides/use-skills): Runtime skills for your agents
- [Skills reference](/docs/reference/python/skills): API for building Agent Skills
- [Skills example](/docs/examples/skills): Walkthrough of a working Agent Skills example
