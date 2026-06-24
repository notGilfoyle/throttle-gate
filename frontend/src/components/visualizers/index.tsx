import type { AlgoLatest } from "../../state/streamStore";
import type { AlgorithmKey } from "../../types";
import FixedWindowViz from "./FixedWindowViz";
import GcraViz from "./GcraViz";
import LeakyBucketViz from "./LeakyBucketViz";
import SlidingCounterViz from "./SlidingCounterViz";
import SlidingLogViz from "./SlidingLogViz";
import TokenBucketViz from "./TokenBucketViz";

const REGISTRY: Record<AlgorithmKey, (props: { latest: AlgoLatest | undefined }) => React.ReactNode> = {
  token_bucket: TokenBucketViz,
  leaky_bucket: LeakyBucketViz,
  fixed_window: FixedWindowViz,
  sliding_log: SlidingLogViz,
  sliding_counter: SlidingCounterViz,
  gcra: GcraViz,
};

/** Render the visualizer for `algorithm`, fed the latest decision state. */
export default function Visualizer({
  algorithm,
  latest,
}: {
  algorithm: AlgorithmKey;
  latest: AlgoLatest | undefined;
}) {
  const Viz = REGISTRY[algorithm];
  return <Viz latest={latest} />;
}
