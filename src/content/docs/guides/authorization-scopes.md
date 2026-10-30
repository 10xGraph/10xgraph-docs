---
title: "Authorization scopes"
description: "Read caller identity and enforce scopes inside graph nodes and tools using get_authz, has_scope, and isolation_scope."
order: 380
group: "Safety"
section: "Build agents"
updated: "2026-10-29"
label: "Authorization scopes"
faq:
  - question: "What is the difference between identity and scopes?"
    answer: "Identity is the caller (user_id), set by the auth system. Scopes are permissions - each scope is a resource:action pair like graph:invoke or store:read. The API server stamps both into config user authz so your nodes and tools can enforce them."
  - question: "Can I use these functions in direct SDK calls?"
    answer: "Yes. In direct calls to CompiledGraph.invoke(), you build the authz block yourself and pass it in config authz. If you do not pass one, all functions return permissive defaults (all scopes allowed, no isolation)."
  - question: "Who fills the authz block when I use the API server?"
    answer: "The API server's auth system (RequirePermission) fills user authz server-side after authenticating and authorizing the request. This happens before your graph runs and is non-hijackable - clients cannot override it."
---

When your 10xGraph application runs over the API server, the caller's identity and scopes are automatically added to the request. Inside your nodes and tools, you can read this information to enforce fine-grained permissions: restrict certain operations to authorized users, log who performed actions, or apply policies like "only the thread owner can read this."

This guide covers the three authorization functions, `get_authz`, `has_scope`, and `isolation_scope`, and how to use them in your agent code.

## How authorization reaches your code

The API server authenticates every request and builds an authorization context from the verified identity and the configured authorization backend. This context is stamped into `config["user"]["authz"]` before your graph runs. Inside any node, tool, or hook, you can access this information through the config:

```python
from tenxgraph.core.authz import get_authz, has_scope
from tenxgraph.utils import tool

@tool
def sensitive_operation(*, config):
    authz = get_authz(config)
    if authz is None:
        # No authz context, either direct SDK call with no authz,
        # or auth is not configured on the server.
        print("No authorization context")
        return "Allowed (no policy)"
    
    user_id = authz.get("user_id")
    scopes = authz.get("scopes", [])
    print(f"User {user_id} has scopes: {scopes}")
    return f"Operation performed by {user_id}"
```

When you run over the API server with auth enabled, `get_authz()` always returns a dict with three keys:

- `user_id`: The authenticated caller's identity.
- `scope`: The data isolation policy (`"owner"` or `"none"`).
- `scopes`: A list of resource:action permissions the caller holds.

When no auth is configured, `get_authz()` returns `None`, and all scopes are implicitly allowed. If auth is on but the identity carries no scopes and the backend defines none, the block is stamped with an empty `scopes` list and `has_scope()` returns `False` for every scope.

## Check if a caller has a specific scope

Use `has_scope()` to gate operations behind permissions:

```python
from tenxgraph.core.authz import has_scope
from tenxgraph.core.state import ToolResult

@tool
def create_memory(text: str, *, config):
    """Store long-term memory, only for users with store:write scope."""
    if not has_scope(config, "store:write"):
        return ToolResult(
            message="You do not have permission to write to memory.", is_error=True
        )
    
    # Proceed with the memory operation
    return f"Memory created: {text}"
```

The scope string is always `"resource:action"`. The full list of scopes is:

- Graph execution: `graph:invoke`, `graph:stream`, `graph:stop`, `graph:fix`, `graph:read`
- Thread state (checkpointer): `checkpointer:read`, `checkpointer:write`, `checkpointer:delete`
- Thread import (admin only): `checkpointer:import`
- Long-term memory (store): `store:read`, `store:write`, `store:delete`
- Media and files: `files:read`, `files:upload`, `files:delete`
- Configuration: `config:read`

