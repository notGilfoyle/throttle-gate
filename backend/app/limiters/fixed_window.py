"""Fixed Window Counter — atomic INCR/EXPIRE with the window index in the key."""

from __future__ import annotations

from ..config import FixedWindowParams
from .base import RateLimiter


class FixedWindowLimiter(RateLimiter):
    key = "fixed_window"

    async def setup(self) -> None:
        self._script = self.load_script("fixed_window.lua")

    async def evaluate(
        self, client_id: str, params: FixedWindowParams, now: float
    ) -> tuple[bool, dict, float | None]:
        window_s = params.window_s
        idx = int(now // window_s)
        rkey = f"{self.key}:{client_id}:{idx}"
        resets_in_s = round(window_s - (now - idx * window_s), 3)

        allowed_raw, count = await self._script(
            keys=[rkey], args=[params.limit, int(window_s * 1000)]
        )
        allowed = bool(int(allowed_raw))

        state = {
            "count": int(count),
            "limit": params.limit,
            "window_s": window_s,
            "resets_in_s": resets_in_s,
        }
        return allowed, state, None if allowed else resets_in_s
