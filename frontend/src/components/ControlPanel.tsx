import type { AlgorithmKey, AlgorithmMeta, Pattern, RunConfig } from "../types";

const PATTERNS: { value: Pattern; label: string }[] = [
  { value: "steady", label: "Steady" },
  { value: "burst", label: "Burst" },
  { value: "ramp", label: "Ramp" },
  { value: "spike", label: "Spike" },
];

interface Props {
  algorithms: AlgorithmMeta[];
  config: RunConfig;
  running: boolean;
  // Live mode (M7): real traffic drives the limiter, so the synthetic-traffic
  // controls (compare, RPS, pattern, clients, distributed, start/stop) are hidden
  // and only the algorithm + its params are tunable — applied live.
  live?: boolean;
  onChange: (next: RunConfig) => void;
  onStart: () => void;
  onStop: () => void;
  onReset: () => void;
}

export default function ControlPanel({
  algorithms,
  config,
  running,
  live = false,
  onChange,
  onStart,
  onStop,
  onReset,
}: Props) {
  const active = algorithms.find((a) => a.key === config.algorithm);
  const compareMode = config.compare.length >= 2;

  const setParam = (name: string, value: number) =>
    onChange({
      ...config,
      params: {
        ...config.params,
        [config.algorithm]: { ...config.params[config.algorithm], [name]: value },
      },
    });

  const toggleCompare = (on: boolean) => {
    if (on) {
      // Seed with the current algorithm plus one more distinct algorithm.
      const second = algorithms.find((a) => a.key !== config.algorithm)?.key;
      onChange({ ...config, compare: second ? [config.algorithm, second] : [] });
    } else {
      onChange({ ...config, compare: [] });
    }
  };

  const toggleAlgo = (key: AlgorithmKey) => {
    const has = config.compare.includes(key);
    const next = has ? config.compare.filter((k) => k !== key) : [...config.compare, key];
    onChange({ ...config, compare: next });
  };

  return (
    <div className="flex flex-col gap-5">
      {!live && (
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => toggleCompare(false)}
          className={`rounded border px-2 py-1.5 text-sm ${
            !compareMode
              ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
              : "border-zinc-700 text-zinc-300 hover:border-zinc-600"
          }`}
        >
          Single
        </button>
        <button
          onClick={() => toggleCompare(true)}
          className={`rounded border px-2 py-1.5 text-sm ${
            compareMode
              ? "border-sky-500 bg-sky-500/10 text-sky-300"
              : "border-zinc-700 text-zinc-300 hover:border-zinc-600"
          }`}
        >
          Compare
        </button>
      </div>
      )}

      {compareMode ? (
        <div>
          <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-zinc-500">
            Algorithms to compare
          </span>
          <div className="flex flex-col gap-1.5">
            {algorithms.map((a) => {
              const checked = config.compare.includes(a.key);
              return (
                <label key={a.key} className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleAlgo(a.key)}
                    className="accent-sky-500"
                  />
                  {a.label}
                </label>
              );
            })}
          </div>
          {config.compare.length < 2 && (
            <p className="mt-1.5 text-xs text-amber-400/80">Pick at least two.</p>
          )}
        </div>
      ) : (
        <>
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
        </>
      )}

      {!live && (
      <>
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

      <hr className="border-zinc-800" />

      <div>
        <label className="flex cursor-pointer items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            Distributed
          </span>
          <input
            type="checkbox"
            checked={config.distributed.enabled}
            onChange={(e) =>
              onChange({ ...config, distributed: { ...config.distributed, enabled: e.target.checked } })
            }
            className="accent-sky-500"
          />
        </label>

        {config.distributed.enabled && (
          <div className="mt-3 flex flex-col gap-3">
            <Slider
              label="Replicas"
              min={2}
              max={4}
              step={1}
              value={config.distributed.replicas}
              onChange={(v) =>
                onChange({ ...config, distributed: { ...config.distributed, replicas: v } })
              }
            />
            <div className="grid grid-cols-2 gap-2">
              {(["shared", "local"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() =>
                    onChange({ ...config, distributed: { ...config.distributed, mode: m } })
                  }
                  className={`rounded border px-2 py-1.5 text-xs ${
                    config.distributed.mode === m
                      ? m === "shared"
                        ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                        : "border-red-500 bg-red-500/10 text-red-300"
                      : "border-zinc-700 text-zinc-300 hover:border-zinc-600"
                  }`}
                >
                  {m === "shared" ? "Shared Redis" : "Local memory"}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

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
      </>
      )}
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
