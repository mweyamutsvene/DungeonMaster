import type { ResourcePool } from "../combat/resource-pool.js";
import { spendResource } from "../combat/resource-pool.js";
import type { CharacterClassDefinition, ClassCapability, SubclassDefinition } from "./class-definition.js";
import type { ClassCombatTextProfile, AttackReactionDef, AttackReactionInput, DetectedAttackReaction } from "./combat-text-profile.js";
import { DEFLECT_ATTACKS } from "./feature-keys.js";
import { classHasFeature } from "./registry.js";
import { proficiencyBonusForLevel } from "../../rules/proficiency.js";
import { getMartialArtsDieSize } from "../../rules/martial-arts-die.js";

export interface KiState {
  pool: ResourcePool;
}

export function kiPointsForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > 20) {
    throw new Error(`Invalid level: ${level}`);
  }

  // Ki starts at level 2 and equals monk level.
  return level < 2 ? 0 : level;
}

export function createKiState(level: number): KiState {
  const max = kiPointsForLevel(level);
  return { pool: { name: "ki", current: max, max } };
}

export function spendKi(state: KiState, amount: number): KiState {
  return { pool: spendResource(state.pool, amount) };
}

export function resetKiOnShortRest(level: number, state: KiState): KiState {
  const max = kiPointsForLevel(level);
  return { pool: { name: state.pool.name, current: max, max } };
}

/**
 * Monk Unarmored Defense AC (D&D 5e 2024).
 * AC = 10 + DEX modifier + WIS modifier (no armor, shield allowed).
 */
export function monkUnarmoredDefenseAC(dexMod: number, wisMod: number): number {
  return 10 + dexMod + wisMod;
}

/**
 * Get Wholeness of Body uses per long rest.
 * D&D 5e 2024: Monk level 6+ (Open Hand subclass), uses = Wisdom modifier (minimum 1).
 */
export function wholenessOfBodyUsesForLevel(level: number, wisdomModifier = 0): number {
  if (level < 6) return 0;
  return Math.max(1, wisdomModifier);
}

/**
 * Get Uncanny Metabolism uses per long rest.
 * D&D 5e 2024: Monk level 2+, 1 use per long rest.
 */
export function uncannyMetabolismUsesForLevel(level: number): number {
  return level >= 2 ? 1 : 0;
}

/**
 * Build all Monk resource pools for a given level.
 * Optional wisdomModifier is needed for Wholeness of Body.
 * Optional subclassId gates Wholeness of Body to Way of the Open Hand.
 */
export function getMonkResourcePools(level: number, wisdomModifier = 0, subclassId?: string): ResourcePool[] {
  const normalizedSubclass = subclassId?.toLowerCase().replace(/\s+/g, "-");
  const pools: ResourcePool[] = [];

  // Ki / Focus Points (level 2+)
  const ki = createKiState(level);
  if (ki.pool.max > 0) pools.push(ki.pool);

  // Uncanny Metabolism (level 2+, 1/long rest)
  const umUses = uncannyMetabolismUsesForLevel(level);
  if (umUses > 0) pools.push({ name: "uncanny_metabolism", current: umUses, max: umUses });

  // Wholeness of Body (level 6+, Open Hand subclass only — uses = WIS mod, min 1)
  if (normalizedSubclass === "open-hand") {
    const wbUses = wholenessOfBodyUsesForLevel(level, wisdomModifier);
    if (wbUses > 0) pools.push({ name: "wholeness_of_body", current: wbUses, max: wbUses });
  }

  return pools;
}

// ----- Subclasses -----

/** Way of the Open Hand subclass (D&D 5e 2024). */
export const OpenHandSubclass: SubclassDefinition = {
  id: "open-hand",
  name: "Way of the Open Hand",
  classId: "monk",
  features: {
    "open-hand-technique": 3,
    "wholeness-of-body": 6,
  },
};

