---
title: "CORS and security headers"
description: "Configure cross-origin requests, security headers, request size limits, and trusted proxies."
seoTitle: "CORS, Security Headers, and Request Limits"
label: "Security headers"
order: 80
group: "Security"
section: "API server"
updated: "2026-10-27"
faq:
  - question: "Can I use ORIGINS='*' with credentials in production?"
    answer: "No. Wildcard origins combined with credentials is rejected at startup in production mode. Set explicit ORIGINS or disable CORS_ALLOW_CREDENTIALS."
  - question: "What request size limit should I set?"
    answer: "The default 10MB suits most agents. For file uploads, the file route gets a separate limit based on MEDIA_MAX_SIZE_MB. Set MAX_REQUEST_SIZE in bytes."
  - question: "Do I need to configure security headers?"
    answer: "They are enabled by default. In production, review HSTS, CSP, and FRAME_OPTIONS to match your deployment topology."
---

Cross-origin resource sharing (CORS) controls which websites can call your API. Security headers protect against browser-based attacks. Request size limits guard against denial-of-service payloads. Trusted proxy headers let you run behind load balancers and reverse proxies safely. Together, these form the network perimeter of a production 10xGraph deployment.

For how these settings fit the rest of the server's defenses, see the [security model](/docs/production/security-model).

## CORS

The 10xGraph API server accepts cross-origin requests by default via Starlette's `CORSMiddleware`. Configure it to trust only the origins that call your API, and require explicit opt-in for requests that carry credentials.

### Origins and credentials

CORS is configured through environment variables (loaded from your `.env` file or the process environment), not `10xgraph.json`. The `ORIGINS` setting (default `*`) is a comma-separated list of allowed origins (e.g., `https://yourdomain.com, https://app.yourdomain.com`). A wildcard (`*`) allows any origin but is dangerous when combined with credentials.

When `CORS_ALLOW_CREDENTIALS=true` (the default), responses carry `Access-Control-Allow-Credentials: true`. All methods and headers are allowed. This is the credentialed case: cookies, auth headers, or client certificates sent by the browser.

The insecure case happens when you set `ORIGINS=*` and `CORS_ALLOW_CREDENTIALS=true`. The server then reflects any caller's origin back with credentials enabled, which turns every website into a trusted one. In development, this is accepted with a warning. In production (`MODE=production`), the server refuses to start with this configuration.

