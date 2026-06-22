# Throttle-Gate — Rate Limiting Visualizer

An interactive web app that demonstrates and **visualizes** the five classic
rate-limiting algorithms in real time. A configurable load generator fires a
stream of requests at a rate limiter; every allow/reject decision — and the
limiter's internal state at that moment — is streamed live (SSE) to a browser
visualizer.

See [`docs/throttle-gate_PRD.md`](docs/throttle-gate_PRD.md) for the full spec and
[`docs/throttle-gate_DEVPLAN.md`](docs/throttle-gate_DEVPLAN.md) for the build plan.

## Status

**Phase 0 — infra skeleton.** Runnable empty stack: blank dashboard shell + a
Redis-backed `/api/healthz`. Feature work begins at Milestone 1.

## Stack

- **Backend:** Python 3.12, FastAPI, `redis.asyncio`, managed with `uv`.
- **Frontend:** React + Vite + TypeScript + Tailwind v4, Recharts.
- **Infra:** Docker Compose (`redis`, `backend`, `frontend`).

## Run with Docker (full stack)

```bash
docker compose up --build
```

- UI: http://localhost:5173
- API health: http://localhost:8000/api/healthz

The dashboard header shows a green badge when the backend and Redis are both up.

## Run locally (without Docker)

Backend (needs a Redis on `localhost:6379`, e.g. `docker run -p 6379:6379 redis:7-alpine`):

```bash
cd backend
uv run uvicorn app.main:app --reload --port 8000
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server proxies `/api` → `http://localhost:8000`.
