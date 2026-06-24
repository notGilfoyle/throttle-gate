import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import * as control from "../api/control";
import type { AlgorithmKey, AlgorithmMeta, ReplayResult } from "../types";

interface Props {
  open: boolean;
  algorithms: AlgorithmMeta[];
  onClose: () => void;
}

const DEFAULT_ALGOS: AlgorithmKey[] = [
  "token_bucket",
  "leaky_bucket",
  "fixed_window",
  "sliding_log",
];

const SAMPLE = `1.1.1.1 - - [10/Oct/2024:13:55:00 +0000] "GET /api/search HTTP/1.1" 200 12
1.1.1.1 - - [10/Oct/2024:13:55:00 +0000] "GET /api/search HTTP/1.1" 200 12
1.1.1.1 - - [10/Oct/2024:13:55:00 +0000] "GET /api/search HTTP/1.1" 200 12
1.1.1.1 - - [10/Oct/2024:13:55:00 +0000] "GET /api/search HTTP/1.1" 200 12
2.2.2.2 - - [10/Oct/2024:13:55:01 +0000] "GET /api/list HTTP/1.1" 200 12
2.2.2.2 - - [10/Oct/2024:13:55:02 +0000] "GET /api/list HTTP/1.1" 200 12
# …or paste your own nginx/Apache access log, or "key,route" CSV lines.`;

/**
 * Access-log replay (M12): paste a real access log, replay it through several
 * algorithms at the original timestamps, and compare what each would have
 * allowed vs. blocked — a zero-deploy way to pick an algorithm for your traffic.
 */
export default function ReplayDrawer({ open, algorithms, onClose }: Props) {
  const [log, setLog] = useState("");
  const [selected, setSelected] = useState<AlgorithmKey[]>(DEFAULT_ALGOS);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ReplayResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const toggle = (k: AlgorithmKey) =>
    setSelected((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      setResult(await control.replayLog({ log, algorithms: selected }));
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  };

  const label = (k: AlgorithmKey) => algorithms.find((a) => a.key === k)?.label ?? k;
  const chartData = result?.results.map((r) => ({ name: label(r.algorithm), allowed: r.allowed, blocked: r.blocked }));

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="flex-1 bg-black/50" onClick={onClose} />
      <div className="flex w-[560px] flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
          <h2 className="text-sm font-semibold text-zinc-200">
            Replay <span className="text-zinc-500">— your log, every algorithm</span>
          </h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">Access log</span>
              <button onClick={() => setLog(SAMPLE)} className="text-[11px] text-sky-400 hover:text-sky-300">
                load sample
              </button>
            </div>
            <textarea
              value={log}
              onChange={(e) => setLog(e.target.value)}
              placeholder="Paste nginx/Apache access log lines, or key,route CSV…"
              spellCheck={false}
              className="h-40 w-full resize-none rounded border border-zinc-700 bg-zinc-950 p-2 font-mono text-[11px] text-zinc-200 placeholder:text-zinc-600"
            />
          </div>

          <div>
            <span className="mb-1.5 block text-[10px] uppercase tracking-wider text-zinc-500">Algorithms</span>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {algorithms.map((a) => (
                <label key={a.key} className="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-300">
                  <input type="checkbox" checked={selected.includes(a.key)} onChange={() => toggle(a.key)} className="accent-sky-500" />
                  {a.label}
                </label>
              ))}
            </div>
          </div>

          <button
            onClick={run}
            disabled={running || !log.trim() || selected.length === 0}
            className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {running ? "Replaying…" : "Run replay"}
          </button>

          {error && <div className="rounded border border-red-900 bg-red-950/60 px-3 py-1.5 text-xs text-red-300">{error}</div>}

          {result && (
            <div className="space-y-3 border-t border-zinc-800 pt-3">
              <div className="text-xs text-zinc-400">
                Parsed <span className="font-mono text-zinc-200">{result.parsed}</span> requests over{" "}
                <span className="font-mono text-zinc-200">{result.span_s}s</span>
                {result.skipped > 0 && <span className="text-zinc-600"> · {result.skipped} skipped</span>}
              </div>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
                    <CartesianGrid stroke="#27272a" vertical={false} />
                    <XAxis dataKey="name" stroke="#52525b" fontSize={10} interval={0} angle={-12} textAnchor="end" height={48} />
                    <YAxis stroke="#52525b" fontSize={11} width={36} allowDecimals={false} />
                    <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6, fontSize: 12 }} labelStyle={{ color: "#a1a1aa" }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="allowed" name="Allowed" stackId="a" fill="#10b981" isAnimationActive={false} />
                    <Bar dataKey="blocked" name="Blocked" stackId="a" fill="#ef4444" isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="rounded border border-sky-900 bg-sky-950/40 p-3 text-xs leading-snug text-sky-200">
                <span className="font-semibold">Recommendation: </span>
                {result.recommendation.replace(/\*\*/g, "")}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
