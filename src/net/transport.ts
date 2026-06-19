/**
 * Transport abstraction.
 *
 * The UI talks to a `Transport`, never to a raw socket. This lets the exact
 * same React code run:
 *   - locally (pass-and-play) via `LocalTransport` (no network at all), and
 *   - online via `WebSocketTransport` against the Node server in `server/`.
 *
 * Swapping transports is the only change required to go from local to online.
 */

import type { ClientMessage, ServerMessage } from './messages';

export type ServerMessageHandler = (msg: ServerMessage) => void;

export interface Transport {
  /** Send a message to the authority. */
  send(msg: ClientMessage): void;
  /** Subscribe to authoritative messages; returns an unsubscribe function. */
  onMessage(handler: ServerMessageHandler): () => void;
  /** Open the connection (no-op for in-memory transports). */
  connect(): Promise<void>;
  /** Close the connection and release resources. */
  close(): void;
}

// ---------------------------------------------------------------------------
// WebSocket transport (browser → Node server)
// ---------------------------------------------------------------------------

export class WebSocketTransport implements Transport {
  private ws: WebSocket | null = null;
  private handlers = new Set<ServerMessageHandler>();
  private queue: ClientMessage[] = [];
  private closedByUser = false;
  private closeCb: (() => void) | null = null;

  constructor(private url: string) {}

  /** Notifies when the socket closes unexpectedly (not via close()). */
  onClose(cb: () => void): void {
    this.closeCb = cb;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.onopen = () => {
        for (const m of this.queue) ws.send(JSON.stringify(m));
        this.queue = [];
        resolve();
      };
      ws.onerror = (e) => reject(e);
      ws.onclose = () => {
        if (!this.closedByUser) this.closeCb?.();
      };
      ws.onmessage = (ev) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(ev.data as string);
        } catch {
          return;
        }
        for (const h of this.handlers) h(msg);
      };
    });
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this.queue.push(msg); // flushed on open / reconnect
    }
  }

  onMessage(handler: ServerMessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  close(): void {
    this.closedByUser = true;
    this.ws?.close();
    this.ws = null;
    this.handlers.clear();
  }
}

// ---------------------------------------------------------------------------
// Local transport (single device, no server) — used by pass-and-play
// ---------------------------------------------------------------------------

/**
 * A trivial transport that loops messages back through an in-memory authority
 * callback. Useful for tests and for running the online code path without a
 * server. The `authority` receives every ClientMessage and may emit any number
 * of ServerMessages via the provided `emit` callback.
 */
export class LocalTransport implements Transport {
  private handlers = new Set<ServerMessageHandler>();

  constructor(
    private authority: (msg: ClientMessage, emit: (s: ServerMessage) => void) => void,
  ) {}

  connect(): Promise<void> {
    return Promise.resolve();
  }

  send(msg: ClientMessage): void {
    this.authority(msg, (s) => {
      for (const h of this.handlers) h(s);
    });
  }

  onMessage(handler: ServerMessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  close(): void {
    this.handlers.clear();
  }
}
