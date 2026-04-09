/**
 * Shared helper: build an ActorRef from a CombatantStateRecord.
 *
 * Layer: Application (AI module)
 * Extracted from AiTurnOrchestrator + AiActionExecutor to eliminate duplication.
 */

import type { CombatantStateRecord } from "../../../types.js";
import type { ActorRef } from "./ai-types.js";

/**
 * Build an ActorRef from a combatant state record.
 * Returns null if the combatant has no valid entity reference.
 */
export function buildActorRef(combatant: CombatantStateRecord): ActorRef | null {
  if (combatant.combatantType === "Monster" && combatant.monsterId) {
    return { type: "Monster", monsterId: combatant.monsterId };
  }
  if (combatant.combatantType === "NPC" && combatant.npcId) {
    return { type: "NPC", npcId: combatant.npcId };
  }
  if (combatant.combatantType === "Character" && combatant.characterId) {
    return { type: "Character", characterId: combatant.characterId };
  }
  return null;
}
