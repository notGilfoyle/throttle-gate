import type { AlgorithmKey, AlgorithmMeta, DecisionEvent, DecisionResult } from "../types";

interface Props {
  decision: DecisionEvent | null;
  algorithms: AlgorithmMeta[];
  onClose: () => void;
}

/** Simulated rate-limit headers derived from a result's state (PRD §8.3). */
function rateLimitHeaders(algorithm: AlgorithmKey, state: Record<string, number | number[]>) {
  const n = (k: string) => (typeof state[k] === "number" ? (state[k] as number) : 0);
  switch (algorithm) {
    case "token_bucket":
      return { limit: n("capacity"), remaining: Math.max(0, Math.floor(n("tokens"))) };
    case "leaky_bucket":
      return { limit: n("capacity"), remaining: Math.max(0, Math.floor(n("capacity") - n("queue_depth"))) };
    case "sliding_counter":
      return { limit: n("limit"), remaining: Math.max(0, Math.floor(n("limit") - n("estimate"))) };
    case "gcra":
      return { limit: n("burst"), remaining: Math.max(0, n("remaining")) };
    default: // fixed_window, sliding_log
      return { limit: n("limit"), remaining: Math.max(0, n("limit") - n("count")) };
  }
}

/**
 * Slide-over drawer showing a clicked request's full detail (PRD §8.3): decision,
 * HTTP status, Retry-After, simulated X-RateLimit-* headers, latency, and state —
 * reinforcing what a real rate-limited HTTP response looks like.
 */
export default function RequestInspector({ decision, algorithms, onClose }: Props) {
  if (!decision) return null;
  const label = (k: AlgorithmKey) => algorithms.find((a) => a.key === k)?.label ?? k;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="flex-1 bg-black/50" onClick={onClose} />
      <div className="w-[420px] overflow-y-auto border-l border-zinc-800 bg-zinc-950 p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-mono text-sm text-zinc-200">{decision.request_id}</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200" aria-label="Close">
            ✕
          </button>
        </div>

        <dl className="mb-5 grid grid-cols-2 gap-2 text-xs">
          <Meta k="Client" v={decision.client_id} />
          <Meta k="Timestamp" v={new Date(decision.ts * 1000).toLocaleTimeString()} />
          {decision.route && <Meta k="Route" v={decision.route} />}
          {decision.cost !== undefined && decision.cost !== 1 && (
            <Meta k="Cost" v={String(decision.cost)} />
          )}
          {decision.override !== undefined && <Meta k="Override" v={`${decision.override}×`} />}
          {decision.replica !== undefined && <Meta k="Replica" v={`r${decision.replica}`} />}
          <Meta k="Algorithms" v={String(decision.results.length)} />
        </dl>

        <div className="flex flex-col gap-3">
          {decision.results.map((r) => (
            <ResultCard key={r.algorithm} result={r} label={label(r.algorithm)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ResultCard({ result, label }: { result: DecisionResult; label: string }) {
  const headers = rateLimitHeaders(result.algorithm, result.state);
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900/50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-200">{label}</span>
        <span
          className={`rounded px-2 py-0.5 font-mono text-xs ${
            result.allowed ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300"
          }`}
        >
          {result.status} {result.allowed ? "OK" : "Too Many Requests"}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-xs text-zinc-400">
        <Row k="X-RateLimit-Limit" v={String(headers.limit)} />
        <Row k="X-RateLimit-Remaining" v={String(headers.remaining)} />
        <Row k="Retry-After" v={result.retry_after != null ? `${result.retry_after}s` : "—"} />
        <Row k="Latency" v={`${result.latency_ms}ms`} />
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-[11px] text-zinc-500">state</summary>
        <pre className="mt-1 overflow-x-auto rounded bg-zinc-950 p-2 text-[11px] text-zinc-400">
          {JSON.stringify(result.state, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-zinc-500">{k}</dt>
      <dd className="font-mono text-zinc-200">{v}</dd>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <span className="text-zinc-500">{k}</span>
      <span className="text-right text-zinc-200">{v}</span>
    </>
  );
}
