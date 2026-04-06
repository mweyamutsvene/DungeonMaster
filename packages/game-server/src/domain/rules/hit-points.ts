import type { DiceRoller } from "./dice-roller.js";
import type { HitDie } from "../entities/classes/class-definition.js";

export interface HitPointOptions {
  level: number;
  hitDie: HitDie;
  constitutionModifier: number;

  /**
   * - "average": take the fixed average each level (e.g., d8 => 5)
   * - "roll": roll the die each level (requires diceRoller)
   */
  method?: "average" | "roll";
  diceRoller?: DiceRoller;
}

function averageDieGain(hitDie: HitDie): number {
  // 5e convention: average roll is (die/2)+1
  return Math.floor(hitDie / 2) + 1;
}

function clampHpGain(gain: number): number {
  // Level-up HP gain cannot be less than 1.
  return Math.max(1, gain);
}

export function maxHitPoints(options: HitPointOptions): number {
  const { level, hitDie, constitutionModifier } = options;

  if (!Number.isInteger(level) || level < 1 || level > 20) {
    throw new Error(`Invalid level: ${level}`);
  }
  if (!Number.isInteger(constitutionModifier)) {
    throw new Error("Constitution modifier must be an integer");
  }

  // Level 1 is always max hit die.
  let total = hitDie + constitutionModifier;

  const method = options.method ?? "average";

  for (let lvl = 2; lvl <= level; lvl++) {
    let gain: number;

    if (method === "average") {
      gain = averageDieGain(hitDie) + constitutionModifier;
    } else {
      if (!options.diceRoller) {
        throw new Error("diceRoller is required when method=roll");
      }
      gain = options.diceRoller.rollDie(hitDie, 1, constitutionModifier).total;
    }

    total += clampHpGain(gain);
  }

  return total;
}

/**
 * Tough feat: +2 max HP per character level.
 * TODO: Apply this bonus in creature hydration (creature-hydration.ts) or during
 * character creation/level-up when maxHp is set on the character sheet.
 * @param level - Character level (1-20)
 * @returns The bonus HP granted by the Tough feat
 */
export function computeToughBonusHP(level: number): number {
  return level * 2;
}
