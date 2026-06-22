"""Rolling aggregates for the `stats` SSE event (PRD §9.3).

Tracks cumulative allowed/rejected per algorithm (the running totals shown in the
stats panel) plus rolling-window rates for live throughput and incoming RPS.
"""

from __future__ import annotations

from collections import defaultdict, deque

from .limiters.base import Decision


class StatsAggregator:
    def __init__(self, rate_window_s: float = 1.0) -> None:
        # Window over which throughput / rps_in are measured (independent of the
        # ~500ms stats emit cadence).
        self.rate_window_s = rate_window_s

        # Cumulative session totals, per algorithm.
        self.allowed: dict[str, int] = defaultdict(int)
        self.rejected: dict[str, int] = defaultdict(int)

        # Rolling event timestamps for rate computation.
        self._allow_events: dict[str, deque[float]] = defaultdict(deque)
        self._request_ts: deque[float] = deque()

    def record(self, ts: float, results: list[Decision]) -> None:
        """Fold one request's decisions (one per active algorithm) into the totals."""
        self._request_ts.append(ts)
        for d in results:
            if d.allowed:
                self.allowed[d.algorithm] += 1
                self._allow_events[d.algorithm].append(ts)
            else:
                self.rejected[d.algorithm] += 1

    def _trim(self, now: float) -> None:
        cutoff = now - self.rate_window_s
        while self._request_ts and self._request_ts[0] < cutoff:
            self._request_ts.popleft()
        for dq in self._allow_events.values():
            while dq and dq[0] < cutoff:
                dq.popleft()

    def snapshot(self, now: float) -> dict:
        """Build a `stats` event payload as of `now`."""
        self._trim(now)
        algos = set(self.allowed) | set(self.rejected)
        per_algorithm: dict[str, dict] = {}
        for algo in algos:
            allowed = self.allowed[algo]
            rejected = self.rejected[algo]
            total = allowed + rejected
            per_algorithm[algo] = {
                "allowed": allowed,
                "rejected": rejected,
                "allow_pct": round(100.0 * allowed / total, 1) if total else 0.0,
                "throughput": round(len(self._allow_events[algo]) / self.rate_window_s, 2),
            }
        return {
            "type": "stats",
            "ts": now,
            "window_s": self.rate_window_s,
            "per_algorithm": per_algorithm,
            "rps_in": round(len(self._request_ts) / self.rate_window_s, 2),
        }
