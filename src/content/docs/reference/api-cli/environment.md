---
title: Environment Variables
seoTitle: "API server environment variables reference"
description: "Reference for every environment variable the 10xGraph API server recognizes, grouped by area such as auth, CORS, logging, and Snowflake ID settings."
section: Reference
group: "CLI and configuration"
order: 1770
label: Environment Variables
updated: "2026-10-27"
---

The 10xGraph API server and CLI read configuration from environment variables. This page lists every variable with its default and effect, grouped by area. Set server variables in a `.env` file referenced by `10xgraph.json` or in the process environment. CLI variables control terminal output.

## Setting server variables

### Via .env file

In `10xgraph.json`:

```json
{
  "agent": "graph.react:app",
  "env": ".env"
}
```

In `.env`:

```bash
GOOGLE_API_KEY=your-key
JWT_SECRET_KEY=your-secret
MODE=production
```

### At the process level

```bash
MODE=production 10xgraph api --no-reload
```

---

## Application variables

| Variable | Default | Description |
| --- | --- | --- |
| `APP_NAME` | `MyApp` | Application name shown in logs |
| `APP_VERSION` | `0.1.0` | Application version |
| `MODE` | `development` | `production` (or `prod`), or `development` (or `dev`, `local`). Trimmed and case-insensitive. Unset means `development`. Any other value stops the server at startup, and `10xgraph dev` exits with code 2; the message lists the accepted values. Drives several defaults, including the authorization backend, the run timeout and the strict startup checks. |
| `STRICT_PRODUCTION_CHECKS` | on in production | In production, refuse to start on a wildcard `ALLOWED_HOST`, a wildcard `ORIGINS`, or an enabled `DOCS_PATH` or `REDOCS_PATH`. Set `false` to log warnings instead. Has no effect outside production. |
| `LOG_LEVEL` | `INFO` | Logging level: `DEBUG`, `INFO`, `WARNING`, `ERROR` |
| `IS_DEBUG` | `true` | Enable debug mode. Set `false` in production; leaving it on logs a startup warning. |
| `SUMMARY` | `10xGraph Backend` | One-line service summary shown in the OpenAPI schema |
| `LOGGER_NAME` | `10xgraph-api` | Name of the root logger the server writes under. Read at import time, so it must be a process environment variable; setting it in `.env` is too late. |
| `GRAPH_PATH` | `10xgraph.json` | Path to the config file the ASGI app loads. `10xgraph api --config` sets this for you; set it directly when running the app under an external server such as Gunicorn or Uvicorn. |

The settings model allows extra variables, so unknown names in the environment are tolerated rather than rejected.

---

## Security headers

Applied by the security-headers middleware when `SECURITY_HEADERS_ENABLED` is true.

| Variable | Default | Description |
| --- | --- | --- |
| `SECURITY_HEADERS_ENABLED` | `true` | Add security headers to all responses |
| `HSTS_ENABLED` | `true` | Add `Strict-Transport-Security` |
| `HSTS_MAX_AGE` | `31536000` | HSTS max age in seconds (one year) |
| `HSTS_INCLUDE_SUBDOMAINS` | `true` | Add `includeSubDomains` to the HSTS header |
| `HSTS_PRELOAD` | `false` | Add `preload` to the HSTS header. Only enable if you intend to submit the domain to the preload list; it is hard to undo. |
| `FRAME_OPTIONS` | `DENY` | `X-Frame-Options` value: `DENY`, `SAMEORIGIN`, or `ALLOW-FROM` |
| `CONTENT_TYPE_OPTIONS` | `nosniff` | `X-Content-Type-Options` value |
| `XSS_PROTECTION` | `1; mode=block` | `X-XSS-Protection` value |
| `REFERRER_POLICY` | `strict-origin-when-cross-origin` | `Referrer-Policy` value |
| `PERMISSIONS_POLICY` | `null` | `Permissions-Policy` value. Unset uses the middleware's built-in default. |
| `CSP_POLICY` | `null` | `Content-Security-Policy` value. Unset uses the middleware's built-in default. |

---

## CORS variables

| Variable | Default | Description |
| --- | --- | --- |
| `ORIGINS` | `*` | Comma-separated allowed origins. Set to specific domains in production. |
| `ALLOWED_HOST` | `*` | Allowed `Host` header values |
| `CORS_ALLOW_CREDENTIALS` | `true` | Whether cross-origin requests may carry cookies or auth headers |

<aside class="callout callout-danger" role="note"><p class="callout-title">Wildcard origins plus credentials refuses to start in production</p>

