# Throttle-Gate — Development Plan

Derived from `throttle-gate_PRD.md`. Translates the PRD's six milestones into a
concrete, ordered build. The §9 data contracts are the fixed interface both ends
depend on — if a `state` shape changes, the limiter and its visualizer move together.

## Phase 0 — Repo + infra skeleton (do first)
Get a runnable empty stack before any feature code, so every later milestone is
`docker compose up`-demoable.

- `git init`; create the §14 directory tree as empty stubs.
- `backend/`: `uv init`, add `fastapi`, `uvicorn[standard]`, `redis`, `pytest`, `httpx`.
  Minimal `main.py` with `GET /api/healthz`.
- `frontend/`: `npm create vite@latest` (React + TS), add Tailwind, Recharts.
  Blank dashboard shell with the 3-region layout (left rail / center hero / right rail).
- `docker-compose.yml`: `redis`, `backend`, `frontend` (Vite dev server proxying `/api` → backend).
- **Done when:** `docker compose up` serves the blank UI and `/api/healthz` returns 200,
  talking to Redis.

## Milestone 1 — Backend core + Token Bucket (the spine)
Locks in every cross-cutting contract. Order within it:

1. **Data contracts as Pydantic models** (`config.py`): `RunConfig` (§9.1), `Decision`,
   `decision`/`stats`/`hello` event models (§9.2–9.3). Frozen interface — get it right here.
2. **Limiter interface** (`limiters/base.py`): `RateLimiter.check(client_id, cfg) -> Decision`,
   key schema `{algo}:{client_id}`, `latency_ms` measured around the Redis call.
3. **Token Bucket** (`limiters/token_bucket.py`) using the Appendix A Lua script,
   loaded at startup via `register_script` and run by SHA.
4. **Load generator** (`generator.py`): asyncio task, `steady` + `burst` patterns,
   multi-client fan-out, RPS honored via non-blocking `asyncio.sleep`. Emits onto a per-session queue.
5. **SSE stream** (`sse.py`): `GET /api/stream`, emits `hello` on connect, `decision` per request,
   `stats` every ~500ms, heartbeat comment every 15s.
6. **Control plane** (`main.py`): `start`/`stop`/`reset`, `PATCH /api/config`,
   `GET /api/algorithms` (metadata that drives the frontend control panel).
7. **stats.py**: rolling aggregates feeding the `stats` event.
- **Done when:** `curl -N /api/stream` shows live allow/reject decisions for a token-bucket burst run.

## Milestone 2 — Frontend core + TokenBucketViz
1. `GET /api/algorithms` → render the **Control Panel** (sliders/inputs/selectors, Start/Stop/Reset).
2. **EventSource client** (`api/stream.ts`) + a buffered stream store (`state/`) that coalesces
   high-RPS updates with `requestAnimationFrame` (critical for the ≥50 RPS criterion — build now).
3. **RequestStream** (green/red chips), **StatsPanel**.
4. **TokenBucketViz**: vertical tank, level interpolates upward at `refill_rate` between events,
   drops by 1 per allow, flashes on reject.
- **Done when:** starting a run animates the tank and streams green/red chips in real time.

## Milestone 3 — Remaining four algorithms + visualizers
Build each as a backend+viz pair. All read-modify-write goes in Lua (per Appendix A notes):
- **Fixed Window** — `INCR`+`EXPIRE`; viz = filling bar + countdown ring + boundary-burst flash.
- **Sliding Log** — sorted set `ZREMRANGEBYSCORE`/`ZCARD`/`ZADD` in one Lua script; viz = aging dots.
- **Sliding Counter** — weighted curr+prev estimate in Lua; viz = two bars + estimate marker.
- **Leaky Bucket** — `queue_depth`/`last_leak` leak-and-admit Lua; viz = funnel + overflow bounce.
- **Concurrency test** (`tests/test_concurrency.py`): 200 concurrent `httpx` requests, naive vs Lua,
  asserting Lua never over-admits (§12).
- **Done when:** each algorithm is selectable, its viz animates, fixed-window boundary burst is visible.

## Milestone 4 — Comparison mode
- Backend: when `compare` ≥ 2, evaluate the **same request** (`request_id`/`ts`/`client_id`) against
  each algo on independent keys → one `decision` event with a `results[]` array.
- Frontend: side-by-side visualizers fed one stream; **Timeline** (Recharts scatter, color =
  allow/reject, limit line) as the shared overlay.
- **Done when:** one `burst` run shows token bucket absorbing the burst while leaky/fixed diverge.

## Milestone 5 — Distributed mode (the headline talking point)
- `docker-compose.distributed.yml`: 2 backend replicas + nginx/traefik round-robin.
- **Local mode:** per-process in-memory state → effective global limit roughly doubles.
- **Shared mode:** same replicas, Redis + Lua → limit holds.
- UI toggle + "effective limit breached" detection (observed global allow-rate vs configured limit).
- **Done when:** local mode visibly exceeds the global limit and shared mode holds it.

## Milestone 6 — Polish
Request Inspector drawer, `Retry-After` + `X-RateLimit-*` headers, `ramp`/`spike` patterns,
per-client keying UI, throughput chart, SSE reconnect/backoff, empty/error states, README + screenshots.

---

## Key decisions baked in
- **Contracts frozen at M1** — §9 shapes don't change; limiter and viz move together.
- **Coalesced rendering from M2** — rAF batching is load-bearing for the 50 RPS target, not polish.
- **Lua-first** — every read-modify-write atomic from the start; the M3 concurrency test is the proof.
- **Critical path:** M1 contracts → M2 stream plumbing → everything else parallelizes per-algorithm.
