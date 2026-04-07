import type { IItemDefinitionRepository } from "../../repositories/item-definition-repository.js";
import type { MagicItemDefinition } from "../../../domain/entities/items/magic-item.js";
import { lookupMagicItem, lookupMagicItemById } from "../../../domain/entities/items/magic-item-catalog.js";

function toMagicItemDefinition(value: unknown): MagicItemDefinition | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<MagicItemDefinition>;
  if (typeof candidate.id !== "string") return null;
  if (typeof candidate.name !== "string") return null;
  if (typeof candidate.category !== "string") return null;
  return candidate as MagicItemDefinition;
}

/**
 * Item lookup service that prefers runtime item definitions from the repository,
 * then falls back to the static in-memory catalog.
 */
export class ItemLookupService {
  constructor(private readonly items: IItemDefinitionRepository) {}

  async lookupItem(nameOrId: string): Promise<MagicItemDefinition | null> {
    const key = nameOrId.trim();
    if (!key) return null;

    const byId = await this.items.findById(key);
    if (byId) {
      const parsed = toMagicItemDefinition(byId.data);
      if (parsed) return parsed;
    }

    const byName = await this.items.findByName(key);
    if (byName) {
      const parsed = toMagicItemDefinition(byName.data);
      if (parsed) return parsed;
    }

    return lookupMagicItemById(key) ?? lookupMagicItem(key) ?? null;
  }
}
