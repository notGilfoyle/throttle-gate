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

from .config import (
    ALGORITHMS,
    AlgorithmKey,
    DistributedConfig,
    Pattern,
    RunConfig,
    RunParams,
)
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


async def _live_check(
    key: str, route: str, algorithm: AlgorithmKey | None, params_override: dict | None
):
    """Evaluate one real request against the Live limiter and stream it to the
    dashboard. Shared by the POST decision API and the GET auth endpoint."""
    session = app.state.sessions.live()
    algo = algorithm or session.config.algorithm
    limiter = app.state.sessions.limiters.get(algo)
    if limiter is None:
        raise HTTPException(status_code=400, detail=f"unknown algorithm: {algo}")

    if params_override:
        params = RunParams(**{algo: params_override}).for_algorithm(algo)
    else:
        params = session.config.params.for_algorithm(algo)

    now = time.time()
    decision = await limiter.check(key, params, now)

    # Stream this real decision into the dashboard's Live session.
    event = {
        "type": "decision",
        "request_id": f"live_{uuid.uuid4().hex[:8]}",
        "client_id": key,
        "route": route,
        "ts": now,
        "results": [decision.model_dump()],
    }
    await session.record(event, [decision])
    return decision, ratelimit_headers(decision)


@app.post("/v1/check")
async def check(req: CheckRequest, response: Response) -> dict:
    """Rate-limit one real incoming request and stream it to the dashboard (M7).

    Returns the same shape a real gateway needs: `429` status + `Retry-After` /
    `X-RateLimit-*` headers on reject, `200` otherwise. A middleware in front of
    the user's service calls this per request (see `adapters/`).
    """
    decision, headers = await _live_check(req.key, req.route, req.algorithm, req.params)
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
    x_original_uri: str | None = Header(default=None),
) -> Response:
    """Auth-subrequest variant for nginx `auth_request` and Envoy `ext_authz` (M8).

    Those gateways issue a GET subrequest and only treat **2xx** (allow) or
    **401/403** (deny) specially — a `429` body would become a `500`. So this
    returns **204** when allowed and **403** when throttled, always with the
    `X-RateLimit-*` / `Retry-After` headers. The proxy maps the 403 back to a
    real `429` for the client (see `adapters/nginx/`).

    The key is taken from `?key=`, else the `X-RateLimit-Key` header; the route
    from `?route=`, else nginx's `X-Original-URI`.
    """
    resolved_key = key or x_ratelimit_key or "anonymous"
    resolved_route = route if route != "*" else (x_original_uri or "*")
    decision, headers = await _live_check(resolved_key, resolved_route, None, None)
    response = Response(status_code=204 if decision.allowed else 403)
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
