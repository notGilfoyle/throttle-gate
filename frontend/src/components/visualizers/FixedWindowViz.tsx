import { useEffect, useRef, useState } from "react";
import type { AlgoLatest } from "../../state/streamStore";
import type { FixedWindowState } from "../../types";

interface Props {
  latest: AlgoLatest | undefined;
}

const BAR_W = 280;
const RING_R = 26;
const RING_C = 2 * Math.PI * RING_R;

/**
 * Horizontal counter bar filling toward `limit` with a reset countdown ring
 * (PRD §8.2). When two adjacent windows both fill to the limit around a
 * boundary, a "boundary burst" annotation flashes to expose the vulnerability.
 */
export default function FixedWindowViz({ latest }: Props) {
  const barRef = useRef<SVGRectElement>(null);
  const ringRef = useRef<SVGCircleElement>(null);
  const countTextRef = useRef<SVGTextElement>(null);
  const ringTextRef = useRef<HTMLSpanElement>(null);
  const [boundaryBurst, setBoundaryBurst] = useState(false);

  const anim = useRef({
    count: 0,
    limit: 10,
    windowS: 1,
    baseResets: 1,
    baseTime: 0,
    peak: 0,
    flashUntil: 0,
    hasData: false,
  });

  useEffect(() => {
    if (!latest) return;
    const s = latest.state as unknown as FixedWindowState;
    const a = anim.current;

    if (s.count < a.count) {
      // Window rolled over. If the window we just left was maxed out, a burst
      // straddling this boundary can admit up to 2×limit in a short span.
      if (a.peak >= a.limit) {
        a.flashUntil = performance.now() + 1400;
      }
      a.peak = s.count;
    } else {
      a.peak = Math.max(a.peak, s.count);
    }

    a.count = s.count;
    a.limit = s.limit;
    a.windowS = s.window_s;
    a.baseResets = s.resets_in_s;
    a.baseTime = performance.now();
    a.hasData = true;
  }, [latest]);

  useEffect(() => {
    let raf = 0;
    let flashing = false;
    const draw = () => {
      const a = anim.current;
      const now = performance.now();
      const resets = Math.max(0, a.baseResets - (now - a.baseTime) / 1000);
      const fillFrac = a.limit > 0 ? Math.min(1, a.count / a.limit) : 0;
      const over = a.count > a.limit;

      if (barRef.current) {
        barRef.current.setAttribute("width", String(fillFrac * BAR_W));
        barRef.current.setAttribute("fill", over ? "#ef4444" : fillFrac > 0.85 ? "#f59e0b" : "#10b981");
      }
      if (countTextRef.current) {
        countTextRef.current.textContent = a.hasData ? `${a.count} / ${a.limit}` : "— / —";
      }
      if (ringRef.current) {
        const frac = a.windowS > 0 ? resets / a.windowS : 0;
        ringRef.current.setAttribute("stroke-dashoffset", String(RING_C * (1 - frac)));
      }
      if (ringTextRef.current) {
        ringTextRef.current.textContent = a.hasData ? `${resets.toFixed(1)}s` : "";
      }

      const isFlashing = now < a.flashUntil;
      if (isFlashing !== flashing) {
        flashing = isFlashing;
        setBoundaryBurst(isFlashing);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="flex flex-col items-center gap-5">
      <div className="h-6">
        {boundaryBurst && (
          <span className="animate-pulse rounded bg-red-500/20 px-2 py-1 text-xs font-semibold text-red-300 ring-1 ring-red-500/50">
            ⚠ boundary burst — adjacent windows both maxed
          </span>
        )}
      </div>

      <svg viewBox="0 0 320 90" className="w-[320px]">
        <rect x={0} y={20} width={BAR_W} height={36} rx={6} fill="#18181b" stroke="#3f3f46" />
        <rect ref={barRef} x={0} y={20} width={0} height={36} rx={6} fill="#10b981" />
        <text ref={countTextRef} x={BAR_W / 2} y={43} textAnchor="middle" className="fill-zinc-100 font-mono" fontSize={18}>
          — / —
        </text>
      </svg>

      <div className="flex items-center gap-3">
        <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
          <circle cx={32} cy={32} r={RING_R} fill="none" stroke="#27272a" strokeWidth={6} />
          <circle
            ref={ringRef}
            cx={32}
            cy={32}
            r={RING_R}
            fill="none"
            stroke="#10b981"
            strokeWidth={6}
            strokeLinecap="round"
            strokeDasharray={RING_C}
            strokeDashoffset={0}
          />
        </svg>
        <div>
          <div className="text-xs uppercase tracking-wider text-zinc-500">resets in</div>
          <span ref={ringTextRef} className="block font-mono text-lg text-zinc-100" />
        </div>
      </div>

      <p className="max-w-xs text-center text-xs text-zinc-500">
        Counts requests per fixed window, resetting on the boundary. A burst at the edge can slip
        through twice — watch the boundary-burst warning.
      </p>
    </div>
  );
}
