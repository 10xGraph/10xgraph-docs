---
title: Test before production
seoTitle: "Test a 10xGraph agent before production"
description: "A pre-launch ladder: unit tests, evals and audit as CI gates, a production-mode startup check, and curl smoke tests for auth (401), isolation (403) and rate limits (429)."
section: "Testing and evaluation"
order: 15
label: Before production
updated: "2026-10-27"
faq:
  - question: "Does 10xgraph audit check my production security settings?"
    answer: "No. It is a read-only check of the Python interpreter, installed packages, the evaluation API, 10xgraph.json (a valid agent key and remote-tool schemas) and whether the default port is free. It exits 1 on a failure, so it works as a CI gate for the environment. To see production refusals, start the server once with MODE=production."
  - question: "What does 10xgraph eval --threshold do?"
    answer: "It fails the run (exit code 1) when the overall pass rate is below the value you give, from 0.0 to 1.0. Without it, any pass rate below 100 percent exits 1."
---

Passing unit tests does not show that the server in front of your graph is configured safely. This page is a short ladder to climb before you launch: tests and evals for the agent, then checks of the running server. Each step has a command and a result you can read.

## 1. Unit tests

Run the project tests with the CLI. Arguments after `--` go to pytest unchanged.

```bash
10xgraph test --coverage
```

Options: `--coverage`/`-C`, `--html`, `-k EXPRESSION`, and an optional path. The exit code is pytest's, so a CI job fails when a test fails. See [unit tests](/docs/testing/unit-tests) and [run tests](/docs/testing/run-tests).

## 2. Evals as a gate

Evals score real agent behavior. Use `--threshold` to turn them into a release gate.

```bash
10xgraph eval --threshold 0.9
```

The run exits 1 when the overall pass rate is below `0.9`. Without `--threshold`, the run exits 1 unless every case passes. Reports go to `eval_reports/` as JSON (`--no-report` skips it). See [run evaluations](/docs/testing/run-evals).

## 3. Audit the environment

```bash
10xgraph audit --config 10xgraph.json
```

This is read-only and exits 1 if a check fails, so it also works as a CI gate. It checks the interpreter, installed packages, the evaluation API, `10xgraph.json` and the default port. It does not test your auth or isolation. The next steps do.

## 4. Start once in production mode

Production mode refuses to start on settings that would be unsafe. Starting the server once with `MODE=production` shows you those refusals before your users do. Use the same environment variables and `10xgraph.json` as your deployment, but use a test database.

```bash
MODE=production 10xgraph dev --no-open --no-reload
```

Read the startup log. Examples of what the server refuses or changes:

- `ORIGINS` or `ALLOWED_HOST` left as `*` stops startup while `STRICT_PRODUCTION_CHECKS` is on, which is the default in production. `ALLOWED_HOST` defaults to `*`, so set it. Set exact values, or `STRICT_PRODUCTION_CHECKS=false` to downgrade the refusal to a warning.
- Wildcard `ORIGINS` together with credentials is refused. Set explicit origins or `CORS_ALLOW_CREDENTIALS=false`.
- Debug mode is off and the interactive docs paths are turned off.
- With auth on, a setup whose checkpointer cannot resolve thread owners does not boot.

This check does not catch `auth: null`. A server with no auth starts open even in production, and nothing refuses it. Confirm that auth is configured with the next step. See the [production checklist](/docs/server/production-checklist) and [what 10xGraph does not protect](/docs/production/limits).

## 5. Smoke-test the running server

Run three requests against the server you just started. Replace the port and tokens with your own. For a full walkthrough with two users, see [Security in five minutes](/docs/get-started/security-in-five-minutes).

**Auth: a request without a token returns 401.**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:8000/v1/graph/invoke \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":[{"type":"text","text":"hello"}]}]}'
```

Expected: `401`. A `200` means auth is off.

**Isolation: another user's thread returns 403.** Call as user A, copy `data.meta.thread_id`, then read it as user B.

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer $BOB_TOKEN" \
  http://127.0.0.1:8000/v1/threads/$ALICE_THREAD_ID/messages
```

Expected: `403`. The same request with Alice's token returns `200`.

**Rate limit: a burst returns 429.** Set a low `rate_limit` in a test config (for example `requests: 5`), then send more than that in one window.

```bash
for i in $(seq 1 10); do
  curl -s -o /dev/null -w "%{http_code} " http://127.0.0.1:8000/v1/threads \
    -H "Authorization: Bearer $ALICE_TOKEN"
done; echo
```

Expected: `200` for the first calls, then `429`. The rate-limit response carries a `Retry-After` header. See [rate limiting](/docs/reference/api-cli/rate-limiting).

## 6. Put it in CI

Run steps 1 to 3 on every pull request, and the smoke tests against a staging deployment before each release. When all pass, work through the [production checklist](/docs/server/production-checklist).
