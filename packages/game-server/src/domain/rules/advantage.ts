import type { DiceRoller } from "./dice-roller.js";

export type RollMode = "normal" | "advantage" | "disadvantage";

export interface D20Outcome {
  rolls: [number] | [number, number];
  chosen: number;
}

export function rollD20(diceRoller: DiceRoller, mode: RollMode = "normal"): D20Outcome {
  if (mode === "normal") {
    const r = diceRoller.d20();
    const d20 = r.rolls[0] ?? r.total;
    return { rolls: [d20], chosen: d20 };
  }

  const a = diceRoller.d20();
  const b = diceRoller.d20();
  const r1 = a.rolls[0] ?? a.total;
  const r2 = b.rolls[0] ?? b.total;

  const chosen = mode === "advantage" ? Math.max(r1, r2) : Math.min(r1, r2);
  return { rolls: [r1, r2], chosen };
}

export interface D20TestResult {
  mode: RollMode;
  dc: number;
  modifier: number;
  rolls: [number] | [number, number];
  chosen: number;
  total: number;
  success: boolean;
  natural20: boolean;
  natural1: boolean;
}

export function d20Test(
  diceRoller: DiceRoller,
  dc: number,
  modifier = 0,
  mode: RollMode = "normal",
): D20TestResult {
  if (!Number.isInteger(dc) || dc < 0) {
    throw new Error("DC must be an integer >= 0");
  }
  if (!Number.isInteger(modifier)) {
    throw new Error("Modifier must be an integer");
  }

  const outcome = rollD20(diceRoller, mode);
  const total = outcome.chosen + modifier;

  return {
    mode,
    dc,
    modifier,
    rolls: outcome.rolls,
    chosen: outcome.chosen,
    total,
    success: total >= dc,
    natural20: outcome.chosen === 20,
    natural1: outcome.chosen === 1,
  };
}
