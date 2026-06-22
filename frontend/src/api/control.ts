// REST control-plane client (PRD §7.1). All paths are proxied to the backend
// by the Vite dev server (see vite.config.ts).

import type { AlgorithmMeta, RunConfig } from "../types";

const BASE = "/api";

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
