import { useEffect, useRef, useState } from "react";
import * as control from "./api/control";
import ControlPanel from "./components/ControlPanel";
import RequestStream from "./components/RequestStream";
import StatsPanel from "./components/StatsPanel";
import TokenBucketViz from "./components/visualizers/TokenBucketViz";
import { defaultConfig } from "./state/defaults";
import { StreamStore } from "./state/streamStore";
import { useStream } from "./state/useStream";
import type { AlgorithmMeta, RunConfig } from "./types";

export default function App() {
  const store = useRef(new StreamStore()).current;
  const snapshot = useStream(store);

  const [algorithms, setAlgorithms] = useState<AlgorithmMeta[]>([]);
  const [config, setConfig] = useState<RunConfig | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const activeStats = config ? snapshot.statsByAlgo[config.algorithm] : undefined;
  const tokenLatest = snapshot.latestByAlgo["token_bucket"];

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

        <section className="flex flex-col items-center justify-center overflow-auto p-4">
          {config?.algorithm === "token_bucket" ? (
            <TokenBucketViz latest={tokenLatest} />
          ) : (
            <p className="text-sm text-zinc-600">
              Visualizer for “{config?.algorithm}” arrives in Milestone 3.
            </p>
          )}
        </section>

        <section className="flex flex-col gap-4 overflow-hidden border-l border-zinc-800 p-4">
          <div>
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">Stats</h2>
            <StatsPanel stats={activeStats} rpsIn={snapshot.rpsIn} />
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
              Request stream
            </h2>
            <RequestStream decisions={snapshot.decisions} />
          </div>
        </section>
      </div>
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
