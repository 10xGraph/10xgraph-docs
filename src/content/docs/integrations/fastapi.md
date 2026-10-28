---
title: Embed a graph in FastAPI
description: Run a 10xGraph agent directly in your FastAPI service with shared auth, streaming, and dependency injection.
section: Integrations
group: Frameworks
order: 60
label: with FastAPI
updated: "2026-10-27"
---

`10xgraph-api` is the fastest path from a compiled graph to an HTTP endpoint (`10xgraph dev` locally, the image from `10xgraph build` in production). But many production teams already run a FastAPI service with auth, middleware, and routes they cannot rewrite. Embedding 10xGraph directly into that service lets you share business logic, authentication, and database connections without HTTP hops.

This guide covers both approaches, how to stream responses, manage resources with FastAPI lifespan, and test your embedded routes.

## Two approaches

**1. Run the `10xgraph-api` server as a separate service.** Your FastAPI app proxies to it. Cleanest separation, independent scaling, separate deployments. One extra network hop. Best for most teams.

**2. Embed the graph directly in your FastAPI app.** Call the compiled graph from your routes. Fewer hops, zero network latency, shared Python objects (databases, ML models). More code, tighter coupling. Best when you have shared business logic.

For most production teams, option 1 is the default. Option 2 makes sense when the agent and your service share state that is expensive to pass over HTTP (like an active database session or an ML model in memory).

## Option 1: Sidecar with proxying

Run 10xGraph as its own process behind the same load balancer or in a separate container:

```yaml title="docker-compose.yml"
services:
  api:
    build: ./api
    ports: ["8000:8000"]
    environment:
      AGENT_URL: http://agent:8001

  agent:
    image: my-agent:latest
    ports: ["8001:8001"]
    command: gunicorn -k uvicorn_worker.UvicornWorker -b 0.0.0.0:8001 tenxgraph_api.src.app.main:app
```

Your FastAPI app proxies requests to the agent service:

```python title="api/main.py"
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
import httpx
import os

AGENT_URL = os.getenv("AGENT_URL", "http://localhost:8001")
app = FastAPI()

def forward_headers(req: Request) -> dict[str, str]:
    headers = {"content-type": "application/json"}
    if "authorization" in req.headers:
        headers["authorization"] = req.headers["authorization"]
    return headers

@app.post("/agent/invoke")
async def proxy_invoke(req: Request):
    body = await req.body()
    async with httpx.AsyncClient(timeout=None) as client:
        r = await client.post(
            f"{AGENT_URL}/v1/graph/invoke", content=body, headers=forward_headers(req)
        )
        return r.json()

@app.post("/agent/stream")
async def proxy_stream(req: Request):
    body = await req.body()
    async def gen():
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream(
                "POST", f"{AGENT_URL}/v1/graph/stream", content=body, headers=forward_headers(req)
            ) as r:
                async for chunk in r.aiter_bytes():
                    yield chunk
    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"X-Accel-Buffering": "no"}
    )
```

The request body must be a valid `/v1/graph/invoke` or `/v1/graph/stream` body (message `content` is a list of blocks such as `[{"type": "text", "text": "..."}]`, and `thread_id` goes inside `config`). Add auth, rate limiting, and validation in the proxy layer; let 10xGraph handle agent execution. This pattern scales well because the agent service can be replicated independently.

## Option 2: Embed the graph directly

Import your compiled graph and call it from FastAPI routes. This is the right choice when your agent needs direct access to shared resources.

### Basic invoke and stream

```python title="api/main.py"
from fastapi import FastAPI, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import json

from tenxgraph.core.state import Message
from tenxgraph.utils.constants import ResponseGranularity
from tenxgraph.core.state import StreamEvent

from my_app.graph import compiled_graph
from my_app.auth import current_user  # returns a dict like {"id": ...}

app = FastAPI()

class InvokeRequest(BaseModel):
    text: str
    thread_id: str | None = None

@app.post("/agent/invoke")
async def invoke(body: InvokeRequest, user = Depends(current_user)):
    thread_id = body.thread_id or f"user-{user['id']}"
    result = await compiled_graph.ainvoke(
        {"messages": [Message.text_message(body.text)]},
        config={
            "thread_id": thread_id,
            "user_id": user["id"],
            "recursion_limit": 25,
        },
    )
    last_message = result["messages"][-1]
    return {"role": last_message.role, "content": last_message.text()}

@app.post("/agent/stream")
async def stream(body: InvokeRequest, user = Depends(current_user)):
    thread_id = body.thread_id or f"user-{user['id']}"

    async def gen():
        async for chunk in compiled_graph.astream(
            {"messages": [Message.text_message(body.text)]},
            config={
                "thread_id": thread_id,
                "user_id": user["id"],
                "recursion_limit": 25,
            },
            response_granularity=ResponseGranularity.LOW,
        ):
            if chunk.event == StreamEvent.MESSAGE and chunk.message:
                payload = {
                    "role": chunk.message.role,
                    "content": chunk.message.text(),
                }
                yield f"data: {json.dumps(payload)}\n\n"
        yield "data: {\"done\": true}\n\n"

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        }
    )
```

