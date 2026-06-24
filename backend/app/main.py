"""FastAPI application entrypoint for Throttle-Gate.

Control plane (REST) + data plane (SSE). The control endpoints drive sessions of
the load generator; `/api/stream` carries the live decision/stats stream.
"""

from __future__ import annotations

import os
import time
import uuid
from contextlib import asynccontextmanager
from typing import Literal

import redis.asyncio as redis
from fastapi import FastAPI, Header, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from redis.exceptions import RedisError

from .config import (
    ALGORITHMS,
    AlgorithmKey,
    DistributedConfig,
    Pattern,
    RunConfig,
    RunParams,
)
from . import metrics
from .limiters.base import Decision
from .policy import SIZE_PARAM, Policy, resolve
from .ratelimit_headers import ratelimit_headers
from .sse import SessionManager, WORKER_ID, stream_events

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Open Redis + build limiters for the app's lifetime."""
    # Pool sized for the concurrent /api/gate demo (many simultaneous requests).
    app.state.redis = redis.from_url(REDIS_URL, decode_responses=True, max_connections=128)
    app.state.sessions = SessionManager(app.state.redis)
    await app.state.sessions.setup()
    try:
        yield
    finally:
        await app.state.sessions.stop_all()
        await app.state.redis.aclose()


app = FastAPI(title="Throttle-Gate", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── request/response models ─────────────────────────────────────────────────


class StartResponse(BaseModel):
    session_id: str
    worker_id: str


class SessionRef(BaseModel):
    session_id: str


class GateRequest(BaseModel):
    """A single request to evaluate against the limiter (real-replica demo)."""

    algorithm: AlgorithmKey = "token_bucket"
    client_id: str = "client-1"
    mode: Literal["shared", "local"] = "shared"
    params: dict | None = None


class CheckRequest(BaseModel):
    """A real incoming request to rate-limit in Live mode (M7).

    `key` is the rate-limit identity (API key, user id, or IP). `route` is an
    optional grouping label shown in the dashboard. `algorithm`/`params` are
    optional per-request overrides; by default the Live session's configured
    limiter (set from the dashboard via `PATCH /api/config`) is used.
    """

    key: str = "anonymous"
    route: str = "*"
    method: str = "GET"  # for per-method policy matching (M9)
    cost: int = 1  # how much this request spends — >1 for expensive endpoints (M9)
    algorithm: AlgorithmKey | None = None
    params: dict | None = None


class ConfigPatch(BaseModel):
    """Partial, live update of a running session's config (PRD §7.1)."""

    session_id: str
    rps: float | None = None
    pattern: Pattern | None = None
    algorithm: AlgorithmKey | None = None
    compare: list[AlgorithmKey] | None = None
    client_count: int | None = None
    params: RunParams | None = None
    distributed: DistributedConfig | None = None


def _require_session(session_id: str):
    session = app.state.sessions.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail=f"unknown session: {session_id}")
    return session


# ── control plane ────────────────────────────────────────────────────────────


@app.get("/api/healthz")
async def healthz() -> dict[str, str]:
    pong = await app.state.redis.ping()
    return {"status": "ok", "redis": "up" if pong else "down", "worker_id": WORKER_ID}


@app.get("/metrics")
async def prometheus_metrics() -> Response:
    """Prometheus exposition of live-gateway counters (M10)."""
    return Response(content=metrics.METRICS.render(), media_type="text/plain; version=0.0.4")


@app.post("/api/gate")
async def gate(req: GateRequest) -> dict:
    """Evaluate one request against the limiter — the protected endpoint for the
    real multi-replica demo (PRD §10). In `local` mode this process namespaces
    its state by `worker_id` (isolated per replica); in `shared` mode all
    replicas share the key. Round-robin two replicas behind a proxy and compare.
    """
    limiter = app.state.sessions.limiters.get(req.algorithm)
    if limiter is None:
        raise HTTPException(status_code=400, detail=f"unknown algorithm: {req.algorithm}")
    run_params = RunParams(**{req.algorithm: req.params}) if req.params else RunParams()
    params = run_params.for_algorithm(req.algorithm)
    node = WORKER_ID if req.mode == "local" else None
    decision = await limiter.check(req.client_id, params, node=node)
    return {
        "allowed": decision.allowed,
        "status": decision.status,
        "worker_id": WORKER_ID,
        "state": decision.state,
    }


# ── Live mode (M7): real traffic in → dashboard ──────────────────────────────


