---
title: Authentication
seoTitle: "API server authentication and authorization"
description: Configure JWT, custom auth backends, and authorization for the 10xGraph API server.
section: Reference
group: "CLI and configuration"
order: 440
label: Authentication
updated: "2026-10-27"
---

By default, the 10xGraph API accepts all requests without authentication (suitable for local development). For production, configure either JWT or a custom `BaseAuth` backend to verify identity, and optionally set authorization rules via `AuthorizationBackend` to control what authenticated users may do.

## No authentication (default)

```json
{
  "agent": "graph.react:app",
  "auth": null
}
```

All endpoints are publicly accessible. Only use this locally or behind a secure gateway.

## JWT authentication

Set `auth` to `"jwt"` in `10xgraph.json`:

```json
{
  "agent": "graph.react:app",
  "auth": "jwt"
}
```

Install the JWT extra:

```bash
pip install "10xgraph-api[jwt]"
```

Set the required environment variables:

```bash
JWT_SECRET_KEY=your-secret-key
JWT_ALGORITHM=HS256
```

Both are validated at startup. Missing either one raises `ValueError` and the server does not start.

### Using JWT

Send a Bearer token in the `Authorization` header:

```bash
curl -X POST http://127.0.0.1:8000/v1/graph/invoke \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1..." \
  -H "Content-Type: application/json" \
  -d '{"messages": [...]}'
```

The server decodes and validates the JWT on every request. The decoded payload becomes the `user` context, available to your graph as `config["user"]`.

### Required JWT claims

The built-in backend requires:

| Claim | Notes |
|---|---|
| `exp` | Expiry time, required. No token is treated as permanently valid; a missing `exp` is rejected with 401. |
| `user_id` | Identity key. The `sub` claim is not accepted; you must use `user_id`. It must be a non-empty string or a whole number (not a boolean). A number is stored as a string. Anything else, such as an empty or whitespace-only string, a boolean, a float, a list or an object, is rejected with 401. |

If `JWT_ISSUER` or `JWT_AUDIENCE` is set, the matching `iss` or `aud` claim is also required.

Other claims (`roles`, `scopes`, `email`, custom fields) are passed through to `config["user"]` unchanged.

Two claims are also read by the server:

- `scope` (a space-separated string, as in OAuth) and `scopes` (a list of strings, or a space-separated string). Both are merged into one set of scope names, and a scope matches only by its exact name. `graph:invoke_admin` does not grant `graph:invoke`. A token with neither claim is not scope-restricted. A token with `scope` set to an empty string is restricted to no scopes at all. A scope claim of the wrong type (a number, an object, or a list that holds non-strings) is rejected with 401.
- `jti`, the token ID. When `token_revocation` is set in `10xgraph.json`, a revoked `jti` is refused. The check runs even when `user_id` is missing or unusual.

### Status codes for JWT failures

| Status | `error_code` | Cause |
|---|---|---|
| 401 | `REVOKED_TOKEN` | No credential was presented (missing Authorization header, missing WebSocket auth, missing query param) |
| 401 | `EXPIRED_TOKEN` | Token `exp` is in the past |
| 401 | `INVALID_TOKEN` | Signature or structure is invalid, `user_id` is missing or malformed, or a `scope` or `scopes` claim has the wrong type |
| 500 | `JWT_SETTINGS_NOT_CONFIGURED` | `JWT_SECRET_KEY` or `JWT_ALGORITHM` is unset at request time |

On WebSocket routes, errors become a clean close with code 1008 instead of an HTTP response.

### Generating test tokens

10xGraph does not issue tokens; use your identity provider or mint one locally for testing:

```python
import datetime
import jwt  # PyJWT, installed by the [jwt] extra

token = jwt.encode(
    {
        "user_id": "user-123",
        "exp": datetime.datetime.now(datetime.UTC) + datetime.timedelta(hours=1),
        "roles": ["member"],
    },
    key="your-secret-key",
    algorithm="HS256",
)
```

A token using `sub` instead of `user_id` is rejected with 401. A token with no `exp` is also rejected with 401.

## Sending auth over WebSocket

WebSocket routes check three places in order for a credential:

1. **`Authorization: Bearer <token>`**: for non-browser clients.
2. **`Sec-WebSocket-Protocol: 10xgraph-bearer, <token>`**: preferred for browsers (the token stays in headers, never in URLs or logs). The server echoes the sentinel back on accept, which browsers require.
3. **`?token=<jwt>`**: last resort for WebSocket only; the token appears in URLs and access logs.