The config dict is passed through to your nodes and tools. Keys like `user_id`, `thread_id`, and `recursion_limit` are standard; add your own for custom behavior. Tools receive config through a `config` parameter.

## Authentication patterns

### JWT from your existing service

If your FastAPI app validates JWTs, the `sub` claim (subject) typically contains the user ID or email. Extract it and pass it to `thread_id` or `user_id`:

```python
from fastapi import Header, HTTPException
import jwt
from typing import Annotated

SECRET_KEY = "your-secret"

async def current_user(authorization: Annotated[str, Header()]):
    try:
        token = authorization.removeprefix("Bearer ").strip()
        payload = jwt.decode(token, key=SECRET_KEY, algorithms=["HS256"])
        user_id = payload["sub"]  # the sub claim is the user identity
        return {"id": user_id, "email": payload.get("email")}
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

# Then in your route:
@app.post("/agent/invoke")
async def invoke(body: InvokeRequest, user = Depends(current_user)):
    thread_id = f"user-{user['id']}"  # or user['email'] if preferred
    # ...
```

The `sub` claim is the standard JWT claim for subject (the authenticated principal). Use it directly as the user identifier; it avoids the need for a lookup.

### API keys for service-to-service

For non-browser clients, validate API keys:

```python
from fastapi import Depends, Header, HTTPException
from typing import Annotated

VALID_KEYS = {"sk_prod_abc123": "service-a"}

async def verify_api_key(x_api_key: Annotated[str, Header()]):
    if x_api_key not in VALID_KEYS:
        raise HTTPException(status_code=403, detail="Invalid API key")
    return VALID_KEYS[x_api_key]

@app.post("/agent/invoke")
async def invoke_from_service(body: InvokeRequest, service = Depends(verify_api_key)):
    thread_id = f"service-{service}"
    # ...
```

## Streaming responses in detail

Server-sent events (SSE) require careful handling of headers, timeouts, and buffering.

**Headers:**
- `text/event-stream` tells the client to interpret the response as a stream of events.
- `X-Accel-Buffering: no` disables nginx buffering so events arrive immediately, not in a buffer.
- `Cache-Control: no-cache` prevents browsers from caching the stream.

**SSE format:**
- Each event is one or more lines.
- Lines starting with `data:` contain the payload.
- A blank line (`\n\n`) terminates the event.

```python
# Correct SSE format:
yield "data: {\"content\": \"hello\"}\n\n"

# JSON payloads must be on one line and properly escaped:
payload = {"content": "multi-line\ntext"}
yield f"data: {json.dumps(payload)}\n\n"
```

**Timeouts:**
- Default load balancer idle timeouts (ALB, Cloudflare) are often 60 seconds, shorter than a long agent run. Increase to 300+ seconds in production.
- Set `timeout=None` on the httpx client when proxying streams.

**Testing streams:**
- SSE streams are hard to test with standard HTTP clients. Use a stream-aware client or read line-by-line.

See [streaming concepts](/docs/concepts/streaming) for more on transports and granularity.

## Lifespan and shared resources

FastAPI's lifespan context manager runs code at startup and shutdown. Use it to initialize and close shared resources that the agent uses:

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from injectq import InjectQ

class Database:
    def __init__(self, engine):
        self.engine = engine

    async def close(self):
        await self.engine.dispose()

database: Database | None = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: initialize shared resources
    global database
    engine = create_async_engine("postgresql+asyncpg://user:pass@localhost/db")
    database = Database(engine)
    
    # Make it available to the graph via dependency injection
    container = InjectQ.get_instance()
    container.bind_instance(Database, database)
    
    print("App started. Database ready.")
    yield
    
    # Shutdown: clean up
    await database.close()
    print("App stopped. Database closed.")

