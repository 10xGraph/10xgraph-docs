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
    answer: "Set MODE=production, IS_DEBUG=false, use explicit ORIGINS, configure Postgres+Redis for persistence, enable rate limiting, and run at least two API instances."
  - question: "Can I use in-memory checkpointing in production?"
    answer: "No. InMemoryCheckpointer loses all state on restart and cannot be shared across instances. Use PgCheckpointer for all production deployments."
  - question: "Do I have to use Redis?"
    answer: "PgCheckpointer requires a Redis connection (redis_url, a redis_pool or a redis instance) in addition to Postgres; Redis is its cache and Postgres is the durable store. Redis is also what the Redis rate-limit backend uses."
---

Deploying 10xGraph to production requires hardening your API server for security, reliability, and scale. This checklist walks through every critical setting, from runtime mode to persistence topology to horizontal scaling, with verification steps to confirm each piece is working before traffic arrives.

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
IS_DEBUG=false
LOG_LEVEL=INFO
```

`MODE=production` enforces stricter validation at startup: wildcard CORS origins combined with credentials fail the server boot, and HMAC JWT secrets shorter than 32 bytes are rejected. It also turns off the `/docs` and `/redocs` pages unless you set their paths explicitly, and it does not mount the eval report routes. Leave `IS_DEBUG=false`; debug mode in production logs a security warning.

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

Export these to your deployment. The server requires them at startup when JWT auth is configured and will fail to boot otherwise.

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

The server refuses to start with `ORIGINS="*"` and `CORS_ALLOW_CREDENTIALS=true` (the default) in production mode. If you need cross-origin requests without credentials, set:

```bash
ORIGINS=*
CORS_ALLOW_CREDENTIALS=false
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

The checkpointer creates tables automatically on first connection (call `setup()` or `asetup()` if your code manages startup itself). Make sure the database user has CREATE permission. List the tables:

```bash
psql "postgresql://user:password@postgres.internal/10xgraph" -c "
  SELECT table_name FROM information_schema.tables 
  WHERE table_schema = 'public' 
  ORDER BY table_name;
"
```

Expected tables in the `public` schema (or the `schema=` you pass): `threads`, `states`, `messages`, `tool_executions`, `schema_version`. They have no name prefix, so use a dedicated database or schema if you share the instance.

### Redis caching

Redis acts as a hot cache in front of Postgres. `PgCheckpointer` requires a Redis connection, but the durable data lives in Postgres.

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

The `Dockerfile` from `10xgraph build` already starts Gunicorn with Uvicorn workers. If you run the server yourself, use the same flags. The generated command uses a 600-second graceful timeout and a 660-second worker timeout so long agent runs are not killed mid-flight:

```bash
#!/bin/bash
set -e

export MODE=production
export IS_DEBUG=false
export REDIS_URL="redis://redis.internal:6379/0"
export JWT_SECRET_KEY=$JWT_SECRET_KEY  # from environment
export ORIGINS="https://app.example.com"

gunicorn \
  --workers 4 \
  -k uvicorn.workers.UvicornWorker \
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

With `MODE=production`, error chunks on stream, WebSocket and AG-UI carry a generic message instead of the raw exception text, the same as invoke. Requests are also limited to 500 messages, 100 content blocks per message and 1,000,000 characters of text; over a limit gets `422` naming the limit. Neither needs configuration.

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

## 10. Eval endpoints

The eval report routes (`/v1/evals/runs`) have no authentication. The server does not mount them when `MODE=production`, so no extra configuration is needed. Confirm `MODE=production` is set in every environment that faces users.

## 11. Database backups

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

### OpenTelemetry tracing

For distributed tracing across your infrastructure:

```bash
OTEL_ENABLED=true
OTEL_SERVICE_NAME=10xgraph-api
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
```

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
# First invoke
curl -X POST http://127.0.0.1:8000/v1/graph/invoke \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": [{"type": "text", "text": "Remember: my name is Alice"}]}], "config": {"thread_id": "test-123"}}'

# Verify it's stored
curl http://127.0.0.1:8000/v1/threads/test-123/messages

# Stop the API server and restart it

# Verify state persists
curl http://127.0.0.1:8000/v1/threads/test-123/messages
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
| CORS requests are blocked | `ORIGINS` does not include the client domain | Add the domain to `ORIGINS` or set `ORIGINS=*` with `CORS_ALLOW_CREDENTIALS=false` |
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
