---
title: Production Deployment Checklist
seoTitle: "Production hardening checklist for 10xGraph"
description: "Security, persistence, scaling, and monitoring checklist before shipping your 10xGraph API to production."
section: "API server"
group: "Operate"
order: 170
label: Production Checklist
updated: "2026-10-27"
faq:
  - question: "What is the minimum checklist for production?"
    answer: "Set MODE=production, use explicit ORIGINS, configure Postgres+Redis for persistence, enable rate limiting, and run at least two API instances."
  - question: "Can I use in-memory checkpointing in production?"
    answer: "No. InMemoryCheckpointer loses all state on restart and cannot be shared across instances. Use PgCheckpointer for all production deployments."
  - question: "Do I have to use Redis?"
    answer: "PgCheckpointer requires a Redis connection (redis_url, a redis_pool or a redis instance) in addition to Postgres; Redis is its cache and Postgres is the durable store. Redis is also what the Redis rate-limit backend uses."
---

Deploying 10xGraph to production requires hardening your API server for security, reliability, and scale. This checklist walks through every critical setting, from runtime mode to persistence topology to horizontal scaling, with verification steps to confirm each piece is working before traffic arrives.

## Already done by the server in production

With `MODE=production`, the server does these for you. You do not configure them; the sections below cover what you still own.

- Validates `MODE` at startup: a typo stops the server instead of running with development defaults.
- Runs strict production checks (`STRICT_PRODUCTION_CHECKS`, on by default): wildcard `ORIGINS` or `ALLOWED_HOST`, wildcard CORS with credentials and enabled docs paths are refused at boot, and short HMAC JWT secrets are rejected.
- Turns off the `/docs` and `/redocs` pages unless you set their paths.
- Replaces 5xx error text, including streamed error chunks, with a generic message. Raise `ClientInputError` for 422 messages that must reach the client.
- Cancels a graph run after 300 seconds unless you set `runs.timeout`.
- Scopes graph introspection (`GET /v1/graph`, `/v1/graph/tools`, `/v1/graph:StateSchema`) to callers with the `graph:read` scope, unless you set `graph_introspection` to `"open"`.
- Defaults authorization to ownership, so each user reaches only their own threads.
- Turns debug mode off.
- Ships a hardened image when you use `10xgraph build`: non-root user, Gunicorn with `TenxGraphUvicornWorker` and long graceful timeouts, health check on `/ping`. On SIGTERM `/health/ready` answers 503 while open runs finish.

For why these matter, see the [security model](/docs/production/security-model) and [scaling and reliability](/docs/production/scaling).

## What you still own

- **Configure auth.** Nothing refuses `"auth": null` in production; the server starts open and every route except `/ping` accepts any caller. Set `"auth": "jwt"` or a custom backend (section 2).
- Strong secrets, explicit `ORIGINS`, and secret storage (sections 2 and 3).
- A shared, durable checkpointer passed to `compile()`, plus Postgres and Redis operations and backups (section 5).
- Rate limits, worker count and replica count for your traffic (sections 6 and 7).
- Proxy, media storage, monitoring and the verification steps at the end.

## Prerequisites

You have a 10xGraph project with a working `10xgraph.json` and a compiled graph. You are ready to containerize and deploy. This guide covers Linux/Kubernetes production environments; Docker and `docker-compose` will be used in examples.

Before production, make sure you have read the guides for checkpointing, authentication, and rate limiting:

- [Set up checkpointing](/docs/guides/set-up-checkpointing)
- [Authentication](/docs/server/auth)
- [Rate limiting](/docs/server/rate-limiting)

## 1. Runtime mode and debug settings

The first critical step is disabling development features. Set these environment variables:

```bash
MODE=production
LOG_LEVEL=INFO
```

`MODE` accepts `production` (or `prod`) and `development` (or `dev`, `local`), trimmed and case-insensitive. Unset means `development`. Any other value, such as a typo, stops the server at startup, so a misspelling cannot run with the development defaults.

`MODE=production` enforces stricter validation at startup: wildcard CORS origins combined with credentials fail the server boot, and HMAC JWT secrets shorter than 32 bytes are rejected. `STRICT_PRODUCTION_CHECKS` is on by default in production and also stops startup on a wildcard `ORIGINS`, a wildcard `ALLOWED_HOST`, or enabled `DOCS_PATH` and `REDOCS_PATH`. Set `STRICT_PRODUCTION_CHECKS=false` to start with warnings only. It also turns off the `/docs` and `/redocs` pages unless you set their paths explicitly. Debug mode follows `MODE`, so it is off in production.