`ORIGINS=*` on its own is a legitimate choice for a public, token-less API, but in production it needs `STRICT_PRODUCTION_CHECKS=false`, because the strict checks refuse a wildcard. The dangerous combination is wildcard origins **together with** credentials: Starlette reflects the caller's `Origin` back alongside `Access-Control-Allow-Credentials: true`, which turns every origin into a trusted, credentialed one.

With `MODE=production`, that combination raises `InsecureCorsConfigError` at startup and the server does not boot, whatever `STRICT_PRODUCTION_CHECKS` says. There are exactly two ways forward:

```bash
# 1. Name the origins explicitly (the usual answer)
ORIGINS=https://yourapp.com,https://api.yourapp.com

# 2. Or serve a public, non-credentialed API from any origin
#    (production also needs the strict checks off)
CORS_ALLOW_CREDENTIALS=false
STRICT_PRODUCTION_CHECKS=false
```

In development the same combination only logs a warning, which tells you the deploy will fail before it does.

</aside>

---

## Authentication variables

| Variable | Description | Required for |
| --- | --- | --- |
| `JWT_SECRET_KEY` | Secret key for JWT signing and verification. No default. | `auth: "jwt"` |
| `JWT_ALGORITHM` | JWT algorithm. Default `HS256`. | `auth: "jwt"` |
| `JWT_ISSUER` | Required `iss` claim. Unset means not checked. | Optional |
| `JWT_AUDIENCE` | Required `aud` claim. Unset means not checked. | Optional |

Both must be set when `10xgraph.json` has `"auth": "jwt"`; the config load raises a `ValueError` otherwise and the server does not start. JWT support also needs the extra: `pip install "10xgraph-api[jwt]"`.

---

## Redis variables

| Variable | Default | Description |
| --- | --- | --- |
| `REDIS_URL` | `null` | Redis connection URL, for example `redis://localhost:6379/0` |

`REDIS_URL` is **optional everywhere**. Two things use it:

- **The ownership authorization cache (L2).** The `ownership` and `rbac` backends resolve their Redis URL from the `redis` key in `10xgraph.json` first, falling back to `REDIS_URL`. With neither set, or with the `redis` package not installed, the cache runs in-process only (L1) and the server logs a warning at startup. Nothing breaks; each worker just pays its own first lookup per thread.
- **`PgCheckpointer`.** It can use Redis as a hot cache layer in front of Postgres. This is a performance choice, not a requirement: `PgCheckpointer` runs without it.

The rate limiter does **not** read `REDIS_URL`. Configure its connection under `rate_limit.redis.url` in `10xgraph.json`.

---

## Snowflake ID variables

Read only by `SnowFlakeIdGenerator`, and only when it is constructed with no arguments.

| Variable | Default | Description |
| --- | --- | --- |
| `SNOWFLAKE_EPOCH` | `1723323246031` | Custom epoch in milliseconds |
| `SNOWFLAKE_TOTAL_BITS` | `64` | Total bits in the generated id |
| `SNOWFLAKE_TIME_BITS` | `39` | Bits reserved for the timestamp |
| `SNOWFLAKE_NODE_BITS` | `7` | Bits reserved for the node id |
| `SNOWFLAKE_NODE_ID` | `0` | This node's id |
| `SNOWFLAKE_WORKER_BITS` | `5` | Bits reserved for the worker id |
| `SNOWFLAKE_WORKER_ID` | `0` | This worker's id |

<aside class="callout callout-warning" role="note"><p class="callout-title">Two different sets of SNOWFLAKE_* defaults exist</p>

The settings model also declares `SNOWFLAKE_*` fields, with **different** defaults (`SNOWFLAKE_EPOCH=1609459200000`, `SNOWFLAKE_NODE_ID=1`, `SNOWFLAKE_WORKER_ID=2`, `SNOWFLAKE_NODE_BITS=5`, `SNOWFLAKE_WORKER_BITS=8`, and no `SNOWFLAKE_TOTAL_BITS` at all). The generator never reads that model; it reads `os.environ` directly. The table above is what actually takes effect.

The practical consequence: reading a default off `get_settings()` will not tell you what ids the generator produces. Set every variable explicitly in any deployment that runs more than one node or worker, and never rely on either set of defaults.

</aside>

See [ID Generator](/docs/reference/python/id-generator) for the constructor contract.

---

## Observability

| Variable | Default | Description |
| --- | --- | --- |
| `OTEL_ENABLED` | `false` | Enable OpenTelemetry tracing |
| `OTEL_SERVICE_NAME` | `10xgraph-api` | Service name reported in spans |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `null` | OTLP collector endpoint |
| `OTEL_LEVEL` | `standard` | Trace detail: `spans`, `standard`, or `full` |

