/**
 * Built-in magic item definitions for common D&D 5e items.
 *
 * These serve as reference implementations and are available for use in
 * combat scenarios, test harnesses, and character creation.
 *
 * More items can be added here. The Prisma ItemDefinition table exists in the
 * schema but has no read/write path — all items are currently served from this
 * static in-memory catalog. TODO: Wire up ItemDefinition for custom-item persistence.
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
  potionEffects: { healing: { diceCount: 2, diceSides: 4, modifier: 2 } },
};

const POTION_OF_GREATER_HEALING: MagicItemDefinition = {
  id: "potion-of-greater-healing",
  name: "Potion of Greater Healing",
  category: "potion",
  rarity: "uncommon",
  attunement: { required: false },
  description: "A character who drinks the magical red fluid in this vial regains 4d4 + 4 Hit Points.",
  potionEffects: { healing: { diceCount: 4, diceSides: 4, modifier: 4 } },
};

const POTION_OF_SUPERIOR_HEALING: MagicItemDefinition = {
  id: "potion-of-superior-healing",
  name: "Potion of Superior Healing",
  category: "potion",
  rarity: "rare",
  attunement: { required: false },
  description: "A character who drinks the magical red fluid in this vial regains 8d4 + 8 Hit Points.",
  potionEffects: { healing: { diceCount: 8, diceSides: 4, modifier: 8 } },
};

const POTION_OF_SUPREME_HEALING: MagicItemDefinition = {
  id: "potion-of-supreme-healing",
  name: "Potion of Supreme Healing",
  category: "potion",
  rarity: "very-rare",
  attunement: { required: false },
  description: "A character who drinks the magical red fluid in this vial regains 10d4 + 20 Hit Points.",
  potionEffects: { healing: { diceCount: 10, diceSides: 4, modifier: 20 } },
};

// ─── Tier 1: Simple Effect Potions ──────────────────────────────────────

/**
 * Factory for Potion of Resistance — one per damage type.
 * D&D 5e 2024: Resistance to one damage type for 1 hour (600 rounds).
 */
function potionOfResistance(damageType: string): MagicItemDefinition {
  const slug = damageType.toLowerCase().replace(/\s+/g, "-");
  return {
    id: `potion-of-resistance-${slug}`,
    name: `Potion of Resistance (${damageType.charAt(0).toUpperCase() + damageType.slice(1)})`,
    category: "potion",
    rarity: "uncommon",
    attunement: { required: false },
    description: `When you drink this potion, you gain Resistance to ${damageType} damage for 1 hour.`,
    potionEffects: {
      effects: [
        {
          type: "resistance",
          target: "custom",
          damageType: slug,
          duration: "rounds",
          roundsRemaining: 600,
          source: `Potion of Resistance (${damageType})`,
          description: `Resistance to ${damageType} damage`,
        },
      ],
    },
  };
}

// Common resistance potion variants
const POTION_OF_FIRE_RESISTANCE = potionOfResistance("fire");
const POTION_OF_COLD_RESISTANCE = potionOfResistance("cold");
const POTION_OF_LIGHTNING_RESISTANCE = potionOfResistance("lightning");
const POTION_OF_ACID_RESISTANCE = potionOfResistance("acid");
const POTION_OF_POISON_RESISTANCE = potionOfResistance("poison");
const POTION_OF_NECROTIC_RESISTANCE = potionOfResistance("necrotic");
const POTION_OF_RADIANT_RESISTANCE = potionOfResistance("radiant");
const POTION_OF_THUNDER_RESISTANCE = potionOfResistance("thunder");
const POTION_OF_PSYCHIC_RESISTANCE = potionOfResistance("psychic");
const POTION_OF_FORCE_RESISTANCE = potionOfResistance("force");
const POTION_OF_BLUDGEONING_RESISTANCE = potionOfResistance("bludgeoning");
const POTION_OF_PIERCING_RESISTANCE = potionOfResistance("piercing");
const POTION_OF_SLASHING_RESISTANCE = potionOfResistance("slashing");

/**
 * Potion of Heroism (Rare) — 10 temp HP + Bless effects (1d4 to attacks/saves) for 1 hour.
 */
