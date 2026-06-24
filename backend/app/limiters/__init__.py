"""Limiter registry.

Maps algorithm keys to their `RateLimiter` implementations and builds a
ready-to-use, script-registered instance of each against a Redis client.
As the remaining four algorithms land (M3), add them to `LIMITER_CLASSES`.
"""

from __future__ import annotations

import redis.asyncio as redis

from ..config import AlgorithmKey
from .base import Decision, RateLimiter
from .concurrency import ConcurrencyLimiter
from .fixed_window import FixedWindowLimiter
from .gcra import GcraLimiter
from .leaky_bucket import LeakyBucketLimiter
from .sliding_counter import SlidingCounterLimiter
from .sliding_log import SlidingLogLimiter
from .token_bucket import TokenBucketLimiter

LIMITER_CLASSES: dict[str, type[RateLimiter]] = {
    "token_bucket": TokenBucketLimiter,
    "leaky_bucket": LeakyBucketLimiter,
    "fixed_window": FixedWindowLimiter,
    "sliding_log": SlidingLogLimiter,
    "sliding_counter": SlidingCounterLimiter,
    "gcra": GcraLimiter,
    "concurrency": ConcurrencyLimiter,
}


async def build_limiters(client: redis.Redis) -> dict[str, RateLimiter]:
    """Instantiate and `setup()` every registered limiter."""
    limiters: dict[str, RateLimiter] = {}
    for key, cls in LIMITER_CLASSES.items():
        limiter = cls(client)
        await limiter.setup()
        limiters[key] = limiter
    return limiters


def supported_algorithms() -> list[AlgorithmKey]:
    return list(LIMITER_CLASSES.keys())  # type: ignore[return-value]


__all__ = [
    "Decision",
    "RateLimiter",
    "LIMITER_CLASSES",
    "build_limiters",
    "supported_algorithms",
]
