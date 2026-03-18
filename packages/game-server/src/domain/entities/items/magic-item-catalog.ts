/**
 * Built-in magic item definitions for common D&D 5e items.
 *
 * These serve as reference implementations and are available for use in
 * combat scenarios, test harnesses, and character creation.
 *
 * More items can be added here or loaded from the database via the ItemDefinition table.
 */

import type { MagicItemDefinition } from "./magic-item.js";

// ─── Bonus Weapons (+1/+2/+3) ────────────────────────────────────────────

function bonusWeapon(bonus: 1 | 2 | 3, baseWeapon: string): MagicItemDefinition {
  const rarity = bonus === 1 ? "uncommon" : bonus === 2 ? "rare" : "very-rare";
  return {
    id: `weapon-plus-${bonus}-${baseWeapon.toLowerCase().replace(/\s+/g, "-")}`,
    name: `+${bonus} ${baseWeapon}`,
    category: "weapon",
    rarity,
    attunement: { required: false },
    description: `You have a +${bonus} bonus to attack and damage rolls made with this magic weapon.`,
    baseWeapon,
    modifiers: [
      { target: "attackRolls", value: bonus },
      { target: "damageRolls", value: bonus },
    ],
  };
}

// ─── Bonus Armor (+1/+2/+3) ──────────────────────────────────────────────

function bonusArmor(bonus: 1 | 2 | 3, baseArmor: string): MagicItemDefinition {
  const rarity = bonus === 1 ? "rare" : bonus === 2 ? "very-rare" : "legendary";
  return {
    id: `armor-plus-${bonus}-${baseArmor.toLowerCase().replace(/\s+/g, "-")}`,
    name: `+${bonus} ${baseArmor}`,
    category: "armor",
    rarity,
    attunement: { required: false },
    description: `You have a +${bonus} bonus to AC while wearing this armor.`,
    baseArmor,
    modifiers: [
      { target: "ac", value: bonus },
    ],
  };
}

// ─── Specific Magic Items ────────────────────────────────────────────────

const FLAME_TONGUE: MagicItemDefinition = {
  id: "flame-tongue",
  name: "Flame Tongue",
  category: "weapon",
  rarity: "rare",
  attunement: { required: true },
  description: "You can use a Bonus Action to activate this magic sword. While active, it deals an extra 2d6 fire damage to any target it hits.",
  baseWeapon: "Longsword",
  onHitEffects: [
    { extraDamage: { diceCount: 2, diceSides: 6, type: "fire" } },
  ],
};

const FROST_BRAND: MagicItemDefinition = {
  id: "frost-brand",
  name: "Frost Brand",
  category: "weapon",
  rarity: "very-rare",
  attunement: { required: true },
  description: "When you hit with an attack using this magic sword, the target takes an extra 1d6 cold damage. You also have Resistance to fire damage while you hold the sword.",
  baseWeapon: "Greatsword",
  onHitEffects: [
    { extraDamage: { diceCount: 1, diceSides: 6, type: "cold" } },
  ],
  damageModifiers: [
    { type: "fire", modifier: "resistance" },
  ],
};

const CLOAK_OF_PROTECTION: MagicItemDefinition = {
  id: "cloak-of-protection",
  name: "Cloak of Protection",
  category: "wondrous-item",
  rarity: "uncommon",
  attunement: { required: true },
  description: "You gain a +1 bonus to AC and saving throws while you wear this cloak.",
  modifiers: [
    { target: "ac", value: 1 },
    { target: "savingThrows", value: 1 },
  ],
};

const AMULET_OF_HEALTH: MagicItemDefinition = {
  id: "amulet-of-health",
  name: "Amulet of Health",
  category: "wondrous-item",
  rarity: "rare",
  attunement: { required: true },
  description: "Your Constitution score is 19 while you wear this amulet. It has no effect on you if your Constitution is already 19 or higher without it.",
  modifiers: [
    { target: "abilityScore", ability: "constitution", setTo: 19 },
  ],
};

