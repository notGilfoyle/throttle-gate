# nginx adapter

Rate-limit any upstream behind nginx using `auth_request`, with no code in your
app at all. nginx asks Throttle-Gate for a verdict before proxying each request.

## How it works

```
client ──▶ nginx ──auth_request──▶ Throttle-Gate  GET /v1/authcheck
                │                         │  204 allow / 403 throttle (+ headers)
                │◀────────────────────────┘
                ├─ 204 → proxy_pass to your app
                └─ 403 → mapped to 429 (Retry-After / X-RateLimit-* preserved)
```

`auth_request` only treats **2xx** (allow) and **401/403** (deny) specially — any
other status (like `429`) becomes a `500`. So the dedicated `GET /v1/authcheck`
endpoint returns **204/403**, and the [`error_page`](throttle-gate.conf) block
maps the `403` back to a real `429` for the client. Every checked request also
streams into the Throttle-Gate dashboard (Live mode).

## Use it

1. Run Throttle-Gate (backend reachable as `throttle-gate:8000`) and switch the
   dashboard to **Live traffic**; pick the algorithm/limits to enforce.
2. Drop [`throttle-gate.conf`](throttle-gate.conf) into your nginx config, point
   the `app_backend` upstream at your service, and reload nginx.
3. The client is identified by the `X-Api-Key` header (swap to `$remote_addr` for
   per-IP limiting); the route is the original request URI.

## Notes

- `proxy_pass_request_body off` keeps the subrequest cheap — the verdict only
  needs the key + route headers.
- To fail **open** on a Throttle-Gate outage, add `error_page 500 502 503 504 =
  @allow;` with a `@allow { proxy_pass http://app_backend; }` location. By default
  an outage fails closed (nginx returns 500).
