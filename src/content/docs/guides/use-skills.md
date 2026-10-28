---
title: Give an agent Agent Skills
description: Add Agent Skills (SKILL.md folders with scripts, references and assets) to a 10xGraph Agent, validate them, and observe when the model uses them.
section: "Build agents"
group: "Agent Skills"
order: 430
label: Skills
updated: "2026-10-27"
---

A skill is a folder of instructions, and optionally scripts, reference docs and data, that an agent loads only when a task needs it. 10xGraph follows the [Agent Skills specification](https://agentskills.io/specification), so the same folder works in 10xGraph, Claude Code, Codex and GitHub Copilot.

This guide covers writing a skill, attaching it to an `Agent`, checking it, and seeing when the model uses it. (Agent Skills are different from the [10xGraph skill for coding assistants](/docs/integrations/coding-assistants), which is a Claude Code plugin.) For every option, see the [Skills reference](/docs/reference/python/skills).

## Prerequisites

```bash
pip install "10xgraph[openai]"
```

The examples use `gpt-4o` and need `OPENAI_API_KEY`. Any model your installed provider supports works.

---

## Step 1: Create a skill folder

Put each skill in its own folder. The folder name must match the skill's `name`. `.agents/skills/` is the usual place for project skills:

```text
my_app/
├── graph.py
└── .agents/skills/
    └── invoice-review/
        ├── SKILL.md
        ├── references/
        │   └── approval-policy.md
        └── scripts/
            └── check_totals.py
```

`SKILL.md` starts with YAML frontmatter and continues with the instructions:

```markdown
---
name: invoice-review
description: >-
  Review supplier invoices for errors and policy violations. Use when the user
  shares an invoice or asks whether an invoice can be approved.
metadata:
  triggers: "review this invoice; can I approve this invoice"
  tags: "finance"
  priority: "5"
---

# Invoice review

1. Check the line items add up to the total. The calculation used by the
   finance team is in scripts/check_totals.py.
2. Check the invoice against references/approval-policy.md.
3. Reply with APPROVE or REJECT and the reasons.
```

Guidelines for the frontmatter:

- **`description` is what the model uses to pick the skill.** Say what the skill does and when to use it, with the words users actually type. It can be up to 1024 characters.
- **`metadata` values must be strings.** Quote numbers (`priority: "5"`). `triggers` (example requests, `;`-separated), `tags` and `priority` are optional 10xGraph extensions. The catalog shows triggers as hints and orders skills by priority.
- **Refer to bundled files with paths relative to the skill folder**, such as `references/approval-policy.md`, not paths from the project root.
- **Keep `SKILL.md` under 500 lines.** Move long material into `references/`; the model reads it only when needed.

---

## Step 2: Check the skill

```bash
10xgraph skills --validate .agents/skills
```

The command lists each skill as valid or invalid and explains every problem. For example, it reports a `name` that doesn't match its folder, unquoted metadata numbers, unknown frontmatter fields, or a `references/...` path that doesn't exist. It exits with status `1` on errors, so you can run it in CI.

From Python:

```python
from tenxgraph.core.skills import validate_skill

for issue in validate_skill(".agents/skills/invoice-review"):
    print(issue)
```

---

## Step 3: Attach the skills to an agent

Skills need a `ToolNode`, because the model loads them through tools:

```python
from tenxgraph.core.graph import Agent, StateGraph, ToolNode
from tenxgraph.core.skills import SkillConfig
from tenxgraph.core.state import AgentState
from tenxgraph.utils.constants import END

tool_node = ToolNode([])

agent = Agent(
    model="gpt-4o",
    system_prompt=[{"role": "system", "content": "You are a finance assistant."}],
    tool_node="TOOL",
    skills=SkillConfig(skills_dir=".agents/skills"),
)

def route(state: AgentState) -> str:
    last = state.context[-1]
    return "TOOL" if getattr(last, "tools_calls", None) else END

graph = StateGraph()
graph.add_node("MAIN", agent)
graph.add_node("TOOL", tool_node)
graph.add_conditional_edges("MAIN", route, {"TOOL": "TOOL", END: END})
graph.add_edge("TOOL", "MAIN")
graph.set_entry_point("MAIN")
app = graph.compile()
```

When the graph compiles, 10xGraph adds two tools to the `TOOL` node:

| Tool | What the model uses it for |
|---|---|
| `activate_skill(skill_name)` | Load a skill's instructions. Returns the `SKILL.md` body in `<skill_content>` tags, with a list of the skill's bundled files. |
| `read_skill_resource(skill_name, path)` | Read one bundled file, such as `references/approval-policy.md` or `scripts/check_totals.py`. Only added when some skill has bundled files. |

It also adds an `<available_skills>` list with every skill's name and description to the system prompt, so the model knows what it can load.

To load skills from several folders, pass a list. When two skills share a name, the one from the earlier folder wins:

```python
SkillConfig(skills_dir=[".agents/skills", "/opt/company-skills"])
```

---

## Step 4: Let the model read scripts and references

`read_skill_resource` returns any file in the skill folder as text: markdown, Python and shell scripts, scripts without an extension, JSON, CSV. The model can read `scripts/check_totals.py` to follow the exact calculation, or open a template from `assets/`.

A few limits apply:

- Nothing is executed. Reading a script only shows its source.
- Files larger than `max_resource_bytes` (256 KB by default) are cut off with a note.
- Binary files, such as images, are described by name and size instead of shown.
- Paths outside the skill folder are refused, including `..` segments, absolute paths and symlinks that point elsewhere.

If the agent also has its own shell tool and should run the bundled scripts, turn on `include_skill_path`. The activation result then includes the skill's absolute folder path:

```python
SkillConfig(skills_dir=".agents/skills", include_skill_path=True)
```

It is off by default so server paths aren't shown to the model.

---

## Step 5: See when a skill is used

Calls to `activate_skill` and `read_skill_resource` fire `InvocationType.SKILL` callbacks, separately from ordinary tool calls:

```python
from tenxgraph.utils import CallbackManager, InvocationType

def log_skill(context, input_data):
    print(context.function_name, input_data)
    return input_data

callbacks = CallbackManager()
callbacks.register_before_invoke(InvocationType.SKILL, log_skill)

app = graph.compile(callback_manager=callbacks)
```

The skills activated in a thread are also recorded in the state:

```python
from tenxgraph.core.skills.activation import get_active_skills
from tenxgraph.core.state import Message

from tenxgraph.utils.constants import ResponseGranularity

async def main():
    result = await app.ainvoke(
        {"messages": [Message.text_message("Can I approve invoice INV-203?")]},
        config={"thread_id": "t1"},
        response_granularity=ResponseGranularity.FULL,
    )
    print(get_active_skills(result["state"]))  # ['invoice-review']
```

Recording activations is also how 10xGraph keeps skills from being lost. If a context manager later trims or summarises away the tool result that carried a skill's instructions, the agent puts them back into the system prompt on the next call.

---

## Pin one skill per session instead

For multi-tenant apps where each session has a fixed persona, skip the catalog and load the skill named in a state field on every call:

```python
from tenxgraph.core.state import AgentState

class TenantState(AgentState):
    active_skill: str = ""

agent = Agent(
    model="gpt-4o",
    tool_node="TOOL",
    skills=SkillConfig(
        skills_dir=".agents/skills",
        mode="session",
        preload_from="active_skill",
    ),
)

graph = StateGraph(TenantState())
```

Set `active_skill` in the initial `state` of each invoke (for example `"state": {"active_skill": "invoice-review"}`).

`activate_skill` isn't registered in this mode. `read_skill_resource` is still registered when the skill has bundled files and the agent has a `ToolNode`.

---

## Reuse skills written for other tools

Skills from Claude Code (`.claude/skills/`), Codex or Copilot (`.agents/skills/`, `.github/skills/`) load without changes. 10xGraph is lenient about small rule breaks: a name that doesn't match its folder, a long description, or YAML that breaks on an unquoted `: ` still loads, and the problem is logged as a warning. Run `10xgraph skills --validate` to see the list, or read `SkillsRegistry.diagnostics` in code.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `RuntimeError: Skills require an existing ToolNode` | The agent has skills but no tool node. | Pass `tool_node=ToolNode([...])` or `tool_node="TOOL"`. |
| Warning `no skills were discovered` | `skills_dir` points at the wrong folder, or a skill folder has no `SKILL.md`. | Point `skills_dir` at the folder that *contains* the skill folders, or at one skill folder. |
| The model never activates a skill | The description doesn't say when to use it. | Rewrite the description around the user's requests; add `metadata.triggers`. |
| `read_skill_resource` says the file was not found | The path is relative to the project, not the skill. | Use paths relative to the skill folder; the error lists the files that exist. |
| A skill is missing from the catalog | Another skill with the same name was found first. | Check the log for `shadowed`, and rename one of the skills. |

## Run it in production

Skill text is added to the prompt as data and is not run through `str.format`, but anyone who can edit a skill file can change agent behavior. Treat the skills directory as code that you review and deploy. See the [Security model](/docs/production/security-model).

## Related

- [Skills reference](/docs/reference/python/skills)
- [Skills tutorial](/docs/examples/skills)
- [Install the 10xGraph skill for coding assistants](/docs/integrations/coding-assistants)
- [Callbacks](/docs/reference/python/callback-manager)
