# Throttle-Gate — Rate Limiting Visualizer
### Product Requirements Document (PRD)

> **Purpose of this doc:** A complete build spec for an interactive web app that demonstrates and *visualizes* the five classic rate-limiting algorithms in real time. Written to be handed directly to Claude Code as the source of truth. Build phase-by-phase using the milestones in §11.

---

## 1. Overview

Throttle-Gate is a single-purpose learning app. A configurable load generator fires a continuous stream of requests at a rate limiter; the limiter decides **allow** or **reject** per request using a selected algorithm; every decision — and the limiter's *internal state* at that moment — is streamed live to a browser visualizer.

The headline value is **seeing the algorithm think**: watching the token jar drain, the leaky bucket overflow, the fixed-window counter spike across a boundary. A side-by-side **comparison mode** runs one identical request stream through multiple algorithms at once, so the behavioral differences become obvious rather than theoretical.

This is a portfolio / interview-prep project, not a production service. Optimize for clarity, correctness, and visual explanation over scale.

## 2. Goals & learning objectives

- Implement all five classic algorithms correctly, including **atomic** state updates that survive concurrent requests.
- Make the internal state of each algorithm **legible** through purpose-built visualizations.
- Demonstrate *why* distributed rate limiting needs shared state (the local-counter race condition), visually.
- Reinforce SSE streaming (server → client), `asyncio` concurrency, and Docker Compose multi-service setup.
- Produce a clean talking-point artifact: "here's a thing I built that shows the difference between token bucket and leaky bucket."

## 3. Non-goals (out of scope)

- No authentication, user accounts, or persistence of history across restarts.
- No relational database. Limiter state is ephemeral and lives in Redis (rationale in §5).
- No real upstream service being protected — the "protected endpoint" is a stub that just returns 200.
- No horizontal autoscaling, no Kubernetes. The "distributed" demo is two backend replicas behind one proxy (§10).
- Not mobile-first; target is desktop browser.

## 4. Algorithms to implement

All five from the standard rate-limiting literature. Each spec below is intentionally brief (the algorithms are assumed understood); the important part is the **state shape** that gets streamed and the **visualization hook**.

| Algorithm | Core idea | Streamed state | Visualization |
|---|---|---|---|
| **Fixed Window Counter** | Count requests per fixed time bucket; reset on boundary. | `count`, `limit`, `window_s`, `resets_in_s` | Bar filling toward limit + countdown ring; **highlight boundary burst** when two adjacent windows both fill near the edge. |
| **Sliding Window Log** | Store timestamps; count those within the trailing window. | `timestamps[]`, `window_s`, `limit` | Dots on a horizontal time axis; dots fade/drop off as they age out of the window. |
| **Sliding Window Counter** | Weighted blend of current + previous fixed window. | `curr_count`, `prev_count`, `weight`, `estimate`, `limit` | Two adjacent window bars + an interpolated "estimate" line showing the smoothing. |
| **Token Bucket** | Tokens refill at a fixed rate up to capacity; each request spends one; allows bursts. | `tokens` (float), `capacity`, `refill_rate` | Vertical tank/jar; level drips up at refill rate, drops by 1 per allowed request; bursts drain it visibly. |
| **Leaky Bucket** | Requests queue; drain (leak) at a constant rate; overflow rejected; smooths output. | `queue_depth`, `capacity`, `leak_rate`, `est_wait_ms` | Funnel with stacked drops leaking at a steady rate out the bottom; overflow drops bounce off = rejected. |

**Atomicity requirement:** Token Bucket, Leaky Bucket, and Sliding Window Log/Counter all involve read-modify-write. They **must** be implemented as atomic Redis operations (Lua scripts via `EVALSHA`, or `MULTI/EXEC` where sufficient). A reference Lua script for Token Bucket is in Appendix A — use it as the pattern for the others. Fixed Window may use atomic `INCR` + `EXPIRE`.

## 5. Tech stack

**Backend**
- Python 3.12, **FastAPI**, managed with **`uv`**.
- `redis.asyncio` (redis-py) for state; Lua scripts loaded at startup via `register_script`.
- **SSE** (`text/event-stream`) for the live decision stream (server → client). REST endpoints for control (start/stop/configure).
- Load generator implemented as an `asyncio` task with configurable RPS and traffic patterns.