HTTP routes read the `Authorization` header only. The subprotocol and the `?token=` parameter are honoured on WebSocket connections and nowhere else.

Example:

```javascript
const ws = new WebSocket(
  "ws://localhost:8000/v1/graph/ws",
  ["10xgraph-bearer", token],  // sentinel, then raw JWT
);
```

The subprotocol offer must be exactly two entries with the sentinel first. Anything else falls through to the query parameter.

The older sentinel `agentflow-bearer` is still accepted until 2.0, and the server echoes whichever one you send. The TypeScript client still sends `agentflow-bearer`.

## Custom authentication backend

Provide your own `BaseAuth` subclass when you need integration with an internal identity system:

```json
{
  "agent": "graph.react:app",
  "auth": {
    "method": "custom",
    "path": "graph.auth:MyAuthBackend"
  }
}
```

Subclass `BaseAuth` and implement `authenticate`. The method is **synchronous** and receives the request, response, and credential:

```python
from typing import Any
from fastapi import Request, Response
from fastapi.security import HTTPAuthorizationCredentials
from tenxgraph_api import BaseAuth

class MyAuthBackend(BaseAuth):
    def authenticate(
        self,
        request: Request,  # Request or WebSocket (HTTPConnection)
        response: Response,
        credential: HTTPAuthorizationCredentials | None,  # bearer token or None
    ) -> dict[str, Any] | None:
        """Return user context dict, None for anonymous, or raise to reject.
        
        - Return dict (with at least 'user_id') to authenticate.
        - Return None/{} for anonymous requests.
        - Raise UserAccountError (401) or HTTPException (your status) to reject.
        - On WebSocket: either becomes a clean 1008 close.
        """
        if credential is None:
            return None
        claims = my_identity_service.verify(credential.credentials)
        return {
            "user_id": claims["sub"],
            "email": claims.get("email"),
            "roles": claims.get("roles", []),
            "scopes": claims.get("scopes", []),
        }
```

<aside class="callout callout-warning" role="note"><p class="callout-title">`authenticate` must be synchronous</p>

The server calls `authenticate(...)` without `await`. If you declare it `async def`, you return an un-awaited coroutine and auth fails silently. Keep it a plain `def`. For non-Bearer schemes (API keys, cookies), ignore `credential` and read `request.headers` directly.

</aside>

## Authorization (access control)

Authorization decides what an authenticated user may do and whose data they can access. It is configured separately from `auth`, via the `authorization` key in `10xgraph.json`.

### Built-in backends

Two backends ship built in; choose one or write your own:

| Value | Behavior |
|---|---|
| `"ownership"` | Owner-only threads: a thread is readable, runnable, stoppable, fixable, and deletable **only by the user who created it**. A request for another user's thread is rejected with 403 before it reaches the graph. With the default `runs.thread_ids` of `server`, a request that names a thread that does not exist is rejected the same way. |
| `"allow_all"` (also `"default"`, `"none"`) | Any authenticated user may do anything. |
| `"module:attr"` | Your custom `AuthorizationBackend`. |
| `{ ... }` (object) | RBAC config block (see below). |
| `null` | **Default:** `"ownership"` whenever auth is configured or `MODE=production`; `"allow_all"` only with auth off in development. |

Example:

```json
{
  "agent": "graph.react:app",
  "auth": "jwt",
  "authorization": "ownership"
}
```

An unrecognized built-in name raises `ValueError` at startup. The classes are importable for subclassing or composition:

```python
from tenxgraph_api.src.app.core.auth.authorization import (
    AuthorizationBackend,             # abstract base
    DefaultAuthorizationBackend,      # "allow_all" / "default" / "none"
    OwnershipAuthorizationBackend,    # "ownership"
    RoleBasedAuthorizationBackend,    # RBAC config block
)
```

### Ownership model

`OwnershipAuthorizationBackend` checks ownership only for thread-scoped resources: `graph` and `checkpointer`. The `store`, `files`, and `config` resources enforce their own per-user scoping.

Decision table:

| Situation | Decision |
|---|---|
| No `user_id` on request | Deny |
| No `resource_id` (list/create endpoints, e.g., `GET /v1/threads`) | Allow (already user-scoped by the service) |
| Thread does not exist | Allow (new session; `invoke`/`stream` will create it owned by the caller) |
| Thread exists and caller owns it | Allow |
| Thread exists and someone else owns it | **Deny**, including on `invoke` and `stream` |
| Checkpointer cannot resolve ownership (`aget_thread_owner` not implemented) | Allow with warning |
| Ownership lookup fails | **Deny** (failures never grant access) |

