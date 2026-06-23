# Throttle-Gate adapters

Thin clients that put a running Throttle-Gate in front of *your* service. Each one
calls the decision API — `POST /v1/check {key, route}` — and returns `429` with
`Retry-After` / `X-RateLimit-*` headers when the limiter rejects. Every checked
request also streams into the Throttle-Gate dashboard's **Live** mode, so you see
real allow/throttle traffic in the same visualizers.

| Adapter | Status |
|---|---|
| [`fastapi/`](fastapi/) — ASGI middleware for FastAPI/Starlette | ✅ M7 |
| [`express/`](express/) — Express/Connect middleware (Node 18+) | ✅ M8 |
| [`nginx/`](nginx/) — `auth_request` (no app code) | ✅ M8 |
| Envoy `ext_authz` | planned (M8) |
| Cloudflare Worker | planned (M8) |

## FastAPI quick start

1. Start Throttle-Gate (`docker compose up`, backend on `:8000`), open the UI, and
   switch to **Live traffic** mode. Pick the algorithm/limits you want to enforce.
2. Add the middleware to your app:

   ```python
   from throttle_gate import ThrottleGateMiddleware

   app.add_middleware(
       ThrottleGateMiddleware,
       gate_url="http://localhost:8000/v1/check",
       key=lambda req: req.headers.get("x-api-key") or req.client.host,
   )
   ```

3. Send traffic. Allowed requests pass through; rejected ones get `429`. Watch them
   appear live in the dashboard.

See [`fastapi/example_app.py`](fastapi/example_app.py) for a runnable example.

## Express quick start

Dependency-free (uses the global `fetch`, Node 18+); works as Express or any
Connect-style middleware:

```js
const { throttleGate } = require("./throttleGate");

app.use(
  throttleGate({
    gateUrl: "http://localhost:8000/v1/check",
    key: (req) => req.headers["x-api-key"] || req.ip,
  }),
);
```

See [`express/example_app.js`](express/example_app.js) for a runnable example.

### Fail-open vs fail-closed

If the gate is unreachable the middleware **fails open** (serves the request) by
default, so a limiter outage can't take your service down. Pass `fail_open=False`
to fail closed (`503`) instead. A first-class, configurable version of this lands
in M8.