const POTION_OF_HEROISM: MagicItemDefinition = {
  id: "potion-of-heroism",
  name: "Potion of Heroism",
  category: "potion",
  rarity: "rare",
  attunement: { required: false },
  description: "For 1 hour after drinking this potion, you gain 10 Temporary Hit Points. For the same duration, you are under the effect of the Bless spell (you add 1d4 to every attack roll and saving throw).",
  potionEffects: {
    tempHp: 10,
    effects: [
      {
        type: "bonus",
        target: "attack_rolls",
        diceValue: { count: 1, sides: 4 },
        duration: "rounds",
        roundsRemaining: 600,
        source: "Potion of Heroism",
        description: "Bless: +1d4 to attack rolls",
      },
      {
        type: "bonus",
        target: "saving_throws",
        diceValue: { count: 1, sides: 4 },
        duration: "rounds",
        roundsRemaining: 600,
        source: "Potion of Heroism",
        description: "Bless: +1d4 to saving throws",
      },
    ],
  },
};

/**
 * Potion of Invulnerability (Rare) — Resistance to ALL damage for 1 minute (10 rounds).
 * Implemented as resistance to each canonical damage type.
 */
const DAMAGE_TYPES_ALL = [
  "acid", "bludgeoning", "cold", "fire", "force",
  "lightning", "necrotic", "piercing", "poison", "psychic",
  "radiant", "slashing", "thunder",
];

const POTION_OF_INVULNERABILITY: MagicItemDefinition = {
  id: "potion-of-invulnerability",
  name: "Potion of Invulnerability",
  category: "potion",
  rarity: "rare",
  attunement: { required: false },
  description: "For 1 minute after you drink this potion, you have Resistance to all damage.",
  potionEffects: {
    effects: DAMAGE_TYPES_ALL.map(dt => ({
      type: "resistance" as const,
      target: "custom" as const,
      damageType: dt,
      duration: "rounds" as const,
      roundsRemaining: 10,
      source: "Potion of Invulnerability",
      description: `Resistance to ${dt} damage`,
    })),
  },
};

/**
 * Potion of Poison (Uncommon) — 4d6 poison damage + DC 13 CON save or Poisoned for 1 hour.
 */
const POTION_OF_POISON: MagicItemDefinition = {
  id: "potion-of-poison",
  name: "Potion of Poison",
  category: "potion",
  rarity: "uncommon",
  attunement: { required: false },
  description: "This concoction looks, smells, and tastes like a Potion of Healing or other beneficial potion. To reveal its true nature, the potion requires a DC 20 Intelligence (Arcana or Nature) check. When you drink this potion, you take 4d6 poison damage and must succeed on a DC 13 Constitution saving throw or be Poisoned for 1 hour.",
  potionEffects: {
    damage: { diceCount: 4, diceSides: 6, damageType: "poison" },
    save: {
      ability: "constitution",
      dc: 13,
      effectOnFail: "Poisoned",
    },
    applyConditions: [
      { condition: "Poisoned", duration: "rounds", roundsRemaining: 600 },
    ],
  },
};

/**
 * Potion of Vitality (Very Rare) — Instantly removes Exhaustion and Poisoned.
 */
const POTION_OF_VITALITY: MagicItemDefinition = {
  id: "potion-of-vitality",
  name: "Potion of Vitality",
  category: "potion",
  rarity: "very-rare",
  attunement: { required: false },
  description: "When you drink this potion, any Exhaustion you are suffering is removed and any disease or poison currently affecting you is neutralized.",
  potionEffects: {
    removeConditions: ["Poisoned", "Exhaustion"],
  },
};

/**
 * Potion of Climbing (Common) — Climb speed equals walking speed for 1 hour.
 */
const POTION_OF_CLIMBING: MagicItemDefinition = {
  id: "potion-of-climbing",
  name: "Potion of Climbing",
  category: "potion",
  rarity: "common",
  attunement: { required: false },
  description: "When you drink this potion, you gain a Climb Speed equal to your Speed for 1 hour.",
  potionEffects: {
    effects: [
      {
        type: "speed_modifier",
        target: "speed",
        value: 0, // Climb speed = base speed; tracked via description
        duration: "rounds",
        roundsRemaining: 600,
        source: "Potion of Climbing",
        description: "Climb speed equals walking speed",
      },
    ],
  },
};

