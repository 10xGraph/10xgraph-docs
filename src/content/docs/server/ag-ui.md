---
title: Serve your agent over AG-UI
seoTitle: "Serve a 10xGraph agent over AG-UI (CopilotKit)"
description: "Enable AG-UI support in 10xGraph to connect chat frontends like CopilotKit, test the endpoint, configure for production."
section: "API server"
group: "Interfaces"
order: 110
label: Serve over AG-UI
updated: "2026-10-27"
faq:
  - q: "Do I need AG-UI to build a frontend for 10xGraph?"
    a: "No. The TypeScript client over /v1/graph/stream is the standard path. Use AG-UI when your frontend already speaks it, such as CopilotKit."
  - q: "Why does POST /v1/ag-ui return 404?"
    a: "The endpoint is off by default. Enable it by setting ag_ui in 10xgraph.json with enabled true, install the ag-ui extra, and restart."
---

AG-UI is an open event protocol that connects agent backends to chat frontends. The 10xGraph API server can speak AG-UI to serve agents over `/v1/ag-ui`, enabling frontends like CopilotKit that already understand the protocol. If you are building a custom frontend, the [TypeScript client](/docs/client) over `/v1/graph/stream` is the direct path. This guide covers the server side of AG-UI. For frontend integration with CopilotKit, see [10xGraph with CopilotKit](/docs/integrations/copilotkit). For complete endpoint and event documentation, see the [AG-UI endpoint reference](/docs/reference/rest-api/ag-ui).

## Prerequisites

You need the `ag-ui` extra for the API server, a 10xGraph compiled graph, and a frontend built for AG-UI (such as CopilotKit). If you are writing a custom frontend, the [TypeScript client](/docs/client) over `/v1/graph/stream` is simpler and requires no extra package.

## Install the AG-UI extra

The endpoint is not built by default. Install it with the `ag-ui` extra:

```bash
pip install "10xgraph-api[ag-ui]"
```

## Enable the endpoint in 10xgraph.json

Add the `ag_ui` key to your `10xgraph.json` configuration:

```json
{
  "agent": "graph.agent:app",
  "ag_ui": { "enabled": true }
}
```

Then start the server:

```bash
10xgraph dev --no-open
```

The endpoint `POST /v1/ag-ui` is now ready and appears in Swagger at `/docs` under the **AG-UI** tag. If you enable AG-UI without installing the extra, the server exits at startup and prints the install command.

## Test the endpoint

Use curl to verify the endpoint is working. The request must include `threadId`, `runId`, and `messages`:

```bash
curl -N http://127.0.0.1:8000/v1/ag-ui \
  -H 'content-type: application/json' \
  -d '{
    "threadId": "t1",
    "runId": "r1",
    "messages": [{"id": "u1", "role": "user", "content": "hello"}]
  }'
```

You should see server-sent event (SSE) lines starting with `data: `, beginning with `RUN_STARTED` and ending with `RUN_FINISHED`. The output is in AG-UI event format.

If you have authentication enabled, add the authorization header:

```bash
curl -N http://127.0.0.1:8000/v1/ag-ui \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $TOKEN" \
  -d '{"threadId": "t1", "runId": "r1", "messages": [{"id": "u1", "role": "user", "content": "hello"}]}'
```

| Response | Meaning |
|---|---|
| `data: {"type": "RUN_STARTED"...` followed by events and `data: {"type": "RUN_FINISHED"...` | Endpoint is working |
| `404` | AG-UI is not enabled in 10xgraph.json, or the server was not restarted |
| `401` or `403` | Authentication is required and the token is missing, invalid, or not authorized for this thread |
| `422` | The request body is invalid. Check that `threadId`, `runId`, and `messages` are present and properly formatted |
| `data: {"type": "RUN_ERROR"...` in the stream | The run started but encountered an error. Check the server logs for details |

## Connect your frontend

Point your AG-UI client to the endpoint. With CopilotKit, you create an `HttpAgent` in a Next.js route handler on the server side, so the browser never sees the API token:

```ts
import { HttpAgent } from "@ag-ui/client";

const agent = new HttpAgent({
  url: process.env.TENXGRAPH_API_URL + "/v1/ag-ui",
  headers: { Authorization: `Bearer ${process.env.TENXGRAPH_API_TOKEN}` },
});
```