<aside class="callout callout-note" role="note"><p class="callout-title">Ownership requires a checkpointer that tracks owners</p>

Ownership comes from `BaseCheckpointer.aget_thread_owner`. `PgCheckpointer`, SQLite, and the in-memory checkpointer implement it; the base class raises `NotImplementedError`. With no checkpointer configured, requests pass through with a warning. The in-memory checkpointer records owners only when explicitly writing a thread, so ownership is the production default (with Postgres) but development defaults to `DefaultAuthorizationBackend`.

</aside>

### Ownership caching

Ownership is immutable, so it is cached by `ThreadOwnershipResolver` for scalability:

| Tier | Details |
|---|---|
| L1 | In-process LRU: 10,000 entries per worker, no expiry |
| L2 | Optional shared Redis client (key prefix `af:authz:owner`, no expiry since ownership never changes; Redis errors degrade to database lookup and never fail the request) |

Negative results are not cached (a missing thread could be created by a later request). The L2 tier is wired from `redis` in `10xgraph.json`, falling back to `REDIS_URL`. When neither is set or the `redis` package is not installed, L1 only is used and a warning is logged at startup.

Cache eviction happens on thread delete via `CheckpointerService.delete_thread`. A custom caching backend should implement `evict(thread_id)` (returns the resolver's `evict` coroutine or `None`) and `aclose()` (closes any client on shutdown).

### Custom authorization backend

Subclass `AuthorizationBackend`. The `authorize` method is required; `isolation_scope` and `scopes_for` are optional:

```python
from typing import Any
from tenxgraph_api.src.app.core.auth.authorization import AuthorizationBackend

class MyAuthBackend(AuthorizationBackend):
    async def authorize(
        self,
        user: dict[str, Any],
        resource: str,  # "graph" | "checkpointer" | "store" | "files" | "config"
        action: str,    # "invoke" | "stream" | "read" | "write" | "delete" | ...
        resource_id: str | None = None,  # thread_id / memory_id when available
        **context: Any,
    ) -> bool:
        """Return True to allow, False to deny (403)."""
        if not user.get("user_id"):
            return False
        if resource == "store":
            return user.get("role") == "admin"
        return True

    def isolation_scope(self) -> str:
        """Storage partitioning: "owner" scopes rows to caller; "none" does not.
        Defaults to "owner". Return "none" only to share data between users.
        Stamped server-side into config["user"]["authz"]; the client cannot forge it.
        """
        return "owner"

    def scopes_for(self, user: dict[str, Any]) -> list[str] | None:
        """Scopes this identity carries, or None for unrestricted (default)."""
        return user.get("scopes")
```

`isolation_scope()` defaults to `"owner"`, so a backend that only implements `authorize` still gives each user their own threads and memories. To share data on purpose, return `"none"`. Before this default, a custom backend shared every thread and memory with every user.

Point `10xgraph.json` at it (no `method` wrapper, just the path):

```json
{ "authorization": "graph.auth:MyAuthBackend" }
```

### Resources and actions

The server passes `(resource, action)` pairs to `authorize`. The required **scope** for an endpoint is `"<resource>:<action>"`.

| Resource | Actions |
|---|---|
| `graph` | `invoke`, `stream`, `stop`, `fix`, `setup`, `read` |
| `checkpointer` | `read`, `write`, `delete` |
| `store` | `read`, `write`, `delete` |
| `files` | `upload`, `read` |
| `config` | `read` |

### Role-based access control (no code)

Use the RBAC config block instead of writing a backend to map roles to scopes. It loads `RoleBasedAuthorizationBackend`, which inherits owner-only isolation from `OwnershipAuthorizationBackend`:

```json
{
  "authorization": {
    "backend": "rbac",
    "roles": {
      "admin": ["*"],
      "member": ["graph:invoke", "graph:stream", "graph:read", "checkpointer:read"]
    },
    "default_scopes": ["graph:read"],
    "isolation": "owner"
  }
}
```

| Key | Alias | Meaning |
|---|---|---|
| `backend` | `type` | `"rbac"`, `"role_based"`, or `"roles"` (all select the same backend) |
| `roles` | `role_scopes` | Map role (from user's `roles` or `role` claim) to scopes. `"*"` grants all scopes. |
| `default_scopes` | none | Scopes for users with no role. Defaults to empty. |
| `isolation` | none | `"owner"` (owner-only, default) or `"none"` (all rows). Any other value falls back to `"owner"`. |

An unrecognized `backend`/`type` value raises `ValueError` at startup. The same backend is available in code:

```python
from tenxgraph_api.src.app.core.auth.authorization import RoleBasedAuthorizationBackend

backend = RoleBasedAuthorizationBackend(
    role_scopes={
        "admin": ["*"],
        "member": ["graph:invoke", "graph:stream", "checkpointer:read"],
    },
    default_scopes=["graph:read"],
    isolation="owner",
)
```

Point `10xgraph.json` at it with `"authorization": "module:backend"`. Subclass it when you need to compute roles at runtime: override `scopes_for`, and owner-only isolation still applies.

### Scope resolution

A request is allowed only if the identity's scopes include the endpoint's `"<resource>:<action>"`. Scopes are resolved in order:

1. `authz.scopes_for(user)` from your backend (if it defines the method).
2. The scope claims on the authenticated identity, `scope` and `scopes` (only if step 1 returns `None`).

A backend that returns a list wins outright; the identity's own `scopes` claim cannot widen it.

| Resolved value | Effect |
|---|---|
| `None` | **Unrestricted.** Scope check is skipped; nothing breaks until scopes are actually issued. |
| Non-empty list | Only listed `"<resource>:<action>"` pairs are allowed; anything else is 403. |
| Empty list (`[]`) | **Denies everything.** Not the same as `None`: no endpoint passes the check. |

The base `AuthorizationBackend.scopes_for` reads the `scope` claim (space-separated) and the `scopes` claim (a list or a space-separated string), merges them, and matches by exact name. It returns `None` when the identity has neither claim, which is why such an identity stays unrestricted. A claim of the wrong type gets 401. An empty `scope` claim resolves to an empty list, which denies everything.

After a successful check, the resolved list is stamped into `user["authz"]["scopes"]` server-side, so downstream code reads the trusted value.

### Data isolation contract

The API layer enforces object-level `authorize` and scope checks. The data layer (checkpointer, store) enforces isolation separately via a trusted policy stamped by the server after a successful check: `user["authz"] = {user_id, scope, scopes}`, where `scope` comes from `isolation_scope()`. Every service copies that trusted `user` into `config["user"]`, so the policy reaches the graph and cannot be forged by the client. With `scope: "owner"`, checkpointer and store queries are scoped to the caller; with `scope: "none"`, they are not.

## Boot-time route guard

Authorization is applied per handler with `Depends(RequirePermission(resource, action))`. To prevent forgotten guards from shipping open endpoints, `assert_all_routes_protected` runs at startup and walks every `APIRoute` and `APIWebSocketRoute` to check that the entire dependency subtree includes a `RequirePermission` instance.

If any non-public route lacks one, the server refuses to start:

```
RuntimeError: Refusing to start: the following routes are not protected by RequirePermission.
Add the dependency, or add the path to the public allowlist if it is intentionally open:
  - POST /v1/my-new-endpoint
```

The check is free per request. Starlette infrastructure routes (`/docs`, `/redoc`, `/openapi.json`) are not `APIRoute`s and are skipped automatically.

### Public paths

These three paths are publicly accessible:

| Path | Purpose |
|---|---|
| `/ping` | Health check (for load balancers and orchestrators) |
| `/v1/evals/runs` | Eval report viewer |
| `/v1/evals/runs/{run_id}` | Eval report viewer |

<aside class="callout callout-warning" role="note"><p class="callout-title">Eval endpoints are unauthenticated</p>

The eval routes read `eval_reports/*.json` from the server's working directory and serve it to anyone who reaches the port, regardless of your `auth` setting. They exist as a local report viewer. On a deployment reachable from a network you do not control, keep `eval_reports/` out of the working directory or block `/v1/evals/*` at your ingress. See [REST API: Evals](/docs/reference/rest-api/evals).

</aside>

Adding paths to the allowlist requires editing the source frozenset, which is deliberate: opening a route becomes a reviewable change.

## Using auth with the TypeScript client

```typescript
import { TenxGraphClient } from "10xgraph-client";

// authToken is sent as a Bearer token on every request
const client = new TenxGraphClient({
  baseUrl: "http://127.0.0.1:8000",
  authToken: token,
});
```

The token is fixed per client, so create a new client to rotate it. See [Create a client](/docs/client/create-client) for all options.
