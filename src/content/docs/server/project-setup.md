---
title: Initialize a Project
description: "Scaffold a 10xGraph project with interactive prompts or CLI flags, and understand what each template generates."
section: "API server"
group: "Basics"
order: 40
label: Initialize a Project
updated: "2026-10-27"
faq:
  - q: "What is the difference between Quick Start and Production templates?"
    a: "Quick Start generates a minimal graph with 10xgraph.json and environment template. Production adds tests, evaluations, auth stubs, rate limiting, and a full project structure for team deployment."
  - q: "Can I change the template or auth choice after scaffolding?"
    a: "Yes, re-run 10xgraph init with --force to regenerate, or edit 10xgraph.json directly. See server/configure for full config reference."
  - q: "When should I choose Redis rate limiting instead of Memory?"
    a: "Memory-based rate limiting works for single instances only. Use Redis when running multiple server replicas or containers that need shared counters."
---

`10xgraph init` scaffolds a new agent project from an interactive questionnaire or command-line flags. It creates a working graph, configuration file, and optional test/evaluation stubs tailored to your deployment model (Quick Start for development, Production for teams and deployment).

## Prerequisites

Install the 10xgraph CLI package:

```bash
pip install 10xgraph-api
```

## Quickstart: interactive mode

Navigate to an empty directory and run:

```bash
10xgraph init
```

The command asks for the agent name and template, and for the Production template also the authentication and rate limiting options (listed below). It then prints a summary and creates the files.

To scaffold in a specific directory without entering it:

```bash
10xgraph init --path ./my-agent-project
```

## Non-interactive mode: CLI flags

For CI pipelines or scripted setup, provide all arguments upfront:

```bash
10xgraph init --name MyWeatherBot --template production --auth jwt --rate-limit redis
```

Passing `--yes` or `--non-interactive` skips all prompts. Any value you omit takes its default (`quick-start` template, auth `none`, rate limiting `none`). Auth and rate-limiting options are only valid with `--template production`.

### Flags reference

| Flag | Short | Values | Default | Notes |
|---|---|---|---|---|
| `--path` | `-p` | Directory path | `.` | Project root |
| `--name` | | String | Directory name of `--path`, or `MyAgent` for `.` | Agent name and display label |
| `--template` | | `quick-start` \| `production` | Prompted, or `quick-start` with `--yes` / `--non-interactive` | Dev (`quick-start`) or team/deployment mode |
| `--auth` | | `none` \| `jwt` \| `custom` | Prompted, or `none` | Requires `--template production` |
| `--rate-limit` | | `none` \| `memory` \| `redis` | Prompted, or `none` | Requires `--template production`. The interactive prompt appears only when auth is not `none` |
| `--force` | `-f` | Flag | Off | Overwrite existing files (careful: replaces graph code) |
| `--dry-run` | | Flag | Off | Print files that would be created; do not write anything |
| `--yes` | `-y` | Flag | Off | Accept the recommended defaults and do not prompt |
| `--non-interactive` | | Flag | Off | Never prompt; invalid values fail instead of being asked for |

Example with `--dry-run`:

```bash
10xgraph init --name MyBot --template production --dry-run
```

This lists files that would be created without touching your filesystem.

## What init generates

### Quick Start template

Minimal setup for rapid prototyping:

```
10xgraph.json
.env.example
graph/
  __init__.py
  agent.py
```

- **10xgraph.json**: Server config with just the agent path and env file.
- **graph/agent.py**: A starter ReAct agent built with `ReactAgent`, with a sample weather tool and an `app` variable for the server.
- **.env.example**: API key placeholders. Copy to `.env`, fill in your credentials.

Run with:

```bash
cp .env.example .env
# Add your provider API key to .env
10xgraph dev
```

### Production template

Complete project structure with auth, rate limiting, tests, and evaluations:

```
.pre-commit-config.yaml
.env.example
.python-version
10xgraph.json
pyproject.toml
graph/
  __init__.py
  agent.py
  state.py
  thread_name_generator.py
  tools/
    __init__.py
    weather_tool.py (example tool)
  validators/
    __init__.py
    lifecyle.py
    manager.py
    validators.py
auth/                       # only if --auth custom
  __init__.py
  agent_auth.py
tests/
  __init__.py
  conftest.py
  test_graph_nodes.py
  test_catalog_tools.py
  test_agent_eval.py
evals/
  __init__.py
  weather_agents_eval.py
  user_simulator_eval.py
```

**Why each part matters:**

