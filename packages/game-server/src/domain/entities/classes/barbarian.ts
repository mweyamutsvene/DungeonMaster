import type { ResourcePool } from "../combat/resource-pool.js";
import { spendResource } from "../combat/resource-pool.js";
import type { CharacterClassDefinition, ClassCapability, SubclassDefinition } from "./class-definition.js";
import type { ClassCombatTextProfile } from "./combat-text-profile.js";
import { MINDLESS_RAGE, INTIMIDATING_PRESENCE } from "./feature-keys.js";

export interface RageState {
  pool: ResourcePool;
  active: boolean;
}

export function rageUsesForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > 20) {
    throw new Error(`Invalid level: ${level}`);
  }

  if (level <= 2) return 2;
  if (level <= 5) return 3;
  if (level <= 11) return 4;
  if (level <= 16) return 5;
  return 6;
}

export function createRageState(level: number): RageState {
  const max = rageUsesForLevel(level);
  return { pool: { name: "rage", current: max, max }, active: false };
}

export function startRage(state: RageState): RageState {
  if (state.active) {
    return state;
  }
  return { ...state, pool: spendResource(state.pool, 1), active: true };
}

export function endRage(state: RageState): RageState {
  if (!state.active) {
    return state;
  }
  return { ...state, active: false };
}

export function resetRageOnLongRest(level: number, state: RageState): RageState {
  const max = rageUsesForLevel(level);
  return { pool: { name: state.pool.name, current: max, max }, active: false };
}

/**
 * Barbarian Unarmored Defense AC (D&D 5e 2024).
 * AC = 10 + DEX modifier + CON modifier (no armor, shield allowed).
 */
export function barbarianUnarmoredDefenseAC(dexMod: number, conMod: number): number {
  return 10 + dexMod + conMod;
}

/**
 * Determines whether Rage should end at the start of the Barbarian's turn.
 * Rage ends if (didn't attack AND didn't take damage since last turn), OR if unconscious.
 */
export function shouldRageEnd(attacked: boolean, tookDamage: boolean, isUnconscious: boolean): boolean {
  return (!attacked && !tookDamage) || isUnconscious;
}

/**
 * Checks if Danger Sense is negated by conditions.
 * Danger Sense doesn't work if the Barbarian is Blinded, Deafened, or Incapacitated.
 */
export function isDangerSenseNegated(conditions: string[]): boolean {
  const negating = ["blinded", "deafened", "incapacitated"];
  return conditions.some(c => negating.includes(c.toLowerCase()));
}

/**
 * Rage Damage bonus by Barbarian level (D&D 5e 2024).
 * +2 at levels 1-8, +3 at levels 9-15, +4 at levels 16+.
 */
export function rageDamageBonusForLevel(level: number): number {
  if (level >= 16) return 4;
  if (level >= 9) return 3;
  return 2;
}

// ----- Brutal Strike (D&D 5e 2024, Level 9) -----

/** The three Brutal Strike options the attacker may choose from. */
export type BrutalStrikeOption = "forceful-blow" | "hamstring-blow" | "staggering-blow";

/**
 * Whether the barbarian can use Brutal Strike on this attack.
 * Requires: currently Raging AND used Reckless Attack this turn.
 */
export function canUseBrutalStrike(isRaging: boolean, usedRecklessAttack: boolean): boolean {
  return isRaging && usedRecklessAttack;
}

/**
 * Returns the bonus damage dice notation for Brutal Strike.
 * Adds one extra die of the weapon's damage type.
 * e.g. weapon "1d12" → bonus "1d12", weapon "2d6" → bonus "1d6".
 */
export function getBrutalStrikeBonusDice(weaponDamageDice: string): string {
  const match = weaponDamageDice.match(/(\d+)d(\d+)/);
  if (!match) return "1d6"; // safe fallback
  return `1d${match[2]}`;
}

/**
 * Barbarian Combat Text Profile — profile-driven text parsing.
 *
 * Action mappings:
 * - "rage" → bonus action, activates Rage
 * - "reckless-attack" → classAction (free), sets reckless flag for the turn
 */
