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

/**
 * Swap initiative values between two actors in the turn order.
 * Used by the Alert feat (D&D 5e 2024) to let a creature trade initiative
 * with a willing ally immediately after initiative is rolled.
 *
 * Returns a new sorted array with the two actors' initiative values exchanged.
 * If either actor is not found, returns a copy of the original array unchanged.
 */
export function swapInitiative(
  turnOrder: ReadonlyArray<{ actorId: string; initiative: number }>,
  actorId: string,
  targetId: string,
): Array<{ actorId: string; initiative: number }> {
  const actorEntry = turnOrder.find(e => e.actorId === actorId);
  const targetEntry = turnOrder.find(e => e.actorId === targetId);

  if (!actorEntry || !targetEntry) {
    return turnOrder.map(e => ({ ...e }));
  }

  const actorInit = actorEntry.initiative;
  const targetInit = targetEntry.initiative;

  return turnOrder
    .map(e => {
      if (e.actorId === actorId) return { actorId: e.actorId, initiative: targetInit };
      if (e.actorId === targetId) return { actorId: e.actorId, initiative: actorInit };
      return { ...e };
    })
    .sort((a, b) => b.initiative - a.initiative);
}
