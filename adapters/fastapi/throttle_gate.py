"""Throttle-Gate FastAPI adapter (M7).

Drop this in front of your own FastAPI service to rate-limit real traffic through
a running Throttle-Gate, and watch the decisions live in its dashboard (Live mode).

Usage:

    from throttle_gate import ThrottleGateMiddleware

    app.add_middleware(
        ThrottleGateMiddleware,
        gate_url="http://localhost:8000/v1/check",
        key=lambda req: req.headers.get("x-api-key") or (req.client.host if req.client else "anon"),
    )

On reject the middleware short-circuits with `429` and forwards Throttle-Gate's
`Retry-After` / `X-RateLimit-*` headers. If the gate is unreachable it **fails
open** by default (serves the request) — flip `fail_open=False` to fail closed.
"""

from __future__ import annotations

from typing import Callable

import httpx
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp

# Headers we copy straight from the gate's response onto the client's response.
_FORWARD_HEADERS = ("Retry-After", "X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset")


def _default_key(request: Request) -> str:
    return request.headers.get("x-api-key") or (request.client.host if request.client else "anon")


class ThrottleGateMiddleware:
    """ASGI middleware that checks each request against a Throttle-Gate."""

    def __init__(
        self,
        app: ASGIApp,
        gate_url: str = "http://localhost:8000/v1/check",
        key: Callable[[Request], str] = _default_key,
        route: Callable[[Request], str] | None = None,
        algorithm: str | None = None,
        fail_open: bool = True,
        timeout: float = 1.0,
    ) -> None:
        self.app = app
        self.gate_url = gate_url
        self.key = key
        self.route = route or (lambda r: r.url.path)
        self.algorithm = algorithm
        self.fail_open = fail_open
        self._client = httpx.AsyncClient(timeout=timeout)

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request = Request(scope, receive=receive)
        body = {"key": self.key(request), "route": self.route(request)}
        if self.algorithm:
            body["algorithm"] = self.algorithm

        try:
            gate = await self._client.post(self.gate_url, json=body)
        except httpx.HTTPError:
            if self.fail_open:
                await self.app(scope, receive, send)
                return
            response: Response = Response("rate limiter unavailable", status_code=503)
            await response(scope, receive, send)
            return

        if gate.status_code == 429:
            headers = {h: gate.headers[h] for h in _FORWARD_HEADERS if h in gate.headers}
            response = JSONResponse({"detail": "Too Many Requests"}, status_code=429, headers=headers)
            await response(scope, receive, send)
            return

        await self.app(scope, receive, send)
