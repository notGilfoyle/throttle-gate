import { useSyncExternalStore } from "react";
import type { StreamStore, StreamSnapshot } from "./streamStore";

/** Subscribe a component to the coalesced stream snapshot. */
export function useStream(store: StreamStore): StreamSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
