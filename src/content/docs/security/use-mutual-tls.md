---
title: "Use mutual TLS"
seoTitle: "Mutual TLS (mTLS) for a 10xGraph app"
description: "Run each link of a 10xGraph app over mutual TLS: client to API through a proxy, and API to Postgres, Redis, the LLM and MCP, with a working snippet for each."
section: "Security and access"
group: "Zero trust"
order: 66
label: "Use mutual TLS"
updated: "2026-11-25"
faq:
  - question: "Does 10xGraph terminate TLS itself?"
    answer: "No. TLS and mTLS between your callers and the API end at your proxy or service mesh. For the links the app opens (Postgres, Redis, LLM, MCP) you give the client a certificate."
  - question: "Why do Python 3.13 and later reject my test certificate?"
    answer: "Python 3.13 turned on strict certificate checks. A certificate without the Authority Key Identifier and Subject Key Identifier extensions fails with 'Missing Authority Key Identifier'. Generate your certificates with both."
  - question: "Which httpx client does http_client take?"
    answer: "openai 3.x and anthropic 1.x take an httpx2.AsyncClient. google-genai 1.x and 2.x take an httpx.AsyncClient, and 3.x takes either."
---

Mutual TLS (mTLS) means both sides of a connection show a certificate. The server proves who it is, and the client proves who it is too. A connection without a valid client certificate is refused before any request is read.