**Frontend**
- **React + Vite + TypeScript**, **Tailwind CSS**.
- **Recharts** for the request-timeline scatter/throughput charts.
- Custom **SVG + `requestAnimationFrame`** (optionally `framer-motion`) for the per-algorithm animated visualizers — these are bespoke, not chart-library output.
- Native `EventSource` for the SSE connection.

**Infra**
- **Docker Compose**: `frontend`, `backend`, `redis`. For the distributed demo (§10): a second backend replica + a lightweight proxy (`nginx` or `traefik`) round-robining between them.

> **Why no PostgreSQL:** rate-limiter state is short-lived counters and timestamps that must be shared across workers with atomic updates and TTL expiry — exactly Redis's job. A relational DB would add ceremony with zero learning payoff here. Deliberately omitted.

## 6. Architecture

```
┌─────────────┐   SSE stream (decisions + state)   ┌──────────────────────┐
│   Browser   │ <───────────────────────────────── │   FastAPI backend     │
│  (React)    │                                     │                       │
│             │   REST: /control, /config           │  ┌─────────────────┐  │
│  - Controls │ ──────────────────────────────────> │  │ Load Generator  │  │
│  - Stream   │                                     │  │ (asyncio task)  │  │
│  - Visuals  │                                     │  └────────┬────────┘  │
│  - Compare  │                                     │           │ fires     │
└─────────────┘                                     │           ▼           │
                                                     │  ┌─────────────────┐  │
                                                     │  │ Limiter engine  │  │
                                                     │  │ (5 algorithms)  │  │
                                                     │  └────────┬────────┘  │
                                                     └───────────┼───────────┘
                                                                 │ atomic ops (Lua)
                                                                 ▼
                                                          ┌────────────┐
                                                          │   Redis    │
                                                          └────────────┘
```

**Request lifecycle:** UI sends a `start` control with config → backend load generator emits requests at the configured pattern → each request is keyed by `client_id` and evaluated by the active algorithm against Redis state → a `decision` event (allow/reject + post-decision state + latency) is pushed onto the SSE stream → the frontend renders it in the request stream, the timeline, the stats, and the active visualizer.

## 7. Backend specification

### 7.1 REST endpoints (control plane)

- `POST /api/session/start` — body: `RunConfig` (§9.1). Starts the load generator. Returns `session_id`.
- `POST /api/session/stop` — stops the generator, leaves state inspectable.
- `POST /api/session/reset` — stops and flushes all limiter state in Redis.
- `PATCH /api/config` — live-update parameters (RPS, algorithm params, pattern) without restarting the stream.
- `GET /api/algorithms` — static metadata: list of algorithms, their tunable params, defaults, and value ranges (frontend builds the control panel from this).
- `GET /api/healthz` — liveness.

### 7.2 SSE endpoint (data plane)

- `GET /api/stream?session_id=...` — `text/event-stream`. Emits:
  - `event: decision` — one per evaluated request (§9.2).
  - `event: stats` — aggregate snapshot every ~500ms (§9.3).
  - `event: hello` — sent on connect with current `RunConfig` and `worker_id`.
  - heartbeat comment every 15s to keep the connection alive.

### 7.3 Load generator

An `asyncio` task that emits requests at a target RPS following a selectable **pattern**:
- `steady` — constant RPS.
- `burst` — periodic spikes (e.g. 50 req in 200ms, then quiet) — best for showing token-bucket burst tolerance and fixed-window boundary problems.
- `ramp` — linearly increasing RPS over the run.
- `spike` — one large one-off surge, otherwise steady.

The generator supports **multiple simulated clients** (`client_id` ∈ {client-1..N}) so per-key limiting is demonstrable; requests are distributed across clients per config. RPS must be honored without blocking the event loop (schedule with `asyncio.sleep`, jitter optional).

### 7.4 Limiter engine

- A `RateLimiter` base interface: `async def check(client_id: str, cfg) -> Decision`, returning `{allowed: bool, state: dict, retry_after: float | None}`.
- One implementation per algorithm in `app/limiters/`. Each owns its Redis key schema (`{algo}:{client_id}`) and TTLs so idle keys self-expire.
- All read-modify-write logic runs inside Lua (Appendix A pattern). Measure and report per-decision `latency_ms` (time spent in the limiter call).

