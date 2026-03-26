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
import { applyDamageDefenses, type DamageDefenses, type DamageDefenseResult } from "../rules/damage-defenses.js";
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
   * Optional weapon context used for feat interactions (e.g. Great Weapon Fighting).
   */
  weapon?: WeaponContext;
}

export interface AttackRoll {
  d20: number;
  total: number;
}

export interface AttackResult {
  hit: boolean;
  critical: boolean;
  attack: AttackRoll;
  damage: {
    applied: number;
    roll: DiceRoll;
    /** Defense that was applied (resistance/vulnerability/immunity/none) */
    defenseApplied?: DamageDefenseResult["defenseApplied"];
    /** Damage type of the attack */
    damageType?: string;
  };
}

export interface AttackResolveOptions {
  targetDefenses?: DamageDefenses;
  /** Distance in feet between attacker and target. Used for auto-crit on Paralyzed/Unconscious. */
  attackerDistance?: number;
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
  const baseMode = spec.mode ?? "normal";
  const mode = getAdjustedMode(attacker, attackAbility, baseMode);

  const outcome = rollD20(diceRoller, mode);
  const d20 = outcome.chosen;
  const naturalMiss = d20 === 1;
  let critical = d20 === 20;

  // Champion Fighter: expanded critical range (Improved Critical 19+, Superior Critical 18+)
  if (!critical) {
    const maybeClassId = (attacker as unknown as { getClassId?: () => string | undefined }).getClassId;
    const maybeSubclass = (attacker as unknown as { getSubclass?: () => string | undefined }).getSubclass;
    const maybeLevel = (attacker as unknown as { getLevel?: () => number }).getLevel;
    if (typeof maybeClassId === "function" && typeof maybeLevel === "function") {
      const classId = maybeClassId.call(attacker);
      const subclassId = typeof maybeSubclass === "function" ? maybeSubclass.call(attacker) : undefined;
      const charLevel = maybeLevel.call(attacker);
      if (classId && charLevel) {
        const critThreshold = getCriticalHitThreshold(classId, charLevel, subclassId);
        if (d20 >= critThreshold) critical = true;
      }
    }
  }

  const maybeFeatIds = (attacker as unknown as { getFeatIds?: () => readonly string[] }).getFeatIds;
  const featIds = typeof maybeFeatIds === "function" ? maybeFeatIds.call(attacker) : [];
  const featMods = computeFeatModifiers(featIds);

  let attackBonus = spec.attackBonus;
  if (spec.kind === "ranged") {
    attackBonus += featMods.rangedAttackBonus;
  }

  const total = d20 + attackBonus;
  const hit = !naturalMiss && (critical || total >= target.getAC());

  // D&D 5e 2024: Paralyzed/Unconscious auto-crit on melee within 5ft
  if (hit && !critical && isAutoCriticalHit(target, spec.kind, options?.attackerDistance)) {
    critical = true;
  }

  const damageDiceCount = critical ? spec.damage.diceCount * 2 : spec.damage.diceCount;
  let damageRoll = diceRoller.rollDie(
    spec.damage.diceSides,
    damageDiceCount,
    spec.damage.modifier ?? 0,
  );

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

  // Apply damage resistance/immunity/vulnerability
  let applied = rawApplied;
  let defenseApplied: DamageDefenseResult["defenseApplied"] | undefined;
  if (hit && rawApplied > 0 && options?.targetDefenses && spec.damageType) {
    const defenseResult = applyDamageDefenses(rawApplied, spec.damageType, options.targetDefenses);
    applied = defenseResult.adjustedDamage;
    defenseApplied = defenseResult.defenseApplied;
  }

  if (hit) {
    target.takeDamage(applied);
  }

  return {
    hit,
    critical,
    attack: { d20, total },
    damage: {
      applied,
      roll: damageRoll,
      defenseApplied,
      damageType: spec.damageType,
    },
  };
}
