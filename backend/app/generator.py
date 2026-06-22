"""Asyncio load generator (PRD §7.3).

Emits requests at a target RPS following a selectable traffic pattern, fans them
across simulated clients, evaluates each against the session's active algorithms,
and hands the resulting `decision` event to a callback. RPS is honored purely via
`asyncio.sleep` so the event loop is never blocked.

M1 supports `steady` + `burst`; `ramp`/`spike` arrive in M6. Config is read live
each iteration so `PATCH /api/config` takes effect without a restart.
"""

from __future__ import annotations

import asyncio
import time
from typing import Awaitable, Callable

from .config import RunConfig
from .limiters.base import Decision, RateLimiter

# Burst pattern shaping: a short, dense burst once per period; quiet otherwise.
# Average RPS over a period equals the configured rps.
_BURST_PERIOD_S = 2.0
_BURST_ACTIVE_S = 0.25

# Ramp: linearly climb from 10% to 100% of target RPS over this duration, then hold.
_RAMP_DURATION_S = 15.0

# Spike: mostly steady, with a brief high surge once per period.
_SPIKE_PERIOD_S = 8.0
_SPIKE_ACTIVE_S = 0.3
_SPIKE_MULT = 6.0

# Called with (decision_event_dict, decisions) for each fired request.
OnDecision = Callable[[dict, list[Decision]], Awaitable[None]]


class LoadGenerator:
    def __init__(
        self,
        config: RunConfig,
        limiters: dict[str, RateLimiter],
        on_decision: OnDecision,
    ) -> None:
        self.config = config
        self.limiters = limiters
        self.on_decision = on_decision
        self._seq = 0
        self._start = time.time()

    def _next_delay(self, now: float) -> float:
        """Seconds to sleep before the next request, per the current pattern/rps."""
        rps = max(self.config.rps, 0.1)
        pattern = self.config.pattern
        elapsed = now - self._start

        if pattern == "burst":
            phase = elapsed % _BURST_PERIOD_S
            if phase < _BURST_ACTIVE_S:
                burst_rps = rps * _BURST_PERIOD_S / _BURST_ACTIVE_S
                return 1.0 / burst_rps
            # Idle until the next burst window opens.
            return _BURST_PERIOD_S - phase

        if pattern == "ramp":
            frac = min(1.0, 0.1 + 0.9 * elapsed / _RAMP_DURATION_S)
            return 1.0 / (rps * frac)

        if pattern == "spike":
            phase = elapsed % _SPIKE_PERIOD_S
            if phase < _SPIKE_ACTIVE_S:
                return 1.0 / (rps * _SPIKE_MULT)
            return 1.0 / rps

        # steady
        return 1.0 / rps

    async def _fire(self, now: float) -> None:
        request_id = f"req_{self._seq:06d}"
        self._seq += 1
        client_id = f"client-{(self._seq % self.config.client_count) + 1}"

        # Distributed demo: round-robin this request to a replica. In `local` mode
        # the replica's state is isolated (a per-node key); in `shared` mode all
        # replicas share state (node=None). Round-robin still applies in shared
        # mode so the "handled by" attribution is shown either way.
        dist = self.config.distributed
        replica = self._seq % dist.replicas if dist.enabled else None
        node = f"r{replica}" if (dist.enabled and dist.mode == "local") else None

        # Same request evaluated against every active algorithm (compare mode in M4
        # produces >1 result; single mode produces exactly one).
        results: list[Decision] = []
        for algo in self.config.active_algorithms():
            limiter = self.limiters[algo]
            params = self.config.params.for_algorithm(algo)
            results.append(await limiter.check(client_id, params, now, node))

        event = {
            "type": "decision",
            "request_id": request_id,
            "client_id": client_id,
            "ts": now,
            "results": [d.model_dump() for d in results],
        }
        if replica is not None:
            event["replica"] = replica
        await self.on_decision(event, results)

    async def run(self, stop: asyncio.Event) -> None:
        """Main loop. Runs until `stop` is set."""
        while not stop.is_set():
            delay = self._next_delay(time.time())
            try:
                await asyncio.wait_for(stop.wait(), timeout=delay)
                return  # stop fired during the sleep
            except asyncio.TimeoutError:
                pass  # normal: the sleep elapsed, fire the next request
            await self._fire(time.time())
