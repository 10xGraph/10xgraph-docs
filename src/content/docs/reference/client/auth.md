---
title: Client authentication
seoTitle: "Client authentication in 10xGraph TypeScript SDK"
description: "Bearer, Basic, and header authentication options for the 10xGraph TypeScript client, with WebSocket auth details."
section: Reference
group: "TypeScript client"
order: 550
label: Auth
updated: "2026-10-08"
---

`TenxGraphClient` authenticates with a bearer token, HTTP Basic credentials or a custom header, set through the `auth` field of `TenxGraphConfig`. The `authToken` field is a shorthand for bearer tokens. This page lists each option, the header it sends, how HTTP and WebSocket requests resolve credentials, and common failures.

Source: `src/request.ts` and `src/ws.ts`.

---

## Import

```ts
import {
  TenxGraphClient,
  TenxGraphAuth,
  TenxGraphBearerAuth,
  TenxGraphBasicAuth,
  TenxGraphHeaderAuth,
  bearerAuth,
  basicAuth,
  headerAuth,
} from '10xgraph-client';
```

---

## `TenxGraphAuth` union type

```ts
type TenxGraphAuth =
  | TenxGraphBearerAuth
  | TenxGraphBasicAuth
  | TenxGraphHeaderAuth;
```

Pass a value of this type to `TenxGraphConfig.auth`. If both `authToken` and `auth` are set, `auth` takes precedence on HTTP requests.

The package also exports three small factory functions that return these objects:

| Function | Returns |
|---|---|
| `bearerAuth(token)` | `{ type: 'bearer', token }` |
| `basicAuth(username, password)` | `{ type: 'basic', username, password }` |
| `headerAuth(name, value, prefix?)` | `{ type: 'header', name, value, prefix }` |

```ts
// Equivalent to auth: { type: 'bearer', token: ... }
const client = new TenxGraphClient({
  baseUrl: 'http://localhost:8000',
  auth: bearerAuth(process.env.API_TOKEN!),
});
```

---

## Bearer token auth

### `TenxGraphBearerAuth`

```ts
interface TenxGraphBearerAuth {
  type: 'bearer';
  token: string;
}
```

Adds the header:

```
Authorization: Bearer <token>
```

This is the dominant auth method when the server is configured with `"auth": "jwt"` or a custom `BaseAuth` that reads the `Authorization: Bearer` header.

#### Example

```ts
const client = new TenxGraphClient({
  baseUrl: 'http://localhost:8000',
  auth: {
    type: 'bearer',
    token: process.env.API_TOKEN!,
  },
});
```

#### Shorthand

For bearer tokens you can also use the `authToken` convenience field:

```ts
const client = new TenxGraphClient({
  baseUrl: 'http://localhost:8000',
  authToken: process.env.API_TOKEN,
});
```

Both examples produce the same `Authorization` header. Use `auth: { type: 'bearer', token }` when you want to keep all auth logic in one place.

---

## Basic auth

### `TenxGraphBasicAuth`

```ts
interface TenxGraphBasicAuth {
  type: 'basic';
  username: string;
  password: string;
}
```

Adds the header:

```
Authorization: Basic <base64(username:password)>
```

The client encodes the credentials as UTF-8 base64, using `Buffer` when it exists and `btoa()` otherwise.

#### Example

```ts
const client = new TenxGraphClient({
  baseUrl: 'http://localhost:8000',
  auth: {
    type: 'basic',
    username: 'admin',
    password: process.env.ADMIN_PASSWORD!,
  },
});
```

<aside class="callout callout-warning" role="note"><p class="callout-title">Warning</p>

Basic auth sends credentials with every request. Always use HTTPS in production.

</aside>

---

## Custom header auth

### `TenxGraphHeaderAuth`

```ts
interface TenxGraphHeaderAuth {
  type: 'header';
  name: string;     // Header name, e.g. 'X-API-Key'
  value: string;    // Header value
  prefix?: string | null;  // Optional prefix prepended to the value, e.g. 'ApiKey'
}
```

Sends a custom header with the specified name and value. If `prefix` is set, the header value is `<prefix> <value>`.

#### Example: API key header

```ts
const client = new TenxGraphClient({
  baseUrl: 'http://localhost:8000',
  auth: {
    type: 'header',
    name: 'X-API-Key',
    value: process.env.API_KEY!,
  },
});
// Sends: X-API-Key: <API_KEY>
```

