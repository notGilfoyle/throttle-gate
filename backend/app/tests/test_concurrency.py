"""Concurrency safety: the atomic Lua limiter must never over-admit (PRD §12).

Fires many simultaneous requests at a bucket sized smaller than the request
count and compares a naive (non-atomic) read-modify-write against the real Lua
token bucket. The naive version races and over-admits; the Lua version admits at
most `capacity`.

Requires a Redis at REDIS_URL (defaults to localhost:6379), e.g. the `redis`
service from docker-compose or a local container.
"""

from __future__ import annotations

import asyncio
import os

import pytest
import redis.asyncio as redis

from app.config import TokenBucketParams
from app.limiters.token_bucket import TokenBucketLimiter

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

CONCURRENCY = 200
CAPACITY = 50
REFILL_RATE = 1.0  # low, so negligible refill during the burst


class NaiveTokenBucket:
    """Deliberately non-atomic: read, decide, then write — with a yield in the
    middle so concurrent callers interleave and trample each other's writes."""

    def __init__(self, client: redis.Redis, key: str) -> None:
        self.redis = client
        self.key = key

    async def check(self, capacity: float, rate: float, now: float) -> bool:
        d = await self.redis.hmget(self.key, "tokens", "ts")
        tokens = float(d[0]) if d[0] is not None else capacity
        ts = float(d[1]) if d[1] is not None else now
        tokens = min(capacity, tokens + (now - ts) * rate)
        await asyncio.sleep(0)  # amplify the read-modify-write race
        allowed = tokens >= 1
        if allowed:
            tokens -= 1
        await self.redis.hset(self.key, mapping={"tokens": tokens, "ts": now})
        return allowed


@pytest.fixture
async def client():
    # Pool must allow all concurrent commands to be genuinely in flight at once.
    c = redis.from_url(REDIS_URL, decode_responses=True, max_connections=CONCURRENCY + 10)
    await c.flushdb()
    yield c
    await c.flushdb()
    await c.aclose()


async def test_naive_over_admits(client):
    """Sanity: the naive limiter admits far more than capacity under a race."""
    naive = NaiveTokenBucket(client, "naive:c1")
    now = 1_000_000.0
    results = await asyncio.gather(
        *(naive.check(CAPACITY, REFILL_RATE, now) for _ in range(CONCURRENCY))
    )
    allowed = sum(results)
    assert allowed > CAPACITY, f"expected over-admission, got {allowed}"


async def test_lua_never_over_admits(client):
    """The atomic Lua token bucket admits at most capacity, no matter the race."""
    limiter = TokenBucketLimiter(client)
    await limiter.setup()
    params = TokenBucketParams(capacity=CAPACITY, refill_rate=REFILL_RATE)
    now = 1_000_000.0

    decisions = await asyncio.gather(
        *(limiter.check("c1", params, now) for _ in range(CONCURRENCY))
    )
    allowed = sum(1 for d in decisions if d.allowed)
    assert allowed == CAPACITY, f"expected exactly {CAPACITY} admitted, got {allowed}"
