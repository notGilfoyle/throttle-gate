import { useEffect, useRef } from "react";
import type { AlgoLatest } from "../../state/streamStore";
import type { SlidingLogState } from "../../types";

interface Props {
  latest: AlgoLatest | undefined;
}

const POOL = 120; // max dots drawn
const LEFT = 20;
const RIGHT = 300;
const AXIS_Y = 90;
const WIDTH = RIGHT - LEFT;

/**
 * Dots on a trailing time axis (PRD §8.2). Each in-window request is a dot; dots
 * drift left and fade as they age, dropping off when they leave the window. The
 * "now" edge is the right; the window start is the left.
 */
export default function SlidingLogViz({ latest }: Props) {
  const dotRefs = useRef<(SVGCircleElement | null)[]>([]);
  const countTextRef = useRef<SVGTextElement>(null);

  const anim = useRef({
    timestamps: [] as number[],
    serverNow: 0,
    baseTime: 0,
    windowS: 1,
    limit: 10,
    count: 0,
    hasData: false,
  });

  useEffect(() => {
    if (!latest) return;
    const s = latest.state as unknown as SlidingLogState;
    const a = anim.current;
    a.timestamps = s.timestamps;
    a.serverNow = latest.ts;
    a.baseTime = performance.now();
    a.windowS = s.window_s;
    a.limit = s.limit;
    a.count = s.count;
    a.hasData = true;
  }, [latest]);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const a = anim.current;
      // Extrapolate server "now" so dots keep aging between events.
      const nowS = a.serverNow + (performance.now() - a.baseTime) / 1000;
      for (let i = 0; i < POOL; i++) {
        const dot = dotRefs.current[i];
        if (!dot) continue;
        const ts = a.timestamps[i];
        const age = ts !== undefined ? nowS - ts : Infinity;
        if (age < 0 || age > a.windowS) {
          dot.setAttribute("opacity", "0");
          continue;
        }
        const x = LEFT + (1 - age / a.windowS) * WIDTH;
        // Fade out over the final 30% of the window.
        const fadeFrac = (a.windowS - age) / (0.3 * a.windowS);
        dot.setAttribute("cx", String(x));
        dot.setAttribute("opacity", String(Math.max(0.15, Math.min(1, fadeFrac))));
      }
      if (countTextRef.current) {
        countTextRef.current.textContent = a.hasData ? `${a.count} / ${a.limit}` : "— / —";
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="flex flex-col items-center gap-4">
      <svg viewBox="0 0 320 130" className="w-[340px]">
        {/* axis */}
        <line x1={LEFT} y1={AXIS_Y} x2={RIGHT} y2={AXIS_Y} stroke="#3f3f46" strokeWidth={1.5} />
        {/* now edge */}
        <line x1={RIGHT} y1={AXIS_Y - 40} x2={RIGHT} y2={AXIS_Y + 8} stroke="#10b981" strokeWidth={1.5} strokeDasharray="3 3" />
        <text x={RIGHT} y={AXIS_Y + 22} textAnchor="end" className="fill-emerald-400/80 font-mono" fontSize={10}>
          now
        </text>
        <text x={LEFT} y={AXIS_Y + 22} textAnchor="start" className="fill-zinc-500 font-mono" fontSize={10}>
          −window
        </text>
        {/* dots */}
        {Array.from({ length: POOL }).map((_, i) => (
          <circle
            key={i}
            ref={(el) => {
              dotRefs.current[i] = el;
            }}
            // Stagger vertically so dots sharing a timestamp (a burst) stack into
            // a visible column instead of overlapping into one blob.
            cy={AXIS_Y - 12 - (i % 10) * 6}
            r={4}
            fill="#10b981"
            opacity={0}
          />
        ))}
        <text ref={countTextRef} x={160} y={28} textAnchor="middle" className="fill-zinc-100 font-mono" fontSize={20}>
          — / —
        </text>
      </svg>
      <p className="max-w-xs text-center text-xs text-zinc-500">
        Every request is a timestamped dot. Dots age leftward and drop off as they leave the
        trailing window; the count is exactly the dots still in view.
      </p>
    </div>
  );
}
