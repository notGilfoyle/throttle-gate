import { useEffect, useState } from "react";
import type { AlgorithmKey, AlgorithmMeta, Policy, PolicyRule } from "../types";

interface Props {
  open: boolean;
  algorithms: AlgorithmMeta[];
  policy: Policy;
  onClose: () => void;
  onSave: (policy: Policy) => Promise<void>;
}

const emptyRule = (): PolicyRule => ({
  name: "rule",
  match: {},
  deny: false,
  algorithm: null,
  params: null,
  cost: 1,
});

// comma-separated text ⇄ string[] (null/undefined when empty = "match any").
const toList = (s: string): string[] | null => {
  const parts = s.split(",").map((x) => x.trim()).filter(Boolean);
  return parts.length ? parts : null;
};
const fromList = (l?: string[] | null): string => (l ?? []).join(", ");

/**
 * Slide-over editor for the live-traffic policy (M9). Authors an ordered list of
 * rules (first match wins) — each matching on route/methods/keys and choosing an
 * algorithm + params + cost, or hard-denying. Saves via PUT /v1/policy.
 */
export default function PolicyEditor({ open, algorithms, policy, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<Policy>(policy);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed the draft each time the drawer opens.
  useEffect(() => {
    if (open) {
      setDraft(structuredClone(policy));
      setError(null);
    }
  }, [open, policy]);

  if (!open) return null;

  const setRule = (i: number, next: PolicyRule) =>
    setDraft({ rules: draft.rules.map((r, j) => (j === i ? next : r)) });
  const addRule = () => setDraft({ rules: [...draft.rules, emptyRule()] });
  const removeRule = (i: number) => setDraft({ rules: draft.rules.filter((_, j) => j !== i) });
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= draft.rules.length) return;
    const rules = [...draft.rules];
    [rules[i], rules[j]] = [rules[j], rules[i]];
    setDraft({ rules });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="flex-1 bg-black/50" onClick={onClose} />
      <div className="flex w-[520px] flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
          <h2 className="text-sm font-semibold text-zinc-200">
            Policy <span className="text-zinc-500">— first match wins</span>
          </h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {draft.rules.length === 0 && (
            <p className="text-sm text-zinc-600">
              No rules — all live traffic uses the default limiter. Add a rule to vary limits by
              route, method, or key.
            </p>
          )}
          {draft.rules.map((rule, i) => (
            <RuleCard
              key={i}
              rule={rule}
              index={i}
              count={draft.rules.length}
              algorithms={algorithms}
              onChange={(next) => setRule(i, next)}
              onRemove={() => removeRule(i)}
              onMove={(dir) => move(i, dir)}
            />
          ))}
          <button
            onClick={addRule}
            className="w-full rounded border border-dashed border-zinc-700 py-2 text-sm text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
          >
            + Add rule
          </button>
        </div>

        {error && (
          <div className="border-t border-red-900 bg-red-950/60 px-4 py-1.5 text-xs text-red-300">
            {error}
          </div>
        )}
        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-4 py-3">
          <button
            onClick={onClose}
            className="rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:border-zinc-600"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save policy"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RuleCard({
  rule,
  index,
  count,
  algorithms,
  onChange,
  onRemove,
  onMove,
}: {
  rule: PolicyRule;
  index: number;
  count: number;
  algorithms: AlgorithmMeta[];
  onChange: (r: PolicyRule) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const meta = algorithms.find((a) => a.key === rule.algorithm);

  const setAlgorithm = (value: string) => {
    if (value === "") return onChange({ ...rule, algorithm: null, params: null });
    const algo = value as AlgorithmKey;
    const m = algorithms.find((a) => a.key === algo);
    const params = Object.fromEntries(m?.params.map((p) => [p.name, p.default]) ?? []);
    onChange({ ...rule, algorithm: algo, params });
  };

  return (
    <div className="rounded border border-zinc-800 bg-zinc-900/50 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono text-[10px] text-zinc-600">#{index + 1}</span>
        <input
          value={rule.name}
          onChange={(e) => onChange({ ...rule, name: e.target.value })}
          className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-xs text-zinc-200"
          placeholder="rule name"
        />
        <button onClick={() => onMove(-1)} disabled={index === 0} className="px-1 text-zinc-500 hover:text-zinc-200 disabled:opacity-30" aria-label="Move up">↑</button>
        <button onClick={() => onMove(1)} disabled={index === count - 1} className="px-1 text-zinc-500 hover:text-zinc-200 disabled:opacity-30" aria-label="Move down">↓</button>
        <button onClick={onRemove} className="px-1 text-zinc-500 hover:text-red-400" aria-label="Remove">✕</button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <LabeledInput label="Route" value={rule.match.route ?? ""} placeholder="/api/*"
          onChange={(v) => onChange({ ...rule, match: { ...rule.match, route: v || null } })} />
        <LabeledInput label="Methods" value={fromList(rule.match.methods)} placeholder="POST, PUT"
          onChange={(v) => onChange({ ...rule, match: { ...rule.match, methods: toList(v) } })} />
        <LabeledInput label="Keys" value={fromList(rule.match.keys)} placeholder="free-tier"
          onChange={(v) => onChange({ ...rule, match: { ...rule.match, keys: toList(v) } })} />
      </div>

      <label className="mt-2 flex items-center gap-2 text-xs text-zinc-300">
        <input type="checkbox" checked={rule.deny} onChange={(e) => onChange({ ...rule, deny: e.target.checked })} className="accent-red-500" />
        Deny (block matching requests with 403)
      </label>

      {!rule.deny && (
        <div className="mt-2 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">Algorithm</span>
              <select
                value={rule.algorithm ?? ""}
                onChange={(e) => setAlgorithm(e.target.value)}
                className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-200"
              >
                <option value="">Default</option>
                {algorithms.map((a) => (
                  <option key={a.key} value={a.key}>{a.label}</option>
                ))}
              </select>
            </label>
            <LabeledNumber label="Cost" value={rule.cost} min={1} step={1}
              onChange={(v) => onChange({ ...rule, cost: Math.max(1, v) })} />
          </div>
          {meta && (
            <div className="grid grid-cols-2 gap-2">
              {meta.params.map((p) => (
                <LabeledNumber
                  key={p.name}
                  label={p.label}
                  value={rule.params?.[p.name] ?? p.default}
                  min={p.min}
                  step={p.step}
                  onChange={(v) =>
                    onChange({ ...rule, params: { ...(rule.params ?? {}), [p.name]: v } })
                  }
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LabeledInput({ label, value, placeholder, onChange }: { label: string; value: string; placeholder?: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-xs text-zinc-200 placeholder:text-zinc-600"
      />
    </label>
  );
}

function LabeledNumber({ label, value, min, step, onChange }: { label: string; value: number; min?: number; step?: number; onChange: (v: number) => void }) {
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
