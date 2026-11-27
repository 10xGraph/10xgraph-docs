---
title: Create and configure the client
description: Install the TypeScript client and configure authentication to communicate with a 10xGraph API server securely.
section: "TypeScript client"
group: "Basics"
order: 20
updated: "2026-11-26"
faq:
  - question: "How do I rotate the API token?"
    answer: "Call `client.setAuthToken(newToken)`, or pass a function as `authToken` so every request reads the current token. Nothing needs a rebuild."
  - question: "Can I use the same client instance across my app?"
    answer: "Yes. Create the client once at module level and import it wherever needed."
---

This page installs `10xgraph-client` and sets its server URL, credentials, timeout and WebSocket support. The client runs in Node.js and browsers.

## Prerequisites

- Node.js 20 or newer, or a browser.
- A 10xGraph API server running locally (`10xgraph dev`) or deployed to a remote host.
- Access to API credentials if the server requires authentication (bearer token, basic auth, or custom API key).

## Install the package

```bash
npm install 10xgraph-client
```

## Create your first client instance

A minimal client needs only the API server URL:

```ts
import { TenxGraphClient } from '10xgraph-client';

const client = new TenxGraphClient({
  baseUrl: 'http://localhost:8000',
});

// Verify the server is reachable
const response = await client.ping();
console.log(response.data); // 'pong'
```

The `baseUrl` is the root of your server, without a path. The client adds the routes and strips a trailing slash.

## Authentication strategies

If your server requires authentication, configure one of three strategies in the client. Each strategy sets a different HTTP header or encoding. Choose the one your server expects.

### Bearer token (JWT)

The most common strategy for REST APIs. The client sends `Authorization: Bearer <token>` on every request.

```ts
import { TenxGraphClient, bearerAuth } from '10xgraph-client';

const client = new TenxGraphClient({
  baseUrl: 'http://localhost:8000',
  auth: bearerAuth(process.env.API_TOKEN!),
});
```

You can also pass the object literal directly if you prefer not to import the helper:

```ts
const client = new TenxGraphClient({
  baseUrl: 'http://localhost:8000',
  auth: { type: 'bearer', token: process.env.API_TOKEN! },
});
```

### HTTP Basic authentication

Encodes a username and password as `Authorization: Basic <base64>`. Use it when a gateway in front of the server, or your custom `BaseAuth`, expects Basic credentials. The built-in `jwt` method expects a bearer token.

```ts
import { TenxGraphClient, basicAuth } from '10xgraph-client';

const client = new TenxGraphClient({
  baseUrl: 'http://localhost:8000',
  auth: basicAuth('admin', process.env.ADMIN_PASSWORD!),
});
```

The equivalent object literal:

```ts
auth: { type: 'basic', username: 'admin', password: '...' }
```

### Custom header

When the server uses a non-standard header or a proprietary scheme, send a custom header with an optional prefix.

```ts
import { TenxGraphClient, headerAuth } from '10xgraph-client';

const client = new TenxGraphClient({
  baseUrl: 'http://localhost:8000',
  // Sends: X-API-Key: my-secret-key
  auth: headerAuth('X-API-Key', process.env.API_KEY!),
});
```

To add a prefix (for schemes like `ApiKey` or `Bearer`), pass it as the third argument:

```ts
// Sends: Authorization: ApiKey my-secret-key
auth: headerAuth('Authorization', process.env.API_KEY!, 'ApiKey')
```

