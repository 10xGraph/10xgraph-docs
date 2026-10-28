---
title: Create and configure the client
description: Install the TypeScript client and configure authentication to communicate with a 10xGraph API server securely.
section: "TypeScript client"
group: "Basics"
order: 20
updated: "2026-10-27"
faq:
  - question: "When should I expose tokens in NEXT_PUBLIC?"
    answer: "Never. Tokens should remain on the server or be fetched securely. NEXT_PUBLIC variables are bundled into client JavaScript, making them visible to the browser and any attacker. Use a backend proxy instead."
  - question: "How do I rotate the API token?"
    answer: "Create a new token on the server side, rebuild your application, and deploy. The token is baked into the built client, so you must rebuild to rotate."
  - question: "Can I use the same client instance across my app?"
    answer: "Yes. Create the client once at module level and import it wherever needed. Sharing a single instance reduces memory overhead and enables consistent request handling."
---

The `10xgraph-client` TypeScript package lets you invoke agents and manage threads from Node.js, browsers, and frameworks like React and Next.js. This guide shows how to install, configure, and authenticate the client for your 10xGraph API server.

## Prerequisites

- Node.js 18 or higher, or a modern browser environment with `fetch` support.
- A 10xGraph API server running locally (`10xgraph dev`) or deployed to a remote host.
- Access to API credentials if the server requires authentication (bearer token, basic auth, or custom API key).

## Install the package

Install it alongside your existing packages:

```bash
npm install 10xgraph-client
```

The package exports `TenxGraphClient` plus auth helpers, `Message`, error classes and types. Verify the installation:

```ts
import { TenxGraphClient, bearerAuth } from '10xgraph-client';

// Ready to create a client
```

Before the rename the package was published as `@10xscale/agentflow-client`, with classes named `AgentFlowClient`, `AgentFlowError` and so on. `10xgraph-client` keeps those class names as deprecated aliases until 2.0, so existing code keeps working after you change the package name.

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

The `baseUrl` is the root of your server. Do not include a trailing slash or path; the client adds the routes itself. Replace `http://localhost:8000` with your actual server address.

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

Encodes a username and password as `Authorization: Basic <base64>`. Useful when the server is behind a corporate gateway or requires digest auth.

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

### Auth strategies reference

| Strategy | Helper | HTTP header |
|---|---|---|
| Bearer token | `bearerAuth(token)` | `Authorization: Bearer <token>` |
| Basic auth | `basicAuth(user, pass)` | `Authorization: Basic <base64>` |
| Custom header | `headerAuth(name, value, prefix?)` | `<name>: [prefix ]<value>` |

If the config includes multiple headers with the same name (case-insensitive), the last one wins. Auth is applied after any extra headers you pass via `headers: {...}` in the config.

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

When `debug: true`, the client logs every request and its response to `console.debug`. Disable this in production; it exposes request details that can aid attackers. The default is `false`.

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

```ts
import {
  TenxGraphClient,
  TenxGraphConfig,
  bearerAuth,
  basicAuth,
  headerAuth,
} from '10xgraph-client';

const config: TenxGraphConfig = {
  baseUrl: 'http://localhost:8000',   // Required. No trailing slash.

  // Authentication: pick one, or omit for no auth
  auth: bearerAuth(process.env.API_TOKEN!),
  // auth: basicAuth('user', 'pass'),
  // auth: headerAuth('X-API-Key', process.env.API_KEY!),
  // auth: { type: 'bearer', token: '...' },

  // Legacy alternative for bearer tokens (use auth instead)
  authToken: undefined,

  // Optional: extra headers on every request (e.g., for user agents or versions)
  headers: {
    'X-App-Version': '2.1.0',
  },

  // Optional: include cookies in cross-origin requests (browsers only)
  credentials: 'include',

  // Optional: timeout in milliseconds. Default: 5 minutes (300,000)
  timeout: 300_000,

  // Optional: log request and response details. Default: false. Disable in production.
  debug: false,

  // Optional: WebSocket implementation for WebSocket streaming and realtime calls.
  // Browsers and Node.js 21+ have a global WebSocket and need nothing here.
  // On Node 18 or 20, pass the 'ws' package (see section below).
  webSocketImpl: undefined,
};

const client = new TenxGraphClient(config);
```

## WebSocket support on Node 18 and 20

The methods `wsStream()` and `realtime()` use WebSocket to stream responses. Node.js 18 and 20 do not expose a global `WebSocket` constructor (Node 21 and later do), so you must install the `ws` package and pass it to the client:

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

## Managing secrets in frontend applications

In frontend applications like React and Next.js, be careful with authentication tokens. Never expose them in client-side code that can be viewed in the browser.

