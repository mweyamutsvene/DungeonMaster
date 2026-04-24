import type { ResourcePool } from "../combat/resource-pool.js";
import { spendResource } from "../combat/resource-pool.js";
import type { CharacterClassDefinition, ClassCapability, SubclassDefinition } from "./class-definition.js";
import type { ClassCombatTextProfile } from "./combat-text-profile.js";
import {
  INNATE_SORCERY,
  FLEXIBLE_CASTING,
  DRACONIC_RESILIENCE, DRACONIC_ANCESTRY, ELEMENTAL_AFFINITY,
} from "./feature-keys.js";

export interface SorceryPointsState {
  pool: ResourcePool;
}

export function sorceryPointsForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > 20) {
    throw new Error(`Invalid level: ${level}`);
  }

  // Sorcery points start at level 2 and equal sorcerer level.
  return level < 2 ? 0 : level;
}

export function createSorceryPointsState(level: number): SorceryPointsState {
  const max = sorceryPointsForLevel(level);
  return { pool: { name: "sorceryPoints", current: max, max } };
}

export function spendSorceryPoints(
  state: SorceryPointsState,
  amount: number,
): SorceryPointsState {
  return { pool: spendResource(state.pool, amount) };
}

export function resetSorceryPointsOnLongRest(
  level: number,
  state: SorceryPointsState,
): SorceryPointsState {
  const max = sorceryPointsForLevel(level);
  return { pool: { name: state.pool.name, current: max, max } };
}

// ----- Subclasses -----

/**
 * Draconic Sorcery (Red Dragon) subclass (D&D 5e 2024).
 * Sorcerous Origin is gained at L1 in the 2024 rules.
 * Shell definition — executors for Draconic Resilience (+HP/AC), Draconic Ancestry
 * (fire affinity), and Elemental Affinity (L5 cantrip damage bonus) are deferred to Phase 3.
 */
export const DraconicSorceryRedSubclass: SubclassDefinition = {
  id: "draconic-sorcery-red",
  name: "Draconic Sorcery (Red)",
  classId: "sorcerer",
  features: {
    [DRACONIC_RESILIENCE]: 1,
    [DRACONIC_ANCESTRY]: 1,
    [ELEMENTAL_AFFINITY]: 5,
  },
};

export const Sorcerer: CharacterClassDefinition = {
  id: "sorcerer",
  name: "Sorcerer",
  hitDie: 6,
  proficiencies: {
    savingThrows: ["constitution", "charisma"],
    armor: [],
  },
  features: {
    "spellcasting": 1,
    [INNATE_SORCERY]: 1,
    "sorcery-points": 2,
    [FLEXIBLE_CASTING]: 2,
    "metamagic": 2,
    "sorcerous-restoration": 5,
  },
  resourcesAtLevel: (level) => {
    const sp = createSorceryPointsState(level);
    return sp.pool.max > 0 ? [sp.pool] : [];
  },
  capabilitiesForLevel: (level): readonly ClassCapability[] => {
    const caps: ClassCapability[] = [
      { name: "Spellcasting", economy: "action", effect: "Cast sorcerer spells using CHA" },
      { name: "Innate Sorcery", economy: "bonusAction", cost: "2/long rest", effect: "Advantage on Sorcerer spell attacks and +1 spell save DC for 1 minute", abilityId: "class:sorcerer:innate-sorcery" },
    ];
    if (level >= 2) {
      caps.push({ name: "Sorcery Points", economy: "free", cost: `${sorceryPointsForLevel(level)} points/long rest`, effect: "Fuel Metamagic options and convert to/from spell slots" });
      caps.push({ name: "Metamagic", economy: "free", cost: "Sorcery Points", effect: "Modify spells with Metamagic options (Quickened, Twinned, etc.)" });
    }
    return caps;
  },
  restRefreshPolicy: [
    {
      poolKey: "sorceryPoints",
      // Sorcerous Restoration (L5): sorcery points also refresh on short rest.
      refreshOn: (rest, level) => rest === "long" || (rest === "short" && level >= 5),
      computeMax: (level) => sorceryPointsForLevel(level),
    },
  ],
  subclasses: [DraconicSorceryRedSubclass],
};

export const SORCERER_COMBAT_TEXT_PROFILE: ClassCombatTextProfile = {
  classId: "sorcerer",
  actionMappings: [
    { keyword: "quickened-spell", normalizedPatterns: [/quickenedspell|quickenspell|quicken/], abilityId: "class:sorcerer:quickened-spell", category: "bonusAction" },
    { keyword: "twinned-spell", normalizedPatterns: [/twinnedspell|twinspell|twin/], abilityId: "class:sorcerer:twinned-spell", category: "classAction" },
    // Flexible Casting — Font of Magic bonus action, either direction
    { keyword: "flexible-casting", normalizedPatterns: [/convert.*sorcerypoint|convert.*spellslot.*sorcery|convert.*slot.*sorcery/], abilityId: "class:sorcerer:flexible-casting", category: "bonusAction" },
    // Innate Sorcery — Sorcerer L1 bonus action, 1-minute self-buff
    { keyword: "innate-sorcery", normalizedPatterns: [/^innatesorcery$/, /^activateinnatesorcery$/], abilityId: "class:sorcerer:innate-sorcery", category: "bonusAction" },
  ],
  attackEnhancements: [],
};
