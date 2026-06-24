import type { TopKey } from "../types";

/** Top talkers / throttled keys for live traffic (M10) — the "who's being
 * throttled" ops view, fed from the SSE stats event. */
export default function TopKeys({ keys }: { keys: TopKey[] }) {
  if (keys.length === 0) {
    return <p className="text-xs text-zinc-600">No live traffic yet.</p>;
  }
  const max = Math.max(1, ...keys.map((k) => k.allowed + k.rejected));
  return (
    <div className="flex flex-col gap-1 text-xs">
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 px-1 text-[10px] uppercase tracking-wider text-zinc-500">
        <span>Key</span>
        <span className="text-right">OK</span>
        <span className="text-right">429</span>
      </div>
      {keys.map((k) => {
        const total = k.allowed + k.rejected;
        const rejPct = total ? (100 * k.rejected) / total : 0;
        return (
          <div key={k.key} className="rounded border border-zinc-800 bg-zinc-900/50 px-1 py-1">
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 font-mono">
              <span className="truncate text-zinc-300" title={k.key}>{k.key}</span>
              <span className="text-right text-emerald-400">{k.allowed}</span>
              <span className="text-right text-red-400">{k.rejected}</span>
            </div>
            {/* allowed/throttled split bar, width scaled to the busiest key */}
            <div className="mt-1 flex h-1 overflow-hidden rounded bg-zinc-800" style={{ width: `${(100 * total) / max}%` }}>
              <div className="bg-emerald-500/70" style={{ width: `${100 - rejPct}%` }} />
              <div className="bg-red-500/70" style={{ width: `${rejPct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
