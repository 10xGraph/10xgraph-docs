---
title: "Authorization scopes"
description: "Read the caller's identity and check permissions inside graph nodes and tools with get_identity, can and Identity."
order: 20
group: "Identity and roles"
section: "Security and access"
updated: "2026-11-08"
label: "Permissions in tools"
faq:
  - question: "What is the difference between identity and permissions?"
    answer: "Identity is the caller: user_id, tenant, roles and reach. Permissions are resource:action strings such as graph:invoke or store:read. The API server builds one Identity per request and puts it in config user, so your nodes and tools can read both."
  - question: "Can I use these functions in direct SDK calls?"
    answer: "Yes. Pass config user as an Identity or a dict that validates into one. If you pass none, get_identity returns None and can returns True, so there are no checks."
  - question: "Who fills the identity when I use the API server?"
    answer: "The API server fills config user after it authenticates and authorizes the request. It runs before your graph and clients cannot override it."
---

When your 10xGraph application runs over the API server, the caller's identity is added to the run config. Inside your nodes and tools you can read it to enforce fine-grained rules: restrict an operation to some callers, log who did what, or apply a policy like "only admins may export."

This guide covers `get_identity`, `can` and the `Identity` model, and how to use them in your agent code. Server-side configuration (roles, reach, the `auth` key) is in [API authentication](/docs/server/auth).

## How the identity reaches your code

The API server authenticates every request and resolves an `Identity` from the verified claims and the `auth` config. It stores it in `config["user"]` before your graph runs. Inside any node, tool or hook, read it with `get_identity`:

```python
from tenxgraph.core.authz import get_identity
from tenxgraph.utils import tool

@tool
def whoami(*, config):
    identity = get_identity(config)
    if identity is None:
        # Auth is off, or a direct SDK call with no user.
        return "No identity"
    return f"{identity.user_id} with roles {sorted(identity.roles)}"
```

`Identity` is a frozen model:

| Field | Meaning |
|---|---|
| `user_id` | The authenticated caller. Never empty. |
| `kind` | `user`, or `system` for a background-task identity. |
| `tenant` | Tenant values such as `{"org_id": "acme"}`, from `auth.tenant_claims`. |
| `roles` | The roles the caller holds (only those defined in `auth.roles`). |
| `permissions` | `resource:action` strings the caller holds. `None` means unrestricted (direct SDK, auth off). |
| `reach` | `own`, `tenant` or `all`. How far the caller's reads and deletes reach in storage. |
| `claims` | The raw verified claims, read-only. |

The identity also reads like a dict: `identity.get("email")`, `identity["user_id"]` and `"org_id" in identity` read the merged view of the claims, the tenant values and `user_id`, with `user_id` and tenant values winning over raw claims.

With auth off, `get_identity(config)` returns `None`.

## Check a permission

Use `identity.can(...)` or the helper `can(config, ...)` to gate operations:

```python
from tenxgraph.core.authz import can
from tenxgraph.core.state import ToolResult
from tenxgraph.utils import tool

@tool
def create_memory(text: str, *, config):
    """Store long-term memory, only for callers with store:write."""
    if not can(config, "store:write"):
        return ToolResult(
            message="You do not have permission to write to memory.", is_error=True
        )
    return f"Memory created: {text}"
```

The permission string is always `resource:action`. The registry the server knows:

| Resource | Actions |
|---|---|
| `graph` | `read`, `invoke`, `stream`, `stop`, `fix` |
| `threads` | `read`, `write`, `delete` |
| `store` | `read`, `write`, `delete` |
| `files` | `read`, `upload`, `delete` |
| `config` | `read` |
| `tasks` | `trigger`, `read`, `cancel` |
| `admin` | `read`, `write` |

`resource:*` matches every action of a resource and `*` matches everything. `admin:read` and `admin:write` guard no built-in route, so they are free for your own checks.

`can` returns `True` when there is no identity. Auth off or a direct SDK call without `config["user"]` means no checks.

## Control access inside a tool

Permissions guard API routes: a caller needs `graph:invoke` to start a run, and the server enforces that before your graph runs. What a tool may do once a run is going is up to you. A tool can take these parameters by name and 10xGraph injects them:

