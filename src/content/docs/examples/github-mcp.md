---
title: GitHub MCP
seoTitle: "GitHub MCP example: query GitHub repositories"
description: "Connect an agent to a remote GitHub MCP server to list commits and download files from repositories through MCP tools."
section: Examples
group: "Tools and MCP"
order: 130
label: GitHub MCP
updated: "2026-10-27"
faq:
  - q: "Which tools does the agent get from the GitHub MCP server?"
    a: "The ToolNode is created with an empty tool list, so every tool comes from the remote server. The agent sees whatever the endpoint exposes for your token."
  - q: "Why does the graph need a routing function?"
    a: "It sends the flow to the tool node when the assistant requests tools, and ends the run once a tool result has been handled. Without it the graph would not know when to stop."

---

This example connects 10xGraph to the hosted GitHub MCP (Model Context Protocol) server at `https://api.githubcopilot.com/mcp/`. A Gemini-backed agent discovers the server's tools, calls them to list commits or fetch a file, and answers from the results. The same pattern works for any authenticated remote MCP service.

## Run the example

The code is in `examples/github-mcp/`. `git_mcp.py` lists the commits of a repository, and `mcp_file_download.py` downloads a file. Both need a GitHub token with access to the repositories you query and a Google API key for Gemini.

```bash
pip install "10xgraph[google-genai]" fastmcp python-dotenv
export GITHUB_TOKEN=your_github_token_here
export GEMINI_API_KEY=your_google_api_key_here
python git_mcp.py
```

The script calls `load_dotenv()`, so you can put both variables in a `.env` file next to it instead of exporting them.

## Full listing

This is `git_mcp.py` in full. The sections below walk through each part.

```python title="git_mcp.py"
import json
import os
from datetime import datetime

from dotenv import load_dotenv
from fastmcp import Client

from tenxgraph.core import Agent, StateGraph, ToolNode
from tenxgraph.core.state import AgentState, Message
from tenxgraph.storage.checkpointer import InMemoryCheckpointer
from tenxgraph.utils.constants import END


load_dotenv()

checkpointer = InMemoryCheckpointer()

config = {
    "mcpServers": {
        "github": {
            "url": "https://api.githubcopilot.com/mcp/",
            "headers": {"Authorization": f"Bearer {os.getenv('GITHUB_TOKEN')}"},
            "transport": "streamable-http",
        },
    }
}


client_http = Client(config)

tool_node = ToolNode([], client=client_http)


main_agent = Agent(
    model="gemini-2.0-flash",
    provider="google",
    system_prompt=[
        {
            "role": "system",
            "content": """
                You are a helpful assistant.
                Your task is to assist the user in finding information and answering questions.
            """,
        },
    ],
    tool_node=tool_node,
    trim_context=True,
)


def should_use_tools(state: AgentState) -> str:
    """Determine if we should use tools or end the conversation."""
    if not state.context or len(state.context) == 0:
        return "TOOL"  # No context, might need tools

    last_message = state.context[-1]

    # If the last message is from assistant and has tool calls, go to TOOL
    if (
        hasattr(last_message, "tools_calls")
        and last_message.tools_calls
        and len(last_message.tools_calls) > 0
        and last_message.role == "assistant"
    ):
        return "TOOL"

    # If last message is a tool result, we should be done (AI will make final response)
    if last_message.role == "tool":
        return END

    # Default to END for other cases
    return END


graph = StateGraph()
graph.add_node("MAIN", main_agent)
graph.add_node("TOOL", tool_node)

# Add conditional edges from MAIN
graph.add_conditional_edges(
    "MAIN",
    should_use_tools,
    {"TOOL": "TOOL", END: END},
)

# Always go back to MAIN after TOOL execution
graph.add_edge("TOOL", "MAIN")
graph.set_entry_point("MAIN")


app = graph.compile(
    checkpointer=checkpointer,
)


# now run it

inp = {
    "messages": [
        Message.text_message(
            "Please call the list_commits function for the github repo 'https://github.com/suchith83/portfolio' of the 'suchith83' username, and give me all commits in that repo."
        )
    ]
}
config = {"thread_id": "12345", "recursion_limit": 10}
res = app.invoke(inp, config=config)


def pretty_print_messages(messages):
    for i, m in enumerate(messages, 1):
        print("=" * 60)
        print(f"Message {i}:")
        print(f"  ID: {getattr(m, 'message_id', None)}")
        print(f"  Role: {m.role}")

        if hasattr(m, "timestamp") and m.timestamp:
            ts = m.timestamp
            if isinstance(ts, datetime):
                ts = ts.isoformat()
            print(f"  Timestamp: {ts}")

        # content
        if m.content:
            print("  Content:")
            print("    " + str(m.content).replace("\n", "\n    "))

        # tool calls
        if getattr(m, "tools_calls", None):
            print("  Tool Calls:")
            print(json.dumps(m.tools_calls, indent=4))

        # tool call id
        if getattr(m, "tool_call_id", None):
            print(f"  Tool Call ID: {m.tool_call_id}")

        # metadata
        if getattr(m, "metadata", None):
            print("  Metadata:")
            print(json.dumps(m.metadata, indent=4))


print("printing the response")
pretty_print_messages(res["messages"])
```

