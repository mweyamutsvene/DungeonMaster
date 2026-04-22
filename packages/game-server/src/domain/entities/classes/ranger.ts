import type { ResourcePool } from "../combat/resource-pool.js";
import type { CharacterClassDefinition, ClassCapability, SubclassDefinition } from "./class-definition.js";
import type { ClassCombatTextProfile } from "./combat-text-profile.js";
import {
  FAVORED_ENEMY,
  DEFT_EXPLORER,
  ROVING,
  TIRELESS,
  RELENTLESS_HUNTER,
  NATURES_VEIL,
  PRECISE_HUNTER,
  FERAL_SENSES,
  FOE_SLAYER,
  HUNTERS_LORE,
  HUNTERS_PREY,
  COLOSSUS_SLAYER,
} from "./feature-keys.js";
import { getSpellSlots } from "../spells/spell-progression.js";

/**
 * Build Ranger spell slot resource pools for a given level.
 * Rangers are half-casters, gaining spell slots starting at level 1 (2024 rules).
 */
function getRangerSpellSlotPools(level: number): ResourcePool[] {
  const slots = getSpellSlots("ranger", level);
  return Object.entries(slots)
    .filter(([, count]) => count > 0)
    .map(([slotLevel, count]) => ({ name: `spellSlot_${slotLevel}`, current: count, max: count }));
}

/**
 * Number of free Hunter's Mark casts per long rest (Favored Enemy).
 * Scales with the Favored Enemy column in the 2024 Ranger table.
 */
export function favoredEnemyUses(level: number): number {
  if (level < 1) return 0;
  if (level <= 4) return 2;
  if (level <= 8) return 3;
  if (level <= 12) return 4;
  if (level <= 16) return 5;
  return 6;
}

/**
 * Tireless temp-HP uses per long rest (equal to WIS modifier, minimum 1).
 */
export function tirelessUses(wisdomModifier: number): number {
  return Math.max(1, wisdomModifier);
}

/**
 * Nature's Veil uses per long rest (equal to WIS modifier, minimum 1).
 */
export function naturesVeilUses(wisdomModifier: number): number {
  return Math.max(1, wisdomModifier);
}

// ----- Hunter Subclass -----

const Hunter: SubclassDefinition = {
  id: "hunter",
  name: "Hunter",
  classId: "ranger",
  features: {
    [HUNTERS_LORE]: 3,
    [HUNTERS_PREY]: 3,
    [COLOSSUS_SLAYER]: 3,
    "defensive-tactics": 7,
    "superior-hunters-prey": 11,
    "superior-hunters-defense": 15,
  },
};

export const Ranger: CharacterClassDefinition = {
  id: "ranger",
  name: "Ranger",
  hitDie: 10,
  proficiencies: {
    savingThrows: ["strength", "dexterity"],
    armor: ["light", "medium", "shield"],
  },
  features: {
    "weapon-mastery": 1,
    [FAVORED_ENEMY]: 1,
    "spellcasting": 1,
    [DEFT_EXPLORER]: 2,
    "fighting-style": 2,
    "extra-attack": 5,
    [ROVING]: 6,
    [TIRELESS]: 10,
    [RELENTLESS_HUNTER]: 13,
    [NATURES_VEIL]: 14,
    [PRECISE_HUNTER]: 17,
    [FERAL_SENSES]: 18,
    [FOE_SLAYER]: 20,
  },
  subclasses: [Hunter],
  resourcesAtLevel: (level, abilityModifiers) => {
    const pools = getRangerSpellSlotPools(level);
    // Favored Enemy: free Hunter's Mark casts
    const feUses = favoredEnemyUses(level);
    pools.push({ name: "favoredEnemy", current: feUses, max: feUses });
    // Tireless temp-HP uses (level 10+)
    if (level >= 10) {
      const wisMod = abilityModifiers?.wisdom ?? 0;
      const tUses = tirelessUses(wisMod);
      pools.push({ name: "tireless", current: tUses, max: tUses });
    }
    // Nature's Veil uses (level 14+)
    if (level >= 14) {
      const wisMod = abilityModifiers?.wisdom ?? 0;
      const nvUses = naturesVeilUses(wisMod);
      pools.push({ name: "naturesVeil", current: nvUses, max: nvUses });
    }
    return pools;
  },
  restRefreshPolicy: [],  // Spell slots refreshed generically in rest.ts via spellSlot_* prefix
  capabilitiesForLevel: (level): readonly ClassCapability[] => {
    const caps: ClassCapability[] = [];
    if (level >= 1) {
      caps.push({ name: "Favored Enemy", economy: "free", effect: "Hunter's Mark without spell slot (uses: Favored Enemy)" });
      caps.push({ name: "Weapon Mastery", economy: "free", effect: "Use weapon mastery properties" });
      caps.push({ name: "Spellcasting", economy: "action", effect: "Cast ranger spells using WIS" });
    }
    if (level >= 2) {
      caps.push({ name: "Deft Explorer", economy: "free", effect: "Expertise in one skill, two additional languages" });
      caps.push({ name: "Fighting Style", economy: "free", effect: "Chosen fighting style bonus" });
    }
    if (level >= 5) {
      caps.push({ name: "Extra Attack", economy: "action", requires: "Attack action", effect: "Attack twice per Attack action" });
    }
    if (level >= 6) {
      caps.push({ name: "Roving", economy: "free", effect: "Speed +10 ft (no heavy armor), gain Climb and Swim speed" });
    }
    if (level >= 10) {
      caps.push({ name: "Tireless", economy: "action", effect: "Gain 1d8 + WIS temp HP (Magic action); short rest reduces exhaustion by 1" });
    }
    if (level >= 13) {
      caps.push({ name: "Relentless Hunter", economy: "free", effect: "Damage can't break concentration on Hunter's Mark" });
    }
    if (level >= 14) {
      caps.push({ name: "Nature's Veil", economy: "bonusAction", effect: "Become Invisible until end of next turn (uses: Nature's Veil)" });
    }
    if (level >= 17) {
      caps.push({ name: "Precise Hunter", economy: "free", effect: "Advantage on attacks against Hunter's Mark target" });
    }
    if (level >= 18) {
      caps.push({ name: "Feral Senses", economy: "free", effect: "Blindsight 30 ft" });
    }
    if (level >= 20) {
      caps.push({ name: "Foe Slayer", economy: "free", effect: "Hunter's Mark damage die becomes d10" });
    }
    return caps;
  },
};

// ----- Combat Text Profile -----

export const RANGER_COMBAT_TEXT_PROFILE: ClassCombatTextProfile = {
  classId: "ranger",
  actionMappings: [
    {
      keyword: "move-hunters-mark",
      normalizedPatterns: [/move.*hunter.*mark|shift.*hunter.*mark|transfer.*hunter.*mark|movemark|movehuntersmark/],
      abilityId: "class:ranger:move-hunters-mark",
      category: "bonusAction",
    },
  ],
  attackEnhancements: [],
};