#### Example: with prefix

```ts
const client = new TenxGraphClient({
  baseUrl: 'http://localhost:8000',
  auth: {
    type: 'header',
    name: 'Authorization',
    value: process.env.API_KEY!,
    prefix: 'ApiKey',
  },
});
// Sends: Authorization: ApiKey <API_KEY>
```

---

## No auth

When the server is configured with `"auth": null` (no auth / open endpoint), omit `auth` and `authToken` entirely:

```ts
const client = new TenxGraphClient({
  baseUrl: 'http://localhost:8000',
  // No auth fields: appropriate for local development or
  // internal services behind a gateway
});
```

---

## Additional headers

All three auth strategies can be combined with `headers` for custom per-request headers such as tracing IDs or gateway credentials:

```ts
const client = new TenxGraphClient({
  baseUrl: 'http://localhost:8000',
  auth: { type: 'bearer', token: process.env.TOKEN! },
  headers: {
    'X-Request-Source': 'web-app',
    'X-Tenant-ID': 'tenant-abc',
  },
});
```

The `headers` map is merged with the auth header and any default headers on every request. Header names are compared case-insensitively. If a key in `headers` conflicts with a key set by `auth`, the `auth` value wins.

---

## Auth header precedence

For HTTP requests, `auth` always wins over `authToken`, and `authToken` never overwrites an `Authorization` header you set in `headers`. The table lists each combination.

| Config | Result |
|---|---|
| Only `authToken` | Sends `Authorization: Bearer <token>` |
| Only `auth` (bearer) | Sends `Authorization: Bearer <token>` |
| Both `authToken` and `auth` | `auth` wins; `authToken` is ignored |
| `headers['Authorization']` and `auth` | `auth` wins when it sets `Authorization` |
| `headers['Authorization']` and `authToken` only | The `headers` value is sent, `authToken` is ignored |
| `headers['Authorization']` and no auth fields | Custom header is sent |

<aside class="callout callout-note" role="note"><p class="callout-title">WebSocket routes use the same priority, bearer only</p>

`wsStream()` and `realtime()` resolve the token with `resolveBearerToken()` in `src/ws.ts`, which applies the same priority as HTTP: `auth` first, then `authToken`. If `auth` is set to `basic` or `header`, no bearer token is found and none is sent as a subprotocol.

Only bearer tokens reach a WebSocket in a browser, because browsers cannot attach headers to a WebSocket handshake. On Node, the resolved `Authorization` header (including Basic) is also passed. Use a bearer token if you need WebSocket streaming or realtime audio.

</aside>

---

## WebSocket authentication

Browsers cannot set request headers on a WebSocket, so the client sends the bearer token as a WebSocket subprotocol: the socket is opened with `['agentflow-bearer', '<token>']` and the server reads the second entry. The server accepts `agentflow-bearer` as a deprecated alias of `10xgraph-bearer`. The token is never placed in the URL. On Node runtimes whose `WebSocket` constructor accepts an options argument, an `Authorization: Bearer ...` header is passed as well.

`wsStream()` and `realtime()` do this for you. The pieces are also exported, for building your own socket against the same server:

| Export | Signature | Description |
|---|---|---|
| `WS_BEARER_SUBPROTOCOL` | `'agentflow-bearer'` | The subprotocol token the server recognises for bearer auth. |
| `resolveBearerToken` | `(context: { authToken?, auth? }) => string \| null` | Returns `auth.token` when `auth` is bearer, `null` when `auth` is another type, else `authToken`, else `null`. |
| `buildWsUrl` | `(context: { baseUrl }, path: string) => string` | Converts `http:` to `ws:` and `https:` to `wss:`, strips a trailing slash, and appends `path`. |
| `openWebSocket` | `(url: string, context: WsAuthContext) => WebSocket` | Opens the socket with the subprotocol pair, adding the `Authorization` header on Node. Throws `No WebSocket implementation available` when there is no global `WebSocket` and no `webSocketImpl`. |
| `WebSocketImpl` | `new (url, protocols?, options?) => WebSocket` | The constructor shape shared by the browser `WebSocket` and the Node `ws` package. This is the type of the `webSocketImpl` config field. |
| `WsAuthContext` | interface | The fields the helpers read: `baseUrl`, `authToken`, `auth`, `headers`, `credentials`, `debug`, `webSocketImpl`. |

