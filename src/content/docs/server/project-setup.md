---
title: Initialize a Project
description: "Scaffold a 10xGraph project with interactive prompts or CLI flags, and understand what each setup generates."
section: "API server"
group: "Basics"
order: 40
label: Initialize a Project
updated: "2026-11-25"
faq:
  - q: "What is the difference between the Quick and Full setups?"
    a: "Quick generates a minimal graph with 10xgraph.json and environment template. Full adds tests, evaluations, auth stubs, and a full project structure, and writes the recommended config: JWT auth with owner-only data, an audit log, and a cache store with rate limiting and token revocation. The cache store is memory with the default memory storage and Redis with Postgres storage or a worker."
  - q: "Can I change the setup or auth choice after scaffolding?"
    a: "Yes, re-run 10xgraph init with --force to regenerate, or edit 10xgraph.json directly. See server/configure for full config reference."
  - q: "When should I choose a memory cache store instead of Redis?"
    a: "A memory cache store works for single instances only. Use Redis when running multiple server replicas or containers that need shared counters, locks and token revocation."
---

`10xgraph init` scaffolds an agent project: a graph, `10xgraph.json`, and for the Full setup tests, evals and a production config.

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

The command asks for the setup (Quick or Full), the agent name and the AI provider. Full also asks where state is stored, how the API is secured, whether to run a background worker, and which extras to add (evals, tests, WebSocket, AG-UI, OpenTelemetry).

To scaffold in a specific directory without entering it:

```bash
10xgraph init --path ./my-agent-project
```

## Non-interactive mode: CLI flags

For CI pipelines or scripted setup, provide all arguments upfront:

```bash
10xgraph init --yes --name MyWeatherBot --mode full --provider openai --storage postgres
```

Passing `--yes` or `--non-interactive` skips all prompts. Any value you omit takes its default (the Quick setup, and for Full the recommended setup). The auth, cache store, rate limit and token revocation flags are only valid with `--mode full`.

### Flags reference

| Flag | Short | Values | Default | Notes |
|---|---|---|---|---|
| `--path` | `-p` | Directory path | `.` | Project root |
| `--name` | | String | Directory name of `--path`, or `MyAgent` for `.` | Agent name and display label |
| `--mode` | | `quick` \| `full` | Prompted, or `quick` with `--yes` / `--non-interactive` | Dev (`quick`) or team/deployment mode. `--template quick-start\|production` is an alias |
| `--provider` | | `google` \| `openai` \| `anthropic` | Prompted | AI provider for the starter agent |
| `--auth` | | `none` \| `jwt` \| `custom` | `jwt` | Requires `--mode full` |
| `--storage` | | `memory` \| `sqlite` \| `postgres` \| `postgres-memory` | `memory` | Requires `--mode full`. Picks the checkpointer (and the store for `postgres-memory`) |
| `--cache-store` | | `memory` \| `redis` | Follows `--storage`: `memory` for `memory` and `sqlite`, `redis` for `postgres` and `postgres-memory`. `redis` when `--worker` is set | Requires `--mode full`. `memory` with a worker is refused |
| `--rate-limit` / `--no-rate-limit` | | Flag | On | Adds or leaves out `cache_store.rate_limit` |
| `--token-revocation` / `--no-token-revocation` | | Flag | On with auth | Adds or leaves out `cache_store.token_revocation`. Ignored with `--auth none` |
| `--websocket` / `--no-websocket` | | Flag | Off | Writes `websocket.enabled` |

Full also takes `--worker`, `--evals/--no-evals`, `--tests/--no-tests`, `--ag-ui/--no-ag-ui` and `--otel/--no-otel`. Every flag is in the [CLI commands reference](/docs/reference/api-cli/commands).

## What init generates

### Quick setup

Minimal setup for rapid prototyping:

```
10xgraph.json
.env.example
.gitignore
AGENTS.md
requirements.txt
graph/
  __init__.py
  agent.py
```

- **10xgraph.json**: Server config with the agent path, env file, auth off, and AG-UI and WebSocket off.
- **graph/agent.py**: A starter ReAct agent built with `ReactAgent`, with a sample weather tool and an `app` variable for the server.
- **.env.example**: API key placeholders. Copy to `.env`, fill in your credentials.
- **requirements.txt**: `10xgraph[<provider extra>]` and `10xgraph-api`, the packages the agent needs. `10xgraph build` installs from it, and add extras such as `jwt` here when you turn a feature on.

Run with:

```bash
pip install -r requirements.txt
cp .env.example .env
# Add your provider API key to .env
10xgraph dev
```

### Full setup

