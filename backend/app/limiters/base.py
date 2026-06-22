"""RateLimiter interface and the per-decision result model (PRD §7.4, §9.2).

Each algorithm subclasses `RateLimiter` and implements `evaluate`, returning the
allow/reject decision plus its algorithm-specific `state` dict. The base class
handles latency timing and HTTP-status mapping so subclasses stay focused on the
read-modify-write logic (which must be atomic — Lua — for everything but Fixed
Window).
"""

from __future__ import annotations

import time
from abc import ABC, abstractmethod
from pathlib import Path
from typing import ClassVar

import redis.asyncio as redis
from pydantic import BaseModel

from ..config import AlgorithmKey

SCRIPTS_DIR = Path(__file__).parent / "scripts"


class Decision(BaseModel):
    """One algorithm's verdict on one request (a `results[]` entry in §9.2)."""

    algorithm: AlgorithmKey
    allowed: bool
    status: int  # 200 allowed, 429 rejected
    retry_after: float | None = None  # seconds until a retry could succeed
    latency_ms: float
    state: dict


class RateLimiter(ABC):
    """Base limiter. Owns its Redis key namespace (`{key}:{client_id}`)."""

    key: ClassVar[AlgorithmKey]

    def __init__(self, client: redis.Redis) -> None:
        self.redis = client

    async def setup(self) -> None:
        """Register Lua scripts / warm caches. Override as needed; default no-op."""

    def redis_key(self, client_id: str) -> str:
        return f"{self.key}:{client_id}"

    def load_script(self, filename: str):
        """Register a Lua script from `scripts/`, returning a runnable handle."""
        source = (SCRIPTS_DIR / filename).read_text()
        return self.redis.register_script(source)

    @abstractmethod
    async def evaluate(
        self, client_id: str, params: BaseModel, now: float
    ) -> tuple[bool, dict, float | None]:
        """Run the algorithm. Returns (allowed, state, retry_after_seconds)."""

    async def check(
        self, client_id: str, params: BaseModel, now: float | None = None
    ) -> Decision:
        """Evaluate one request, timing the limiter call for `latency_ms`."""
        if now is None:
            now = time.time()
        t0 = time.perf_counter()
        allowed, state, retry_after = await self.evaluate(client_id, params, now)
        latency_ms = round((time.perf_counter() - t0) * 1000, 3)
        return Decision(
            algorithm=self.key,
            allowed=allowed,
            status=200 if allowed else 429,
            retry_after=retry_after,
            latency_ms=latency_ms,
            state=state,
        )
