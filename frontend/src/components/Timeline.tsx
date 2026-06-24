import {
  CartesianGrid,
  Line,
  LineChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { StatsPoint } from "../state/streamStore";
import type { AlgorithmKey } from "../types";

const COLORS: Record<AlgorithmKey, string> = {
  token_bucket: "#10b981",
  leaky_bucket: "#38bdf8",
  fixed_window: "#f59e0b",
  sliding_log: "#a78bfa",
  sliding_counter: "#f472b6",
  gcra: "#22d3ee",
  concurrency: "#fb923c",
};

const SHORT: Record<AlgorithmKey, string> = {
  token_bucket: "Token",
  leaky_bucket: "Leaky",
  fixed_window: "Fixed",
  sliding_log: "Sld Log",
  sliding_counter: "Sld Cnt",
  gcra: "GCRA",
  concurrency: "Concurrency",
};

interface Props {
  history: StatsPoint[];
  algorithms: AlgorithmKey[];
}

/**
 * Throughput-over-time overlay (PRD §8.1/§8.3 timeline). One line per active
 * algorithm (allowed/s) plus the incoming RPS, so divergence between algorithms
 * on the same stream is visible at a glance.
 */
export default function Timeline({ history, algorithms }: Props) {
  if (history.length < 2) {
    return <p className="px-2 text-sm text-zinc-600">Throughput timeline appears once a run is streaming.</p>;
  }

  const t0 = history[0].t;
  const data = history.map((p) => ({
    t: Number((p.t - t0).toFixed(1)),
    rpsIn: p.rpsIn,
    ...p.throughputByAlgo,
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: -8 }}>
        <CartesianGrid stroke="#27272a" vertical={false} />
        <XAxis dataKey="t" stroke="#52525b" fontSize={11} tickFormatter={(v) => `${v}s`} minTickGap={28} />
        <YAxis stroke="#52525b" fontSize={11} width={36} allowDecimals={false} />
        <Tooltip
          contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6, fontSize: 12 }}
          labelStyle={{ color: "#a1a1aa" }}
          labelFormatter={(v) => `t = ${v}s`}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Line
          type="monotone"
          dataKey="rpsIn"
          name="RPS in"
          stroke="#71717a"
          strokeDasharray="4 3"
          dot={false}
          isAnimationActive={false}
        />
        {algorithms.map((a) => (
          <Line
            key={a}
            type="monotone"
            dataKey={a}
            name={`${SHORT[a]} (allow/s)`}
            stroke={COLORS[a]}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
