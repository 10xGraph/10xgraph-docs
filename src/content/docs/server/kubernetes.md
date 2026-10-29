---
title: Deploy on Kubernetes
description: "Generate a Kubernetes Deployment and Service with 10xgraph build --k8s, tuned for long-running agent operations."
section: "API server"
group: "Operate"
order: 160
label: Deploy on Kubernetes
updated: "2026-10-27"
faq:
  - question: "Why does the termination grace period need to be so long?"
    answer: "Agent runs are not typical web requests. An LLM call alone can take minutes, and tools add more time. Kubernetes default 30-second termination grace period kills pods mid-run. The server uses 600 seconds for shutdown, so the termination window must exceed that."
  - question: "Do I need to scale horizontally?"
    answer: "Start with 2 replicas for redundancy. Scale up for concurrent demand. All replicas share Postgres and Redis, so scaling is straightforward. Configure your load balancer idle timeout for long streaming connections."
  - question: "What if I want to use the generated manifest as-is?"
    answer: "You must pin the container image tag and set a real CORS origin. Production mode refuses to start with wildcard CORS and credentials enabled. API keys and secrets must come from Kubernetes Secrets."
---

## The problem: long runs and short timeouts

A typical agent invocation chains several operations: the client calls the server, the server awaits an LLM response (up to 10 minutes for some models), the LLM might trigger tool calls, tools execute, results return to the LLM, and the response streams back to the client. The entire request can stay open for 20 minutes or more.

Kubernetes' default pod lifecycle is hostile to this. When you trigger a rolling deploy, the kubelet gives a pod 30 seconds to shut down gracefully before sending SIGKILL. If the app is still in an LLM call, the pod dies mid-request, and the client's stream breaks.

On SIGTERM the generated image answers `503` on `/health/ready` (`draining`) so the Service stops routing to the pod, gives open runs up to 540 seconds to finish, and ends open streams with an "interrupted" chunk the client can resume from. Details are in [Graceful shutdown](/docs/guides/graceful-shutdown).

For the scaling model behind these settings, see [scaling and reliability](/docs/production/scaling). Draining runs on shutdown is covered in [Graceful shutdown](/docs/guides/graceful-shutdown).

`10xgraph build --k8s` generates a manifest that fixes this: it sets the termination grace period, pre-termination delay, and probe timeouts so that in-flight runs finish normally, even during deploys.

## Generate the manifest

Create a `Dockerfile` and Kubernetes manifest in one command:

```bash
10xgraph build --k8s --service-name my-agent --port 8000
```

This produces three files:

- `Dockerfile` with a production-ready image that starts Gunicorn with `TenxGraphUvicornWorker` and a 600-second graceful timeout
- `.dockerignore`
- `k8s.yaml` containing a Deployment and a Service

The `--force` flag overwrites existing files. Do not add `--docker-compose` for an image you will run on Kubernetes: with that flag the `Dockerfile` omits its `CMD` and relies on the compose file's `command`. Generate the compose file in a separate run if you need it.

### What the generated manifest includes

The manifest is a working skeleton. It sets these values, which are easy to get wrong:

| Setting | Value | Purpose |
| --- | --- | --- |
| `terminationGracePeriodSeconds` | 675 | Exceeds the app's 600-second graceful timeout plus the 15-second `preStop` sleep, which runs inside the same period. Ensures SIGKILL does not arrive until the app has fully drained. |
| `preStop` sleep | 15 seconds | Gives the load balancer time to notice the pod is terminating and stop routing new requests. Without it, new traffic arrives while the app shuts down. |
| `readinessProbe` | 10s interval, 5s initial delay | Removes unhealthy pods from the load balancer quickly. Checked via `GET /health/ready`. |
| `livenessProbe` | 30s interval, 30s initial delay, 5 failures | Deliberately slack. A worker handling a long run must not be restarted. Checked via `GET /ping`. |

The readiness probe is strict (10-second intervals) because false positives only temporarily remove a pod from rotation. The liveness probe is slack (30-second intervals, 5 consecutive failures required) because a false positive kills the pod mid-run. Readiness hits `/health/ready` (checkpointer, store and Redis reachable) and liveness hits `/ping`; neither requires authentication.

Default resource requests and limits are also set (500m CPU and 512 Mi memory requested; 2 CPU and 2 Gi memory as limits), but you should tune these based on your agents and deployment environment.

### Security defaults

The pod is locked down out of the box:

| Setting | Value | Purpose |
| --- | --- | --- |
| `automountServiceAccountToken` | `false` | The server never calls the Kubernetes API, so a compromised pod gets no cluster token. |
| `runAsNonRoot`, `runAsUser`, `runAsGroup`, `fsGroup` | `true`, 10001 | Matches the image's numeric `USER 10001:10001`. |
| `seccompProfile` | `RuntimeDefault` | Blocks syscalls a web server never needs. |
| `readOnlyRootFilesystem` | `true` | Code and dependencies cannot be modified at runtime. |
| `allowPrivilegeEscalation` | `false` | No setuid binaries can raise privileges. |
| `capabilities.drop` | `ALL` | The server binds a port above 1024 and needs no Linux capabilities. |
| `emptyDir` volumes | `/tmp`, `/app/uploads` | The only writable paths: Gunicorn worker heartbeats and local media uploads. |
| `envFrom.secretRef` | `<service>-secrets` | Every secret comes from a Kubernetes Secret. |

If your graph writes to another path (a SQLite checkpointer file, for example), add a volume for it. A Dockerfile generated before this change runs as a named user without a fixed uid; regenerate it with `10xgraph build --force` so `runAsNonRoot` can verify the user.

## Customize before applying

The manifest is not production-ready as-is. You must edit these values:

```yaml
containers:
  - name: my-agent
    image: registry.example.com/my-agent:1.0.0   # Replace with your own pinned image reference
    env:
      - name: MODE
        value: "production"             # Already set, but verify
```

### Pin the image

The manifest uses `registry.example.com/<service>:1.0.0` as a placeholder image name. Build your own image from the generated `Dockerfile`, push it to your registry, and reference it immutably. A moving `latest` tag makes rollbacks ambiguous and makes image-related issues hard to debug:

- A digest: `my-registry/my-agent@sha256:abc123...`
- A version tag: `my-registry/my-agent:1.4.0`
- A git-based tag: `my-registry/my-agent:git-abc123def`

### Set CORS origins explicitly

