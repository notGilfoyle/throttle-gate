import { useEffect, useState } from "react";
import type { AlgoLatest } from "../../state/streamStore";
import type { ConcurrencyState } from "../../types";

interface Props {
  latest: AlgoLatest | undefined;
}

const MAX_SLOTS = 60; // cap the grid; very large limits fall back to a bar

/**
 * Concurrency limiter (M11): a row of slots for the `limit` in-flight budget.
 * Each occupied slot is a held lease; the grid fills as concurrent requests are
 * admitted and empties as their leases expire (state arrives per decision). A
 * rejected request — the budget is full — flashes the grid red.
 */
export default function ConcurrencyViz({ latest }: Props) {
  const s = latest?.state as unknown as ConcurrencyState | undefined;
  const limit = s?.limit ?? 5;
  const active = s?.active ?? 0;
  const ttl = s?.lease_ttl_s ?? 1;

  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (latest && !latest.allowed) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 280);
      return () => clearTimeout(t);
    }
  }, [latest]);

  const shown = Math.min(limit, MAX_SLOTS);
  const slots = Array.from({ length: shown });

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        className={`flex flex-col items-center gap-3 rounded-lg border p-5 transition-colors ${
          flash ? "border-red-500 bg-red-500/10" : "border-zinc-800 bg-zinc-900/40"
        }`}
      >
        <div className="text-center">
          <span className="font-mono text-4xl text-zinc-100">{s ? active : "—"}</span>
          <span className="font-mono text-lg text-zinc-500"> / {limit}</span>
          <div className="text-[11px] uppercase tracking-wider text-zinc-500">in flight</div>
        </div>
        <div className="grid max-w-[260px] gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(shown, 10)}, 1fr)` }}>
          {slots.map((_, i) => (
            <div
              key={i}
              className={`h-5 w-5 rounded ${
                i < active ? "bg-sky-500" : "border border-zinc-700 bg-zinc-950"
              }`}
            />
          ))}
        </div>
        {limit > MAX_SLOTS && (
          <div className="text-[11px] text-zinc-600">showing {MAX_SLOTS} of {limit} slots</div>
        )}
      </div>
      <p className="max-w-xs text-center text-xs text-zinc-500">
        Caps <span className="text-zinc-300">{limit}</span> simultaneous requests (not a rate). Each
        leases a slot for up to <span className="text-zinc-300">{ttl}s</span>; slots free when the
        lease expires. Full budget → reject.
      </p>
    </div>
  );
}