/**
 * Potion of Water Breathing (Uncommon) — Breathe underwater for 24 hours.
 * No combat mechanical effect — flavor only.
 */
const POTION_OF_WATER_BREATHING: MagicItemDefinition = {
  id: "potion-of-water-breathing",
  name: "Potion of Water Breathing",
  category: "potion",
  rarity: "uncommon",
  attunement: { required: false },
  description: "You can breathe underwater for 24 hours after drinking this potion.",
  potionEffects: {
    effects: [
      {
        type: "custom",
        target: "custom",
        duration: "rounds",
        roundsRemaining: 14400, // 24 hours
        source: "Potion of Water Breathing",
        description: "Can breathe underwater",
      },
    ],
  },
};

// ─── Tier 2: Spell-Replicating Potions ──────────────────────────────────

/**
 * Potion of Speed (Very Rare) — Haste effects (no concentration, no lethargy) for 1 minute.
 * Note: Extra action (limited to Attack/Dash/Disengage/Hide/Use Object) is out of scope
 * due to action economy complexity. TODO: implement extra action via separate work.
 */
const POTION_OF_SPEED: MagicItemDefinition = {
  id: "potion-of-speed",
  name: "Potion of Speed",
  category: "potion",
  rarity: "very-rare",
  attunement: { required: false },
  description: "When you drink this potion, you gain the effect of the Haste spell for 1 minute (no concentration required) and without the lethargy side effect. Your speed is doubled, you gain a +2 bonus to AC, and you have advantage on Dexterity saving throws.",
  potionEffects: {
    effects: [
      {
        type: "bonus",
        target: "armor_class",
        value: 2,
        duration: "rounds",
        roundsRemaining: 10,
        source: "Potion of Speed",
        description: "+2 AC (Haste)",
      },
      {
        type: "advantage",
        target: "saving_throws",
        ability: "dexterity",
        duration: "rounds",
        roundsRemaining: 10,
        source: "Potion of Speed",
        description: "Advantage on Dexterity saving throws (Haste)",
      },
      {
        type: "speed_modifier",
        target: "speed",
        value: 2, // multiplier 2x — handled by speed calculation reading this effect
        duration: "rounds",
        roundsRemaining: 10,
        source: "Potion of Speed",
        description: "Speed doubled (Haste)",
      },
    ],
  },
};

/**
 * Potion of Invisibility (Rare) — Invisible condition until attack/spell/damage.
 */
const POTION_OF_INVISIBILITY: MagicItemDefinition = {
  id: "potion-of-invisibility",
  name: "Potion of Invisibility",
  category: "potion",
  rarity: "rare",
  attunement: { required: false },
  description: "This potion's container looks empty but feels as though it holds liquid. When you drink it, you become Invisible for 1 hour. Anything you wear or carry is Invisible with you. The effect ends early if you attack, deal damage, or cast a spell.",
  potionEffects: {
    applyConditions: [
      { condition: "Invisible", duration: "until_triggered", roundsRemaining: 600 },
    ],
  },
};

/**
 * Factory for Potion of Giant Strength — sets STR score to a fixed value for 1 hour.
 */
function potionOfGiantStrength(variant: string, strScore: number, rarity: "uncommon" | "rare" | "very-rare" | "legendary"): MagicItemDefinition {
  return {
    id: `potion-of-giant-strength-${variant.toLowerCase()}`,
    name: `Potion of Giant Strength (${variant})`,
    category: "potion",
    rarity,
    attunement: { required: false },
    description: `When you drink this potion, your Strength score changes to ${strScore} for 1 hour. The potion has no effect on you if your Strength is equal to or greater than that score.`,
    potionEffects: {
      effects: [
        {
          type: "bonus",
          target: "custom",
          value: strScore,
          duration: "rounds",
          roundsRemaining: 600,
          source: `Potion of Giant Strength (${variant})`,
          description: `STR score set to ${strScore}`, // server interprets this as STR override
          ability: "strength",
        },
      ],
    },
  };
}