const STAFF_OF_FIRE: MagicItemDefinition = {
  id: "staff-of-fire",
  name: "Staff of Fire",
  category: "staff",
  rarity: "very-rare",
  attunement: { required: true, requiresSpellcasting: true },
  description: "You have Resistance to fire damage while you hold this staff. The staff has 10 charges and regains 1d6+4 expended charges daily at dawn.",
  baseWeapon: "Quarterstaff",
  charges: {
    max: 10,
    rechargeRoll: { diceCount: 1, diceSides: 6, modifier: 4 },
    rechargeTiming: "dawn",
    destroyOnEmpty: true,
  },
  damageModifiers: [
    { type: "fire", modifier: "resistance" },
  ],
  grantedSpells: [
    { spellName: "Burning Hands", castLevel: 1, chargeCost: 1 },
    { spellName: "Fireball", castLevel: 3, chargeCost: 3 },
    { spellName: "Wall of Fire", castLevel: 4, chargeCost: 4 },
  ],
};

const ADAMANTINE_ARMOR: MagicItemDefinition = {
  id: "adamantine-armor",
  name: "Adamantine Armor",
  category: "armor",
  rarity: "uncommon",
  attunement: { required: false },
  description: "This suit of armor is reinforced with adamantine. While you're wearing it, any critical hit against you becomes a normal hit.",
  baseArmor: "Chain Mail",
};

const SHIELD_PLUS_1: MagicItemDefinition = {
  id: "shield-plus-1",
  name: "+1 Shield",
  category: "armor",
  rarity: "uncommon",
  attunement: { required: false },
  description: "While holding this shield, you have a +1 bonus to AC. This bonus is in addition to the shield's normal bonus to AC.",
  modifiers: [
    { target: "ac", value: 1 },
  ],
};

const BOOTS_OF_SPEED: MagicItemDefinition = {
  id: "boots-of-speed",
  name: "Boots of Speed",
  category: "wondrous-item",
  rarity: "rare",
  attunement: { required: true },
  description: "While you wear these boots, you can use a Bonus Action to click the boots' heels together. The boots double your walking speed for up to 10 minutes.",
  grantedAbilities: [
    {
      name: "Click Heels",
      description: "Double your walking speed for up to 10 minutes. Usable once per long rest.",
      economy: "bonus",
      chargeCost: 0,
      usesPerRest: { count: 1, restType: "long" },
    },
  ],
};

const AMMUNITION_PLUS_1: MagicItemDefinition = {
  id: "ammunition-plus-1",
  name: "+1 Ammunition",
  category: "weapon",
  rarity: "uncommon",
  attunement: { required: false },
  description: "You have a +1 bonus to attack and damage rolls made with this piece of magic ammunition. Once it hits a target, the ammunition is no longer magical.",
  modifiers: [
    { target: "attackRolls", value: 1 },
    { target: "damageRolls", value: 1 },
  ],
};

// ─── Potions (D&D 5e 2024) ──────────────────────────────────────────────

const POTION_OF_HEALING: MagicItemDefinition = {
  id: "potion-of-healing",
  name: "Potion of Healing",
  category: "potion",
  rarity: "common",
  attunement: { required: false },
  description: "A character who drinks the magical red fluid in this vial regains 2d4 + 2 Hit Points.",
};

const POTION_OF_GREATER_HEALING: MagicItemDefinition = {
  id: "potion-of-greater-healing",
  name: "Potion of Greater Healing",
  category: "potion",
  rarity: "uncommon",
  attunement: { required: false },
  description: "A character who drinks the magical red fluid in this vial regains 4d4 + 4 Hit Points.",
};

const POTION_OF_SUPERIOR_HEALING: MagicItemDefinition = {
  id: "potion-of-superior-healing",
  name: "Potion of Superior Healing",
  category: "potion",
  rarity: "rare",
  attunement: { required: false },
  description: "A character who drinks the magical red fluid in this vial regains 8d4 + 8 Hit Points.",
};

