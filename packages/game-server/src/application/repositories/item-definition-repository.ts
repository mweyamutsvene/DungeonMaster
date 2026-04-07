import type { JsonValue, ItemDefinitionRecord } from "../types.js";

export interface ItemDefinitionUpsertInput {
  id: string;
  name: string;
  category: string;
  data: JsonValue;
}

export interface IItemDefinitionRepository {
  findById(id: string): Promise<ItemDefinitionRecord | null>;
  findByName(name: string): Promise<ItemDefinitionRecord | null>;
  listAll(): Promise<ItemDefinitionRecord[]>;
  upsert(item: ItemDefinitionUpsertInput): Promise<ItemDefinitionRecord>;
}