### 7.5 Comparison mode (backend)

When `RunConfig.compare = [algoA, algoB, ...]`, **the same request** (same `request_id`, `ts`, `client_id`) is evaluated against every listed algorithm using independent Redis keys, and a single `decision` event carries a `results` array — one entry per algorithm. This guarantees an honest, same-input comparison.

## 8. Frontend specification

### 8.1 Layout

A single dashboard screen, three regions:

1. **Control Panel (left rail):** algorithm selector (single or multi for compare), parameter sliders/inputs (driven by `GET /api/algorithms`), RPS slider, pattern selector, client-count selector, Start / Stop / Reset.
2. **Visualizer (center, hero):** the animated state view for the active algorithm (§4). In compare mode, render the selected algorithms' visualizers side by side, each fed the same stream.
3. **Telemetry (right rail + bottom):**
   - **Stats panel:** allowed count, rejected count, allow %, effective throughput (allowed/s), current RPS in.
   - **Request stream:** a fast scrolling list/grid of the most recent requests as colored chips — green = allowed, red = rejected (429). Click a chip → **Request Inspector**.
   - **Timeline:** Recharts scatter of requests over time (x = time, color = allow/reject), with a secondary line for "limit". Makes bursts and rejection clusters visible at a glance.

### 8.2 Per-algorithm visualizers (the centerpiece)

Each is a self-contained component driven by the `state` field of incoming `decision` events; animate between states with `requestAnimationFrame`/`framer-motion` rather than snapping.

- **TokenBucketViz** — vertical tank; token level interpolates upward at `refill_rate` between events and drops by 1 on each allowed request; rejected requests flash at the empty tank.
- **LeakyBucketViz** — funnel with stacked queued drops; a steady leak animation drains the bottom at `leak_rate`; incoming drops that exceed `capacity` visibly overflow = rejected; show live `queue_depth` and `est_wait_ms`.
- **FixedWindowViz** — horizontal bar filling toward `limit` with a reset countdown ring; when a burst straddles a window boundary, flash a "boundary burst" annotation so the vulnerability is unmissable.
- **SlidingLogViz** — dots placed on a trailing time axis; dots age out (fade + remove) as they leave the window; current in-window count shown vs limit.
- **SlidingCounterViz** — two adjacent window bars (prev, curr) + an interpolated "estimate" marker, illustrating how the weighting smooths the boundary.

### 8.3 Request Inspector

A drawer/modal showing the clicked request's full detail: `request_id`, `client_id`, `ts`, algorithm(s), decision, the response status (`200`/`429`), `Retry-After`, simulated `X-RateLimit-Limit` / `X-RateLimit-Remaining` headers, and `latency_ms`. Reinforces what a real rate-limited HTTP response looks like.

### 8.4 SSE handling

- Connect via `EventSource` on session start; handle `decision`, `stats`, `hello`.
- Buffer/throttle DOM updates (e.g. batch with `requestAnimationFrame`) so high RPS doesn't thrash React — the stream can exceed render budget; coalesce.
- Auto-reconnect with backoff on drop; show connection status.

## 9. Data contracts

### 9.1 `RunConfig`
```json
{
  "algorithm": "token_bucket",
  "compare": ["token_bucket", "leaky_bucket"],
  "rps": 20,
  "pattern": "burst",
  "client_count": 1,
  "params": {
    "token_bucket": { "capacity": 10, "refill_rate": 5 },
    "leaky_bucket": { "capacity": 10, "leak_rate": 5 },
    "fixed_window": { "limit": 10, "window_s": 1 },
    "sliding_log": { "limit": 10, "window_s": 1 },
    "sliding_counter": { "limit": 10, "window_s": 1 }
  }
}
```
> `algorithm` is used in single mode; `compare` (length ≥ 2) activates comparison mode and takes precedence.

