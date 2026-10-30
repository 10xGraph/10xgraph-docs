---
title: API Server Troubleshooting
description: Symptoms, causes, and fixes for 10xGraph API server problems at startup, at request time, and in production deployments.
section: Troubleshooting
order: 40
updated: "2026-10-27"
faq:
  - q: Why does the server refuse to start with "routes are not protected"?
    a: Every route except /ping and the two eval report routes must carry a RequirePermission guard. The check runs at startup so a forgotten guard cannot ship as an open endpoint. Add the dependency to the handler.
  - q: Why do /ping and the health check pass but graph requests fail?
    a: The server started, but the graph fails when invoked. Read the runtime logs for bad provider keys, missing packages or tool errors.
  - q: Why do threads disappear after a restart?
    a: The in-memory checkpointer is still in use. Switch to a durable checkpointer such as PgCheckpointer.
---

Use this page when `10xgraph dev` fails to start, rejects requests, or behaves differently in production than locally. Find your symptom under startup, request-time or production issues, then apply the fix. Each entry lists symptoms, the cause and a concrete fix verified against the server code.

## Server troubleshooting map

```mermaid
flowchart TD
    A[Server problem] --> B{Startup or request-time?}
    B -->|Startup| C[Check config import, env, port, dependencies]
    B -->|Request-time| D[Check auth, graph errors, persistence, logs]
    C --> E[Apply fix]
    D --> E
```

## Startup issues

### Issue: server does not start

**Symptoms**

- command exits immediately
- stack trace appears before the server binds

**Likely causes**

- invalid `10xgraph.json`
- graph import failure
- missing required environment variables or provider keys

**Fix**

- verify the config file path
- test the graph import manually: `python -c "from graph.react import app; print(app)"`
- verify required provider keys and dependencies are installed before startup

### Issue: `RuntimeError: Refusing to start: the following routes are not protected`

**Symptoms**

- startup aborts with a `RuntimeError` listing one or more routes

```
RuntimeError: Refusing to start: the following routes are not protected by RequirePermission.
Add the dependency, or add the path to the public allowlist if it is intentionally open:
  - POST /v1/my-new-endpoint
```

**Cause**

Every non-public route must carry a `RequirePermission` guard. The check runs once at startup and walks the entire dependency subtree of every route. This is deliberate: a forgotten guard would otherwise ship a silently open endpoint.

**Fix**

Add the dependency to the handler (the import path is `tenxgraph_api.src.app.core.auth.permissions`):

```python title="my_router.py"
from typing import Any

from fastapi import APIRouter, Depends

from tenxgraph_api.src.app.core.auth.permissions import RequirePermission

router = APIRouter()


@router.post("/v1/my-new-endpoint")
async def my_endpoint(
    user: dict[str, Any] = Depends(RequirePermission("graph", "read")),
):
    return {"ok": True}
```

Only `/ping` is public. Modifying the public allowlist requires editing the source code frozenset, which is intentional. Do not use it to silence this error on a route that handles user data.

### Issue: `InsecureCorsConfigError` on startup


**Symptoms**

- the server refuses to start in production with a message beginning "Refusing to start: CORS is configured with ORIGINS='*'"

**Cause**

`ORIGINS="*"` combined with `CORS_ALLOW_CREDENTIALS=true` while `MODE=production`. Starlette reflects the caller's `Origin` back alongside `Access-Control-Allow-Credentials: true`, which makes every origin a trusted, credentialed one.

In development the same combination only logs a warning, so this failure usually appears the first time a working local config is promoted to production.

**Fix**

Pick one:

```bash
# Name the origins explicitly (the usual answer)
ORIGINS=https://yourapp.com,https://api.yourapp.com
```

```bash
# Or serve a public, non-credentialed API (production also needs the strict checks off)
CORS_ALLOW_CREDENTIALS=false
STRICT_PRODUCTION_CHECKS=false
```

### Issue: `Refusing to start: MODE=production with insecure settings`

**Symptoms**

- the server exits at startup in production and lists one or more lines that start with a warning sign

**Cause**

`STRICT_PRODUCTION_CHECKS` is on by default in production. It stops startup on a wildcard `ALLOWED_HOST` (including `*` with spaces around it), a wildcard `ORIGINS`, or an enabled `DOCS_PATH` or `REDOCS_PATH`. Generated `.env.example`, compose and Kubernetes files use placeholder values, so a file you did not edit also trips it.

**Fix**

- set `ALLOWED_HOST` and `ORIGINS` to your real hosts and origins, and leave `DOCS_PATH` and `REDOCS_PATH` empty
- or set `STRICT_PRODUCTION_CHECKS=false` to start with warnings only

