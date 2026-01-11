import type { GameSessionRecord, JsonValue } from "../types.js";

export interface IGameSessionRepository {
  create(input: { id: string; storyFramework: JsonValue }): Promise<GameSessionRecord>;
  getById(id: string): Promise<GameSessionRecord | null>;
}
