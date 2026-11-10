---
title: Audit log
seoTitle: "Audit log for the 10xGraph API server"
description: "Metadata-only JSON audit events for access, authentication failures and changes, how to configure sinks, ship the lines to storage, and what stays yours."
section: "Security and access"
group: "Audit"
order: 70
label: Audit log
updated: "2026-11-10"
---

The audit log records who accessed or changed which resource, when, and whether it was allowed. It is a stream of JSON lines. 10xGraph produces the stream; it does not store it. Your log pipeline collects it and your storage keeps it. The audit log and JSON application logs ship in 1.0.

## What it records

One event per decision or change, with ids and outcomes only:

- Every permission check and thread, file or task access check: allowed, denied or not found.
- Authentication failures: a missing, invalid or expired token, rejected claims, a reserved identity, a revoked token.
- Successful changes: deleting a thread, message, memory or file, uploading a file, starting, cancelling or rescheduling a task, and revoking a token or user (through the API and `10xgraph revoke`).

## What it never records

Prompts, answers, message text, file contents, tokens, and claims other than ids. An event identifies the caller and the resource by id. It is not a copy of the data, so deleting a user's data does not leave that data in the audit stream.

## Event format

```json
{"v": 1, "ts": "2026-11-10T09:14:02.511Z", "event": "access",
 "request_id": "6f1c...", "transport": "http",
 "user_id": "u-42", "tenant": {"org_id": "acme"}, "roles": ["org_admin"],
 "action": "threads:read", "resource": "thread/abc123",
 "result": "allowed", "reason": null, "client_ip": "203.0.113.7"}
```

| Field | Meaning |
|---|---|
| `v` | Event schema version. |
| `ts` | UTC timestamp. |
| `event` | `access`, `auth` or `change`. |
| `request_id` | The request id, also returned on the response. |
| `transport` | `http` or WebSocket. |
| `user_id` | The verified caller. `null` when the caller is unknown, for example a failed authentication, or when auth is off. |
| `tenant` | The tenant claims resolved from the verified identity, never client input. |
| `roles` | The caller's resolved roles. |
| `action` | The permission checked, as `resource:action`. |
| `resource` | The resource named by the request, such as `thread/<id>`. |
| `result` | See the event types below. |
| `reason` | Why an authentication failed. `null` otherwise. |
| `client_ip` | The client address, using the same trusted-proxy settings as the [rate limiter](/docs/server/rate-limiting). |
| `count` | On `change` events, how many items the service reports it changed, when it returns a count. |

## Event types

| `event` | When | `result` |
|---|---|---|
| `access` | Every permission check and every check of a thread named in a request, frame or body. | `allowed`, `denied` or `not_found` |
| `auth` | A token is missing, invalid or expired, claims are rejected, the identity is reserved, or the token is revoked. | `failed`, with `reason` |
| `change` | After a successful delete or write, file upload, task change, or revocation. | `success` |

## Configure

In `10xgraph.json`:

```json
"audit": {
  "enabled": true,
  "sinks": ["log"],
  "include_reads": true
}
```

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `false` | The audit log is off unless you set it. `10xgraph init --template production` writes `true`. |
| `sinks` | `["log"]` | Where events go. See Sinks. |
| `include_reads` | `true` | Set `false` to keep denials, authentication failures and changes, and drop allowed reads and invokes. Use it to cut volume. |

Unknown keys under `audit` refuse to boot, like `cache_store`. With auth off the audit log still runs, with `user_id` set to `null`, and the server logs a warning at boot. `10xgraph audit` warns when the audit log is off in production.

### JSON application logs

`LOG_FORMAT=text|json` (default `text`) sets the format of every application log line. With `json`, each line is one JSON object with time, level, logger, message, `request_id` and `user_id` when known. The secret sanitizer still applies. `10xgraph build` writes `LOG_FORMAT=json` into the generated compose and Kubernetes environment for production.

## Sinks

- **`log`**: writes one JSON line per event to the logger `tenxgraph_api.audit` on stdout. These lines are always JSON, whatever `LOG_FORMAT` says. The write is synchronous, so there is nothing to flush on shutdown. This is the record.
- **`publisher`**: also sends each event through the publisher you configured (Kafka, Redis, RabbitMQ or OTEL). It is best effort and fire-and-forget: events in flight at SIGTERM may be lost. Treat the `log` sink as the record and the publisher copy as a convenience. See [Use publishers](/docs/guides/use-publishers).
- **`"module:Class"`**: your own sink, a subclass of `BaseAuditSink`.

A minimal custom sink:

```python
from tenxgraph_api import AuditEvent, BaseAuditSink


class MySink(BaseAuditSink):
    async def emit(self, event: AuditEvent) -> None:
        await send_to_my_store(event.model_dump())
```

Reference it in config as `"sinks": ["log", "my_project.audit:MySink"]`. `event.model_dump()` gives the JSON fields from the event table above. The server loads a custom sink once at boot. The path can name an instance, a subclass or a zero-argument factory.

## Ship the lines to storage

The server writes to stdout. From there:

- **Docker or Kubernetes logging**: the container runtime captures stdout. Filter on the logger name `tenxgraph_api.audit` to separate audit lines from application logs.
- **A collector**: Fluent Bit, Vector or an OpenTelemetry collector reads the container logs and forwards them.
- **Object-lock storage or a SIEM**: send the stream to write-once storage or your SIEM when you need tamper resistance. An append-only record is a property of where you store the lines, not of the server.

Retention is yours. 10xGraph keeps no audit data, so choose a retention period that fits your policy and set it in the store you ship to.

## Failure behavior

A sink error never fails a request. The error is logged at ERROR and counted in the `tenxgraph_audit_sink_errors_total` metric when [metrics](/docs/guides/metrics-prometheus-grafana) are on. The request continues. Because of this, alert on that counter if a missing audit line would matter to you.

## See also

- [SOC 2 and ISO 27001 control mapping](/docs/production/control-mapping)
- [Observability](/docs/observability)
- [Authentication and authorization](/docs/server/auth)