### Issue: `Invalid MODE` on startup

**Symptoms**

- the server, or `10xgraph dev`, exits with a message that starts with `Invalid MODE` and lists the accepted values
- `10xgraph dev` exits with code 2

**Cause**

`MODE` is trimmed and lowercased, then must be one of `production`, `prod`, `development`, `dev` or `local`. Anything else, such as `prodution`, is refused so a typo cannot run with the development defaults. Unset means `development`.

**Fix**

- correct the spelling, or remove the variable for development

### Issue: runs fail with 504 or a `runs.timeout` error

**Symptoms**

- invoke returns `504` with `Graph run passed the runs.timeout limit of 300s and was cancelled`
- a stream, WebSocket or AG-UI run ends with an error chunk that carries the same text

**Cause**

In production, `runs.timeout` is 300 seconds when you do not set it. Development has no limit.

**Fix**

- set a larger number in `10xgraph.json`, for example `"runs": {"timeout": 900}`
- or set `"timeout": null` to remove the limit

### Issue: port already in use

**Symptoms**

- startup fails with address already in use

**Cause**

- another process already listens on the chosen port

**Fix**

- change the port with `--port 8001`
- stop the conflicting process: `lsof -i :8000 | tail -1 | awk '{print $2}' | xargs kill`

### Issue: auto-reload causes unstable behavior

**Symptoms**

- repeated restarts
- duplicate workers
- unstable behavior in Docker or remote filesystems

**Cause**

- reload watcher is not appropriate for that environment

**Fix**

```bash
10xgraph dev --no-reload
```

Use reload only for active local development.

## Request-time issues

### Issue: `/ping` works but graph routes fail

This is the most common request-time symptom: the server is up, but the graph fails when it runs. The production entry "deployment starts but requests fail immediately" below covers the deploy-specific causes.

**Symptoms**

- health check succeeds
- `/v1/graph/invoke` returns 500 or import-related errors

**Likely cause**

- the server itself started, but graph dependencies fail when invoked (bad provider keys, network issues with external services, tool initialization errors)

**Fix**

- inspect runtime logs: the error appears there
- verify graph dependencies, provider keys, and tool integrations work outside the server
- test with a minimal invoke payload (e.g., no tools)

### Issue: `403 Missing required scope: <resource>:<action>`

**Symptoms**

- an authenticated user is rejected on a specific endpoint while others work

**Cause**

The identity carries a scope list that does not include this endpoint's `"<resource>:<action>"` pair. Scopes resolve from the authorization backend's `scopes_for` method first, and only fall back to the token's own `scopes` claim when that returns `None`.

A common case: switching to the RBAC backend. `RoleBasedAuthorizationBackend` always returns a list (never `None`), so a user whose role is absent from the `roles` table and for whom `default_scopes` is empty resolves to `[]` and is denied everything. An empty list is not the same as no scopes.

**Fix**

- Add the pair to the role's scopes in your authorization backend, or to `default_scopes`
- Confirm the user's `roles` or `role` claim matches a key in the `roles` table
- To go back to unrestricted, ensure `scopes_for` returns `None` rather than `[]`

### Issue: requests are unexpectedly public

**Symptoms**

- protected routes work without credentials

**Cause**

- auth is disabled in `10xgraph.json` or config change did not reload into the running process

**Fix**

- set `auth` in `10xgraph.json` (for example `"auth": "jwt"`)
- set `JWT_SECRET_KEY` in your environment
- restart the server
- verify with an unauthenticated curl request: `curl -v http://localhost:8000/v1/graph/invoke 2>&1 | grep 401`

### Issue: WebSocket closes immediately

**Symptoms**

- the socket opens and closes before any application frame is exchanged

**Cause and fix by close code**

| Code | Cause | Fix |
| --- | --- | --- |
| `1008` | Auth or authorization rejected at the handshake, or the wrong socket for the graph type | Check the token transport; browsers should offer `["10xgraph-bearer", token]` as the subprotocol. Call `GET /v1/graph` and read `info.is_realtime` to pick between `/v1/graph/ws` (turn-based) and `/v1/graph/live` (realtime). |
| `1013` | The global rate limit or `websocket.max_connections` was exceeded | Handshakes share the REST rate-limit bucket. Raise the limit, increase `max_connections`, or back off and retry. |
| `1003` | Invalid init frame on `/v1/graph/live`: not JSON, or JSON that is not an object | Send the init control frame as a JSON object first, before any audio |
| `1011` | Unexpected server error during the session | Check server logs; this is not an auth or config rejection |

