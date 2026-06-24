"""Sliding Window Log — atomic sorted-set of timestamps."""

from __future__ import annotations

import uuid

from ..config import SlidingLogParams
from .base import RateLimiter


class SlidingLogLimiter(RateLimiter):
    key = "sliding_log"

    async def setup(self) -> None:
        self._script = self.load_script("sliding_log.lua")

    async def evaluate(
        self,
        client_id: str,
        params: SlidingLogParams,
        now: float,
        node: str | None = None,
        cost: int = 1,
    ) -> tuple[bool, dict, float | None]:
        member = f"{now:.6f}:{uuid.uuid4().hex[:8]}"  # unique per request
        res = await self._script(
            keys=[self.state_key(client_id, node)],
            args=[now, params.window_s, params.limit, member, cost],
        )
        allowed = bool(int(res[0]))
        count = int(res[1])
        timestamps = [round(float(s), 4) for s in res[2:]]

        retry_after = None
        if not allowed and timestamps:
            # When the oldest in-window entry ages out, a slot frees up.
            retry_after = round(max(0.0, (min(timestamps) + params.window_s) - now), 3)

        state = {
            "count": count,
            "limit": params.limit,
            "window_s": params.window_s,
            "timestamps": timestamps,
        }
        return allowed, state, retry_after
