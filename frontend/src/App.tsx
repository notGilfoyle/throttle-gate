import { useEffect, useRef, useState } from "react";
import * as control from "./api/control";
import ControlPanel from "./components/ControlPanel";
import RequestStream from "./components/RequestStream";
import DistributedPanel from "./components/DistributedPanel";
import RequestInspector from "./components/RequestInspector";
import StatsPanel from "./components/StatsPanel";
import Timeline from "./components/Timeline";
import Visualizer from "./components/visualizers";
import { defaultConfig } from "./state/defaults";
import { StreamStore } from "./state/streamStore";
import { useStream } from "./state/useStream";
import type { AlgorithmKey, AlgorithmMeta, DecisionEvent, RunConfig } from "./types";

export default function App() {
  const store = useRef(new StreamStore()).current;
  const snapshot = useStream(store);

  const [algorithms, setAlgorithms] = useState<AlgorithmMeta[]>([]);
  const [config, setConfig] = useState<RunConfig | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<DecisionEvent | null>(null);

  const running = sessionId !== null;

  // Load algorithm metadata once; seed the default config from it.
  useEffect(() => {
    control
      .getAlgorithms()
      .then((algos) => {
        setAlgorithms(algos);
        setConfig(defaultConfig(algos));
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => () => store.disconnect(), [store]);

  const onChange = (next: RunConfig) => {
    setConfig(next);
    if (sessionId) control.patchConfig(sessionId, next).catch((e) => setError(String(e)));
  };

  const onStart = async () => {
    if (!config) return;
    setError(null);
    try {
      const { session_id } = await control.startSession(config);
      setSessionId(session_id);
      store.connect(session_id);
    } catch (e) {
      setError(String(e));
    }
  };

  const onStop = async () => {
    if (!sessionId) return;
    try {
      await control.stopSession(sessionId);
    } catch (e) {
      setError(String(e));
    }
    store.disconnect();
    setSessionId(null);
  };

  const onReset = async () => {
    store.disconnect();
    setSessionId(null);
    try {
      await control.resetSession();
    } catch (e) {
      setError(String(e));
    }
  };

  // `compare` (>= 2) takes precedence over the single algorithm (matches backend).
  const activeAlgorithms: AlgorithmKey[] = config
    ? config.compare.length >= 2
      ? config.compare
      : [config.algorithm]
    : [];
  const compareMode = activeAlgorithms.length >= 2;

  return (
    <div className="flex h-full flex-col bg-zinc-950 text-zinc-100">
      <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <h1 className="text-lg font-semibold tracking-tight">
          Throttle-Gate <span className="text-zinc-500">— Rate Limiting Visualizer</span>
        </h1>
        <ConnBadge status={running ? snapshot.status : "idle"} workerId={snapshot.workerId} />
      </header>

      {error && (
        <div className="border-b border-red-900 bg-red-950/60 px-4 py-1.5 text-xs text-red-300">
          {error}
        </div>
      )}

      <div className="grid flex-1 grid-cols-[280px_1fr_340px] overflow-hidden">
        <section className="overflow-y-auto border-r border-zinc-800 p-4">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-500">
            Control Panel
          </h2>
          {config ? (
            <ControlPanel
              algorithms={algorithms}
              config={config}
              running={running}
              onChange={onChange}
              onStart={onStart}
              onStop={onStop}
              onReset={onReset}
            />
          ) : (
            <p className="text-sm text-zinc-600">Loading algorithms…</p>
          )}
        </section>

        <section className="flex flex-col items-center justify-center gap-6 overflow-auto p-4">
          {config?.distributed.enabled && (
            <DistributedPanel
              config={config}
              algorithm={activeAlgorithms[0]}
              observed={snapshot.statsByAlgo[activeAlgorithms[0]]?.throughput ?? 0}
              decisions={snapshot.decisions}
            />
          )}
          <div className="flex flex-row flex-wrap items-center justify-center gap-6">
          {activeAlgorithms.map((algo) => (
            <div key={algo} className="flex flex-col items-center gap-2">
              {compareMode && (
                <h3 className="text-sm font-semibold text-zinc-300">
                  {algorithms.find((a) => a.key === algo)?.label ?? algo}
                </h3>
              )}
              <Visualizer algorithm={algo} latest={snapshot.latestByAlgo[algo]} />
            </div>
          ))}
          </div>
        </section>

        <section className="flex flex-col gap-4 overflow-hidden border-l border-zinc-800 p-4">
          <div>
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">Stats</h2>
            {compareMode ? (
              <CompareStats
                algorithms={activeAlgorithms}
                statsByAlgo={snapshot.statsByAlgo}
                labels={algorithms}
                rpsIn={snapshot.rpsIn}
              />
            ) : (
              <StatsPanel stats={snapshot.statsByAlgo[activeAlgorithms[0]]} rpsIn={snapshot.rpsIn} />
            )}
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
              Request stream
            </h2>
            <RequestStream
              decisions={snapshot.decisions}
              clientCount={config?.client_count ?? 1}
              onSelect={setSelected}
            />
          </div>
        </section>
      </div>

      <RequestInspector
        decision={selected}
        algorithms={algorithms}
        onClose={() => setSelected(null)}
      />

      <div className="h-[180px] border-t border-zinc-800 px-4 py-2">
        <h2 className="mb-1 text-xs font-medium uppercase tracking-wider text-zinc-500">
          Throughput timeline
        </h2>
        <div className="h-[140px]">
          <Timeline history={snapshot.statsHistory} algorithms={activeAlgorithms} />
        </div>
      </div>
    </div>
  );
}

function CompareStats({
  algorithms,
  statsByAlgo,
  labels,
  rpsIn,
}: {
  algorithms: AlgorithmKey[];
  statsByAlgo: Record<string, { allowed: number; rejected: number; allow_pct: number; throughput: number }>;
  labels: AlgorithmMeta[];
  rpsIn: number;
}) {
  return (
    <div className="flex flex-col gap-1 text-xs">
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 px-1 text-[10px] uppercase tracking-wider text-zinc-500">
        <span>Algorithm</span>
        <span className="text-right">Allow</span>
        <span className="text-right">Rej</span>
        <span className="text-right">Thru</span>
      </div>
      {algorithms.map((algo) => {
        const s = statsByAlgo[algo];
        return (
          <div key={algo} className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 rounded border border-zinc-800 bg-zinc-900/50 px-1 py-1 font-mono">
            <span className="truncate text-zinc-300">{labels.find((l) => l.key === algo)?.label ?? algo}</span>
            <span className="text-right text-emerald-400">{s?.allowed ?? 0}</span>
            <span className="text-right text-red-400">{s?.rejected ?? 0}</span>
            <span className="text-right text-zinc-200">{(s?.throughput ?? 0).toFixed(1)}</span>
          </div>
        );
      })}
      <div className="px-1 pt-1 font-mono text-[11px] text-zinc-500">RPS in: {rpsIn.toFixed(1)}</div>
    </div>
  );
}

function ConnBadge({ status, workerId }: { status: string; workerId: string | null }) {
  const color =
    status === "open"
      ? "bg-emerald-500"
      : status === "connecting" || status === "reconnecting"
        ? "bg-amber-500"
        : status === "idle"
          ? "bg-zinc-600"
          : "bg-red-500";
  return (
    <div className="flex items-center gap-2 text-xs text-zinc-400">
      <span className={`inline-block h-2 w-2 rounded-full ${color}`} />
      {status}
      {workerId && <span className="text-zinc-600">· worker {workerId}</span>}
    </div>
  );
}