## 2. Secrets and authentication

### JWT configuration

If you use JWT authentication in `10xgraph.json`:

```json
{
  "auth": "jwt"
}
```

Set a strong secret key and algorithm:

```bash
JWT_SECRET_KEY=$(openssl rand -hex 32)   # 64 hex chars = 32 bytes, production minimum
JWT_ALGORITHM=HS256
```

Export these to your deployment. The server requires them at startup when JWT auth is configured and will fail to boot otherwise. It also fails to boot if PyJWT is missing, or if `JWT_ALGORITHM` is `none`, empty or not one of `HS256`, `HS384`, `HS512`, `RS256`, `RS384`, `RS512`, `ES256`, `ES384`, `ES512`, `PS256`, `PS384`, `PS512` or `EdDSA`. The `auth` value must be exactly `"jwt"`.

The server rejects a token that has no `user_id` claim. To mint a test token:

```bash
# Example using PyJWT (install: pip install PyJWT)
python -c "
import jwt
import os
secret = os.environ['JWT_SECRET_KEY']
payload = {'user_id': 'user-123'}
token = jwt.encode(payload, secret, algorithm='HS256')
print(token)
"
```

### Custom authentication

If you use custom authentication, ensure your `BaseAuth` subclass is deployed with its dependencies. Start the server and confirm a request without credentials is rejected with 401.

### API keys and secrets

Never commit secrets to version control. Secrets must be passed at deployment time via environment variables or a secret manager:

- Development: use a `.env` file (added to `.gitignore`)
- Production: inject via your orchestration platform (Kubernetes secrets, AWS Secrets Manager, GitHub Actions secrets, etc.)

## 3. CORS and security headers

Restrict CORS origins to your front-end domains:

```bash
ORIGINS=https://app.example.com,https://admin.example.com
ALLOWED_HOST=app.example.com
```

The server refuses to start with a wildcard `ORIGINS` or a wildcard `ALLOWED_HOST` in production mode, because `STRICT_PRODUCTION_CHECKS` is on by default. If you need cross-origin requests from any origin without credentials, opt out of the strict checks and turn credentials off:

```bash
ORIGINS=*
CORS_ALLOW_CREDENTIALS=false
STRICT_PRODUCTION_CHECKS=false
```

Security headers are enabled by default (`SECURITY_HEADERS_ENABLED`). `Strict-Transport-Security` is only sent on HTTPS requests, so check through your TLS endpoint:

```bash
curl -si https://api.10xgraph.com/ping | grep -iE "strict-transport-security|x-frame-options"
```

In production mode the documentation pages are off unless you set `DOCS_PATH` or `REDOCS_PATH` explicitly. Leave them unset.

## 4. Authentication and authorization

### Access control

If you are using authorization (RBAC or ownership-based access control), configure it in `10xgraph.json`:

```json
{
  "auth": "jwt",
  "authorization": "ownership"
}
```

The `ownership` backend ensures each user can access only their own threads. `10xgraph init` writes it into new projects that use JWT or custom auth; it is not applied automatically otherwise. Verify it is enforced by requesting a thread owned by a different user; the API should deny the request.

### Permission scopes

If your authorization uses custom scopes, ensure they are validated on every protected route. Authentication guards the graph, thread, store and media routes. `/ping` needs no authentication.

## 5. Persistence topology

Thread history, state snapshots, and message logs must survive server restarts and be shared across instances.

### PostgreSQL setup

Use `PgCheckpointer` in production (`pip install "10xgraph[pg_checkpoint]"`). In your graph module, instantiate the checkpointer:

```python
from tenxgraph.storage.checkpointer import PgCheckpointer

my_checkpointer = PgCheckpointer(
    postgres_dsn="postgresql://user:password@postgres.internal:5432/10xgraph",
    redis_url="redis://redis.internal:6379/0",
)

app = state_graph.compile(checkpointer=my_checkpointer)
```

The API server calls the checkpointer's `asetup()` at boot to create the tables. If that fails it logs the error and retries on first use. Call `setup()` or `asetup()` yourself only if your code manages startup outside the server. Make sure the database user has CREATE permission. List the tables:

```bash
psql "postgresql://user:password@postgres.internal/10xgraph" -c "
  SELECT table_name FROM information_schema.tables 
  WHERE table_schema = 'public' 
  ORDER BY table_name;
"
```