const POTION_OF_SUPREME_HEALING: MagicItemDefinition = {
  id: "potion-of-supreme-healing",
  name: "Potion of Supreme Healing",
  category: "potion",
  rarity: "very-rare",
  attunement: { required: false },
  description: "A character who drinks the magical red fluid in this vial regains 10d4 + 20 Hit Points.",
};

/**
 * Potion healing formulas (dice + flat bonus) indexed by potion ID.
 */
export const POTION_HEALING_FORMULAS: Record<string, { diceCount: number; diceSides: number; modifier: number }> = {
  "potion-of-healing": { diceCount: 2, diceSides: 4, modifier: 2 },
  "potion-of-greater-healing": { diceCount: 4, diceSides: 4, modifier: 4 },
  "potion-of-superior-healing": { diceCount: 8, diceSides: 4, modifier: 8 },
  "potion-of-supreme-healing": { diceCount: 10, diceSides: 4, modifier: 20 },
};

// ─── Catalog ─────────────────────────────────────────────────────────────

const ALL_MAGIC_ITEMS: readonly MagicItemDefinition[] = [
  FLAME_TONGUE,
  FROST_BRAND,
  CLOAK_OF_PROTECTION,
  AMULET_OF_HEALTH,
  STAFF_OF_FIRE,
  ADAMANTINE_ARMOR,
  SHIELD_PLUS_1,
  BOOTS_OF_SPEED,
  AMMUNITION_PLUS_1,
  POTION_OF_HEALING,
  POTION_OF_GREATER_HEALING,
  POTION_OF_SUPERIOR_HEALING,
  POTION_OF_SUPREME_HEALING,
];

const BY_ID = new Map<string, MagicItemDefinition>(
  ALL_MAGIC_ITEMS.map((item) => [item.id, item]),
);

const BY_NAME = new Map<string, MagicItemDefinition>(
  ALL_MAGIC_ITEMS.map((item) => [item.name.toLowerCase(), item]),
);

/**
 * Look up a magic item by its unique ID.
 * Handles dynamic bonus weapon/armor IDs (e.g. "weapon-plus-1-longsword").
 */
export function lookupMagicItemById(id: string): MagicItemDefinition | undefined {
  const cached = BY_ID.get(id);
  if (cached) return cached;

  // Dynamic bonus weapon: weapon-plus-{1|2|3}-<base-weapon>
  const weaponMatch = /^weapon-plus-([123])-(.+)$/.exec(id);
  if (weaponMatch) {
    const bonus = Number(weaponMatch[1]) as 1 | 2 | 3;
    const baseSlug = weaponMatch[2].replace(/-/g, " ");
    // Title-case the base weapon name
    const baseName = baseSlug.replace(/\b\w/g, c => c.toUpperCase());
    const def = bonusWeapon(bonus, baseName);
    BY_ID.set(id, def); // cache for future lookups
    return def;
  }

  // Dynamic bonus armor: armor-plus-{1|2|3}-<base-armor>
  const armorMatch = /^armor-plus-([123])-(.+)$/.exec(id);
  if (armorMatch) {
    const bonus = Number(armorMatch[1]) as 1 | 2 | 3;
    const baseSlug = armorMatch[2].replace(/-/g, " ");
    const baseName = baseSlug.replace(/\b\w/g, c => c.toUpperCase());
    const def = bonusArmor(bonus, baseName);
    BY_ID.set(id, def);
    return def;
  }

  return undefined;
}

/**
 * Look up a magic item by name (case-insensitive).
 */
export function lookupMagicItem(name: string): MagicItemDefinition | undefined {
  return BY_NAME.get(name.toLowerCase());
}

/**
 * Get all built-in magic item definitions.
 */
export function getAllMagicItems(): readonly MagicItemDefinition[] {
  return ALL_MAGIC_ITEMS;
}

/**
 * Create a generic +N bonus weapon for any base weapon.
 */
export { bonusWeapon, bonusArmor };
