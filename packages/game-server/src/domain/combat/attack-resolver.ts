import type { Creature } from "../entities/creatures/creature.js";
import type { Ability } from "../entities/core/ability-scores.js";
import type { DiceRoller, DiceRoll } from "../rules/dice-roller.js";
import { rollD20, type RollMode } from "../rules/advantage.js";
import {
  applyDamageDieMinimum,
  computeFeatModifiers,
  shouldApplyGreatWeaponFighting,
  type AttackKind,
  type WeaponContext,
} from "../rules/feat-modifiers.js";

type D20ModeProvider = {
  getD20TestModeForAbility?: (ability: Ability, baseMode: RollMode) => RollMode;
};

function hasProperty(props: readonly string[] | undefined, property: string): boolean {
  if (!props) return false;
  const p = property.trim().toLowerCase();
  return props.some((x) => x.trim().toLowerCase() === p);
}

function getAdjustedMode(attacker: Creature, ability: Ability, baseMode: RollMode): RollMode {
  const maybe = attacker as unknown as D20ModeProvider;
  if (typeof maybe.getD20TestModeForAbility !== "function") return baseMode;
  return maybe.getD20TestModeForAbility(ability, baseMode);
}

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
  };
}

export function resolveAttack(
  diceRoller: DiceRoller,
  attacker: Creature,
  target: Creature,
  spec: AttackSpec,
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
  const critical = d20 === 20;

  const maybeFeatIds = (attacker as unknown as { getFeatIds?: () => readonly string[] }).getFeatIds;
  const featIds = typeof maybeFeatIds === "function" ? maybeFeatIds.call(attacker) : [];
  const featMods = computeFeatModifiers(featIds);

  let attackBonus = spec.attackBonus;
  if (spec.kind === "ranged") {
    attackBonus += featMods.rangedAttackBonus;
  }

  const total = d20 + attackBonus;
  const hit = critical || total >= target.getAC();

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

  const applied = hit ? Math.max(0, damageRoll.total) : 0;
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
    },
  };
}
