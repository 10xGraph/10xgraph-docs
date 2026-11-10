---
title: Authentication
seoTitle: "API server authentication and authorization"
description: Configure JWT, custom BaseAuth classes, roles, permissions and reach for the 10xGraph API server.
section: Reference
group: "CLI and configuration"
order: 440
label: Authentication
updated: "2026-11-10"
---

By default, the 10xGraph API accepts all requests without authentication (suitable for local development). For production, set the `auth` key to JWT or to a custom `BaseAuth` class to verify identity, and add roles to control what each user may do and how far their data reaches. This page is the reference. For a guided walk-through and the migration from the removed `authorization` key, see [Set up API authentication](/docs/server/auth).

## No authentication (default)

```json
{
  "agent": "graph.react:app",
  "auth": null
}
```

All endpoints are publicly accessible, no thread has an owner, and `GET /v1/me` answers `{"auth": "off"}`. Only use this locally or behind a secure gateway. `"auth": {"method": "none"}` is the same. RBAC keys with auth off refuse to boot.

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

Other claims (`roles`, `scopes`, `email`, custom fields) are kept in `identity.claims`. The claims named in `auth.roles_claim`, `auth.permissions_claim` and `auth.tenant_claims` also drive permissions, reach and tenant values.

Two claims are also read by the server:

