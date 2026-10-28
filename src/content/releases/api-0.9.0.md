---
package: api
version: "0.9.0"
date: 2026-10-22
summary: 10xgraph dev is now the only server command; 10xgraph api and 10xgraph play are removed. Adds a guided init, leaner production images and Python 3.14 and 3.15 support.
breaking: true
---

One server command, a guided `10xgraph init`, leaner production images and Python 3.14 and 3.15 support. This release has a breaking change: read the **Breaking** list before upgrading.

### Breaking

- **`10xgraph api` and `10xgraph play` are removed; `10xgraph dev` is the only server command.** All three ran the same local Uvicorn dev server. **Migration:** `10xgraph api` becomes `10xgraph dev --no-open`, and `10xgraph play` becomes `10xgraph dev`. Options are unchanged (`--config`, `--host`, `--port`, `--reload/--no-reload`). `10xgraph demo --style` no longer accepts the `play` and `api` aliases. Production is unaffected: the image from `10xgraph build` runs Gunicorn directly.

### Added

- **Python 3.14 and 3.15 are officially supported.** The test suite runs on 3.12, 3.13, 3.14 and 3.15 in CI.
- **`websocket.enabled` in `10xgraph.json`** turns the WebSocket routes on or off. `false` leaves out `/v1/graph/ws` and `/v1/graph/live`, so the server needs no WebSocket library. `true` without one refuses to boot with the install hint. Unset keeps them mounted, as before, but now logs a warning when no library is installed. Previously a non-Google project silently answered 404 on both routes.
- **`10xgraph-api[websocket]` extra** (`websockets`) for those routes.
- **`10xgraph init` asks whether to enable WebSocket streaming and realtime audio** (`--websocket/--no-websocket`, default off).
- **`10xgraph init` asks for the AI provider** (Google Gemini, OpenAI or Anthropic Claude; `--provider` for non-interactive runs, default `google`). The scaffold's model, provider, `.env.example` API key, test conftest and eval simulator model follow the answer.
- **`10xgraph-api[images]` extra.** Pillow is optional in core `10xgraph`; this extra installs it for image resize, EXIF orientation and format conversion.

### Changed

- **Production scaffolds list only the dependencies the answers need.** `pyproject.toml` depends on `10xgraph[<provider>]` and `10xgraph-api[jwt,redis]` as chosen, and drops the hardcoded `google-genai`. The generated Dockerfile installs this list, so JWT and Redis work in the image without a separate `requirements.txt`.
- **The generated Dockerfile removes pip and the CLI's own libraries from the image** (typer, rich, questionary and what only they pull in), unless another installed package still needs them. With pip, the image is about 38 MB smaller.
- Replaced `asyncio.iscoroutinefunction`, which is removed in Python 3.16, with `inspect.iscoroutinefunction`. No behaviour change.

### Fixed

- **`10xgraph init` generated a `pyproject.toml` claiming Python 3.10.** It now says `requires-python = ">=3.12"`, which `10xgraph` needs.
- **Redis rate limiting from a URL crashed at startup** with `NameError: Redis`.
- **A production scaffold with the Redis rate limiter did not start**, because `10xgraph.json` had no Redis URL. It now reads `"redis": {"url": "${REDIS_URL}"}` from `.env`.
- **A production scaffold did not start at all**, because `10xgraph.json` pointed at `graph.agent:container`, which the template never defined. `graph/agent.py` now exports it.
- **The production scaffold's `tests/test_graph_nodes.py` failed on collection.** It now tests the agent in `graph/agent.py`.
