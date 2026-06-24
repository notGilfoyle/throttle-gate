# Throttle-Gate — Architecture & Code Walkthrough

A guided tour of how the whole thing works: the mental model, the end-to-end data
flow, then a layer-by-layer deep dive of the backend and frontend, and finally the
cross-cutting ideas (atomicity, SSE, coalesced rendering, the distributed lesson).

If you read one section, read **§2 The request lifecycle** — everything else hangs
off it.

---

## 1. The mental model

There are three running processes:

```
  Browser (React/Vite)  ──REST control──▶  FastAPI backend  ──atomic Lua──▶  Redis
        ▲                                        │
        └──────────────  SSE stream  ────────────┘
```

- **Redis** holds all limiter state (counters, token levels, timestamp sets). It's
  the only state store — no database. State is ephemeral and self-expires via TTLs.
- **The backend** runs a load generator (an asyncio task) that fires synthetic
  requests at the limiter engine, and streams every decision to the browser over
  Server-Sent Events (SSE).
- **The frontend** sends control commands (start/stop/configure) over plain REST,
  and *receives* the live decision/stats stream over one long-lived SSE connection,
  which it renders into animated visualizers.

The split is deliberate: **control plane = REST** (request/response), **data plane =
SSE** (server → client streaming). That's the same shape real streaming systems use.

---

## 2. The request lifecycle (the spine)

Follow one synthetic request from button-press to pixel:

1. **User presses Start.** The frontend POSTs a `RunConfig` to
   `POST /api/session/start`. The backend creates a `Session`, kicks off its load
   generator task, and returns a `session_id`.