OpenTelemetry needs the extra: `pip install "10xgraph-api[otel]"`, which also brings the FastAPI instrumentation and the OTLP exporter.

Logfire and LangSmith are configured through the `observability` block in `10xgraph.json`; their secrets (`LOGFIRE_TOKEN`, `LANGSMITH_API_KEY`) come from the environment.

---

## Error tracking and sampling

| Variable | Default | Description |
| --- | --- | --- |
| `SENTRY_DSN` | `null` | Sentry DSN for error tracking (optional) |
| `SENTRY_TRACES_SAMPLE_RATE` | `0.1` | Fraction of requests to trace. Range: 0.0 to 1.0. A value of 0.1 means 10% of requests are traced. Set to 0.0 to disable tracing without disabling error tracking. |
| `SENTRY_PROFILES_SAMPLE_RATE` | `0.0` | Fraction of traced requests to profile. Range: 0.0 to 1.0. Profiling is expensive; most deployments use 0.0 or a very low rate like 0.01. Requires `SENTRY_TRACES_SAMPLE_RATE > 0`. |

For Sentry integration, install: `pip install "10xgraph-api[sentry]"`.

---

## Media and multimodal

| Variable | Default | Description |
| --- | --- | --- |
| `MEDIA_STORAGE_TYPE` | `local` | `memory`, `local`, or `cloud` |
| `MEDIA_STORAGE_PATH` | `./uploads` | Directory used by the `local` store |
| `MEDIA_MAX_SIZE_MB` | `25.0` | Maximum upload size in megabytes |
| `DOCUMENT_HANDLING` | `extract_text` | `extract_text`, `pass_raw`, or `skip` |
| `MEDIA_ALLOWED_CONTENT_TYPES` | `""` | Comma-separated MIME allowlist for uploads. **Empty means allow every type.** Entries may be exact (`image/png`) or wildcard subtype (`image/*`). |
| `MEDIA_REQUIRE_OWNER` | `false` | Deny access to files with no recorded owner (uploaded before ownership tracking was enabled, or while auth was disabled). Set to `true` for deployments that require a hard guarantee of ownership isolation. |
| `MEDIA_CLOUD_PROVIDER` | `aws` | `aws` or `gcp`. Cloud storage only. |
| `MEDIA_CLOUD_BUCKET` | `""` | Bucket name |
| `MEDIA_CLOUD_REGION` | `us-east-1` | Bucket region |
| `MEDIA_CLOUD_PREFIX` | `10xgraph-media` | Key prefix inside the bucket |
| `MEDIA_CLOUD_ACCESS_KEY_ID` | `null` | AWS access key |
| `MEDIA_CLOUD_SECRET_ACCESS_KEY` | `null` | AWS secret key |
| `MEDIA_CLOUD_SESSION_TOKEN` | `null` | AWS session token |
| `MEDIA_CLOUD_PROJECT_ID` | `null` | GCP project id |
| `MEDIA_CLOUD_CREDENTIALS_JSON` | `null` | GCP service-account credentials JSON |
| `MEDIA_SIGNED_URL_TTL_SECONDS` | `3600` | Lifetime of a signed direct URL |
| `MEDIA_SIGNED_URL_REFRESH_BUFFER_SECONDS` | `60` | Re-sign this many seconds before expiry |

Document text extraction needs the extra: `pip install "10xgraph-api[media]"`.

See [Files and multimodal](/docs/server/files-and-multimodal) for how these fit together.

---

## Request limits

| Variable | Default | Description |
| --- | --- | --- |
| `MAX_REQUEST_SIZE` | `10485760` (10MB) | Maximum request body size in bytes |

`MAX_REQUEST_SIZE` is enforced by HTTP middleware and applies to requests that declare a `Content-Length`. It does not cover WebSocket frames (bounded separately at 1 MiB per frame on `/v1/graph/live`) or chunked uploads (bounded by `MEDIA_MAX_SIZE_MB` as the body is read).

---

## API path variables

| Variable | Default | Description |
| --- | --- | --- |
| `ROOT_PATH` | `/` | Root path prefix (useful for reverse proxy sub-paths) |
| `DOCS_PATH` | `/docs` | Swagger UI path (set to empty to disable) |
| `REDOCS_PATH` | `/redocs` | ReDoc path (set to empty to disable) |

<aside class="callout callout-tip" role="note"><p class="callout-title">Disable docs in production</p>

With `MODE=production`, both paths default to empty (docs off) unless you set them explicitly. In development you can disable them by clearing the variables:

```bash
# Turn off Swagger UI and ReDoc
DOCS_PATH=
REDOCS_PATH=
```

</aside>

---

## Server concurrency

