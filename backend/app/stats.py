"""Rolling aggregates for the `stats` SSE event (PRD §9.3).

Tracks cumulative allowed/rejected per algorithm (the running totals shown in the
stats panel) plus rolling-window rates for live throughput and incoming RPS.
"""

from __future__ import annotations

from collections import defaultdict, deque

from .limiters.base import Decision


class StatsAggregator:
    # Cap distinct keys tracked for top-talkers, to bound memory under real traffic.
    _MAX_KEYS = 5000

    def __init__(self, rate_window_s: float = 1.0) -> None:
        # Window over which throughput / rps_in are measured (independent of the
        # ~500ms stats emit cadence).
        self.rate_window_s = rate_window_s

        # Cumulative session totals, per algorithm.
        self.allowed: dict[str, int] = defaultdict(int)
        self.rejected: dict[str, int] = defaultdict(int)

        # Cumulative per-key totals for top-talkers / throttled-keys (M10).
        self.key_allowed: dict[str, int] = defaultdict(int)
        self.key_rejected: dict[str, int] = defaultdict(int)

        # Rolling event timestamps for rate computation.
        self._allow_events: dict[str, deque[float]] = defaultdict(deque)
        self._request_ts: deque[float] = deque()

    def record(self, ts: float, results: list[Decision], client_id: str | None = None) -> None:
        """Fold one request's decisions (one per active algorithm) into the totals."""
        self._request_ts.append(ts)
        for d in results:
            if d.allowed:
                self.allowed[d.algorithm] += 1
                self._allow_events[d.algorithm].append(ts)
            else:
                self.rejected[d.algorithm] += 1

        # Per-key tally (a request is "allowed" only if every result allowed).
        if client_id is not None and (
            client_id in self.key_allowed
            or client_id in self.key_rejected
            or len(self.key_allowed) + len(self.key_rejected) < self._MAX_KEYS
        ):
            if all(d.allowed for d in results):
                self.key_allowed[client_id] += 1
            else:
                self.key_rejected[client_id] += 1

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
            "top_keys": self._top_keys(),
        }

    def _top_keys(self, n: int = 8) -> list[dict]:
        """Top keys by total requests, with allowed/rejected — the 'who's being
        throttled' view (M10)."""
        keys = set(self.key_allowed) | set(self.key_rejected)
        ranked = sorted(
            keys,
            key=lambda k: self.key_allowed[k] + self.key_rejected[k],
            reverse=True,
        )[:n]
        return [
            {
                "key": k,
                "allowed": self.key_allowed[k],
                "rejected": self.key_rejected[k],
            }
            for k in ranked
        ]