### The wrong way: NEXT_PUBLIC variables

Do not do this:

```ts
// DON'T DO THIS
const client = new TenxGraphClient({
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000',
  auth: process.env.NEXT_PUBLIC_API_TOKEN    // UNSAFE: exposed to browser
    ? { type: 'bearer', token: process.env.NEXT_PUBLIC_API_TOKEN }
    : undefined,
});
```

Any environment variable prefixed with `NEXT_PUBLIC_` is bundled into your JavaScript. Anyone viewing the page source in the browser can read it. An attacker can use your token to invoke agents, modify threads, or access sensitive data.

### The right way: backend proxy or runtime session tokens

Instead, either:

1. **Backend proxy.** Create a Next.js API route that acts as a proxy to the 10xGraph server. The route handler has access to the real token in server-only environment variables. The browser client talks to the API route, which forwards requests to the 10xGraph server with authentication.

   ```ts
   // app/api/agent/route.ts (Next.js App Router)
   import { NextRequest, NextResponse } from 'next/server';
   import { TenxGraphClient, bearerAuth } from '10xgraph-client';

   const agentClient = new TenxGraphClient({
     baseUrl: process.env.AGENT_SERVER_URL!,
     auth: bearerAuth(process.env.AGENT_TOKEN!),
   });

   export async function POST(req: NextRequest) {
     const body = await req.json();
     const result = await agentClient.invoke(body.messages);
     return NextResponse.json(result);
   }
   ```

   The browser then calls `POST /api/agent` with your message, and the backend handles the token.

2. **Session tokens.** If the 10xGraph server supports custom authentication (via `BaseAuth` in 10xgraph-api), issue a short-lived session token per user after they log in to your app. Your own login endpoint returns that token at runtime, after the user signs in. Never put it in a `NEXT_PUBLIC_` variable: those are fixed at build time and shared by every visitor, so they cannot hold a per-user value. The proxy in option 1 is the recommended pattern, and the [Next.js and React guide](/docs/client/nextjs-and-react) shows it in full.

### Token rotation

With the backend proxy, the token lives in a server-only environment variable such as `AGENT_TOKEN`. To rotate it:

1. Update the environment variable where the proxy runs.
2. Restart or redeploy the proxy.
3. The browser needs no change, because it never held the token.

Session tokens issued per user expire on their own, so users pick up a fresh one the next time they sign in.

## Sharing the client across your application

Create the client once at module level and import it wherever you need it. This avoids creating multiple instances and ensures consistent configuration:

```ts
// lib/agent-client.ts
import { TenxGraphClient, bearerAuth } from '10xgraph-client';

export const agentClient = new TenxGraphClient({
  baseUrl: 'http://localhost:8000',
  auth: bearerAuth(process.env.API_TOKEN!),
  timeout: 60_000,
});
```

Then import and use it in your components:

```ts
// components/ChatWidget.tsx
import { Message } from '10xgraph-client';
import { agentClient } from '@/lib/agent-client';

export function ChatWidget() {
  async function sendMessage(text: string) {
    const result = await agentClient.invoke([Message.text_message(text)]);
    // Handle result
  }

  return (
    <div>
      {/* UI */}
    </div>
  );
}
```

## Troubleshooting connection issues

| Symptom | Likely cause | Solution |
|---|---|---|
| `TypeError: Failed to fetch` | Server is not running or the address is wrong. | Start the server with `10xgraph dev` and verify the `baseUrl` is correct. |
| `TenxGraphError` with status `401` | Authentication failed (missing, invalid, or expired token). | Check the token passed to `auth` or `authToken`. Verify it matches the server's secret (`JWT_SECRET_KEY` in `.env`). |
| `TenxGraphError` with status `404` on `/ping` | Trailing slash in `baseUrl` or incorrect path. | Ensure `baseUrl` has no trailing slash. Example: `http://localhost:8000` not `http://localhost:8000/`. |
| CORS error in a browser | The server's CORS policy blocks your origin. | On the server, set `ORIGINS` to include your app's origin. Or in the client, set `credentials: 'include'` if the server allows credentials. |
| `No WebSocket implementation available` | `wsStream()` or `realtime()` called on Node 18/20 without `webSocketImpl`. | Install `ws` and pass it to the client as shown above. |

## What's next

Now that you have a working client, you can:

- [Invoke agents](/docs/client/invoke-agent) and send your first message.
- [Stream responses](/docs/client/stream-responses) for real-time output.
- [Manage threads](/docs/client/manage-threads) to keep conversation history.
- [Use the memory API](/docs/client/use-memory-api) to store and retrieve facts about users.
