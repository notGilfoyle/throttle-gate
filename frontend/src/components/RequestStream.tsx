import type { DecisionEvent } from "../types";

interface Props {
  decisions: DecisionEvent[];
  onSelect?: (d: DecisionEvent) => void;
}

/**
 * Fast scrolling grid of recent requests as colored chips (PRD §8.1).
 * Green = allowed, red = rejected. In single mode each chip reflects its one
 * result; click → Request Inspector (M6).
 */
export default function RequestStream({ decisions, onSelect }: Props) {
  return (
    <div className="flex flex-wrap content-start gap-1 overflow-y-auto">
      {decisions.length === 0 && (
        <p className="text-sm text-zinc-600">No requests yet — press Start.</p>
      )}
      {decisions.map((d) => {
        const allowed = d.results.every((r) => r.allowed);
        return (
          <button
            key={d.request_id}
            title={`${d.request_id} · ${d.client_id} · ${allowed ? "200" : "429"}`}
            onClick={() => onSelect?.(d)}
            className={`h-4 w-4 rounded-sm transition-colors ${
              allowed ? "bg-emerald-500/80 hover:bg-emerald-400" : "bg-red-500/80 hover:bg-red-400"
            }`}
          />
        );
      })}
    </div>
  );
}
