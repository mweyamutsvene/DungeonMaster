import type { ResourcePool } from "../combat/resource-pool.js";
import { spendResource } from "../combat/resource-pool.js";
import type { CharacterClassDefinition, ClassCapability, SubclassDefinition } from "./class-definition.js";
import type { ClassCombatTextProfile, AttackReactionDef, AttackReactionInput, DetectedAttackReaction } from "./combat-text-profile.js";
import { REMARKABLE_ATHLETE, ADDITIONAL_FIGHTING_STYLE, HEROIC_WARRIOR, SURVIVOR } from "./feature-keys.js";
import { proficiencyBonusForLevel } from "../../rules/proficiency.js";

export interface ActionSurgeState {
  pool: ResourcePool;
}

export interface SecondWindState {
  pool: ResourcePool;
}

export function actionSurgeUsesForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > 20) {
    throw new Error(`Invalid level: ${level}`);
  }

  if (level < 2) return 0;
  if (level < 17) return 1;
  return 2;
}

export function createActionSurgeState(level: number): ActionSurgeState {
  const max = actionSurgeUsesForLevel(level);
  return { pool: { name: "actionSurge", current: max, max } };
}

export function spendActionSurge(state: ActionSurgeState, amount: number): ActionSurgeState {
  return { pool: spendResource(state.pool, amount) };
}

export function resetActionSurgeOnShortRest(
  level: number,
  state: ActionSurgeState,
): ActionSurgeState {
  const max = actionSurgeUsesForLevel(level);
  return { pool: { name: state.pool.name, current: max, max } };
}

export function secondWindUsesForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > 20) {
    throw new Error(`Invalid level: ${level}`);
  }

  // Second Wind is gained at level 1 and remains 1 use.
  return 1;
}

export function createSecondWindState(level: number): SecondWindState {
  const max = secondWindUsesForLevel(level);
  return { pool: { name: "secondWind", current: max, max } };
}

export function spendSecondWind(state: SecondWindState, amount: number): SecondWindState {
  return { pool: spendResource(state.pool, amount) };
}

export function resetSecondWindOnShortRest(level: number, state: SecondWindState): SecondWindState {
  const max = secondWindUsesForLevel(level);
  return { pool: { name: state.pool.name, current: max, max } };
}

// ----- Indomitable -----

export interface IndomitableState {
  pool: ResourcePool;
}

export function indomitableUsesForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > 20) {
    throw new Error(`Invalid level: ${level}`);
  }
  if (level < 9) return 0;
  if (level < 13) return 1;
  if (level < 17) return 2;
  return 3;
}

export function createIndomitableState(level: number): IndomitableState {
  const max = indomitableUsesForLevel(level);
  return { pool: { name: "indomitable", current: max, max } };
}

export function spendIndomitable(state: IndomitableState, amount: number): IndomitableState {
  return { pool: spendResource(state.pool, amount) };
}

export function resetIndomitableOnLongRest(level: number, state: IndomitableState): IndomitableState {
  const max = indomitableUsesForLevel(level);
  return { pool: { name: state.pool.name, current: max, max } };
}

// ----- Subclasses -----

/** Champion Fighter subclass (D&D 5e 2024). */
export const ChampionSubclass: SubclassDefinition = {
  id: "champion",
  name: "Champion",
  classId: "fighter",
  features: {
    "improved-critical": 3,
    [REMARKABLE_ATHLETE]: 3,
    [ADDITIONAL_FIGHTING_STYLE]: 7,
    [HEROIC_WARRIOR]: 10,
    "superior-critical": 15,
    [SURVIVOR]: 18,
  },
};

export const Fighter: CharacterClassDefinition = {
  id: "fighter",
  name: "Fighter",
  hitDie: 10,
  proficiencies: {
    savingThrows: ["strength", "constitution"],
    armor: ["light", "medium", "heavy", "shield"],
  },
  features: {
    "fighting-style": 1,
    "weapon-mastery": 1,
    "second-wind": 1,
    "action-surge": 2,
    "extra-attack": 5,
    "indomitable": 9,
    "two-extra-attacks": 11,
    "three-extra-attacks": 20,
  },
  resourcesAtLevel: (level) => {
    const pools: ResourcePool[] = [];
    const actionSurge = createActionSurgeState(level);
    if (actionSurge.pool.max > 0) pools.push(actionSurge.pool);

    const secondWind = createSecondWindState(level);
    if (secondWind.pool.max > 0) pools.push(secondWind.pool);
const indomitable = createIndomitableState(level);
    if (indomitable.pool.max > 0) pools.push(indomitable.pool);

    return pools;
  },
  restRefreshPolicy: [
    { poolKey: "actionSurge", refreshOn: "both", computeMax: (level) => actionSurgeUsesForLevel(level) },
    { poolKey: "secondWind", refreshOn: "both", computeMax: (level) => secondWindUsesForLevel(level) },
    { poolKey: "indomitable", refreshOn: "long", computeMax: (level) => indomitableUsesForLevel(level) },
  ],
  capabilitiesForLevel: (level): readonly ClassCapability[] => {
    const caps: ClassCapability[] = [
      { name: "Second Wind", economy: "bonusAction", cost: "1 use/short rest", effect: "Regain 1d10 + Fighter level HP", abilityId: "class:fighter:second-wind", resourceCost: { pool: "secondWind", amount: 1 } },
    ];
    if (level >= 2) {
      caps.push({ name: "Action Surge", economy: "free", cost: "1 use/short rest", effect: "Take one additional action this turn", abilityId: "class:fighter:action-surge", resourceCost: { pool: "actionSurge", amount: 1 } });
    }
    if (level >= 20) {
      caps.push({ name: "Extra Attack", economy: "action", requires: "Attack action", effect: "Attack four times per Attack action" });
    } else if (level >= 11) {
      caps.push({ name: "Extra Attack", economy: "action", requires: "Attack action", effect: "Attack three times per Attack action" });
    } else if (level >= 5) {
      caps.push({ name: "Extra Attack", economy: "action", requires: "Attack action", effect: "Attack twice per Attack action" });
    }
    if (level >= 9) {
      caps.push({ name: "Indomitable", economy: "free", cost: `${indomitableUsesForLevel(level)} use${indomitableUsesForLevel(level) > 1 ? "s" : ""}/long rest`, effect: "Reroll a failed saving throw", abilityId: "class:fighter:indomitable", resourceCost: { pool: "indomitable", amount: 1 } });
    }
    return caps;
  },
  subclasses: [ChampionSubclass],
};