## Connect to the remote MCP server

The `fastmcp` `Client` takes a config dictionary that names each MCP server. For a remote HTTP endpoint you give the URL, an `Authorization` header built from `GITHUB_TOKEN`, and the `streamable-http` transport.

```python title="git_mcp.py (excerpt)"
config = {
    "mcpServers": {
        "github": {
            "url": "https://api.githubcopilot.com/mcp/",
            "headers": {"Authorization": f"Bearer {os.getenv('GITHUB_TOKEN')}"},
            "transport": "streamable-http",
        },
    }
}
client_http = Client(config)
```

If the token is missing, the header becomes `Bearer None` and the server rejects the request.

## Give the client to a ToolNode

`ToolNode([], client=client_http)` creates a tool node whose tools all come from the MCP server. The first argument is an empty list because no local Python functions are registered. The same node is passed to the `Agent` (so the model sees the tool schemas) and added to the graph (so tool calls run).

```python title="git_mcp.py (excerpt)"
tool_node = ToolNode([], client=client_http)
```

## Build the agent and the graph

The agent uses `gemini-2.0-flash` through the `google` provider, with `trim_context=True` to keep long tool output from filling the context window. The graph has two nodes, `MAIN` (the agent) and `TOOL` (the tool node), joined by a conditional edge and a plain edge back.

`should_use_tools` reads the last message in the state context. An assistant message with tool calls routes to `TOOL`. Anything else, including a tool result that the agent already handled, routes to `END`. The edge `TOOL -> MAIN` always returns the tool output to the agent so it can write the final answer.

```python title="git_mcp.py (excerpt)"
graph = StateGraph()
graph.add_node("MAIN", main_agent)
graph.add_node("TOOL", tool_node)
graph.add_conditional_edges("MAIN", should_use_tools, {"TOOL": "TOOL", END: END})
graph.add_edge("TOOL", "MAIN")
graph.set_entry_point("MAIN")

app = graph.compile(checkpointer=checkpointer)
```

## Invoke the graph

The input is a dictionary with a `messages` list. The config sets a `thread_id` (the checkpointer stores state under it) and a `recursion_limit` that caps the agent and tool loop at 10 steps.

```python title="git_mcp.py (excerpt)"
inp = {
    "messages": [
        Message.text_message(
            "Please call the list_commits function for the github repo "
            "'https://github.com/suchith83/portfolio' of the 'suchith83' username, "
            "and give me all commits in that repo."
        )
    ]
}
config = {"thread_id": "12345", "recursion_limit": 10}
res = app.invoke(inp, config=config)
```

## Inspect the message history

`res["messages"]` holds the full conversation. The `pretty_print_messages` helper in the listing prints each message's role, content, tool calls, tool call ID and metadata. Read it top to bottom: the user request, the assistant message with the `list_commits` call and the arguments the model chose, the tool message with the GitHub response, and the final assistant summary. The actual output depends on the repository and the model, so it differs between runs.

## Variant: download a file with debug logging

`mcp_file_download.py` uses the same setup with two changes. The prompt asks for a file, and the script turns on logging so you can see tool discovery and invocation.

```python title="mcp_file_download.py (excerpt)"
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logging.getLogger("tenxgraph").setLevel(logging.DEBUG)

tool_node = ToolNode(tools=[], client=client_http)

inp = {
    "messages": [
        Message.text_message(
            "Get Readme.md file from the github repo "
            "'https://github.com/suchith83/portfolio' of the 'suchith83' username."
        )
    ]
}
```

It prints the raw response rather than using the pretty printer. Look for a tool call to a file-access tool, a tool message with the file content, and a closing assistant message.

## Fix common problems

| Symptom | Cause and fix |
|---|---|
| Authentication error from the MCP server | `GITHUB_TOKEN` is missing, expired or lacks repository scopes. Set a valid token. |
| The model says it has no suitable tool | The endpoint may not expose the tool you expect. Turn on the debug logging from the variant above to see what was discovered. |
| The run stops early with a recursion error | Remote calls can need several loops. Raise `recursion_limit` in the config. |
| A tool call fails with a validation error | The arguments do not match the tool's JSON schema. Make the prompt name the repository and owner explicitly. |
| Slow responses | Each tool call is a network round trip to a remote service, so expect more latency than with local functions. |

## Next steps

Read [Use MCP](/docs/guides/use-mcp) for MCP patterns and testing with a mock client, or [the memory example](/docs/examples/memory) to add memory to a graph.
