"""Concurrency limiter — a leased semaphore capping in-flight requests (M11)."""

from __future__ import annotations

import uuid

from ..config import ConcurrencyParams
from .base import RateLimiter


class ConcurrencyLimiter(RateLimiter):
    key = "concurrency"

    async def setup(self) -> None:
        self._script = self.load_script("concurrency.lua")

    async def evaluate(
        self,
        client_id: str,
        params: ConcurrencyParams,
        now: float,
        node: str | None = None,
        cost: int = 1,
    ) -> tuple[bool, dict, float | None]:
        lease_id = f"{now:.6f}:{uuid.uuid4().hex[:8]}"  # unique per request
        allowed_raw, active_raw, soonest_raw = await self._script(
            keys=[self.state_key(client_id, node)],
            args=[params.limit, params.lease_ttl_s, now, lease_id, cost],
        )
        allowed = bool(int(allowed_raw))
        active = int(active_raw)

        retry_after = None
        if not allowed:
            soonest = float(soonest_raw)
            # Time until the earliest in-flight lease frees a slot.
            retry_after = round(max(0.0, soonest - now), 3) if soonest > 0 else round(params.lease_ttl_s, 3)

        state = {
            "active": active,
            "limit": params.limit,
            "lease_ttl_s": params.lease_ttl_s,
            "remaining": max(0, params.limit - active),
        }
        return allowed, state, retry_after
