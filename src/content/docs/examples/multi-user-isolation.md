---
title: Two users, one server, no shared threads
seoTitle: "Multi-user thread isolation in 10xGraph"
description: Serve one agent to two users with JWT auth and ownership, then see what each user can and cannot reach. The statuses shown were captured from a running server.
section: Examples
group: Production
order: 14
label: Multi-user isolation
updated: "2026-10-27"
faq:
  - q: Why 403 and not 404 for another user's thread?
    a: The server answers 403 for a thread you do not own and also for an id that does not exist, so the status does not tell a caller which thread ids are real.
  - q: Does InMemoryCheckpointer isolate users by itself?
    a: No. Called directly with a different user_id it returns the same thread. The isolation on this page comes from the server's ownership check, which runs before the graph. PgCheckpointer additionally scopes reads by owner when enforce_user_isolation is true, which is its default.
---

In a multi-user product the worst bug is user B reading user A's conversation. This example serves one agent to two users and shows, with real requests, what the server lets each of them do. You write no isolation code: it is the `ownership` authorization backend, which is on by default whenever auth is configured.

**Needs:** `pip install "10xgraph[openai]" "10xgraph-api[jwt]"` and `JWT_SECRET_KEY`. The agent below needs `OPENAI_API_KEY`. To follow along with no model call, use the echo graph in the next block: the statuses on this page come from a similar graph with no model call, because the checks happen before the graph runs.

## The agent and the config

```python title="graph/agent.py (echo graph, no model call)"
from tenxgraph.core.graph import StateGraph
from tenxgraph.core.state import AgentState, Message
from tenxgraph.storage.checkpointer import InMemoryCheckpointer
from tenxgraph.utils import END


async def reply(state: AgentState):
    return Message.text_message("echo: " + state.context[-1].text(), role="assistant")


graph = StateGraph()
graph.add_node("MAIN", reply)
graph.add_edge("MAIN", END)
graph.set_entry_point("MAIN")
app = graph.compile(checkpointer=InMemoryCheckpointer())
```

For a real agent, replace the graph with a `ReactAgent(...).compile(checkpointer=...)`; nothing else changes.

```json title="10xgraph.json"
{ "agent": "graph.agent:app", "auth": "jwt", "authorization": "ownership" }
```

`"authorization": "ownership"` is what the server picks anyway when auth is set; it is written out here so the intent is visible. Start the server:

```bash
export JWT_SECRET_KEY="$(python -c 'import secrets; print(secrets.token_urlsafe(48))')"
export JWT_ALGORITHM=HS256
10xgraph dev --no-open
```

## Two users

```python title="make_tokens.py"
import os
import time

import jwt  # PyJWT

for user in ("alice", "bob"):
    token = jwt.encode(
        {"user_id": user, "exp": int(time.time()) + 3600},
        os.environ["JWT_SECRET_KEY"],
        algorithm=os.environ["JWT_ALGORITHM"],
    )
    print(f"{user.upper()}_TOKEN={token}")
```

Export `ALICE_TOKEN` and `BOB_TOKEN`. Alice starts a thread by sending a message with no thread id; the server makes the id.

```bash
curl -s http://127.0.0.1:8000/v1/graph/invoke \
  -H "Authorization: Bearer $ALICE_TOKEN" -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":[{"type":"text","text":"my card ends 4242"}]}]}'
# data.meta: {"is_new_thread": true, "thread_id": "<T>"}
```

Alice owns `<T>`. The thread's `user_id` is `alice`, taken from her token.

## What Bob gets

Bob sends each of these with his token against Alice's thread `<T>`:

| Request | Status |
|---|---|
| `POST /v1/graph/invoke` with `config.thread_id = <T>` | 403 `Not authorized to invoke graph` |
| `POST /v1/graph/stream` on `<T>` | 403 |
| `GET /v1/threads/<T>/messages` | 403 `Not authorized to read checkpointer` |
| `GET /v1/threads/<T>/state` | 403 |
| `GET /v1/threads/<T>` | 403 |
| `DELETE /v1/threads/<T>` | 403 `Not authorized to delete checkpointer` |
| `POST /v1/graph/invoke` with an id that does not exist (`made-up-id`) | 403 |
| any request with no token | 401 |

`GET /v1/threads` for Bob returns an empty list while Alice's request returns her thread. After Bob sends his own first message, his list holds only his thread (`user_id: bob`). Alice's `GET /v1/threads/<T>/messages` still returns 200 after all of Bob's attempts.

The same checks with the TypeScript client:

```ts
import { TenxGraphClient, Message, PermissionError } from '10xgraph-client';

const alice = new TenxGraphClient({ baseUrl: 'http://127.0.0.1:8000', authToken: aliceToken });
const bob = new TenxGraphClient({ baseUrl: 'http://127.0.0.1:8000', authToken: bobToken });

const first = await alice.invoke([Message.text_message('my card ends 4242')]);
const threadId = first.meta.thread_id;

try {
  await bob.invoke([Message.text_message('hi')], { config: { thread_id: threadId } });
} catch (err) {
  console.log(err instanceof PermissionError, (err as PermissionError).statusCode); // true 403
}

console.log(await bob.threads()); // { data: { threads: [] }, ... }
```

## Where the guarantee comes from

- **The server, before the graph.** The ownership backend compares the token's `user_id` with the thread's owner on every thread-touching request (invoke, stream, stop, and all checkpointer reads, writes and deletes). A foreign request is refused with 403 and never reaches your graph or the model.
- **Server-made thread ids.** With the default `runs.thread_ids: "server"`, a client cannot name a thread that does not exist, so it cannot claim an id before its owner does. That is why the made-up id above is refused.
- **Fail closed.** If the checkpointer cannot report thread owners, the server denies thread requests, and with auth on it refuses to start in that setup.
- **The checkpointer, for your own code.** `PgCheckpointer` scopes reads and ledger lookups by owner when `enforce_user_isolation` is true (the default, `pg_checkpointer.py`). `InMemoryCheckpointer` does not: called directly with another `user_id` it returns the same thread (checked), so for anything that calls a checkpointer without the server in front, use `PgCheckpointer`.

The identity must come from the token. Never take `user_id` from the request body or from state. See [Secure your frontend](/docs/client/secure-your-frontend).

## What this shows

- Per-user thread isolation needs no code in the agent. See [Auth](/docs/server/auth) and [Security model](/docs/production/security-model).
- Refusals happen before any model call, so a probing user costs you nothing. See [Architecture](/docs/production/architecture).
- Honest limit: isolation is by owner id. It does not stop a user from sending prompts that try to make the model reveal data you gave it in the system prompt or through tools. See [What 10xGraph does not protect](/docs/production/limits).
- The same behaviour applies to a resume: only the owner can answer a paused thread. See [Human approval over the API](/docs/examples/human-approval-over-api).
