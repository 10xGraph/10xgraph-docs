---
title: Run the API Server
seoTitle: "Run the 10xGraph API server"
description: "Start the 10xGraph development server with 10xgraph dev, and run it in production with the Gunicorn image from 10xgraph build."
section: "API server"
group: "Basics"
order: 20
label: Run the API Server
updated: "2026-11-25"
faq:
  - question: "Can I use 10xgraph dev in production?"
    answer: "No. The 10xgraph dev command runs a single-worker development server with reload. There is no separate production command. For production, use Docker with Gunicorn and multiple Uvicorn workers. Generate production files with 10xgraph build --docker-compose."
  - question: "How do I check if the server is running?"
    answer: 'Call the /ping endpoint via curl. It returns `{"data": "pong", "metadata": {...}}` and needs no authentication.'
  - question: "Why does my server restart when I save a file?"
    answer: "Auto-reload is enabled by default in development. Files are watched and the server reloads when any Python file changes. Disable it with --no-reload."
---

`10xgraph dev` runs the same API server that production runs, locally, with reload on. This page covers running it for development and in production.

For a production setup see the [production checklist](/docs/server/production-checklist); stopping the server without losing runs is covered in [Graceful shutdown](/docs/guides/graceful-shutdown).

## Prerequisites

Verify that your project has a valid `10xgraph.json` config file and a graph module that can be imported:

```bash
# Check the config file
cat 10xgraph.json

# Verify the graph module exists and is importable
python -c "from graph.react import app; print(app)"
```

Both commands must succeed without errors. If they fail, see [Configure the server](/docs/server/configure) for the config format and [Project setup](/docs/server/project-setup) to scaffold a new project.

## Development: start the server

From the folder containing `10xgraph.json`, run the server with auto-reload enabled:

```bash
10xgraph dev --no-open
```

The server binds to `http://127.0.0.1:8000` and restarts whenever you edit any Python file. This is the fastest way to iterate on your graph locally. Auto-reload is the default; to disable it, pass `--no-reload`.

`10xgraph dev` opens the hosted playground in your browser once the API responds. Pass `--no-open` to start the server only, as above. To open the playground, leave the flag out:

```bash
10xgraph dev
```

Flags: `--config`/`-c`, `--host`/`-H`, `--port`/`-p`, `--reload/--no-reload`, `--open/--no-open`, `--verbose`/`-v` and `--quiet`/`-q`.

### Run `10xgraph dev` against Docker backends

When Postgres, Redis or Qdrant run in Docker Compose and `10xgraph dev` runs on your host, the host reaches them through published ports. Publish each port on `127.0.0.1` only, so nothing else on your network can connect:

```yaml
services:
  postgres:
    image: postgres:17-alpine
    ports:
      - "127.0.0.1:5432:5432"
  redis:
    image: redis:7-alpine
    ports:
      - "127.0.0.1:6379:6379"
  qdrant:
    image: qdrant/qdrant:latest
    ports:
      - "127.0.0.1:6333:6333"
      - "127.0.0.1:6334:6334"
```

In `.env`, use `localhost` as the host, not the compose service names. `postgres`, `redis` and `qdrant` resolve only inside the Docker network, that is, for a container of the same compose project:

```bash
# On the host (10xgraph dev)
DATABASE_URL=postgresql://<user>:<password>@localhost:5432/<database>
REDIS_URL=redis://:<password>@localhost:6379/0
QDRANT_URL=http://localhost:6333

# Inside a container on the compose network
# DATABASE_URL=postgresql://<user>:<password>@postgres:5432/<database>
```

