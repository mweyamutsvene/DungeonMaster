import type { JsonValue, SessionCharacterRecord } from "../types.js";

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

  updateSheet(id: string, sheet: JsonValue): Promise<SessionCharacterRecord>;
  delete(id: string): Promise<void>;
}