export const BARBARIAN_COMBAT_TEXT_PROFILE: ClassCombatTextProfile = {
  classId: "barbarian",
  actionMappings: [
    {
      keyword: "rage",
      normalizedPatterns: [/^rage$|^userage$|^enterrage$/],
      abilityId: "class:barbarian:rage",
      category: "bonusAction",
    },
    {
      keyword: "reckless-attack",
      normalizedPatterns: [/recklessattack|reckless$/],
      abilityId: "class:barbarian:reckless-attack",
      category: "classAction",
    },
    {
      keyword: "brutal-strike",
      normalizedPatterns: [/brutalstrike|hamstringblow|hamstringblow|forcefulblow|staggeringblow/],
      abilityId: "class:barbarian:brutal-strike",
      category: "classAction",
    },
    {
      keyword: "frenzy",
      normalizedPatterns: [/^frenzy$|frenzyattack|frenziedstrike|^usefrenzy$/],
      abilityId: "class:barbarian:frenzy",
      category: "bonusAction",
    },
  ],
  attackEnhancements: [],
};

// ----- Subclasses -----

/** Path of the Berserker subclass (D&D 5e 2024). */
export const BerserkerSubclass: SubclassDefinition = {
  id: "berserker",
  name: "Path of the Berserker",
  classId: "barbarian",
  features: {
    "frenzy": 3,
    [MINDLESS_RAGE]: 6,
    [INTIMIDATING_PRESENCE]: 10,
  },
};

export const Barbarian: CharacterClassDefinition = {
  id: "barbarian",
  name: "Barbarian",
  hitDie: 12,
  proficiencies: {
    savingThrows: ["strength", "constitution"],
  },
  features: {
    "rage": 1,
    "unarmored-defense": 1,
    "weapon-mastery": 1,
    "reckless-attack": 2,
    "danger-sense": 2,
    "extra-attack": 5,
    "feral-instinct": 7,
    "brutal-strike": 9,
  },
  resourcesAtLevel: (level) => [createRageState(level).pool],
  resourcePoolFactory: (level) => [createRageState(level).pool],
  restRefreshPolicy: [
    { poolKey: "rage", refreshOn: "long", computeMax: (level) => rageUsesForLevel(level) },
  ],
  capabilitiesForLevel: (level): readonly ClassCapability[] => {
    const caps: ClassCapability[] = [
      { name: "Unarmored Defense", economy: "free", effect: "AC = 10 + DEX mod + CON mod (no armor)" },
      { name: "Rage", economy: "bonusAction", cost: "1 use/long rest", effect: "Resistance to B/P/S, bonus melee damage, advantage on STR checks/saves", abilityId: "class:barbarian:rage", resourceCost: { pool: "rage", amount: 1 } },
    ];
    if (level >= 2) {
      caps.push({ name: "Danger Sense", economy: "free", effect: "Advantage on DEX saving throws against effects you can see" });
      caps.push({ name: "Reckless Attack", economy: "free", requires: "First attack on your turn", effect: "Gain advantage on melee STR attacks this turn; attacks against you have advantage", abilityId: "class:barbarian:reckless-attack" });
    }
    if (level >= 5) {
      caps.push({ name: "Extra Attack", economy: "action", requires: "Attack action", effect: "Attack twice per Attack action" });
    }
    if (level >= 7) {
      caps.push({ name: "Feral Instinct", economy: "free", effect: "Advantage on initiative; can't be surprised unless incapacitated" });
    }
    if (level >= 9) {
      caps.push({ name: "Brutal Strike", economy: "free", requires: "Raging + Reckless Attack hit", effect: "Extra weapon die + choose: Forceful Blow (push 15ft/prone), Hamstring Blow (-15ft speed), or Staggering Blow (disadvantage on next attack)" });
    }
    // Berserker subclass capabilities
    if (level >= 3) {
      caps.push({ name: "Frenzy", economy: "bonusAction", requires: "While raging", effect: "Make one extra melee weapon attack as a bonus action", abilityId: "class:barbarian:frenzy", requiresSubclass: "berserker" });
    }
    return caps;
  },
  subclasses: [BerserkerSubclass],
};
