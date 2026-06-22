import type { AlgorithmKey, AlgorithmMeta, Pattern, RunConfig } from "../types";

// Patterns the backend honors today (steady + burst); ramp/spike arrive in M6.
const PATTERNS: { value: Pattern; label: string }[] = [
  { value: "steady", label: "Steady" },
  { value: "burst", label: "Burst" },
];

interface Props {
  algorithms: AlgorithmMeta[];
  config: RunConfig;
  running: boolean;
  onChange: (next: RunConfig) => void;
  onStart: () => void;
  onStop: () => void;
  onReset: () => void;
}

export default function ControlPanel({
  algorithms,
  config,
  running,
  onChange,
  onStart,
  onStop,
  onReset,
}: Props) {
  const active = algorithms.find((a) => a.key === config.algorithm);

  const setParam = (name: string, value: number) =>
    onChange({
      ...config,
      params: {
        ...config.params,
        [config.algorithm]: { ...config.params[config.algorithm], [name]: value },
      },
    });

  return (
    <div className="flex flex-col gap-5">
      <Field label="Algorithm">
        <select
          className="select"
          value={config.algorithm}
          onChange={(e) => onChange({ ...config, algorithm: e.target.value as AlgorithmKey })}
        >
          {algorithms.map((a) => (
            <option key={a.key} value={a.key}>
              {a.label}
            </option>
          ))}
        </select>
        {active && <p className="mt-1.5 text-xs leading-snug text-zinc-500">{active.description}</p>}
      </Field>

      {active?.params.map((p) => (
        <Slider
          key={p.name}
          label={p.label}
          min={p.min}
          max={p.max}
          step={p.step}
          value={config.params[config.algorithm]?.[p.name] ?? p.default}
          onChange={(v) => setParam(p.name, v)}
        />
      ))}

      <hr className="border-zinc-800" />

      <Slider
        label="Target RPS"
        min={1}
        max={200}
        step={1}
        value={config.rps}
        onChange={(v) => onChange({ ...config, rps: v })}
      />

      <Field label="Traffic pattern">
        <div className="grid grid-cols-2 gap-2">
          {PATTERNS.map((p) => (
            <button
              key={p.value}
              onClick={() => onChange({ ...config, pattern: p.value })}
              className={`rounded border px-2 py-1.5 text-sm ${
                config.pattern === p.value
                  ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                  : "border-zinc-700 text-zinc-300 hover:border-zinc-600"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </Field>

      <Slider
        label="Clients"
        min={1}
        max={8}
        step={1}
        value={config.client_count}
        onChange={(v) => onChange({ ...config, client_count: v })}
      />

      <div className="mt-1 flex flex-col gap-2">
        {running ? (
          <button onClick={onStop} className="btn bg-amber-600 hover:bg-amber-500">
            Stop
          </button>
        ) : (
          <button onClick={onStart} className="btn bg-emerald-600 hover:bg-emerald-500">
            Start
          </button>
        )}
        <button
          onClick={onReset}
          className="btn border border-zinc-700 bg-transparent text-zinc-300 hover:border-zinc-600"
        >
          Reset
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-zinc-500">
        {label}
      </span>
      {children}
    </label>
  );
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">{label}</span>
        <span className="font-mono text-sm text-zinc-200">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-emerald-500"
      />
    </label>
  );
}
