/**
 * SSE Event Stream Client
 *
 * Connects to `GET /sessions/:id/events` and provides an event-driven
 * interface for consuming real-time game events. Uses Node.js built-in
 * `fetch` + `ReadableStream` — no external EventSource library needed.
 *
 * API:
 *   stream.on(type, handler)          — register persistent listener
 *   stream.off(type, handler)         — remove listener
 *   stream.once(type)                 — wait for one event matching type
 *   stream.waitFor(types, predicate?) — wait for a matching event
 *   stream.close()                    — disconnect
 */

import type { HttpClient } from "./http-client.js";
import type { GameEvent } from "./types.js";

export type EventHandler = (event: GameEvent) => void;

export interface EventStreamOptions {
  verbose?: boolean;
}

export class EventStream {
  private handlers = new Map<string, Set<EventHandler>>();
  private wildcardHandlers = new Set<EventHandler>();
  private abortController: AbortController | null = null;
  private connected = false;
  private closed = false;

  /** Event hold/replay buffer — events queued while holding are replayed on release. */
  private holdBuffer: GameEvent[] | null = null;

  constructor(
    private readonly http: HttpClient,
    private readonly sessionId: string,
    private readonly options: EventStreamOptions = {},
  ) {}

  // ==========================================================================
  // Listener API
  // ==========================================================================

  /** Register a persistent listener for a specific event type. Use "*" for all events. */
  on(type: string, handler: EventHandler): this {
    if (type === "*") {
      this.wildcardHandlers.add(handler);
    } else {
      const set = this.handlers.get(type) ?? new Set();
      set.add(handler);
      this.handlers.set(type, set);
    }
    return this;
  }

  /** Remove a listener. */
  off(type: string, handler: EventHandler): this {
    if (type === "*") {
      this.wildcardHandlers.delete(handler);
    } else {
      this.handlers.get(type)?.delete(handler);
    }
    return this;
  }

  /** Wait for the next event of the given type. */
  once(type: string, timeoutMs = 60_000): Promise<GameEvent> {
    return this.waitFor([type], undefined, timeoutMs);
  }