### 9.2 `decision` event
```json
{
  "type": "decision",
  "request_id": "req_000412",
  "client_id": "client-1",
  "ts": 1719050000.123,
  "results": [
    {
      "algorithm": "token_bucket",
      "allowed": true,
      "status": 200,
      "retry_after": null,
      "latency_ms": 0.6,
      "state": { "tokens": 7.0, "capacity": 10, "refill_rate": 5 }
    },
    {
      "algorithm": "leaky_bucket",
      "allowed": false,
      "status": 429,
      "retry_after": 0.4,
      "latency_ms": 0.7,
      "state": { "queue_depth": 10, "capacity": 10, "leak_rate": 5, "est_wait_ms": 400 }
    }
  ]
}
```
> In single mode `results` has length 1. `state` shape is algorithm-specific per §4.

### 9.3 `stats` event
```json
{
  "type": "stats",
  "ts": 1719050000.5,
  "window_s": 0.5,
  "per_algorithm": {
    "token_bucket": { "allowed": 240, "rejected": 60, "allow_pct": 80.0, "throughput": 12.0 }
  },
  "rps_in": 20.0
}
```

## 10. Distributed mode (improvisation — high educational value)

A toggle that demonstrates *why* shared state matters:

- **Local mode:** run two backend replicas, each keeping limiter state **in process memory** (no Redis). Round-robin traffic across them via the proxy. Result: the *effective* global limit is roughly doubled — requests that should be globally rejected slip through because each replica only sees its own half. Surface this in the UI as "effective limit breached" (observed allow rate exceeds the configured global limit).
- **Shared mode:** same two replicas, but state lives in **Redis** with atomic Lua updates. The global limit now holds regardless of which replica handles a request.

Show both side by side or via a toggle, with a callout explaining the race and the fix. This is the strongest interview talking point in the project, so make the contrast explicit and measurable (display observed global allow-rate vs configured limit in both modes).

## 11. Build milestones (for Claude Code)

Build incrementally; each milestone should run and be demoable on its own.

**Milestone 1 — Backend core + first algorithm.**
FastAPI scaffold with `uv`, Redis via Compose, Token Bucket limiter with atomic Lua (Appendix A), load generator (`steady` + `burst`), SSE `/api/stream` emitting `decision` events, control endpoints. *Done when:* `curl`-ing the SSE stream shows live allow/reject decisions for a token-bucket run.

**Milestone 2 — Frontend core + Token Bucket visualizer.**
Vite/React/TS/Tailwind scaffold, control panel from `GET /api/algorithms`, EventSource client, request stream chips, stats panel, and the animated TokenBucketViz wired to the stream. *Done when:* starting a run animates the token tank and shows green/red chips in real time.

**Milestone 3 — Remaining four algorithms (backend + visualizers).**
Implement Fixed Window, Sliding Window Log, Sliding Window Counter, Leaky Bucket (all atomic), plus their visualizers. *Done when:* each algorithm is selectable and its visualizer animates correctly; the fixed-window boundary burst is observable.

**Milestone 4 — Comparison mode.**
Same-input evaluation across selected algorithms; side-by-side visualizers; timeline overlay. *Done when:* a single `burst` run shows token bucket allowing the burst while leaky/fixed behave differently, simultaneously.

**Milestone 5 — Distributed mode.**
Second backend replica + proxy; local-memory vs Redis-shared toggle; "effective limit breached" detection and callout. *Done when:* local mode visibly exceeds the global limit and shared mode holds it.

**Milestone 6 — Polish.**
Request Inspector, rate-limit headers + `Retry-After`, traffic patterns `ramp`/`spike`, per-client keying UI, throughput chart, reconnect/backoff, empty/error states, README with screenshots.

## 12. Acceptance criteria (overall)

- All five algorithms produce correct allow/reject decisions and self-expiring Redis keys.
- Concurrency-safe: a documented load test (e.g. 200 concurrent requests via `httpx`/`asyncio.gather`) against the naive vs Lua implementation shows the Lua version never over-admits. Include this test.
- The UI sustains ≥ 50 RPS without dropping the connection or freezing (updates coalesced).
- Comparison mode evaluates identical inputs across algorithms (same `request_id`/`ts`).
- Distributed mode demonstrably shows the local-memory limit breach and the Redis fix.
- `docker compose up` brings up the full stack; README documents how to run and what to look for.

## 13. Stretch goals

- Record-and-replay of a traffic pattern for repeatable demos.
- A "manual fire" button to send single hand-crafted requests and watch the state step.
- Latency histogram (p50/p99) of leaky-bucket queue wait.
- Export a run as JSON for later analysis.
- A short guided "tour" overlay that walks a newcomer through each algorithm's behavior.

