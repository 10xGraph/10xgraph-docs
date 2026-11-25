---
title: Deploy
description: "Choose Docker Compose or Kubernetes, see what 10xgraph build generates, what to set before going live, how many replicas and workers to run, and where shutdown and ids fit."
section: "Deploy"
order: 0
updated: "2026-11-25"
---

`10xgraph build` writes the deployment files for your project. You pick a target, fill in the production settings, and ship an image that runs the API in `MODE=production`. The server speaks plain HTTP, so a TLS proxy or load balancer always sits in front of it.

## Choose a path

| | Docker Compose | Kubernetes |
|---|---|---|
| Flag | `10xgraph build --docker-compose` | `10xgraph build --k8s` |
| Writes | `Dockerfile`, `.dockerignore`, `docker-compose.yml` | `Dockerfile`, `.dockerignore`, `k8s.yaml` |
| Good for | One host, a small team, a first production run | Several replicas, rolling deploys, autoscaling |
| Secrets | `.env` file read by Compose (`env_file`) | A Secret that the manifest reads |
| Default replicas | One container, `WEB_CONCURRENCY=2` workers | 2 replicas |
| Guide | [Docker and Compose](/docs/server/deploy) | [Kubernetes](/docs/server/kubernetes) |

With neither flag, `build` writes only the `Dockerfile` and `.dockerignore`. At a terminal it asks where you will deploy. Both targets accept `--worker` and `--scheduler` when your `10xgraph.json` has a `worker` key with a broker other than `memory`.

## What build generates

- A `Dockerfile` with a non-root user (uid 10001), `MODE=production`, a `/ping` healthcheck, and Gunicorn with `TenxGraphUvicornWorker`.
- A graceful timeout of 600 seconds and a worker timeout of 660 seconds, because an agent run can last minutes. Compose and Kubernetes grace periods are set above that.
- A read-only root filesystem and dropped capabilities. Only `/tmp` and `/app/uploads` are writable.
- Optional `worker` and `scheduler` services built from the same image.

The image does not contain `.env`, keys or `10xgraph.json` secrets. Your code and `10xgraph.json` must be copied into it.

## Set before you go live

| Setting | Why |
|---|---|
| `auth` in `10xgraph.json` | With `auth: null` the server starts open, also in production. Set `"auth": "jwt"` or a custom `BaseAuth` class. |
| `JWT_SECRET_KEY` | 32 bytes or more, from a secret manager. |
| `ORIGINS` and `ALLOWED_HOST` | A wildcard `*` stops startup in production. |
| `cache_store.type: "redis"` and `REDIS_URL` | Without it, locks, caps, rate limits and revocations are per process. |
| A durable checkpointer such as `PgCheckpointer` | `InMemoryCheckpointer` loses threads on restart and replicas do not share it. |
| Pinned dependencies and image tag | The manifest uses the placeholder `registry.example.com/<service>:1.0.0`. Replace it. |

Then run the [production checklist](/docs/server/production-checklist) and the [pre-production tests](/docs/testing/before-production).

## Replicas and workers

- API workers are stateless. Run more of them behind the load balancer, with Postgres for state and Redis for shared cache. Threads are not sticky.
- Size on concurrent runs, not CPU alone. A run holds a connection open while it waits on model calls.
- Set load balancer idle timeouts to at least 15 minutes, or long streams close mid-run.
- Job workers (`10xgraph worker`) are a separate deployment, scaled on queue depth. Run exactly one `10xgraph scheduler`.
- Details and failure behaviour: [Scaling and reliability](/docs/production/scaling).

## Shutdown and ids

- On SIGTERM the worker marks the app as draining, `/health/ready` answers 503, and open runs get up to 540 seconds to finish by default. See [Graceful shutdown](/docs/guides/graceful-shutdown).
- With several replicas, use ids that cannot collide. The default uuid4 generator is safe. For time-ordered numeric ids use Snowflake with a distinct node id per instance. See [ID generators](/docs/guides/configure-id-generator).

## Pages in this section

- [Docker and Compose](/docs/server/deploy): flags, generated files and production settings.
- [Kubernetes](/docs/server/kubernetes): manifest contents, security defaults, scaling and rollout checks.
- [Graceful shutdown](/docs/guides/graceful-shutdown): signals, draining and `aclose()`.
- [ID generators for many replicas](/docs/guides/configure-id-generator): built-in and custom generators.