`auth` is applied after the extra `headers` you pass, so it replaces a header of the same name. `authToken` never replaces an `Authorization` header you set in `headers`. All combinations: [Auth header precedence](/docs/reference/client/auth#auth-header-precedence).

## Tuning timeout and debugging

By default, requests wait up to 5 minutes (300,000 milliseconds) for a response. For interactive UIs, lower the timeout to fail fast and provide better feedback:

```ts
const client = new TenxGraphClient({
  baseUrl: 'http://localhost:8000',
  auth: bearerAuth(process.env.API_TOKEN!),
  timeout: 60_000,    // 1 minute
  debug: true,        // Log requests during development
});
```

With `debug: true` the client logs request payloads, including message text, and responses to the console. Keep it off in production. The default is `false`.

## Verify the connection and server state

Before sending agent requests, fetch metadata about the graph to confirm the server loaded your graph correctly:

```ts
const info = await client.graph();
console.log('Nodes:', info.data.nodes.map(n => n.name));
console.log('Checkpointer:', info.data.info.checkpointer_type);
console.log('ID generator:', info.data.info.id_type);
```

A successful call confirms that:

- The server is running and reachable.
- 10xgraph.json was found and parsed without errors.
- The graph compiled and is ready to invoke.

## Complete configuration reference

Every config field with its type and default is in [TenxGraphConfig](/docs/reference/client/client#tenxgraphconfig).

## WebSocket support on Node 20

`wsStream()` and `realtime()` use WebSocket. Browsers and Node 22 or later have a global `WebSocket`. On Node 20, install the `ws` package and pass it to the client:

```bash
npm install ws
```

```ts
import WebSocket from 'ws';
import { TenxGraphClient, bearerAuth } from '10xgraph-client';

const client = new TenxGraphClient({
  baseUrl: 'http://localhost:8000',
  auth: bearerAuth(process.env.API_TOKEN!),
  webSocketImpl: WebSocket as unknown as typeof globalThis.WebSocket,
});

// Now wsStream() and realtime() work
```

Other methods like `invoke()`, `stream()`, and thread/memory operations use `fetch` and work without `ws` on any Node version.

## Change the token at runtime

`authToken` takes a string or a function. A function is called before every request and on every realtime reconnect, so a short-lived token can be refreshed without a new client:

```ts
const client = new TenxGraphClient({
  baseUrl: 'https://agents.example.com',
  authToken: () => session.accessToken, // read before every request
});

client.setAuthToken(newToken); // replace the token
client.clearAuth();            // drop authToken and auth, for example on sign-out
```

`setAuthToken()` does not change a stream or socket that is already open. Where a browser app may keep tokens, and why never in a `NEXT_PUBLIC_` variable: [Secure your frontend](/docs/client/secure-your-frontend).

## Sharing the client across your application

Create the client once at module level and import it wherever you need it. In browser code, do not pass a server secret here (see [Secure your frontend](/docs/client/secure-your-frontend)):

```ts
// lib/agent-client.ts
import { TenxGraphClient, bearerAuth } from '10xgraph-client';

export const agentClient = new TenxGraphClient({
  baseUrl: 'http://localhost:8000',
  auth: bearerAuth(process.env.API_TOKEN!),
  timeout: 60_000,
});
```

## Troubleshooting connection issues

| Symptom | Likely cause | Solution |
|---|---|---|
| `NetworkError` (`statusCode` 0) | Server is not running, the address is wrong, or the browser blocked the request (CORS). | Start the server with `10xgraph dev` and verify the `baseUrl` is correct. |
| `AuthenticationError` (401) | Authentication failed (missing, invalid, or expired token). | Check the token passed to `auth` or `authToken`. Verify it matches the server's secret (`JWT_SECRET_KEY` in `.env`). |
| CORS error in a browser | The server's CORS policy blocks your origin. | On the server, set `ORIGINS` to include your app's origin. |
| `No WebSocket implementation available` | `wsStream()` or `realtime()` called on Node 20 without `webSocketImpl`. | Install `ws` and pass it to the client as shown above. |

## What's next

Now that you have a working client, you can:

- [Invoke agents](/docs/client/invoke-agent) and send your first message.
- [Stream responses](/docs/client/stream-responses) for real-time output.
- [Manage threads](/docs/client/manage-threads) to keep conversation history.
- [Use the memory API](/docs/client/use-memory-api) to store and retrieve facts about users.
