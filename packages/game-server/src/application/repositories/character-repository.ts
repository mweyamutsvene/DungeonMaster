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

  /**
   * Persists `sheet` and bumps `sheetVersion` unconditionally. Use when no
   * other writer could be racing (e.g. single-actor per-turn writes).
   */
  updateSheet(id: string, sheet: JsonValue): Promise<SessionCharacterRecord>;

  /**
   * Optimistic-concurrency variant: only persists if the current row's
   * `sheetVersion` matches `expectedVersion`. On match, stores `sheet` and
   * increments `sheetVersion`. On mismatch, throws `ConflictError`. Callers
   * (inventory transfer, spell side-effects) should re-read and retry once.
   */
  updateSheetWithVersion(
    id: string,
    sheet: JsonValue,
    expectedVersion: number,
  ): Promise<SessionCharacterRecord>;

  delete(id: string): Promise<void>;
}