- `scope` (a space-separated string, as in OAuth) and `scopes` (a list of strings, or a space-separated string). Both only **narrow** the permissions the roles grant: the effective set is the granted set intersected with the permission-shaped entries (`*` or anything containing `:`). A scope matches by exact name or wildcard. Plain OAuth scopes such as `openid profile` are ignored, so they do not narrow. A token with no permission-shaped scope is not narrowed. A scope claim of the wrong type (a number, an object, or a list that holds non-strings) is rejected with 401.
- `jti`, the token ID. When `cache_store.token_revocation` is on in `10xgraph.json`, a revoked `jti` is refused. The check runs even when `user_id` is missing or unusual. See [Token revocation](#token-revocation).

### Rotating the signing key

Set `JWT_SECRET_KEYS` to a JSON list so tokens signed with an old key keep working while new tokens use a new one. Each entry is an object with a `key` and an optional `kid`, or a plain string (a key with no `kid`). `JWT_SECRET_KEY` keeps working unchanged and is tried too.

```bash
JWT_SECRET_KEY=the-new-secret
JWT_SECRET_KEYS='[{"kid": "2026-09", "key": "the-old-secret"}, "an-older-secret-without-kid"]'
```

A token whose header names a `kid` is checked against the keys with that `kid`, then the keys without one. A token with no `kid` is tried against every key. The first key that verifies wins. Remove an old key from the list once its tokens have expired.

### Limiting token age

Set `JWT_MAX_TOKEN_AGE_SECONDS` to refuse tokens older than that many seconds, counted from the `iat` claim, even when `exp` is far away. A token with no `iat` is refused. Both settings are off by default.

### Status codes for JWT failures

| Status | `error_code` | Cause |
|---|---|---|
| 401 | `REVOKED_TOKEN` | No credential was presented (missing Authorization header, missing WebSocket auth, missing query param) |
| 401 | `EXPIRED_TOKEN` | Token `exp` is in the past, or the token is older than `JWT_MAX_TOKEN_AGE_SECONDS` by its `iat` |
| 401 | `INVALID_TOKEN` | Signature or structure is invalid, `user_id` is missing or malformed, or a `scope` or `scopes` claim has the wrong type |
| 401 | (message "Invalid token, please login again") | A configured `tenant_claims` claim is missing, or the roles or permissions claim is malformed |
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

The older sentinel `agentflow-bearer` is still accepted until 2.0, and the server echoes whichever one you send. The TypeScript client sends `10xgraph-bearer`.

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

The `path` accepts four forms: `auth_app:Cls` (a top-level module in the project folder), `auth_app.py:Cls`, `pkg.mod:Cls` (a dotted package path) and `pkg/mod.py:Cls` (a file path). A path that does not exist raises an error naming it.

Subclass `BaseAuth` and implement `authenticate`. The method is **synchronous** and receives the request, response, and credential:

```python
from typing import Any
from fastapi import HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials
from tenxgraph_api import BaseAuth

class MyAuthBackend(BaseAuth):
    def authenticate(
        self,
        request: Request,  # Request or WebSocket (HTTPConnection)
        response: Response,
        credential: HTTPAuthorizationCredentials | None,  # bearer token or None
    ) -> dict[str, Any] | None:
        """Return the verified claims, or raise to reject.

        - Return a dict with at least 'user_id' to authenticate.
        - Returning None or {} answers 401 "Authentication required".
        - Raise UserAccountError (401) or HTTPException (your status) to reject.
        - On WebSocket: either becomes a clean 1008 close.
        """
        if credential is None:
            raise HTTPException(status_code=401, detail="Missing credentials")
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

## Authorization (roles, permissions, reach)

Authorization decides what an authenticated user may do and whose data they can see. It sits under the same `auth` key as authentication. The top-level `authorization` key and `AuthorizationBackend` are removed: a leftover `authorization` key stops the server at boot.

### The `auth` object

```json
{
  "auth": {
    "method": "jwt",
    "path": null,
    "roles_claim": "roles",
    "permissions_claim": null,
    "tenant_claims": ["org_id"],
    "roles": {
      "member": {"permissions": ["graph:*", "threads:*", "store:*", "files:*"], "reach": "own"},
      "org_admin": {"inherits": ["member"], "permissions": ["admin:read"], "reach": "tenant"}
    },
    "default_role": "member",
    "system_identities": {"nightly": {"roles": ["member"], "tenant": {"org_id": "acme"}}}
  }
}
```

| Key | Type | Meaning |
|---|---|---|
| `method` | `none` \| `jwt` \| `custom` | Which class verifies the credential. Default `none`. `null` and `"jwt"` are accepted as shortcuts. |
| `path` | string | `"module:Class"` of a `BaseAuth` subclass. Only with `custom`, and required there. |
| `roles` | object | Role name to `{permissions, inherits, reach}`. `reach` is required, `permissions` and `inherits` are lists. |
| `roles_claim` | string | Claim holding the caller's role names (list or space-separated string). Defaults to `roles` when `roles` is set. Refused without `roles`. |
| `permissions_claim` | string | Claim holding permissions directly. Cannot be combined with `roles`. A missing claim gives no permissions. |
| `tenant_claims` | list of strings | Claims that name the caller's tenant. Each must be a non-empty string or whole number on every token, else 401. |
| `default_role` | string | Role for a token with no roles claim. Must be in `roles`. |
| `system_identities` | object | Name to `{roles, tenant}`, for background tasks. |

With no RBAC keys, every authenticated user gets the default permission set (every permission except `admin:*`) and reach `own`.

### Permissions

Permissions are `resource:action` from one registry. A role naming anything else refuses to boot. `resource:*` and `*` are wildcards.

| Resource | Actions |
|---|---|
| `graph` | `read`, `invoke`, `stream`, `stop`, `fix` |
| `threads` | `read`, `write`, `delete` |
| `store` | `read`, `write`, `delete` |
| `files` | `read`, `upload`, `delete` |
| `config` | `read` |
| `tasks` | `trigger`, `read`, `cancel` |
| `admin` | `read`, `write` |

The route guards:

| Routes | Permission |
|---|---|
| `POST /v1/graph/invoke` | `graph:invoke` |
| `POST /v1/graph/stream`, `/v1/graph/ws`, `/v1/graph/live`, `POST /v1/ag-ui` | `graph:stream` |
| `GET /v1/graph`, `GET /v1/graph/tools`, `GET /v1/graph:StateSchema`, `GET /v1/observability/{thread_id}` | `graph:read` |
| `POST /v1/graph/stop` | `graph:stop` |
| `POST /v1/graph/fix` | `graph:fix` |
| Thread, state and message reads | `threads:read` |
| Thread state and message writes | `threads:write` |
| Thread, state and message deletes | `threads:delete` |
| Store search, get and list | `store:read` |
| Store create and update | `store:write` |
| Store delete and forget | `store:delete` |
| File downloads, info, urls and list | `files:read` |
| File upload | `files:upload` |
| File delete | `files:delete` |
| Server config read | `config:read` |
| `POST /v1/tasks/{name}`, `PATCH /v1/tasks/{schedule_id}` | `tasks:trigger` |
| `GET /v1/tasks/{id}` | `tasks:read` |
| `POST /v1/tasks/{id}/cancel` | `tasks:cancel` |
| `GET /v1/me` | Authentication only |

A refusal answers 403 `Missing required permission: <resource>:<action>`. A permission the registry does not know raises at import, not on the first request.

### Reach

| Reach | Rows a caller's queries match |
|---|---|
| `own` | This `user_id`, within their tenant values |
| `tenant` | Any user, with the caller's tenant values. Needs `tenant_claims` and tenant columns on the checkpointer |
| `all` | No filter |

A caller with several roles gets the union of their permissions and the widest reach. Reach widens reads, lists, deletes and stop only. Runs and state or message writes always stay `own`. A thread, message, memory, file or run outside the caller's reach answers 404. Token claims cannot name a reach.

### Resolving a token

1. `authenticate` returns claims with a `user_id` (a string, or a whole number stored as a string).
2. Tenant values are read from each `tenant_claims` claim.
3. With `roles`, the roles come from `roles_claim` (names not in `roles` are ignored), or from `default_role` when the claim is absent. With `permissions_claim`, the permissions come from that claim. Otherwise the default set applies.
4. Token `scope` and `scopes` narrow the result.
5. A `__system__` user id is refused (401). A revoked token is refused (401).

The result is an `Identity` (`user_id`, `kind`, `tenant`, `roles`, `permissions`, `reach`, `claims`), stored as `config["user"]`.

### `GET /v1/me`

Returns the resolved caller. Needs only authentication.

```json
{"data": {"user_id": "u-42", "tenant": {"org_id": "acme"}, "roles": ["member"], "permissions": ["graph:invoke", "graph:stream"], "reach": "own"}}
```

An identity with no permission restriction reports `["*"]`. With auth off the answer is `{"auth": "off"}`.

### Token revocation

Revoke a token (by `jti`) or all of a user's tokens with `10xgraph revoke`. The revocations live in the API's cache store, so with Redis they reach every worker at once and the server needs no restart. Turn the check on inside `cache_store` in `10xgraph.json`. It needs `auth` and a cache store the server can reach; with `token_revocation` on, an unreachable cache store stops the boot:

```json
{
  "auth": "jwt",
  "cache_store": {"type": "redis", "token_revocation": true}
}
```

`cache_store.token_revocation` is `true`, `false`, or an object: `{"enabled": true, "token_lifetime": <seconds>, "user_ttl": <seconds>}`. `user_ttl` is how long a per-user cutoff is kept and defaults to 30 days; `null` keeps entries forever. A string value is a config error.

Revocation fails closed: if the cache store raises an error, requests that need the check answer `503`. With an in-memory cache store in production, or `WEB_CONCURRENCY` above 1, the server warns that revocations only reach this process; set `cache_store.type` to `redis` (or a shared custom store).

### `BaseAuth.authorize`

```python
from tenxgraph_api import BaseAuth

class MyAuth(BaseAuth):
    def authenticate(self, request, response, credential): ...

    async def authorize(self, identity, permission, resource=None) -> bool:
        """True to allow, False for 403."""
        return await super().authorize(identity, permission, resource)
```

- The default returns `identity.can(permission)`.
- `permission` is `resource:action`. `resource` is the thread id, memory id, namespace or file id from the path or the JSON body, the task name for a background task, or `None`.
- It takes no request, so the jobs worker calls it too (`tasks:trigger`).
- If you override it and `roles` is set, the roles apply only when you call `super().authorize`. Boot warns about it.
- An exception fails the request; it never counts as allowed.

### Boot-time checks

The same validator runs at boot, `10xgraph config`, `10xgraph audit` and `10xgraph build`.

| Setup | Result |
|---|---|
| RBAC key with `auth` off | Refused |
| Top-level `authorization` or `graph_introspection` key | Refused |
| `custom` without a valid `path`, or `path` with another method | Refused |
| `permissions_claim` with `roles` or `roles_claim` | Refused |
| `roles_claim` without `roles` | Refused |
| `default_role`, `inherits` or a system identity role naming an unknown role | Refused |
| Inheritance cycle, unknown permission, missing or unknown `reach` | Refused |
| Role with reach `tenant` and no `tenant_claims` | Refused |
| `tenant_claims` and checkpointer or store tenant columns differ | Refused in production, warning otherwise |
| `authorize` overridden with `roles` set | Warning |
| Role with reach `all` | Warning listing the roles |
| `MODE=production` with auth off | Warning |

### Ownership and data isolation

Storage enforces ownership. Every checkpointer, store and file query filters by the caller's reach, so no ownership cache or resolver exists. Each thread route makes one scoped read before the run lock, which gives the 404 and enforces `runs.thread_ids`. See [Multi-tenant data](/docs/guides/multi-tenant-data).

## Boot-time route guard

Authorization is applied per handler with `Depends(RequirePermission(resource, action))`. `RequireIdentity()` authenticates without a permission check; `GET /v1/me` uses it. To prevent forgotten guards from shipping open endpoints, `assert_all_routes_protected` runs at startup and walks every `APIRoute` and `APIWebSocketRoute` to check that the entire dependency subtree includes a `RequirePermission` instance.

If any non-public route lacks one, the server refuses to start:

```
RuntimeError: Refusing to start: the following routes are not protected by RequirePermission.
Add the dependency, or add the path to the public allowlist if it is intentionally open:
  - POST /v1/my-new-endpoint
```

The check is free per request. Starlette infrastructure routes (`/docs`, `/redocs`, `/openapi.json`) are not `APIRoute`s and are skipped automatically.

### Public paths

Only these paths are publicly accessible:

| Path | Purpose |
|---|---|
| `/ping` | Health check (for load balancers and orchestrators) |
| `/health/ready` | Readiness check |


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
