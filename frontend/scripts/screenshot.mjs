// Headless visual check: load the app, click Start, let a burst run, screenshot.
// Uses Chrome via the DevTools Protocol over Node's built-in WebSocket.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = process.env.URL ?? "http://localhost:5173/";
const OUT = process.env.OUT ?? "/tmp/throttle-gate.png";
const PORT = 9333;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${PORT}`,
  "--hide-scrollbars",
  "--window-size=1440,900",
  "--no-first-run",
  "--no-default-browser-check",
  URL,
]);

let ws;
let nextId = 1;
const pending = new Map();
const errors = [];

function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve) => pending.set(id, resolve));
}

try {
  // Wait for the page target and grab its debugger websocket URL.
  let wsUrl = null;
  for (let i = 0; i < 50 && !wsUrl; i++) {
    await sleep(200);
    try {
      const targets = await (await fetch(`http://localhost:${PORT}/json`)).json();
      const page = targets.find((t) => t.type === "page" && t.url.startsWith("http"));
      if (page) wsUrl = page.webSocketDebuggerUrl;
    } catch {
      /* chrome not ready yet */
    }
  }
  if (!wsUrl) throw new Error("no page target");

  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
    } else if (msg.method === "Runtime.exceptionThrown") {
      errors.push(msg.params.exceptionDetails.exception?.description ?? "exception");
    }
  };

  await send("Runtime.enable");
  await send("Page.enable");
  await sleep(1500); // let React mount + fetch /api/algorithms

  // Click the Start button.
  await send("Runtime.evaluate", {
    expression: `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Start')?.click()`,
  });

  await sleep(4500); // let a couple of burst cycles drain/refill the tank

  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(OUT, Buffer.from(data, "base64"));

  // Report visible chip count + connection badge text for a non-visual sanity check.
  const probe = await send("Runtime.evaluate", {
    expression: `JSON.stringify({
      chips: document.querySelectorAll('section:last-child button').length,
      header: document.querySelector('header')?.innerText,
      tokens: document.querySelector('svg text')?.textContent
    })`,
    returnByValue: true,
  });
  console.log("PROBE:", probe.result.value);
  console.log("ERRORS:", errors.length ? errors : "none");
  console.log("SAVED:", OUT);
} catch (e) {
  console.error("FAIL:", e.message);
  process.exitCode = 1;
} finally {
  ws?.close();
  chrome.kill();
}
