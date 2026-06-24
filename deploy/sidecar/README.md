# Throttle-Gate sidecar

Run the rate-limiter engine **next to your own service**, sharing a Redis, and
watch live what it allows vs. throttles in the dashboard.

```
                    ┌────────────────────────────────────────┐
   client ──▶ your app ──/v1/check──▶ Throttle-Gate ──▶ Redis │
                    │                       │ SSE              │
                    └───────────────────────┴──▶ dashboard ◀──┘ you, watching
```

## Quick start

```bash
docker compose -f deploy/sidecar/docker-compose.yml up --build
```

- Dashboard: http://localhost:5173 — switch to **Live traffic**, pick the
  algorithm + limits to enforce.
- Demo app: http://localhost:9000/hello

Drive some traffic and watch it throttle in the dashboard:

```bash
for i in $(seq 1 40); do curl -s -o /dev/null -w "%{http_code} " \
    -H 'x-api-key: user-42' localhost:9000/hello; done
```

## What's in the bundle

| Service | Role |
|---|---|
| `redis` | shared limiter state |
| `throttle-gate` | the engine: `/v1/check`, `/v1/authcheck`, dashboard API + SSE |
| `dashboard` | the React UI (how you watch live traffic) |
| `app` | a demo service, rate-limited via the FastAPI middleware adapter |

## Adapting it to your service

Replace the `app` service with your own. Two ways to gate it:

- **In-process middleware** — add a [`adapters/`](../../adapters/) middleware
  (FastAPI, Express, …) and point `GATE_URL` at `http://throttle-gate:8000/v1/check`.
  This is what the demo `app` does.
- **No app code (nginx)** — front your service with the
  [`nginx adapter`](../../adapters/nginx/), which calls `/v1/authcheck` via
  `auth_request`. Best when you can't (or don't want to) change the app.

The dashboard, engine, and Redis stay exactly as above either way.
