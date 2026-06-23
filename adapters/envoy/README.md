# Envoy adapter

Rate-limit any upstream behind Envoy using the HTTP `ext_authz` filter — no code
in your app. Envoy asks Throttle-Gate for a verdict before routing each request.

## How it works

```
client ──▶ Envoy ──ext_authz──▶ Throttle-Gate  GET /v1/authcheck  (X-Authz-Mode: envoy)
              │                       │  200 allow / 429 throttle (+ headers)
              │◀───────────────────────┘
              ├─ 200 → route to your upstream
              └─ else → authz response forwarded to client (real 429 + Retry-After)
```

HTTP `ext_authz` treats **only 200** as allow; on any other status it forwards
the authz server's response (status + headers + body) straight to the client. So
the `X-Authz-Mode: envoy` header (injected by [`envoy.yaml`](envoy.yaml)) makes
`/v1/authcheck` return **200** (allow) / **429** (throttle) — the client gets a
real `429` with `Retry-After` / `X-RateLimit-*`. Every checked request also
streams into the Throttle-Gate dashboard (Live mode).

## Use it

1. Run Throttle-Gate (reachable as `throttle-gate:8000`) and switch the dashboard
   to **Live traffic**; pick the algorithm/limits.
2. Point the `app_backend` cluster in [`envoy.yaml`](envoy.yaml) at your service
   and run Envoy:

   ```bash
   docker run --rm -p 8080:8080 \
     -v "$PWD/adapters/envoy/envoy.yaml:/etc/envoy/envoy.yaml:ro" \
     envoyproxy/envoy:v1.31-latest
   ```

3. The limiter key comes from the forwarded `X-Api-Key` header (the config's
   `authorization_request.allowed_headers`); the route is the request path passed
   via the `path_prefix` query.

## Notes

- **Fail open/closed:** `failure_mode_allow: false` (default here) fails closed if
  the gate is unreachable; set it `true` to fail open.
- Rate-limit headers reach the client via
  `authorization_response.allowed_client_headers`.
- This uses the **HTTP** ext_authz service. The gRPC variant (implementing the
  Envoy `CheckRequest`/`CheckResponse` protobuf) is a heavier future option.