const POTION_OF_HILL_GIANT_STRENGTH = potionOfGiantStrength("Hill Giant", 21, "uncommon");
const POTION_OF_FROST_GIANT_STRENGTH = potionOfGiantStrength("Frost Giant", 23, "rare");
const POTION_OF_STONE_GIANT_STRENGTH = potionOfGiantStrength("Stone Giant", 25, "rare");
const POTION_OF_FIRE_GIANT_STRENGTH = potionOfGiantStrength("Fire Giant", 25, "rare");
const POTION_OF_CLOUD_GIANT_STRENGTH = potionOfGiantStrength("Cloud Giant", 27, "very-rare");
const POTION_OF_STORM_GIANT_STRENGTH = potionOfGiantStrength("Storm Giant", 29, "legendary");

/**
 * Potion of Growth (Uncommon) — Enlarge effects for 10 minutes (100 rounds).
 * +1d4 weapon damage, advantage on STR checks/saves, size Large.
 */
const POTION_OF_GROWTH: MagicItemDefinition = {
  id: "potion-of-growth",
  name: "Potion of Growth",
  category: "potion",
  rarity: "uncommon",
  attunement: { required: false },
  description: "When you drink this potion, you gain the Enlarge effect of the Enlarge/Reduce spell for 10 minutes. Your size doubles in all dimensions, your weight multiplies by eight, and you gain advantage on Strength checks and Strength saving throws. Your weapons also grow, dealing 1d4 extra damage.",
  potionEffects: {
    effects: [
      {
        type: "bonus",
        target: "damage_rolls",
        diceValue: { count: 1, sides: 4 },
        duration: "rounds",
        roundsRemaining: 100,
        source: "Potion of Growth",
        description: "+1d4 weapon damage (Enlarged)",
      },
      {
        type: "advantage",
        target: "ability_checks",
        ability: "strength",
        duration: "rounds",
        roundsRemaining: 100,
        source: "Potion of Growth",
        description: "Advantage on Strength checks (Enlarged)",
      },
      {
        type: "advantage",
        target: "saving_throws",
        ability: "strength",
        duration: "rounds",
        roundsRemaining: 100,
        source: "Potion of Growth",
        description: "Advantage on Strength saving throws (Enlarged)",
      },
    ],
  },
};

/**
 * Potion of Flying (Very Rare) — Fly speed equals walking speed for 1 hour.
 */
const POTION_OF_FLYING: MagicItemDefinition = {
  id: "potion-of-flying",
  name: "Potion of Flying",
  category: "potion",
  rarity: "very-rare",
  attunement: { required: false },
  description: "When you drink this potion, you gain a Fly Speed equal to your Speed for 1 hour and can hover.",
  potionEffects: {
    effects: [
      {
        type: "speed_modifier",
        target: "speed",
        value: 0, // fly speed equals base speed; tracked by description
        duration: "rounds",
        roundsRemaining: 600,
        source: "Potion of Flying",
        description: "Fly speed equals walking speed",
      },
    ],
  },
};

/**
 * Potion of Diminution (Rare) — Reduce effects for 1d4 hours (use 150 rounds as midpoint).
 * -1d4 weapon damage, disadvantage on STR checks/saves, size Small.
 */
const POTION_OF_DIMINUTION: MagicItemDefinition = {
  id: "potion-of-diminution",
  name: "Potion of Diminution",
  category: "potion",
  rarity: "rare",
  attunement: { required: false },
  description: "When you drink this potion, you gain the Reduce effect of the Enlarge/Reduce spell for 1d4 hours. Your size halves, your weight divides by eight, and you have disadvantage on Strength checks and Strength saving throws. Your weapons also shrink, dealing 1d4 less damage (minimum 1).",
  potionEffects: {
    effects: [
      {
        type: "penalty",
        target: "damage_rolls",
        diceValue: { count: 1, sides: 4 },
        duration: "rounds",
        roundsRemaining: 150,
        source: "Potion of Diminution",
        description: "-1d4 weapon damage (Reduced)",
      },
      {
        type: "disadvantage",
        target: "ability_checks",
        ability: "strength",
        duration: "rounds",
        roundsRemaining: 150,
        source: "Potion of Diminution",
        description: "Disadvantage on Strength checks (Reduced)",
      },
      {
        type: "disadvantage",
        target: "saving_throws",
        ability: "strength",
        duration: "rounds",
        roundsRemaining: 150,
        source: "Potion of Diminution",
        description: "Disadvantage on Strength saving throws (Reduced)",
      },
    ],
  },
};

