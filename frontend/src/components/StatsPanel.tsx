import type { AlgoStats } from "../types";

interface Props {
  stats: AlgoStats | undefined;
  rpsIn: number;
}

/** Aggregate snapshot for the active algorithm (PRD §8.1 stats panel). */
export default function StatsPanel({ stats, rpsIn }: Props) {
  const allowed = stats?.allowed ?? 0;
  const rejected = stats?.rejected ?? 0;
  const allowPct = stats?.allow_pct ?? 0;
  const throughput = stats?.throughput ?? 0;

  return (
    <div className="grid grid-cols-2 gap-2">
      <Stat label="Allowed" value={allowed} className="text-emerald-400" />
      <Stat label="Rejected" value={rejected} className="text-red-400" />
      <Stat label="Allow %" value={`${allowPct.toFixed(1)}%`} />
      <Stat label="Throughput" value={`${throughput.toFixed(1)}/s`} />
      <Stat label="RPS in" value={rpsIn.toFixed(1)} />
    </div>
  );
}

function Stat({
  label,
  value,
  className = "text-zinc-100",
}: {
  label: string;
  value: number | string;
  className?: string;
}) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900/50 px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`font-mono text-lg ${className}`}>{value}</div>
    </div>
  );
}
