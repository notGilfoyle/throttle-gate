// Throttle-Gate Express/Connect adapter (M8).
//
// Put a running Throttle-Gate in front of your Node service and rate-limit real
// traffic through it — every checked request also streams into the Throttle-Gate
// dashboard's Live mode.
//
//   const { throttleGate } = require("./throttleGate");
//   app.use(throttleGate({
//     gateUrl: "http://localhost:8000/v1/check",
//     key: (req) => req.headers["x-api-key"] || req.ip,
//   }));
//
// On reject it short-circuits with 429 and forwards Throttle-Gate's
// Retry-After / X-RateLimit-* headers. If the gate is unreachable it fails open
// by default (calls next()); pass failOpen: false to fail closed (503).
//
// Dependency-free: uses the global fetch (Node 18+). Works as Express or any
// Connect-style middleware.

const FORWARD_HEADERS = [
  "retry-after",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
];

function defaultKey(req) {
  return req.headers["x-api-key"] || req.ip || req.socket?.remoteAddress || "anon";
}

function throttleGate(options = {}) {
  const {
    gateUrl = "http://localhost:8000/v1/check",
    key = defaultKey,
    route = (req) => req.path || req.url || "*",
    algorithm = null,
    failOpen = true,
    timeoutMs = 1000,
  } = options;

  return async function throttleGateMiddleware(req, res, next) {
    const body = { key: key(req), route: route(req) };
    if (algorithm) body.algorithm = algorithm;

    let gate;
    try {
      gate = await fetch(gateUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      if (failOpen) return next();
      res.statusCode = 503;
      return res.end("rate limiter unavailable");
    }

    if (gate.status === 429) {
      for (const h of FORWARD_HEADERS) {
        const v = gate.headers.get(h);
        if (v != null) res.setHeader(h, v);
      }
      res.statusCode = 429;
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ detail: "Too Many Requests" }));
    }

    return next();
  };
}

module.exports = { throttleGate };
