# Cloudflare Worker adapter

Rate-limit your origin at the edge. A Worker on your zone checks each request
against Throttle-Gate before passing it through to the origin.

## How it works

```
client ──▶ Cloudflare Worker ──POST /v1/check──▶ Throttle-Gate ──▶ Redis
               │                      │  200 / 429 (+ headers)         │ SSE
               ├─ allowed → fetch(origin)                              ▼
               └─ 429 → return 429 + Retry-After / X-RateLimit-*    dashboard (Live)
```

The limiter key is the `X-Api-Key` header, falling back to `CF-Connecting-IP`
(per-caller); the route is the request path.

## Deploy

1. Run Throttle-Gate somewhere the Cloudflare edge can reach — a public URL or a
   [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
   to your sidecar. Switch the dashboard to **Live traffic** and set the limits.
2. Point `GATE_URL` in [`wrangler.toml`](wrangler.toml) at that gate's
   `/v1/check`, and add a `routes` binding for your zone.
3. Deploy:

   ```bash
   npx wrangler deploy
   ```

## Notes

- **Fail open/closed:** `FAIL_OPEN="true"` (default) serves the origin if the gate
  is unreachable; `"false"` returns `503`.
- Keep `GATE_URL` low-latency to the edge — it's on the request path. For
  per-colo or very high volume, pair this with Cloudflare's own rate limiting and
  use Throttle-Gate for the application-level policy + live visibility.
