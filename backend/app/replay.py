"""Access-log replay (M12) — a zero-deploy on-ramp.

Parse an nginx/Apache access log (or a simple `key,route[,method]` CSV), then
replay the requests through one or more limiters *at their original timestamps*
(the limiter `check()` already takes `now`, so rate-based algorithms behave
exactly as they would have live). Reports, per algorithm, how many of the real
requests would have been allowed vs. blocked — so you can choose an algorithm on
your own traffic without deploying anything.
"""

from __future__ import annotations

import re
import time
import uuid
from dataclasses import dataclass
from datetime import datetime

from .config import AlgorithmKey, RunParams
from .limiters.base import RateLimiter

# nginx/Apache "combined": IP - - [ts] "METHOD path HTTP/x" status ...
_NGINX = re.compile(r'^(\S+) \S+ \S+ \[([^\]]+)\] "(\S+) (\S+)[^"]*" (\d{3})')
_TS_FMT = "%d/%b/%Y:%H:%M:%S %z"

# Default comparison set when the caller doesn't pick algorithms.
DEFAULT_ALGOS: list[AlgorithmKey] = ["token_bucket", "leaky_bucket", "fixed_window", "sliding_log"]


@dataclass
class Event:
    ts: float | None
    key: str
    route: str
    method: str


def parse_log(text: str, max_lines: int) -> tuple[list[Event], int]:
    """Parse up to `max_lines` log lines into events; return (events, skipped)."""
    events: list[Event] = []
    skipped = 0
    for raw in text.splitlines()[:max_lines]:
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        m = _NGINX.match(line)
        if m:
            ip, ts_str, method, path, _status = m.groups()
            try:
                ts = datetime.strptime(ts_str, _TS_FMT).timestamp()
            except ValueError:
                ts = None
            events.append(Event(ts, ip, path, method))
            continue
        # Fallback: "key,route[,method]"
        parts = [p.strip() for p in line.split(",")]
        if len(parts) >= 2 and parts[0] and parts[1]:
            events.append(Event(None, parts[0], parts[1], parts[2] if len(parts) > 2 else "GET"))
        else:
            skipped += 1
    return events, skipped


def _timeline(events: list[Event], assumed_rps: float) -> list[tuple[float, Event]]:
    """Assign each event a timestamp. Use the log's timestamps when *all* are
    present; otherwise synthesize an evenly-spaced timeline at `assumed_rps`."""
    if events and all(e.ts is not None for e in events):
        ordered = sorted(events, key=lambda e: e.ts)  # type: ignore[arg-type, return-value]
        return [(e.ts, e) for e in ordered]  # type: ignore[misc]
    dt = 1.0 / max(assumed_rps, 0.1)
    base = time.time()
    return [(base + i * dt, e) for i, e in enumerate(events)]


def _peak_rps(times: list[float]) -> float:
    """Max requests in any trailing 1s window (a simple burstiness probe)."""
    if not times:
        return 0.0
    times = sorted(times)
    peak = 0
    start = 0
    for end in range(len(times)):
        while times[end] - times[start] >= 1.0:
            start += 1
        peak = max(peak, end - start + 1)
    return float(peak)


def recommendation(timeline: list[tuple[float, Event]]) -> str:
    times = [t for t, _ in timeline]
    n = len(times)
    if n < 2:
        return "Not enough requests to characterize the traffic."
    span = max(times[-1] - times[0], 1e-9)
    avg = n / span
    peak = _peak_rps(times)
    ratio = peak / max(avg, 1e-9)
    head = f"~{avg:.1f} req/s average, peaking at {peak:.0f} req/s in a 1s window"
    if ratio >= 3:
        return (
            f"{head} — **bursty**. Token Bucket or GCRA absorb the spikes while holding the "
            "average; Fixed Window risks double-rate at boundaries, and Sliding Window will be "
            "the strictest."
        )
    return (
        f"{head} — **fairly smooth**. Any algorithm works; Sliding Window Counter gives the most "
        "accurate steady enforcement with low overhead."
    )


async def replay(
    limiters: dict[str, RateLimiter],
    events: list[Event],
    algorithms: list[AlgorithmKey],
    params: RunParams,
    assumed_rps: float,
) -> dict:
    """Replay `events` through each algorithm; return per-algorithm allow/block."""
    timeline = _timeline(events, assumed_rps)
    replay_id = uuid.uuid4().hex[:8]
    results = []
    for algo in algorithms:
        limiter = limiters[algo]
        p = params.for_algorithm(algo)
        allowed = blocked = 0
        for ts, e in timeline:
            # Namespace state per replay+algo so runs never collide; keys self-expire.
            cid = f"replay:{replay_id}:{algo}:{e.key}"
            decision = await limiter.check(cid, p, now=ts)
            if decision.allowed:
                allowed += 1
            else:
                blocked += 1
        total = allowed + blocked
        results.append(
            {
                "algorithm": algo,
                "allowed": allowed,
                "blocked": blocked,
                "total": total,
                "allow_pct": round(100.0 * allowed / total, 1) if total else 0.0,
            }
        )
    span = max((timeline[-1][0] - timeline[0][0]) if len(timeline) > 1 else 0.0, 0.0)
    return {
        "parsed": len(events),
        "span_s": round(span, 1),
        "results": results,
        "recommendation": recommendation(timeline),
    }
