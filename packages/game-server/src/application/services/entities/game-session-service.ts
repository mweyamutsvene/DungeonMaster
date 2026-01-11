import { nanoid } from "nanoid";

import { NotFoundError } from "../../errors.js";
import type { IEventRepository } from "../../repositories/event-repository.js";
import type { IGameSessionRepository } from "../../repositories/game-session-repository.js";
import type { GameSessionRecord, JsonValue } from "../../types.js";

/**
 * Creates and retrieves game sessions (the root aggregate for runtime state).
 * Layer: Application.
 * Notes: Emits session-level events when `IEventRepository` is provided.
 */
export class GameSessionService {
  constructor(
    private readonly sessions: IGameSessionRepository,
    private readonly events?: IEventRepository,
  ) {}

  async createSession(input: { storyFramework: JsonValue; id?: string }): Promise<GameSessionRecord> {
    const id = input.id ?? nanoid();
    const created = await this.sessions.create({ id, storyFramework: input.storyFramework });

    if (this.events) {
      await this.events.append(id, {
        id: nanoid(),
        type: "SessionCreated",
        payload: { sessionId: id },
      });
    }

    return created;
  }

  async getSessionOrThrow(id: string): Promise<GameSessionRecord> {
    const session = await this.sessions.getById(id);
    if (!session) throw new NotFoundError(`Session not found: ${id}`);
    return session;
  }
}
