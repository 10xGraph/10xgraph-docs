---
title: Observability endpoints
description: Reference for the GET /v1/observability/{thread_id} endpoint that reconstructs a run trace with spans, events, and token usage.
section: Reference
group: "REST API"
order: 380
label: Observability
updated: "2026-11-25"
---

`GET /v1/observability/{thread_id}` returns a reconstructed trace for a run on a thread: a span tree, a flat event list, aggregated token usage, and call counts. It needs the `graph:read` permission. It reads from an in-memory store that is only available outside production (`MODE` other than `production`), so use it for development and the playground, not for production tracing. In production nothing is recorded and the response carries `enabled: false`.

---

## GET /v1/observability/`{thread_id}`

**Path parameters:**

| Parameter | Type | Description |
| --- | --- | --- |
| `thread_id` | string | Thread whose runs to inspect |

**Query parameters:**

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `run_id` | string | latest run | Return this specific run instead of the most recent one |

**Example request:**

```bash
# Latest run for the thread
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8000/v1/observability/my-thread-1"

# A specific run
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8000/v1/observability/my-thread-1?run_id=run-a"
```

**Response:** the standard envelope, shown here with the `data` payload.

```json
{
  "data": {
    "thread_id": "my-thread-1",
    "run_count": 2,
    "run_ids": ["run-a", "run-b"],
    "run": {
      "run_id": "run-b",
      "thread_id": "my-thread-1",
      "status": "done",
      "started_at": 1775000000.0,
      "finished_at": 1775000004.2,
      "duration_ms": 4200.0,
      "spans": [
        {
          "id": "root",
          "name": "graph",
          "kind": "root",
          "parent": null,
          "start_ms": 0.0,
          "duration_ms": 4200.0
        },
        {
          "id": "s1",
          "name": "node: MAIN",
          "kind": "node",
          "parent": "root",
          "start_ms": 5.0,
          "duration_ms": 1800.0
        },
        {
          "id": "s2",
          "name": "llm.generate",
          "kind": "llm",
          "parent": "s1",
          "start_ms": 10.0,
          "duration_ms": 1700.0,
          "model": "gpt-4o-mini",
          "input_tokens": 812,
          "output_tokens": 143
        },
        {
          "id": "s3",
          "name": "tool: get_weather",
          "kind": "tool",
          "parent": "s1",
          "start_ms": 1750.0,
          "duration_ms": 45.0
        }
      ],
      "events": [
        {
          "id": "e1",
          "type": "message",
          "node": "MAIN",
          "offset_ms": 1710.0,
          "summary": "llm.generate · 955 tokens"
        }
      ],
      "usage": {
        "prompt_tokens": 812,
        "completion_tokens": 143,
        "reasoning_tokens": 0,
        "total_tokens": 955
      },
      "llm_calls": 1,
      "tool_calls": 1,
      "iterations": 2
    }
  },
  "metadata": {"request_id": "...", "timestamp": "...", "message": "OK"}
}
```

### Top level

| Field | Type | Description |
| --- | --- | --- |
| `thread_id` | string | The thread that was queried |
| `run_count` | integer | Number of runs recorded for the thread |
| `run_ids` | string array | Every recorded run id, so a client can offer a run picker |
| `enabled` | boolean | `false` when run tracing is off on this server |
| `reason` | string or `null` | Why there is no run: `disabled_in_production`, `store_unavailable` or `no_runs` |
| `run` | object or `null` | The requested (or latest) run. `null` when the thread has no recorded runs. |

### Run

| Field | Type | Description |
| --- | --- | --- |
| `run_id` | string | Run identifier |
| `thread_id` | string | Owning thread |
| `status` | string | `running`, `done`, `error`, or `stopped` |
| `started_at` | number or `null` | Unix timestamp (seconds, fractional) |
| `finished_at` | number or `null` | Unix timestamp (seconds, fractional) |
| `duration_ms` | number | Wall-clock run duration in milliseconds |
| `spans` | array | The span tree, see below |
| `events` | array | Flat event list, see below |
| `usage` | object | Aggregated token usage |
| `llm_calls` | integer | Number of `llm` spans |
| `tool_calls` | integer | Number of `tool` spans |
| `iterations` | integer | Number of node visits |
| `error` | string or `null` | First error text seen in the run |
| `model` | string or `null` | First model seen in the run |
| `models` | string array | Distinct models seen |
| `notes` | string array | Limits of the reconstruction |

### Span

Spans form a tree rooted at a single `root` span covering the whole run.

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Span id, stable within the run. The root span is always `root`; the rest are `s1`, `s2`, and so on in emission order. |
| `name` | string | `graph` for the root, `node: <node>` for node spans, `llm.generate` for LLM spans, `tool: <tool_name>` for tool spans |
| `kind` | string | `root`, `node`, `llm`, or `tool` |
| `parent` | string or `null` | Parent span id. `null` for the root span. |
| `start_ms` | number | Offset from the run start, in milliseconds |
| `duration_ms` | number | Span duration in milliseconds |
| `status` | string | `ok`, `error` or `running` |
| `error` | string or `null` | Error text when `status` is `error` |
| `inputs` | object or `null` | What went in (root: `user_message`, node: `incoming_message`, tool: `args`; `llm` is always `null`) |
| `outputs` | object or `null` | What came out (root: `assistant_message`, node: emitted messages, llm: text and tool calls, tool: result) |
| `step` | integer or `null` | Graph step of the visit. Present on `node` spans. |
| `visit` | integer or `null` | 1-based visit count of this node name. Present on `node` spans. |
| `model` | string or `null` | Model name. Present on `llm` spans. |
| `input_tokens` | integer or `null` | Prompt tokens. Present on `llm` spans. |
| `output_tokens` | integer or `null` | Completion tokens. Present on `llm` spans. |
| `total_tokens` | integer or `null` | Total tokens. Present on `llm` spans. |
| `reasoning_tokens` | integer or `null` | Reasoning tokens. Present on `llm` spans. |
| `tool_name` | string or `null` | Tool name. Present on `tool` spans. |
| `tool_call_id` | string or `null` | Tool call id. Present on `tool` spans. |

### Event

Events are returned **newest first**.

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Event id, `e<index>` in chronological order |
| `type` | string | `message`, `updates`, `state`, `error`, or `result` |
| `node` | string | Node the event is attributed to. Empty when not node-scoped. |
| `offset_ms` | number | Offset from the run start, in milliseconds |
| `summary` | string | One-line summary, for example `tool_call get_weather`, `llm.generate · 955 tokens`, `error`, or `delta` |

### Token usage

| Field | Type |
| --- | --- |
| `prompt_tokens` | integer |
| `completion_tokens` | integer |
| `reasoning_tokens` | integer |
| `total_tokens` | integer |

---

## Availability

The store is in-memory and not durable, and a restart clears it. It keeps at most 200 threads, 20 runs per thread, and 2000 records per run, dropping the oldest first. Invoke and stream both record runs; an invoke trace is coarser.

### Errors and empty results

A thread with no runs, or an unknown `run_id`, is not an error: the endpoint returns 200 with `run: null` (and `run_count` and `run_ids` for any runs that do exist). A missing or invalid token returns 401, and a token without `graph:read` returns 403. In development the thread is read through the caller's reach first, so a thread the caller cannot see returns 404. In production the thread is not checked and the answer is always `enabled: false`.

---

## See also

- [REST API: Graph](/docs/reference/rest-api/graph)
- [10xgraph.json configuration](/docs/reference/api-cli/configuration)