```ts
import {
  buildWsUrl,
  openWebSocket,
  resolveBearerToken,
  WS_BEARER_SUBPROTOCOL,
} from '10xgraph-client';

const context = {
  baseUrl: 'https://api.10xgraph.com',
  authToken: process.env.API_TOKEN,
};

resolveBearerToken(context);                     // the token, or null
buildWsUrl(context, '/v1/graph/ws');             // 'wss://api.10xgraph.com/v1/graph/ws'

const socket = openWebSocket(buildWsUrl(context, '/v1/graph/ws'), context);
// equivalent to: new WebSocket(url, [WS_BEARER_SUBPROTOCOL, token])
```

If a reverse proxy in front of your API strips `Sec-WebSocket-Protocol`, the handshake arrives unauthenticated and is rejected. Configure the proxy to forward it.

---

## Matching client auth to server auth configuration

Use the following table to choose the right client-side auth type based on the `auth` field in `10xgraph.json`:

| Server `10xgraph.json` auth | Recommended client auth |
|---|---|
| `null` (no auth) | Omit `auth` entirely |
| `"jwt"` | `{ type: 'bearer', token: jwtToken }` |
| `{ "method": "custom", "path": "..." }` with API key check | `{ type: 'header', name: 'X-API-Key', value: apiKey }` |
| `{ "method": "custom", "path": "..." }` with bearer check | `{ type: 'bearer', token: apiToken }` |

See [Server auth](/docs/server/auth) and the [API reference](/docs/reference/api-cli/auth) for how to generate JWT tokens and implement custom auth handlers.

---

## Obtaining a JWT token

When the server is configured with `"auth": "jwt"`, obtain a signed token with PyJWT on the server side and pass it to the client:

```python
# Python: generate a test token
# pip install PyJWT
import datetime
import os

import jwt

token = jwt.encode(
    {
        "sub": "user-123",
        "exp": datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=24),
    },
    os.environ["JWT_SECRET_KEY"],
    algorithm=os.environ.get("JWT_ALGORITHM", "HS256"),
)
print(token)
```

```ts
// TypeScript: use the token
const client = new TenxGraphClient({
  baseUrl: 'http://localhost:8000',
  auth: {
    type: 'bearer',
    token: process.env.API_TOKEN!, // the token printed by the script above,
  },
});
```

---

## Cookie credentials

For browser apps that rely on session cookies (e.g. an API gateway that sets a cookie), configure `credentials`:

```ts
const client = new TenxGraphClient({
  baseUrl: 'https://api.10xgraph.com',
  credentials: 'include',
  // No auth field: the cookie is sent automatically by the browser
});
```

`credentials` is forwarded directly to the `fetch` call. Valid values are `'omit'`, `'same-origin'`, and `'include'`.

---

## Common errors

| Error | Cause | Fix |
|---|---|---|
| `TenxGraphError` status `401` | Missing or invalid token. | Check the `auth` config and the server `JWT_SECRET_KEY` / custom auth handler. |
| `TenxGraphError` status `403` | Token is valid but lacks permission for the requested operation. | Check the server-side `AuthorizationBackend` configuration. |
| `TypeError: Failed to fetch` | CORS blocked due to missing credentials or wrong origin. | Set `credentials: 'include'` and verify CORS headers on the server. |
| WebSocket rejected while HTTP works | Non-bearer auth in a browser, or a proxy stripping `Sec-WebSocket-Protocol`. | Use a bearer token, and forward the subprotocol header through the proxy. |

---

## What you learned

- Use `auth: { type: 'bearer', token }` for JWT auth (the most common case).
- Use `auth: { type: 'header', name, value }` for API-key header auth.
- Use `auth: { type: 'basic', username, password }` for HTTP Basic auth.
- Omit `auth` entirely for open/no-auth servers.
- `credentials` controls cookie handling in browser environments.
- WebSocket routes authenticate with the `agentflow-bearer` subprotocol, never a URL parameter, and resolve `auth` before `authToken`, the same as HTTP.

## Next step

See [Remote tools](/docs/client/remote-tools) to learn how to register client-side tools that the graph can invoke remotely.