export const Monk: CharacterClassDefinition = {
  id: "monk",
  name: "Monk",
  hitDie: 8,
  proficiencies: {
    savingThrows: ["strength", "dexterity"],
  },
  features: {
    "martial-arts": 1,
    "unarmored-defense": 1,
    "flurry-of-blows": 2,
    "patient-defense": 2,
    "step-of-the-wind": 2,
    "uncanny-metabolism": 2,
    "deflect-attacks": 3,
    "stunning-strike": 5,
    "extra-attack": 5,
    "evasion": 7,
  },
  resourcesAtLevel: (level, abilityModifiers, subclassId) => {
    const wisdomModifier = abilityModifiers?.wisdom ?? 0;
    return getMonkResourcePools(level, wisdomModifier, subclassId);
  },
  // resourcePoolFactory intentionally returns only ki — matching the character-sheet default.
  // Combat initialization uses getMonkResourcePools() directly for all monk pools.
  resourcePoolFactory: (level) => {
    const ki = createKiState(level);
    return ki.pool.max > 0 ? [ki.pool] : [];
  },
  restRefreshPolicy: [
    { poolKey: "ki", refreshOn: "both", computeMax: (level) => kiPointsForLevel(level) },
    { poolKey: "uncanny_metabolism", refreshOn: "long", computeMax: (level) => uncannyMetabolismUsesForLevel(level) },
    { poolKey: "wholeness_of_body", refreshOn: "long", computeMax: (level, abilityModifiers) => wholenessOfBodyUsesForLevel(level, abilityModifiers?.wisdom ?? 0) },
  ],
  capabilitiesForLevel: (level): readonly ClassCapability[] => {
    if (level < 2) return [];
    const caps: ClassCapability[] = [
      { name: "Flurry of Blows", economy: "bonusAction", cost: "1 ki", requires: "After the Attack action", effect: "Make two Unarmed Strikes", abilityId: "class:monk:flurry-of-blows", resourceCost: { pool: "ki", amount: 1 }, executionIntent: { kind: "flurry-of-blows", unarmedStrikes: 2 } },
      { name: "Patient Defense", economy: "bonusAction", cost: "1 ki", requires: "On your turn", effect: "Take the Dodge action", abilityId: "class:monk:patient-defense", resourceCost: { pool: "ki", amount: 1 } },
      { name: "Step of the Wind", economy: "bonusAction", cost: "1 ki", requires: "On your turn", effect: "Disengage or Dash, doubled jump", abilityId: "class:monk:step-of-the-wind", resourceCost: { pool: "ki", amount: 1 } },
      { name: "Martial Arts (Bonus)", economy: "bonusAction", requires: "After the Attack action", effect: "One Unarmed Strike", abilityId: "class:monk:martial-arts" },
    ];
    if (level >= 3) {
      caps.push({ name: "Deflect Attacks", economy: "reaction", requires: "Hit by a melee or ranged attack", effect: "Reduce damage by 1d10 + DEX mod + Monk level", abilityId: "class:monk:deflect-attacks" });
    }
    if (level >= 5) {
      caps.push({ name: "Stunning Strike", economy: "free", cost: "1 ki", requires: "Hit with a melee attack", effect: "Target must CON save or be Stunned", abilityId: "class:monk:stunning-strike", resourceCost: { pool: "ki", amount: 1 } });
    }
    if (level >= 6) {
      caps.push({ name: "Wholeness of Body", economy: "bonusAction", requires: "On your turn", effect: "Regain HP equal to Martial Arts die + WIS mod", abilityId: "class:monk:wholeness-of-body", requiresSubclass: "open-hand" });
    }
    return caps;
  },
  subclasses: [OpenHandSubclass],
};

// ----- Attack Reaction: Deflect Attacks -----

