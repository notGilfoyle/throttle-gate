import type { DecisionEvent } from "../types";

interface Props {
  decisions: DecisionEvent[];
  clientCount: number;
  onSelect?: (d: DecisionEvent) => void;
}

// Per-client accent colors (left border), so per-key limiting is visible.
const CLIENT_COLORS = [
  "#38bdf8",
  "#f472b6",
  "#a78bfa",
  "#fbbf24",
  "#34d399",
  "#fb7185",
  "#22d3ee",
  "#c084fc",
];

function clientIndex(clientId: string): number {
  const n = Number(clientId.split("-")[1]);
  return Number.isFinite(n) ? n - 1 : 0;
}

/**
 * Fast scrolling grid of recent requests as colored chips (PRD §8.1).
 * Green = allowed, red = rejected. With multiple clients each chip carries a
 * per-client accent border so per-key limiting is visible. Click → inspector.
 */
export default function RequestStream({ decisions, clientCount, onSelect }: Props) {
  const showClients = clientCount > 1;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {showClients && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-zinc-500">
          {Array.from({ length: clientCount }).map((_, i) => (
            <span key={i} className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ background: CLIENT_COLORS[i % CLIENT_COLORS.length] }} />
              client-{i + 1}
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap content-start gap-1 overflow-y-auto">
        {decisions.length === 0 && (
          <p className="text-sm text-zinc-600">No requests yet — press Start.</p>
        )}
        {decisions.map((d) => {
          const allowed = d.results.every((r) => r.allowed);
          const accent = showClients
            ? { borderLeft: `3px solid ${CLIENT_COLORS[clientIndex(d.client_id) % CLIENT_COLORS.length]}` }
            : undefined;
          return (
            <button
              key={d.request_id}
              title={`${d.request_id} · ${d.client_id} · ${allowed ? "200" : "429"}`}
              onClick={() => onSelect?.(d)}
              style={accent}
              className={`h-4 w-4 rounded-sm transition-colors ${
                allowed ? "bg-emerald-500/80 hover:bg-emerald-400" : "bg-red-500/80 hover:bg-red-400"
              }`}
            />
          );
        })}
      </div>
    </div>
  );
}
