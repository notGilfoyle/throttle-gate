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

// Per-algorithm state shapes (PRD §4) for the typed visualizers.
export interface TokenBucketState {
  tokens: number;
  capacity: number;
  refill_rate: number;
}

export interface LeakyBucketState {
  queue_depth: number;
  capacity: number;
  leak_rate: number;
  est_wait_ms: number;
}

export interface FixedWindowState {
  count: number;
  limit: number;
  window_s: number;
  resets_in_s: number;
}

export interface SlidingLogState {
  count: number;
  limit: number;
  window_s: number;
  timestamps: number[];
}

export interface SlidingCounterState {
  curr_count: number;
  prev_count: number;
  weight: number;
  estimate: number;
  limit: number;
  window_s: number;
}
