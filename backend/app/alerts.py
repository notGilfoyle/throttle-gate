"""Per-key throttle alerting (M10).

Watches live traffic and fires a webhook when a single key is throttled (429)
more than `throttle_threshold` times within a rolling `window_s` — the "this key
is hammering us" signal. Alerts are debounced per key by `cooldown_s` so one
abusive key doesn't spam the webhook.
"""

from __future__ import annotations

from collections import defaultdict, deque

from pydantic import BaseModel, Field


class AlertConfig(BaseModel):
    webhook_url: str | None = None
    throttle_threshold: int = 0  # throttled hits within the window to trigger; 0 = off
    window_s: float = Field(default=10.0, gt=0)
    cooldown_s: float = Field(default=30.0, ge=0)  # min seconds between alerts per key


class Alerter:
    def __init__(self) -> None:
        self.config = AlertConfig()
        self._throttles: dict[str, deque[float]] = defaultdict(deque)
        self._last_alert: dict[str, float] = {}

    def record_throttle(self, key: str, now: float) -> dict | None:
        """Register a throttled request for `key`; return an alert payload if it
        just crossed the threshold (respecting the per-key cooldown), else None."""
        cfg = self.config
        if not cfg.webhook_url or cfg.throttle_threshold <= 0:
            return None

        dq = self._throttles[key]
        dq.append(now)
        cutoff = now - cfg.window_s
        while dq and dq[0] < cutoff:
            dq.popleft()

        if len(dq) >= cfg.throttle_threshold and now - self._last_alert.get(key, 0.0) >= cfg.cooldown_s:
            self._last_alert[key] = now
            return {
                "key": key,
                "throttled": len(dq),
                "window_s": cfg.window_s,
                "threshold": cfg.throttle_threshold,
                "ts": now,
            }
        return None
