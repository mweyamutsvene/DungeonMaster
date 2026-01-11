import type { ActionEconomy } from "../entities/combat/action-economy.js";
import { spendMovement } from "../entities/combat/action-economy.js";

export function movementCost(feet: number, difficultTerrain = false): number {
  if (!Number.isInteger(feet) || feet < 0) {
    throw new Error("Movement feet must be an integer >= 0");
  }
  return difficultTerrain ? feet * 2 : feet;
}

export function applyMovement(
  economy: ActionEconomy,
  feet: number,
  difficultTerrain = false,
): void {
  const cost = movementCost(feet, difficultTerrain);
  spendMovement(economy, cost);
}
