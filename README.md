# Throttle-Gate — Rate Limiting Visualizer

An interactive web app that demonstrates and **visualizes** the five classic
rate-limiting algorithms in real time. A configurable load generator fires a
continuous stream of requests at a rate limiter; the limiter decides **allow** or
**reject** per request; every decision — and the limiter's *internal state* at
that moment — is streamed live (SSE) to a browser visualizer.

The point is **seeing the algorithm think**: watching the token jar drain, the
leaky bucket overflow, the fixed-window counter spike across a boundary — and a
side-by-side **comparison mode** that runs one identical request stream through
multiple algorithms at once, so the behavioral differences are obvious rather
than theoretical.

![Token Bucket visualizer](docs/screenshots/token-bucket.png)

## Features

- **Five algorithms**, each with a purpose-built animated visualizer:
  Token Bucket, Leaky Bucket, Fixed Window Counter, Sliding Window Log, Sliding
  Window Counter.
- **Atomic** state updates — every read-modify-write runs as a single Redis Lua
  script (`EVALSHA`), so concurrent requests never over-admit. Proven by a load
  test ([`test_concurrency.py`](backend/app/tests/test_concurrency.py)).
- **Live SSE stream** of per-request decisions + ~500ms aggregate stats, with
  rAF-coalesced rendering that sustains high RPS without thrashing React.
- **Comparison mode** — the *same* request (same `request_id`/`ts`) evaluated
  across multiple algorithms simultaneously, with side-by-side visualizers and a
  throughput-over-time overlay.
- **Distributed mode** — the headline lesson: local (unshared) per-replica state
  breaches the global limit (~N×) while shared Redis state holds it. Demonstrated
  both live in-app and across two real backend replicas behind nginx.
- **Traffic patterns**: steady, burst, ramp, spike. **Per-client keying** with up
  to 8 simulated clients. **Request Inspector** showing the full HTTP picture
  (status, `Retry-After`, simulated `X-RateLimit-*` headers, latency, raw state).

## The five algorithms

| Algorithm | Core idea | Visualization |
|---|---|---|
| **Token Bucket** | Tokens refill at a fixed rate up to capacity; each request spends one. Allows bursts. | Vertical tank; level drips up at the refill rate, drops per allowed request, flashes on reject. |
| **Leaky Bucket** | Requests queue and drain at a constant rate; overflow rejected. Smooths output. | Funnel of stacked drops leaking steadily; overflow bounces off the top. |
| **Fixed Window** | Count requests per fixed time bucket; reset on the boundary. | Filling bar + reset countdown ring + a **boundary-burst** warning when adjacent windows both max out. |
| **Sliding Window Log** | Store timestamps; count those within the trailing window. | Dots on a trailing time axis that age leftward and drop off as they leave the window. |
| **Sliding Window Counter** | Weighted blend of current + previous fixed window. | Two window bars + a gliding estimate marker showing the smoothing. |

## Comparison mode

One `burst` run, three algorithms, same input — Token Bucket absorbs the burst
while Leaky and Fixed diverge, all at once:

![Comparison mode](docs/screenshots/compare.png)

## Distributed mode — why shared state matters

The strongest talking point. With **local** (in-memory, per-replica) state, each
replica enforces the limit independently, so round-robined traffic admits ~N× the
configured global limit — the limit is **breached**. With **shared** Redis state
and atomic Lua, the global limit **holds** regardless of which replica handles a
request.

| Local memory — breached (~2×) | Shared Redis — holds |
|---|---|
| ![Local breach](docs/screenshots/distributed-local.png) | ![Shared holds](docs/screenshots/distributed-shared.png) |

This is demonstrated two ways:
1. **Live in-app** — toggle local/shared and watch the observed allow-rate vs the
   configured limit, with a breach callout.
2. **Real replicas** — `docker-compose.distributed.yml` runs two backend replicas
   behind nginx; [`scripts/distributed_demo.py`](scripts/distributed_demo.py)
   load-tests the protected `/api/gate` endpoint through the proxy:

   ```
   shared  mode:  20/100 admitted   replicas={88eb17ef: 48, 42041ab7: 52}   ← holds
   local   mode:  40/100 admitted   replicas={88eb17ef: 50, 42041ab7: 50}   ← 2× breach
   ```

## Request Inspector

Click any request chip to see what a real rate-limited HTTP response looks like:

![Request Inspector](docs/screenshots/inspector.png)

## Architecture

```
┌─────────────┐   SSE stream (decisions + state)   ┌──────────────────────┐
│   Browser   │ <───────────────────────────────── │   FastAPI backend     │
│  (React)    │                                     │   ┌─────────────────┐ │
│  Controls   │   REST: /session, /config           │   │ Load Generator  │ │
│  Visualizers│ ──────────────────────────────────> │   │ (asyncio task)  │ │
│  Compare    │                                     │   └────────┬────────┘ │
│  Timeline   │                                     │            ▼          │
└─────────────┘                                     │   ┌─────────────────┐ │
                                                     │   │ Limiter engine  │ │
                                                     │   │ (5 algorithms)  │ │
                                                     │   └────────┬────────┘ │
                                                     └────────────┼──────────┘
                                                                  │ atomic Lua
                                                                  ▼
                                                           ┌────────────┐
                                                           │   Redis    │
                                                           └────────────┘
```

## Tech stack

- **Backend:** Python 3.12, FastAPI, `redis.asyncio` (Lua via `register_script`),
  SSE, an asyncio load generator. Managed with `uv`.
- **Frontend:** React + Vite + TypeScript + Tailwind v4, Recharts for the
  timeline, custom SVG + `requestAnimationFrame` for the bespoke visualizers,
  native `EventSource` for SSE.
- **Infra:** Docker Compose (`frontend`, `backend`, `redis`); a distributed
  variant with two replicas + nginx.

## Run with Docker

```bash
docker compose up --build
```

- UI: http://localhost:5173
- API health: http://localhost:8000/api/healthz

## Run locally (without Docker)

Backend (needs Redis on `localhost:6379`, e.g. `docker run -p 6379:6379 redis:7-alpine`):

```bash
cd backend
uv run uvicorn app.main:app --reload --port 8000
```

Frontend:

```bash
cd frontend
npm install
npm run dev    # proxies /api → http://localhost:8000
```

## Distributed demo

```bash
docker compose -f docker-compose.distributed.yml up --build -d
python scripts/distributed_demo.py     # load-test through the proxy
```

## Tests

```bash
cd backend
uv run pytest        # includes the naive-vs-Lua over-admission concurrency test
```

## Project layout

```
backend/app/
  main.py            FastAPI app, control plane, SSE, /api/gate
  sse.py             SSE stream + session manager
  generator.py       asyncio load generator (steady/burst/ramp/spike)
  config.py          RunConfig + algorithm metadata
  stats.py           rolling aggregates
  limiters/          one module per algorithm + Lua scripts
frontend/src/
  api/               REST control + EventSource wrapper
  state/             rAF-coalesced stream store
  components/        ControlPanel, RequestStream, Timeline, Inspector, visualizers/
docker-compose.yml             frontend + backend + redis
docker-compose.distributed.yml two replicas + nginx
```

Built as a portfolio / interview-prep project — optimized for clarity,
correctness, and visual explanation. See [`docs/throttle-gate_PRD.md`](docs/throttle-gate_PRD.md)
for the full spec.
