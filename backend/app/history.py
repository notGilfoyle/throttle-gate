"""Redis-backed traffic history (M10).

A lightweight time-series so the dashboard can show "traffic over the last
hour", not just the live tail. The live session samples its cumulative
allowed/rejected totals every `BUCKET_S` seconds and appends the *delta* as one
point. Points live in a single Redis sorted set (score = epoch seconds), capped
and self-expiring — so history survives a backend restart (until Redis is
flushed), unlike the in-memory stream buffer.
"""

from __future__ import annotations

import redis.asyncio as redis

HISTORY_KEY = "tg:history"
BUCKET_S = 5  # sample granularity
MAX_POINTS = 720  # ~1 hour at 5s
_TTL_S = 90_000  # ~25h


async def record(client: redis.Redis, ts: float, allowed: int, rejected: int) -> None:
    """Append one sampled point (allowed/rejected admitted since the last sample)."""
    member = f"{int(ts)}:{allowed}:{rejected}"
    await client.zadd(HISTORY_KEY, {member: int(ts)})
    # Keep only the most recent MAX_POINTS, and let the key self-expire when idle.
    await client.zremrangebyrank(HISTORY_KEY, 0, -(MAX_POINTS + 1))
    await client.expire(HISTORY_KEY, _TTL_S)


async def read(client: redis.Redis, since_ts: float) -> list[dict]:
    """Points with score >= since_ts, oldest first."""
    raw = await client.zrangebyscore(HISTORY_KEY, since_ts, "+inf")
    points: list[dict] = []
    for m in raw:
        try:
            t, a, r = m.split(":")
            points.append({"t": int(t), "allowed": int(a), "rejected": int(r)})
        except ValueError:
            continue
    return points
