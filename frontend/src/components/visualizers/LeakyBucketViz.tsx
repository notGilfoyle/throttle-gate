import { useEffect, useRef } from "react";
import type { AlgoLatest } from "../../state/streamStore";
import type { LeakyBucketState } from "../../types";

interface Props {
  latest: AlgoLatest | undefined;
}

const TOP = 14;
const BOTTOM = 230;
const FULL_H = BOTTOM - TOP;

/**
 * Funnel of queued drops that leaks at a steady rate (PRD §8.2). The level
 * extrapolates downward at `leak_rate` between events; an allowed request adds a
 * drop, an overflow (reject) bounces off the top.
 */
export default function LeakyBucketViz({ latest }: Props) {
  const fillRef = useRef<SVGPathElement>(null);
  const bounceRef = useRef<SVGCircleElement>(null);
  const depthTextRef = useRef<SVGTextElement>(null);
  const waitTextRef = useRef<SVGTextElement>(null);

  const anim = useRef({
    baseDepth: 0,
    baseTime: 0,
    capacity: 10,
    leakRate: 5,
    estWaitMs: 0,
    bounceUntil: 0,
    hasData: false,
  });

  useEffect(() => {
    if (!latest) return;
    const s = latest.state as unknown as LeakyBucketState;
    const a = anim.current;
    a.baseDepth = s.queue_depth;
    a.baseTime = performance.now();
    a.capacity = s.capacity;
    a.leakRate = s.leak_rate;
    a.estWaitMs = s.est_wait_ms;
    a.hasData = true;
    if (!latest.allowed) a.bounceUntil = performance.now() + 320;
  }, [latest]);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const a = anim.current;
      const now = performance.now();
      const elapsedS = (now - a.baseTime) / 1000;
      const depth = a.hasData ? Math.max(0, a.baseDepth - elapsedS * a.leakRate) : 0;
      const frac = a.capacity > 0 ? Math.min(1, depth / a.capacity) : 0;
      const top = BOTTOM - frac * FULL_H;

      // Funnel walls taper inward; clip the liquid to a trapezoid.
      if (fillRef.current) {
        const wTop = wallX(top);
        const wBot = wallX(BOTTOM);
        fillRef.current.setAttribute(
          "d",
          `M ${wTop[0]} ${top} L ${wTop[1]} ${top} L ${wBot[1]} ${BOTTOM} L ${wBot[0]} ${BOTTOM} Z`,
        );
        fillRef.current.setAttribute("fill", frac > 0.88 ? "#f59e0b" : "#38bdf8");
      }
      if (depthTextRef.current) {
        depthTextRef.current.textContent = a.hasData ? depth.toFixed(1) : "—";
      }
      if (waitTextRef.current) {
        waitTextRef.current.textContent = a.hasData ? `~${Math.round(a.estWaitMs)}ms wait` : "";
      }
      if (bounceRef.current) {
        const t = (a.bounceUntil - now) / 320;
        bounceRef.current.setAttribute("opacity", t > 0 ? "1" : "0");
        bounceRef.current.setAttribute("cy", String(TOP - 4 - Math.sin(Math.max(0, t) * Math.PI) * 18));
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  const capacity = anim.current.capacity;

  return (
    <div className="flex flex-col items-center gap-3">
      <svg viewBox="0 0 160 250" className="h-[340px] w-[220px]">
        {/* funnel outline */}
        <path
          d={`M 30 ${TOP} L 130 ${TOP} L 96 ${BOTTOM} L 64 ${BOTTOM} Z`}
          fill="#0c1620"
          stroke="#3f3f46"
          strokeWidth={2}
        />
        <path ref={fillRef} d="" fill="#38bdf8" />
        {/* overflow bounce drop */}
        <circle ref={bounceRef} cx={80} cy={TOP - 4} r={5} fill="#ef4444" opacity={0} />
        {/* spout drip */}
        <line x1={80} y1={BOTTOM} x2={80} y2={BOTTOM + 14} stroke="#38bdf8" strokeWidth={3}>
          <animate attributeName="opacity" values="0.2;1;0.2" dur="0.6s" repeatCount="indefinite" />
        </line>
        <text ref={depthTextRef} x={80} y={120} textAnchor="middle" className="fill-zinc-100 font-mono" fontSize={26}>
          —
        </text>
        <text x={80} y={140} textAnchor="middle" className="fill-zinc-500 font-mono" fontSize={11}>
          / {capacity} queued
        </text>
        <text ref={waitTextRef} x={80} y={246} textAnchor="middle" className="fill-sky-300/80 font-mono" fontSize={11} />
      </svg>
      <p className="max-w-xs text-center text-xs text-zinc-500">
        Queue drains at <span className="text-zinc-300">{anim.current.leakRate}/s</span>. Requests
        queue as drops; when the funnel is full, overflow bounces off = rejected.
      </p>
    </div>
  );
}

// Left/right wall x-coordinates of the funnel at a given y (linear taper).
function wallX(y: number): [number, number] {
  const t = (y - TOP) / FULL_H; // 0 at top, 1 at bottom
  const left = 30 + t * (64 - 30);
  const right = 130 - t * (130 - 96);
  return [left, right];
}
