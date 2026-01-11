export type SSEEvent = {
  type: string;
  payload: unknown;
};

type Subscriber = (event: SSEEvent) => void;

/**
 * In-process pub/sub for per-session Server-Sent Events.
 * Layer: Infrastructure (API realtime adapter).
 * Notes: Best-effort delivery; used by Fastify routes to push events to connected clients.
 */
class SSEBroker {
  private readonly subscribersBySessionId = new Map<string, Set<Subscriber>>();

  subscribe(sessionId: string, subscriber: Subscriber): () => void {
    const set = this.subscribersBySessionId.get(sessionId) ?? new Set<Subscriber>();
    set.add(subscriber);
    this.subscribersBySessionId.set(sessionId, set);

    return () => {
      const current = this.subscribersBySessionId.get(sessionId);
      if (!current) return;
      current.delete(subscriber);
      if (current.size === 0) this.subscribersBySessionId.delete(sessionId);
    };
  }

  publish(sessionId: string, event: SSEEvent): void {
    const subs = this.subscribersBySessionId.get(sessionId);
    if (!subs) return;
    for (const sub of subs) {
      try {
        sub(event);
      } catch {
        // Best-effort delivery; subscriber cleanup is handled on connection close.
      }
    }
  }
}

export const sseBroker = new SSEBroker();
