import { nanoid } from "nanoid";

import { NotFoundError, ValidationError } from "../../errors.js";
import type { ICharacterRepository } from "../../repositories/character-repository.js";
import type { IEventRepository } from "../../repositories/event-repository.js";
import type { IGameSessionRepository } from "../../repositories/game-session-repository.js";
import type { JsonValue, SessionCharacterRecord } from "../../types.js";

/**
 * Character CRUD for a given game session.
 * Layer: Application.
 * Notes: Validates inputs and emits game events via `IEventRepository` when configured.
 */
export class CharacterService {
  constructor(
    private readonly sessions: IGameSessionRepository,
    private readonly characters: ICharacterRepository,
    private readonly events?: IEventRepository,
  ) {}

  async addCharacter(
    sessionId: string,
    input: {
      name: string;
      level: number;
      className?: string | null;
      sheet: JsonValue;
      id?: string;
    },
  ): Promise<SessionCharacterRecord> {
    const session = await this.sessions.getById(sessionId);
    if (!session) throw new NotFoundError(`Session not found: ${sessionId}`);

    if (!input.name.trim()) throw new ValidationError("Character name is required");
    if (!Number.isInteger(input.level) || input.level < 1 || input.level > 20) {
      throw new ValidationError("Character level must be 1-20");
    }

    const id = input.id ?? nanoid();
    const created = await this.characters.createInSession(sessionId, {
      id,
      name: input.name,
      level: input.level,
      className: input.className ?? null,
      sheet: input.sheet,
    });

    if (this.events) {
      await this.events.append(sessionId, {
        id: nanoid(),
        type: "CharacterAdded",
        payload: { characterId: id, name: input.name, level: input.level },
      });
    }

    return created;
  }

  async listCharacters(sessionId: string): Promise<SessionCharacterRecord[]> {
    const session = await this.sessions.getById(sessionId);
    if (!session) throw new NotFoundError(`Session not found: ${sessionId}`);
    return this.characters.listBySession(sessionId);
  }

  async getCharacterOrThrow(id: string): Promise<SessionCharacterRecord> {
    const character = await this.characters.getById(id);
    if (!character) throw new NotFoundError(`Character not found: ${id}`);
    return character;
  }
}