/**
 * Potion of Gaseous Form (Rare) — Gaseous Form (no concentration) for 1 hour.
 * Resistance to nonmagical physical damage, can't attack or cast spells, fly 10ft.
 */
const POTION_OF_GASEOUS_FORM: MagicItemDefinition = {
  id: "potion-of-gaseous-form",
  name: "Potion of Gaseous Form",
  category: "potion",
  rarity: "rare",
  attunement: { required: false },
  description: "When you drink this potion, you gain the effect of the Gaseous Form spell for 1 hour (no concentration required). You transform into a misty cloud, gaining Resistance to nonmagical Bludgeoning, Piercing, and Slashing damage. You can't attack or cast spells.",
  potionEffects: {
    effects: [
      {
        type: "resistance",
        target: "custom",
        damageType: "bludgeoning",
        duration: "rounds",
        roundsRemaining: 600,
        source: "Potion of Gaseous Form",
        description: "Resistance to bludgeoning (Gaseous Form)",
      },
      {
        type: "resistance",
        target: "custom",
        damageType: "piercing",
        duration: "rounds",
        roundsRemaining: 600,
        source: "Potion of Gaseous Form",
        description: "Resistance to piercing (Gaseous Form)",
      },
      {
        type: "resistance",
        target: "custom",
        damageType: "slashing",
        duration: "rounds",
        roundsRemaining: 600,
        source: "Potion of Gaseous Form",
        description: "Resistance to slashing (Gaseous Form)",
      },
    ],
  },
};

/**
 * Potion healing formulas (dice + flat bonus) indexed by potion ID.
 * @deprecated Derive from potionEffects.healing on MagicItemDefinition instead.
 * Kept for backward compatibility with existing consumers.
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
  // Healing potions
  POTION_OF_HEALING,
  POTION_OF_GREATER_HEALING,
  POTION_OF_SUPERIOR_HEALING,
  POTION_OF_SUPREME_HEALING,
  // Tier 1: Simple effect potions
  POTION_OF_FIRE_RESISTANCE,
  POTION_OF_COLD_RESISTANCE,
  POTION_OF_LIGHTNING_RESISTANCE,
  POTION_OF_ACID_RESISTANCE,
  POTION_OF_POISON_RESISTANCE,
  POTION_OF_NECROTIC_RESISTANCE,
  POTION_OF_RADIANT_RESISTANCE,
  POTION_OF_THUNDER_RESISTANCE,
  POTION_OF_PSYCHIC_RESISTANCE,
  POTION_OF_FORCE_RESISTANCE,
  POTION_OF_BLUDGEONING_RESISTANCE,
  POTION_OF_PIERCING_RESISTANCE,
  POTION_OF_SLASHING_RESISTANCE,
  POTION_OF_HEROISM,
  POTION_OF_INVULNERABILITY,
  POTION_OF_POISON,
  POTION_OF_VITALITY,
  POTION_OF_CLIMBING,
  POTION_OF_WATER_BREATHING,
  // Tier 2: Spell-replicating potions
  POTION_OF_SPEED,
  POTION_OF_INVISIBILITY,
  POTION_OF_HILL_GIANT_STRENGTH,
  POTION_OF_FROST_GIANT_STRENGTH,
  POTION_OF_STONE_GIANT_STRENGTH,
  POTION_OF_FIRE_GIANT_STRENGTH,
  POTION_OF_CLOUD_GIANT_STRENGTH,
  POTION_OF_STORM_GIANT_STRENGTH,
  POTION_OF_GROWTH,
  POTION_OF_FLYING,
  POTION_OF_DIMINUTION,
  POTION_OF_GASEOUS_FORM,
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

  // Dynamic resistance potion: potion-of-resistance-<damage-type>
  const resistanceMatch = /^potion-of-resistance-(.+)$/.exec(id);
  if (resistanceMatch) {
    const damageType = resistanceMatch[1].replace(/-/g, " ");
    const def = potionOfResistance(damageType);
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
