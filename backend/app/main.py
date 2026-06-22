"""FastAPI application entrypoint for Throttle-Gate.

Control plane (REST) + data plane (SSE). The control endpoints drive sessions of
the load generator; `/api/stream` carries the live decision/stats stream.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager

import redis.asyncio as redis
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .config import (
    ALGORITHMS,
    AlgorithmKey,
    Pattern,
    RunConfig,
    RunParams,
)
from .sse import SessionManager, WORKER_ID, stream_events

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Open Redis + build limiters for the app's lifetime."""
    app.state.redis = redis.from_url(REDIS_URL, decode_responses=True)
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


class ConfigPatch(BaseModel):
    """Partial, live update of a running session's config (PRD §7.1)."""

    session_id: str
    rps: float | None = None
    pattern: Pattern | None = None
    algorithm: AlgorithmKey | None = None
    compare: list[AlgorithmKey] | None = None
    client_count: int | None = None
    params: RunParams | None = None


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
    # holds a reference to it) picks up changes without a restart.
    updates = patch.model_dump(exclude_none=True, exclude={"session_id"})
    for field, value in updates.items():
        setattr(session.config, field, value)
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
