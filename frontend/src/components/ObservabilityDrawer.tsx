import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import * as control from "../api/control";
import type { AlertConfig, HistoryPoint } from "../types";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Observability drawer (M10): persisted traffic history (allowed vs throttled
 * over time, from GET /v1/history) plus the per-key throttle alert config.
 */
export default function ObservabilityDrawer({ open, onClose }: Props) {
  const [points, setPoints] = useState<HistoryPoint[]>([]);
  const [alerts, setAlerts] = useState<AlertConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load history (polled) + alert config while the drawer is open.
  useEffect(() => {
    if (!open) return;
    let active = true;
    const load = () =>
      control
        .getHistory(30)
        .then((h) => active && setPoints(h.points))
        .catch((e) => active && setError(String(e)));
    load();
    control.getAlerts().then((a) => active && setAlerts(a)).catch(() => {});
    const id = window.setInterval(load, 5000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [open]);

  if (!open) return null;

  const data = points.map((p) => ({
    t: new Date(p.t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    allowed: p.allowed,
    rejected: p.rejected,
  }));

  const saveAlerts = async () => {
    if (!alerts) return;
    setSaving(true);
    setError(null);
    try {
      setAlerts(await control.putAlerts(alerts));
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="flex-1 bg-black/50" onClick={onClose} />
      <div className="flex w-[560px] flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
          <h2 className="text-sm font-semibold text-zinc-200">
            Observability <span className="text-zinc-500">— last 30 min</span>
          </h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
              Traffic history
            </h3>
            {data.length < 2 ? (
              <p className="text-sm text-zinc-600">
                Collecting samples… history appears after a few seconds of live traffic.
              </p>
            ) : (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
                    <CartesianGrid stroke="#27272a" vertical={false} />
                    <XAxis dataKey="t" stroke="#52525b" fontSize={10} minTickGap={48} />
                    <YAxis stroke="#52525b" fontSize={11} width={36} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6, fontSize: 12 }}
                      labelStyle={{ color: "#a1a1aa" }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Area type="monotone" dataKey="allowed" name="Allowed" stackId="1" stroke="#10b981" fill="#10b98133" isAnimationActive={false} />
                    <Area type="monotone" dataKey="rejected" name="Throttled" stackId="1" stroke="#ef4444" fill="#ef444433" isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="border-t border-zinc-800 pt-4">
            <h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-zinc-500">
              Throttle alerts
            </h3>
            <p className="mb-3 text-[11px] leading-snug text-zinc-600">
              POST a webhook when one key is throttled more than the threshold within the window.
              Set threshold to 0 to disable.
            </p>
            {alerts && (
              <div className="space-y-3">
                <label className="block">
                  <span className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">Webhook URL</span>
                  <input
                    value={alerts.webhook_url ?? ""}
                    placeholder="https://hooks.example.com/…"
                    onChange={(e) => setAlerts({ ...alerts, webhook_url: e.target.value || null })}
                    className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-xs text-zinc-200 placeholder:text-zinc-600"
                  />
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <NumField label="Threshold" value={alerts.throttle_threshold} min={0} step={1}
                    onChange={(v) => setAlerts({ ...alerts, throttle_threshold: v })} />
                  <NumField label="Window (s)" value={alerts.window_s} min={1} step={1}
                    onChange={(v) => setAlerts({ ...alerts, window_s: v })} />
                  <NumField label="Cooldown (s)" value={alerts.cooldown_s} min={0} step={1}
                    onChange={(v) => setAlerts({ ...alerts, cooldown_s: v })} />
                </div>
                <button
                  onClick={saveAlerts}
                  disabled={saving}
                  className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save alerts"}
                </button>
              </div>
            )}
          </div>

          <p className="text-[11px] text-zinc-600">
            Prometheus scrape: <code className="rounded bg-zinc-900 px-1 py-0.5 font-mono text-zinc-400">GET /metrics</code>
          </p>
        </div>

        {error && (
          <div className="border-t border-red-900 bg-red-950/60 px-4 py-1.5 text-xs text-red-300">{error}</div>
        )}
      </div>
    </div>
  );
}

function NumField({ label, value, min, step, onChange }: { label: string; value: number; min?: number; step?: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-xs text-zinc-200"
      />
    </label>
  );
}