- **pyproject.toml**: Declares your project as a package. Enables `pip install -e .` (editable), integrates `ruff`/`mypy`/`pytest` config, and ensures repeatable environments.
- **graph/state.py**: Custom state schema (inherits from `AgentState`). Extend it as your agent's state grows.
- **graph/thread_name_generator.py**: Generates human-readable thread names (e.g. "Thoughtful Salamander") instead of UUIDs.
- **graph/tools/**: Custom agent tools as decorated functions.
- **graph/validators/**: Lifecycle validators (before invoke, after step, on error) and validation manager.
- **auth/agent_auth.py**: Custom authentication logic (only scaffolded when `--auth custom`). Implement `BaseAuth` subclass.
- **tests/**: Unit tests (mock the model, test state transitions, tool logic).
- **.env.example**: Conditional blocks for JWT and Redis; only kept in `.env` if you selected those options.
- **.pre-commit-config.yaml**: Git hooks for `ruff check/format`, `bandit`, `mypy`.

## How 10xgraph.json is generated

Init builds your config from your answers, not a static template. Examples:

**Quick Start (minimal):**

```json
{
  "agent": "graph.agent:app",
  "env": ".env",
  "auth": null,
  "thread_name_generator": null,
  "ag_ui": {"enabled": false}
}
```

**Production with no auth:**

```json
{
  "agent": "graph.agent:app",
  "env": ".env",
  "auth": null,
  "thread_name_generator": "graph.thread_name_generator:MyNameGenerator",
  "injectq": "graph.agent:container",
  "authorization": null,
  "ag_ui": {"enabled": false}
}
```

**Production with JWT and Redis rate limiting:**

```json
{
  "agent": "graph.agent:app",
  "env": ".env",
  "auth": "jwt",
  "authorization": "ownership",
  "thread_name_generator": "graph.thread_name_generator:MyNameGenerator",
  "injectq": "graph.agent:container",
  "redis": "${REDIS_URL}",
  "token_revocation": true,
  "rate_limit": {
    "enabled": true,
    "requests": 100,
    "window": 60,
    "by": "ip",
    "trusted_proxy_headers": false,
    "exclude_paths": ["/ping", "/docs", "/redocs", "/openapi.json"]
  },
  "ag_ui": {"enabled": false}
}
```

For full details on every config key, see `/docs/server/configure`.

## Overwrite and force flags

**To regenerate a project's files:**

```bash
10xgraph init --force
```

This re-runs init in your current directory and overwrites all template files (graph code, tests, validators, auth stub) and `10xgraph.json`. **Use with care.** Without `--force`, init stops with a "File already exists" error at the first file that is already there.

**To preview without writing:**

```bash
10xgraph init --name MyBot --template production --dry-run
```

Lists files that would be created and exits without modifying the filesystem.

## Interactive vs. non-interactive prompts

### Interactive (default)

```bash
10xgraph init
```

Asks:
1. **Agent name?** (default: `MyAgent`)
2. **Quick Start or Production?** (default: Quick Start)
3. **[Production only] Authentication type?** (default: `none`)
   - Offers: None, JWT, Custom
4. **[Production only, if auth != none] Rate limiting?** (default: `none`)
   - Offers: None, Memory Based, Redis Based
5. **[If rate limiting selected] Max requests per window?** (default: `100`)
6. **[If rate limiting selected] Window size (seconds)?** (default: `60`)
7. **[If rate limiting selected] Count requests per?** (default: Per IP)
   - Offers: Per IP, Global
8. **[If rate limiting selected] Behind a reverse proxy?** (default: `No`)

### Non-interactive with defaults

```bash
10xgraph init --yes
```

Uses all defaults: agent name inferred from directory, Quick Start template, no auth, no rate limiting.

### Non-interactive with explicit arguments

```bash
10xgraph init --name WeatherBot --template production --auth jwt --rate-limit memory
```

Does not prompt; an invalid value fails with an error.

## After init: next steps

### 1. Set up your environment

```bash
cp .env.example .env
# Edit .env and add your provider API key(s)
# If using JWT auth, add JWT_SECRET_KEY (32+ characters) and JWT_ALGORITHM
# If using Redis rate limiting, add REDIS_URL
```

### 2. Install coding-assistant skills (optional but recommended)

```bash
10xgraph skills
```

Installs the bundled 10xGraph skills for Codex, Claude Code or GitHub Copilot (pick one with `--agent` or use `--all`), so your coding assistant knows the framework.

### 3. (Production only) Set up Git hooks

```bash
pre-commit install
```

Lints your code automatically on each commit.

### 4. Test that the graph loads

```bash
python -c "from graph.agent import app; print(app)"
```

If this fails, check that `graph/agent.py` is syntactically correct and imports are available.

### 5. Start the server

```bash
10xgraph dev
```

Starts the API on `localhost:8000` and opens the web playground.

## Troubleshooting

**"ModuleNotFoundError: No module named 'tenxgraph_api'"**

Install the API package:

```bash
pip install 10xgraph-api
```

**"File already exists" error during init**

A file is in the way. Either:

- Move it aside: `mv <filename> <filename>.bak`
- Pass `--force`: `10xgraph init --force` (overwrites all template files)
- Use `--path` to target a different directory: `10xgraph init --path ./new-dir`

**"ModuleNotFoundError: No module named 'graph'"** after init

The graph module didn't load when the server started. Check:

- Is `graph/agent.py` present and syntactically valid?
- Does `graph/agent.py` define an `app` variable that is a compiled `StateGraph`?
- Are all imports in `graph/agent.py` installed? (e.g., `pip install "10xgraph[google-genai]"`)
- Run `python -c "from graph.agent import app; print(app)"` to get a detailed error.

**"Invalid template" or "Invalid auth mode"**

You passed an unrecognized value to `--template`, `--auth`, or `--rate-limit`. Valid values:

- `--template`: `quick-start`, `production`
- `--auth`: `none`, `jwt`, `custom`
- `--rate-limit`: `none`, `memory`, `redis`

Auth and rate-limit flags only work with `--template production`.

**Agent name contains special characters**

Init slugifies your agent name (e.g. `My Agent 2024` becomes `my-agent-2024`). Use alphanumerics, hyphens, and spaces; other characters may be stripped or cause module import errors.

## Related pages

- `/docs/server/configure`: Full reference for every 10xgraph.json key and environment variable.
- `/docs/server/run-the-server`: Starting the API server in development and production.
- `/docs/server/auth`: Authentication and authorization setup.
