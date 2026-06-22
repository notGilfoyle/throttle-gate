import type { AlgorithmMeta, RunConfig } from "../types";

/** Build the `params` map (every algorithm → its default values) from metadata. */
export function defaultParams(
  algorithms: AlgorithmMeta[],
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const a of algorithms) {
    out[a.key] = {};
    for (const p of a.params) out[a.key][p.name] = p.default;
  }
  return out;
}

export function defaultConfig(algorithms: AlgorithmMeta[]): RunConfig {
  return {
    algorithm: algorithms[0]?.key ?? "token_bucket",
    compare: [],
    rps: 20,
    pattern: "burst",
    client_count: 1,
    params: defaultParams(algorithms),
  };
}