@app.get("/v1/live")
async def live_info() -> dict:
    """The Live session id + current limiter config. The dashboard subscribes to
    `/api/stream?session_id=<id>` and tunes the limiter via `PATCH /api/config`."""
    session = app.state.sessions.live()
    return {"session_id": session.id, "config": session.config.model_dump()}


class EngineSettings(BaseModel):
    """Engine behaviour knobs (M8/M9 deferrals)."""

    fail_open: bool = True  # admit (True) vs reject 503 (False) when Redis is down


def _degraded_decision(algo: AlgorithmKey, fail_open: bool) -> Decision:
    """Synthetic verdict when the limiter store is unreachable."""
    return Decision(
        algorithm=algo,
        allowed=fail_open,
        status=200 if fail_open else 503,
        retry_after=None,
        latency_ms=0.0,
        state={"degraded": True, "fail_open": fail_open},
    )


@app.get("/v1/settings")
async def get_settings() -> dict:
    """Engine settings for the Live session (M8/M9)."""
    return {"fail_open": app.state.sessions.live().fail_open}


@app.put("/v1/settings")
async def put_settings(settings: EngineSettings) -> dict:
    app.state.sessions.live().fail_open = settings.fail_open
    return {"fail_open": settings.fail_open}


async def _live_check(
    key: str,
    route: str,
    method: str = "GET",
    algorithm: AlgorithmKey | None = None,
    params_override: dict | None = None,
    cost: int = 1,
):
    """Evaluate one real request against the Live limiter and stream it to the
    dashboard. Shared by the POST decision API and the GET auth endpoint.

    Resolves the session policy (M9): the first matching rule selects the
    algorithm, params, and cost (or hard-denies); unmatched traffic uses the
    session default. Each rule has its own limiter state namespace (`scope`).
    """
    session = app.state.sessions.live()
    rule = resolve(session.policy, key, route, method)
    now = time.time()

    override_mult = session.policy.overrides.get(key)

    async def stream(scope: str, decision: Decision) -> None:
        eff_cost = cost if scope == "default" else (rule.cost if rule else cost)
        event = {
            "type": "decision",
            "request_id": f"live_{uuid.uuid4().hex[:8]}",
            "client_id": key,
            "route": route,
            "method": method,
            "cost": eff_cost,
            "rule": scope,
            "ts": now,
            "results": [decision.model_dump()],
        }
        if override_mult and override_mult != 1:
            event["override"] = override_mult
        # Prometheus counters (M10).
        if decision.state.get("denied"):
            label = metrics.DENIED
        elif decision.state.get("degraded"):
            label = metrics.DEGRADED
        else:
            label = metrics.ALLOWED if decision.allowed else metrics.THROTTLED
        metrics.METRICS.record(decision.algorithm, scope, label, eff_cost)
        await session.record(event, [decision])

    # Hard deny (block list) — no limiter consulted.
    if rule is not None and rule.deny:
        algo = algorithm or rule.algorithm or session.config.algorithm
        decision = Decision(
            algorithm=algo, allowed=False, status=403, retry_after=None,
            latency_ms=0.0, state={"denied": True, "rule": rule.name},
        )
        await stream(rule.name, decision)
        return decision, ratelimit_headers(decision)

    # Precedence: explicit request override > matching rule > session default.
    algo = algorithm or (rule.algorithm if rule else None) or session.config.algorithm
    limiter = app.state.sessions.limiters.get(algo)
    if limiter is None:
        raise HTTPException(status_code=400, detail=f"unknown algorithm: {algo}")

    override = params_override or (rule.params if rule else None)
    if override:
        params = RunParams(**{algo: override}).for_algorithm(algo)
    else:
        params = session.config.params.for_algorithm(algo)

    # Per-key burst override: scale this key's size param by its multiplier.
    if override_mult and override_mult != 1:
        field = SIZE_PARAM[algo]
        scaled = getattr(params, field) * override_mult
        params = params.model_copy(update={field: int(round(scaled)) if field == "limit" else scaled})

    eff_cost = max(1, int(rule.cost if rule else cost))
    scope = rule.name if rule else "default"
    # Namespace state per rule so different routes/tiers don't share a bucket.
    try:
        decision = await limiter.check(f"{scope}|{key}", params, now, cost=eff_cost)
    except RedisError:
        # Limiter store unreachable: fall back to the engine's fail-open policy.
        decision = _degraded_decision(algo, session.fail_open)
    await stream(scope, decision)
    return decision, ratelimit_headers(decision)


@app.get("/v1/policy")
async def get_policy() -> dict:
    """The Live session's active policy rules (M9)."""
    return app.state.sessions.live().policy.model_dump()


