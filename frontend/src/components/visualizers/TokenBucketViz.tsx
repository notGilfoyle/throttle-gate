import { useEffect, useRef } from "react";
import type { AlgoLatest } from "../../state/streamStore";
import type { TokenBucketState } from "../../types";

interface Props {
  latest: AlgoLatest | undefined;
}

// Tank geometry in SVG user units.
const TOP = 14;
const BOTTOM = 246;
const LEFT = 40;
const WIDTH = 80;
const FULL_H = BOTTOM - TOP;

/**
 * Vertical token tank (PRD §8.2). The level drips upward at `refill_rate`
 * between events (extrapolated client-side via rAF) and drops by 1 on each
 * allowed request; a rejected request flashes the empty tank red.
 */
export default function TokenBucketViz({ latest }: Props) {
  const fillRef = useRef<SVGRectElement>(null);
  const flashRef = useRef<SVGRectElement>(null);
  const tokenTextRef = useRef<SVGTextElement>(null);

  // Mutable animation base, updated on each new decision; read every frame.
  const anim = useRef({
    baseTokens: 0,
    baseTime: 0,
    capacity: 10,
    refillRate: 5,
    flashUntil: 0,
    hasData: false,
  });

  // Fold each new decision's state into the animation base.
  useEffect(() => {
    if (!latest) return;
    const s = latest.state as unknown as TokenBucketState;
    const a = anim.current;
    a.baseTokens = s.tokens;
    a.baseTime = performance.now();
    a.capacity = s.capacity;
    a.refillRate = s.refill_rate;
    a.hasData = true;
    if (!latest.allowed) a.flashUntil = performance.now() + 280;
  }, [latest]);

  // Continuous render loop: extrapolate token level and paint directly.
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const a = anim.current;
      const now = performance.now();
      const elapsedS = (now - a.baseTime) / 1000;
      const tokens = a.hasData
        ? Math.min(a.capacity, a.baseTokens + elapsedS * a.refillRate)
        : 0;
      const frac = a.capacity > 0 ? Math.max(0, Math.min(1, tokens / a.capacity)) : 0;
      const h = frac * FULL_H;

      if (fillRef.current) {
        fillRef.current.setAttribute("y", String(BOTTOM - h));
        fillRef.current.setAttribute("height", String(h));
        // Tint toward amber/red as the tank approaches empty.
        fillRef.current.setAttribute("fill", frac < 0.12 ? "#f59e0b" : "#10b981");
      }
      if (tokenTextRef.current) {
        tokenTextRef.current.textContent = a.hasData ? tokens.toFixed(1) : "—";
      }
      if (flashRef.current) {
        const flashing = now < a.flashUntil;
        flashRef.current.setAttribute("opacity", flashing ? "0.5" : "0");
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  const capacity = anim.current.capacity;

  return (
    <div className="flex flex-col items-center gap-3">
      <svg viewBox="0 0 160 260" className="h-[340px] w-[220px]">
        {/* tank outline */}
        <rect
          x={LEFT}
          y={TOP}
          width={WIDTH}
          height={FULL_H}
          rx={8}
          fill="#18181b"
          stroke="#3f3f46"
          strokeWidth={2}
        />
        {/* liquid */}
        <rect ref={fillRef} x={LEFT} y={BOTTOM} width={WIDTH} height={0} rx={4} fill="#10b981" />
        {/* reject flash overlay */}
        <rect
          ref={flashRef}
          x={LEFT}
          y={TOP}
          width={WIDTH}
          height={FULL_H}
          rx={8}
          fill="#ef4444"
          opacity={0}
        />
        {/* capacity ticks */}
        {[0.25, 0.5, 0.75].map((t) => (
          <line
            key={t}
            x1={LEFT}
            x2={LEFT + WIDTH}
            y1={BOTTOM - t * FULL_H}
            y2={BOTTOM - t * FULL_H}
            stroke="#27272a"
            strokeWidth={1}
          />
        ))}
        <text ref={tokenTextRef} x={80} y={138} textAnchor="middle" className="fill-zinc-100 font-mono" fontSize={28}>
          —
        </text>
        <text x={80} y={158} textAnchor="middle" className="fill-zinc-500 font-mono" fontSize={11}>
          / {capacity} tokens
        </text>
      </svg>
      <p className="max-w-xs text-center text-xs text-zinc-500">
        Tokens refill at <span className="text-zinc-300">{anim.current.refillRate}/s</span>. Each
        allowed request spends one; bursts drain the tank, rejects flash red.
      </p>
    </div>
  );
}
