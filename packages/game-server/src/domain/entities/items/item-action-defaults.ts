/**
 * Category defaults for item action-economy costs (D&D 5e 2024).
 *
 * Per-item `actionCosts` overrides override these defaults; `resolveItemActionCosts`
 * merges them. See `ItemActionCosts` in `magic-item.ts` for the field contract.
 *
 * RAW sources:
 * - Potion self-drink = Bonus Action (PHB 2024 Equipment).
 * - Administer potion to ally = Utilize action (default); spells may override.
 * - Hand an item to a willing, conscious ally = free object interaction.
 * - Draw / stow weapon = free object interaction OR piggybacked on Attack.
 * - Shield don/doff mid-combat = Utilize action.
 * - Armor don/doff = minutes (Light 1/1, Medium 5/1, Heavy 10/5).
 * - Generic magic item use = Utilize action unless item description overrides.
 */

import type { ItemActionCosts, MagicItemCategory, MagicItemDefinition } from "./magic-item.js";

/**
 * Per-armor-type don/doff minutes (2024 PHB armor table).
 */
const ARMOR_DON_DOFF_BY_TYPE: Record<string, { donMinutes: number; doffMinutes: number }> = {
  // Light armor (padded, leather, studded leather)
  light: { donMinutes: 1, doffMinutes: 1 },
  // Medium armor (hide, chain shirt, scale mail, breastplate, half plate)
  medium: { donMinutes: 5, doffMinutes: 1 },
  // Heavy armor (ring mail, chain mail, splint, plate)
  heavy: { donMinutes: 10, doffMinutes: 5 },
};

/**
 * Returns the default action-cost profile for an item category.
 * Shield is treated as a special armor subcategory (Utilize to don/doff mid-combat).
 *
 * Stacks are unbounded — no inventory cap is modeled.
 */
export function getCategoryActionCostDefaults(
  category: MagicItemCategory,
  opts?: { armorType?: "light" | "medium" | "heavy" | "shield" },
): ItemActionCosts {
  switch (category) {
    case "potion":
      // Self = Bonus (PHB 2024). Give to willing ally = free object interaction.
      // Administer (force-feed) = Utilize action by RAW.
      return {
        use: "bonus",
        give: "free-object-interaction",
        administer: "utilize",
      };

    case "weapon":
      // Draw / stow = free object interaction (or piggybacked on Attack action).
      return { equip: "free-object-interaction" };

    case "armor": {
      if (opts?.armorType === "shield") {
        // Shield is the only armor that can be donned/doffed as a single Utilize.
        return { equip: "utilize" };
      }
      const armorType = opts?.armorType;
      if (armorType && armorType in ARMOR_DON_DOFF_BY_TYPE) {
        const { donMinutes, doffMinutes } = ARMOR_DON_DOFF_BY_TYPE[armorType];
        return {
          equip: "out-of-combat-only",
          donMinutes,
          doffMinutes,
        };
      }
      // Unknown armor type — default to heavy-armor timings, out-of-combat-only.
      return {
        equip: "out-of-combat-only",
        donMinutes: 10,
        doffMinutes: 5,
      };
    }

    case "scroll":
      // Spell scroll use cost = embedded spell's casting time. Not shipped this plan.
      // TODO(scroll-use): resolve against spell catalog when implemented.
      return { give: "free-object-interaction" };

    case "wondrous-item":
    case "rod":
    case "staff":
    case "wand":
    case "ring":
      // Generic magic item activation = Utilize action.
      return { use: "utilize", give: "free-object-interaction" };

    default: {
      const _exhaustive: never = category;
      void _exhaustive;
      return {};
    }
  }
}

/**
 * Merges category defaults with per-item overrides. Per-item wins field-by-field.
 *
 * The `armorType` hint is read from `item.baseArmor` when present (slug-matched to
 * 'light' | 'medium' | 'heavy' | 'shield'); callers can override by passing `opts`.
 */
export function resolveItemActionCosts(
  item: Pick<MagicItemDefinition, "category" | "actionCosts" | "baseArmor">,
  opts?: { armorType?: "light" | "medium" | "heavy" | "shield" },
): ItemActionCosts {
  const armorType = opts?.armorType ?? inferArmorTypeFromBase(item.baseArmor);
  const defaults = getCategoryActionCostDefaults(item.category, { armorType });
  return { ...defaults, ...(item.actionCosts ?? {}) };
}

/**
 * Best-effort inference of armor type from a base-armor slug. Returns undefined
 * when unknown so callers can fall back to category default.
 */
function inferArmorTypeFromBase(baseArmor?: string): "light" | "medium" | "heavy" | "shield" | undefined {
  if (!baseArmor) return undefined;
  const lower = baseArmor.toLowerCase();
  if (lower === "shield") return "shield";
  // Light
  if (["padded", "leather", "studded leather", "studded-leather"].includes(lower)) return "light";
  // Medium
  if (
    ["hide", "chain shirt", "chain-shirt", "scale mail", "scale-mail", "breastplate", "half plate", "half-plate"].includes(
      lower,
    )
  ) {
    return "medium";
  }
  // Heavy
  if (["ring mail", "ring-mail", "chain mail", "chain-mail", "splint", "plate"].includes(lower)) {
    return "heavy";
  }
  return undefined;
}
