import type { JsonValue, SessionCharacterRecord } from "../types.js";

/**
 * Fields that can be updated on a character record (outside of sheet JSON).
 */
export interface CharacterUpdateData {
  name?: string;
  level?: number;
  className?: string | null;
  sheet?: JsonValue;
  faction?: string;
  aiControlled?: boolean;
}

export interface ICharacterRepository {
  createInSession(
    sessionId: string,
    input: {
      id: string;
      name: string;
      level: number;
      className: string | null;
      sheet: JsonValue;
    },
  ): Promise<SessionCharacterRecord>;

  getById(id: string): Promise<SessionCharacterRecord | null>;
  getManyByIds(ids: string[]): Promise<SessionCharacterRecord[]>;
  listBySession(sessionId: string): Promise<SessionCharacterRecord[]>;

  update(id: string, data: Partial<CharacterUpdateData>): Promise<SessionCharacterRecord>;
  updateSheet(id: string, sheet: JsonValue): Promise<SessionCharacterRecord>;
  delete(id: string): Promise<void>;
}
