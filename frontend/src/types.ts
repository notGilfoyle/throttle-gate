// Wire contracts mirroring the backend (PRD §9). Keep in lockstep with
// backend/app/config.py, sse.py, and limiters/base.py.

export type AlgorithmKey =
  | "token_bucket"
  | "leaky_bucket"
  | "fixed_window"
  | "sliding_log"
  | "sliding_counter";

export type Pattern = "steady" | "burst" | "ramp" | "spike";

export interface ParamSpec {
  name: string;
  label: string;
  type: "int" | "float";
  default: number;
  min: number;
  max: number;
  step: number;
}

export interface AlgorithmMeta {
  key: AlgorithmKey;
  label: string;
  description: string;
  params: ParamSpec[];
  state_fields: string[];
}

export interface RunConfig {
  algorithm: AlgorithmKey;
  compare: AlgorithmKey[];
  rps: number;
  pattern: Pattern;
  client_count: number;
  params: Record<string, Record<string, number>>;
}

// ── SSE events ────────────────────────────────────────────────────────────

export interface DecisionResult {
  algorithm: AlgorithmKey;
  allowed: boolean;
  status: number;
  retry_after: number | null;
  latency_ms: number;
  state: Record<string, number | number[]>;
}

export interface DecisionEvent {
  type: "decision";
  request_id: string;
  client_id: string;
  ts: number;
  results: DecisionResult[];
}

export interface AlgoStats {
  allowed: number;
  rejected: number;
  allow_pct: number;
  throughput: number;
}

export interface StatsEvent {
  type: "stats";
  ts: number;
  window_s: number;
  per_algorithm: Record<string, AlgoStats>;
  rps_in: number;
}

export interface HelloEvent {
  type: "hello";
  session_id: string;
  worker_id: string;
  config: RunConfig;
}

// Token-bucket state shape (PRD §4) for the typed visualizer.
export interface TokenBucketState {
  tokens: number;
  capacity: number;
  refill_rate: number;
}
