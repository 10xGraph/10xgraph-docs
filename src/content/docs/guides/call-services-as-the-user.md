---
title: Calling services as the user
description: "Authenticate MCP servers and local tools as the current user with get_credential and mcp_auth: M2M, self-issued tokens or RFC 8693 token exchange."
section: "Security and access"
group: "Identity and roles"
order: 30
label: "Call services as the user"
updated: "2026-11-11"
faq:
  - q: "Can I forward the user's token to my MCP server?"
    a: "Only if that server accepts the same token, meaning the token was issued for it. Sending a token to a server it was not issued for is token passthrough, which the MCP spec forbids. Use forward_credential for that one case, and a token exchange, a service token or a self-issued token otherwise."
  - q: "Does the credential reach logs, events or checkpoints?"
    a: "No. The credential lives in the run config only. Config copies that leave the run (publisher events, callbacks, traces) go through public_config, which drops it. It is never sent in MCP _meta and never given to background tasks."
  - q: "Why do tool lists have to be the same for every user?"
    a: "ToolNode caches the MCP tool list once and shares it across all users. The listing runs mcp_auth with whichever run asks first, so a server that returns a different list per user would show one user's tools to everyone."
  - q: "Which MCP transports support mcp_auth?"
    a: "Streamable HTTP and SSE. Stdio and in-memory transports cannot carry HTTP headers and are refused. mcp_auth also needs fastmcp 4.1.7 or later."
---

An agent often has to call another service on behalf of the person who started the run: an internal API, an MCP server, a data service. This guide shows how to hand your code the caller's identity and credential at the right moment, and which authentication pattern to build with it.

10xGraph never picks the scheme. It has no OAuth client, no token exchange and no token cache. It gives your function the verified caller and the raw credential, you return the headers, and it keeps the credential out of everything else.

## Why this is a hook and not a setting

One shared MCP client serves every user of your server at once. A fixed `Authorization` header on the client would make every user act as the same identity. So the headers are computed per call, from the run that makes the call.

The credential stays inside the run. It is not written to logs, publisher events, checkpoints, traces, MCP `_meta` or background tasks. The `UserCredential` object prints as `UserCredential(scheme='Bearer', token='**********')`, and `json.dumps` and pickling raise an error, so a leak fails loudly instead of writing a token to disk.

## Choose a pattern

| Pattern | Use it when |
|---|---|
| 1. Forward the user's token | The service is your own and accepts the same token (same audience). Otherwise, do not. |
| 2. M2M service token plus asserted identity | The service trusts your app and only needs to know the user for filtering or audit. |
| 3. Self-issued short-lived token | You control the service and can verify a token your app signs. |
| 4. RFC 8693 token exchange | Your identity provider (IdP) can issue a token for the user, scoped to the target service. Best fit for third-party or zero-trust setups. |

**1. Forward the user's token.** Token passthrough is forbidden by the MCP spec: a server must only accept tokens issued for itself. The only safe case is your own server that accepts the same token. `forward_credential` exists for that case and nothing else.

