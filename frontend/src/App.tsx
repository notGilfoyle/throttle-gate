import { useEffect, useRef, useState } from "react";
import * as control from "./api/control";
import ControlPanel from "./components/ControlPanel";
import RequestStream from "./components/RequestStream";
import DistributedPanel from "./components/DistributedPanel";
import PolicyEditor from "./components/PolicyEditor";
import RequestInspector from "./components/RequestInspector";
import StatsPanel from "./components/StatsPanel";
import Timeline from "./components/Timeline";
import Visualizer from "./components/visualizers";
import { defaultConfig } from "./state/defaults";
import { StreamStore } from "./state/streamStore";
import { useStream } from "./state/useStream";
import type { AlgorithmKey, AlgorithmMeta, DecisionEvent, Policy, RunConfig } from "./types";

export default function App() {
  const store = useRef(new StreamStore()).current;
  const snapshot = useStream(store);

  const [algorithms, setAlgorithms] = useState<AlgorithmMeta[]>([]);
  const [config, setConfig] = useState<RunConfig | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<DecisionEvent | null>(null);
  // "simulate" = synthetic load generator (v1); "live" = real /v1/check traffic (M7).
  const [mode, setMode] = useState<"simulate" | "live">("simulate");
  const [liveSessionId, setLiveSessionId] = useState<string | null>(null);
  // Live-traffic policy (M9) + the editor drawer.
  const [policy, setPolicy] = useState<Policy>({ rules: [], overrides: {} });
  const [policyOpen, setPolicyOpen] = useState(false);
  // Engine fail-open setting (M8): admit vs reject 503 when the store is down.
  const [failOpen, setFailOpen] = useState(true);

  const live = mode === "live";
  const running = live ? liveSessionId !== null : sessionId !== null;
  // The session the store/config writes target right now.
  const activeSessionId = live ? liveSessionId : sessionId;

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
    if (activeSessionId) control.patchConfig(activeSessionId, next).catch((e) => setError(String(e)));
  };

  // Switch between synthetic (simulate) and real-traffic (live) modes.
  const switchMode = async (next: "simulate" | "live") => {
    if (next === mode) return;
    setError(null);
    store.disconnect();
    setSessionId(null);
    if (next === "live") {
      try {
        const [{ session_id, config: liveConfig }, livePolicy, settings] = await Promise.all([
          control.getLive(),
          control.getPolicy(),
          control.getSettings(),
        ]);
        setLiveSessionId(session_id);
        setConfig(liveConfig); // reflect the limiter the server is actually using
        setPolicy(livePolicy);
        setFailOpen(settings.fail_open);
        setMode("live");
        store.connect(session_id);
      } catch (e) {
        setError(String(e));
      }
    } else {
      setLiveSessionId(null);
      setConfig(defaultConfig(algorithms));
      setMode("simulate");
    }
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
        <div className="flex items-center gap-4">
          <div className="flex rounded border border-zinc-700 p-0.5 text-xs">
            {(["simulate", "live"] as const).map((m) => (
              <button
                key={m}
                onClick={() => switchMode(m)}
                className={`rounded px-2.5 py-1 capitalize ${
                  mode === m ? "bg-zinc-700 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {m === "live" ? "Live traffic" : "Simulate"}
              </button>
            ))}
          </div>
          {live && (
            <>
              <button
                onClick={async () => {
                  const next = !failOpen;
                  setFailOpen(next);
                  try {
                    await control.putSettings({ fail_open: next });
                  } catch (e) {
                    setFailOpen(!next);
                    setError(String(e));
                  }
                }}
                title="Behavior when the limiter store (Redis) is unreachable"
                className={`rounded border px-2.5 py-1 text-xs ${
                  failOpen
                    ? "border-amber-600/60 text-amber-300"
                    : "border-red-600/60 text-red-300"
                }`}
              >
                Fail {failOpen ? "open" : "closed"}
              </button>
              <button
                onClick={() => setPolicyOpen(true)}
                className="rounded border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:border-zinc-600"
              >
                Policies{policy.rules.length > 0 && ` (${policy.rules.length})`}
              </button>
            </>
          )}
          <ConnBadge status={running ? snapshot.status : "idle"} workerId={snapshot.workerId} />
        </div>
      </header>

      {error && (
        <div className="border-b border-red-900 bg-red-950/60 px-4 py-1.5 text-xs text-red-300">
          {error}
        </div>
      )}

      {live && (
        <div className="border-b border-sky-900 bg-sky-950/40 px-4 py-1.5 text-xs text-sky-200">
          Live mode — point your server at the decision API. Try it:{" "}
          <code className="rounded bg-sky-950 px-1.5 py-0.5 font-mono text-sky-300">
            curl -X POST localhost:8000/v1/check -H 'content-type: application/json' -d
            '{`{"key":"user-42","route":"/api"}`}'
          </code>
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
              live={live}
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
              clientCount={live ? 8 : config?.client_count ?? 1}
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

      <PolicyEditor
        open={policyOpen}
        algorithms={algorithms}
        policy={policy}
        onClose={() => setPolicyOpen(false)}
        onSave={async (next) => {
          const saved = await control.putPolicy(next);
          setPolicy(saved);
        }}
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
