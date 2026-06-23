// Minimal example: an Express service protected by Throttle-Gate (M8).
//
// Run Throttle-Gate (backend on :8000) first, then:
//
//   cd adapters/express && npm install express && node example_app.js
//
// Hammer it and watch the dashboard (Live mode):
//
//   for i in $(seq 1 40); do curl -s -o /dev/null -w "%{http_code} " \
//       -H 'x-api-key: user-42' localhost:9000/hello; done

const express = require("express");
const { throttleGate } = require("./throttleGate");

const app = express();

app.use(
  throttleGate({
    gateUrl: "http://localhost:8000/v1/check",
    key: (req) => req.headers["x-api-key"] || req.ip,
    failOpen: true,
  }),
);

app.get("/hello", (_req, res) => {
  res.json({ message: "hello — you got through the gate" });
});

app.listen(9000, () => console.log("example app on http://localhost:9000"));
