"""GCRA limiter — leaky bucket as a meter, atomic via one stored TAT (M11)."""

from __future__ import annotations

import math

from ..config import GcraParams
from .base import RateLimiter


class GcraLimiter(RateLimiter):
    key = "gcra"

    async def setup(self) -> None:
        self._script = self.load_script("gcra.lua")

    async def evaluate(
        self,
        client_id: str,
        params: GcraParams,
        now: float,
        node: str | None = None,
        cost: int = 1,
    ) -> tuple[bool, dict, float | None]:
        allowed_raw, tat_raw = await self._script(
            keys=[self.state_key(client_id, node)],
            args=[params.rate, params.burst, now, cost],
        )
        allowed = bool(int(allowed_raw))
        tat = float(tat_raw)

        T = 1.0 / params.rate
        tau = params.burst * T
        # How "full" the meter is, in request-slots (0 = idle, burst = full).
        level = max(0.0, tat - now) / T
        remaining = max(0, math.floor(params.burst - level))

        retry_after = None
        if not allowed:
            # When `now` advances enough that admitting `cost` stays within tau.
            retry_after = round(max(0.0, (tat + T * cost) - tau - now), 3)

        state = {
            "level": round(level, 3),
            "burst": params.burst,
            "rate": params.rate,
            "emission_interval": round(T, 4),
            "tau": round(tau, 4),
            "remaining": remaining,
        }
        return allowed, state, retry_after
