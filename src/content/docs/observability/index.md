---
title: Observability
description: "Logs, metrics, traces and events for a 10xGraph server: logging, Prometheus and Grafana, OTLP, Phoenix, Logfire and LangSmith, and publishers."
section: "Observability"
order: 0
updated: "2026-11-10"
---

Observability covers what a running 10xGraph server and its graphs emit: logs and server telemetry, metrics for Prometheus and Grafana, traces sent to OTLP, Phoenix, Logfire or LangSmith, and events forwarded to message brokers.

- [Logs and server telemetry](/docs/server/observability): Set up structured logging, metrics collection, error tracking with Sentry, and inspect runs via the observability API.
- [Prometheus and Grafana](/docs/guides/metrics-prometheus-grafana): Export request, task and LLM metrics from the 10xGraph API server and worker to Prometheus or Grafana, by OTLP push or by scrape.
- [AI tracing](/docs/guides/send-traces): Send graph, node, LLM and tool spans to an OTLP endpoint, Arize Phoenix, Logfire or LangSmith, from Python or the server.
- [Publishers (Kafka, Redis, RabbitMQ)](/docs/guides/use-publishers): Forward structured events to observability systems using Redis, Kafka, RabbitMQ and more.