app = FastAPI(lifespan=lifespan)
```

Tools can now receive the database:

```python
from injectq import Inject

def query_order(order_id: str, db: Database = Inject[Database]) -> dict:
    """Look up an order from the database."""
    # Use db to query; it is resolved from the container
    return db.query(order_id)
```

Injected parameters are filled from the InjectQ container, not the HTTP request. The container must be populated in the same process that runs the graph, so this works for the embedded setup.

## Testing embedded routes

Use `TestClient` from FastAPI to test your routes without spinning up a server. This approach tests the real auth, middleware, and dependency injection:

```python title="tests/test_agent_routes.py"
import json

import pytest
from fastapi.testclient import TestClient

from my_app.auth import current_user
from api.main import app


@pytest.fixture
def client():
    """Test client that replaces the real auth dependency."""
    app.dependency_overrides[current_user] = lambda: {"id": "test-user"}
    with TestClient(app) as c:  # runs the lifespan
        yield c
    app.dependency_overrides.clear()


def test_invoke_success(client):
    response = client.post("/agent/invoke", json={"text": "Hello, agent!"})
    assert response.status_code == 200
    data = response.json()
    assert "role" in data
    assert "content" in data


def test_stream_success(client):
    with client.stream("POST", "/agent/stream", json={"text": "Hello, agent!"}) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        events = [
            json.loads(line[len("data: "):])
            for line in response.iter_lines()
            if line.startswith("data: ")
        ]
    assert any(e.get("done") for e in events), "Stream should end with done event"


def test_auth_required():
    """Without the override, a bad token is rejected by your own dependency."""
    with TestClient(app) as c:
        response = c.post(
            "/agent/invoke",
            json={"text": "Hello, agent!"},
            headers={"Authorization": "Bearer not-a-token"},
        )
    assert response.status_code == 401
```

**For more realistic auth testing**, create a test auth backend:

```python
from fastapi import HTTPException, Request, Response
from tenxgraph_api import BaseAuth

class TestAuth(BaseAuth):
    def authenticate(self, request: Request, response: Response, credential):
        # Extract user from a test header
        user_id = request.headers.get("X-Test-User")
        if not user_id:
            raise HTTPException(status_code=401, detail="Missing X-Test-User")
        return {"user_id": user_id, "email": f"{user_id}@test.local"}
```

This is for the sidecar setup, where the `10xgraph-api` server runs the auth class named in `10xgraph.json`. `authenticate` must return a dict with a `user_id` key (or raise on failure); the returned keys are merged into the graph config.

## Dependency injection and shared state

When embedding, your tools and nodes can request dependencies from the InjectQ container. This lets the agent share database sessions, ML models, or configuration with your FastAPI app.

**In your FastAPI lifespan:**

```python
from injectq import InjectQ

container = InjectQ.get_instance()
container.bind_instance(Database, database_instance)
container.bind_instance(ModelCache, model_cache_instance)
```

**In your tools:**

```python
from injectq import Inject

def lookup_order(
    order_id: str,
    config: dict,
    db: Database = Inject[Database],
) -> dict:
    """Look up an order. `config` arrives at runtime; `db` is resolved from the container."""
    user_id = config["user_id"]
    return db.query(order_id, user_id)
```

The graph passes `config` at runtime (thread_id, user_id, custom fields); `db` is resolved from the container.

See [dependency injection guide](/docs/guides/use-dependency-injection) for the full list of injectable parameters and patterns.

## Sidecar vs. embedded: when to choose each

| Concern | Sidecar | Embedded |
|---|---|---|
| **Independent deploys** | Yes | No |
| **Shared DB session** | No (over HTTP) | Yes |
| **Scale agent independently** | Yes | No |
| **Single Docker image** | No | Yes |
| **Simpler setup** | No | Yes |
| **Less coupling** | Yes | No |
| **Direct Python calls** | No | Yes |

**Default to sidecar.** It decouples your app from the agent, scales independently, and lets you deploy them on different schedules. Embed only when you have shared state that is expensive to serialize (a database connection pool, a large model).

## Further reading

- [Run the API server](/docs/server/run-the-server): the `10xgraph-api` server as a standalone service
- [Configure the server](/docs/server/configure): `10xgraph.json` options
- [Streaming concepts](/docs/concepts/streaming): transports, granularity, and event model
- [Dependency injection](/docs/guides/use-dependency-injection): injectable parameters and InjectQ
- [Deployment guide](/docs/server/deploy): containers, Kubernetes, and production checklist
