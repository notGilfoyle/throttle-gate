"""Token Bucket limiter — atomic via the Appendix A Lua script."""

from __future__ import annotations

from ..config import TokenBucketParams
from .base import RateLimiter


class TokenBucketLimiter(RateLimiter):
    key = "token_bucket"

    async def setup(self) -> None:
        self._script = self.load_script("token_bucket.lua")

    async def evaluate(
        self, client_id: str, params: TokenBucketParams, now: float
    ) -> tuple[bool, dict, float | None]:
        allowed_raw, tokens_raw = await self._script(
            keys=[self.redis_key(client_id)],
            args=[params.capacity, params.refill_rate, now, 1],
        )
        allowed = bool(int(allowed_raw))
        tokens = float(tokens_raw)

        retry_after = None
        if not allowed and params.refill_rate > 0:
            # Time for the bucket to accrue the 1 token this request needed.
            retry_after = round((1 - tokens) / params.refill_rate, 3)

        state = {
            "tokens": round(tokens, 4),
            "capacity": params.capacity,
            "refill_rate": params.refill_rate,
        }
        return allowed, state, retry_after