Expected tables in the `public` schema (or the `schema=` you pass): `threads`, `states`, `messages`, `tool_executions`, `schema_version`. They have no name prefix, so use a dedicated database or schema if you share the instance.

`/health/ready` answers 503 while the database schema version is below what the code expects, so a pod started before its migration ran stays out of rotation.

### Redis caching

Redis acts as a hot cache in front of Postgres. `PgCheckpointer` requires a Redis connection, but the durable data lives in Postgres.

If several deployments share one Redis, set `REDIS_KEY_PREFIX` for the API (run locks, caps, ownership cache, token revocation) and `redis_key_prefix` on `PgCheckpointer` to the same value. They are two separate settings, and each prefixes only its own keys.

```bash
REDIS_URL=redis://redis.internal:6379/0
```

Verify Redis connectivity:

```bash
redis-cli -u redis://redis.internal:6379/0 ping
# Should respond PONG
```

### One run per thread

The server runs one graph run at a time on a thread. With Redis configured, the lock is shared across all instances, so two replicas cannot run the same thread at once. Without Redis, the lock is per process and does not stop two replicas from running one thread together. A second run waits up to 30 seconds, then gets `409` (`thread is busy`). The lock expires on its own if a worker dies. If Redis is unreachable, runs proceed without the lock and the error is logged. See [Invoke and stream](/docs/server/invoke-and-stream#one-run-per-thread).

### Warnings you may see

The server logs a WARNING at startup in production, or when `WEB_CONCURRENCY` is above 1, if the checkpointer is `InMemoryCheckpointer` or `SqliteCheckpointer` (threads live in one process) or if no Redis is configured (run locks, caps and in-memory rate limits count per process). `compile()` logs a WARNING when you give it no checkpointer and it falls back to in-memory, and a graph logs one WARNING per graph on its first run with no `user_id`. These are your call; use `PgCheckpointer` with Redis for more than one process.

### Topology diagram

```
                    Load Balancer
                          |
       ___________ _________|_______  _________
      |           |               |  |
   API 1        API 2           API 3
      |           |               |
       \___________|_______________|
             |                |
         PostgreSQL          Redis
```

All three API instances point to the same PostgreSQL and Redis. On restart, they read the latest state from the shared backend.

## 6. Horizontal scaling and workers

Deploy at least two API instances behind a load balancer to survive instance failures. Each instance must point to the same Postgres and Redis.

### Gunicorn + Uvicorn (ASGI server)

The `Dockerfile` from `10xgraph build` already starts Gunicorn with Uvicorn workers. If you run the server yourself, use the same flags. The generated command uses the `TenxGraphUvicornWorker` class, a 600-second graceful timeout and a 660-second worker timeout so long agent runs are not killed mid-flight. The worker marks the app as draining on SIGTERM (readiness answers 503) and waits `TENXGRAPH_GRACEFUL_SHUTDOWN_SECONDS` (540 by default) for open responses. Plain `uvicorn.workers.UvicornWorker` also works but skips the draining flag and the final "interrupted" chunk for open streams:

```bash
#!/bin/bash
set -e

export MODE=production
export REDIS_URL="redis://redis.internal:6379/0"
export JWT_SECRET_KEY=$JWT_SECRET_KEY  # from environment
export ORIGINS="https://app.example.com"

gunicorn \
  --workers 4 \
  -k tenxgraph_api.src.app.uvicorn_worker.TenxGraphUvicornWorker \
  -b 0.0.0.0:8000 \
  --graceful-timeout 600 \
  --timeout 660 \
  tenxgraph_api.src.app.main:app
```

Set the `GRAPH_PATH` environment variable to your `10xgraph.json` if it is not in the working directory. Start with 2-4 workers per available CPU core. Monitor CPU and memory usage to tune.

### Environment variable for workers

Gunicorn reads `WEB_CONCURRENCY` as the worker count if `--workers` is not specified. The generated `Dockerfile` sets it to 2:

```bash
WEB_CONCURRENCY=4
```

### Instance identity

If using Snowflake IDs for distributed, time-ordered thread identifiers, set unique node and worker IDs per instance:

```bash
SNOWFLAKE_NODE_ID=1      # datacenter id; increment per datacenter
SNOWFLAKE_WORKER_ID=1    # server instance id; increment per server
```

In a second instance:

```bash
SNOWFLAKE_NODE_ID=1
SNOWFLAKE_WORKER_ID=2
```

### Error text and request limits

With `MODE=production`, error chunks on stream, WebSocket and AG-UI carry a generic message instead of the raw exception text, the same as invoke. Requests are also limited to 500 messages, 100 content blocks per message and 1,000,000 characters of text; over a limit gets `422` naming the limit. `initial_state`, `config` and `resume` may be nested no deeper than 64 levels. Neither needs configuration.

## 7. Rate limiting

Enable rate limiting to protect against abuse and unintended traffic spikes:

```json
{
  "rate_limit": {
    "enabled": true,
    "requests": 100,
    "window": 60,
    "by": "ip",
    "backend": "redis",
    "redis": {
      "url": "redis://redis.internal:6379/1"
    }
  }
}
```

This allows 100 requests per IP address per 60-second window. Use a separate Redis database (`/1`) to isolate rate limit data from the checkpointer cache.

`/ping` is always excluded from rate limiting. Add other paths with `exclude_paths`:

```json
{
  "rate_limit": {
    "enabled": true,
    "requests": 100,
    "window": 60,
    "exclude_paths": ["/metrics"]
  }
}
```

Verify rate limiting is active:

```bash
for i in {1..5}; do
  curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8000/v1/graph/invoke \
    -H "Content-Type: application/json" \
    -d '{"messages": [{"role": "user", "content": [{"type": "text", "text": "test"}]}]}'
done
# After threshold, requests should return 429 Too Many Requests
```

## 8. Proxy buffering and request handling

When running behind a reverse proxy (nginx, HAProxy, AWS ALB), ensure it forwards headers correctly:

```nginx
# Example nginx configuration
proxy_pass http://10xgraph_backend;
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header Host $host;

# Allow large request bodies for file uploads
client_max_body_size 50m;

# Buffer size for streaming responses
proxy_buffering off;
```

Behind a proxy, every request appears to come from the proxy's address. For per-IP rate limiting to see real client IPs, set `trusted_proxy_headers` in the `rate_limit` block of `10xgraph.json` (see [Rate limiting](/docs/server/rate-limiting)). Only enable it when the proxy sets `X-Forwarded-For`.

## 9. Media storage and file uploads

Configure where uploaded files are stored:

```bash
MEDIA_STORAGE_TYPE=local
MEDIA_STORAGE_PATH=/data/uploads
MEDIA_MAX_SIZE_MB=25
MEDIA_ALLOWED_CONTENT_TYPES=image/*,application/pdf  # empty (default) allows any type
```

For cloud storage:

```bash
MEDIA_STORAGE_TYPE=cloud
MEDIA_CLOUD_PROVIDER=aws
MEDIA_CLOUD_BUCKET=my-bucket
MEDIA_CLOUD_REGION=us-east-1
MEDIA_CLOUD_PREFIX=10xgraph-media
```

Ensure the storage directory (or cloud bucket) is writable and has sufficient capacity. Monitor disk or cloud storage usage.

## 10. Database backups

PostgreSQL holds all thread history, messages, and state snapshots. Back it up regularly:

```bash
# Daily backup
0 2 * * * pg_dump -h postgres.internal -U user 10xgraph | gzip > /backups/10xgraph-$(date +%Y%m%d).sql.gz
```

Test restore procedures before relying on them:

```bash
gunzip -c /backups/10xgraph-20261008.sql.gz | psql -h postgres.internal -U user 10xgraph
```

See [Backup and restore](/docs/server/backup-and-restore) for table-scoped dumps and restore order. Retain backups for at least 7 days. For critical applications, use point-in-time recovery with PostgreSQL's WAL archiving.

## 12. Observability and monitoring

### Logging

Set `LOG_LEVEL=INFO` in production. The server generates a request ID per request and returns it in the `X-Request-ID` response header; log it on the client side to correlate with server logs.

### Sentry error tracking

If using Sentry for error monitoring:

```bash
SENTRY_DSN=https://key@sentry.example.com/project
SENTRY_TRACES_SAMPLE_RATE=0.1
```

Sampling 10% of traces is typical for production.

The playground's Run trace endpoint (`GET /v1/observability/{thread_id}`) is a development tool. With `MODE=production` it records nothing and returns `enabled: false`, so you have nothing to configure or secure for it. Use OTEL or a publisher for production traces.

The API reports only server faults: 4xx responses are logged at WARNING and never become events, and request bodies are never sent to Sentry. If an alert matches ERROR logs for client errors, match WARNING instead.

### OpenTelemetry tracing

For distributed tracing across your infrastructure:

```bash
OTEL_ENABLED=true
OTEL_SERVICE_NAME=10xgraph-api
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
```

Set the endpoint. With `MODE=production` and no endpoint, the server does not print spans to the console (they could carry request URLs and, at `OTEL_LEVEL=full`, message content); it exports nothing and logs a warning at startup.

### Traces and event publishers

Traces at the `full` level and the Redis, RabbitMQ and Kafka publishers carry message and tool content, and spans carry the user id. 10xGraph never forces TLS on these connections; it is your call:

- We recommend TLS in production whenever you can (`rediss://`, `amqps://`, Kafka `security_protocol="SSL"` or `"SASL_SSL"`, an `https://` OTLP endpoint), and always on a network you do not control.
- A broker or collector reachable only inside a network you secure yourself (a private subnet or VPC, or a service mesh that already encrypts traffic) can run without it.
- To keep real user ids out of traces, set `"observability": {"user_id_mode": "hash"}` (or `"mask"`) in `10xgraph.json`.

See [What is in your traces and events](/docs/concepts/events-and-observability#what-is-in-your-traces-and-events).

## Verification checklist

Before opening the API to production traffic, run these tests:

### 1. Authentication works

```bash
curl -X POST http://127.0.0.1:8000/v1/graph/invoke \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": [{"type": "text", "text": "test"}]}]}'
# Should succeed with a valid token, fail with 401 if token is missing
```

### 2. Thread persistence survives restart

```bash
# First invoke. Omit thread_id: the server starts a new thread and returns its id
# in data.meta.thread_id. Use that id below.
curl -X POST http://127.0.0.1:8000/v1/graph/invoke \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": [{"type": "text", "text": "Remember: my name is Alice"}]}]}'

# Verify it's stored (replace THREAD_ID with the returned id)
curl http://127.0.0.1:8000/v1/threads/THREAD_ID/messages

# Stop the API server and restart it

# Verify state persists
curl http://127.0.0.1:8000/v1/threads/THREAD_ID/messages
# Should still contain the previous message
```

### 3. Rate limiting is active

Run 150 requests in quick succession and verify 429 responses after 100.

### 4. Security headers are present

```bash
curl -si https://api.10xgraph.com/ping | grep -iE "strict-transport-security|x-frame-options|x-content-type"
```

### 5. Docs paths are disabled

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8000/docs
# Should print 404
```

### 6. Load balancer health checks work

```bash
curl http://127.0.0.1:8000/ping
# Should return 200 OK with no auth required
```

## Common issues

| Symptom | Cause | Fix |
|---|---|---|
| "JWT_SECRET_KEY is shorter than 32 bytes" at startup | HMAC secret too short in production mode | Generate a longer `JWT_SECRET_KEY` |
| Requests are denied on a thread | User does not own the thread | Check authorization backend and thread ownership |
| Thread state disappears after restart | Using `InMemoryCheckpointer` | Switch to `PgCheckpointer` with Postgres DSN |
| One worker sees state, another does not | Workers are not sharing the same backend | Point all instances at the same Postgres and Redis |
| CORS requests are blocked | `ORIGINS` does not include the client domain | Add the domain to `ORIGINS`. A public API can set `ORIGINS=*` with `CORS_ALLOW_CREDENTIALS=false` and `STRICT_PRODUCTION_CHECKS=false` |
| `409 thread is busy` on a thread | Another run is still active, and the 30 s wait ran out | Wait for the run to end, use `on_busy: "cancel"`, or use one thread per conversation |
| Rate limiting not working | No `rate_limit` block, or Redis is down (with `fail_open` true, requests pass) | Verify `rate_limit.redis.url` and Redis connectivity |

## Related pages

- [Configure the 10xgraph.json file](/docs/server/configure)
- [Authentication and authorization](/docs/server/auth)
- [Rate limiting](/docs/server/rate-limiting)
- [Checkpointing and threads](/docs/concepts/checkpointing-and-threads)
- [Set up checkpointing](/docs/guides/set-up-checkpointing)
- [Observability](/docs/server/observability)
- [Deploy](/docs/server/deploy)
- [Production readiness](/docs/production)
- [Security model](/docs/production/security-model)
- [Scaling and reliability](/docs/production/scaling)
- [Authorization scopes](/docs/guides/authorization-scopes)
- [Graceful shutdown](/docs/guides/graceful-shutdown)
