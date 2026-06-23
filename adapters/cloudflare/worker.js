// Throttle-Gate Cloudflare Worker adapter (M8).
//
// Deploy in front of your origin (a Workers route on your zone). Each request is
// checked against Throttle-Gate's POST /v1/check before being passed through to
// the origin; on reject the Worker returns 429 with Throttle-Gate's headers.
// Every checked request also streams into the Throttle-Gate dashboard (Live mode).
//
// Config (wrangler.toml [vars]):
//   GATE_URL   full URL of the gate's /v1/check (must be reachable from the edge)
//   FAIL_OPEN  "true" (default) serves origin if the gate is down; "false" → 503

const FORWARD_HEADERS = [
  "retry-after",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const key =
      request.headers.get("x-api-key") ||
      request.headers.get("cf-connecting-ip") ||
      "anon";

    let gate;
    try {
      gate = await fetch(env.GATE_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, route: url.pathname }),
      });
    } catch {
      if (env.FAIL_OPEN !== "false") return fetch(request); // fail open
      return new Response("rate limiter unavailable", { status: 503 });
    }

    if (gate.status === 429) {
      const headers = new Headers({ "content-type": "application/json" });
      for (const h of FORWARD_HEADERS) {
        const v = gate.headers.get(h);
        if (v != null) headers.set(h, v);
      }
      return new Response(JSON.stringify({ detail: "Too Many Requests" }), {
        status: 429,
        headers,
      });
    }

    return fetch(request); // allowed → pass through to origin
  },
};
