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
- [OTLP tracing](/docs/guides/send-traces-to-otlp): Send 10xGraph spans to any OTLP HTTP trace receiver, such as a collector, Tempo, Jaeger or Grafana Cloud.
- [Phoenix tracing](/docs/guides/send-traces-to-phoenix): Send 10xGraph spans to Arize Phoenix over OpenTelemetry using a helper, a publisher, or API server configuration.
- [Logfire and LangSmith tracing](/docs/guides/send-traces-to-logfire-langsmith): Send 10xGraph spans to Pydantic Logfire or LangSmith over OpenTelemetry using helpers, publishers, or configuration.
- [Publishers (Kafka, Redis, RabbitMQ)](/docs/guides/use-publishers): Forward structured events to observability systems using Redis, Kafka, RabbitMQ and more.
