// REST control-plane client (PRD §7.1). All paths are proxied to the backend
// by the Vite dev server (see vite.config.ts).

import type { AlgorithmMeta, Policy, RunConfig } from "../types";

const BASE = "/api";
const ROOT = ""; // backend root for the /v1/* live + policy endpoints

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${detail}`);
  }
  return res.json() as Promise<T>;
}

export async function getAlgorithms(): Promise<AlgorithmMeta[]> {
  const data = await json<{ algorithms: AlgorithmMeta[] }>(await fetch(`${BASE}/algorithms`));
  return data.algorithms;
}

export async function startSession(
  config: RunConfig,
): Promise<{ session_id: string; worker_id: string }> {
  return json(
    await fetch(`${BASE}/session/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(config),
    }),
  );
}

/** Live mode (M7): the persistent session real /v1/check traffic feeds. */
export async function getLive(): Promise<{ session_id: string; config: RunConfig }> {
  return json(await fetch(`${ROOT}/v1/live`));
}

/** Policy engine (M9): the rules applied to live traffic. */
export async function getPolicy(): Promise<Policy> {
  return json(await fetch(`${ROOT}/v1/policy`));
}

export async function putPolicy(policy: Policy): Promise<Policy> {
  return json(
    await fetch(`${ROOT}/v1/policy`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(policy),
    }),
  );
}

export async function stopSession(session_id: string): Promise<void> {
  await json(
    await fetch(`${BASE}/session/stop`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_id }),
    }),
  );
}

export async function resetSession(): Promise<void> {
  await json(await fetch(`${BASE}/session/reset`, { method: "POST" }));
}

export async function patchConfig(
  session_id: string,
  patch: Partial<RunConfig>,
): Promise<void> {
  await json(
    await fetch(`${BASE}/config`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_id, ...patch }),
    }),
  );
}