2. **Frontend opens the stream.** It connects an `EventSource` to
   `GET /api/stream?session_id=…`. The backend immediately sends a `hello` event
   (the active config + this worker's id).
3. **The generator fires a request.** Inside the backend, the `LoadGenerator` loop
   wakes on its schedule (steady/burst/ramp/spike), mints a `request_id`, picks a
   `client_id`, and—
4. **The limiter evaluates it.** For each active algorithm, the generator calls
   `limiter.check(client_id, params, now, node)`. The limiter runs **one atomic Lua
   script** in Redis that reads state, computes allow/reject, writes new state, and
   sets a TTL — all in a single round trip that can't interleave with other requests.
5. **A `decision` event is built.** `{request_id, client_id, ts, results[]}` where
   each `results` entry is one algorithm's verdict + its post-decision `state`. It's
   pushed onto every subscriber's queue.
6. **Stats roll up.** A side task emits a `stats` event ~every 500ms with cumulative
   allowed/rejected and rolling throughput per algorithm.
7. **The browser receives it.** The `EventSource` fires; the `StreamStore` drops the
   event into a mutable buffer (no React render yet).
8. **One render per animation frame.** A `requestAnimationFrame` tick folds the
   buffered events into an immutable snapshot and notifies React once. Components
   read the snapshot; the visualizer's own rAF loop interpolates the animation
   (e.g. the token level dripping up) between events.

Steps 3–6 repeat many times per second; step 8 throttles all of it to ≤1 React
render per frame. That decoupling is why the UI survives 50+ RPS.

---

## 3. Backend deep dive

Stack: Python 3.12, FastAPI, `redis.asyncio`, managed with `uv`. Everything is
async; the event loop is never blocked.

### 3.1 Data contracts — [`config.py`](../backend/app/config.py)

The single source of truth for the wire format. Pydantic models:

- **`RunConfig`** — the body of start/patch: `algorithm`, `compare[]`, `rps`,
  `pattern`, `client_count`, per-algorithm `params`, and `distributed`. The method
  `active_algorithms()` returns `compare` if it has ≥2 entries, else the single
  `algorithm` — this one method is what makes "compare mode" just fall out of the
  normal path.
- **Per-algorithm param models** (`TokenBucketParams`, etc.) with defaults.
- **`ALGORITHMS`** — static metadata (label, description, tunable params with
  min/max/step, and the `state_fields` each algorithm streams). The frontend builds
  its entire control panel from this, so adding a param never touches the UI code.

> **Why this matters:** both ends import these shapes conceptually. They were frozen
> at Milestone 1 and never changed, so the backend and frontend never drifted.

### 3.2 The limiter engine — [`limiters/`](../backend/app/limiters/)

**The base class** [`base.py`](../backend/app/limiters/base.py) defines:

- `Decision` — one algorithm's verdict: `{algorithm, allowed, status, retry_after,
  latency_ms, state}`.
- `RateLimiter.check(...)` — the template method: it records `perf_counter()` around
  the subclass's `evaluate(...)`, maps `allowed → 200/429`, and packages a
  `Decision`. Subclasses only implement `evaluate`, returning
  `(allowed, state, retry_after)`.
- `state_key(client_id, node, suffix)` — builds the Redis key
  `{algo}[:{node}]:{client_id}[:{suffix}]`. The optional `node` is the hook for
  distributed mode (§3.7); `suffix` carries e.g. a window index.
- `load_script(file)` — registers a Lua script via `register_script`, returning a
  callable that runs it by SHA (`EVALSHA`).

**Atomicity is the whole point.** Token Bucket, Leaky Bucket, and the sliding
algorithms all do read-modify-write. If you read tokens, decide, then write in three
separate calls, two concurrent requests can both read "9 tokens left," both decide
"allowed," and both write — admitting 2 when only 1 was available. The fix: put the
entire read-decide-write in **one Lua script**, which Redis runs atomically (single
threaded, no interleaving). See the reference
[`token_bucket.lua`](../backend/app/limiters/scripts/token_bucket.lua):

```lua
local tokens_now = math.min(capacity, tokens + (now - ts) * rate)  -- refill
if tokens_now >= requested then tokens_now = tokens_now - 1; allowed = 1 end
redis.call('HMSET', KEYS[1], 'tokens', tokens_now, 'ts', now)       -- write
redis.call('EXPIRE', KEYS[1], math.ceil(capacity / rate) * 2)       -- self-expire
```

The five algorithms, each a `RateLimiter` subclass + a `.lua` script:

| Algorithm | Redis structure | Atomic op |
|---|---|---|
| [Token Bucket](../backend/app/limiters/token_bucket.py) | hash `{tokens, ts}` | refill by elapsed×rate, spend 1 if available |
| [Leaky Bucket](../backend/app/limiters/leaky_bucket.py) | hash `{depth, ts}` | leak by elapsed×rate, admit if room for one more |
| [Fixed Window](../backend/app/limiters/fixed_window.py) | counter, key includes `floor(now/window)` | `INCR` + `PEXPIRE` on first; allow if ≤ limit |
| [Sliding Log](../backend/app/limiters/sliding_log.py) | sorted set of timestamps | `ZREMRANGEBYSCORE` old, `ZCARD`, `ZADD` if under limit |
| [Sliding Counter](../backend/app/limiters/sliding_counter.py) | two counters (curr + prev window) | `estimate = curr + prev×weight`; allow if `< limit` |

The window-index trick (Fixed/Sliding Counter) is elegant: by baking
`floor(now/window_s)` into the key, a new window automatically starts with a fresh
counter, and the old key self-expires. No reset logic needed.

[`limiters/__init__.py`](../backend/app/limiters/__init__.py) is a registry mapping
keys → classes, and `build_limiters()` instantiates + `setup()`s each (loading its
Lua) once at app startup. Limiters are stateless wrappers over Redis, so a single
instance per algorithm is shared across all sessions and requests.

### 3.3 The load generator — [`generator.py`](../backend/app/generator.py)

An asyncio task that emits requests without blocking the loop. The core is
`_next_delay(now)` — given the pattern and target RPS, how long to sleep before the
next request:

- **steady** → `1/rps` constant.
- **burst** → a dense burst (`rps × period/active`) for 0.25s, then idle until the
  next 2s period. Averages out to `rps`, but clumps — perfect for showing token
  bucket's burst tolerance and the fixed-window boundary problem.
- **ramp** → RPS climbs linearly from 10% to 100% over 15s, then holds.
- **spike** → steady, with a brief 6× surge once every 8s.

The loop uses `asyncio.wait_for(stop.wait(), timeout=delay)` instead of
`asyncio.sleep(delay)` — so a Stop interrupts the sleep instantly instead of waiting
it out. Config is read **live** each iteration, so `PATCH /api/config` (e.g. dragging
the RPS slider) takes effect without restarting.

`_fire()` mints the `request_id`, round-robins the `client_id`, evaluates against
every active algorithm, and hands the assembled `decision` event to a callback
(`on_decision`). In compare mode `active_algorithms()` returns several, so `results[]`
has several entries — **same request, same `ts`, evaluated against each** — which is
what makes the comparison honest.

### 3.4 Sessions & SSE — [`sse.py`](../backend/app/sse.py)

A **`Session`** ties together a `RunConfig`, a `LoadGenerator`, a `StatsAggregator`,
and a set of subscriber queues. Key pieces:

- **Pub/sub fan-out.** Each connected browser gets an `asyncio.Queue`
  (`subscribe()`). When the generator produces a decision, `_broadcast()`
  `put_nowait`s it onto every queue. If a queue is full (slow consumer), the event is
  dropped rather than blocking the generator — backpressure that protects the
  producer.
- **Two background tasks** per running session: the generator loop, and a stats loop
  that broadcasts a `stats` snapshot every 500ms.
- **Lifecycle.** `start()` launches the tasks; `stop()` sets the stop event and awaits
  them, but leaves the session inspectable (state stays in Redis). `reset()` stops
  everything and `flushdb()`s Redis.

**`stream_events(session)`** is the SSE generator function. It yields `hello`, then
loops pulling from the subscriber queue and yielding SSE frames. The clever bit:

```python
event = await asyncio.wait_for(q.get(), timeout=15)   # got an event → send it
# on timeout: yield ": heartbeat\n\n"                  # 15s quiet → keepalive comment
```

So heartbeats are free — they're just what happens when no event arrives for 15s.
`sse_format()` renders each event as `event: <type>\ndata: <json>\n\n`, the SSE wire
format the browser's `EventSource` parses by event name.

**`SessionManager`** owns the shared limiters and the live sessions, created once in
the app lifespan.

### 3.5 Stats — [`stats.py`](../backend/app/stats.py)

`StatsAggregator` keeps **cumulative** allowed/rejected per algorithm (the running
totals) plus **rolling deques** of recent event timestamps for rate calculations.
`snapshot(now)` trims the deques to the last second and computes `throughput`
(allowed/s) and `rps_in` (requests/s). So the stats panel shows lifetime totals while
the timeline shows live rates.

### 3.6 Endpoints — [`main.py`](../backend/app/main.py)

| Method & path | Purpose |
|---|---|
| `GET /api/healthz` | Liveness + Redis ping + this process's `worker_id` |
| `GET /api/algorithms` | Static metadata → frontend builds the control panel |
| `POST /api/session/start` | Body `RunConfig` → creates a session, starts generating, returns `session_id` |
| `POST /api/session/stop` | Halts generation, leaves state inspectable |
| `POST /api/session/reset` | Stops all + flushes Redis |
| `PATCH /api/config` | Live-update a running session's config (mutates in place) |
| `GET /api/stream?session_id=` | **SSE**: `hello`, then `decision` + `stats`, 15s heartbeats |
| `POST /api/gate` | Single-request limiter check for the real-replica demo (§3.7) |

The app **lifespan** opens the Redis pool and builds the limiters on startup, and
closes them on shutdown. `PATCH /api/config` mutates the existing config object in
place (not a reassignment) precisely because the running generator holds a reference
to it — mutating in place is how the change propagates live.

### 3.7 The distributed mechanism

The lesson is *"unshared state breaches a global limit."* It's modeled with the
`node` parameter on `state_key`:

- **shared mode** → `node = None` → all replicas use one key `{algo}:{client}` →
  one global bucket → limit holds.
- **local mode** → `node = "r0"/"r1"/…` → each replica has an isolated key
  `{algo}:r0:{client}` → N independent buckets → effective limit ≈ N × configured.

Two ways it's demonstrated:

1. **Live, in one process** ([`generator.py`](../backend/app/generator.py)): the
   generator round-robins each request to `replica = seq % replicas` and passes the
   matching `node`. The UI reads observed allow/s vs the configured single-node rate
   and flags the breach.
2. **Real, multi-process** ([`docker-compose.distributed.yml`](../docker-compose.distributed.yml)):
   two real backend replicas behind an nginx round-robin proxy. The `/api/gate`
   endpoint, in `local` mode, namespaces state by *this process's* `worker_id` — so
   each real replica has isolated state. [`scripts/distributed_demo.py`](../scripts/distributed_demo.py)
   fires a concurrent burst through the proxy and shows shared admitting ~limit while
   local admits ~2×, with both replicas serving traffic.

The neat part: **the atomic Lua path is identical in both modes.** That's the precise
lesson — atomicity *per node* isn't enough; you need *shared* state.

---

## 4. Frontend deep dive

Stack: React + Vite + TypeScript + Tailwind v4, Recharts for the timeline, custom
SVG + `requestAnimationFrame` for the bespoke visualizers, native `EventSource`.

### 4.1 Contracts — [`types.ts`](../frontend/src/types.ts)

TypeScript mirrors of the backend Pydantic models. Keeping these in lockstep is what
prevents drift; a `state` shape change touches the limiter and its visualizer
together.

### 4.2 API clients — [`api/`](../frontend/src/api/)

- [`control.ts`](../frontend/src/api/control.ts) — thin `fetch` wrappers for the REST
  control plane (getAlgorithms, start/stop/reset, patchConfig).
- [`stream.ts`](../frontend/src/api/stream.ts) — `StreamConnection`, an `EventSource`
  wrapper with **explicit reconnect + exponential backoff** (500ms → 10s cap) and a
  connection-status callback (`connecting`/`open`/`reconnecting`/`closed`). Native
  `EventSource` auto-retries, but wrapping it lets the UI show status and bound the
  backoff.

### 4.3 The coalescing store — [`state/streamStore.ts`](../frontend/src/state/streamStore.ts)

**This is the most important frontend piece.** SSE can deliver events faster than
React can render. So:

- Incoming events land in **mutable buffers** (`pendingDecisions`, `pendingStats`,
  …) — no React involvement.
- The first event schedules a `requestAnimationFrame`. On the next frame, `flush()`
  folds all buffered events into a **new immutable snapshot** (recent decisions
  capped at 150, latest state per algorithm, latest stats, a rolling stats history
  for the timeline) and notifies subscribers **once**.

So no matter how many events arrive between frames, React renders at most once per
frame (~60fps). [`useStream.ts`](../frontend/src/state/useStream.ts) exposes the
snapshot via `useSyncExternalStore` — the idiomatic React way to subscribe to an
external store without tearing.

### 4.4 Components — [`components/`](../frontend/src/components/)

- [`ControlPanel.tsx`](../frontend/src/components/ControlPanel.tsx) — built entirely
  from `/api/algorithms` metadata. Single/Compare toggle, param sliders, RPS,
  pattern, clients, and the Distributed section.
- **Visualizers** [`visualizers/`](../frontend/src/components/visualizers/) — each is
  self-contained and driven by `latest` (the latest `{ts, allowed, state}` for its
  algorithm). They use the **two-clock pattern**: discrete state arrives on events,
  but a `requestAnimationFrame` loop interpolates *between* events (e.g. the token
  level dripping up at `refill_rate`, dots aging leftward) and writes directly to SVG
  attributes via refs — smooth animation without re-rendering React every frame. An
  [`index.tsx`](../frontend/src/components/visualizers/index.tsx) registry picks the
  component by algorithm key.
- [`RequestStream.tsx`](../frontend/src/components/RequestStream.tsx) — green/red
  chips, per-client accent borders, click → inspector.
- [`StatsPanel.tsx`](../frontend/src/components/StatsPanel.tsx) / `CompareStats` (in
  App) — totals and per-algorithm comparison table.
- [`Timeline.tsx`](../frontend/src/components/Timeline.tsx) — Recharts line chart of
  allow/s per algorithm + incoming RPS, from the store's rolling history. Animation
  disabled for streaming performance.
- [`RequestInspector.tsx`](../frontend/src/components/RequestInspector.tsx) —
  slide-over drawer; computes simulated `X-RateLimit-Limit/Remaining` from each
  result's state and shows status, `Retry-After`, latency, raw state.
- [`DistributedPanel.tsx`](../frontend/src/components/DistributedPanel.tsx) — the
  breach callout: observed allow/s vs configured single-node limit, round-robin
  attribution bars, and the breach/hold verdict.

### 4.5 Wiring — [`App.tsx`](../frontend/src/App.tsx)

Holds the `RunConfig`, `sessionId`, `selected` (inspector), and the `StreamStore`
(stable across renders via `useRef`). On Start it POSTs the config and calls
`store.connect(session_id)`; on config change while running it live-`PATCH`es. It
reads the coalesced snapshot via `useStream` and lays out the three regions + bottom
timeline, switching the center between a single visualizer and side-by-side compare.

---

## 5. Cross-cutting ideas worth internalizing

- **Atomic Lua = no over-admission.** The concurrency test
  ([`test_concurrency.py`](../backend/app/tests/test_concurrency.py)) fires 200
  simultaneous requests at a bucket of capacity 50: the naive read-modify-write
  over-admits; the Lua version admits *exactly* 50. That test is the proof behind the
  whole "atomic" claim.
- **REST for control, SSE for data.** One-shot commands are request/response;
  the high-volume server→client feed is a single long-lived SSE connection (simpler
  than WebSockets when you only need one direction).
- **Coalesce at the render boundary.** Producers (SSE) and consumers (React) run at
  different rates; a per-frame buffer flush bridges them. Generalizable to any
  high-frequency stream feeding a UI.
- **Two clocks for smooth viz.** Truth arrives discretely (events); animation
  interpolates continuously (rAF). Don't snap between states — extrapolate.
- **Sharing, not atomicity, is the distributed problem.** Each node can be perfectly
  atomic and the global limit still breaks if state isn't shared.

---

## 6. Where to start reading the code

1. [`config.py`](../backend/app/config.py) — the contracts (10 min).
2. [`token_bucket.lua`](../backend/app/limiters/scripts/token_bucket.lua) +
   [`token_bucket.py`](../backend/app/limiters/token_bucket.py) — one algorithm end
   to end.
3. [`generator.py`](../backend/app/generator.py) → [`sse.py`](../backend/app/sse.py)
   — how requests become a stream.
4. [`streamStore.ts`](../frontend/src/state/streamStore.ts) — how the stream becomes
   render-safe state.
5. [`TokenBucketViz.tsx`](../frontend/src/components/visualizers/TokenBucketViz.tsx) —
   the two-clock animation pattern.

Everything else is a variation on these five files.