  /**
   * Wait for an event matching one of the given types and an optional predicate.
   * Resolves with the first matching event. If events were buffered during a
   * hold period, checks the buffer first before waiting for new events.
   */
  waitFor(
    types: string[],
    predicate?: (event: GameEvent) => boolean,
    timeoutMs = 60_000,
  ): Promise<GameEvent> {
    // Check the replay buffer first — a matching event may already be queued
    if (this.holdBuffer) {
      const typeSet = new Set(types);
      const idx = this.holdBuffer.findIndex(
        (e) => typeSet.has(e.type) && (!predicate || predicate(e)),
      );
      if (idx !== -1) {
        const event = this.holdBuffer.splice(idx, 1)[0]!;
        return Promise.resolve(event);
      }
    }

    return new Promise<GameEvent>((resolve, reject) => {
      const typeSet = new Set(types);
      let settled = false;

      const cleanup = () => {
        settled = true;
        for (const t of typeSet) {
          this.off(t, handler);
        }
        clearTimeout(timer);
      };

      const handler: EventHandler = (event) => {
        if (settled) return;
        if (!predicate || predicate(event)) {
          cleanup();
          resolve(event);
        }
      };

      const timer = setTimeout(() => {
        if (settled) return;
        cleanup();
        reject(new Error(`EventStream.waitFor(${types.join("|")}) timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      for (const t of typeSet) {
        this.on(t, handler);
      }
    });
  }

  // ==========================================================================
  // Event Hold / Replay
  // ==========================================================================

  /**
   * Start buffering events. While held, events are still emitted to persistent
   * `on()` handlers (e.g., display handlers), but also queued in a buffer.
   * Call `releaseEvents()` when ready to consume them — the next `waitFor()`
   * will check the buffer before waiting for new SSE events.
   *
   * Use this to prevent event loss when `await`-ing user input between
   * `waitFor()` calls (e.g., during reaction prompt handling).
   */
  holdEvents(): void {
    if (!this.holdBuffer) {
      this.holdBuffer = [];
    }
  }

  /**
   * Stop buffering. The buffer is kept so the next `waitFor()` can drain it.
   * After the first `waitFor()` checks and doesn't find a match, the buffer
   * is irrelevant and will be cleared by future `holdEvents()` calls.
   */
  releaseEvents(): void {
    // Buffer stays — waitFor will drain matching events from it.
    // If nothing matches, clear it to avoid unbounded growth.
    if (this.holdBuffer && this.holdBuffer.length === 0) {
      this.holdBuffer = null;
    }
  }

  /** Discard the event buffer entirely. */
  clearHoldBuffer(): void {
    this.holdBuffer = null;
  }

  // ==========================================================================
  // Connection
  // ==========================================================================

  /** Start consuming the SSE stream. Call this once after registering handlers. */
  async connect(): Promise<void> {
    if (this.closed) throw new Error("EventStream is closed");
    if (this.connected) return;

    this.abortController = new AbortController();
    this.connected = true;

    // Fire-and-forget: the read loop runs in the background.
    // Errors are logged, not propagated to callers.
    void this.readLoop();
  }

  /** Disconnect and clean up all listeners. */
  close(): void {
    this.closed = true;
    this.connected = false;
    this.abortController?.abort();
    this.handlers.clear();
    this.wildcardHandlers.clear();
  }

  get isConnected(): boolean {
    return this.connected && !this.closed;
  }

  // ==========================================================================
  // Internal
  // ==========================================================================

  private async readLoop(): Promise<void> {
    const log = this.options.verbose
      ? (msg: string) => console.log(`[SSE] ${msg}`)
      : () => {};

    while (!this.closed) {
      try {
        log(`Connecting to /sessions/${this.sessionId}/events ...`);

        const response = await this.http.fetchRaw(
          `/sessions/${this.sessionId}/events`,
          { signal: this.abortController!.signal },
        );

        if (!response.body) {
          throw new Error("SSE response has no body stream");
        }

        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";

        while (!this.closed) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += value;

          // SSE frames are delimited by double newlines
          let boundary: number;
          while ((boundary = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            this.parseFrame(frame, log);
          }
        }

        log("Stream ended");
      } catch (err: unknown) {
        if (this.closed) break;

        const error = err as { name?: string; message?: string };
        if (error?.name === "AbortError") break;

        log(`Connection error: ${error?.message ?? String(err)}. Reconnecting in 2s...`);
        await this.delay(2000);
      }
    }

    this.connected = false;
  }

  private parseFrame(frame: string, log: (msg: string) => void): void {
    let eventType: string | undefined;
    let data: string | undefined;

    for (const line of frame.split("\n")) {
      if (line.startsWith("event: ")) {
        eventType = line.slice(7).trim();
      } else if (line.startsWith("data: ")) {
        data = line.slice(6);
      } else if (line.startsWith(":")) {
        // Comment line (e.g., ": ping" heartbeat) — ignore
        return;
      }
    }

    if (!eventType || !data) return;

    let parsed: GameEvent;
    try {
      parsed = JSON.parse(data) as GameEvent;
      // Ensure type is set from the SSE event field if not in the payload
      if (!parsed.type) parsed.type = eventType;
    } catch {
      log(`Failed to parse SSE data for event "${eventType}": ${data.slice(0, 100)}`);
      return;
    }

    log(`← ${eventType}`);
    this.emit(eventType, parsed);
  }

  private emit(type: string, event: GameEvent): void {
    // Buffer the event if holding (before dispatching — handlers may call waitFor)
    if (this.holdBuffer) {
      this.holdBuffer.push(event);
    }

    const typeHandlers = this.handlers.get(type);
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        try {
          handler(event);
        } catch (err) {
          console.error(`[SSE] Handler error for "${type}":`, err);
        }
      }
    }

    for (const handler of this.wildcardHandlers) {
      try {
        handler(event);
      } catch (err) {
        console.error(`[SSE] Wildcard handler error:`, err);
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
