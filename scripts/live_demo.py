"""Live-mode demonstration (M7).

Drives *real* traffic at the decision API `POST /v1/check` so the Throttle-Gate
dashboard lights up with real allow/throttle decisions. Open the UI, switch to
**Live traffic** mode, then run:

    docker compose up -d           # backend on :8000
    python scripts/live_demo.py

It fires a steady stream from a few simulated API keys across a couple of routes.
Watch the request stream, the visualizer, and the throughput timeline react live.
Reject responses come back as HTTP 429 with Retry-After / X-RateLimit-* headers.

Needs: pip install httpx  (or run via `uv run` from the backend project).
"""

from __future__ import annotations

import asyncio
import collections
import os
import random

import httpx

BASE = os.environ.get("GATE_URL", "http://localhost:8000")
RPS = float(os.environ.get("RPS", "25"))
DURATION_S = float(os.environ.get("DURATION_S", "20"))
KEYS = ["user-42", "user-17", "acme-corp", "free-tier-9"]
ROUTES = ["/api/search", "/api/login", "/api/upload"]


async def fire(client: httpx.AsyncClient, counts: collections.Counter) -> None:
    r = await client.post(
        f"{BASE}/v1/check",
        json={"key": random.choice(KEYS), "route": random.choice(ROUTES)},
    )
    counts["allowed" if r.status_code == 200 else "throttled"] += 1


async def main() -> None:
    counts: collections.Counter = collections.Counter()
    delay = 1.0 / RPS
    print(f"Firing ~{RPS:.0f} req/s at {BASE}/v1/check for {DURATION_S:.0f}s")
    print("Switch the dashboard to 'Live traffic' mode to watch.\n")
    async with httpx.AsyncClient(timeout=5) as client:
        loop = asyncio.get_event_loop()
        end = loop.time() + DURATION_S
        while loop.time() < end:
            asyncio.create_task(fire(client, counts))
            await asyncio.sleep(delay)
        await asyncio.sleep(1.0)  # let in-flight requests settle
    total = sum(counts.values())
    print(f"  sent {total}: {counts['allowed']} allowed (200), {counts['throttled']} throttled (429)")


if __name__ == "__main__":
    asyncio.run(main())
