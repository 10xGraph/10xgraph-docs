---
title: Contributing
seoTitle: "Contributing to 10xGraph"
description: How to contribute to 10xGraph and to these docs, including the local setup, the writing conventions, and the checks that must pass before a pull request merges.
section: Project
order: 60
label: Contributing
updated: "2026-10-08"
---

You can contribute to 10xGraph by fixing bugs, improving the code, writing documentation, or adding examples. The project is MIT licensed and developed in the open across four repositories: the Python framework, the API server and CLI, the TypeScript client, and this docs site. Pick the one that matches your change.

| You want to change | Repository |
| --- | --- |
| The core Python framework | [10xGraph/10xGraph](https://github.com/10xGraph/10xGraph) |
| The API server or CLI | [10xGraph/10xgraph-api](https://github.com/10xGraph/10xgraph-api) |
| The TypeScript client | [10xGraph/10xgraph-client](https://github.com/10xGraph/10xgraph-client) |
| This documentation site | [10xGraph/10xgraph-docs](https://github.com/10xGraph/10xgraph-docs) |

Every page here has an **Edit this page** link at the bottom that opens the
right file in the docs repository.

---

## Contributing to the framework

The core library uses [`uv`](https://docs.astral.sh/uv/):

```bash
git clone https://github.com/10xGraph/10xGraph
cd 10xGraph
uv sync --dev              # create .venv and install the package plus dev tools
uv run pre-commit install  # enable the git hooks
```

Install the extras for whatever subsystem you are working on:

```bash
uv pip install -e ".[google-genai,openai,anthropic,mcp,pg_checkpoint]"
```

Before opening a pull request:

```bash
uv run pytest --cov --cov-branch   # tests plus the 80% coverage gate
uv run ruff check . && uv run ruff format .
uv run mypy tenxgraph/             # new code is type-checked
```

Tests that need a real Redis or Postgres are marked `integration` and are
skipped by default. Pass `--integration` once you have the services up.

The full guide, including the code of conduct, lives in `CONTRIBUTING.md` in each
repository.

### What a good pull request looks like

- One concern per pull request. A fix plus a refactor is two pull requests.
- A test that fails before the change and passes after it.
- A changelog entry under `## [Unreleased]` in `CHANGELOG.md`, under the same
  headings that file already uses (`Breaking`, `Changed`, `Added`, `Fixed`,
  `Migration`). Breaking changes must include the migration step.
- Public API changes come with docs. A new parameter that appears nowhere on this
  site does not exist as far as users are concerned.

---

## Contributing to these docs

The docs are a static [Astro](https://astro.build) site. Pages are `.md` or `.mdx`
files under `src/content/docs/`, and the folder path is the URL path. Node 22.12
or newer is required.

```bash
git clone https://github.com/10xGraph/10xgraph-docs
cd 10xgraph-docs
npm install
npm run dev        # builds the search index, then serves http://localhost:4321
```

Checks that must pass before a pull request:

```bash
npm run check      # type-check .astro and .ts files
npm run build      # validates every page's frontmatter, then builds and indexes
```

Frontmatter is validated by the collection schema in `src/content.config.ts`, so
a page with a missing or out-of-range field fails the build.

### Where a page belongs

Put a page where its reader is, not where its topic is. The `section` field in the
frontmatter must be one of the sections below.

| Section | The reader is |
| --- | --- |
| Get started | Learning by doing, in order |
| Concepts | Trying to understand, not to type |
| Build agents | Doing a task with the Python library |
| API server | Running, securing, or deploying the server |
| TypeScript client | Calling a server from an app |
| Testing and evaluation | Checking that an agent works |
| Integrations | Connecting a model, framework, or store |
| Examples | Following a complete walkthrough |
| Reference | Looking something up |
| Troubleshooting | Something is broken right now |

If a topic needs coverage in more than one section, write the reference page and
link to it. Do not restate the same parameter table in four places.

### Writing conventions

- **Frontmatter**: `title`, `description` (50 to 170 characters), `section`, and
  `order` are the core fields. `seoTitle` (15 to 49 characters), `group`, `label`,
  `updated`, and `faq` (items with `q` and `a`) are optional.
- **Open with the answer.** Start each page with a 40 to 60 word paragraph that
  answers the page's question on its own.
- **Verify before asserting.** Read the source for the signature, the default,
  and the error message. Prefer a short complete example over a long partial one.
- **Every code block should run.** Use real import paths such as
  `from tenxgraph.core.graph import StateGraph`.
- **Link with absolute docs paths** such as `/docs/concepts`, and only to pages
  that exist.
- **Moving or renaming a page requires a redirect** in `src/redirects.json`.
- **Components** such as `Callout` and `Tabs` work only in `.mdx` files. Plain
  `.md` pages use Markdown only.
