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

## M8 — More adapters & deploy story  ·  **done** (engine-side fail-open deferred)

Make "plug it in" true for the common stacks.

- **Adapters** — all call the gate; in-process middleware use `/v1/check`, proxy
  gateways use `/v1/authcheck` (status mapping selected by `X-Authz-Mode`):
  - FastAPI middleware ✅ ([`adapters/fastapi/`](../adapters/fastapi/))
  - Express/Connect middleware ✅ ([`adapters/express/`](../adapters/express/))
  - nginx `auth_request` ✅ ([`adapters/nginx/`](../adapters/nginx/)) — 204/403
  - Envoy HTTP `ext_authz` ✅ ([`adapters/envoy/`](../adapters/envoy/)) — 200/429
  - Cloudflare Worker ✅ ([`adapters/cloudflare/`](../adapters/cloudflare/))
- **Standalone sidecar bundle** ✅ ([`deploy/sidecar/`](../deploy/sidecar/)) — the
  engine + dashboard + Redis next to your app; documented compose + env config.
- **Fail-open vs fail-closed** ✅ — both per-adapter (`fail_open` /
  `failure_mode_allow`) **and** engine-side: when Redis is unreachable the gate
  itself admits (degraded `200`) or rejects (`503`) per `GET/PUT /v1/settings`,
  toggled live from the dashboard header.

*Exit:* a non-Python service can be rate-limited with one snippet + a sidecar. ✅

## M9 — Policy engine  ·  **done**

Move from one global knob to real rules.

- **Cost-weighted requests** ✅ — `cost` spends N tokens / queue slots / counter
  increments instead of 1, across all five algorithms (Lua + `evaluate` +
  `/v1/check`); the inspector shows non-unit costs. cost=1 behavior unchanged;
  concurrency test still green.
- **Per-route / per-method / per-key-tier rules** ✅
  ([`policy.py`](../backend/app/policy.py)) — an ordered `Policy` of rules
  (`PUT/GET /v1/policy`), **first match wins**, each selecting algorithm + params
  + cost. Each rule gets its own limiter state namespace, so `/login` and
  `/search` don't share a bucket. Hot-swapped live with no restart.
- **Allow/deny lists & per-key burst overrides** ✅ — a rule with `deny: true`
  hard-blocks (403, propagated by all adapters); `policy.overrides` maps a key →
  multiplier on the matched limit, so a VIP key gets e.g. 3× capacity without a
  separate rule.
- **Dashboard policy editor** ✅
  ([`PolicyEditor.tsx`](../frontend/src/components/PolicyEditor.tsx)) — a slide-over
  in Live mode to author/reorder/save rules and per-key overrides
  (`GET`/`PUT /v1/policy`); no curl needed.

*Exit:* one deployment enforces different limits per route, method, and key,
editable from the dashboard. ✅

## M10 — Persistence & metrics  ·  **done** (OTel deferred)

Make it trustworthy for ops; today all state is ephemeral in Redis.

- **`GET /metrics` (Prometheus)** ✅ ([`metrics.py`](../backend/app/metrics.py)) —
  cumulative `throttlegate_requests_total{algorithm,rule,decision}` +
  `throttlegate_cost_total`, hand-rolled exposition (no new dep), low-cardinality
  labels. Lands straight in a team's Prometheus/Grafana.
- **Top-talkers / throttled-keys view** ✅ — per-key allowed/rejected tallies in
  the aggregator, streamed as `top_keys` in the SSE `stats` event and rendered as
  a live "Top keys" panel ([`TopKeys.tsx`](../frontend/src/components/TopKeys.tsx)).
- **Time-series history** ✅ ([`history.py`](../backend/app/history.py)) — the live
  session samples allowed/rejected every 5s into a Redis sorted set (capped,
  self-expiring, survives a backend restart); `GET /v1/history` + the dashboard's
  Observability drawer chart show "traffic over the last 30 min," not just a tail.
- **Webhook alerting** ✅ ([`alerts.py`](../backend/app/alerts.py)) — POST a webhook
  when one key is throttled past a threshold within a window (debounced per key);
  configured at `GET/PUT /v1/alerts` and in the Observability drawer; also
  broadcast as an SSE `alert` event → dashboard toast.
- **OpenTelemetry traces/spans** — *deferred* (Prometheus covers the metrics need;
  traces fold into a later pass if wanted).

*Exit:* historical dashboards + alerts without the Throttle-Gate UI open. ✅

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