@app.put("/v1/policy")
async def put_policy(policy: Policy) -> dict:
    """Replace the Live session's policy (M9). First matching rule wins."""
    app.state.sessions.live().policy = policy
    return policy.model_dump()


@app.post("/v1/check")
async def check(req: CheckRequest, response: Response) -> dict:
    """Rate-limit one real incoming request and stream it to the dashboard (M7).

    Returns the same shape a real gateway needs: `429` status + `Retry-After` /
    `X-RateLimit-*` headers on reject, `200` otherwise. A middleware in front of
    the user's service calls this per request (see `adapters/`).
    """
    decision, headers = await _live_check(
        req.key, req.route, req.method, req.algorithm, req.params, req.cost
    )
    for name, value in headers.items():
        response.headers[name] = value
    response.status_code = decision.status
    return {
        "allowed": decision.allowed,
        "status": decision.status,
        "retry_after": decision.retry_after,
        "limit": int(headers["X-RateLimit-Limit"]),
        "remaining": int(headers["X-RateLimit-Remaining"]),
    }


@app.get("/v1/authcheck")
async def authcheck(
    response: Response,
    key: str | None = None,
    route: str = "*",
    x_ratelimit_key: str | None = Header(default=None),
    x_api_key: str | None = Header(default=None),
    x_original_uri: str | None = Header(default=None),
    x_original_method: str | None = Header(default=None),
    x_authz_mode: str | None = Header(default=None),
) -> Response:
    """Auth-subrequest variant for proxy gateways (M8): nginx `auth_request` and
    Envoy `ext_authz`. They issue a subrequest and decide allow/deny from its
    status, but disagree on which codes mean what — so the status mapping is
    selected by the `X-Authz-Mode` header:

    - **default (nginx)** — `auth_request` only accepts `2xx` (allow) and
      `401/403` (deny); anything else becomes a `500`. So: **204** allow /
      **403** deny. The nginx config maps the 403 back to a real `429`.
    - **`envoy`** — HTTP `ext_authz` treats only **200** as allow and forwards
      the authz response (status/headers/body) straight to the client on deny.
      So: **200** allow / **429** deny — the client gets a real `429` directly.

    Either way the `X-RateLimit-*` / `Retry-After` headers are always set. Key is
    taken from `?key=`, else `X-RateLimit-Key`, else `X-Api-Key`; route from
    `?route=`, else the `X-Original-URI` header.
    """
    resolved_key = key or x_ratelimit_key or x_api_key or "anonymous"
    resolved_route = route if route != "*" else (x_original_uri or "*")
    decision, headers = await _live_check(
        resolved_key, resolved_route, x_original_method or "GET"
    )
    if x_authz_mode == "envoy":
        status = 200 if decision.allowed else 429
    else:
        status = 204 if decision.allowed else 403
    response = Response(status_code=status)
    for name, value in headers.items():
        response.headers[name] = value
    return response


@app.get("/api/algorithms")
async def algorithms() -> dict:
    """Static metadata the frontend uses to build its control panel."""
    return {"algorithms": [a.model_dump() for a in ALGORITHMS]}


@app.post("/api/session/start", response_model=StartResponse)
async def start_session(config: RunConfig) -> StartResponse:
    session = app.state.sessions.create(config)
    return StartResponse(session_id=session.id, worker_id=WORKER_ID)


@app.post("/api/session/stop")
async def stop_session(ref: SessionRef) -> dict:
    session = _require_session(ref.session_id)
    await session.stop()
    return {"status": "stopped", "session_id": session.id}


@app.post("/api/session/reset")
async def reset_sessions() -> dict:
    """Stop everything and flush all limiter state from Redis."""
    await app.state.sessions.reset()
    return {"status": "reset"}


@app.patch("/api/config")
async def patch_config(patch: ConfigPatch) -> dict:
    session = _require_session(patch.session_id)
    # Mutate the existing config object in place so the running generator (which
    # holds a reference to it) picks up changes without a restart. Assign the
    # *parsed* attribute off `patch` (not a dumped dict) so typed fields like
    # `params`/`distributed` stay Pydantic models, not plain dicts.
    provided = patch.model_dump(exclude_none=True, exclude={"session_id"})
    for field in provided:
        setattr(session.config, field, getattr(patch, field))
    return {"status": "updated", "config": session.config.model_dump()}


# ── data plane ────────────────────────────────────────────────────────────────


@app.get("/api/stream")
async def stream(session_id: str) -> StreamingResponse:
    session = _require_session(session_id)
    return StreamingResponse(
        stream_events(session),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # disable proxy buffering for SSE
        },
    )
