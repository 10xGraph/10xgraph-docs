---
title: "Harness recipes"
description: "Four patterns for agents that run long and use many tools: tool search, large results in files, todo and notes state, and runs that resume from checkpoints."
section: "Build agents"
group: "Tools and MCP"
order: 230
label: "Harness recipes"
updated: "2026-11-22"
---

These are patterns, not framework features. Each one is built from parts 10xGraph already has: a `ToolNode` subclass, a custom state field, `ToolResult` and a checkpointer. Copy the code and change it for your agent.

The examples were run with a scripted model in place of a real one, except MCP, which was not run against a live server.

## Tool search for large tool sets

A browser MCP server can list 30 tools or more. Sending every schema on every turn costs tokens and makes tool choice worse. Instead, show the model two tools, `search_tools` and `load_tool`, and add the others only after it loads them.

10xGraph has no built-in tool search. It does not need one, because the list the model sees comes from one method: `ToolNode.all_tools(tags, config)`. The `Agent` calls it on every model request, and the result is the list of schemas sent to the provider. It covers local tools and MCP tools. Dispatch is separate: a call to a tool that is not in the list still runs if the name is registered. A subclass that filters `all_tools` changes what the model sees and nothing else.

Two details shape the code:

- `all_tools` receives the run `config`, not the state. To remember loaded tools per thread, keep the names in a custom state field and copy them into the config just before the model request. A three-line `Agent` subclass does that.
- A tool function's `__name__` is its tool name. Use plain method names such as `search_tools`, not `_search_tools`.

```python
from typing import Annotated

from pydantic import Field

from tenxgraph.core.graph import Agent, StateGraph, ToolNode
from tenxgraph.core.state import AgentState, ToolResult
from tenxgraph.storage.checkpointer import InMemoryCheckpointer
from tenxgraph.utils import END

CORE = {"search_tools", "load_tool"}


def _name(schema: dict) -> str:
    return schema["function"]["name"]


def union(left: list[str], right: list[str]) -> list[str]:
    return list(dict.fromkeys([*left, *right]))


class SearchState(AgentState):
    loaded_tools: Annotated[list[str], union] = Field(default_factory=list)


class SearchableToolNode(ToolNode):
    """Shows search_tools and load_tool always. Other tools show only after load_tool."""

    def __init__(self, tools, **kwargs):
        super().__init__([self.search_tools, self.load_tool, *tools], **kwargs)

    async def all_tools(self, tags=None, config=None):
        everything = await super().all_tools(tags=tags, config=config)
        loaded = set((config or {}).get("loaded_tools", []))
        return [t for t in everything if _name(t) in CORE | loaded]

    async def _catalog(self, config):
        everything = await super().all_tools(config=config)  # the full list, unfiltered
        return [t["function"] for t in everything if _name(t) not in CORE]

    async def search_tools(self, query: str, config: dict) -> str:
        """Find tools by keyword. Returns names and one-line descriptions."""
        words = query.lower().split()
        hits = [
            f"{f['name']}: {(f.get('description') or '').splitlines()[0]}"
            for f in await self._catalog(config)
            if all(w in f"{f['name']} {f.get('description') or ''}".lower() for w in words)
        ]
        return "\n".join(hits[:10]) or "No tool matches. Try fewer words."

    async def load_tool(self, name: str, state: SearchState, config: dict) -> ToolResult:
        """Make a tool from search_tools callable on the next turn."""
        if name not in {f["name"] for f in await self._catalog(config)}:
            return ToolResult(message=f"No tool named {name}.", is_error=True)
        return ToolResult(
            message=f"Loaded {name}. You can call it now.",
            state={"loaded_tools": [*state.loaded_tools, name]},
        )


class SearchAgent(Agent):
    """Copies the thread's loaded tool names into the config the tool list is built from."""

    async def execute(self, state, config, **kwargs):
        config = {**config, "loaded_tools": list(state.loaded_tools)}
        return await super().execute(state, config, **kwargs)
```

Wire it like any Agent and ToolNode pair. `click` and `screenshot` stand in for your tools. For MCP, pass `client=` and the other `ToolNode` options to the subclass. They are forwarded to `ToolNode`. `_catalog` reads the server's tools through the same `all_tools` call, so MCP tools are searched like local ones.

```python
def click(selector: str) -> str:
    """Click an element on the page."""
    return f"clicked {selector}"


def screenshot() -> str:
    """Take a screenshot."""
    return "png"


tools = SearchableToolNode([click, screenshot])
agent = SearchAgent(
    model="gpt-4o-mini",
    system_prompt=[{"role": "system", "content": (
        "Few tools are visible. Call search_tools to find one, then load_tool to use it."
    )}],
    tool_node=tools,
)


def route(state: SearchState) -> str:
    last = state.context[-1]
    return "TOOLS" if last.role == "assistant" and last.tools_calls else END


graph = StateGraph(SearchState)
graph.add_node("MAIN", agent)
graph.add_node("TOOLS", tools)
graph.add_conditional_edges("MAIN", route, {"TOOLS": "TOOLS", END: END})
graph.add_edge("TOOLS", "MAIN")
graph.set_entry_point("MAIN")
app = graph.compile(checkpointer=InMemoryCheckpointer())
```

