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

  // Stable deterministic ordering: higher initiative first.
  // D&D 5e 2024: tie-break by DEX score (higher first), then alphabetical ID for determinism.
  return entries.sort((a, b) => {
    if (b.initiative !== a.initiative) return b.initiative - a.initiative;
    const dexA = a.creature.getAbilityScore("dexterity");
    const dexB = b.creature.getAbilityScore("dexterity");
    if (dexB !== dexA) return dexB - dexA;
    return a.creature.getId().localeCompare(b.creature.getId());
  });
}
