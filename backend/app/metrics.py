"""Prometheus metrics for live-gateway traffic (M10).

A tiny in-process registry — no external dependency — exposing cumulative
counters in the Prometheus text exposition format at `GET /metrics`, so limiter
data lands in a team's existing Prometheus/Grafana.

Labels are deliberately low-cardinality (`algorithm`, `rule`, `decision`); the
high-cardinality dimensions (key, route) are *not* labels — they'd blow up the
series count. Top talkers by key are surfaced separately over SSE (see
`stats.py`). Counters are monotonic and process-global; they are not reset by
`/api/session/reset`.
"""

from __future__ import annotations

from collections import defaultdict

# decision label values
ALLOWED = "allowed"
THROTTLED = "throttled"
DENIED = "denied"
DEGRADED = "degraded"


def _escape(v: str) -> str:
    return v.replace("\\", "\\\\").replace('"', '\\"')


class Metrics:
    def __init__(self) -> None:
        # (project, algorithm, rule, decision) -> count
        self.requests: dict[tuple[str, str, str, str], int] = defaultdict(int)
        # (project, algorithm, rule) -> summed cost charged
        self.cost: dict[tuple[str, str, str], int] = defaultdict(int)

    def record(self, project: str, algorithm: str, rule: str, decision: str, cost: int) -> None:
        self.requests[(project, algorithm, rule, decision)] += 1
        self.cost[(project, algorithm, rule)] += cost

    def render(self) -> str:
        lines = [
            "# HELP throttlegate_requests_total Live requests evaluated by the gate.",
            "# TYPE throttlegate_requests_total counter",
        ]
        for (project, algo, rule, decision), n in sorted(self.requests.items()):
            labels = (
                f'project="{_escape(project)}",algorithm="{_escape(algo)}",'
                f'rule="{_escape(rule)}",decision="{_escape(decision)}"'
            )
            lines.append(f"throttlegate_requests_total{{{labels}}} {n}")

        lines += [
            "# HELP throttlegate_cost_total Total cost charged by the gate.",
            "# TYPE throttlegate_cost_total counter",
        ]
        for (project, algo, rule), n in sorted(self.cost.items()):
            labels = f'project="{_escape(project)}",algorithm="{_escape(algo)}",rule="{_escape(rule)}"'
            lines.append(f"throttlegate_cost_total{{{labels}}} {n}")
        return "\n".join(lines) + "\n"


# Process-global registry.
METRICS = Metrics()