With a scripted model that calls `search_tools`, then `load_tool`, then `click`, the tool list on the four model requests was: core tools only, core tools only, core tools plus `click`, core tools plus `click`. The loaded name is saved in the thread state, so it survives a restart when the checkpointer is durable.

Things to know:

- **Hidden tools are still callable by name.** The subclass changes what the model is shown, not what `invoke` accepts. This is the same for MCP tools hidden by `tags` or by a list filter. If you need a refusal, override `invoke` and check the name against `loaded_tools`.
- **The tool list changes between turns.** If your provider caches the prompt prefix, a changed tool list can cost a cache miss. Check this for your provider and load tools in small groups.
- **The reducer matters.** If the model calls `load_tool` twice in one step, both branches write `loaded_tools`. The `union` reducer merges them. See [Use custom state](/docs/guides/use-custom-state) for reducers.
- **Use `mcp_include` first when you can.** If you know the agent never needs 20 of the 30 tools, `ToolNode(mcp_include=...)` removes them completely. See [Use MCP](/docs/guides/use-mcp).

## Save large tool results to a file

A tool that returns 200 KB of logs puts all of it in the thread state and re-sends it on every turn. Save the full result outside the context. Return a short summary and a reference. Add a second tool that reads a slice.

`ToolNode(max_result_chars=...)` is the blunt option: it cuts the text and appends a marker. The pattern below keeps the whole result readable.

The media store in `tenxgraph.storage.media` is for images, audio and documents referenced from messages, so it does not fit text results. This recipe uses a plain directory.

```python
import re
import tempfile
import uuid
from pathlib import Path

from tenxgraph.core.graph import ToolNode

RESULTS = Path(tempfile.gettempdir()) / "agent-results"
RESULTS.mkdir(exist_ok=True)
PREVIEW_CHARS = 500
REF = re.compile(r"^[0-9a-f]{32}$")


def save_result(text: str) -> str:
    """Write text to a file. Return a short summary with a reference."""
    ref = uuid.uuid4().hex
    (RESULTS / f"{ref}.txt").write_text(text, encoding="utf-8")
    preview = text[:PREVIEW_CHARS]
    return (
        f"{len(text)} chars saved as ref {ref}. First {len(preview)} chars:\n{preview}\n"
        f"Call read_result(ref='{ref}', offset=..., length=...) for more."
    )


def fetch_logs(service: str) -> str:
    """Fetch the full logs of a service. Large output is saved to a file."""
    full = "\n".join(f"{service} line {i}" for i in range(5000))  # your real call here
    return save_result(full)


def read_result(ref: str, offset: int = 0, length: int = 2000) -> str:
    """Read a slice of a saved result. Use offset to page through it."""
    if not REF.match(ref):
        return "Invalid ref."
    path = RESULTS / f"{ref}.txt"
    if not path.is_file():
        return "Unknown ref."
    text = path.read_text(encoding="utf-8")
    length = min(length, 4000)
    return text[offset : offset + length] + (
        f"\n[chars {offset}-{min(offset + length, len(text))} of {len(text)}]"
    )


tools = ToolNode([fetch_logs, read_result])
```

The model never sees a path. The reference is a random id that `read_result` checks against a fixed pattern before it builds the path, so a model cannot ask for `../secrets`. The functions above ran against a 68,889 character result and returned the preview and slices as shown.

Things to know:

- A local directory is visible only to the process that wrote it. With several workers or containers, write to shared storage instead and keep the same two-tool shape.
- Any thread that knows a reference can read it. In a multi-tenant app, put the `user_id` from `config` in the file path and check it in `read_result`.
- Delete old files. Nothing in 10xGraph cleans this directory.

## Todo and notes

A long run loses track of its plan. Give the model a todo list and a notes area that live in the thread state, and update them through tools.

A tool changes state by returning `ToolResult(message=..., state={...})`. `message` goes back to the model as the tool result. Each key in `state` is set on the thread state, if the state class has that field. A tool can ask for the current state by declaring a `state` parameter. It is injected and does not appear in the schema the model sees.

