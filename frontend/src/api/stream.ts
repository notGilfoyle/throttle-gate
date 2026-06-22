// EventSource wrapper with explicit reconnect + backoff and connection-status
// reporting (PRD §8.4). Native EventSource auto-retries, but we manage it so we
// can surface status to the UI and bound the backoff.

import type { DecisionEvent, HelloEvent, StatsEvent } from "../types";

export type ConnStatus = "connecting" | "open" | "reconnecting" | "closed";

export interface StreamHandlers {
  onHello?: (e: HelloEvent) => void;
  onDecision?: (e: DecisionEvent) => void;
  onStats?: (e: StatsEvent) => void;
  onStatus?: (s: ConnStatus) => void;
}

const MAX_BACKOFF_MS = 10_000;

export class StreamConnection {
  private es: EventSource | null = null;
  private backoff = 500;
  private closed = false;
  private reconnectTimer: number | null = null;

  constructor(
    private readonly sessionId: string,
    private readonly handlers: StreamHandlers,
  ) {}

  connect(): void {
    this.closed = false;
    this.open();
  }

  private open(): void {
    this.setStatus(this.backoff === 500 ? "connecting" : "reconnecting");
    const es = new EventSource(`/api/stream?session_id=${encodeURIComponent(this.sessionId)}`);
    this.es = es;

    es.onopen = () => {
      this.backoff = 500; // reset backoff on a healthy connection
      this.setStatus("open");
    };

    es.addEventListener("hello", (ev) =>
      this.handlers.onHello?.(JSON.parse((ev as MessageEvent).data)),
    );
    es.addEventListener("decision", (ev) =>
      this.handlers.onDecision?.(JSON.parse((ev as MessageEvent).data)),
    );
    es.addEventListener("stats", (ev) =>
      this.handlers.onStats?.(JSON.parse((ev as MessageEvent).data)),
    );

    es.onerror = () => {
      es.close();
      this.es = null;
      if (this.closed) return;
      this.setStatus("reconnecting");
      this.reconnectTimer = window.setTimeout(() => this.open(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
    };
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.es?.close();
    this.es = null;
    this.setStatus("closed");
  }

  private setStatus(s: ConnStatus): void {
    this.handlers.onStatus?.(s);
  }
}
