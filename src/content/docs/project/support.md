---
title: Getting help
seoTitle: "Getting help with 10xGraph"
description: Where to ask questions, how to file a good bug report for 10xGraph, and what information to collect before you do.
section: Project
order: 50
label: Support
updated: "2026-10-08"
---

## Start here

Most problems have a page already:

| Symptom | Page |
| --- | --- |
| `pip install` fails, wrong Python version, `tenxgraph` not found | [Installation troubleshooting](/docs/troubleshooting/installation) |
| Server will not start, 401/403, CORS, rate limits | [API server troubleshooting](/docs/troubleshooting/api-server) |
| Streaming stalls, types missing, upload fails | [Client troubleshooting](/docs/troubleshooting/client) |
| Playground shows nothing, or a page is empty | [Playground troubleshooting](/docs/troubleshooting/playground) |
| You have an error code like `GRAPH_ROUTING_001` | [Error codes](/docs/reference/error-codes) |
| Something worked in 0.10 (core), 0.9 (API) or 0.6 (client) and broke on 1.0 | [Upgrade to 1.0](/docs/project/upgrade-to-1.0) |
| Something worked in 0.8 and broke after upgrading to 0.9 | [Upgrade to 0.9](/docs/project/upgrade-to-0.9) |

Search covers every page on this site. Press <kbd>Ctrl</kbd> + <kbd>K</kbd>.

## Ask a question

- **GitHub Discussions** on [10xGraph/10xGraph](https://github.com/10xGraph/10xGraph/discussions)
  for usage questions, design questions, and "is this the right approach"
  conversations.
- **GitHub Issues** on the repository for the package that misbehaves:
  the core library, the CLI and API server, or the TypeScript client.

For a security problem, do not use either. Follow the
[security policy](/docs/project/security).

## File a good bug report

A report that includes the following usually gets a fix in one round trip
instead of three.

```bash
# Versions of everything involved
10xgraph version
python --version
pip show 10xgraph 10xgraph-api | grep -E "Name|Version"
node --version && npm list 10xgraph-client @10xscale/agentflow-client
```

Then include:

1. **What you expected and what happened.** The full traceback or the failing
   HTTP response body, not a paraphrase.
2. **A minimal graph that reproduces it.** Strip the tools and prompts down to
   the smallest thing that still fails. Most bugs shrink to 20 lines.
3. **Your configuration.** The relevant part of `10xgraph.json`, which
   checkpointer and store you use, and whether you run with `MODE=production`.
   Redact secrets.
4. **Whether it reproduces without persistence.** Swapping `PgCheckpointer` for
   `InMemoryCheckpointer` separates a storage problem from a graph problem
   immediately.

If the run is long, enable structured logging and attach the records for the
failing run. They carry `run_id`, `thread_id`, and `node`, so a single run can be
extracted from a busy log:

```python
from tenxgraph.utils.logging import setup_structured_logging

setup_structured_logging()
```

## Commercial support

10xGraph is built and maintained by [10xScale](https://10xscale.ai). For
commercial support, architecture review, or production onboarding, contact
[contact@10xscale.ai](mailto:contact@10xscale.ai).

## Contributing a fix

Found the bug and know the fix? See [contributing](/docs/project/contributing).