```python
import uuid
from typing import Annotated

from pydantic import Field

from tenxgraph.core.graph import ToolNode
from tenxgraph.core.state import AgentState, ToolResult


def merge_dicts(left: dict, right: dict) -> dict:
    return {**left, **right}


def union(left: list[str], right: list[str]) -> list[str]:
    return list(dict.fromkeys([*left, *right]))


class WorkState(AgentState):
    todos: Annotated[dict[str, str], merge_dicts] = Field(default_factory=dict)
    done: Annotated[list[str], union] = Field(default_factory=list)
    notes: Annotated[dict[str, str], merge_dicts] = Field(default_factory=dict)


def add_todo(text: str, state: WorkState) -> ToolResult:
    """Add a task to the todo list."""
    todo_id = uuid.uuid4().hex[:6]
    return ToolResult(message=f"Added {todo_id}.", state={"todos": {**state.todos, todo_id: text}})


def complete_todo(todo_id: str, state: WorkState) -> ToolResult:
    """Mark a task done by its id."""
    if todo_id not in state.todos:
        return ToolResult(message=f"No todo {todo_id}.", is_error=True)
    return ToolResult(message=f"Done {todo_id}.", state={"done": [*state.done, todo_id]})


def list_todos(state: WorkState) -> str:
    """Show every task and whether it is done."""
    return "\n".join(
        f"[{'x' if i in state.done else ' '}] {i} {t}" for i, t in state.todos.items()
    ) or "No todos."


def save_note(key: str, text: str, state: WorkState) -> ToolResult:
    """Save a note under a short key. Overwrites the same key."""
    return ToolResult(message=f"Saved note {key}.", state={"notes": {**state.notes, key: text}})


def read_notes(state: WorkState) -> str:
    """Read all notes."""
    return "\n".join(f"{k}: {v}" for k, v in state.notes.items()) or "No notes."


tools = ToolNode([add_todo, complete_todo, list_todos, save_note, read_notes])
```

Build the graph with `StateGraph(WorkState)`. A tool replaces the whole field value, so each tool returns the old content plus its change.

The fields are dicts and a list of ids, not a list of todo objects with a `done` flag. This is on purpose. The model often calls several tools in one step, and they run in parallel on separate copies of the state. Each copy is merged back with the field's reducer. Without a reducer the last write wins and a warning is logged, so one `add_todo` would disappear. With two separate fields, "add" and "complete" never write the same field, and the reducers merge two adds or two completes. In a run with two `add_todo`, two `save_note`, then two `complete_todo` calls in parallel, the final state held both todos, both notes and both done ids.

A reducer receives the current value and the branch's full new value, so it must merge whole values, as `merge_dicts` and `union` do.

One limit: a read tool such as `list_todos` called in the same parallel step as a write sees the state from before the step. Ask the model to read in a later step.

## Long runs: checkpoints and resume

For a run that takes many steps or minutes, use a checkpointer and a stable `thread_id`. The rest is the same call.

- **Checkpointer and thread.** Compile with a checkpointer and pass `{"thread_id": ...}` on every call. State is saved after every completed node, so a crash replays at most one node. Pick the checkpointer in [Set up checkpointing](/docs/guides/set-up-checkpointing). Concurrent writers, the per-step save and the tool ledger are in [Durability and concurrency](/docs/guides/durability-and-concurrency).
- **Step limit.** `recursion_limit` in the run config is the maximum number of steps in one turn. The default is 25. A long agent needs a higher value. When the limit is hit, the call raises `GraphRecursionError` and the thread stays usable.
- **Resume after a stop.** After a cancel, a shutdown or a crash, the thread is repaired on the next call. A new user message starts a new turn on the saved context. A call with no new input continues at the saved node. Details and limits are in [Graceful shutdown](/docs/guides/graceful-shutdown).

This example hits the step limit and then continues the same thread. The state field `done` is saved by the checkpointer, so the second call carries on from 5 instead of 0.

```python
import asyncio

from tenxgraph.core.exceptions import GraphRecursionError
from tenxgraph.core.graph import StateGraph
from tenxgraph.core.state import AgentState, Message
from tenxgraph.storage.checkpointer import InMemoryCheckpointer
from tenxgraph.utils import END


class JobState(AgentState):
    done: int = 0


async def work(state: JobState, config: dict):
    state.done += 1
    return state


def route(state: JobState) -> str:
    return END if state.done >= 10 else "WORK"


graph = StateGraph(JobState)
graph.add_node("WORK", work)
graph.add_conditional_edges("WORK", route, {"WORK": "WORK", END: END})
graph.set_entry_point("WORK")
checkpointer = InMemoryCheckpointer()
app = graph.compile(checkpointer=checkpointer)


async def main():
    config = {"thread_id": "job-1", "recursion_limit": 6}
    try:
        await app.ainvoke({"messages": [Message.text_message("start")]}, config)
    except GraphRecursionError:
        state = await checkpointer.aget_state(config)
        print("stopped at", state.done)
    await app.ainvoke({"messages": [Message.text_message("continue")]}, config)
    print("finished at", (await checkpointer.aget_state(config)).done)


asyncio.run(main())
```

It prints `stopped at 5` and `finished at 10`. The limit counts the start step too, so a limit of 6 allowed five `work` steps.

`InMemoryCheckpointer` loses the thread when the process ends. For a real crash recovery, use a durable checkpointer and make tools with side effects safe to repeat. See [Replay-safe tools](/docs/concepts/replay-safe-tools).

There is no separate "resume" API for this case. A resume is a normal call on the same `thread_id`.

## Related pages

- [Use custom state](/docs/guides/use-custom-state)
- [Use MCP](/docs/guides/use-mcp)
- [Use the @tool decorator](/docs/guides/use-tool-decorator)
- [Set up checkpointing](/docs/guides/set-up-checkpointing)
- [Errors and limits](/docs/concepts/errors-and-limits)