| Variable | Default | Description |
| --- | --- | --- |
| `WEB_CONCURRENCY` | Unset (`2` in the generated Dockerfile) | Number of Gunicorn workers. Gunicorn reads this variable natively; without it Gunicorn runs one worker. The Dockerfile from `10xgraph build` sets `ENV WEB_CONCURRENCY=2`; override it at deploy time, for example `docker run -e WEB_CONCURRENCY=8 ...`. |

Only Gunicorn reads this variable, for example when started as `gunicorn -k uvicorn.workers.UvicornWorker tenxgraph_api.src.app.main:app`. The development server (`10xgraph api`) does not use it.

---

## LLM provider variables

Set these based on the `provider` you use on your `Agent`. They are read at client creation time.

### LLM timeout

| Variable | Default | Description |
| --- | --- | --- |
| `AGENTFLOW_LLM_TIMEOUT` | `600.0` | Default request timeout in seconds applied to every LLM client. Must be a positive number. See [Configure Agent](/docs/guides/configure-agent#llm-call-timeout) for the programmatic API. |

### OpenAI (`provider="openai"`)

| Variable | Description |
| --- | --- |
| `OPENAI_API_KEY` | API key from https://platform.openai.com |

### Google Gemini (`provider="google"`)

The Google provider supports two backends: the Gemini API (default) and Vertex AI. See [Google integration](/docs/integrations/google#using-vertex-ai).

**Gemini API (Google AI Studio):**

| Variable | Description |
| --- | --- |
| `GEMINI_API_KEY` | API key from https://aistudio.google.com (preferred) |
| `GOOGLE_API_KEY` | Fallback name for the Gemini API key |

**Vertex AI** (enable with `use_vertex_ai=True` on the agent or `GOOGLE_GENAI_USE_VERTEXAI=true`):

| Variable | Default | Description |
| --- | --- | --- |
| `GOOGLE_GENAI_USE_VERTEXAI` | unset | Set to `true` to route the Google provider through Vertex AI process-wide |
| `GOOGLE_CLOUD_PROJECT` | unset | **Required.** GCP project ID with the Vertex AI API enabled |
| `GOOGLE_CLOUD_LOCATION` | `us-central1` | GCP region for Vertex AI calls |
| `GOOGLE_APPLICATION_CREDENTIALS` | unset | Path to a service-account JSON key (Application Default Credentials) |

<aside class="callout callout-note" role="note"><p class="callout-title">Vertex AI authentication</p>

Vertex AI authenticates via [Application Default Credentials](https://cloud.google.com/docs/authentication/application-default-credentials), not an API key. In local development point `GOOGLE_APPLICATION_CREDENTIALS` at a service-account key file. On GCP runtimes (Cloud Run, GKE, Compute Engine) the attached service account is picked up automatically.

</aside>

### Anthropic (`provider="anthropic"` or `provider="anthropic_vertex"` or `provider="anthropic_bedrock"`)

| Variable | Description |
| --- | --- |
| `ANTHROPIC_API_KEY` | API key from https://console.anthropic.com |

For Vertex AI models, see [Anthropic integration](/docs/integrations/anthropic#choosing-a-claude-backend).

---

## CLI variables

These variables control how the `10xgraph` command-line interface renders output: animation, the full-screen frame, and Unicode symbols. A flag is on when the value is `1`, `true`, `yes`, or `on` (case-insensitive). There is no `TENXGRAPH_THEME` variable; the CLI theme is fixed.

| Variable | Default | Description |
| --- | --- | --- |
| `TENXGRAPH_NO_SPINNER` | `false` | Disable the animated spinner and other command animation. Set to `1`, `true`, `yes`, or `on` to disable animation. Falls back to `AGENTFLOW_NO_SPINNER` if set. |
| `TENXGRAPH_FULLSCREEN` | `false` | Opt in to the full-screen terminal frame (pinned header and footer, branded intro). Off by default: output goes to normal scrollback. Same as the `--fullscreen` flag. |
| `TENXGRAPH_NO_FULLSCREEN` | `false` | Force the full-screen frame off even when `TENXGRAPH_FULLSCREEN` is set. Falls back to `AGENTFLOW_NO_FULLSCREEN` if set. |
| `TENXGRAPH_ASCII` | `false` | Disable Unicode symbols in output; use ASCII equivalents instead. Set to `1`, `true`, `yes`, or `on` for ASCII-only mode. Falls back to `AGENTFLOW_ASCII` if set. Useful in terminals with poor Unicode support. |

Each CLI variable has a deprecated `AGENTFLOW_*` equivalent that is used only when the `TENXGRAPH_*` name is not set. The `AGENTFLOW_*` names will be removed in 10xGraph 2.0.
