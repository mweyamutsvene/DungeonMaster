import type { Creature } from "../entities/creatures/creature.js";
import type { DiceRoller } from "../rules/dice-roller.js";

export interface InitiativeEntry {
  creature: Creature;
  initiative: number;
}

export function rollInitiative(
  diceRoller: DiceRoller,
  creatures: readonly Creature[],
): InitiativeEntry[] {
  const entries = creatures.map((creature) => ({
    creature,
    initiative: creature.rollInitiative(diceRoller),
  }));

  // Stable deterministic ordering: higher initiative first, tie-break by creature id.
  return entries.sort((a, b) => {
    if (b.initiative !== a.initiative) return b.initiative - a.initiative;
    return a.creature.getId().localeCompare(b.creature.getId());
  });
}