In production, a wildcard `ORIGINS` is refused even without credentials. `STRICT_PRODUCTION_CHECKS` is on by default in production and stops startup on a wildcard `ORIGINS`, a wildcard `ALLOWED_HOST`, or enabled `DOCS_PATH` and `REDOCS_PATH`. See [Strict production checks](#strict-production-checks).

To run a public, non-credentialed API from any origin in production, set `ORIGINS=*`, `CORS_ALLOW_CREDENTIALS=false` and `STRICT_PRODUCTION_CHECKS=false`. Without the last setting the server will not start. To require authentication or cookies, set `ORIGINS` to explicit domains and keep credentials enabled.

Configure CORS in your environment:

```bash
# Development: accept any origin (warned)
export ORIGINS="*"
export CORS_ALLOW_CREDENTIALS="true"

# Production: accept specific domains, no credentials
export ORIGINS="https://yourdomain.com, https://app.yourdomain.com"
export CORS_ALLOW_CREDENTIALS="false"

# Production: accept specific domains, with credentials (e.g., for SPA with cookies)
export ORIGINS="https://yourdomain.com, https://app.yourdomain.com"
export CORS_ALLOW_CREDENTIALS="true"
```

### Host validation

The `ALLOWED_HOST` setting (comma-separated, default `*`, no spaces after the commas) is checked by the `TrustedHostMiddleware`. It rejects requests to hostnames not in the list, protecting against Host header injection attacks. The `/ping` health check is exempt so container orchestration probes work.

In production, set `ALLOWED_HOST` to the DNS names your API answers to:

```bash
export ALLOWED_HOST="api.yourdomain.com,api-backup.yourdomain.com"
```

A wildcard in the list stops startup in production, including a `*` with spaces around it. See [Strict production checks](#strict-production-checks).

### Strict production checks

When `MODE=production`, the server runs a set of startup checks by default. If any fails, it refuses to start and prints every problem it found. The checks reject:

- a wildcard `ALLOWED_HOST`
- a wildcard `ORIGINS`
- an enabled `DOCS_PATH` or `REDOCS_PATH`

Set `STRICT_PRODUCTION_CHECKS=false` to opt out. The server then starts and logs the same problems as warnings. A wildcard `ORIGINS` together with credentials is still refused, because that check is separate.  The checks apply only in production.

Verify your configuration is working by inspecting the headers:

```bash
# Verify CORS headers are set
curl -X OPTIONS https://yourapi.com/v1/graph/invoke \
  -H "Origin: https://yourdomain.com" \
  -H "Access-Control-Request-Method: POST" -i

# Check for Access-Control-Allow-Origin in the response
# Verify Host header is accepted
curl -i https://api.yourdomain.com/ping
```

## Security headers

Security headers instruct browsers to enforce policies that prevent common attacks. The server adds them to every response via `SecurityHeadersMiddleware`.

### Available headers

These headers are added by default. Configure them via environment variables:

| Header | Default | Purpose | Env var |
|---|---|---|---|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` (HTTPS requests only) | Force HTTPS; cache for 1 year | `HSTS_ENABLED`, `HSTS_MAX_AGE`, `HSTS_INCLUDE_SUBDOMAINS`, `HSTS_PRELOAD` |
| `X-Content-Type-Options` | `nosniff` | Prevent MIME-type sniffing | `CONTENT_TYPE_OPTIONS` |
| `X-Frame-Options` | `DENY` | Prevent clickjacking (disallow framing) | `FRAME_OPTIONS` |
| `X-XSS-Protection` | `1; mode=block` | Enable XSS filtering in legacy browsers | `XSS_PROTECTION` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Control what referer info is sent | `REFERRER_POLICY` |
| `Permissions-Policy` | Disables: geolocation, microphone, camera, payment, usb, magnetometer, gyroscope, accelerometer | Disable unused browser APIs | `PERMISSIONS_POLICY` |
| `Content-Security-Policy` | `default-src 'self'`, scripts and styles from self, inline, `cdn.jsdelivr.net` and `unpkg.com` (styles also Google Fonts), `frame-ancestors 'none'`, `connect-src 'self'` | Control resource loading | `CSP_POLICY` |

### Customizing headers

To disable security headers entirely (not recommended), set `SECURITY_HEADERS_ENABLED=false`.

To customize individual headers, use environment variables. HSTS is only sent over HTTPS connections (detected from `request.url.scheme` or the `X-Forwarded-Proto` header from a proxy):

```bash
# Disable HSTS (for development or behind a load balancer that handles it)
export HSTS_ENABLED="false"

# Extend HSTS cache to 2 years
export HSTS_MAX_AGE="63072000"

# Allow framing by pages on your own origin (also loosen frame-ancestors in CSP_POLICY)
export FRAME_OPTIONS="SAMEORIGIN"

# Customize CSP for third-party resources
export CSP_POLICY="default-src 'self'; script-src 'self' https://cdn.example.com; img-src 'self' data: https:; frame-ancestors 'self'"
```

Verify headers are present and correct:

```bash
curl -i https://yourapi.com/ping | grep -E "^(Strict-Transport-Security|X-Content-Type-Options|X-Frame-Options)"
```

### Content-Security-Policy notes

The default CSP restricts loading and connections to your own origin plus a few CDNs, and sets `frame-ancestors 'none'`. Setting `CSP_POLICY` replaces the whole default policy. If you serve a dashboard or playground from your API server, adjust the policy to allow it. The default permits inline scripts and styles, scripts from `https://cdn.jsdelivr.net` and `https://unpkg.com` (for hosted libraries like Swagger UI), and styles from jsDelivr and Google Fonts.

If you use a custom CSP, ensure it covers:
- Script sources (for your app and any documentation)
- Style sources (fonts, frameworks)
- Image and media sources (data URLs, external CDNs)
- Frame ancestors (set to `'none'` to prevent clickjacking unless you need embedding)

## Request size limits

The server enforces a maximum request body size to prevent denial-of-service attacks via large payloads. The default is 10 MB.

Configure the limit in the environment:

```bash
# 10 MB (default)
export MAX_REQUEST_SIZE="10485760"

# 50 MB (for larger agent state or batch requests)
export MAX_REQUEST_SIZE="52428800"
```

The check happens twice:
1. Synchronously on the `Content-Length` header if present (fast rejection before any body is read)
2. Asynchronously on streamed bodies without `Content-Length` (counted as chunks arrive, cut off as soon as they exceed the limit)

Requests rejected for size return a 413 Content Too Large response:

```json
{
  "error": {
    "code": "REQUEST_TOO_LARGE",
    "message": "Request body too large. Maximum size is 10.0MB",
    "max_size_bytes": 10485760,
    "max_size_mb": 10.0
  },
  "metadata": { "request_id": "...", "status": "error" }
}
```

### File uploads

The file upload route (`POST /v1/files/upload`) gets a separate limit based on `MEDIA_MAX_SIZE_MB` from your media settings. If the media max size is larger than `MAX_REQUEST_SIZE`, the upload route receives an automatically calculated limit that fits the file plus multipart framing overhead (64 KB).

For example, if `MAX_REQUEST_SIZE=10MB` and `MEDIA_MAX_SIZE_MB=50MB`, the upload route allows up to 50 MB, but all other routes enforce 10 MB.

## Trusted proxies

When your API runs behind a load balancer, reverse proxy, or CDN, client IP and the original request scheme (HTTP vs HTTPS) come from proxy headers, not the direct connection.

### Proxy headers

The server trusts these headers when appropriate:

| Header | Used by | Purpose |
|---|---|---|
| `X-Forwarded-Proto` | Security headers | Detects if original request was HTTPS (for HSTS header) |
| `X-Forwarded-For` | Rate limiting | Client IP for per-IP rate limits |

The rate limiter explicitly checks the `trusted_proxy_headers` setting in `10xgraph.json`. Set it to `true` to read `X-Forwarded-For` for rate limiting:

```json
{
  "rate_limit": {
    "by": "ip",
    "trusted_proxy_headers": true
  }
}
```

Security headers middleware automatically checks `X-Forwarded-Proto` to detect HTTPS and send the HSTS header. `X-Forwarded-For` is read from the right: `trusted_proxy_hops` (default `1`) is how many entries your own proxies appended. See [rate limiting](/docs/server/rate-limiting#behind-a-reverse-proxy).

### Production configuration

In production behind a proxy, ensure:
1. The proxy sets `X-Forwarded-Proto: https` if the client connection is HTTPS
2. The proxy sets `X-Forwarded-For: <client-ip>` if you use IP-based rate limiting
3. The proxy is the only service that can reach your API (firewall/network policy)
4. You set `trusted_proxy_headers=true` in rate limiting config if you rely on the header

Example Nginx configuration:

```nginx
location /api/ {
  proxy_pass http://10xgraph-api:8000;
  proxy_set_header X-Forwarded-For $remote_addr;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-Host $server_name;
}
```

## Production checklist

Before deploying to production:

- [ ] Set `MODE=production` (turns off `/docs` and `/redocs` unless you set `DOCS_PATH` or `REDOCS_PATH`, and enforces the CORS, host and JWT secret checks, and turns debug off)
- [ ] Set explicit `ORIGINS` (comma-separated list of domains your frontend runs on)
- [ ] Set `CORS_ALLOW_CREDENTIALS=false` if your API is public and token-based, or `true` if it uses cookies
- [ ] Set `ALLOWED_HOST` to the DNS names the API answers to
- [ ] Review `HSTS_MAX_AGE` (1 year default); ensure your deployment can sustain HTTPS
- [ ] Review `FRAME_OPTIONS` (DENY by default) if you embed the API response in iframes
- [ ] Customize `CSP_POLICY` if you serve a dashboard alongside the API
- [ ] Set `MAX_REQUEST_SIZE` based on your largest expected payload (default 10 MB)
- [ ] If behind a proxy, set `trusted_proxy_headers=true` in rate limiting config and ensure the proxy sets `X-Forwarded-Proto` and `X-Forwarded-For`
- [ ] Verify CORS headers with a curl request from your frontend origin
- [ ] Verify security headers are present: `curl -i https://yourapi.com/ping`

## Troubleshooting

**CORS request blocked:** Check that `ORIGINS` includes your frontend domain. Verify `CORS_ALLOW_CREDENTIALS` matches whether you send credentials. Check browser console for the specific CORS error.

**413 Request Too Large:** Either your payload is over `MAX_REQUEST_SIZE`, or file upload is over `MEDIA_MAX_SIZE_MB`. Increase the relevant limit or split the payload.

**HSTS not sent:** Ensure the request is HTTPS. Check that `HSTS_ENABLED=true` and the server can detect HTTPS (either via request scheme or `X-Forwarded-Proto` header if behind a proxy).

**Rate limits based on IP not working:** Set `trusted_proxy_headers=true` in your rate limit config. Verify the proxy sends the `X-Forwarded-For` header.

Related pages: [`/docs/server/auth`](/docs/server/auth) (auth configuration), [`/docs/server/rate-limiting`](/docs/server/rate-limiting) (rate limiter details), [`/docs/server/production-checklist`](/docs/server/production-checklist) (full production hardening guide).
