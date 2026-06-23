# Throttle-Gate — Roadmap (M7 → M12)

Where v1 (M1–M6) finished: a polished **teaching tool**. A synthetic load
generator fires requests at five atomic Redis limiters and streams every decision
to animated visualizers (single + compare + distributed modes).

Where this roadmap goes: turn that same engine into something a real user can
**put in front of their own server** — pick an algorithm, route their traffic
through it, and watch live what's allowed vs. throttled. The visualizers don't
change; we change where the `decision` events come from (real traffic, not the
generator) and what surrounds the limiter (policies, persistence, adapters).

> The whole pivot rests on one fact: the visualizer/inspector/timeline already
> render `decision` events without caring who produced them. Feed them real
> traffic and the demo becomes a dashboard.

---

## M7 — Real-traffic ("Live") mode  ·  **in progress**

**Goal:** a user plugs Throttle-Gate in front of their service, sends each
incoming request through a decision API, and watches real allow/throttle traffic
in the existing dashboard.

- **Decision API** `POST /v1/check {key, route}` → evaluates against the live
  limiter and returns `{allowed, retry_after, limit, remaining}` with real
  `429` status + `Retry-After` / `X-RateLimit-*` headers. (Promotes the demo-only
  `/api/gate` into a production-shaped endpoint.)
- **Live session** — a persistent, generator-less `Session` (`session_id="live"`)
  that real `/v1/check` calls feed via `record()`. Same stats + SSE fan-out as a
  generated session, so the dashboard lights up unchanged.
- **`GET /v1/live`** exposes the live session id + current config; the dashboard
  subscribes to `/api/stream?session_id=live` and tunes the limiter live via the
  existing `PATCH /api/config`.
- **Frontend Live toggle** — Simulate ⇄ Live. In Live mode the control panel
  configures the real limiter (algorithm + params) and the request stream shows
  real keys/routes; an info banner shows the `curl` to wire a server in.
- **First middleware adapter** — a ~30-line FastAPI middleware (`adapters/`) that
  calls `/v1/check` and returns `429` on reject, plus a runnable example and
  `scripts/live_demo.py` to drive real traffic.

*Exit:* `python scripts/live_demo.py` throttles real requests and the dashboard
shows them in real time.

## M8 — More adapters & deploy story  ·  **in progress**

Make "plug it in" true for the common stacks.

- **Adapters:** Express/Node ✅ ([`adapters/express/`](../adapters/express/)),
  nginx `auth_request` ✅ ([`adapters/nginx/`](../adapters/nginx/), via the
  `/v1/authcheck` 204/403 endpoint), then Envoy `ext_authz` and a Cloudflare
  Worker. Each just calls the gate.
- **Standalone sidecar bundle** ✅ ([`deploy/sidecar/`](../deploy/sidecar/)) — the
  engine + dashboard + Redis next to your app; documented compose + env config.
- **Fail-open vs fail-closed** when Redis/gate is unreachable — adapters do this
  per-call today (`fail_open`); next, make it a first-class engine-side setting.

*Exit:* a non-Python service can be rate-limited with one snippet + a sidecar.
**Remaining:** Envoy + Cloudflare adapters; engine-side fail-open config.

## M9 — Policy engine

Move from one global knob to real rules.

- **Per-route / per-method / per-key-tier rules** ("free 100/min, pro 10k/min";
  `/login` stricter than `/search`). A policy document, hot-reloaded via the same
  in-place config mutation `PATCH /api/config` already proves.
- **Cost-weighted requests** — `cost` spends N tokens instead of 1 (a small
  change to each Lua script + `evaluate` signature); expensive endpoints cost
  more.
- **Allow/deny lists** and per-key burst overrides.

*Exit:* one deployment enforces different limits per route and per tier.

## M10 — Persistence & metrics

Make it trustworthy for ops; today all state is ephemeral in Redis.

- **Time-series sink** (Redis Streams → ClickHouse/Timescale/Prometheus) for
  "traffic over the last hour/day," not just a live tail.
- **`GET /metrics` (Prometheus) + OpenTelemetry** so limiter data lands in the
  team's existing Grafana.
- **Top-talkers / throttled-keys views** and **webhook/Slack alerting** when a
  key crosses a threshold or abuse is detected.

*Exit:* historical dashboards + alerts without the Throttle-Gate UI open.

## M11 — Smarter limiting

Differentiate beyond the five classics.

- **Concurrency limiter** (cap in-flight, not rate) and **adaptive limiting**
  (AIMD off backend latency/error rate).
- **GCRA** — the "leaky bucket as a meter" algorithm — as a sixth algorithm.
- **Anomaly detection** — flag keys deviating from their own baseline.

*Exit:* at least one load-reactive limiter and GCRA shipped with visualizers.

## M12 — Onboarding & multi-tenancy

Make it a product others can run.

- **Access-log replay** — upload an nginx/access log, replay it through compare
  mode: *"Token Bucket would have blocked these 1,200; Sliding Window, 900."* A
  zero-deploy on-ramp.
- **"Recommend an algorithm" wizard** from a described workload.
- **Dashboard auth + multi-tenant** key/project scoping.

*Exit:* a new user can evaluate algorithms on their own logs and run a scoped,
authenticated dashboard.

---

### Sequencing rationale

M7 is the smallest change with the biggest "it's real now" payoff (the engine and
UI already exist; we only redirect the event source). M8–M9 make it adoptable and
expressive. M10 makes it trustworthy. M11–M12 differentiate and broaden. Each
milestone is independently shippable.