A `404` on `POST /v1/ag-ui` means `ag_ui.enabled` is not `true` in `10xgraph.json`. The threads, store, and files routers are always mounted.

A `1008` accompanied by an `error` event with `code: "not_live"` or `"not_authorized"` tells you which of the two `1008` causes applies.

### Issue: `429 Too Many Requests`

**Symptoms**

- requests fail with status `429` after a burst of calls
- the body has `error.code` `RATE_LIMIT_EXCEEDED` and the message ends with `Retry after <n>s.`, or the message says there are too many runs in progress for this user

**Cause**

Two different limits answer 429:

- the `rate_limit` window: the response carries `Retry-After` (seconds) and `X-RateLimit-*` headers. Behind a reverse proxy, every client may share one bucket if `trusted_proxies` is not set (see the `X-Forwarded-For` entry below)
- the per-user run cap `runs.max_concurrent_per_user` (default 10): one verified user already has that many invoke, stream or AG-UI runs in flight. The body is the standard error envelope with code `HTTPException` and there is no `Retry-After` header

**Fix**

- wait for the `Retry-After` interval, or for a running request to finish, then retry
- raise `rate_limit.requests` or `runs.max_concurrent_per_user` in `10xgraph.json` if the traffic is legitimate
- set `trusted_proxies` when the server sits behind a proxy
- on the TypeScript client this is a plain `TenxGraphError` with `statusCode` 429; see [Error handling](/docs/client/error-handling#rate-limits-429)

### Issue: the error message is generic in production

**Symptoms**

- a 5xx response says "An error occurred processing your request." or "An error occurred executing the graph." instead of the real cause
- the same request shows the real exception text locally

**Cause**

With `MODE=production` the server replaces the message of every 5xx error with a generic one, because exception text can contain internals. The full error is written to the server log with the request id. Messages of 4xx `HTTPException` errors (401, 403, 404, 413, 429) are written for the client and are kept. Request validation errors (422) use the generic text "The request data is invalid. Please check your input." in production, except size-limit messages, which are kept. `execution_meta.internal_data.error` in `GET /v1/threads/{id}/state` also carries the generic text in production (this and the `WARNING` logging below are in the API changelog under Unreleased, after 0.9.0).

**Fix**

- take the `request_id` from the response metadata and search the server log for it
- reproduce in development (`MODE=development`) to see the raw message
- handled 4xx errors are logged at `WARNING` (one line, no traceback), not `ERROR`. If an alert rule matched `ERROR` for 401 or 404 responses, change it to match `WARNING`

### Issue: thread endpoints fail

**Symptoms**

- `/v1/threads` returns errors or empty results unexpectedly

**Likely causes**

- no checkpointer configured (the thread routes answer `503` with `Checkpointer is not configured`)
- checkpointer backend unavailable (Postgres, Redis, or SQLite)
- inconsistent `thread_id` usage
- a `thread_id` that does not exist, which answers `403` by default (`runs.thread_ids` is `server`)
- a state update whose `context` is not a list of messages, or that sets built-in fields or keys outside `runs.state_keys`, which answers `422`
- a message id that is not in the thread, which answers `404` (`Message not found`)

**Fix**

- pass a checkpointer to `graph.compile(checkpointer=...)`. The server uses that one; a `checkpointer` key in `10xgraph.json` is not read
- verify backend connectivity and health
- use the `thread_id` the server returned on the first call (do not generate a new one per request, and do not make one up: the server refuses ids it did not create)

For more details, see [Checkpointing and threads](/docs/concepts/checkpointing-and-threads).

## Production and deployment issues

### Issue: deployment starts but requests fail immediately

**Symptoms**

- `/ping` works but graph routes fail
- first invoke request returns 500
- logs mention import or dependency errors

**Likely causes**

- graph import path is wrong in `10xgraph.json`
- environment variables required by the graph are missing
- production image does not include all dependencies

**Fix**

- verify the graph import works: `python -c "from graph.react import app; print(app)"`
- verify all deploy-time secrets and API keys are present
- verify the image or runtime installed all required Python packages (including provider extras like `google-genai`)

### Issue: threads vanish after restart

**Symptoms**

- conversation history works until the process restarts
- `/v1/threads` becomes empty after deployment recycle

**Likely cause**

- `InMemoryCheckpointer` is still being used

**Fix**

- switch to a durable shared checkpointer such as `PgCheckpointer`
- verify restart behavior before re-releasing

### Issue: one replica sees thread history and another does not

**Symptoms**

- state appears inconsistent across instances
- one request remembers context, the next does not

**Likely cause**

- instances are not sharing the same persistence backend

**Fix**

- point all replicas to the same Postgres/Redis-backed checkpointer
- confirm the same `thread_id` is being used by the caller
- verify the backend (Postgres, Redis) is reachable from all replicas

### Issue: auth works in curl but fails in browser clients

**Symptoms**

- curl with bearer token succeeds: `curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/v1/graph/invoke`
- frontend requests fail or never send credentials

**Likely causes**

- browser client is not attaching the auth header
- reverse proxy strips or corrupts the `Authorization` header
- CORS configuration blocks browser requests

**Fix**

- inspect the browser network tab to confirm the header is sent
- verify frontend client config (token is set correctly)
- verify reverse proxy configuration forwards `Authorization` header unchanged
- verify `ORIGINS` includes the real frontend origin
- confirm `CORS_ALLOW_CREDENTIALS=true` if the frontend sends credentials

### Issue: `X-Forwarded-For` is ignored behind a proxy

**Symptoms**

- rate limiting sees the proxy's IP instead of the client's
- requests through a reverse proxy are affected

**Cause**

Rate limiting ignores `X-Forwarded-For` unless you opt in. `rate_limit.trusted_proxy_headers` defaults to `false`, so behind a proxy every client appears to share the proxy's IP.

**Fix**

Enable the option in `10xgraph.json` only when the app sits behind a proxy you control, and list the proxy networks so direct clients cannot spoof the header:

```json
{
  "rate_limit": {
    "trusted_proxy_headers": true,
    "trusted_proxy_hops": 1,
    "trusted_proxies": ["10.0.0.0/8"]
  }
}
```

`trusted_proxies` takes the IPs or CIDR ranges the proxy connects from. `X-Forwarded-For` is ignored for any other source. See [Configure the server](/docs/server/configure) for the full `rate_limit` block.

### Issue: requests time out only in production

**Symptoms**

- local requests are fine
- deployed requests are slow or timing out

**Likely causes**

- external tools or providers are slower in the deployed environment
- reverse proxy timeouts are too aggressive
- graph is making too many sequential tool calls

**Fix**

- inspect server logs for slow nodes or tools
- tune reverse proxy timeout settings (for example Nginx `proxy_connect_timeout`, `proxy_send_timeout`, `proxy_read_timeout`)
- prefer streaming where appropriate
- reduce expensive tool-call chains if possible

### Issue: production deployment exposes too much

**Symptoms**

- the Swagger and ReDoc pages (default paths `/docs` and `/redocs`) are publicly reachable
- cross-origin browser access is broader than intended

**Likely causes**

- `DOCS_PATH` or `REDOCS_PATH` set explicitly (in production they default to empty, which disables the pages and the OpenAPI schema; the server logs a warning when either is set)
- `MODE` is not `production`, so the development defaults apply
- `ORIGINS=*` still set (production refuses it unless `STRICT_PRODUCTION_CHECKS=false`)

**Fix**

- set `MODE=production` and remove explicit `DOCS_PATH` and `REDOCS_PATH` values, or set both to empty strings
- replace wildcard origins with explicit domains: `ORIGINS=https://yourapp.com,https://api.yourapp.com`

### Issue: `10xgraph dev` works locally but deployed users cannot connect

**Symptoms**

- local playground sessions are fine
- deployed frontend or shared users fail to connect reliably

**Likely cause**

- `10xgraph dev` was used as a testing tool, but the deployed system needs a proper hosted API endpoint and browser-safe networking setup

**Fix**

- deploy the image from `10xgraph build`, which runs Gunicorn, behind HTTPS and with correct CORS and auth settings
- treat `10xgraph dev` (a Uvicorn development server with reload) as an interactive test path, not the deployment architecture. `10xgraph api` and `10xgraph play` no longer exist (removed in 0.9.0)

## Error codes

For a complete list of error codes and their meanings, see [Error codes reference](/docs/reference/error-codes).

## Related docs

- [Run the API Server](/docs/server/run-the-server)
- [Configure the server](/docs/server/configure)
- [Auth and Authorization](/docs/server/auth)
- [Observability and logging](/docs/server/observability)
- [Checkpointing and threads](/docs/concepts/checkpointing-and-threads)

## What you learned

- How to separate startup failures from request-time failures
- How to trace common API issues back to config, reload mode, auth, or persistence
- How to troubleshoot production failures by isolating runtime, config, network, auth, and persistence layers