**2. M2M token plus asserted identity.** Your app authenticates to the server with its own service token, set on the transport with `auth=`. The user comes along as data: `pass_user_info_to_mcp=True` sends the caller in the MCP request metadata, and the server reads `ctx.request_context.meta["user"]`. The server must authenticate the calling app first and only then trust `_meta.user`. An unauthenticated caller can claim any user. See [Use MCP tools](/docs/guides/use-mcp#forwarding-user-context-to-mcp).

**3. Self-issued delegation token.** Your app signs a short-lived token for the user (5 minutes, one audience) and the service verifies it with your public key. The service gets a real, expiring, user-scoped credential without an IdP round trip.

**4. Token exchange.** Your app sends the user's token to the IdP and gets back a token for the target audience, as in [RFC 8693](https://www.rfc-editor.org/rfc/rfc8693). The service sees a token the IdP issued for it, with the user as subject.

## Wiring

### Local tools

A tool parameter named `credential` is injected by name and hidden from the model. It is always a `UserCredential`, or `None` when the run has none, whatever the annotation. A different annotation logs one warning when the tool is registered.

```python title="tools.py"
import httpx

from tenxgraph.core.authz import UserCredential


async def get_invoices(customer_id: str, credential: UserCredential | None = None) -> dict:
    """Fetch a customer's invoices from the billing API."""
    if credential is None:
        raise PermissionError("No credential on this run")
    headers = {"Authorization": f"{credential.scheme} {credential.token.get_secret_value()}"}
    async with httpx.AsyncClient(base_url="https://billing.internal") as http:
        resp = await http.get(f"/customers/{customer_id}/invoices", headers=headers)
        resp.raise_for_status()
        return resp.json()
```

Only this tool receives the credential. The `before` and `after` tool callbacks never see it in their input data.

### Nodes

In your own nodes, read it from the config:

```python title="nodes.py"
from tenxgraph.core.authz import get_credential, get_identity

async def call_service(state, config):
    identity = get_identity(config)      # who the caller is
    credential = get_credential(config)  # the raw credential, or None
    ...
```

`get_credential` raises `TypeError` if `config["credential"]` is anything other than a `UserCredential`. Do not pass the raw string.

### MCP calls

Pass an async function as `mcp_auth` on `ToolNode`, or on `ReactAgent`, `PlanActReflectAgent`, `StructuredOutputAgent` and `AudioAgent`. It runs before every MCP tool listing and tool call and returns the headers for that one request.

```python title="graph.py"
from fastmcp import Client

from tenxgraph.core.graph import ToolNode
from tenxgraph.core.graph.tool_node import MCPAuthContext, forward_credential

client = Client("https://tools.internal/mcp")

# Pattern 1, only for a server that accepts the user's own token:
tool_node = ToolNode(tools=[], client=client, mcp_auth=forward_credential)

# Any other pattern: your own function.
async def my_auth(ctx: MCPAuthContext) -> dict[str, str]:
    return {"Authorization": "Bearer ..."}
```

`MCPAuthContext` has these fields:

| Field | Meaning |
|---|---|
| `identity` | The caller from `config["user"]`, or `None`. |
| `credential` | The `UserCredential`, or `None`. |
| `tool_name` | The MCP tool being called, or `None` while the tool list is fetched. |
| `server` | The server URL of the client's transport. |
| `thread_id` | The run's thread id. |
| `run_id` | The run id. |

```python
from tenxgraph.prebuilt.agent import ReactAgent

agent = ReactAgent(
    model="openai/gpt-4o",
    client=client,
    mcp_auth=my_auth,
)
```

### Transport mTLS and fixed service tokens

`mcp_auth` adds to the transport, it does not replace it. Keep mutual TLS and a fixed M2M token on the transport. The `StreamableHttpTransport` constructor takes `url`, `headers`, `auth`, `httpx_client_factory` and `verify`. `verify` accepts a bool, a CA bundle path or an `ssl.SSLContext`, and is ignored when `httpx_client_factory` is set.

```python title="graph.py"
import ssl

from fastmcp import Client
from fastmcp.client.transports import StreamableHttpTransport

ctx = ssl.create_default_context(cafile="ca.pem")
ctx.load_cert_chain("client.pem", "client.key")

transport = StreamableHttpTransport(
    "https://tools.internal/mcp",
    auth=m2m_auth,  # an httpx2.Auth for a fixed service token (pattern 2)
    verify=ctx,
)
client = Client(transport)
```

If you need full control of the HTTP client, pass `httpx_client_factory=` instead of `verify=`. The factory must accept the keyword arguments `headers`, `auth` and `follow_redirects`, and `timeout` when it uses one. Use `**kwargs` to stay compatible.

## Example: RFC 8693 token exchange

This `mcp_auth` exchanges the user's token at the IdP for a token scoped to the MCP server, and caches it per user and audience until shortly before it expires.

```python title="exchange.py"
import time

import httpx

from tenxgraph.core.graph.tool_node import MCPAuthContext

TOKEN_URL = "https://idp.example.com/oauth2/token"
AUDIENCE = "https://tools.internal/mcp"
_cache: dict[tuple[str, str], tuple[str, float]] = {}  # (user_id, audience) -> (token, expiry)


async def exchange_auth(ctx: MCPAuthContext) -> dict[str, str]:
    if ctx.credential is None or ctx.identity is None:
        raise PermissionError("Token exchange needs a signed-in user")
    key = (ctx.identity.user_id, AUDIENCE)
    token, expires_at = _cache.get(key, ("", 0.0))
    if time.monotonic() >= expires_at:
        async with httpx.AsyncClient() as http:
            resp = await http.post(TOKEN_URL, data={
                "grant_type": "urn:ietf:params:oauth:grant-type:token-exchange",
                "subject_token": ctx.credential.token.get_secret_value(),
                "subject_token_type": "urn:ietf:params:oauth:token-type:access_token",
                "audience": AUDIENCE,
            }, auth=("my-app-client-id", "my-app-client-secret"))
        resp.raise_for_status()
        body = resp.json()
        token = body["access_token"]
        # Refresh 30 seconds early so a cached token never expires mid-call.
        _cache[key] = (token, time.monotonic() + body.get("expires_in", 300) - 30)
    return {"Authorization": f"Bearer {token}"}
```

The cache is in process memory and keyed by user, so one user never gets another user's token. For several workers, use a shared store, or accept one exchange per worker.

## Example: self-issued short-lived token

This `mcp_auth` signs a 5 minute JWT with PyJWT (`pip install pyjwt[crypto]`). The service verifies it with the matching public key and checks `aud`.

```python title="delegation.py"
import os
import time

import jwt

from tenxgraph.core.graph.tool_node import MCPAuthContext

PRIVATE_KEY = os.environ["DELEGATION_PRIVATE_KEY"]


async def delegation_auth(ctx: MCPAuthContext) -> dict[str, str]:
    if ctx.identity is None:
        raise PermissionError("Delegation needs a signed-in user")
    now = int(time.time())
    claims = {
        "iss": "my-agent-app",
        "aud": ctx.server,
        "sub": ctx.identity.user_id,
        "org_id": (ctx.identity.tenant or {}).get("org_id"),
        "iat": now,
        "exp": now + 300,
    }
    token = jwt.encode(claims, PRIVATE_KEY, algorithm="RS256", headers={"kid": "agent-app-1"})
    return {"Authorization": f"Bearer {token}"}
```

Sign with a key that only your app holds, keep the lifetime short, and have the service reject any token whose `aud` is not itself.

## Behind the API server

The 10xGraph API sets `config["credential"]` for you on invoke and stream runs (resume included), WebSocket runs and AG-UI runs. It is a `UserCredential` holding the bearer token the API just verified. Clients cannot send it: `credential` is a reserved config key, so a value a request sends is dropped and never reaches the run.

If your callers authenticate with something other than a bearer token (a cookie, an API key), override `BaseAuth.downstream_credential` in your custom auth class. It is `async`, so it can call an identity provider. It returns the `UserCredential` to hand to your tools, or `None` for no credential:

```python title="auth/custom_auth.py"
from tenxgraph.core.authz import UserCredential
from tenxgraph_api import BaseAuth

class SessionAuth(BaseAuth):
    async def downstream_credential(self, connection, credential, claims):
        session = connection.cookies.get("session")
        return UserCredential(session, scheme="Session") if session else None
```

The default returns the verified bearer token. See [API authentication](/docs/server/auth#custom-authentication-and-authorization) for the rest of `BaseAuth`.

## Things to know

- **fastmcp 4.1.7 or later.** `mcp_auth` needs it, and `ToolNode` refuses to start with an older version and says so. The `mcp` extra already requires it: `pip install "10xgraph[mcp]"`.
- **HTTP transports only.** Streamable HTTP and SSE. Stdio and in-memory clients cannot carry headers.
- **The tool list is shared.** `ToolNode` caches the MCP tool list once and serves it to all users. The listing runs `mcp_auth` with the first caller's context. A server must return the same tools to everyone, or you turn the cache off with `mcp_cache_tools=False`.
- **Header precedence.** Headers from `mcp_auth` win over the transport's `auth=` on the same header name. Other headers from the transport are kept.
- **The session opens once.** The MCP `initialize` request uses the headers of the call that opened the session. Do not put per-user decisions in `initialize`; the server should decide per request.
- **Background tasks get no credential.** Task payloads and results are stored in your queue and result backend, so they carry user data only (`user_id`, tenant, roles, claims). A job that calls a service uses an M2M token or a self-issued token, never the user's.
- **Nothing is sent by default.** Without `mcp_auth` and without a tool that reads `credential`, nothing changes.

## Related pages

- [Use MCP tools in agents](/docs/guides/use-mcp): Connect MCP servers and send the caller as `_meta.user`.
- [Authorization scopes](/docs/guides/authorization-scopes): Read the caller and check permissions in tools and nodes.
- [API authentication](/docs/server/auth): Configure `auth`, roles and `BaseAuth`.
- [Run background jobs](/docs/server/background-tasks): Why jobs get user data and no credential.
