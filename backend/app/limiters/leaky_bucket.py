"""Leaky Bucket — atomic queue that drains at a constant rate."""

from __future__ import annotations

from ..config import LeakyBucketParams
from .base import RateLimiter


class LeakyBucketLimiter(RateLimiter):
    key = "leaky_bucket"

    async def setup(self) -> None:
        self._script = self.load_script("leaky_bucket.lua")

    async def evaluate(
        self, client_id: str, params: LeakyBucketParams, now: float
    ) -> tuple[bool, dict, float | None]:
        allowed_raw, depth_raw = await self._script(
            keys=[self.redis_key(client_id)],
            args=[params.capacity, params.leak_rate, now],
        )
        allowed = bool(int(allowed_raw))
        depth = float(depth_raw)

        rate = params.leak_rate
        est_wait_ms = round(depth / rate * 1000, 1) if rate > 0 else 0.0
        retry_after = None
        if not allowed and rate > 0:
            # Time until one queue slot drains.
            retry_after = max(round((depth - params.capacity + 1) / rate, 3), round(1 / rate, 3))

        state = {
            "queue_depth": round(depth, 4),
            "capacity": params.capacity,
            "leak_rate": rate,
            "est_wait_ms": est_wait_ms,
        }
        return allowed, state, retry_after
