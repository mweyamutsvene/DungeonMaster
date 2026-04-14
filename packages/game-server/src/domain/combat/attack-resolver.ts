import type { Creature } from "../entities/creatures/creature.js";
import type { Ability } from "../entities/core/ability-scores.js";
import type { DiceRoller, DiceRoll } from "../rules/dice-roller.js";
import { rollD20, type RollMode } from "../rules/advantage.js";
import {
  applyDamageDieMinimum,
  computeFeatModifiers,
  shouldApplyGreatWeaponFighting,
  shouldApplyDueling,
  type AttackKind,
  type WeaponContext,
} from "../rules/feat-modifiers.js";
import { applyDamageDefenses, type DamageDefenses, type DamageDefenseResult, type DamageType } from "../rules/damage-defenses.js";
import { hasProperty } from "../entities/items/weapon-properties.js";
import { getAdjustedMode } from "../rules/ability-checks.js";
import { getCriticalHitThreshold } from "../entities/classes/registry.js";

export interface DamageSpec {
  diceCount: number;
  diceSides: number;
  modifier?: number;
}

export interface AttackSpec {
  name?: string;
  kind?: AttackKind;
  /**
   * Ability used for the attack roll. If omitted, defaults to Dexterity for ranged
   * and Strength for melee.
   */
  attackAbility?: Ability;

  /**
   * Optional advantage/disadvantage for the attack roll.
   * Additional sources (e.g. armor training penalties) may adjust this.
   */
  mode?: RollMode;
  attackBonus: number;
  damage: DamageSpec;

  /**
   * Damage type (e.g. "slashing", "fire", "bludgeoning").
   * Used for resistance/immunity/vulnerability calculations.
   */
  damageType?: string;

  /**
   * Additional damage types dealt alongside the primary damage.
   * D&D 5e 2024: each damage type is checked separately against defenses.
   * Example: Flame Tongue (slashing primary + fire additional).
   */
  additionalDamage?: Array<{ dice: string; damageType: DamageType }>;

  /**
   * Optional weapon context used for feat interactions (e.g. Great Weapon Fighting).
   */
  weapon?: WeaponContext;
}

export interface AttackRoll {
  d20: number;
  total: number;
}

/** Result for a single additional damage type. */
export interface AdditionalDamageResult {
  damageType: string;
  roll: DiceRoll;
  rawDamage: number;
  applied: number;
  defenseApplied?: DamageDefenseResult["defenseApplied"];
}

export interface AttackResult {
  hit: boolean;
  critical: boolean;
  /** Whether a Lucky feat reroll was used on the attack roll. */
  luckyUsed: boolean;
  /** Whether Savage Attacker was used on this attack (once per turn). */
  savageAttackerUsed: boolean;
  attack: AttackRoll;
  damage: {
    applied: number;
    roll: DiceRoll;
    /** Defense that was applied (resistance/vulnerability/immunity/none) */
    defenseApplied?: DamageDefenseResult["defenseApplied"];
    /** Damage type of the attack */
    damageType?: string;
    /** Breakdown of additional damage types (each checked separately against defenses) */
    additionalDamageResults?: AdditionalDamageResult[];
  };
}

export interface AttackResolveOptions {
  targetDefenses?: DamageDefenses;
  /** Distance in feet between attacker and target. Used for auto-crit on Paralyzed/Unconscious. */
  attackerDistance?: number;
  /** Whether the attacker is the source of a Grappled condition on the target (Grappler feat → advantage). */
  attackerIsGrapplingTarget?: boolean;
  /** Whether terrain elevation grants advantage for this attack. */
  elevationAdvantage?: boolean;
  /**
   * D&D 5e 2024: Savage Attacker can only be used once per turn.
   * Set to true if Savage Attacker has already been used this turn.
   */
  savageAttackerUsedThisTurn?: boolean;
}

/**
 * D&D 5e 2024: A melee hit on a Paralyzed or Unconscious creature is automatically
 * a critical hit if the attacker is within 5 feet.
 */
export function isAutoCriticalHit(
  target: Creature,
  attackKind: AttackKind | undefined,
  attackerDistance: number | undefined,
): boolean {
  const isMelee = attackKind !== "ranged";
  const isWithin5Feet = attackerDistance !== undefined ? attackerDistance <= 5 : true;
  // Guard: adapter objects may lack hasCondition()
  if (typeof target.hasCondition !== "function") return false;
  const hasAutocrittableCondition =
    target.hasCondition("paralyzed") || target.hasCondition("unconscious");
  return isMelee && isWithin5Feet && hasAutocrittableCondition;
}

