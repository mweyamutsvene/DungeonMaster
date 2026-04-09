import type { IEventRepository, GameEventInput } from "../../application/repositories/event-repository.js";
import type { GameEventRecord } from "../../application/types.js";
import type { SSEEvent } from "../api/realtime/sse-broker.js";
import { sseBroker } from "../api/realtime/sse-broker.js";

/**
 * Decorator around an event repository that publishes appended events over SSE.
 * Layer: Infrastructure (API realtime adapter).
 * Notes: Keeps HTTP handlers simple by coupling persistence + fanout in one place.
 */
export class PublishingEventRepository implements IEventRepository {
  constructor(private readonly inner: IEventRepository) {}

  async append(
    sessionId: string,
    input: { id: string } & GameEventInput,
    combatContext?: { encounterId: string; round: number; turnNumber: number },
  ): Promise<GameEventRecord> {
    const created = await this.inner.append(sessionId, input, combatContext);

    const event: SSEEvent = {
      type: created.type,
      payload: created.payload,
    };
    sseBroker.publish(sessionId, event);

    return created;
  }

  async listBySession(
    sessionId: string,
    input?: { limit?: number; since?: Date },
  ): Promise<GameEventRecord[]> {
    return this.inner.listBySession(sessionId, input);
  }
}
