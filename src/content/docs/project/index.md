---
title: Project and releases
seoTitle: "10xGraph project, releases and maintainers"
description: "How 10xGraph is run: MIT license, maintained by 10xScale, with a changelog, roadmap, security reporting, support channels and a contributing guide."
section: Project
order: 10
label: Overview
updated: "2026-10-28"
---

This section covers 10xGraph as a project: who maintains it, how releases are announced, how to report a security problem, where to get help and how to contribute. It is MIT licensed, maintained by 10xScale, and at the 1.0 release candidate stage (1.0.0rc1, 2026-10-28) after its October 2026 rename from Agentflow.

## Start here

Read the [Changelog](/changelog) first to see what has shipped and which versions are current, then the [Roadmap](/docs/project/roadmap) for what is missing, partial or deliberately out of scope. The roadmap is where the honest gaps are listed, so it is worth reading before you commit to the project.

If you plan to upgrade across a breaking change, [Upgrade to 1.0](/docs/project/upgrade-to-1.0) explains what to migrate from 0.10 (core), 0.9 (API) and 0.6 (client), and [Upgrade to 0.9](/docs/project/upgrade-to-0.9) covers 0.8. For the package rename (new PyPI and npm names, CLI and GitHub org), see [Coming from Agentflow](/docs/get-started/coming-from-agentflow). If something breaks, [Support](/docs/project/support) explains what to collect for a bug report that gets fixed, and [Security](/docs/project/security) describes private vulnerability reporting. To send a fix or a doc improvement, start with [Contributing](/docs/project/contributing); the people involved are listed on [Maintainers](/maintainers).

| Page | Answers |
| --- | --- |
| [Changelog](/changelog) | What shipped, and what "stable" commits us to |
| [Upgrade to 1.0](/docs/project/upgrade-to-1.0) | What breaks from 0.10, 0.9 and 0.6, and how to migrate |
| [Upgrade to 0.9](/docs/project/upgrade-to-0.9) | What broke from 0.8 to 0.9, and how to migrate |
| [Roadmap](/docs/project/roadmap) | What is missing, partial, or deliberately out of scope |
| [Security](/docs/project/security) | How to report a vulnerability, and what is by design |
| [Support](/docs/project/support) | Where to ask, and how to file a report that gets fixed |
| [Contributing](/docs/project/contributing) | Local setup, conventions, and the checks that gate a merge |
| [Maintainers](/maintainers) | Who maintains 10xGraph, and who has contributed to it |

## At a glance

- **License:** MIT, for the framework, the CLI, and the client. No paid tier and
  no hosted-service requirement.
- **Maintainer:** [10xScale](https://10xscale.ai), which runs 10xGraph in
  production across its own products.
- **Stability:** from 1.0 the public API is covered by a deprecation policy. Nothing
  public is removed without a release of warning.
- **Requires:** Python 3.12 or newer; Node 18 or newer for the TypeScript client.
