// Buffered, rAF-coalesced store for the SSE stream (PRD §8.4).
//
// SSE can exceed React's render budget at high RPS, so incoming events are
// accumulated in mutable buffers and flushed into an immutable snapshot at most
// once per animation frame. Components read the snapshot via useSyncExternalStore.

import { StreamConnection, type ConnStatus } from "../api/stream";
import type {
  AlgoStats,
  DecisionEvent,
  HelloEvent,
  StatsEvent,
} from "../types";

const MAX_CHIPS = 150;

export interface AlgoLatest {
  ts: number;
  allowed: boolean;
  state: Record<string, number | number[]>;
}

export interface StreamSnapshot {
  status: ConnStatus;
  workerId: string | null;
  decisions: DecisionEvent[]; // newest first, capped at MAX_CHIPS
  statsByAlgo: Record<string, AlgoStats>;
  rpsIn: number;
  latestByAlgo: Record<string, AlgoLatest>;
}

const EMPTY: StreamSnapshot = {
  status: "closed",
  workerId: null,
  decisions: [],
  statsByAlgo: {},
  rpsIn: 0,
  latestByAlgo: {},
};

export class StreamStore {
  private conn: StreamConnection | null = null;
  private listeners = new Set<() => void>();
  private snapshot: StreamSnapshot = EMPTY;

  // Working buffers, flushed once per frame.
  private pendingDecisions: DecisionEvent[] = [];
  private pendingStats: StatsEvent | null = null;
  private pendingStatus: ConnStatus | null = null;
  private pendingWorkerId: string | null = null;
  private rafScheduled = false;

  // useSyncExternalStore interface.
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = (): StreamSnapshot => this.snapshot;

  connect(sessionId: string): void {
    this.disconnect();
    this.snapshot = EMPTY;
    this.clearBuffers();
    this.conn = new StreamConnection(sessionId, {
      onHello: (e: HelloEvent) => {
        this.pendingWorkerId = e.worker_id;
        this.schedule();
      },
      onDecision: (e) => {
        this.pendingDecisions.push(e);
        if (this.pendingDecisions.length > MAX_CHIPS) {
          this.pendingDecisions.splice(0, this.pendingDecisions.length - MAX_CHIPS);
        }
        this.schedule();
      },
      onStats: (e) => {
        this.pendingStats = e;
        this.schedule();
      },
      onStatus: (s) => {
        this.pendingStatus = s;
        this.schedule();
      },
    });
    this.conn.connect();
  }

  disconnect(): void {
    this.conn?.close();
    this.conn = null;
  }

  private clearBuffers(): void {
    this.pendingDecisions = [];
    this.pendingStats = null;
    this.pendingStatus = null;
    this.pendingWorkerId = null;
  }

  private schedule(): void {
    if (this.rafScheduled) return;
    this.rafScheduled = true;
    requestAnimationFrame(this.flush);
  }

  private flush = (): void => {
    this.rafScheduled = false;
    const prev = this.snapshot;

    let decisions = prev.decisions;
    let latestByAlgo = prev.latestByAlgo;

    if (this.pendingDecisions.length) {
      // Newest first; prepend this frame's batch (also newest-first) and cap.
      const batch = this.pendingDecisions;
      decisions = [...batch].reverse().concat(prev.decisions).slice(0, MAX_CHIPS);

      latestByAlgo = { ...prev.latestByAlgo };
      for (const d of batch) {
        for (const r of d.results) {
          latestByAlgo[r.algorithm] = { ts: d.ts, allowed: r.allowed, state: r.state };
        }
      }
    }

    this.snapshot = {
      status: this.pendingStatus ?? prev.status,
      workerId: this.pendingWorkerId ?? prev.workerId,
      decisions,
      statsByAlgo: this.pendingStats?.per_algorithm ?? prev.statsByAlgo,
      rpsIn: this.pendingStats?.rps_in ?? prev.rpsIn,
      latestByAlgo,
    };

    this.clearBuffers();
    this.listeners.forEach((l) => l());
  };
}
