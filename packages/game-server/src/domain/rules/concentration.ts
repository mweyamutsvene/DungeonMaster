import type { DiceRoller } from "./dice-roller.js";
import { savingThrow } from "./ability-checks.js";
import type { D20TestResult, RollMode } from "./advantage.js";

export interface ConcentrationState {
  activeSpellId: string | null;
}

export function createConcentrationState(): ConcentrationState {
  return { activeSpellId: null };
}

export function isConcentrating(state: ConcentrationState): boolean {
  return state.activeSpellId !== null;
}

export function startConcentration(state: ConcentrationState, spellId: string): ConcentrationState {
  if (!spellId) throw new Error("spellId is required");
  return { activeSpellId: spellId };
}

export function endConcentration(_state: ConcentrationState): ConcentrationState {
  return { activeSpellId: null };
}

/**
 * Determines the roll mode for a concentration saving throw.
 * War Caster grants advantage on Constitution saves to maintain concentration.
 */
export function concentrationSaveRollMode(warCasterEnabled: boolean): RollMode {
  return warCasterEnabled ? "advantage" : "normal";
}

export interface ConcentrationCheckResult {
  dc: number;
  check: D20TestResult;
  maintained: boolean;
}

/**
 * Concentration check DC is max(10, floor(damage/2)).
 */
export function concentrationCheckOnDamage(
  diceRoller: DiceRoller,
  damage: number,
  constitutionSaveModifier: number,
  mode: RollMode = "normal",
): ConcentrationCheckResult {
  if (!Number.isInteger(damage) || damage < 0) {
    throw new Error("Damage must be an integer >= 0");
  }
  if (!Number.isInteger(constitutionSaveModifier)) {
    throw new Error("Constitution save modifier must be an integer");
  }

  const dc = Math.max(10, Math.floor(damage / 2));
  const check = savingThrow(diceRoller, dc, constitutionSaveModifier, mode);
  return { dc, check, maintained: check.success };
}