By handling the connection on your server, the token stays server-side and you do not need to configure CORS for the frontend's origin. The full Next.js route handler and page component are documented in [10xGraph with CopilotKit](/docs/integrations/copilotkit).

## Configure for production

The AG-UI endpoint is mounted whenever enabled, regardless of `MODE`. Treat it with the same care as `/v1/graph/stream`. The following checklist ensures security, durability, and performance:

### Persistent checkpointing

AG-UI clients identify the conversation by `threadId`, which the server maps to a 10xGraph thread. AG-UI follows `runs.thread_ids` like REST. With the default `"server"`, a `threadId` the server never issued gets `403`; send a blank or `"new"` `threadId` to have the server create the thread, and read the id from `RUN_STARTED`. CopilotKit makes its own ids by default, so a CopilotKit frontend needs `"runs": {"thread_ids": "client"}` in `10xgraph.json`. An existing thread is owner-checked as usual. The server reads the checkpoint to determine which messages are new and only sends those to the graph. With an in-memory checkpointer:

- Threads are lost when the server restarts
- State is not shared across replicas
- The feature appears broken in production

Use a persistent checkpointer (Postgres or SQLite). See [Set up checkpointing](/docs/guides/set-up-checkpointing) for configuration.

### Authentication and authorization

Without authentication, anyone can access anyone's thread. Enable auth with `"auth": "jwt"` or a custom `BaseAuth` subclass. In production, the authorization backend defaults to `ownership`, which enforces that each user can only access their own threads.

```json
{
  "auth": "jwt",
  "authorization": "ownership"
}
```

Environment: set `JWT_SECRET_KEY` to a strong random string (32+ characters).

See [Auth](/docs/server/auth) for full configuration.

### Client tools policy

By default, AG-UI clients can send tools with each request. The model is offered those tools for that run only. Client tools run in the browser, cannot overwrite server-side tools, and are size-limited. You can disable them if you only use server-side tools:

```json
{
  "ag_ui": {
    "enabled": true,
    "allow_client_tools": false
  }
}
```

With `allow_client_tools: false`, only tools declared in `remote_tools` are offered.

### Rate limiting

The AG-UI endpoint counts against the global `rate_limit` configuration like any other route. In production with multiple replicas, use the Redis backend:

```json
{
  "rate_limit": {
    "enabled": true,
    "backend": "redis",
    "requests": 100,
    "window": 60,
    "redis": {
      "url": "redis://localhost:6379/0",
      "prefix": "10xgraph:rate-limit"
    }
  }
}
```

See [Rate limiting](/docs/server/rate-limiting) for details.

### One run per thread and request limits

The server runs one graph run at a time on a thread. A second AG-UI run on a busy thread waits up to 30 seconds, then gets `409` with `thread is busy`. AG-UI always waits; it cannot ask the running run to stop. With Redis configured, the lock is shared across replicas.

Because AG-UI clients resend the whole conversation, the size limits (500 messages, 100 content blocks per message, 1,000,000 characters of text) apply to the trailing turn only. The full history is capped at 10,000 messages. Requests over a limit get `422`. See the [AG-UI endpoint reference](/docs/reference/rest-api/ag-ui#request-size-limits).

In production (`MODE=production`), error events carry a generic message. Details stay in the server log.

### Stream buffering

The endpoint streams responses as server-sent events. Disable buffering on any reverse proxy or load balancer in front of the server:

- **nginx**: The response headers already include `X-Accel-Buffering: no` to disable nginx buffering.
- **Other proxies and load balancers**: Explicitly disable response buffering for `/v1/ag-ui`.
- **Connection timeout**: Set the idle timeout longer than your slowest graph run. A typical consumer-facing agent may take 10-30 seconds.

## Related

- [AG-UI endpoint reference](/docs/reference/rest-api/ag-ui): complete request schema, event types, interrupts, and error codes
- [10xGraph with CopilotKit](/docs/integrations/copilotkit): frontend integration example with tools and human approval
- [AG-UI configuration](/docs/reference/api-cli/configuration#websocket-ag_ui-and-observability): full `ag_ui` key documentation
