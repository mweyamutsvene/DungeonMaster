import type { SpellDefinitionRecord } from "../types.js";

export interface ISpellRepository {
  getById(id: string): Promise<SpellDefinitionRecord | null>;
  getByName(name: string): Promise<SpellDefinitionRecord | null>;
  listByLevel(level: number): Promise<SpellDefinitionRecord[]>;
}
