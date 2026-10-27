---
title: CLI Overview
seoTitle: "10xGraph CLI commands reference"
description: "Quick reference for 10xGraph CLI commands: scaffold, serve, test, and deploy agents."
section: "API server"
group: "Basics"
order: 50
label: CLI
updated: "2026-10-27"
---

The `10xgraph` command-line interface (`10xgraph-api` package) is your complete toolkit for building and operating 10xGraph agents in production. From initial scaffolding through deployment and evaluation, each command handles a specific phase of agent development.

## Install the CLI

```bash
pip install 10xgraph-api
```

Verify the installation:

```bash
10xgraph --help
```

The CLI requires Python 3.12+. It depends on the core framework (`10xgraph`), which is installed automatically.

## What each command does

| Command | Purpose |
| --- | --- |
| [`10xgraph init`](/docs/server/project-setup) | Scaffold a new agent project interactively |
| [`10xgraph dev`](/docs/server/run-the-server) | Start the development server with reload and open the [playground](/docs/server/playground) (`--no-open` to skip) |
| [`10xgraph build`](/docs/server/deploy) | Generate Docker files for containerization |
| [`10xgraph skills`](/docs/integrations/coding-assistants) | Install coding-agent skills (Claude, Codex, GitHub) |
| [`10xgraph test`](/docs/testing/run-tests) | Run the project test suite (pytest wrapper) |
| [`10xgraph eval`](/docs/testing/run-evals) | Run agent evaluations and generate reports |
| `10xgraph audit` | Verify environment and project compatibility |
| `10xgraph config` | Edit `10xgraph.json` in a browser UI |
| `10xgraph demo` | Preview CLI animations |
| `10xgraph version` | Show CLI and core framework versions |

Each command accepts `--help` to show its full options. Detailed flags and parameters are documented in the [CLI commands reference](/docs/reference/api-cli/commands).

## Development workflow

### Create a new project

Start with `10xgraph init` to scaffold your agent project. The command prompts for setup type (Quick Start or Production), and for production projects also prompts for authentication and rate-limiting configuration.

```bash
10xgraph init
```

The scaffold generates a `10xgraph.json` configuration file, graph code, and optional evals and tests. Every prompt has a matching flag, so the same scaffold can be reproduced in CI or by coding agents without interaction:

```bash
10xgraph init --name MyAgent --template production --auth jwt --yes --non-interactive
```

See [Initialize a project](/docs/server/project-setup) for the full guide.

### Run locally during development

`10xgraph dev` is the usual choice while building your agent. It starts the server on `127.0.0.1:8000`, enables auto-reload on file changes, and opens the hosted playground in your browser once the API responds.

```bash
10xgraph dev
```

Change any of these with flags:

```bash
10xgraph dev --no-open --port 9000 --no-reload
```

`10xgraph dev` is the only server command. It reloads on file changes by default and opens the playground unless you pass `--no-open`. Production runs Gunicorn in the image that `10xgraph build` generates.

### Test and evaluate

After building a graph, run your test suite with `10xgraph test`. It wraps pytest and reads optional defaults from `10xgraph.json`:

```bash
10xgraph test                          # Run all tests
10xgraph test --coverage               # Report code coverage
10xgraph test -k "test_routing"        # Run tests matching a pattern
```

Evaluate your agent's behavior with `10xgraph eval`. The command discovers eval files, runs all cases, and generates HTML and JSON reports to `eval_reports/`:

```bash
10xgraph eval                          # Run all evals
10xgraph eval --parallel               # Run cases concurrently
10xgraph eval --threshold 0.9 --open   # Fail if pass rate below 90%, open report
```

See [Run tests](/docs/testing/run-tests) and [Run evaluations](/docs/testing/run-evals) for detailed guides.

## Deployment and operations

### Containerize for production

`10xgraph build` generates a Dockerfile that runs your agent on Gunicorn with Uvicorn workers (`WEB_CONCURRENCY` sets the worker count). Optionally generate docker-compose.yml for local multi-service deployments or k8s.yaml for Kubernetes:

```bash
10xgraph build                         # Generate Dockerfile
10xgraph build --docker-compose        # Also generate docker-compose.yml
10xgraph build --k8s                   # Also generate k8s.yaml (Deployment + Service)
10xgraph build --python-version 3.12   # Specify Python version (default: 3.13)
```

See [Deployment guide](/docs/server/deploy) for more.

### Configure the server

`10xgraph config` opens a browser-based editor for `10xgraph.json`. It validates every field using the same parser the server uses, preserves unknown keys, and keeps secrets in your `.env` file:

```bash
10xgraph config                        # Edit ./10xgraph.json (created on first save)
10xgraph config --port 8765 --no-open  # Use a custom port, don't open browser
```

The editor is loopback-only for security. See [Configure the server](/docs/server/configure) for the full configuration schema.

### Verify the environment

Before deploying, use `10xgraph audit` to run a read-only check: the Python interpreter, installed packages, evaluation API compatibility, `10xgraph.json` syntax and agent key, remote-tool definitions, and whether port 8000 is free. The check exits with code 1 on failure (helping with CI gates) and 0 on warnings only:

```bash
10xgraph audit                         # Run all checks
10xgraph audit --config production.json
10xgraph --format json audit           # Machine-readable output for CI
```

## Additional commands

### Install coding-agent skills

`10xgraph skills` installs bundled skills for Codex, Claude Code, and GitHub. Install skills interactively or by agent name:

```bash
10xgraph skills                        # Interactive menu
10xgraph skills --agent claude         # Install Claude skill
10xgraph skills --all                  # Install for all agents
10xgraph skills --validate ./skills    # Check skills against the spec
```

The command refuses to install when any existing part of the destination (`.claude`, `.agents`, `.github` and the paths under them) is a symlink, or when the resolved destination is outside `--path`. A repository can ship `.claude` as a symlink to another directory, and installing through it would write files elsewhere. Replace the link with a real directory, or pass a different `--path`.

See [Integrate with coding assistants](/docs/integrations/coding-assistants).

### Show version information

`10xgraph version` prints the CLI and core framework versions. Both are resolved from installed package metadata (not from files):

```bash
10xgraph version
```

Output example:

```
10xgraph-api
  Version: 0.7.0
10xgraph (core)
  Version: 0.10.0
```

### Preview animations

`10xgraph demo` previews CLI animations without changing your project:

```bash
10xgraph demo --style eval
```

Styles: `typing`, `network`, `init`, `build`, `eval`, or `all` (default).

## Global options

Root flags apply to every command and go before the command name:

```bash
10xgraph --format json audit           # Output as JSON
10xgraph --no-color dev                # Disable color
10xgraph --cwd ../other-agent eval     # Run in a different directory
10xgraph --yes init --non-interactive   # Accept defaults, fail instead of prompting
```

| Flag | Purpose |
| --- | --- |
| `--format {human,plain,json,jsonl}` | Output format (default: human) |
| `--json` | Shorthand for `--format json` |
| `--color {auto,always,never}` | Color output (default: auto) |
| `--no-color` | Disable color |
| `--progress {auto,tty,plain,json,quiet}` | Progress rendering mode |
| `--animation / --no-animation` | Enable or disable decorative animation |
| `--fullscreen / --no-fullscreen` | Use full-screen UI (default: off) |
| `--cwd DIR` | Run as if started in DIR |
| `--verbose / -v` | Detailed logging (can repeat for more) |
| `--quiet / -q` | Errors only |
| `--debug` | Enable debug diagnostics |
| `--yes / -y` | Accept recommended defaults |
| `--non-interactive` | Never prompt; fail instead |
| `--version / -V` | Show version and exit |

Flags specific to a command (like `--coverage` for `test`) are documented in that command's help:

```bash
10xgraph eval --help
```

See the [CLI commands reference](/docs/reference/api-cli/commands) for the complete flag table with defaults and descriptions.