The manifest does not set `ORIGINS` or `ALLOWED_HOST` as env entries. Both are read from the Secret (see [Mount secrets](#mount-secrets-do-not-bake-them)), because an env entry in the manifest would override the Secret. Put your actual frontend domain(s) in the Secret, comma-separated if there are multiple:

```bash
kubectl create secret generic my-agent-secrets \
  --from-literal=ORIGINS="https://app.example.com,https://app-staging.example.com" \
  --from-literal=ALLOWED_HOST="app.example.com"
```

With `MODE=production`, the server refuses to start if `ORIGINS` or `ALLOWED_HOST` is the wildcard `*`. The check is `STRICT_PRODUCTION_CHECKS`, which is on by default in production. Production refuses to start while either is missing, so add both to the Secret. If you truly need wildcard origins, set `CORS_ALLOW_CREDENTIALS=false` and `STRICT_PRODUCTION_CHECKS=false`, which is rare.

### Mount secrets, do not bake them

API keys, database passwords, and JWT secrets must come from Kubernetes Secrets, never from plain values in the manifest or baked into the image. The generated manifest already reads every key of a Secret named after the service, and the pod does not start until that Secret exists:

```yaml
envFrom:
  - secretRef:
      name: my-agent-secrets
```

Create the secret in your cluster before deploying. The server reads `JWT_SECRET_KEY`, `JWT_ALGORITHM`, `REDIS_URL`, `ORIGINS` and `ALLOWED_HOST` itself; names such as the Postgres DSN variable below are whatever your graph module reads when it builds the checkpointer:

```bash
kubectl create secret generic my-agent-secrets \
  --from-literal=GOOGLE_API_KEY="..." \
  --from-literal=OPENAI_API_KEY="..." \
  --from-literal=JWT_SECRET_KEY="..." \
  --from-literal=JWT_ALGORITHM="HS256" \
  --from-literal=ORIGINS="https://app.example.com" \
  --from-literal=ALLOWED_HOST="app.example.com" \
  --from-literal=POSTGRES_DSN="postgresql://..." \
  --from-literal=REDIS_URL="redis://..."
```

Use `--from-literal`, not `--from-env-file=.env`: `kubectl` keeps the quotes from a `.env` file as part of each value. Alternatively, use your favorite secrets management tool (Sealed Secrets, External Secrets, Vault, etc.) to manage these safely.

## Apply and verify

Once you have customized the manifest, apply it:

```bash
kubectl apply -f k8s.yaml
```

Monitor the rollout:

```bash
kubectl rollout status deployment/my-agent
kubectl get pods -l app=my-agent
```

Verify the service is reachable:

```bash
kubectl port-forward svc/my-agent 8000:80
curl http://127.0.0.1:8000/ping
```

If `/ping` returns a JSON body with `"data": "pong"`, the deployment is live.

### Test graceful termination

The true test is that a long-running request survives a deploy. Start a streaming request:

```bash
# Terminal 1: Stream a request (this will take minutes)
curl -X POST http://127.0.0.1:8000/v1/graph/stream \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": [{"type": "text", "text": "explain quantum physics in detail"}]}]}'
```

While that request is in flight, trigger a rolling restart in another terminal:

```bash
# Terminal 2: Rolling restart
kubectl rollout restart deployment/my-agent
```

The stream should continue and complete normally. If the connection closes or times out, one of these is true:

- `terminationGracePeriodSeconds` is shorter than your longest run
- The container is not running as PID 1 and not receiving SIGTERM
- Your load balancer's idle timeout is shorter than the grace period

## Scaling horizontally

The manifest defaults to 2 replicas. Scale up for higher concurrency:

```bash
kubectl scale deployment my-agent --replicas=5
```

Before scaling, understand how 10xgraph handles distributed state:

1. **Shared checkpointer is mandatory.** All replicas must read and write to the same Postgres and Redis. If they do not, the same thread will resolve differently depending on which pod answers, causing data loss. Use `PgCheckpointer` in production (see [Set up checkpointing](/docs/guides/set-up-checkpointing)).

2. **Threads are not sticky.** State lives in the checkpointer, not in the pod. You do not need (and should not use) session affinity. A client can invoke a thread on any replica.

3. **Streaming connections are long-lived.** If your load balancer (or ingress) has an idle timeout shorter than your longest run, the connection will close mid-stream even though the pod is healthy. Set idle timeouts to at least 15 minutes. For AWS ALB/NLB, increase `deregistration_delay`. For Nginx, increase `proxy_read_timeout`.

4. **Concurrent writes conflict.** With optimistic concurrency, two overlapping writes to the same thread raise a `StaleStateError`, and the API returns 409. Clients that fan out against a single `thread_id` should retry or serialize. Most clients do not do this; it only matters if you deliberately parallelize writes to the same thread.

### Horizontal Pod Autoscaling (HPA)

For autoscaling, create an HPA resource:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: my-agent
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: my-agent
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 900  # Give long runs time to drain
```

CPU is the provided metric, but it is a poor signal for agent workloads. Agents are typically latency-bound on the model provider, not compute-bound. Scale on queue depth (requests pending in your ingress) or request concurrency (active requests per pod) instead, which your ingress or load balancer can expose.

## Troubleshooting deployments

| Symptom | Cause | Fix |
| --- | --- | --- |
| Runs truncate on every deploy | `terminationGracePeriodSeconds` is too short, or the process is not PID 1 | Increase to 675+ seconds. Ensure your Dockerfile uses `CMD` or `ENTRYPOINT`, not a shell wrapper. |
| Requests fail for a few seconds after a deploy | `preStop` sleep removed or load balancer does not respect endpoint removal | Restore the `preStop` sleep in the manifest. Increase your load balancer's connection drain time. |
| Pods restart during long runs | Liveness probe is too strict (failing too quickly) | Loosen the liveness probe (`periodSeconds: 30`, `failureThreshold: 5`). The readiness probe should be strict; the liveness probe should not. |
| Thread history disappears or threads resolve differently | Replicas do not share a checkpointer | Ensure the Postgres DSN and `REDIS_URL` your graph module uses point to shared instances. Do not use `InMemoryCheckpointer` in production. |
| Random 409 errors under high load | Two requests wrote to the same thread concurrently | This is expected with optimistic concurrency. Retry with exponential backoff, or serialize writes to the same thread. |
| Server exits at startup with a CORS or host error | `ORIGINS` or `ALLOWED_HOST` is `*` | Set both to your real values. If you need wildcard origins, set `CORS_ALLOW_CREDENTIALS=false` and `STRICT_PRODUCTION_CHECKS=false` (unusual). |
| Browser requests fail CORS checks | `ORIGINS` is missing from the Secret or holds the wrong domain | Set `ORIGINS` in the Secret to your real domain. |

## Related

- [Deployment](/docs/server/deploy) for the general container strategy and production decisions
- [Backup and restore](/docs/server/backup-and-restore) for Postgres and Redis backup procedures
- [Observability](/docs/server/observability) for logging, metrics, and traces in production
