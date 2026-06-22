import type { AlgorithmKey, DecisionEvent, RunConfig } from "../types";

interface Props {
  config: RunConfig;
  algorithm: AlgorithmKey;
  observed: number; // observed global allow/s for this algorithm
  decisions: DecisionEvent[];
}

/** Single-node sustained allow rate (the intended global limit), per algorithm. */
function singleNodeRate(algorithm: AlgorithmKey, params: Record<string, number>): number {
  switch (algorithm) {
    case "token_bucket":
      return params.refill_rate ?? 0;
    case "leaky_bucket":
      return params.leak_rate ?? 0;
    default: // fixed_window, sliding_log, sliding_counter
      return params.window_s ? params.limit / params.window_s : 0;
  }
}

/**
 * Distributed-mode callout (PRD §10). Contrasts the observed global allow-rate
 * with the configured single-node limit. In `local` mode each replica enforces
 * the limit independently, so the global rate multiplies and the limit is
 * breached; in `shared` mode it holds.
 */
export default function DistributedPanel({ config, algorithm, observed, decisions }: Props) {
  const d = config.distributed;
  const params = config.params[algorithm] ?? {};
  const single = singleNodeRate(algorithm, params);
  const breached = d.mode === "local" && single > 0 && observed > single * 1.25;

  // Round-robin attribution from recent decisions.
  const counts = Array(d.replicas).fill(0);
  for (const dec of decisions) {
    if (typeof dec.replica === "number" && dec.replica < d.replicas) counts[dec.replica]++;
  }
  const totalAttributed = counts.reduce((a, b) => a + b, 0) || 1;

  const tone = breached
    ? "border-red-500/60 bg-red-500/10"
    : d.mode === "shared"
      ? "border-emerald-500/50 bg-emerald-500/10"
      : "border-zinc-700 bg-zinc-900/50";

  return (
    <div className={`w-full max-w-2xl rounded-lg border px-4 py-3 ${tone}`}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold text-zinc-200">{d.replicas} replicas</span>
          <span className="text-zinc-500">·</span>
          <span className={d.mode === "shared" ? "text-emerald-300" : "text-red-300"}>
            {d.mode === "shared" ? "Shared Redis state" : "Local in-memory state"}
          </span>
        </div>
        <div className="flex items-center gap-4 font-mono text-sm">
          <span title="observed global allow rate">
            obs <span className="text-zinc-100">{observed.toFixed(1)}/s</span>
          </span>
          <span title="configured single-node limit" className="text-zinc-500">
            limit {single.toFixed(1)}/s
          </span>
        </div>
      </div>

      <div className="mt-2 text-xs">
        {breached ? (
          <span className="font-semibold text-red-300">
            ⚠ effective limit breached — observed ≈ {(observed / Math.max(single, 0.01)).toFixed(1)}× the
            global limit. Each replica admits up to the limit independently.
          </span>
        ) : d.mode === "shared" ? (
          <span className="font-semibold text-emerald-300">
            ✓ global limit holds across all replicas — atomic shared state in Redis.
          </span>
        ) : (
          <span className="text-zinc-400">Local mode: each replica keeps its own state…</span>
        )}
      </div>

      {/* round-robin attribution */}
      <div className="mt-2 flex gap-1">
        {counts.map((c, i) => (
          <div key={i} className="flex-1" title={`replica ${i}: ${c} requests`}>
            <div className="h-1.5 overflow-hidden rounded bg-zinc-800">
              <div
                className="h-full bg-sky-500/70"
                style={{ width: `${(c / totalAttributed) * 100}%` }}
              />
            </div>
            <div className="mt-0.5 text-center font-mono text-[10px] text-zinc-500">r{i}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
