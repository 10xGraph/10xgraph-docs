---
title: Troubleshooting
seoTitle: "Troubleshooting 10xGraph: find your problem"
description: "Find the right 10xGraph troubleshooting page by symptom: install failures, provider keys, server startup, client connections, playground and error codes."
section: Troubleshooting
order: 10
label: Overview
updated: "2026-10-27"
faq:
  - q: "Where do I find error codes like RECURSION_000?"
    a: "Go to the Error codes reference page. It lists every code with its cause, the exception class, and the structured error response the server returns."
  - q: "Should I check the error codes page or a troubleshooting guide?"
    a: "If a message contains an error code, go straight to the error codes page. Otherwise, start from the symptom table on this page to find the matching troubleshooting guide."
  - q: "My problem is not in the symptom table. What do I do?"
    a: "Check the Before you report an issue section below. Reproduce it with a minimal agent and 10xgraph.json, gather version info, and either search GitHub issues or open a new one."
---

10xGraph problems fall into five categories: installation, provider authentication, the API server, the TypeScript client, and the playground interface. Each category has its own troubleshooting page with symptoms, causes and fixes. Start from the symptom table below, find the row that matches what you see, and work through the linked page top to bottom. If you see an error code like `RECURSION_000`, skip to the error codes reference instead.

## Troubleshooting pages

**Installation and setup**
- [Installation troubleshooting](/docs/troubleshooting/installation): Install failures, missing packages, optional feature setup, environment variables and API keys.
- [Provider errors](/docs/troubleshooting/providers): Provider-specific issues: missing SDK extras, auth failures, unsupported models, rate limits, Vertex AI and Bedrock credentials.

**Running a server**
- [API server troubleshooting](/docs/troubleshooting/api-server): Server startup failures, CORS and security rejections, port conflicts, auth scopes, WebSocket closes and route failures.

**Calling from code**
- [Client troubleshooting](/docs/troubleshooting/client): Client request failures, browser vs curl differences, thread continuity, streaming vs invoke mismatches.
- [Playground troubleshooting](/docs/troubleshooting/playground): Playground connection failures, Live page issues, microphone not working.

**Error codes and system errors**
- [Error codes reference](/docs/reference/error-codes): Every error code the system emits, with its exception class, cause and the structured response format the API server sends.

## Find your problem

| What you see | Go to |
|---|---|
| `pip install` fails, the CLI command is not found, imports fail, or a package is missing | [Installation troubleshooting](/docs/troubleshooting/installation) |
| An optional feature (PostgreSQL, Redis, Qdrant, etc.) needs a package you have not installed | [Installation troubleshooting](/docs/troubleshooting/installation), section on optional features |
| Provider API keys look unset, `.env` is ignored, or auth fails with a provider | [Provider errors](/docs/troubleshooting/providers) or [Installation troubleshooting](/docs/troubleshooting/installation), section on environment variables |
| The server will not start, refuses unprotected routes, rejects a CORS setting, or the port is in use | [API server troubleshooting](/docs/troubleshooting/api-server) |
| A request returns `403 Missing required scope`, WebSocket closes immediately, or `/ping` works but graph routes fail | [API server troubleshooting](/docs/troubleshooting/api-server) |
| The server refuses to start in production, or you are unsure it is locked down | [Test before production](/docs/testing/before-production) and the [production checklist](/docs/server/production-checklist) |
| A request returns `429`, or errors show a generic message in production | [API server troubleshooting](/docs/troubleshooting/api-server) |
| Every client request fails, the browser fails but curl works, threads do not persist, or streaming behaves differently than invoke | [Client troubleshooting](/docs/troubleshooting/client) |
| The playground opens but cannot connect, the Live page will not start, or the microphone does not work | [Playground troubleshooting](/docs/troubleshooting/playground) |
| A run stops on a step limit, a node times out, a thread is not found, or a checkpoint fails to save | [Error codes reference](/docs/reference/error-codes), which has a symptom lookup table |
| A message contains a code like `RECURSION_000`, `NODE_TIMEOUT_000`, or `STORAGE_CONFLICT_000` | [Error codes reference](/docs/reference/error-codes) |

The error codes reference page lists every code the system emits, the exception class behind it, what causes it, and the structured error response format the API server returns.

## Before you report an issue

To get help effectively, reproduce the problem with the smallest possible agent and `10xgraph.json` file. Gather:

- Python version (3.12 or newer is required)
- Installed version of `10xgraph` (run `pip show 10xgraph`)
- Installed version of `10xgraph-api` if you are using the server (run `pip show 10xgraph-api`)
- The full error message or error code
- Steps to reproduce starting from a fresh environment

Remove all secrets, API keys and file paths before sharing anything publicly.

## How to report an issue

Check the [GitHub issues](https://github.com/10xGraph/10xGraph/issues) first. Your problem may already have a fix, workaround or explanation. If not, open a new issue with the minimal reproduction case, the versions listed above, what you expected and what actually happened.

For security problems, do not file a public issue. Follow the [security policy](/docs/project/security) instead.

For other help, see the [support page](/docs/project/support).
