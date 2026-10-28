---
title: Run the API Server
seoTitle: "Run the 10xGraph API server"
description: "Start the 10xGraph development server with 10xgraph dev, and run it in production with the Gunicorn image from 10xgraph build."
section: "API server"
group: "Basics"
order: 20
label: Run the API Server
updated: "2026-10-27"
faq:
  - question: "Can I use 10xgraph dev in production?"
    answer: "No. The 10xgraph dev command runs a single-worker development server with reload. There is no separate production command. For production, use Docker with Gunicorn and multiple Uvicorn workers. Generate production files with 10xgraph build --docker-compose."
  - question: "How do I check if the server is running?"
    answer: "Call the /ping endpoint via curl. It returns a JSON object with success true and data pong, and requires no authentication."
  - question: "Why does my server restart when I save a file?"
    answer: "Auto-reload is enabled by default in development. Files are watched and the server reloads when any Python file changes. Disable it with --no-reload."
---

The `10xgraph dev` command starts a FastAPI-based development HTTP server that loads your graph and exposes it over REST and WebSocket. This guide covers running the server for development and production, configuring it, and troubleshooting deployment issues.

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

Flags: `--config`/`-c`, `--host`/`-H`, `--port`/`-p`, `--reload/--no-reload`, `--open/--no-open`, `--verbose`/`-v` and `--quiet`/`-q`. The commands `10xgraph api` and `10xgraph play` were removed in `10xgraph-api` 0.9.0; use `10xgraph dev`.

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

Leave `config` out. The server starts a new thread and returns its id in `data.meta.thread_id`. By default it refuses a `thread_id` that does not exist yet.

5. Click "Execute"

You will see the full response, including the graph's output, any tool calls, and messages. This is the best way to understand your API's behavior.

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

### Environment variables and config file

Your graph may require environment variables (API keys, database URLs, Redis, etc.). Load them from a `.env` file by specifying the path in `10xgraph.json`:

```json
{
  "agent": "graph.react:app",
  "env": ".env"
}
```

Or pass them directly to the shell:

```bash
export GOOGLE_API_KEY=your_key
export REDIS_URL=redis://localhost:6379
10xgraph dev --no-open
```

To use a non-default config file:

```bash
10xgraph dev --no-open --config config/staging.json
```

This is useful when you have separate configs for dev, staging, and production.

### Logging verbosity

Enable verbose output for debugging (shows request details, node execution times, checkpointer operations):

```bash
10xgraph dev --no-open --verbose
```

Or suppress all output except errors:

```bash
10xgraph dev --no-open --quiet
```

## Disable API documentation

The interactive docs (`/docs` and `/redocs`) expose your endpoint structure. If you want to hide them (often a production concern), set the env vars before starting:

```bash
export DOCS_PATH=""
export REDOCS_PATH=""
10xgraph dev --no-open --no-reload
```

When `MODE=production`, these paths default to empty unless explicitly set. In other modes, they are enabled by default.

## Production: deploy with Docker and workers

The `10xgraph dev` command runs a **development server only** (single Uvicorn worker with file watching). It is not suitable for production traffic. Production runs Gunicorn with Uvicorn workers inside the image that `10xgraph build` generates.

For production, generate a Docker setup with multiple workers and production configuration:

```bash
10xgraph build --docker-compose
```

This creates:

- `Dockerfile` with production layers and multi-worker setup
- `docker-compose.yml` (with `--docker-compose`) for easy local testing of the built image
- `k8s.yaml` (with `--k8s`) for Kubernetes deployment

The generated Dockerfile runs the app via Gunicorn with Uvicorn workers. The worker count comes from `WEB_CONCURRENCY` (the Dockerfile sets it to 2; override it at run time) and the graceful shutdown timeout is raised so in-flight runs can finish.

To build and test locally:

```bash
docker build -t my-agent:latest .
docker run -p 8000:8000 my-agent:latest
```

Set required environment variables:

```bash
docker run -e JWT_SECRET_KEY=your_secret -e WEB_CONCURRENCY=4 -p 8000:8000 my-agent:latest
```

See [Deploy the server](/docs/server/deploy) for the complete production guide, Kubernetes setup, and deployment checklist.

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

### Environment variable is not set

If you see an error like `"GOOGLE_API_KEY" not set`, either export it before starting:

```bash
export GOOGLE_API_KEY=your_value
10xgraph dev --no-open
```

Or add it to a `.env` file and configure `10xgraph.json`:

```json
{
  "agent": "graph.react:app",
  "env": ".env"
}
```

Ensure `.env` contains the variable and is in the project root.

### Requests are slow

Check whether the slowness is in the server or your graph:

```bash
# Enable verbose logging
10xgraph dev --no-open --verbose
```

Look at the logs to see if the server itself is slow (networking, checkpointer reads) or if the graph is slow (tool execution, model latency). Check:

- Does your graph make external API calls? Test those connections.
- Is a tool taking a long time? Check its implementation and any external services it calls.
- Is the checkpointer slow? Verify database connectivity and load.

### "Connection refused" or cannot reach the server

Confirm that:

1. The server is running (check the terminal where you started it)
2. The host and port are correct (default: `http://127.0.0.1:8000`)
3. In Docker or on a VM, networking is properly configured (ensure `--host 0.0.0.0` and the port is exposed)

Test with: `curl http://127.0.0.1:8000/ping`

## Next steps

- **Configure the server:** See [Configure the server](/docs/server/configure) for auth, checkpointing, rate limiting, and per-environment settings.
- **Deploy to production:** See [Deploy the server](/docs/server/deploy) for Docker, Kubernetes, and production hardening.
- **Monitor and debug:** See [Observability](/docs/server/observability) for logs, metrics, tracing, and error handling.
- **Call the server from code:** See [Invoke and stream](/docs/server/invoke-and-stream) for REST endpoint details, and [TypeScript client](/docs/client/create-client) for client library usage.
