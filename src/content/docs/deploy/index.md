---
title: Deploy
description: "Package a 10xGraph server with Docker or Kubernetes, and set graceful shutdown and ID generators for running several replicas."
section: "Deploy"
order: 0
updated: "2026-11-10"
---

Deploy covers packaging a 10xGraph server as a container and running it safely: generating Docker and Compose files, generating Kubernetes manifests, shutting down without cutting agent runs short, and choosing ID generators when several replicas run.

- [Docker and Compose](/docs/server/deploy): Generate a Dockerfile, docker-compose.yml and Kubernetes manifest with 10xgraph build, then ship them with a production environment checklist.
- [Kubernetes](/docs/server/kubernetes): Generate a Kubernetes Deployment and Service with 10xgraph build --k8s, tuned for long-running agent operations.
- [Graceful shutdown](/docs/guides/graceful-shutdown): Handle agent shutdown cleanly with signal handlers, timeout coordination, and protected cleanup sections.
- [ID generators for many replicas](/docs/guides/configure-id-generator): Control the format of thread IDs and run IDs using built-in or custom generators to match your storage backend and observability requirements.
