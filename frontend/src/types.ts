// Wire contracts mirroring the backend (PRD §9). Keep in lockstep with
// backend/app/config.py, sse.py, and limiters/base.py.

export type AlgorithmKey =
  | "token_bucket"
  | "leaky_bucket"
  | "fixed_window"
  | "sliding_log"
  | "sliding_counter"
  | "gcra"
  | "concurrency";

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

export interface DistributedConfig {
  enabled: boolean;
  replicas: number;
  mode: "shared" | "local";
}

export interface RunConfig {
  algorithm: AlgorithmKey;
  compare: AlgorithmKey[];
  rps: number;
  pattern: Pattern;
  client_count: number;
  params: Record<string, Record<string, number>>;
  distributed: DistributedConfig;
}

// ── Policy engine (M9) — mirrors backend/app/policy.py ──────────────────────

export interface PolicyMatch {
  route?: string | null; // glob, e.g. "/api/*"
  methods?: string[] | null; // e.g. ["POST"]
  keys?: string[] | null; // exact keys / tiers
}

export interface PolicyRule {
  name: string;
  match: PolicyMatch;
  deny: boolean;
  algorithm: AlgorithmKey | null; // null → live default
  params: Record<string, number> | null;
  cost: number;
}

export interface Policy {
  rules: PolicyRule[];
  // Per-key burst overrides: key → multiplier on the matched limit (M9).
  overrides: Record<string, number>;
}

export interface EngineSettings {
  fail_open: boolean; // admit vs reject 503 when the limiter store is down (M8)
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
  replica?: number; // distributed mode: which replica handled the request
  route?: string; // live mode: the route the real request hit
  method?: string; // live mode: HTTP method (for per-method policy, M9)
  cost?: number; // live mode: how much the request spent (weighted cost, M9)
  rule?: string; // live mode: the policy rule that matched (M9)
  override?: number; // live mode: per-key burst multiplier applied (M9)
}

export interface AlgoStats {
  allowed: number;
  rejected: number;
  allow_pct: number;
  throughput: number;
}

export interface TopKey {
  key: string;
  allowed: number;
  rejected: number;
}

export interface StatsEvent {
  type: "stats";
  ts: number;
  window_s: number;
  per_algorithm: Record<string, AlgoStats>;
  rps_in: number;
  top_keys?: TopKey[]; // live mode: top talkers / throttled keys (M10)
}

export interface HelloEvent {
  type: "hello";
  session_id: string;
  worker_id: string;
  config: RunConfig;
}

// ── Observability (M10) ─────────────────────────────────────────────────────

export interface HistoryPoint {
  t: number; // epoch seconds (bucket)
  allowed: number;
  rejected: number;
}

export interface AlertConfig {
  webhook_url: string | null;
  throttle_threshold: number; // throttled hits within the window to trigger; 0 = off
  window_s: number;
  cooldown_s: number;
}

export interface AlertEvent {
  type: "alert";
  key: string;
  throttled: number;
  window_s: number;
  threshold: number;
  ts: number;
}

// Access-log replay (M12).
export interface ReplayAlgoResult {
  algorithm: AlgorithmKey;
  allowed: number;
  blocked: number;
  total: number;
  allow_pct: number;
}

export interface ReplayResult {
  parsed: number;
  skipped: number;
  span_s: number;
  results: ReplayAlgoResult[];
  recommendation: string;
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

export interface GcraState {
  level: number; // request-slots ahead of schedule (0 = idle, burst = full)
  burst: number;
  rate: number;
  emission_interval: number;
  tau: number;
  remaining: number;
}

export interface ConcurrencyState {
  active: number; // in-flight leases right now
  limit: number;
  lease_ttl_s: number;
  remaining: number;
}
