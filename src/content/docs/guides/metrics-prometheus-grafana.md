---
title: Metrics with Prometheus and Grafana
description: Export request, task and LLM metrics from the 10xGraph API server and worker to Prometheus or Grafana, by OTLP push or by scrape.
section: "Build agents"
group: "Observability and operations"
order: 403
label: Prometheus and Grafana metrics
updated: "2026-11-09"
---

The API server and the background worker can export metrics: request rate and latency, task throughput, node and tool timing, and LLM latency and token use. You turn this on with the `metrics` block in `10xgraph.json`. It is separate from AI tracing, which sends spans to Logfire, LangSmith, Phoenix or an OTLP endpoint.

| | AI tracing (`observability`) | Metrics (`metrics`) |
|---|---|---|
| What it carries | Graph, node, LLM and tool spans | Request rate, latency percentiles, errors, task throughput, LLM latency and tokens |
| Where it goes | Logfire, LangSmith, Phoenix, any OTLP trace endpoint | Prometheus (OTLP push or scrape), Grafana Cloud, an OpenTelemetry Collector |
| What it never carries | Metrics, HTTP request spans | AI traces |

A ready Grafana dashboard and a Docker Compose stack (Prometheus, Grafana and an example setup) are in the [`examples/observability`](https://github.com/10xGraph/10xgraph-api/tree/main/examples/observability) folder of the 10xgraph-api repository.

## Install

```bash
pip install '10xgraph-api[metrics]'
```

The `metrics` extra installs the OpenTelemetry SDK, the FastAPI instrumentation, the OTLP HTTP exporter, the Prometheus exporter and `prometheus-client`. If a package is missing, the server logs a warning with this install command and runs without metrics.

## Configure the metrics block

```json
{
  "metrics": {
    "enabled": true,
    "export": "otlp",
    "otlp": { "endpoint": "http://collector:4318" },
    "prometheus": { "path": "/metrics", "worker_port": 9464 },
    "latency_buckets_ms": [50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000, 120000]
  }
}
```

| Key | Type | Default | Purpose |
|---|---|---|---|
| `metrics.enabled` | boolean | `false` | Turn metrics on |
| `metrics.export` | string | none | `otlp` (push) or `prometheus` (scrape). Required when `enabled` is `true` |
| `metrics.otlp.endpoint` | string or null | `null` | OTLP HTTP base URL. `/v1/metrics` is appended unless present. Required for `otlp` unless `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` or `OTEL_EXPORTER_OTLP_ENDPOINT` is set |
| `metrics.prometheus.path` | string | `/metrics` | Route the API serves for scraping. Must start with `/`, must not be `/`, and must not match any API route (the server refuses to start and names the clashing route). The route skips the auth guard and rate limit, and its own requests are left out of the HTTP metrics |
| `metrics.prometheus.worker_port` | integer | `9464` | Port of the worker's scrape server |
| `metrics.latency_buckets_ms` | array of numbers | 50 to 120000 (see example) | Histogram bucket bounds in milliseconds. Positive and strictly ascending |

Unknown keys inside `metrics` are config errors. The config editor (`10xgraph config`) edits the same block under "Export metrics".

## Option A: Push with OTLP

The server pushes metrics over OTLP HTTP at a fixed interval (60 seconds by default, set with the standard `OTEL_METRIC_EXPORT_INTERVAL`, in milliseconds). Point it at an OpenTelemetry Collector, Grafana Alloy or Grafana Cloud:

```json
{
  "metrics": {
    "enabled": true,
    "export": "otlp",
    "otlp": { "endpoint": "http://collector:4318" }
  }
}
```

Prometheus can also take the push directly. Start it with `--web.enable-otlp-receiver` and use its OTLP base URL:

```json
{
  "metrics": {
    "enabled": true,
    "export": "otlp",
    "otlp": { "endpoint": "http://prometheus:9090/api/v1/otlp" }
  }
}
```

The Prometheus OTLP receiver has no authentication by default, so keep it on a private network.

Send credentials with the standard environment variable, never in the config file:

```bash
export OTEL_EXPORTER_OTLP_HEADERS="authorization=Bearer your-token"
```

Push works with any number of processes. Each process (every gunicorn worker, every TaskIQ worker) has its own `service.instance.id`, made of the host name and the process id, so their pushes do not overwrite each other. Prometheus turns that id into a `service_instance_id` label only when it is configured to promote it (`otlp: promote_resource_attributes: [service.instance.id]` in `prometheus.yml`; the example stack sets it). The `job` label is the process's `OTEL_SERVICE_NAME`, so give the API and the worker different values, for example `tenxgraph-api` and `tenxgraph-worker`, to tell them apart. Use push when you run `WEB_CONCURRENCY` above 1 or several TaskIQ worker processes.

## Option B: Scrape with Prometheus

```json
{
  "metrics": {
    "enabled": true,
    "export": "prometheus",
    "prometheus": { "path": "/metrics", "worker_port": 9464 }
  }
}
```

- The API serves the registry at `metrics.prometheus.path` on the API port.
- The worker serves it on `metrics.prometheus.worker_port`.

Example Prometheus scrape config:

```yaml
scrape_configs:
  - job_name: 10xgraph-api
    static_configs:
      - targets: ["api:8000"]
  - job_name: 10xgraph-worker
    static_configs:
      - targets: ["worker:9464"]
```

One scrape reads one process. The server logs a warning at start when `WEB_CONCURRENCY` is above 1 (an INFO line otherwise). With several gunicorn workers, a scrape hits whichever worker answers, so the numbers are partial. The worker's port can be bound by one process only: when TaskIQ starts more than one worker process, the others log a warning that the port is not available and are not scraped. In both cases use [Option A](#option-a-push-with-otlp), or run a single process.

The scrape route needs no token and is not subject to rate limiting or the trusted-host check, so Prometheus can reach it by pod IP or service name. Keep it on the private network and do not expose it through your public ingress.

## Metric reference

Names below are as Prometheus shows them. OpenTelemetry names turn dots into underscores, add the unit as a suffix (`_seconds`, `_milliseconds`) and add `_total` to counters. A histogram also has `_bucket`, `_sum` and `_count` series.

| Prometheus name | Type | Labels | What it measures |
|---|---|---|---|
| `http_server_request_duration_seconds` | histogram | `http_route`, `http_request_method`, `http_response_status_code` | API request duration. `http_route` is the route template, such as `/v1/threads/{thread_id}` |
| `http_server_active_requests` | gauge | `http_request_method`, `url_scheme` | Requests in flight |
| `tenxgraph_node_executions_total` | counter | `node` | Node runs |
| `tenxgraph_node_errors_total` | counter | `node` | Node errors |
| `tenxgraph_node_timeouts_total` | counter | `node` | Node timeouts |
| `tenxgraph_node_stopped_total` | counter | `node` | Nodes that were stopped |
| `tenxgraph_node_duration_milliseconds` | histogram | `node`, `outcome` | Node duration |
| `tenxgraph_tool_calls_total` | counter | `node`, `tool` | Tool calls. A tool name the node cannot run is recorded as `unknown` |
| `tenxgraph_tool_errors_total` | counter | `node`, `tool` | Tool errors |
| `tenxgraph_tool_timeouts_total` | counter | `node`, `tool` | Tool timeouts |
| `tenxgraph_tool_duration_milliseconds` | histogram | `node`, `tool`, `outcome` | Tool duration |
| `tenxgraph_llm_duration_milliseconds` | histogram | `provider`, `model`, `status` | LLM call duration. `status` is `success` or `error` |
| `tenxgraph_llm_tokens_total` | counter | `provider`, `model`, `type` | Tokens used. `type` is `input` or `output` |
| `tenxgraph_task_runs_total` | counter | `task`, `status` | Background task runs. `status` is `queued`, `success`, `failure` or `cancelled`. The API process counts `queued` when it enqueues a task; the worker counts the rest |
| `tenxgraph_task_duration_milliseconds` | histogram | `task` | Background task duration, once per attempt |

The framework also records checkpointer, background-task-manager and run-recovery metrics. See [Observability](/docs/server/observability#framework-instrumented-metrics) for the full list. Task metrics are described in [Background tasks](/docs/server/background-tasks).

The names are the same whether Prometheus scrapes the exporter or receives the push through its OTLP receiver (directly or through a collector). HTTP also exports `http_server_request_body_size_bytes_*` and `http_server_response_body_size_bytes_*`, and Prometheus adds a `target_info` series with the resource attributes.

## Example queries

p95 request latency by route, without the streaming route:

```text
histogram_quantile(0.95,
  sum by (le, http_route) (
    rate(http_server_request_duration_seconds_bucket{http_route!="/v1/graph/stream"}[5m])
  )
)
```

Share of requests that return a 5xx status:

```text
sum(rate(http_server_request_duration_seconds_count{http_response_status_code=~"5.."}[5m]))
/
sum(rate(http_server_request_duration_seconds_count[5m]))
```

Task failure rate:

```text
sum by (task) (rate(tenxgraph_task_runs_total{status="failure"}[5m]))
/
sum by (task) (rate(tenxgraph_task_runs_total{status=~"success|failure"}[5m]))
```

LLM p95 latency by model:

```text
histogram_quantile(0.95,
  sum by (le, model) (rate(tenxgraph_llm_duration_milliseconds_bucket[5m]))
)
```

Tokens per minute by model and type:

```text
sum by (model, type) (rate(tenxgraph_llm_tokens_total[5m])) * 60
```

## Latency buckets

One setting, `metrics.latency_buckets_ms`, sets the buckets of every duration histogram. HTTP histograms use seconds, so the same bounds are divided by 1000 for them. A percentile can only be as precise as the buckets around it, so put bounds near the latencies you alert on. Fewer buckets mean fewer series.

## Streaming routes

A streaming request counts as one request for its whole life. `/v1/graph/stream` (and a WebSocket session) can last minutes, which pushes the p95 of any panel that includes it. Exclude the streaming routes from latency panels, as in the first query above, and chart them separately.

## Shutdown flush

On SIGTERM the API and the worker push their last metrics before exiting, so requests sent just before the stop still reach Prometheus. On shutdown, the last step of the API and the worker is to push the final metrics and flush AI spans. Each is bounded to 5 seconds, and a timeout logs a warning instead of blocking shutdown. With a collector that does not answer, the process can still take up to the exporter timeout (10 seconds) to exit, after your leases and connections are released. Give your container stop grace period at least that long.

## Use it with the legacy OTEL_ENABLED settings

`OTEL_ENABLED=true` with `OTEL_EXPORTER_OTLP_ENDPOINT` still works as before: traces and metrics over OTLP gRPC. When the `metrics` block is enabled, it owns metrics. The legacy path then keeps sending traces only, and the server logs that metrics come from the metrics block. The `metrics` block uses `metrics.otlp.endpoint`, else the standard `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` or `OTEL_EXPORTER_OTLP_ENDPOINT`, and it never reads the legacy OTLP gRPC settings. See [Observability](/docs/server/observability).

The server adds `http` to `OTEL_SEMCONV_STABILITY_OPT_IN` (keeping any other values you set, and leaving `http` or `http/dup` alone) to get the stable HTTP metric names used above. OpenTelemetry reads that variable once. If another library initialised instrumentation first, the server logs a warning that the HTTP metrics use the older names and units; set the variable in the environment to fix it.

## Troubleshooting

**No metrics appear and the log says packages are missing.** Run `pip install '10xgraph-api[metrics]'`.

**The server fails at start with a metrics error.** `export` is required when `enabled` is `true`, and `export: "otlp"` needs `metrics.otlp.endpoint`, `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` or `OTEL_EXPORTER_OTLP_ENDPOINT`. A `metrics.prometheus.path` that matches an API route (such as `/ping`) also stops the start.

**Numbers are too low or jump around with scrape.** A scrape sees one process. Switch to OTLP push.

**The worker logs "Metrics port 9464 is not available".** More than one worker process tried to bind the port. Use OTLP push or run the worker with `--workers 1`.

**Push fails.** Check the endpoint accepts metrics at `/v1/metrics`. For Prometheus, check it runs with `--web.enable-otlp-receiver` and that the URL ends in `/api/v1/otlp`. Set `OTEL_EXPORTER_OTLP_HEADERS` if the receiver needs a token.

**Route label is empty.** Requests that match no route (a 404, for example) have no `http_route` label. The example dashboard shows them as "(unmatched)".

**Another MeterProvider was installed.** If `opentelemetry-instrument`, Logfire or another module set the global provider first, the server logs a warning. 10xGraph and HTTP metrics still use the `metrics` block; other libraries use the other provider.

## See also

- [Send traces to an OTLP endpoint](/docs/guides/send-traces-to-otlp): AI traces to a collector, Tempo or Jaeger.
- [Server observability](/docs/server/observability): logs, metrics, tracing and Sentry on the API server.
- [Background tasks](/docs/server/background-tasks): task metrics and the worker.
- [Configure the API server](/docs/reference/api-cli/configuration): all `metrics` and `observability` keys.