/**
 * Deflect Attacks reaction detection (Monk level 3+).
 * Reduces incoming attack damage by 1d10 + DEX mod + Monk level.
 * If damage is reduced to 0, monk can spend 1 Focus Point (ki) to redirect:
 *   ranged Unarmed Strike (60 ft), DEX + proficiency to hit,
 *   2 × Martial Arts die + DEX mod Force damage.
 * Uses reaction; no resource cost for the deflection itself.
 */
const DEFLECT_ATTACKS_REACTION: AttackReactionDef = {
  reactionType: "deflect_attacks",
  classId: "monk",
  detect(input: AttackReactionInput): DetectedAttackReaction | null {
    if (!input.hasReaction || !input.isCharacter) return null;
    if (!classHasFeature(input.className, DEFLECT_ATTACKS, input.level)) return null;

    const dexScore = input.abilityScores.dexterity ?? 10;
    const dexMod = Math.floor((dexScore - 10) / 2);
    const maxReduction = 10 + dexMod + input.level; // 1d10 (max) + DEX mod + Monk level

    return {
      reactionType: "deflect_attacks",
      context: {
        attackerId: input.attackerId,
        attackRoll: input.attackRoll,
        maxReduction,
        dexMod,
        monkLevel: input.level,
        proficiencyBonus: proficiencyBonusForLevel(input.level),
        martialArtsDieSize: getMartialArtsDieSize(input.level),
      },
    };
  },
};

/** Combat text profile — maps text patterns to Monk ability IDs. */
export const MONK_COMBAT_TEXT_PROFILE: ClassCombatTextProfile = {
  classId: "monk",
  actionMappings: [
    // Flurry pattern uses negative lookbehind to avoid matching compound intents
    // like "attackwithflurryofblows" — the player should attack first, then flurry.
    // Matches: "flurry", "flurryofblows", "useflurry", "useflurryofblows"
    // Does NOT match: "attackwithflurry", "iwillattackwithflurryofblows"
    { keyword: "flurry-of-blows", normalizedPatterns: [/(?<!attack.*?)flurry|^flurryofblows$/], abilityId: "class:monk:flurry-of-blows", category: "bonusAction" },
    { keyword: "patient-defense", normalizedPatterns: [/patientdefense/], abilityId: "class:monk:patient-defense", category: "bonusAction" },
    // step-of-the-wind-dash MUST be before step-of-the-wind (longer match first)
    { keyword: "step-of-the-wind-dash", normalizedPatterns: [/stepofthewinddash/], abilityId: "class:monk:step-of-the-wind-dash", category: "bonusAction" },
    { keyword: "step-of-the-wind", normalizedPatterns: [/stepofthewind/], abilityId: "class:monk:step-of-the-wind", category: "bonusAction" },
    { keyword: "martial-arts", normalizedPatterns: [/martialarts|bonusunarmed|bonusstrike/], abilityId: "class:monk:martial-arts", category: "bonusAction" },
    { keyword: "wholeness-of-body", normalizedPatterns: [/wholenessofbody/], abilityId: "class:monk:wholeness-of-body", category: "bonusAction" },
  ],
  attackEnhancements: [
    {
      keyword: "stunning-strike",
      displayName: "Stunning Strike",
      patterns: [/\bstun(?:ning)?\s*(?:strike)?\b/],
      minLevel: 5,
      resourceCost: { pool: "ki", amount: 1 },
      turnTrackingKey: "stunningStrikeUsedThisTurn",
      requiresMelee: true,
      trigger: "onHit",
    },
    {
      keyword: "open-hand-technique",
      displayName: "Open Hand Technique",
      patterns: [/\b(addle|push|topple)\b/],
      minLevel: 3,
      requiresSubclass: "open-hand",
      requiresMelee: true,
      trigger: "onHit",
      choiceOptions: ["addle", "push", "topple"],
      requiresBonusAction: "flurry-of-blows",
    },
  ],
  attackReactions: [DEFLECT_ATTACKS_REACTION],
};
