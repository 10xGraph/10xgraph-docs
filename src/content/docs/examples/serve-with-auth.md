---
title: Serve an agent with auth, from init to Docker
seoTitle: "Serve a 10xGraph agent with JWT auth"
description: Scaffold the production template, run it with JWT auth, call it with curl and TenxGraphClient, then generate Docker files with 10xgraph build.
section: Examples
group: Production
order: 11
label: Serve with auth
updated: "2026-10-27"
faq:
  - q: Does the production template run with no auth?
    a: "No. With --auth jwt the generated 10xgraph.json sets \"auth\": \"jwt\" and the server needs JWT_SECRET_KEY. If you set \"auth\": null and MODE=production, the server starts open and nothing refuses it, so configure auth yourself."
  - q: Why replace InMemoryCheckpointer before deploying?
    a: The generated image starts Gunicorn with WEB_CONCURRENCY=2, and an in-memory checkpointer lives inside one process. Use PgCheckpointer so threads, ownership and the tool ledger survive a restart and are shared between workers.
---

You write the agent. `10xgraph-api` turns it into an HTTP service with JWT auth, per-user thread ownership, rate limiting and a hardened container. This page goes from an empty folder to a token-protected server and a Docker build, with the commands and files exactly as the CLI generates them.

**Needs:** Python 3.12+, `pip install "10xgraph[openai]" "10xgraph-api[jwt,redis]"` (the template's own `pyproject.toml` lists these), `OPENAI_API_KEY` for the model, and a Redis if you keep the Redis rate limiter. Use `--provider google` or `--provider anthropic` to switch the provider extra and the key name.

## 1. Scaffold the production template

```bash
10xgraph init --template production --auth jwt --rate-limit redis --provider openai --yes
```

`--rate-limit` takes `none`, `memory` or `redis`. Use `memory` for a first run without Redis; the Redis backend is the one that is shared between workers.

The command writes the project into the current folder. The files you will touch:

| File | What it holds |
|---|---|
| `10xgraph.json` | `"agent": "graph.agent:app"`, `"auth": "jwt"`, `"authorization": "ownership"`, the `rate_limit` block, `websocket` and `ag_ui` both off |
| `graph/agent.py` | A `ReactAgent` compiled with a checkpointer |
| `.env.example` | `MODE="production"`, `ORIGINS`, `ALLOWED_HOST`, `JWT_SECRET_KEY`, `JWT_ALGORITHM`, `REDIS_URL`, `OPENAI_API_KEY`, empty `DOCS_PATH` |
| `tests/`, `evals/` | A starter test and a starter eval file |

The rate limit section of `10xgraph.json` as generated:

```json
"rate_limit": {
  "enabled": true,
  "backend": "redis",
  "requests": 100,
  "window": 60,
  "by": "ip",
  "trusted_proxy_headers": false,
  "exclude_paths": ["/ping", "/docs", "/redocs", "/openapi.json"],
  "redis": { "url": "${REDIS_URL}" }
}
```

## 2. Configure the environment

```bash
cp .env.example .env
```

Edit `.env`:

```bash
JWT_SECRET_KEY="<paste the output of: python -c 'import secrets; print(secrets.token_urlsafe(48))'>"
OPENAI_API_KEY="sk-..."
ORIGINS="http://localhost:3000"
ALLOWED_HOST="127.0.0.1,localhost"
REDIS_URL="redis://localhost:6379/0"
```

In production mode the app refuses to start on a wildcard `ORIGINS` or `ALLOWED_HOST`, or with API docs enabled (`.env.example` says so, and you can downgrade these checks with `STRICT_PRODUCTION_CHECKS="false"`; do not do that outside local tests). Set the two values to your real frontend origin and hostname when you deploy.

## 3. Check the checkpointer before you deploy

The generated `graph/agent.py` compiles with `InMemoryCheckpointer`, which is fine for a first run. The Docker image you build in step 6 starts two Gunicorn workers, and each worker has its own memory, so for anything beyond a demo pass `PgCheckpointer` to `compile()`:

```python
from tenxgraph.storage.checkpointer import PgCheckpointer

checkpointer = PgCheckpointer(
    postgres_dsn="postgresql://user:password@db/agent",
    redis_url="redis://redis:6379/0",
)
```

The server uses the checkpointer carried by the compiled graph. The `checkpointer` key in `10xgraph.json` is not read. See [Set up checkpointing](/docs/guides/set-up-checkpointing).

## 4. Start the server and mint tokens

```bash
10xgraph dev --no-open
```

`--no-open` starts the server without opening the playground. It listens on `127.0.0.1:8000`. In a second terminal, mint a token. `JwtAuth` requires `user_id` (a non-empty string or a whole number) and `exp`:

```python title="make_token.py"
import os
import time

import jwt  # PyJWT, installed by 10xgraph-api[jwt]

token = jwt.encode(
    {"user_id": "alice", "exp": int(time.time()) + 3600},
    os.environ["JWT_SECRET_KEY"],
    algorithm=os.environ.get("JWT_ALGORITHM", "HS256"),
)
print(token)
```

In production your login service issues this token. The `user_id` becomes the owner of every thread the user creates, so it must never come from the request body.

## 5. Call it

Without a token the server answers `401` and the request never reaches the graph.

```bash
export TOKEN="$(JWT_SECRET_KEY=... python make_token.py)"

curl -s http://127.0.0.1:8000/v1/graph/invoke \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":[{"type":"text","text":"Where is order 1042?"}]}]}'
```

The response carries `data.meta.thread_id`. The server makes thread ids; to continue the conversation send `"config": {"thread_id": "<that id>"}` in the next request. Another user's token on that id gets `403`.

The same call with the TypeScript client (`npm install 10xgraph-client`):

```ts
import { TenxGraphClient, Message } from '10xgraph-client';

const client = new TenxGraphClient({
  baseUrl: 'http://127.0.0.1:8000',
  authToken: process.env.TOKEN,
});

const first = await client.invoke([Message.text_message('Where is order 1042?')]);
const threadId = first.meta.thread_id;

const next = await client.invoke([Message.text_message('Can I return it?')], {
  config: { thread_id: threadId },
});
console.log(next.messages.at(-1)?.content);
```

For where a browser app should keep the token, see [Secure your frontend](/docs/client/secure-your-frontend).

## 6. Build the container files

```bash
10xgraph build --docker-compose
```

This writes `Dockerfile`, `.dockerignore` and `docker-compose.yml` (add `--k8s` for a Kubernetes manifest). What the generated files contain:

- A two-stage `Dockerfile`: dependencies install in a builder stage, the CLI libraries and pip are removed, and the runtime image runs as the numeric non-root user `10001:10001`.
- `WEB_CONCURRENCY=2` Gunicorn workers with `uvicorn_worker.UvicornWorker`, and `MODE=production`.
- A `HEALTHCHECK` against `/ping`.
- In `docker-compose.yml`: the port bound to `127.0.0.1:8000` (put a TLS proxy in front), `read_only: true` with `/tmp` as tmpfs, `cap_drop: ALL`, `no-new-privileges`, and a 660 s `stop_grace_period`.
- Secrets come from `.env` at run time. `.dockerignore` keeps `.env` out of the image.

```bash
docker compose up --build
```

## What this shows

- Auth is on from the first command: the template writes `"auth": "jwt"` and `"authorization": "ownership"`, and a request without a valid token never reaches your graph. See [Security in five minutes](/docs/get-started/security-in-five-minutes).
- Production mode refuses unsafe settings at start (wildcard origins and hosts, enabled docs). See [Production readiness](/docs/production) and [Security model](/docs/production/security-model).
- The container is hardened by `10xgraph build`, not by your agent code. See [Production checklist](/docs/server/production-checklist) and [Architecture](/docs/production/architecture).
- What you must still do: set auth (a server with `auth: null` in production starts open), replace the in-memory checkpointer, and put TLS in front. See [What 10xGraph does not protect](/docs/production/limits).
