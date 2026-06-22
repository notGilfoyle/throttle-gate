"""Real multi-replica demonstration (PRD §10).

Fires a concurrent burst at the protected /api/gate endpoint *through the nginx
proxy*, which round-robins across two real backend replicas. Run against the
distributed stack:

    docker compose -f docker-compose.distributed.yml up --build -d
    python scripts/distributed_demo.py

Expectation (capacity 20 per node, 2 replicas):
  - shared mode: ~20 admitted   (one shared bucket — the global limit holds)
  - local mode:  ~40 admitted   (each replica admits up to 20 — limit breached)
Both runs should show requests handled by *both* worker_ids.

Needs: pip install httpx  (or run via `uv run` from the backend project).
"""

from __future__ import annotations

import asyncio
import collections
import os

import httpx

PROXY = os.environ.get("PROXY_URL", "http://localhost:8080")
N = int(os.environ.get("N", "100"))  # concurrent requests in the burst
CAPACITY = 20


async def fire(client: httpx.AsyncClient, mode: str) -> tuple[bool, str]:
    r = await client.post(
        f"{PROXY}/api/gate",
        json={
            "algorithm": "token_bucket",
            "mode": mode,
            "params": {"capacity": CAPACITY, "refill_rate": 1},
        },
    )
    d = r.json()
    return d["allowed"], d["worker_id"]


async def run(mode: str) -> tuple[int, dict[str, int]]:
    async with httpx.AsyncClient(timeout=20) as client:
        await client.post(f"{PROXY}/api/session/reset")  # flush shared Redis state
        results = await asyncio.gather(*(fire(client, mode) for _ in range(N)))
    allowed = sum(1 for ok, _ in results if ok)
    workers = collections.Counter(w for _, w in results)
    return allowed, dict(workers)


async def main() -> None:
    print(f"Firing {N} concurrent requests at {PROXY}/api/gate (capacity {CAPACITY}/node)\n")
    for mode in ("shared", "local"):
        allowed, workers = await run(mode)
        print(f"  {mode:7} mode: {allowed:3}/{N} admitted   replicas={workers}")
    print(
        f"\nShared should admit ~{CAPACITY} (global limit holds);"
        f" local ~{CAPACITY * 2} (each replica enforces its own limit = breach)."
    )


if __name__ == "__main__":
    asyncio.run(main())
