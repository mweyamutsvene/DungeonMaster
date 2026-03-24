/**
 * tabletop-utils.ts — Shared pure-function helpers used by both
 * TabletopCombatService (facade) and RollStateMachine.
 *
 * Extracted to eliminate duplicate implementations of surprise checks
 * and initiative modifier computation.
 */

import { classHasFeature } from "../../../../domain/entities/classes/registry.js";
import { FERAL_INSTINCT } from "../../../../domain/entities/classes/feature-keys.js";
import type { SurpriseSpec } from "./tabletop-types.js";

// ----- Surprise -----

/**
 * Check if a creature is surprised based on the surprise spec.
 * @param creatureId The creature's canonical ID (characterId / monsterId / npcId)
 * @param surprise The surprise spec from the initiate action
 * @param side Which side the creature is on ("party" for PCs/NPCs, "enemy" for monsters)
 */
export function isCreatureSurprised(
  creatureId: string,
  surprise: SurpriseSpec | undefined,
  side: "party" | "enemy",
): boolean {
  if (!surprise) return false;
  if (surprise === "party") return side === "party";
  if (surprise === "enemies") return side === "enemy";
  return surprise.surprised.includes(creatureId);
}

// ----- Initiative modifiers -----

/**
 * Compute initiative advantage/disadvantage for a creature.
 *
 * D&D 5e 2024 rules applied:
 * - Surprised → disadvantage on initiative
 * - Invisible condition → advantage on initiative
 * - Incapacitated condition → disadvantage on initiative
 * - Feral Instinct (Barbarian 7+) → advantage + negates surprise disadv (if not incapacitated)
 * - If both advantage and disadvantage sources exist → they cancel (normal roll)
 */
export function computeInitiativeModifiers(
  creatureId: string,
  surprise: SurpriseSpec | undefined,
  side: "party" | "enemy",
  conditions?: unknown[],
  classInfo?: { className: string; level: number },
): { advantage: boolean; disadvantage: boolean } {
  let advSources = 0;
  let disadvSources = 0;

  if (isCreatureSurprised(creatureId, surprise, side)) disadvSources++;

  let isIncapacitated = false;
  if (conditions && Array.isArray(conditions)) {
    const condLower = conditions.map((c: unknown) =>
      typeof c === "string"
        ? c.toLowerCase()
        : typeof c === "object" && c !== null && "condition" in c
          ? String((c as any).condition).toLowerCase()
          : "",
    );
    if (condLower.includes("invisible")) advSources++;
    if (condLower.includes("incapacitated")) {
      isIncapacitated = true;
      disadvSources++;
    }
  }

  // D&D 5e 2024: Feral Instinct (Barbarian 7+) grants advantage on initiative
  // and negates surprise disadvantage if not incapacitated
  if (classInfo && classInfo.className.toLowerCase() === "barbarian" && classHasFeature("barbarian", FERAL_INSTINCT, classInfo.level)) {
    advSources++;
    if (isCreatureSurprised(creatureId, surprise, side) && !isIncapacitated && disadvSources > 0) {
      disadvSources--;
    }
  }

  // D&D 5e: advantage + disadvantage cancel out
  if (advSources > 0 && disadvSources > 0) {
    return { advantage: false, disadvantage: false };
  }
  return { advantage: advSources > 0, disadvantage: disadvSources > 0 };
}

/**
 * Compute initiative roll mode for server-rolled creatures.
 * Convenience wrapper around `computeInitiativeModifiers` that returns
 * a "normal" | "advantage" | "disadvantage" string for `rollInitiativeD20`.
 */
export function computeInitiativeRollMode(
  creatureId: string,
  surprise: SurpriseSpec | undefined,
  side: "party" | "enemy",
  conditions?: unknown[],
  classInfo?: { className: string; level: number },
): "normal" | "advantage" | "disadvantage" {
  const { advantage, disadvantage } = computeInitiativeModifiers(
    creatureId, surprise, side, conditions, classInfo,
  );
  if (advantage) return "advantage";
  if (disadvantage) return "disadvantage";
  return "normal";
}
