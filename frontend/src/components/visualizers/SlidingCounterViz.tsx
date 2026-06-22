import { useEffect, useRef } from "react";
import type { AlgoLatest } from "../../state/streamStore";
import type { SlidingCounterState } from "../../types";

interface Props {
  latest: AlgoLatest | undefined;
}

const TOP = 24;
const BASE = 170;
const SPAN = BASE - TOP;

/**
 * Two adjacent window bars (previous, current) plus an interpolated estimate
 * marker (PRD §8.2). estimate = curr + prev × weight; the weight decays through
 * the window, so the estimate line glides down between events — the smoothing
 * that fixes the fixed-window boundary burst.
 */
export default function SlidingCounterViz({ latest }: Props) {
  const prevWeightedRef = useRef<SVGRectElement>(null);
  const prevAgedRef = useRef<SVGRectElement>(null);
  const currRef = useRef<SVGRectElement>(null);
  const estLineRef = useRef<SVGLineElement>(null);
  const estTextRef = useRef<SVGTextElement>(null);
  const weightTextRef = useRef<SVGTextElement>(null);

  const anim = useRef({
    curr: 0,
    prev: 0,
    weight: 0,
    limit: 10,
    windowS: 1,
    baseTime: 0,
    hasData: false,
  });

  useEffect(() => {
    if (!latest) return;
    const s = latest.state as unknown as SlidingCounterState;
    const a = anim.current;
    a.curr = s.curr_count;
    a.prev = s.prev_count;
    a.weight = s.weight;
    a.limit = s.limit;
    a.windowS = s.window_s;
    a.baseTime = performance.now();
    a.hasData = true;
  }, [latest]);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const a = anim.current;
      const maxVal = Math.max(a.limit * 1.15, 1);
      const yFor = (v: number) => BASE - Math.min(1, v / maxVal) * SPAN;
      const hFor = (v: number) => Math.min(1, v / maxVal) * SPAN;

      // Weight decays linearly across the window; estimate glides with it.
      const elapsed = (performance.now() - a.baseTime) / 1000;
      const weight = Math.max(0, Math.min(1, a.weight - elapsed / a.windowS));
      const estimate = a.curr + a.prev * weight;
      const over = estimate >= a.limit;

      const prevWeighted = a.prev * weight;
      setRect(prevWeightedRef.current, yFor(prevWeighted), hFor(prevWeighted));
      // Aged-out (faded) remainder sits above the weighted part.
      setRect(prevAgedRef.current, yFor(a.prev), hFor(a.prev) - hFor(prevWeighted));
      setRect(currRef.current, yFor(a.curr), hFor(a.curr));

      if (estLineRef.current) {
        const y = yFor(estimate);
        estLineRef.current.setAttribute("y1", String(y));
        estLineRef.current.setAttribute("y2", String(y));
        estLineRef.current.setAttribute("stroke", over ? "#ef4444" : "#38bdf8");
      }
      if (estTextRef.current) {
        estTextRef.current.textContent = a.hasData ? `est ${estimate.toFixed(1)} / ${a.limit}` : "";
        estTextRef.current.setAttribute("fill", over ? "#fca5a5" : "#7dd3fc");
      }
      if (weightTextRef.current) {
        weightTextRef.current.textContent = a.hasData ? `weight ${weight.toFixed(2)}` : "";
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="flex flex-col items-center gap-4">
      <svg viewBox="0 0 280 210" className="w-[320px]">
        {/* limit line */}
        <line x1={40} y1={limitY(anim.current.limit)} x2={240} y2={limitY(anim.current.limit)} stroke="#ef4444" strokeWidth={1} strokeDasharray="4 3" opacity={0.6} />
        <text x={40} y={limitY(anim.current.limit) - 4} className="fill-red-400/70 font-mono" fontSize={9}>
          limit
        </text>

        {/* previous window bar (weighted solid + aged faded) */}
        <rect ref={prevAgedRef} x={60} y={BASE} width={60} height={0} fill="#38bdf8" opacity={0.2} />
        <rect ref={prevWeightedRef} x={60} y={BASE} width={60} height={0} fill="#38bdf8" opacity={0.55} />
        <text x={90} y={BASE + 16} textAnchor="middle" className="fill-zinc-500 font-mono" fontSize={10}>
          prev
        </text>

        {/* current window bar */}
        <rect ref={currRef} x={150} y={BASE} width={60} height={0} fill="#10b981" />
        <text x={180} y={BASE + 16} textAnchor="middle" className="fill-zinc-500 font-mono" fontSize={10}>
          curr
        </text>

        {/* estimate marker spanning both */}
        <line ref={estLineRef} x1={50} y1={BASE} x2={220} y2={BASE} stroke="#38bdf8" strokeWidth={2} />
        <text ref={estTextRef} x={140} y={15} textAnchor="middle" className="font-mono" fontSize={13} fill="#7dd3fc" />
        <text ref={weightTextRef} x={140} y={202} textAnchor="middle" className="fill-zinc-500 font-mono" fontSize={10} />
      </svg>
      <p className="max-w-xs text-center text-xs text-zinc-500">
        Blends the previous window (weighted by its overlap) with the current one. The estimate
        line glides down as the old window ages out — smoothing the hard reset.
      </p>
    </div>
  );

  function limitY(limit: number) {
    const maxVal = Math.max(limit * 1.15, 1);
    return BASE - Math.min(1, limit / maxVal) * SPAN;
  }
}

function setRect(rect: SVGRectElement | null, y: number, h: number) {
  if (!rect) return;
  rect.setAttribute("y", String(y));
  rect.setAttribute("height", String(Math.max(0, h)));
}
