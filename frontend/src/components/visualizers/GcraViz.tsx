import { useEffect, useRef } from "react";
import type { AlgoLatest } from "../../state/streamStore";
import type { GcraState } from "../../types";

interface Props {
  latest: AlgoLatest | undefined;
}

// Meter geometry in SVG user units.
const TOP = 14;
const BOTTOM = 246;
const LEFT = 40;
const WIDTH = 80;
const FULL_H = BOTTOM - TOP;

/**
 * GCRA "meter" (M11). GCRA tracks one value — the Theoretical Arrival Time —
 * which we render as a fill level: each allowed request pushes the meter up by
 * one slot, and it drains continuously at `rate` slots/sec (extrapolated
 * client-side via rAF, the two-clock pattern). When the meter is within one slot
 * of `burst` the next request is rejected and the meter flashes red.
 */
export default function GcraViz({ latest }: Props) {
  const fillRef = useRef<SVGRectElement>(null);
  const flashRef = useRef<SVGRectElement>(null);
  const levelTextRef = useRef<SVGTextElement>(null);

  const anim = useRef({
    baseLevel: 0,
    baseTime: 0,
    burst: 10,
    rate: 5,
    flashUntil: 0,
    hasData: false,
  });

  useEffect(() => {
    if (!latest) return;
    const s = latest.state as unknown as GcraState;
    const a = anim.current;
    a.baseLevel = s.level;
    a.baseTime = performance.now();
    a.burst = s.burst;
    a.rate = s.rate;
    a.hasData = true;
    if (!latest.allowed) a.flashUntil = performance.now() + 280;
  }, [latest]);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const a = anim.current;
      const now = performance.now();
      const elapsedS = (now - a.baseTime) / 1000;
      // The meter drains at `rate` slots/sec between events.
      const level = a.hasData ? Math.max(0, a.baseLevel - elapsedS * a.rate) : 0;
      const frac = a.burst > 0 ? Math.max(0, Math.min(1, level / a.burst)) : 0;
      const h = frac * FULL_H;

      if (fillRef.current) {
        fillRef.current.setAttribute("y", String(BOTTOM - h));
        fillRef.current.setAttribute("height", String(h));
        // Tint toward amber/red as the meter approaches the burst ceiling.
        fillRef.current.setAttribute("fill", frac > 0.85 ? "#ef4444" : frac > 0.6 ? "#f59e0b" : "#38bdf8");
      }
      if (levelTextRef.current) {
        levelTextRef.current.textContent = a.hasData ? level.toFixed(1) : "—";
      }
      if (flashRef.current) {
        flashRef.current.setAttribute("opacity", now < a.flashUntil ? "0.5" : "0");
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  const { burst, rate } = anim.current;

  return (
    <div className="flex flex-col items-center gap-3">
      <svg viewBox="0 0 160 260" className="h-[340px] w-[220px]">
        <rect x={LEFT} y={TOP} width={WIDTH} height={FULL_H} rx={8} fill="#18181b" stroke="#3f3f46" strokeWidth={2} />
        {/* meter fill grows upward from the bottom */}
        <rect ref={fillRef} x={LEFT} y={BOTTOM} width={WIDTH} height={0} rx={4} fill="#38bdf8" />
        {/* burst-ceiling marker near the top */}
        <line x1={LEFT - 4} x2={LEFT + WIDTH + 4} y1={TOP} y2={TOP} stroke="#ef4444" strokeWidth={1.5} strokeDasharray="4 3" />
        <rect ref={flashRef} x={LEFT} y={TOP} width={WIDTH} height={FULL_H} rx={8} fill="#ef4444" opacity={0} />
        {[0.25, 0.5, 0.75].map((t) => (
          <line key={t} x1={LEFT} x2={LEFT + WIDTH} y1={BOTTOM - t * FULL_H} y2={BOTTOM - t * FULL_H} stroke="#27272a" strokeWidth={1} />
        ))}
        <text ref={levelTextRef} x={80} y={138} textAnchor="middle" className="fill-zinc-100 font-mono" fontSize={28}>
          —
        </text>
        <text x={80} y={158} textAnchor="middle" className="fill-zinc-500 font-mono" fontSize={11}>
          / {burst} burst
        </text>
      </svg>
      <p className="max-w-xs text-center text-xs text-zinc-500">
        One timestamp (TAT) meters a steady{" "}
        <span className="text-zinc-300">{rate}/s</span>. Each allowed request fills a slot; the meter
        drains at the rate, and rejects once it hits the burst ceiling.
      </p>
    </div>
  );
}
