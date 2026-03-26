import type { JsonValue, SessionMonsterRecord } from "../types.js";

export interface IMonsterRepository {
  createInSession(
    sessionId: string,
    input: {
      id: string;
      name: string;
      monsterDefinitionId: string | null;
      statBlock: JsonValue;
    },
  ): Promise<SessionMonsterRecord>;

  getById(id: string): Promise<SessionMonsterRecord | null>;
  getManyByIds(ids: string[]): Promise<SessionMonsterRecord[]>;
  listBySession(sessionId: string): Promise<SessionMonsterRecord[]>;
  delete(id: string): Promise<void>;
}
