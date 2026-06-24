"""Minimal example: a FastAPI service protected by Throttle-Gate (M7).

Run Throttle-Gate (backend on :8000) first, then:

    uv run --with fastapi --with uvicorn --with httpx uvicorn example_app:app --port 9000

Hammer it and watch the dashboard (Live mode):

    for i in $(seq 1 40); do curl -s -o /dev/null -w "%{http_code} " \\
        -H 'x-api-key: user-42' localhost:9000/hello; done
"""

import os

from fastapi import FastAPI

from throttle_gate import ThrottleGateMiddleware

app = FastAPI()

app.add_middleware(
    ThrottleGateMiddleware,
    gate_url=os.environ.get("GATE_URL", "http://localhost:8000/v1/check"),
    # Rate-limit per API key, falling back to client IP.
    key=lambda req: req.headers.get("x-api-key") or (req.client.host if req.client else "anon"),
    fail_open=True,
)


@app.get("/hello")
async def hello() -> dict:
    return {"message": "hello — you got through the gate"}
