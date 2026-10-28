---
title: Secure your frontend
seoTitle: "Secure your frontend: browser auth for 10xGraph"
description: "How a browser app talks to a production 10xGraph server without a secret: server-side proxy or short-lived user tokens, WebSocket auth, remote tools, error codes."
section: "TypeScript client"
group: "Basics"
order: 15
updated: "2026-10-27"
faq:
  - question: "Can I put the API token in a NEXT_PUBLIC variable?"
    answer: "No. NEXT_PUBLIC variables are written into the JavaScript bundle at build time, so every visitor can read them and they cannot hold a per-user value. Keep a shared token on a server, or issue each user a short-lived token at runtime after they log in."
  - question: "How does a browser authenticate a WebSocket?"
    answer: "Browsers cannot set headers on a WebSocket. The client sends the bearer token as the second entry of the Sec-WebSocket-Protocol list, after the 10xgraph-bearer sentinel. The token never goes in the URL. This needs 10xgraph-api 0.7.0 or later."
  - question: "Does the client retry a 429 for me?"
    answer: "No. It throws a plain TenxGraphError with statusCode 429 and does not keep the response headers, so the Retry-After value is not available as a field. Back off in your app."
---

A browser is an untrusted place. Anything you ship to it, including environment variables, can be read by the person using it. The server side of 10xGraph is built around that: the server checks every request against the caller's identity, and the client's job is to carry that identity safely. This page covers how to do that.

## What the server already enforces

You do not need to rebuild these in your frontend. With `auth` configured and `MODE=production`, `10xgraph-api` does the following (details in the [security model](/docs/production/security-model)):

- Rejects requests without valid credentials with `401`.
- Lets a user reach only their own threads. A foreign `invoke` or `stream` is refused with `403` before it reaches the graph, and an id the server did not create is refused too (`runs.thread_ids` defaults to `server`).
- Applies the `rate_limit` window and a per-user cap on runs in flight with `429`.
- Accepts a client message only with the `user` role, and a `tool` message only as the answer to a pending client tool call.

The frontend must still get the credential to the server without leaking it.

## Rule 1: no server secret in the browser

A shared API key or service token gives anyone who copies it the same access as your whole app. It must never reach browser code. You have two safe patterns.

### Option A: a server-side proxy (recommended)

Your browser calls a route on your own backend. That route checks the user's session, adds the token from a server-only variable, and forwards the call to 10xGraph. The browser never learns the token or the 10xGraph URL. The [Next.js and React guide](/docs/client/nextjs-and-react) shows the full pattern with a route handler that streams the response back.

### Option B: short-lived tokens issued per user

If the browser must call the 10xGraph server directly, for example to open a WebSocket, issue each user their own short-lived token from your login endpoint. With `"auth": "jwt"` the token carries a `user_id` claim, and the server derives ownership from it. Fetch the token at runtime after the user signs in, hold it in memory, and refresh it before it expires. See [Create and configure the client](/docs/client/create-client#token-rotation) for rotation. To cut a token off before it expires, configure `token_revocation` (see [auth](/docs/server/auth)).

Never put a token in a `NEXT_PUBLIC_` variable. Those values are compiled into the bundle at build time, so every visitor gets the same one and anyone can read it.

Also set `ORIGINS` on the server to your exact frontend origins. With `MODE=production`, the server refuses to start when `ORIGINS` is `*`.

## Rule 2: WebSocket authentication

A browser cannot set an `Authorization` header on a WebSocket. `wsStream()` therefore opens the socket with the subprotocol list `['10xgraph-bearer', '<token>']`. The server reads the token from the entry after the sentinel and echoes the sentinel back, which the browser requires to finish the handshake. The token is never placed in the URL, so it stays out of access logs.

- This needs `10xgraph-api` 0.7.0 or later. The client sends only the `10xgraph-bearer` sentinel.
- On Node the client also sets an `Authorization` header.
- The server re-checks revocation before every WebSocket run when `token_revocation` is configured.

If the handshake fails, see [client troubleshooting](/docs/troubleshooting/client).

## Rule 3: remote tools run in the browser, so their results are input

[Client-side tools](/docs/client/remote-tools) keep the schema on the server and the implementation in the browser. That is useful, and it also means the result comes from a place the user controls. The server treats it that way: a `tool` message is accepted only as the answer to a remote tool call the graph has pending. A client cannot inject a tool result on its own, and it cannot send `assistant` or `system` messages.

Still treat the result as untrusted data in your graph. Validate it before it drives a payment or a write, the same way you would validate a form field.

## Handling error responses

Each status maps to a class from `10xgraph-client`. Full table: [Handle errors](/docs/client/error-handling).

| Status | Class | What it means for your UI |
|---|---|---|
| `401` | `AuthenticationError` | Token missing, invalid, expired or revoked. Refresh the token once, then send the user to sign in. |
| `403` | `PermissionError` | The scope is missing, or the `thread_id` belongs to another user or does not exist. Do not retry. For a new conversation, omit `thread_id` and use the id the server returns. |
| `409` | `ConflictError` | The thread is busy with another run, or a resume's `interrupt_id` does not match. Wait and retry, or send `on_busy: 'cancel'` to stop the running turn first. The default `on_busy: 'wait'` holds the request up to 30 seconds before it answers `409`. |
| `429` | `TenxGraphError` with `statusCode` 429 | The rate limit window is used up, or the user has too many runs in flight. |

For `429`, the client has no dedicated class and does not keep the `Retry-After` header. A rate-limit response ends its message with `Retry after <n>s.`, which you can parse. The run-cap response has no `Retry-After` header. Back off with a delay that grows each attempt and stop after a few tries. A working example is in [Rate limits (429)](/docs/client/error-handling#rate-limits-429).

```ts
import { TenxGraphError } from '10xgraph-client';

try {
  await client.invoke(messages, { config: { thread_id } });
} catch (err) {
  if (err instanceof TenxGraphError && err.statusCode === 429) {
    // wait, then retry with backoff; do not loop immediately
  } else {
    throw err;
  }
}
```

## Checklist

- No token in any `NEXT_PUBLIC_` variable or committed file.
- Browser calls go through your proxy, or use a short-lived per-user token fetched at runtime.
- `ORIGINS` lists your real frontend origins.
- WebSocket users run `10xgraph-api` 0.7.0 or later.
- Your UI handles `401`, `403`, `409` and `429` as above.
- You ran the [pre-production smoke tests](/docs/testing/before-production).

## Next steps

- [Production readiness](/docs/production): what you get when you serve with `10xgraph-api`.
- [Production checklist](/docs/server/production-checklist): server-side settings to confirm before launch.
- [What 10xGraph does not protect](/docs/production/limits): including running with `auth: null`.