export function resolveAttack(
  diceRoller: DiceRoller,
  attacker: Creature,
  target: Creature,
  spec: AttackSpec,
  options?: AttackResolveOptions,
): AttackResult {
  // Stage 2.2: basic attack resolution.
  // Advantage/disadvantage and special effects come later (Stage 3).

  const inferredDefault: Ability = spec.kind === "ranged" ? "dexterity" : "strength";
  const isFinesseMelee =
    spec.kind !== "ranged" && hasProperty(spec.weapon?.properties, "finesse");

  const attackAbility: Ability =
    spec.attackAbility ??
    (isFinesseMelee
      ? attacker.getAbilityModifier("dexterity") >= attacker.getAbilityModifier("strength")
        ? "dexterity"
        : "strength"
      : inferredDefault);

  // Compute feat modifiers early so they can influence the attack roll mode
  const featIds = attacker.getFeatIds();
  const featMods = computeFeatModifiers(featIds);

  let baseMode: RollMode = spec.mode ?? "normal";

  if (options?.elevationAdvantage) {
    baseMode = baseMode === "disadvantage" ? "normal" : "advantage";
  }

  // Grappler feat: advantage on attack rolls against a creature grappled by you
  if (featMods.grapplerEnabled && options?.attackerIsGrapplingTarget) {
    baseMode = baseMode === "disadvantage" ? "normal" : "advantage";
  }

  const mode = getAdjustedMode(attacker, attackAbility, baseMode);

  const outcome = rollD20(diceRoller, mode);
  let d20 = outcome.chosen;
  let naturalMiss = d20 === 1;
  let critical = d20 === 20;

  // Champion Fighter: expanded critical range (Improved Critical 19+, Superior Critical 18+)
  if (!critical) {
    const classId = attacker.getClassId();
    const subclassId = attacker.getSubclass();
    const charLevel = attacker.getLevel();
    if (classId && charLevel) {
      const critThreshold = getCriticalHitThreshold(classId, charLevel, subclassId);
      if (d20 >= critThreshold) critical = true;
    }
  }

  let attackBonus = spec.attackBonus;
  if (spec.kind === "ranged") {
    attackBonus += featMods.rangedAttackBonus;
  }

  let total = d20 + attackBonus;
  let hit = !naturalMiss && (critical || total >= target.getAC());

  // D&D 5e 2024: Paralyzed/Unconscious auto-crit on melee within 5ft
  if (hit && !critical && isAutoCriticalHit(target, spec.kind, options?.attackerDistance)) {
    critical = true;
  }

  let luckyUsed = false;

  const damageDiceCount = critical ? spec.damage.diceCount * 2 : spec.damage.diceCount;
  let damageRoll = diceRoller.rollDie(
    spec.damage.diceSides,
    damageDiceCount,
    spec.damage.modifier ?? 0,
  );

  // Savage Attacker: roll weapon damage dice twice, use higher (once per turn).
  // D&D 5e 2024: "once per turn" — skip if already used this turn.
  let savageAttackerUsed = false;
  if (hit && featMods.savageAttackerEnabled && !options?.savageAttackerUsedThisTurn) {
    const secondRoll = diceRoller.rollDie(
      spec.damage.diceSides,
      damageDiceCount,
      spec.damage.modifier ?? 0,
    );
    if (secondRoll.total > damageRoll.total) {
      damageRoll = secondRoll;
    }
    savageAttackerUsed = true;
  }

  // Great Weapon Fighting: treat any 1-2 on weapon damage dice as 3.
  if (
    featMods.greatWeaponFightingDamageDieMinimum > 0 &&
    shouldApplyGreatWeaponFighting({ attackKind: spec.kind, weapon: spec.weapon })
  ) {
    damageRoll = applyDamageDieMinimum(damageRoll, featMods.greatWeaponFightingDamageDieMinimum);
  }

  // Dueling: +2 bonus to damage when wielding a one-handed melee weapon.
  if (
    featMods.duelingDamageBonus > 0 &&
    shouldApplyDueling({ attackKind: spec.kind, weapon: spec.weapon })
  ) {
    damageRoll = {
      ...damageRoll,
      total: damageRoll.total + featMods.duelingDamageBonus,
    };
  }

  const rawApplied = hit ? Math.max(0, damageRoll.total) : 0;

  // Apply damage resistance/immunity/vulnerability for primary damage
  let applied = rawApplied;
  let defenseApplied: DamageDefenseResult["defenseApplied"] | undefined;
  if (hit && rawApplied > 0 && options?.targetDefenses && spec.damageType) {
    const defenseResult = applyDamageDefenses(rawApplied, spec.damageType, options.targetDefenses);
    applied = defenseResult.adjustedDamage;
    defenseApplied = defenseResult.defenseApplied;
  }

  // D&D 5e 2024: Additional damage types — each checked separately against defenses.
  // Critical hits double dice for all damage types.
  let additionalDamageResults: AdditionalDamageResult[] | undefined;
  if (hit && spec.additionalDamage && spec.additionalDamage.length > 0) {
    additionalDamageResults = [];
    for (const extra of spec.additionalDamage) {
      const parsed = parseDiceString(extra.dice);
      if (!parsed) continue;
      const extraDiceCount = critical ? parsed.count * 2 : parsed.count;
      const extraRoll = diceRoller.rollDie(parsed.sides, extraDiceCount, 0);
      const extraRaw = Math.max(0, extraRoll.total);
      let extraApplied = extraRaw;
      let extraDefense: DamageDefenseResult["defenseApplied"] | undefined;
      if (extraRaw > 0 && options?.targetDefenses) {
        const extraDefResult = applyDamageDefenses(extraRaw, extra.damageType, options.targetDefenses);
        extraApplied = extraDefResult.adjustedDamage;
        extraDefense = extraDefResult.defenseApplied;
      }
      applied += extraApplied;
      additionalDamageResults.push({
        damageType: extra.damageType,
        roll: extraRoll,
        rawDamage: extraRaw,
        applied: extraApplied,
        defenseApplied: extraDefense,
      });
    }
  }

  if (hit) {
    target.takeDamage(applied);
  }

  return {
    hit,
    critical,
    luckyUsed,
    savageAttackerUsed,
    attack: { d20, total },
    damage: {
      applied,
      roll: damageRoll,
      defenseApplied,
      damageType: spec.damageType,
      ...(additionalDamageResults && additionalDamageResults.length > 0
        ? { additionalDamageResults }
        : {}),
    },
  };
}

/** Parse a dice string like "2d8" into count and sides. */
function parseDiceString(dice: string): { count: number; sides: number } | null {
  const m = dice.trim().toLowerCase().match(/^(\d+)d(\d+)$/);
  if (!m) return null;
  return { count: Math.max(1, Number.parseInt(m[1]!, 10)), sides: Math.max(2, Number.parseInt(m[2]!, 10)) };
}