The built-in scopes guard API routes. Names you define yourself work the same way inside tools (see [Control access inside a tool](#control-access-inside-a-tool)).

`files:delete` guards `DELETE /v1/files/{file_id}`. Only the uploader can delete a file even with the scope: a missing file or someone else's file returns 404. A role of `"*"` includes it.

`checkpointer:import` guards `POST /v1/threads/{thread_id}/messages`, which imports history of any role. It is the one scope that is never implied. Other routes treat an identity with no declared scopes as unrestricted. This route returns 403 unless the scope is granted explicitly. A role of `"*"` includes it. Grant it only to trusted admin identities.

`has_scope()` is permissive by default: if no authorization context is present (auth not configured, or a direct SDK call without an authz block), it returns `True`. This ensures backward compatibility, existing graphs work unchanged.

## Control access inside a tool

Scopes guard API routes: a caller needs `graph:invoke` to start a run, and the server enforces that before your graph runs. What a tool may do once a run is going is up to you, and you have everything you need to decide. A tool can take these parameters by name and 10xGraph injects them:

- `config`: the run config. `get_authz(config)` returns the authz block (`user_id`, `scope`, `scopes`) the server stamped, and `has_scope(config, "resource:action")` checks one scope.
- `state`, `tool_call_id`, `store`, `checkpointer` and the other injectable names listed in the [tools reference](/docs/reference/python/tools#per-tool-access-control).

Scope names are exact strings, so you can define your own next to the built-in ones. If your auth backend or token issues `orders:refund`, a tool can require it. The server only checks the route scope (`graph:invoke`), and passes the others through to `config` untouched.

This tool refuses politely when the caller lacks a scope, and tells the model what to say:

```python
from tenxgraph.core.authz import get_authz, has_scope
from tenxgraph.core.state import ToolResult
from tenxgraph.utils import tool


@tool
def refund_order(order_id: str, config: dict) -> ToolResult | str:
    """Refund an order."""
    if not has_scope(config, "orders:refund"):
        return ToolResult(
            message=(
                "Refunds need the orders:refund permission, which this account does not "
                "have. Tell the user to contact an administrator."
            ),
            is_error=True,
        )
    user_id = (get_authz(config) or {}).get("user_id", "anonymous")
    return f"Order {order_id} refunded by {user_id}."
```

`ToolResult(..., is_error=True)` marks the call as failed and puts your text in front of the model, so it can explain the refusal. If you raise an exception instead, the model only sees `Tool 'refund_order' failed with an internal error (reference ...)` and the detail goes to the server log. Raise when you want an operator to investigate; return a `ToolResult` when the refusal is an expected answer.

Two behaviors to keep in mind:

- With no authz block (direct SDK calls, or an API server with `"auth": null`), `has_scope()` returns `True`. A tool that must never run without auth should check `get_authz(config) is None` itself and refuse.
- With auth on, an identity that declares no scopes gets an empty `scopes` list, and `has_scope()` returns `False` for every scope, including your own. Issue the scopes your tools need in the token or from your authorization backend.

You can apply the same check to every tool in one place with a `before_invoke` callback on `InvocationType.TOOL`: `context.function_name` is the tool name and `context.metadata["config"]` is the run config. Raise from the callback to block the call, or keep a dict that maps tool names to required scopes. See [Use callbacks](/docs/guides/use-callbacks).

## Read caller identity inside tools and nodes

The `user_id` from the authz block tells you who made the request. Use it to log actions, associate resources with owners, or enforce object-level access control:

```python
from tenxgraph.core.authz import get_authz
from tenxgraph.utils import tool

@tool
def query_user_threads(*, config):
    """Retrieve threads belonging to the caller."""
    authz = get_authz(config)
    if authz is None:
        # No identity available; cannot scope by user.
        return []
    
    user_id = authz.get("user_id")
    # Query the checkpointer or thread store filtered to this user.
    # (The checkpointer respects isolation_scope too; see below.)
    return find_threads_for_user(user_id)
```

Combining `user_id` with a checkpointer that supports owner-only access (like `PgCheckpointer`, which enforces user isolation by default) ensures that data isolation is enforced at the storage layer too.

## Understand isolation scope

The `isolation_scope` returned by `isolation_scope()` tells you (and the storage layer) which data-isolation policy is in effect. A custom `AuthorizationBackend` that does not override its own `isolation_scope()` method gets `"owner"`. Return `"none"` from the backend only when users should share data:

```python
from tenxgraph.core.authz import isolation_scope, SCOPE_OWNER, SCOPE_NONE

def authorize_thread_access(thread_id: str, user_id: str, config):
    """Apply custom per-thread access control based on the isolation policy.

    This is a plain helper, not a tool, so it raises. Call it from your own route or
    node code. If a tool calls it, catch PermissionError there and return a ToolResult
    instead, because a raise inside a tool reaches the model only as a generic failure.
    """
    policy = isolation_scope(config)
    
    if policy == SCOPE_OWNER:
        # Owner-only: validate that thread_id is owned by user_id.
        owner = get_thread_owner(thread_id)  # Your storage backend
        if owner != user_id:
            raise PermissionError(f"Thread {thread_id} is owned by {owner}, not {user_id}")
    elif policy == SCOPE_NONE:
        # No isolation: any authenticated user can access.
        pass
    else:
        # No policy set; each layer applies its own default.
        pass
```

- `SCOPE_OWNER` (`"owner"`): Data is scoped to the caller's `user_id`. The checkpointer filters rows; your code should too.
- `SCOPE_NONE` (`"none"`): No scoping. All authenticated users see all data.
- `None`: No policy is set. Storage backends (like `PgCheckpointer`) fall back to their own `enforce_user_isolation` setting.

In practice, the checkpointer and store already respect the isolation policy, so you rarely need to call `isolation_scope()` directly. Use it when your code implements custom data filtering or when you want to log what policy is active.

## Example: Multi-tenant agent with scope checks

Install with `pip install "10xgraph[google-genai]"`. Here is a complete example of a graph that uses authorization scopes to enforce multi-tenant data isolation and fine-grained permissions:

```python
from tenxgraph.core.authz import get_authz, has_scope
from tenxgraph.core.state import ToolResult
from tenxgraph.prebuilt.agent import ReactAgent
from tenxgraph.utils import tool

# Stand-in storage layer for the example; use your own database.
NOTES: dict[str, list[str]] = {}


def fetch_user_notes(user_id):
    return NOTES.get(user_id, [])


def save_note(user_id, text):
    NOTES.setdefault(user_id, []).append(text)
    return len(NOTES[user_id])

@tool
def list_notes(*, config) -> str:
    """List notes belonging to the current user."""
    authz = get_authz(config)
    if authz is None:
        return "Error: No authorization context"
    
    user_id = authz.get("user_id")
    # Your storage layer (e.g., memory store) returns notes for this user.
    notes = fetch_user_notes(user_id)
    return f"Found {len(notes)} notes for {user_id}"

@tool
def create_note(text: str, *, config) -> str:
    """Create a note, restricted to users with store:write scope."""
    if not has_scope(config, "store:write"):
        return ToolResult(message="Missing scope: store:write.", is_error=True)
    
    authz = get_authz(config)
    user_id = authz.get("user_id") if authz else "anonymous"
    
    # Store the note, associated with the user.
    note_id = save_note(user_id, text)
    return f"Note created (id={note_id}) for {user_id}"

@tool
def export_data(format: str, *, config) -> str:
    """Export all user data, admin-only."""
    if not has_scope(config, "config:read"):
        return ToolResult(message="Missing scope: config:read.", is_error=True)
    
    authz = get_authz(config)
    user_id = authz.get("user_id")
    return f"Exported {format} for {user_id}"

# ReactAgent wires the agent node, tool node and routing for you
agent = ReactAgent(
    model="gemini/gemini-2.5-flash",
    tools=[list_notes, create_note, export_data],
)
compiled = agent.compile()
```

When you invoke this over the API server:

1. A user authenticates (JWT or custom auth).
2. The authorization backend (`OwnershipAuthorizationBackend` or custom) checks scopes.
3. `RequirePermission` builds `user["authz"]` with the user's ID and granted scopes.
4. Your graph runs; each tool calls `get_authz()`, `has_scope()`, or `isolation_scope()`.
5. If a tool is asked to perform an unauthorized action, it returns a `ToolResult` with `is_error=True` and a clear message, which the model can relay to the user.
6. If the caller's scopes don't include `store:write`, `create_note()` returns the failed result "Missing scope: store:write." and does not run.

## Direct SDK calls with authorization

When you call `CompiledGraph.invoke()` directly in Python (not over the API server), you can build and pass an authz block yourself:

```python
from tenxgraph.core.authz import build_authz
from tenxgraph.core.state import Message

authz_block = build_authz(
    user_id="alice",
    scope="owner",
    scopes=["graph:invoke", "checkpointer:read", "store:write"]
)

result = compiled.invoke(
    {"messages": [Message.text_message("List my notes")]},
    config={"authz": authz_block, "thread_id": "session-1"}
)
```

Without an authz block, `get_authz()` returns `None`, and all functions default to permissive (all scopes allowed, no isolation). This keeps your graphs backward compatible.

## How the API server fills the authz block

When a request reaches the API server, the `RequirePermission` dependency (in the route's `Depends()`) performs this flow:

1. **Authenticate**: Extract and verify the bearer token (JWT or custom `BaseAuth`). Decode claims to get `user_id`, `roles`, `scopes`, etc.
2. **Check scopes**: Call the authorization backend's `scopes_for(user)` (for example `RoleBasedAuthorizationBackend` maps roles to scopes), falling back to the identity's `scope` and `scopes` claims (read as exact names). If scopes are declared, verify that the required scope (e.g., `"graph:invoke"` for a POST to `/v1/graph/invoke`) is granted.
3. **Check object access**: Call `authorize(user, resource, action, resource_id)` to enforce object-level rules (e.g., ownership checks).
4. **Build and stamp authz**: Call `build_authz(user_id, scope=isolation_policy, scopes=granted_scopes)` and place it in `user["authz"]`. This overwrites anything the client sent, it is non-hijackable.
5. **Place in config**: Every service (graph execution, checkpointer, store) copies `user` into `config["user"]`, so the authz block reaches your code.

This flow is defined in `tenxgraph_api/src/app/core/auth/permissions.py`. For details on configuring backends, see `/docs/server/auth`.

## Common errors and fixes

**Tool result "Missing scope: store:write"**

The caller doesn't have the required scope. This happens when:

- The user's role is not mapped to that scope in your authorization backend.
- The identity's `scopes` (for example from the JWT claims) don't include the required scope.
- The identity declares no scopes, so `has_scope()` sees an empty list.

Fix: Check your `authorization` setting in `10xgraph.json` and your role-scope mappings.

**get_authz() returns None inside a tool**

This is not an error, it means either:

- Auth is not configured on the API server (`"auth": null` in `10xgraph.json`).
- You're calling the graph directly in Python without passing an authz block.

In both cases, `has_scope()` and `isolation_scope()` default to permissive, and your code should handle the None case gracefully.

**"Thread is owned by user2, not user1"**

The caller tried to access a thread they don't own, but the ownership check passed the initial route guard. This means:

- The ownership backend is configured but your code is checking ownership a second time.
- Or, you're using a custom authorization backend that does not enforce ownership.

Fix: Ensure your authorization backend (`OwnershipAuthorizationBackend` or a custom one) checks thread ownership. For a custom check, call `await checkpointer.aget_thread_owner(thread_id)` and compare.

## Run it in production

The server resolves the caller from your auth backend and checks these scopes on every route, so the list here is what a deployed API enforces. Configure `auth` and `authorization` in `10xgraph.json` as described in [Server auth](/docs/server/auth), and read how the pieces fit in the [Security model](/docs/production/security-model).

## Related pages

- `/docs/server/auth`: Configure authentication and authorization on the API server.
- `/docs/guides/protect-against-prompt-injection`: Additional safety patterns for input validation.
- `/docs/guides/use-dependency-injection`: Access config and other dependencies in nodes and tools.
- `/docs/concepts/security-and-validators`: Design patterns for secure agent systems.