If the URLs still use a service name, the [startup check](/docs/server/production-checklist#startup-check) fails at boot and names the unreachable `host:port`. See [Backend unreachable at startup](/docs/troubleshooting/api-server#issue-backend-unreachable-at-startup).

## Verify the server is running

Open another terminal and ping the server to confirm it is reachable:

```bash
curl http://127.0.0.1:8000/ping
```

Expected response:

```json
{"data": "pong", "metadata": {"request_id": "...", "timestamp": "...", "message": "OK"}}
```

The `/ping` endpoint requires no authentication and is designed for health checks (load balancers, monitoring systems).

## Explore the API with interactive docs

When running locally, the server exposes interactive API documentation that lets you test endpoints without writing code. Open either of these in your browser:

- **Swagger UI** (recommended): `http://127.0.0.1:8000/docs`
- **ReDoc** (alternative): `http://127.0.0.1:8000/redocs`

Both show the full endpoint list, parameters, request/response shapes, and authentication requirements. You can click "Try it out" on any endpoint to test it directly.

### Example: invoke the graph

1. Open `http://127.0.0.1:8000/docs`
2. Find the `POST /v1/graph/invoke` endpoint and expand it
3. Click "Try it out"
4. In the request body, enter sample input:

```json
{
  "messages": [{"role": "user", "content": [{"type": "text", "text": "Hello"}]}]
}
```

Leave `config` out. The server starts a new thread and returns its id in `data.thread_id`. By default it refuses a `thread_id` that does not exist yet.

5. Click "Execute"

## Development options and flags

### Bind to a different host or port

By default, the server binds to `127.0.0.1:8000`. To accept connections from other machines (e.g., in Docker or on a network), bind to `0.0.0.0`:

```bash
10xgraph dev --no-open --host 0.0.0.0 --port 8000
```

To use a different port:

```bash
10xgraph dev --no-open --port 8001
```

### Logging verbosity

`--verbose` and `--quiet` change the CLI's own output. The server's log level comes from `LOG_LEVEL`, and `LOG_FORMAT=json` writes JSON lines; see [Observability](/docs/server/observability#logs).

## Disable API documentation

The interactive docs (`/docs` and `/redocs`) expose your endpoint structure. If you want to hide them (often a production concern), set the env vars before starting:

```bash
export DOCS_PATH=""
export REDOCS_PATH=""
10xgraph dev --no-open --no-reload
```

When `MODE=production`, these paths default to empty unless explicitly set. In other modes, they are enabled by default.

`10xgraph dev` is a single-worker development server. Production runs Gunicorn with Uvicorn workers in the image that `10xgraph build` generates; see [Deploy](/docs/server/deploy).

## Troubleshooting

### Port already in use

If `Address already in use` appears, either choose a different port or kill the process holding the current port:

```bash
# Use a different port
10xgraph dev --no-open --port 8001

# Or find and kill the process on port 8000
lsof -ti :8000 | xargs kill -9
```

### Graph import fails: "ModuleNotFoundError"

The server cannot import your graph module. Check:

1. Verify the import path in `10xgraph.json` is correct (format: `"module:attribute"`)
2. Verify the module is installed or on the Python path
3. Test manually: `python -c "from graph.react import app"`

If still failing, check that the project root is in `sys.path` and that all dependencies are installed.

### "Connection refused" or cannot reach the server

Confirm that:

1. The server is running (check the terminal where you started it)
2. The host and port are correct (default: `http://127.0.0.1:8000`)
3. In Docker or on a VM, networking is properly configured (ensure `--host 0.0.0.0` and the port is exposed)

Test with: `curl http://127.0.0.1:8000/ping`

If the server itself exits at boot with `Refusing to start: ... backend(s) unreachable`, a configured Postgres, store or cache store (Redis) is down or its URL is wrong. See [Backend unreachable at startup](/docs/troubleshooting/api-server#issue-backend-unreachable-at-startup).

## Next steps

- **Configure the server:** See [Configure the server](/docs/server/configure) for auth, checkpointing, rate limiting, and per-environment settings.
- **Deploy to production:** See [Deploy the server](/docs/server/deploy) for Docker, Kubernetes, and production hardening.
- **Monitor and debug:** See [Observability](/docs/server/observability) for logs, metrics, tracing, and error handling.
- **Call the server from code:** See [Invoke and stream](/docs/server/invoke-and-stream) for REST endpoint details, and [TypeScript client](/docs/client/create-client) for client library usage.