Complete project structure with auth, a cache store, tests, and evaluations:

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
worker/                     # only if --worker is not none
  __init__.py
  tasks.py
tests/                      # unless tests are turned off
  __init__.py
  conftest.py
  test_graph_nodes.py
  test_catalog_tools.py
  test_agent_eval.py
evals/                      # unless evals are turned off
  __init__.py
  weather_agents_eval.py
  user_simulator_eval.py
```

## How 10xgraph.json is generated

Init builds your config from your answers, not a static template. Examples:

**Quick (minimal):**

```json
{
  "agent": "graph.agent:app",
  "env": ".env",
  "auth": null,
  "thread_name_generator": null,
  "ag_ui": {"enabled": false},
  "websocket": {"enabled": false}
}
```

**Full (the default for `--mode full`, which means `--storage memory`, so the cache store is `memory`; `--storage postgres`, `--storage postgres-memory` or `--worker` write `redis`):**

```json
{
  "agent": "graph.agent:app",
  "env": ".env",
  "auth": {"method": "jwt"},
  "thread_name_generator": "first_message",
  "ag_ui": {"enabled": false, "allow_client_tools": false},
  "websocket": {"enabled": false},
  "remote_tools": [],
  "injectq": "graph.agent:container",
  "cache_store": {
    "type": "memory",
    "rate_limit": {
      "enabled": true,
      "requests": 100,
      "window": 60,
      "by": "user",
      "trusted_proxy_headers": false,
      "fail_open": false,
      "exclude_paths": ["/ping", "/docs", "/redocs", "/openapi.json"]
    },
    "token_revocation": true
  },
  "audit": {"enabled": true, "sinks": ["log"], "include_reads": true},
  "test": {"path": "tests", "coverage": true, "coverage_threshold": 70},
  "evaluation": {
    "directory": "evals",
    "output_dir": "eval_reports",
    "threshold": 0.75,
    "parallel": false,
    "max_concurrency": 4,
    "timestamp_files": true
  }
}
```

With `"type": "redis"` the cache store has no `url`, so Redis comes from the `REDIS_URL` environment variable. A `worker` block is added when you choose a background worker, and `"store": "graph.agent:store"` when you choose Postgres memory storage. The `test` and `evaluation` blocks are left out when tests or evals are turned off.

**Full with `--auth none`:** the same file with `"auth": null` and no token revocation. Rate limiting is then counted `by` `ip`.

**Thread names.** Full writes `"thread_name_generator": "first_message"`. Quick leaves it `null`, which means none: threads are saved without a name. The other choices are `random`, or a `module:attr` path to your own `ThreadNameGenerator` subclass. See [Generate readable thread names](/docs/server/configure#generate-readable-thread-names).

See [What is on by default](/docs/server/configure#what-is-on-by-default).

## Overwrite and force flags

**To regenerate a project's files:**

```bash
10xgraph init --force
```

This re-runs init in your current directory and overwrites all template files (graph code, tests, validators, auth stub) and `10xgraph.json`. **Use with care.** Without `--force`, init asks before overwriting at a terminal (default No) and stops without a terminal.

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

### 3. (Full only) Set up Git hooks

```bash
pre-commit install
```

Lints your code automatically on each commit.

### 4. Start the server

```bash
10xgraph dev
```

Starts the API on `localhost:8000` and opens the web playground.

## Troubleshooting

**"ModuleNotFoundError: No module named 'graph'"** after init

The graph module didn't load when the server started. Check:

- Is `graph/agent.py` present and syntactically valid?
- Does `graph/agent.py` define an `app` variable that is a compiled `StateGraph`?
- Are all imports in `graph/agent.py` installed? (e.g., `pip install "10xgraph[google-genai]"`)
- Run `python -c "from graph.agent import app; print(app)"` to get a detailed error.

**"Invalid mode" or "Invalid auth mode"**

You passed an unrecognized value to `--mode`, `--auth`, or `--cache-store`. Valid values:

- `--mode`: `quick`, `full` (the alias `--template` takes `quick-start`, `production`)
- `--auth`: `none`, `jwt`, `custom`
- `--cache-store`: `memory`, `redis`

Auth, cache store, rate-limit and token-revocation flags only work with `--mode full`.

**Agent name contains special characters**

Init slugifies your agent name (e.g. `My Agent 2024` becomes `my-agent-2024`). Use alphanumerics, hyphens, and spaces; other characters may be stripped or cause module import errors.

## Related pages

- [Configure](/docs/server/configure): Full reference for every 10xgraph.json key and environment variable.
- [Run the server](/docs/server/run-the-server): Starting the API server in development and production.
- [Authentication](/docs/server/auth): Authentication and authorization setup.