## 14. Project structure

```
throttle-gate/
├── docker-compose.yml
├── docker-compose.distributed.yml      # M5: 2 replicas + proxy
├── README.md
├── backend/
│   ├── Dockerfile
│   ├── pyproject.toml                  # uv-managed
│   └── app/
│       ├── main.py                     # FastAPI app, routes
│       ├── sse.py                      # SSE stream + event models
│       ├── generator.py                # asyncio load generator + patterns
│       ├── config.py                   # RunConfig, algorithm metadata
│       ├── stats.py                    # rolling aggregates
│       └── limiters/
│           ├── base.py                 # RateLimiter interface, Decision
│           ├── token_bucket.py
│           ├── leaky_bucket.py
│           ├── fixed_window.py
│           ├── sliding_log.py
│           ├── sliding_counter.py
│           └── scripts/                # *.lua atomic scripts
│       └── tests/
│           └── test_concurrency.py     # naive-vs-lua over-admission test
└── frontend/
    ├── Dockerfile
    ├── package.json
    └── src/
        ├── App.tsx
        ├── api/
        │   ├── control.ts              # REST control client
        │   └── stream.ts               # EventSource wrapper + reconnect
        ├── state/                      # run state, buffered stream store
        └── components/
            ├── ControlPanel.tsx
            ├── RequestStream.tsx
            ├── Timeline.tsx
            ├── StatsPanel.tsx
            ├── RequestInspector.tsx
            └── visualizers/
                ├── TokenBucketViz.tsx
                ├── LeakyBucketViz.tsx
                ├── FixedWindowViz.tsx
                ├── SlidingLogViz.tsx
                └── SlidingCounterViz.tsx
```

---

## Appendix A — Reference: atomic Token Bucket (Lua)

Use this as the canonical pattern for all read-modify-write algorithms. State is a Redis hash; the whole compute-and-write runs as one atomic script.

```lua
-- KEYS[1] = bucket key
-- ARGV[1] = capacity
-- ARGV[2] = refill_rate (tokens/sec)
-- ARGV[3] = now (epoch seconds, float)
-- ARGV[4] = requested tokens (usually 1)
local capacity  = tonumber(ARGV[1])
local rate      = tonumber(ARGV[2])
local now       = tonumber(ARGV[3])
local requested = tonumber(ARGV[4])

local d = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(d[1])
local ts     = tonumber(d[2])
if tokens == nil then tokens = capacity; ts = now end

local tokens_now = math.min(capacity, tokens + (now - ts) * rate)
local allowed = 0
if tokens_now >= requested then
  tokens_now = tokens_now - requested
  allowed = 1
end

redis.call('HMSET', KEYS[1], 'tokens', tokens_now, 'ts', now)
redis.call('EXPIRE', KEYS[1], math.ceil(capacity / rate) * 2)  -- idle keys self-expire
return { allowed, tostring(tokens_now) }
```

**Algorithm-specific atomicity notes for the others:**
- **Fixed Window:** `INCR` the window key; if result == 1, set `EXPIRE window_s`; allow while `count <= limit`. Already atomic, no Lua strictly required.
- **Sliding Window Log:** use a Redis **sorted set** keyed by timestamp; in one Lua script `ZREMRANGEBYSCORE` to drop entries older than `now - window`, `ZCARD` to count, and `ZADD` if allowed. TTL = `window_s`.
- **Sliding Window Counter:** keep counts for current and previous fixed windows; in Lua compute `estimate = curr + prev * overlap_weight`; allow while `estimate < limit`.
- **Leaky Bucket:** store `queue_depth` and `last_leak`; in Lua leak `(now - last_leak) * leak_rate`, clamp to ≥ 0, then admit (incrementing depth) only if `depth < capacity`, else reject; report `est_wait_ms = depth / leak_rate * 1000`.

## Appendix B — How to use this doc with Claude Code

1. Drop this file at the repo root and point Claude Code at it: *"Build Milestone 1 from throttle-gate-PRD.md."*
2. Build and verify one milestone before starting the next; the milestones are ordered so each is runnable.
3. Keep the data contracts in §9 fixed — both ends depend on them. If you change a `state` shape, update both the limiter and its visualizer together.