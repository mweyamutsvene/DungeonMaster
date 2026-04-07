import type { ResourcePool } from "../entities/combat/resource-pool.js";
import type { CharacterClassId, HitDie } from "../entities/classes/class-definition.js";
import type { DiceRoller } from "./dice-roller.js";
import type { FeatModifiers } from "./feat-modifiers.js";
import { getClassDefinition } from "../entities/classes/registry.js";
import { LUCKY_POINTS_MAX } from "./lucky.js";

export type RestType = "short" | "long";

export interface RefreshClassResourcePoolsOptions {
  classId: CharacterClassId;
  level: number;
  rest: RestType;

  pools: readonly ResourcePool[];

  /**
   * Required only when refreshing Bardic Inspiration.
   */
  charismaModifier?: number;

  /**
   * Required only when refreshing Wholeness of Body (Monk).
   */
  wisdomModifier?: number;
}

function shouldRefreshOnRest(poolName: string, rest: RestType, level: number, classId: CharacterClassId): boolean {
  // Spell slot pools (spellSlot_1, spellSlot_2, etc.) refresh on long rest only
  if (poolName.startsWith("spellSlot_")) {
    return rest === "long";
  }

  const def = getClassDefinition(classId);
  const policy = def.restRefreshPolicy?.find((p) => p.poolKey === poolName);
  if (!policy) return false;

  if (typeof policy.refreshOn === "function") {
    return policy.refreshOn(rest, level);
  }
  if (policy.refreshOn === "both") return true;
  return policy.refreshOn === rest;
}

function computeMaxForPool(
  options: RefreshClassResourcePoolsOptions,
  poolName: string,
  currentMax: number,
): number {
  const { classId, level } = options;

  const def = getClassDefinition(classId);
  const policy = def.restRefreshPolicy?.find((p) => p.poolKey === poolName);
  if (!policy?.computeMax) return currentMax;

  const hasAbilityMod = options.charismaModifier !== undefined || options.wisdomModifier !== undefined;
  const abilityModifiers: Record<string, number> | undefined = hasAbilityMod
    ? {
        ...(options.charismaModifier !== undefined ? { charisma: options.charismaModifier } : {}),
        ...(options.wisdomModifier !== undefined ? { wisdom: options.wisdomModifier } : {}),
      }
    : undefined;

  return policy.computeMax(level, abilityModifiers);
}

export function refreshClassResourcePools(
  options: RefreshClassResourcePoolsOptions,
): ResourcePool[] {
  return options.pools.map((pool) => {
    if (!shouldRefreshOnRest(pool.name, options.rest, options.level, options.classId)) {
      return pool;
    }

    // Spell slot pools use their stored max directly
    if (pool.name.startsWith("spellSlot_")) {
      return { ...pool, current: pool.max };
    }

    const max = computeMaxForPool(options, pool.name, pool.max);
    return { ...pool, current: max, max };
  });
}

// ---------------------------------------------------------------------------
// Hit Dice — spending (short rest) & recovery (long rest)
// ---------------------------------------------------------------------------

export interface SpendHitDiceInput {
  hitDiceRemaining: number;
  hitDie: HitDie;
  conModifier: number;
  count: number;
  currentHp: number;
  maxHp: number;
  diceRoller: DiceRoller;
}

export interface SpendHitDiceResult {
  hpRecovered: number;
  newHp: number;
  hitDiceRemaining: number;
  rolls: number[];
}

/**
 * D&D 5e 2024: During a short rest, spend Hit Dice to recover HP.
 * For each die spent, roll the hit die + CON modifier (minimum 1 HP per die).
 */
export function spendHitDice(input: SpendHitDiceInput): SpendHitDiceResult {
  const { hitDiceRemaining, hitDie, conModifier, count, currentHp, maxHp, diceRoller } = input;

  const diceToSpend = Math.min(count, hitDiceRemaining);
  if (diceToSpend <= 0) {
    return { hpRecovered: 0, newHp: currentHp, hitDiceRemaining, rolls: [] };
  }

  const rolls: number[] = [];
  let totalHealing = 0;

  for (let i = 0; i < diceToSpend; i++) {
    const roll = diceRoller.rollDie(hitDie);
    const healing = Math.max(1, roll.total + conModifier);
    rolls.push(roll.total);
    totalHealing += healing;
  }

  const newHp = Math.min(currentHp + totalHealing, maxHp);

  return {
    hpRecovered: newHp - currentHp,
    newHp,
    hitDiceRemaining: hitDiceRemaining - diceToSpend,
    rolls,
  };
}

/**
 * D&D 5e 2024: On a long rest, recover spent Hit Dice.
 * Regain up to half your total Hit Dice (rounded down, minimum 1).
 */
export function recoverHitDice(hitDiceRemaining: number, totalHitDice: number): number {
  const recoverable = Math.max(1, Math.floor(totalHitDice / 2));
  return Math.min(hitDiceRemaining + recoverable, totalHitDice);
}

// ---------------------------------------------------------------------------
// Rest Interruption
// ---------------------------------------------------------------------------

export type RestInterruptionReason = "combat" | "damage" | "spellcast";

export interface RestInterruptionResult {
  interrupted: boolean;
  reason?: RestInterruptionReason;
}

/**
 * D&D 5e 2024: Detect whether a rest has been interrupted by checking events
 * that occurred since the rest began.
 *
 * - Short rest: interrupted by combat (`CombatStarted`)
 * - Long rest: interrupted by combat (`CombatStarted`), taking damage (`DamageApplied`),
 *   or casting a non-cantrip spell (`SpellCastDuringRest`)
 *
 * Application layer is responsible for emitting a `SpellCastDuringRest` event when
 * a spell of level >= 1 is cast during the long rest hour.
 */
export function detectRestInterruption(
  restType: RestType,
  events: ReadonlyArray<{ type: string }>,
): RestInterruptionResult {
  for (const event of events) {
    if (event.type === "CombatStarted") {
      return { interrupted: true, reason: "combat" };
    }
    if (event.type === "DamageApplied" && restType === "long") {
      return { interrupted: true, reason: "damage" };
    }
    // SpellCastDuringRest: emitted by the application layer when a non-cantrip
    // (level >= 1) spell is cast during a long rest. RAW (2024): casting a spell
    // during a long rest hour interrupts it; cantrips are permitted.
    if (event.type === "SpellCastDuringRest" && restType === "long") {
      return { interrupted: true, reason: "spellcast" };
    }
  }
  return { interrupted: false };
}

// ---------------------------------------------------------------------------
// Feat resource restoration
// ---------------------------------------------------------------------------

/**
 * Restore Lucky feat points on a long rest.
 * Lucky grants 3 luck points per long rest; this resets the count to max.
 * @returns Updated FeatModifiers with luckPoints reset to max (3), or
 *          the original modifiers unchanged if not a long rest or Lucky not present.
 */
export function restoreFeatLuckPoints(featModifiers: FeatModifiers, rest: RestType): FeatModifiers {
  if (rest !== "long" || !featModifiers.luckyEnabled) {
    return featModifiers;
  }
  return { ...featModifiers, luckPoints: LUCKY_POINTS_MAX };
}
