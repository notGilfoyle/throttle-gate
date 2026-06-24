// REST control-plane client (PRD §7.1). All paths are proxied to the backend
// by the Vite dev server (see vite.config.ts).

import type {
  AlertConfig,
  AlgorithmKey,
  AlgorithmMeta,
  EngineSettings,
  HistoryPoint,
  Policy,
  ReplayResult,
  RunConfig,
} from "../types";

const BASE = "/api";
const ROOT = ""; // backend root for the /v1/* live + policy endpoints

// Tenancy + auth (M12): the project and (optional) bearer token sent on /v1 calls.
let _project = "default";
let _token: string | null = null;

export function setProject(p: string): void {
  _project = p.trim() || "default";
}
export function setToken(t: string | null): void {
  _token = t && t.trim() ? t.trim() : null;
}

/** Headers for the per-tenant /v1 endpoints: project + optional bearer token. */
function v1Headers(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { "X-Project": _project, ...extra };
  if (_token) h["Authorization"] = `Bearer ${_token}`;
  return h;
}

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
export async function getLive(): Promise<{ session_id: string; project: string; config: RunConfig }> {
  return json(await fetch(`${ROOT}/v1/live`, { headers: v1Headers() }));
}

/** Policy engine (M9): the rules applied to live traffic. */
export async function getPolicy(): Promise<Policy> {
  return json(await fetch(`${ROOT}/v1/policy`, { headers: v1Headers() }));
}

export async function putPolicy(policy: Policy): Promise<Policy> {
  return json(
    await fetch(`${ROOT}/v1/policy`, {
      method: "PUT",
      headers: v1Headers({ "content-type": "application/json" }),
      body: JSON.stringify(policy),
    }),
  );
}

/** Engine settings (M8): fail-open vs fail-closed when the store is down. */
export async function getSettings(): Promise<EngineSettings> {
  return json(await fetch(`${ROOT}/v1/settings`, { headers: v1Headers() }));
}

export async function putSettings(settings: EngineSettings): Promise<EngineSettings> {
  return json(
    await fetch(`${ROOT}/v1/settings`, {
      method: "PUT",
      headers: v1Headers({ "content-type": "application/json" }),
      body: JSON.stringify(settings),
    }),
  );
}

/** Observability (M10): sampled traffic history. */
export async function getHistory(
  minutes = 30,
): Promise<{ points: HistoryPoint[]; bucket_s: number }> {
  return json(await fetch(`${ROOT}/v1/history?minutes=${minutes}`, { headers: v1Headers() }));
}

/** Observability (M10): per-key throttle alert config. */
export async function getAlerts(): Promise<AlertConfig> {
  return json(await fetch(`${ROOT}/v1/alerts`, { headers: v1Headers() }));
}

export async function putAlerts(config: AlertConfig): Promise<AlertConfig> {
  return json(
    await fetch(`${ROOT}/v1/alerts`, {
      method: "PUT",
      headers: v1Headers({ "content-type": "application/json" }),
      body: JSON.stringify(config),
    }),
  );
}

/** Onboarding (M12): replay an access log through limiters for comparison. */
export async function replayLog(body: {
  log: string;
  algorithms?: AlgorithmKey[];
  assumed_rps?: number;
}): Promise<ReplayResult> {
  return json(
    await fetch(`${ROOT}/v1/replay`, {
      method: "POST",
      headers: v1Headers({ "content-type": "application/json" }),
      body: JSON.stringify(body),
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
