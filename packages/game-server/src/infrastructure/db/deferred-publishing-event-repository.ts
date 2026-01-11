import type { IEventRepository } from "../../application/repositories/event-repository.js";
import type { GameEventRecord, JsonValue } from "../../application/types.js";
import { sseBroker } from "../api/realtime/sse-broker.js";

export type DeferredEvent = {
  sessionId: string;
  type: string;
  payload: unknown;
};

export function publishDeferredEvents(events: readonly DeferredEvent[]): void {
  for (const ev of events) {
    sseBroker.publish(ev.sessionId, { type: ev.type, payload: ev.payload });
  }
}

/**
 * Event repository decorator that buffers SSE publishes until a unit-of-work commits.
 * Layer: Infrastructure (DB/API adapter).
 * Notes: Used by `PrismaUnitOfWork` to avoid pushing events from inside a transaction.
 */
export class DeferredPublishingEventRepository implements IEventRepository {
  constructor(
    private readonly inner: IEventRepository,
    private readonly deferred: DeferredEvent[],
  ) {}

  async append(
    sessionId: string,
    input: { id: string; type: string; payload: JsonValue },
  ): Promise<GameEventRecord> {
    const created = await this.inner.append(sessionId, input);
    this.deferred.push({ sessionId, type: created.type, payload: created.payload });
    return created;
  }

  async listBySession(
    sessionId: string,
    input?: { limit?: number; since?: Date },
  ): Promise<GameEventRecord[]> {
    return this.inner.listBySession(sessionId, input);
  }
}
