---
title: "Build a chat frontend with CopilotKit and 10xGraph"
seoTitle: "CopilotKit + 10xGraph AG-UI integration"
description: "Connect a CopilotKit chat frontend to your 10xGraph agent over the AG-UI protocol, with streaming responses, tool calls, browser tools, and shared state."
section: Integrations
group: "Frameworks"
order: 70
label: with CopilotKit (AG-UI)
updated: "2026-10-08"
faq:
  - q: "Why CopilotKit instead of the TypeScript client?"
    a: "CopilotKit is a complete chat UI and runtime. Use it if you want a hosted chat widget. The 10xGraph TypeScript client gives you more control over the UI and how to render the stream."
  - q: "Can I use CopilotKit without AG-UI?"
    a: "CopilotKit speaks AG-UI natively. 10xGraph exposes the /v1/ag-ui endpoint via a server configuration key; there is no CopilotKit-specific code in 10xGraph."
---

[CopilotKit](https://docs.copilotkit.ai) is a hosted chat UI and runtime that connects to agent backends. [AG-UI](https://docs.ag-ui.com) is an open protocol between agent servers and chat frontends. 10xGraph's API server speaks both: enable the `/v1/ag-ui` endpoint and wire CopilotKit to it, and you have a production chat interface with streaming responses, tool calls, frontend tools that run in the browser, and real-time state updates.

This guide builds a complete Next.js + CopilotKit frontend that calls your 10xGraph agent. For the server-side setup and production hardening, see [Serve your agent over AG-UI](/docs/server/ag-ui). For the full endpoint and event specification, see the [AG-UI endpoint reference](/docs/reference/rest-api/ag-ui).

## System architecture

The three layers are:

- **Frontend:** CopilotKit React components (chat UI, tool handlers, interrupt listeners) in the browser.
- **Backend:** Next.js route handler (running on your server) that wraps CopilotKit's `HttpAgent` and proxies to 10xGraph, keeping your API token off the client.
- **Agent:** Your 10xGraph API server with the `/v1/ag-ui` endpoint enabled, serving your compiled graph.

Messages flow end to end: the user types in CopilotKit, the route handler forwards it to `/v1/ag-ui` as an AG-UI `RunAgentInput`, the graph responds with events (text, tool calls, state updates), CopilotKit renders them, and frontend tools are executed in the browser and sent back.

## Prerequisites

You need:

- A 10xGraph API server running with the `ag-ui` extra installed and `/v1/ag-ui` enabled in `10xgraph.json` (follow [Serve your agent over AG-UI](/docs/server/ag-ui) first).
- A Next.js project.
- Basic familiarity with React hooks and async code.

## Set up the Next.js route handler

Install the required packages in your Next.js project:

```bash
npm install @copilotkit/react-core @copilotkit/runtime @ag-ui/client zod
```

Create a route handler that bridges CopilotKit and your 10xGraph server. The handler keeps your API token on the server, never exposing it to the browser:

```ts
// app/api/copilotkit/[[...slug]]/route.ts
import { HttpAgent } from "@ag-ui/client";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";

const GRAPH_URL = process.env.NEXT_PUBLIC_GRAPH_API_URL || "http://localhost:8000";

const runtime = new CopilotRuntime({
  agents: {
    graph: new HttpAgent({
      url: `${GRAPH_URL}/v1/ag-ui`,
      // If your 10xGraph server requires authentication, pass the token here.
      // It never reaches the browser because the route handler runs on your server.
      headers: process.env.GRAPH_API_TOKEN
        ? { authorization: `Bearer ${process.env.GRAPH_API_TOKEN}` }
        : {},
    }),
  },
  runner: new InMemoryAgentRunner(),
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
```

The `HttpAgent` points at the `/v1/ag-ui` endpoint of your 10xGraph server. If your server is behind an API gateway or uses JWT, set the token in `headers`; the route handler is on your own server, so credentials are safe.

## Build the chat page

The chat page wraps CopilotKit's provider and chat component:

```tsx
// app/page.tsx
"use client";

import { CopilotChat, CopilotKitProvider } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";

export default function ChatPage() {
  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      agentId="graph"
    >
      <div style={{ height: "100vh" }}>
        <CopilotChat
          agentId="graph"
          labels={{
            title: "10xGraph Chat",
            initial: "Hi, I'm here to help. What can I do?",
          }}
        />
      </div>
    </CopilotKitProvider>
  );
}
```

The `runtimeUrl` points to the route handler you created (CopilotKit calls `/api/copilotkit`). The `agentId="graph"` matches the agent name in your `HttpAgent` configuration.

## Frontend tools: run code in the browser

A frontend tool is a JavaScript function that runs on the client, not on the server. Register it with `useFrontendTool`, and CopilotKit will make it available to the graph alongside server-side tools:

```tsx
// app/page.tsx or a separate hook file
import { useFrontendTool } from "@copilotkit/react-core/v2";
import { z } from "zod";

useFrontendTool({
  name: "set_background_color",
  description: "Change the page background color.",
  parameters: z.object({
    color: z.string().describe("A CSS color value like #FF5733 or red"),
  }),
  handler: async ({ color }) => {
    document.body.style.backgroundColor = color;
    return `Background changed to ${color}`;
  },
});

useFrontendTool({
  name: "get_current_time",
  description: "Get the current time on the client.",
  parameters: z.object({}),
  handler: async () => {
    return new Date().toISOString();
  },
});
```

When the model calls a frontend tool, the run ends with the tool call unanswered, CopilotKit executes the handler in the browser, and starts a new run on the same thread with the result. The graph continues after the tool node. Server tools in that node still run normally. Frontend tools never override server tools; if a tool with the same name exists on the server, the server version is used.

## Human-in-the-loop: approvals with interrupt()

Call [`interrupt()`](/docs/guides/add-human-approval) in a node or tool to pause the graph and ask the user for approval or input:

```python
# graph.py
from tenxgraph.utils import interrupt, tool

@tool
async def transfer_funds(amount: float, recipient: str) -> str:
    """Transfer money to a recipient, after the user approves."""
    decision = interrupt(
        value={"amount": amount, "recipient": recipient},
        message=f"Transfer ${amount} to {recipient}?",
        reason="transfer_approval",
        response_schema={
            "type": "object",
            "properties": {
                "approved": {"type": "boolean"},
                "comment": {"type": "string"},
            },
            "required": ["approved"],
        },
    )
    if not decision or not decision.get("approved"):
        comment = (decision or {}).get("comment", "")
        return f"Transfer declined. Comment: {comment}"
    return f"Transferred ${amount} to {recipient}"
```

On the frontend, render the interrupt with `useInterrupt`:

```tsx
import { useInterrupt } from "@copilotkit/react-core/v2";

useInterrupt({
  render: ({ interrupt, resolve, cancel }) => {
    if (!interrupt) return null;
    return (
      <div style={{
        position: "fixed",
        bottom: 20,
        right: 20,
        background: "white",
        border: "1px solid #ccc",
        borderRadius: 8,
        padding: 16,
        boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
        maxWidth: 300,
      }}>
        <p>{interrupt.message}</p>
        <input
          type="text"
          placeholder="Optional comment"
          id="approve-comment"
          style={{ width: "100%", marginBottom: 8 }}
        />
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => {
              const comment = (document.getElementById("approve-comment") as HTMLInputElement)?.value;
              resolve({ approved: true, comment });
            }}
            style={{ flex: 1, background: "#4CAF50", color: "white", border: "none", padding: 8, borderRadius: 4 }}
          >
            Approve
          </button>
          <button
            onClick={() => resolve({ approved: false, comment: "" })}
            style={{ flex: 1, background: "#f44336", color: "white", border: "none", padding: 8, borderRadius: 4 }}
          >
            Reject
          </button>
        </div>
      </div>
    );
  },
});
```

When the user clicks Approve, `interrupt()` returns the object `{ approved: true, comment }` and the graph continues. If they click Reject, `interrupt()` returns `{ approved: false, comment: "" }`. If they call `cancel()`, it returns `None`.

## Shared state and real-time updates

Fields in your graph's state class are sent to the frontend whenever they change. Add custom fields to your `AgentState`:

```python
# graph.py
from tenxgraph import AgentState

class AppState(AgentState):
    """Graph state with custom fields."""
    current_task: str = "Idle"
    progress: float = 0.0
    selected_file: str = ""
```

Read these fields on the frontend with the `useAgent` hook:

```tsx
import { useAgent } from "@copilotkit/react-core/v2";

export function StatusBar() {
  const { agent } = useAgent({ agentId: "graph" });
  const state = agent.state as {
    current_task?: string;
    progress?: number;
    selected_file?: string;
  };

  return (
    <div style={{ padding: 16, background: "#f5f5f5" }}>
      <p>Task: {state.current_task || "-"}</p>
      <p>Progress: {Math.round((state.progress ?? 0) * 100)}%</p>
      <p>File: {state.selected_file || "-"}</p>
    </div>
  );
}
```

The state updates in real-time as the graph runs. Set initial state from the frontend by passing it in `RunAgentInput.state`; it becomes the run's starting state. The `context`, `context_summary` and `execution_meta` keys are ignored.

## Frontend context and configuration

Pass data from the frontend to your graph nodes and tools via `RunAgentInput.context`. The AG-UI request extras are available inside any node or tool as `config["ag_ui"]`. The server sets this key itself, so it only appears on AG-UI runs: a client of `/v1/graph/invoke` or `/v1/graph/stream` cannot send it, and `runs.config_keys` does not need to list it.

```python
# graph.py
async def main_node(state: AppState, config: dict):
    ag_ui = config.get("ag_ui", {})
    # A list of AG-UI context items, each with "description" and "value".
    frontend_context = ag_ui.get("context", [])
    client_tools = ag_ui.get("tools", [])
    forwarded_props = ag_ui.get("forwarded_props")
```

`context`, `tools` and `forwarded_props` are the AG-UI `RunAgentInput` fields of the same names. In CopilotKit, context registered with its context hooks arrives as `context`.

## Limitations and known behavior

- **Threads and message history.** The 10xGraph API stores the full conversation in the checkpointer (Postgres, SQLite, or in-memory). CopilotKit sends the entire conversation on every run, but only new messages are passed to the graph; the checkpoint is the source of truth. If you reload the browser, the client loses its local message list unless you persist it (CopilotKit has a storage adapter for this). Use a durable checkpointer (Postgres + Redis) if threads must survive server restarts.

- **No `MESSAGES_SNAPSHOT` yet.** The `/v1/ag-ui` endpoint does not send the full message history back in a snapshot event. Reload a thread in the browser and it starts empty unless your client stores messages locally.

- **Message filtering.** Messages the client marks as coming from the system, developer, or assistant are ignored on resume; the graph treats the checkpoint as the record of what was said and done.

- **Browser vs. server tools.** The graph needs a `ToolNode` (passed to your `Agent` node as `tool_node`). Browser tools from `RunAgentInput.tools` are added to the tool list for that run only and do not persist. A browser tool never replaces a server tool; if a tool with that name exists on the server, the server tool is used. Client tools are limited to 64 per run, names of 1 to 64 letters, digits, `_` or `-`, and set `"ag_ui": {"allow_client_tools": false}` in `10xgraph.json` to refuse them (only `remote_tools` are then offered).

## What maps to what

| 10xGraph | AG-UI |
| --- | --- |
| Run start / end | `RUN_STARTED` / `RUN_FINISHED` |
| Node start / end | `STEP_STARTED` / `STEP_FINISHED` (node name) |
| Assistant text (streamed deltas or a whole message) | `TEXT_MESSAGE_START` / `CONTENT` / `END` |
| Reasoning blocks | `REASONING_START` ... `REASONING_END` |
| Tool calls from the model | `TOOL_CALL_START` / `ARGS` / `END` |
| Server tool results | `TOOL_CALL_RESULT` |
| A failed tool | `TOOL_CALL_RESULT` with the error, and the run continues |
| A browser tool call | `TOOL_CALL_*`, then `RUN_FINISHED` with the call unanswered |
| `interrupt()` | `RUN_FINISHED` with `outcome: {type: "interrupt", interrupts: [...]}` |
| Application state fields | `STATE_SNAPSHOT` (only fields you add to `AgentState`, not messages) |
| Graph error | `RUN_ERROR` |

## Interrupt mapping

How `interrupt()` maps to the AG-UI `Interrupt`:

| 10xGraph `interrupt()` | AG-UI `Interrupt` |
| --- | --- |
| generated id | `id` (echoed back as `resume[].interruptId`) |
| `reason` | `reason` |
| `message` | `message` |
| `response_schema` | `responseSchema` |
| tool call it ran in | `toolCallId` |
| `value` and node name | `metadata.value`, `metadata.node` |

`resolve(payload)` resumes the graph and `interrupt()` returns `payload`; `cancel()` resumes it
with `None`. While a thread is paused, a run that does not answer the interrupt (for example a
new chat message) reports the same interrupt again without running the graph. A `resume` for a
different interrupt id ends the run with `RUN_ERROR`.
