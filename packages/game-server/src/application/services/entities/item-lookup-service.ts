import type { IItemDefinitionRepository } from "../../repositories/item-definition-repository.js";
import type { MagicItemDefinition } from "../../../domain/entities/items/magic-item.js";
import { lookupMagicItem, lookupMagicItemById } from "../../../domain/entities/items/magic-item-catalog.js";
import type { WeaponCatalogEntry } from "../../../domain/entities/items/weapon-catalog.js";
import { lookupWeapon } from "../../../domain/entities/items/weapon-catalog.js";
import type { ArmorCatalogEntry } from "../../../domain/entities/items/armor-catalog.js";
import { lookupArmor } from "../../../domain/entities/items/armor-catalog.js";

/** Union of all item types the lookup service can return. */
export type LookedUpItem =
  | { kind: "magic"; item: MagicItemDefinition }
  | { kind: "weapon"; item: WeaponCatalogEntry }
  | { kind: "armor"; item: ArmorCatalogEntry };

function toMagicItemDefinition(value: unknown): MagicItemDefinition | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<MagicItemDefinition>;
  if (typeof candidate.id !== "string") return null;
  if (typeof candidate.name !== "string") return null;
  if (typeof candidate.category !== "string") return null;
  return candidate as MagicItemDefinition;
}

/**
 * Unified item lookup service with fallback chain:
 * 1. DB (magic items from repository)
 * 2. Static magic item catalog
 * 3. Static weapon catalog
 * 4. Static armor catalog
 */
export class ItemLookupService {
  constructor(private readonly items: IItemDefinitionRepository) {}

  /** Look up a magic item by name or ID (original behavior). */
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

  /**
   * Unified equipment lookup: searches magic items, weapons, and armor.
   * Returns a tagged union so callers know which catalog the item came from.
   */
  async lookupEquipment(nameOrId: string): Promise<LookedUpItem | null> {
    const key = nameOrId.trim();
    if (!key) return null;

    // 1. Magic items (DB + static catalog)
    const magic = await this.lookupItem(key);
    if (magic) return { kind: "magic", item: magic };

    // 2. Static weapon catalog
    const weapon = lookupWeapon(key);
    if (weapon) return { kind: "weapon", item: weapon };

    // 3. Static armor catalog
    const armor = lookupArmor(key);
    if (armor) return { kind: "armor", item: armor };

    return null;
  }
}
