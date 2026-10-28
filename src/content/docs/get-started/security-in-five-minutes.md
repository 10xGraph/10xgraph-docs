---
title: Security in five minutes
seoTitle: Secure a 10xGraph agent with JWT in five minutes
description: Turn on JWT auth for the quickstart agent, create tokens for two users, and watch the server reject a missing token and a second user reading the first user's thread.
section: "Get started"
order: 45
updated: "2026-10-27"
faq:
  - q: Which claims does a token need?
    a: "`exp` and `user_id`. JwtAuth requires `exp` on every token, and rejects a token without `user_id` (or with one that is not a non-empty string or a whole number) with a 401. If you set `JWT_ISSUER` or `JWT_AUDIENCE`, `iss` and `aud` are required too."
  - q: Why did user B get a 403 and not an empty thread?
    a: Once auth is configured, the server uses the ownership authorization backend. The first caller to run a thread becomes its owner, and any other user is refused before the request reaches the graph or the checkpointer.
  - q: Is this enough for production?
    a: No. It proves the isolation mechanism. Production also needs a strong secret from a secret store, a durable checkpointer, rate limits and the other items on the production checklist.
---

The quickstart server is open: anyone who can reach port 8000 can call the agent and read any thread. This page closes that in five steps and shows the server enforcing it. You only change one config key and set two environment variables. The agent code stays as it is.

You need the `agent.py` and `10xgraph.json` from the [quickstart](/docs/get-started/first-agent).

## 1. Turn on JWT auth

Install the JWT extra, which adds PyJWT:

```bash
pip install "10xgraph-api[jwt]"
```

Change `10xgraph.json` so `auth` is `"jwt"`:

```json title="10xgraph.json"
{
  "agent": "agent:app",
  "env": ".env",
  "auth": "jwt"
}
```

Set the signing secret and algorithm in the environment of the shell that starts the server. `JWT_ALGORITHM` defaults to `HS256`; the secret has no default, and the server refuses to load without it. For HS algorithms the secret must be at least 32 bytes. A shorter one logs a warning in development and stops the server at startup when `MODE=production`.

```bash
export JWT_SECRET_KEY="$(python -c 'import secrets; print(secrets.token_urlsafe(48))')"
export JWT_ALGORITHM="HS256"
```

Your provider key must be exported in that same shell, as in the quickstart. Then start the server:

```bash
10xgraph dev --no-open
```

## 2. Make a token for each user

In a real system your login service signs tokens. For this test, sign two with PyJWT. Run this in the shell where `JWT_SECRET_KEY` is exported:

```python title="make_tokens.py"
import os
import time

import jwt  # PyJWT

secret = os.environ["JWT_SECRET_KEY"]
algorithm = os.environ["JWT_ALGORITHM"]

for user_id in ("alice", "bob"):
    token = jwt.encode(
        {"user_id": user_id, "exp": int(time.time()) + 3600},
        secret,
        algorithm=algorithm,
    )
    print(f"{user_id.upper()}_TOKEN={token}")
```

```bash
python make_tokens.py
```

Copy the two lines into your shell as `export` commands. `JwtAuth` requires two claims: `exp` (a token without it is rejected) and `user_id` (a non-empty string or a whole number). The `user_id` is the identity the server uses for ownership, so it must come from your login service and never from anything the client sends in the request body.

## 3. Call without a token

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:8000/v1/graph/invoke \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":[{"type":"text","text":"Where is order 1042?"}]}]}'
```

The server answers `401`. The request never reaches the graph.

## 4. Call as Alice

Send the token in an `Authorization: Bearer` header:

```bash
curl -s -X POST http://127.0.0.1:8000/v1/graph/invoke \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":[{"type":"text","text":"Where is order 1042?"}]}]}'
```

This returns `200`. Copy `data.meta.thread_id` from the response and export it as `THREAD_ID`. Alice now owns that thread.

## 5. Read Alice's thread as Bob

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer $BOB_TOKEN" \
  http://127.0.0.1:8000/v1/threads/$THREAD_ID/messages
```

The server answers `403`. Repeat the same request with `$ALICE_TOKEN` and you get `200` with her messages. Bob also cannot invoke the agent on her thread: a foreign `invoke` or `stream` is refused with `403` before it reaches the graph.

## What this turned on

Setting `auth` to `"jwt"` did more than check a signature:

- **Ownership authorization is on.** When `authorization` is not set, the server uses the ownership backend whenever auth is configured or `MODE=production`. The first caller to run a thread becomes its owner. Every route that touches a thread (invoke, stream, stop, and all thread reads and writes) checks the owner first.
- **Per-user storage scope.** Threads and long-term memories are scoped to the calling `user_id`.
- **Server-picked thread ids.** By default (`runs.thread_ids` is `server`) a client cannot invent a thread id. It starts a thread by omitting the id and uses the id the server returns.
- **Reserved identities are refused.** A token whose `user_id` starts with the reserved `__system__:` prefix is rejected, so no one can authenticate as the owner of shared data.

## What this does not do

The quickstart still uses `InMemoryCheckpointer`, so threads vanish on restart, and the dev server is a single process. A strong secret from a secret store, a durable checkpointer, rate limits, CORS and the rest are covered next.

## Next

- [Production readiness](/docs/production): what you get when you serve with `10xgraph-api`.
- [Security model](/docs/production/security-model): who can do what, and where each check runs.
- [Production checklist](/docs/server/production-checklist): the settings to confirm before you deploy.
- [Authentication reference](/docs/server/auth): custom auth, issuer and audience, scopes and token revocation.