// ----- Fighting Style Reactions -----

/**
 * Condition ids that disable ally-scan fighting-style reactions (Protection,
 * Interception). If the protector has any of these, the reaction cannot fire.
 */
const PROTECTOR_DISABLING_CONDITIONS: readonly string[] = [
  "incapacitated",
  "unconscious",
  "stunned",
  "paralyzed",
  "petrified",
];

function protectorIsDisabled(activeConditions: readonly string[] | undefined): boolean {
  if (!activeConditions || activeConditions.length === 0) return false;
  for (const c of activeConditions) {
    if (PROTECTOR_DISABLING_CONDITIONS.includes(c.toLowerCase())) return true;
  }
  return false;
}

/**
 * Protection fighting style reaction (D&D 5e 2024).
 * When a creature you can see attacks a target (other than you) within 5 feet of you,
 * you can use your reaction to impose disadvantage on the attack roll.
 * Requires: shield, reaction available, within 5ft of the target being attacked.
 *
 * This is an ally-scan reaction: the reactor is the *protector* (an ally of
 * the attack target), not the target. The scan loop in AttackReactionHandler
 * builds one `AttackReactionInput` per eligible nearby ally with the
 * protector's class/resources/conditions.
 *
 * v1 wired for normal attacks; OA path TODO.
 */
const PROTECTION_REACTION: AttackReactionDef = {
  reactionType: "protection",
  classId: "fighter",
  detect(input: AttackReactionInput): DetectedAttackReaction | null {
    if (!input.hasReaction || !input.isCharacter) return null;

    // Must have Protection fighting style selected
    if (input.resources.hasProtectionStyle !== true) return null;

    // Must have a shield equipped
    if (input.resources.hasShieldEquipped !== true) return null;

    // Protector must not be Incapacitated/Unconscious/Stunned/Paralyzed/Petrified
    if (protectorIsDisabled(input.activeConditions)) return null;

    return {
      reactionType: "protection",
      context: {
        attackerId: input.attackerId,
        attackRoll: input.attackRoll,
        effect: "disadvantage",
      },
    };
  },
};

/**
 * Interception fighting style reaction (D&D 5e 2024).
 * When a creature you can see hits a target within 5 feet of you with an attack,
 * you can use your reaction to reduce the damage by 1d10 + your proficiency bonus (min 0).
 * You must be wielding a shield or a simple/martial weapon.
 *
 * This is an ally-scan reaction: the reactor is the *protector*, not the target.
 *
 * v1 wired for normal attacks; OA path TODO.
 */
const INTERCEPTION_REACTION: AttackReactionDef = {
  reactionType: "interception",
  classId: "fighter",
  detect(input: AttackReactionInput): DetectedAttackReaction | null {
    if (!input.hasReaction || !input.isCharacter) return null;

    // Must have Interception fighting style selected
    if (input.resources.hasInterceptionStyle !== true) return null;

    // Must have a shield or weapon equipped
    if (input.resources.hasShieldEquipped !== true && input.resources.hasWeaponEquipped !== true) return null;

    // Protector must not be Incapacitated/Unconscious/Stunned/Paralyzed/Petrified
    if (protectorIsDisabled(input.activeConditions)) return null;

    const profBonus = proficiencyBonusForLevel(input.level);

    return {
      reactionType: "interception",
      context: {
        attackerId: input.attackerId,
        attackRoll: input.attackRoll,
        profBonus,
        damageReduction: `1d10+${profBonus}`,
      },
    };
  },
};

/** Combat text profile — maps text patterns to Fighter ability IDs. */
export const FIGHTER_COMBAT_TEXT_PROFILE: ClassCombatTextProfile = {
  classId: "fighter",
  actionMappings: [
    { keyword: "action-surge", normalizedPatterns: [/actionsurge|useactionsurge/], abilityId: "class:fighter:action-surge", category: "classAction" },
    { keyword: "second-wind", normalizedPatterns: [/secondwind|usesecondwind/], abilityId: "class:fighter:second-wind", category: "bonusAction" },
    { keyword: "indomitable", normalizedPatterns: [/indomitable|useindomitable/], abilityId: "class:fighter:indomitable", category: "classAction" },
  ],
  attackEnhancements: [],
  allyAttackReactions: [PROTECTION_REACTION, INTERCEPTION_REACTION],
};