A 10xGraph app has five links. This page shows how to put each one behind mTLS. It is the longer version of the transport table in [Zero-trust agents](/docs/security/zero-trust-agents#transport-mtls-on-each-link). Each snippet was run against real servers: nginx, Postgres, Redis, an LLM endpoint and an MCP server, each refusing a missing or wrong certificate.

| Link | Where mTLS is set |
|---|---|
| Client to API | Your proxy or mesh |
| API to Postgres | The DSN, or your own asyncpg pool |
| API to Redis | A `rediss://` URL, or your own Redis pool |
| API to the LLM | `http_client=` on the `Agent` |
| API to MCP | `ToolNode(client=...)` |

In the examples, `/certs/ca.crt` is your CA, and `api.crt` and `api.key` are the client certificate of your app.

## Client to API

10xGraph does not terminate TLS. Your proxy or service mesh (nginx, Envoy, Istio, Linkerd) checks the client certificate and passes the verified identity on. The API reads it with a custom `BaseAuth`.

nginx:

```nginx
ssl_client_certificate /certs/ca.crt;
ssl_verify_client      on;

location / {
  proxy_pass http://api:8000;
  # Overwrite whatever the caller sent in these headers
  proxy_set_header X-Client-Verify       $ssl_client_verify;
  proxy_set_header X-Client-Cert-Subject $ssl_client_s_dn;     # "CN=alice,O=..."
  proxy_set_header X-Proxy-Token         "<shared secret>";
  proxy_buffering off;                                          # keeps streaming working
}
```

A caller with no certificate, or one from another CA, gets a 400 from nginx and never reaches the API.

In `10xgraph.json`:

```json
{
  "auth": {"method": "custom", "path": "app.auth:ProxyCertAuth"}
}
```

```python
import hmac
import os

from fastapi import HTTPException

from tenxgraph_api import BaseAuth

TRUSTED_PROXIES = {"10.0.0.5"}  # the proxy's address as the API sees it


def common_name(subject: str) -> str | None:
    # nginx writes the subject as "CN=alice,O=acme"
    for part in subject.split(","):
        key, _, value = part.strip().partition("=")
        if key == "CN" and value:
            return value
    return None


class ProxyCertAuth(BaseAuth):
    async def authenticate(self, request, response, credential):
        source = request.client.host if request.client else None
        token = request.headers.get("x-proxy-token", "")
        if source not in TRUSTED_PROXIES or not hmac.compare_digest(token, os.environ["PROXY_TOKEN"]):
            raise HTTPException(401, "Not from the trusted proxy")
        if request.headers.get("x-client-verify") != "SUCCESS":
            raise HTTPException(401, "Client certificate not verified")
        subject = request.headers.get("x-client-cert-subject", "")
        user = common_name(subject)
        if not user:
            raise HTTPException(401, "No CN in client certificate")
        return {"user_id": user, "cert_subject": subject}

    async def downstream_credential(self, connection, credential, claims):
        return None  # no bearer token to pass on to tools
```

The returned `user_id` is the certificate's CN, so threads and memories belong to it.

Trust these headers only from the proxy. Two rules:

- Bind the API where only the proxy can reach it (a private network, a Unix socket or a pod-local port). A caller that reaches the API directly can send any header.
- Check the proxy's address and a shared secret, as above. The address alone is not enough when other processes share the proxy's host. Have the proxy set the secret on every request, and keep it out of the repo.

Call it with the client certificate:

```bash
curl --cacert ca.crt --cert alice.crt --key alice.key \
  https://api.example/v1/graph/invoke -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":[{"type":"text","text":"hi"}]}]}'
```

You can combine this with JWT. Keep `"auth": "jwt"`, let the proxy do mTLS, and pass the `Authorization` header through unchanged. A caller then needs both a certificate and a token. See [Authentication and roles](/docs/server/auth).

## API to Postgres

Put the certificate settings in the DSN. asyncpg reads the libpq names:

```python
from tenxgraph.storage.checkpointer import PgCheckpointer

checkpointer = PgCheckpointer(
    postgres_dsn=(
        "postgresql://tenxgraph_api@db.internal:5432/app"
        "?sslmode=verify-full&sslrootcert=/certs/ca.crt"
        "&sslcert=/certs/api.crt&sslkey=/certs/api.key"
    ),
    redis_url=REDIS_URL,
)
```

Or build the pool yourself and pass it in. The pool must be created inside the server's event loop, so give `10xgraph.json` an async graph factory (`"agent": "app.graph:make_app"`). A pool built at import time belongs to another loop.

```python
import ssl

import asyncpg

from tenxgraph.storage.checkpointer import PgCheckpointer


async def make_app():
    ctx = ssl.create_default_context(cafile="/certs/ca.crt")  # checks the host name too
    ctx.load_cert_chain("/certs/api.crt", "/certs/api.key")
    pg_pool = await asyncpg.create_pool(
        "postgresql://tenxgraph_api@db.internal:5432/app", ssl=ctx
    )
    checkpointer = PgCheckpointer(pg_pool=pg_pool, redis_pool=redis_pool())
    return agent.compile(checkpointer=checkpointer)
```

On the server, set `ssl = on` and `ssl_ca_file`, and allow only `hostssl ... cert` lines in `pg_hba.conf`, with no plain `host` line. With the `cert` method the certificate's CN must equal the database role, here `tenxgraph_api`.

## API to Redis

Use a `rediss://` URL with redis-py's `ssl_*` options:

```python
REDIS_URL = (
    "rediss://redis.internal:6379/0?ssl_ca_certs=/certs/ca.crt"
    "&ssl_certfile=/certs/api.crt&ssl_keyfile=/certs/api.key&ssl_cert_reqs=required"
)
PgCheckpointer(postgres_dsn=..., redis_url=REDIS_URL)
```

Or pass a pool of your own:

```python
from redis.asyncio import BlockingConnectionPool

pool = BlockingConnectionPool.from_url(
    "rediss://redis.internal:6379/0",
    ssl_ca_certs="/certs/ca.crt",
    ssl_certfile="/certs/api.crt",
    ssl_keyfile="/certs/api.key",
    ssl_cert_reqs="required",
)
PgCheckpointer(postgres_dsn=..., redis_pool=pool)
```

The API `cache_store` holds rate limits, run locks and token revocation, so it needs the same treatment. Use the same URL:

```json
{"cache_store": {"type": "redis", "url": "${REDIS_URL}"}}
```

Use absolute certificate paths in that URL. A relative path is resolved against the server's working directory.

Or build the client yourself with `type` `custom`:

```json
{"cache_store": {"type": "custom", "path": "app.cache:make_store"}}
```

```python
from redis.asyncio import Redis

from tenxgraph_api import RedisCacheStore


def make_store() -> RedisCacheStore:
    return RedisCacheStore(client=Redis(connection_pool=pool))  # pool as above
```

On the Redis server, run `--port 0 --tls-port 6379 --tls-cert-file ... --tls-key-file ... --tls-ca-cert-file ... --tls-auth-clients yes`.

## API to the LLM

Pass an `http_client` to the `Agent`. It goes straight to the provider SDK, for OpenAI, Anthropic and Google Gemini (the Gemini Developer API and Vertex AI). Point `base_url` at the endpoint that asks for the client certificate, for example an LLM gateway.

```python
import ssl

import httpx2

from tenxgraph.prebuilt.agent import ReactAgent

ctx = ssl.create_default_context(cafile="/certs/ca.crt")
ctx.load_cert_chain("/certs/api.crt", "/certs/api.key")

agent = ReactAgent(
    model="claude-haiku-4-5",
    base_url="https://llm-gateway.internal",
    api_key="...",
    http_client=httpx2.AsyncClient(verify=ctx),
    tools=[...],
)
```

The client type has to match the installed SDK. The wrong one fails at request time, or, for Gemini, when the Agent is built.

| SDK | `http_client` type |
|---|---|
| `anthropic` 1.x | `httpx2.AsyncClient` |
| `openai` 3.x | `httpx2.AsyncClient` |
| `openai` 1.x and 2.x | `httpx.AsyncClient` |
| `google-genai` 1.x and 2.x | `httpx.AsyncClient` |
| `google-genai` 3.x | `httpx.AsyncClient` or `httpx2.AsyncClient` |

For Gemini, the client becomes `HttpOptions.httpx_async_client`. The SDK does not close your client. `use_vertex_ai=True` works the same way:

```python
agent = ReactAgent(
    model="gemini-2.5-flash",
    provider="google",
    base_url="https://gemini-gateway.internal",
    api_key="...",
    http_client=httpx2.AsyncClient(verify=ctx),  # httpx.AsyncClient with google-genai 1.x/2.x
)
```

### Fallbacks

- A fallback on the same provider reuses the Agent's `http_client`.
- A `(model, provider)` fallback on another provider raises `ValueError` when the Agent is built. The primary's client was made for another SDK and another host, so it would fail, or the request would leave without mTLS.
- Give a fallback on another provider its own client with a `model_registry` entry, and name the entry in `fallback_models`:

```python
agent = ReactAgent(
    model="gemini",
    model_registry={
        "gemini": {
            "model": "gemini-2.5-flash",
            "provider": "google",
            "base_url": "https://gemini-gateway.internal",
            "http_client": gemini_http,
        },
        "claude": {
            "model": "claude-haiku-4-5",
            "provider": "anthropic",
            "base_url": "https://llm-gateway.internal",
            "http_client": claude_http,
        },
    },
    fallback_models=["claude"],
)
```

See [Model registry](/docs/reference/python/agent#model-registry).

## API to MCP

Build your own fastmcp client with the certificate and pass it to the tool node:

```python
import ssl

from fastmcp import Client
from fastmcp.client.transports import StreamableHttpTransport

from tenxgraph.prebuilt.agent import ReactAgent

ctx = ssl.create_default_context(cafile="/certs/ca.crt")
ctx.load_cert_chain("/certs/api.crt", "/certs/api.key")

mcp = Client(StreamableHttpTransport("https://mcp.internal/mcp", verify=ctx))
agent = ReactAgent(model="claude-haiku-4-5", tools=[get_weather], client=mcp)
# or: ToolNode([...], client=mcp)
```

## Things to know

- **Certificates need key identifiers.** Python 3.13 and later reject a certificate without the Authority Key Identifier and Subject Key Identifier extensions ("Missing Authority Key Identifier"). redis-py hit this. With openssl, add `subjectKeyIdentifier=hash` and `authorityKeyIdentifier=keyid,issuer` to the extensions when you sign.
- **Rate limits behind a proxy.** A request that fails authentication is keyed by `ip:`, and behind a proxy that is the proxy's address for every caller. Have the proxy send `X-Forwarded-For`, and set `trusted_proxy_headers` and `trusted_proxies` in the `rate_limit` block of `cache_store`. See [Rate limiting](/docs/server/rate-limiting#behind-a-reverse-proxy).
- **Test the refusals too.** A link that works with a certificate proves little. Also check that it fails with no certificate, and with one from another CA.

## Not covered today

- **Gemini Live.** The realtime Gemini client builds its client without an `http_client`, and its audio session uses websockets. There is no custom client path.
- **WebSocket routes through the proxy.** They were not tested with mTLS.
- **OpenAI.** The OpenAI path passes `http_client` the same way as Anthropic, but the check ran against an Anthropic-format and a Gemini-format endpoint only.

For these, use mTLS from your mesh at the network level.