- `config`: the run config. `get_identity(config)` returns the `Identity`, and `can(config, "resource:action")` checks one permission.
- `state`, `tool_call_id`, `store`, `checkpointer` and the other injectable names listed in the [tools reference](/docs/reference/python/tools#per-tool-access-control).

Permission names are exact strings, but the server only accepts names from its registry in a role or a `permissions_claim`. To gate a tool, use a registry name such as `admin:write`, or check a role or claim directly:

```python
from tenxgraph.core.authz import get_identity
from tenxgraph.core.state import ToolResult
from tenxgraph.utils import tool


@tool
def refund_order(order_id: str, config: dict) -> ToolResult | str:
    """Refund an order."""
    identity = get_identity(config)
    if identity is None or "support" not in identity.roles:
        return ToolResult(
            message=(
                "Refunds need the support role, which this account does not have. "
                "Tell the user to contact an administrator."
            ),
            is_error=True,
        )
    return f"Order {order_id} refunded by {identity.user_id}."
```

`ToolResult(..., is_error=True)` marks the call as failed and puts your text in front of the model, so it can explain the refusal. If you raise an exception instead, the model only sees `Tool 'refund_order' failed with an internal error (reference ...)` and the detail goes to the server log. Raise when you want an operator to investigate. Return a `ToolResult` when the refusal is an expected answer.

Keep in mind:

- With no identity (direct SDK calls, or an API server with `"auth": null`), `can()` returns `True`. A tool that must never run without auth should check `get_identity(config) is None` itself and refuse.
- With roles configured, a caller who holds no role has an empty `permissions` set, so `can()` is `False` for everything. Give such users a `default_role`.

You can apply the same check to every tool in one place with a `before_invoke` callback on `InvocationType.TOOL`: `context.function_name` is the tool name and `context.metadata["config"]` is the run config. Raise from the callback to block the call, or keep a dict that maps tool names to required permissions. See [Use callbacks](/docs/guides/use-callbacks).

## Read caller identity inside tools and nodes

The `user_id` tells you who made the request. Use it to log actions or associate resources with owners:

```python
from tenxgraph.core.authz import get_identity
from tenxgraph.utils import tool

@tool
def my_notes(*, config):
    """List the caller's notes."""
    identity = get_identity(config)
    if identity is None:
        return []
    return find_notes_for(identity.user_id, identity.tenant)  # your own storage
```

For the framework's own storage (checkpointer, store, files) you do not filter by hand. Each query already filters by the caller's reach, see [Multi-tenant data](/docs/guides/multi-tenant-data).

## Reach and shared data

`identity.reach` is what the storage layer uses to filter every query:

| Reach | Storage returns |
|---|---|
| `own` | Rows of this `user_id` within their tenant. |
| `tenant` | Rows of every user with the same tenant values. |
| `all` | Every row. |

Reach widens reads, lists, deletes and stop. Runs and state or message writes always stay on the caller's own threads. Shared data written under a `__system__:<name>` owner (agent memory, RAG knowledge bases) is pinned to that owner on every reach, so a wider reach never reads other users' rows through a shared-data query.

Call `owner_filter(config, tenant_columns)` and `can_reach(config, user_id, tenant)` from `tenxgraph.core.authz` if you write your own storage and want to follow the same rules. `owner_filter` returns the column filters a query must apply, or `None` when there is no identity.

## Example: a tool set with role checks

```python
from tenxgraph.core.authz import can, get_identity
from tenxgraph.core.state import ToolResult
from tenxgraph.prebuilt.agent import ReactAgent
from tenxgraph.utils import tool

# Stand-in storage layer for the example; use your own database.
NOTES: dict[str, list[str]] = {}


@tool
def list_notes(*, config) -> str:
    """List notes belonging to the current user."""
    identity = get_identity(config)
    if identity is None:
        return "Error: no identity"
    notes = NOTES.get(identity.user_id, [])
    return f"Found {len(notes)} notes for {identity.user_id}"


@tool
def create_note(text: str, *, config) -> str | ToolResult:
    """Create a note, only for callers with store:write."""
    if not can(config, "store:write"):
        return ToolResult(message="Missing permission: store:write.", is_error=True)
    identity = get_identity(config)
    user_id = identity.user_id if identity else "anonymous"
    NOTES.setdefault(user_id, []).append(text)
    return f"Note created for {user_id}"


@tool
def export_data(format: str, *, config) -> str | ToolResult:
    """Export data, only for callers with admin:read."""
    if not can(config, "admin:read"):
        return ToolResult(message="Missing permission: admin:read.", is_error=True)
    return f"Exported {format}"


agent = ReactAgent(
    model="gemini/gemini-2.5-flash",
    tools=[list_notes, create_note, export_data],
)
compiled = agent.compile()
```

Install with `pip install "10xgraph[google-genai]"`. Over the API server:

1. The caller authenticates (JWT or a custom `BaseAuth`).
2. The server resolves the `Identity` and `authorize` allows `graph:invoke`.
3. Your graph runs with the identity in `config["user"]`.
4. Each tool calls `get_identity()` or `can()`. A refusal returns a `ToolResult` with `is_error=True`, which the model can relay to the user.

## Direct SDK calls

When you call `CompiledGraph.invoke()` directly in Python (not over the API server), your process is the trust boundary. Build the identity yourself from your own verified session:

```python
from tenxgraph.core.authz import Identity, Reach
from tenxgraph.core.state import Message

identity = Identity(
    user_id="alice",
    tenant={"org_id": "acme"},
    permissions=frozenset({"graph:invoke", "threads:read", "store:write"}),
    reach=Reach.OWN,
)

result = compiled.invoke(
    {"messages": [Message.text_message("List my notes")]},
    config={"user": identity, "thread_id": "session-1"},
)
```

`config["user"]` also takes a dict that validates into an `Identity`. An unknown key raises. With `permissions` left as `None` the identity is unrestricted. Without any `user`, `get_identity()` returns `None` and there are no checks.

## How the API server fills the identity

For every route, the `RequirePermission` dependency does this once per request:

1. **Authenticate.** The bearer token (JWT or a custom `BaseAuth`) is verified and decoded to claims. A failure is 401.
2. **Resolve.** The claims become an `Identity`: roles, permissions, tenant values and reach, with token `scope` claims narrowing the permissions. A missing tenant claim or a malformed roles or permissions claim is 401.
3. **Check for revocation and reserved ids.** A revoked token is 401. A `__system__` user id is 401.
4. **Authorize.** `BaseAuth.authorize(identity, "resource:action", resource)` decides. A refusal is 403.
5. **Place in config.** Every service copies the identity into `config["user"]`, so it reaches your code. Clients cannot set `user`.

This flow is in `tenxgraph_api/src/app/core/auth/permissions.py`. For configuration, see [API authentication](/docs/server/auth).

## Common errors and fixes

**Tool result "Missing permission: store:write"**

The caller does not hold the permission. This happens when:

- The caller's role does not include it, or the caller holds no role and `default_role` is not set.
- A token `scope` or `scopes` claim narrows the permissions below it.
- The token's `permissions_claim` does not list it.

Fix: check `auth.roles`, `default_role` and the token claims. `GET /v1/me` shows the roles, permissions and reach the server resolved for a token.

**`get_identity()` returns None inside a tool**

This is not an error. Either auth is off on the server (`"auth": null`) or you are calling the graph directly without a `config["user"]`. In both cases `can()` returns `True`, so handle the `None` case in code that must not run without a caller.

**A user reaches `404` for a thread they know exists**

The thread is outside the caller's reach: another user's thread, or another tenant's. Storage filters every query, so the server cannot tell it apart from a missing id. Give the viewer a role with reach `tenant` to read a colleague's thread, or check the token's tenant claim.

## Related pages

- [API authentication](/docs/server/auth): Configure roles, reach and custom `authorize` on the API server.
- [Multi-tenant data](/docs/guides/multi-tenant-data): Tenant columns and how reach filters storage.
- [Protect against prompt injection](/docs/guides/protect-against-prompt-injection): Additional safety patterns for input validation.
- [Use dependency injection](/docs/guides/use-dependency-injection): Access config and other dependencies in nodes and tools.
- [Security and validators](/docs/concepts/security-and-validators): Design patterns for secure agent systems.
