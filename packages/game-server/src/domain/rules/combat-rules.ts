import type { DiceRoller, DiceRoll } from "./dice-roller.js";
import { rollD20, type RollMode } from "./advantage.js";

export interface AttackResolution {
  mode: RollMode;
  rolls: [number] | [number, number];
  d20: number;
  totalToHit: number;
  hit: boolean;
  critical: boolean;
}

export function resolveToHit(
  diceRoller: DiceRoller,
  targetAC: number,
  attackBonus: number,
  mode: RollMode = "normal",
): AttackResolution {
  if (!Number.isInteger(targetAC) || targetAC < 0) {
    throw new Error("Target AC must be an integer >= 0");
  }
  if (!Number.isInteger(attackBonus)) {
    throw new Error("Attack bonus must be an integer");
  }

  const outcome = rollD20(diceRoller, mode);
  const d20 = outcome.chosen;
  const critical = d20 === 20;
  const naturalMiss = d20 === 1;
  const totalToHit = d20 + attackBonus;
  const hit = !naturalMiss && (critical || totalToHit >= targetAC);

  return {
    mode,
    rolls: outcome.rolls,
    d20,
    totalToHit,
    hit,
    critical,
  };
}

export interface DamageResolution {
  roll: DiceRoll;
  applied: number;
}

export function resolveDamage(
  diceRoller: DiceRoller,
  diceSides: number,
  diceCount: number,
  modifier = 0,
): DamageResolution {
  const roll = diceRoller.rollDie(diceSides, diceCount, modifier);
  return { roll, applied: Math.max(0, roll.total) };
}
