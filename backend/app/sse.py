"""SSE stream, session lifecycle, and event formatting (PRD §7.2, §7.5).

A `Session` ties a `RunConfig` to a `LoadGenerator`, a `StatsAggregator`, and a
set of subscriber queues (one per connected SSE client). The generator fans each
request's decision to all subscribers; a side loop emits `stats` every ~500ms.

`SessionManager` owns the shared limiter instances and the live sessions.
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from typing import AsyncGenerator

import redis.asyncio as redis

from .config import RunConfig
from .generator import LoadGenerator
from .limiters import build_limiters
from .limiters.base import Decision, RateLimiter
from .stats import StatsAggregator

WORKER_ID = uuid.uuid4().hex[:8]

# The single, persistent Live-mode session real /v1/check traffic feeds (M7).
LIVE_SESSION_ID = "live"

_STATS_INTERVAL_S = 0.5
_HEARTBEAT_S = 15.0
_SUBSCRIBER_QUEUE_MAX = 2000  # bound memory; drop for slow consumers


def sse_format(event: dict) -> str:
    """Render an event dict as an SSE frame, naming it by its `type`."""
    name = event.get("type", "message")
    return f"event: {name}\ndata: {json.dumps(event)}\n\n"


class Session:
    def __init__(
        self,
        session_id: str,
        config: RunConfig,
        limiters: dict[str, RateLimiter],
        *,
        live: bool = False,
    ) -> None:
        self.id = session_id
        self.config = config
        self.stats = StatsAggregator()
        self.subscribers: set[asyncio.Queue] = set()
        self.running = False
        # A "live" session has no synthetic generator: real requests feed it via
        # `record()` (M7). It still runs the stats loop and fans out to the SSE
        # subscribers exactly like a generated session.
        self.live = live

        self._stop = asyncio.Event()
        self._gen_task: asyncio.Task | None = None
        self._stats_task: asyncio.Task | None = None
        self._generator = None if live else LoadGenerator(config, limiters, self._on_decision)

    # ── generation lifecycle ────────────────────────────────────────────────

    def start(self) -> None:
        if self.running:
            return
        self._stop = asyncio.Event()
        self.running = True
        if self._generator is not None:
            self._gen_task = asyncio.create_task(self._generator.run(self._stop))
        self._stats_task = asyncio.create_task(self._stats_loop())

    async def record(self, event: dict, results: list[Decision]) -> None:
        """Ingest one externally-evaluated request (Live mode) into the stream."""
        await self._on_decision(event, results)

    async def stop(self) -> None:
        """Halt generation but keep the session (and limiter state) inspectable."""
        if not self.running:
            return
        self._stop.set()
        for task in (self._gen_task, self._stats_task):
            if task:
                await asyncio.gather(task, return_exceptions=True)
        self._gen_task = self._stats_task = None
        self.running = False

    # ── event plumbing ──────────────────────────────────────────────────────

    async def _on_decision(self, event: dict, results: list[Decision]) -> None:
        self.stats.record(event["ts"], results)
        self._broadcast(event)

    async def _stats_loop(self) -> None:
        while not self._stop.is_set():
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=_STATS_INTERVAL_S)
                return
            except asyncio.TimeoutError:
                self._broadcast(self.stats.snapshot(time.time()))

    def _broadcast(self, event: dict) -> None:
        for q in list(self.subscribers):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                pass  # slow consumer: drop rather than block the generator

    # ── subscriber management ───────────────────────────────────────────────

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=_SUBSCRIBER_QUEUE_MAX)
        self.subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self.subscribers.discard(q)

    def hello_event(self) -> dict:
        return {
            "type": "hello",
            "session_id": self.id,
            "worker_id": WORKER_ID,
            "live": self.live,
            "config": self.config.model_dump(),
        }


class SessionManager:
    def __init__(self, client: redis.Redis) -> None:
        self.redis = client
        self.limiters: dict[str, RateLimiter] = {}
        self.sessions: dict[str, Session] = {}

    async def setup(self) -> None:
        self.limiters = await build_limiters(self.redis)

    def create(self, config: RunConfig) -> Session:
        session_id = f"sess_{uuid.uuid4().hex[:10]}"
        session = Session(session_id, config, self.limiters)
        self.sessions[session_id] = session
        session.start()
        return session

    def get(self, session_id: str) -> Session | None:
        return self.sessions.get(session_id)

    def live(self) -> Session:
        """Get-or-create the persistent Live-mode session (M7). Generator-less;
        fed by real `/v1/check` traffic and tuned via `PATCH /api/config`."""
        session = self.sessions.get(LIVE_SESSION_ID)
        if session is None:
            session = Session(LIVE_SESSION_ID, RunConfig(), self.limiters, live=True)
            self.sessions[LIVE_SESSION_ID] = session
            session.start()
        return session

    async def stop_all(self) -> None:
        for session in list(self.sessions.values()):
            await session.stop()

    async def reset(self) -> None:
        """Stop generation and flush all limiter state from Redis."""
        await self.stop_all()
        self.sessions.clear()
        await self.redis.flushdb()


async def stream_events(session: Session) -> AsyncGenerator[str, None]:
    """SSE body: `hello`, then live `decision`/`stats`, with 15s heartbeats."""
    q = session.subscribe()
    try:
        yield sse_format(session.hello_event())
        while True:
            try:
                event = await asyncio.wait_for(q.get(), timeout=_HEARTBEAT_S)
                yield sse_format(event)
            except asyncio.TimeoutError:
                yield ": heartbeat\n\n"
    finally:
        session.unsubscribe(q)
