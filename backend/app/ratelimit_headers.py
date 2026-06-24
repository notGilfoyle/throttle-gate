"""Standard `X-RateLimit-*` response headers derived from a limiter decision.

This is the server-side mirror of the frontend's `RequestInspector.rateLimitHeaders`
(PRD §8.3): the real `/v1/check` response and the dashboard show a client the same
numbers. Used by Live mode (M7) to make `/v1/check` return what a real
rate-limited HTTP endpoint would.
"""

from __future__ import annotations

import math

from .limiters.base import Decision


def _num(state: dict, key: str) -> float:
    value = state.get(key)
    return float(value) if isinstance(value, (int, float)) else 0.0


def ratelimit_headers(decision: Decision) -> dict[str, str]:
    """Map a `Decision` to `X-RateLimit-Limit/Remaining`, plus `Retry-After`/
    `X-RateLimit-Reset` when the request was rejected."""
    state, algo = decision.state, decision.algorithm

    if algo == "token_bucket":
        limit = _num(state, "capacity")
        remaining = max(0.0, math.floor(_num(state, "tokens")))
    elif algo == "leaky_bucket":
        limit = _num(state, "capacity")
        remaining = max(0.0, math.floor(limit - _num(state, "queue_depth")))
    elif algo == "sliding_counter":
        limit = _num(state, "limit")
        remaining = max(0.0, math.floor(limit - _num(state, "estimate")))
    elif algo == "gcra":
        limit = _num(state, "burst")
        remaining = _num(state, "remaining")
    else:  # fixed_window, sliding_log
        limit = _num(state, "limit")
        remaining = max(0.0, limit - _num(state, "count"))

    headers = {
        "X-RateLimit-Limit": str(int(limit)),
        "X-RateLimit-Remaining": str(int(remaining)),
    }
    if decision.retry_after is not None:
        reset = str(math.ceil(decision.retry_after))
        headers["Retry-After"] = reset
        headers["X-RateLimit-Reset"] = reset
    return headers
