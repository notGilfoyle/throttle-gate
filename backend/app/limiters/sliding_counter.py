"""Sliding Window Counter — weighted blend of current + previous fixed window."""

from __future__ import annotations

from ..config import SlidingCounterParams
from .base import RateLimiter


class SlidingCounterLimiter(RateLimiter):
    key = "sliding_counter"

    async def setup(self) -> None:
        self._script = self.load_script("sliding_counter.lua")

    async def evaluate(
        self, client_id: str, params: SlidingCounterParams, now: float
    ) -> tuple[bool, dict, float | None]:
        window_s = params.window_s
        idx = int(now // window_s)
        elapsed = now - idx * window_s
        # Fraction of the previous window still inside the trailing window.
        weight = (window_s - elapsed) / window_s

        res = await self._script(
            keys=[f"{self.key}:{client_id}:{idx}", f"{self.key}:{client_id}:{idx - 1}"],
            args=[params.limit, weight, int(window_s * 1000)],
        )
        allowed = bool(int(res[0]))
        curr, prev = int(res[1]), int(res[2])
        estimate = float(res[3])

        state = {
            "curr_count": curr,
            "prev_count": prev,
            "weight": round(weight, 4),
            "estimate": round(estimate, 3),
            "limit": params.limit,
            "window_s": window_s,
        }
        return allowed, state, None if allowed else round(window_s - elapsed, 3)
