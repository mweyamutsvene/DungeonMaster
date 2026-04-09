import type { CombatantStateRecord, CombatantType } from "../../../types.js";
import { getPosition } from "./resource-utils.js";

export type CombatantRef =
  | { type: "Character"; characterId: string }
  | { type: "Monster"; monsterId: string }
  | { type: "NPC"; npcId: string };

/**
 * Extract the entity ID from a CombatantRef (characterId, monsterId, or npcId).
 */
export function getEntityIdFromRef(ref: CombatantRef): string {
  switch (ref.type) {
    case "Character": return ref.characterId;
    case "Monster": return ref.monsterId;
    case "NPC": return ref.npcId;
  }
}

export function combatantRefFromState(state: CombatantStateRecord): CombatantRef | null {
  if (state.combatantType === "Character" && state.characterId) {
    return { type: "Character", characterId: state.characterId };
  }
  if (state.combatantType === "Monster" && state.monsterId) {
    return { type: "Monster", monsterId: state.monsterId };
  }
  if (state.combatantType === "NPC" && state.npcId) {
    return { type: "NPC", npcId: state.npcId };
  }
  return null;
}

export function findCombatantStateByRef(
  combatants: readonly CombatantStateRecord[],
  ref: CombatantRef,
): CombatantStateRecord | null {
  if (ref.type === "Character") {
    return (
      combatants.find((c) => c.combatantType === "Character" && c.characterId === ref.characterId) ??
      null
    );
  }
  if (ref.type === "NPC") {
    return combatants.find((c) => c.combatantType === "NPC" && c.npcId === ref.npcId) ?? null;
  }
  return combatants.find((c) => c.combatantType === "Monster" && c.monsterId === ref.monsterId) ?? null;
}

export function findCombatantIdByRef(
  combatants: Array<{
    id: string;
    combatantType: CombatantType;
    characterId: string | null;
    monsterId: string | null;
    npcId: string | null;
  }>,
  ref: CombatantRef,
): string | null {
  if (ref.type === "Character") {
    return (
      combatants.find((c) => c.combatantType === "Character" && c.characterId === ref.characterId)?.id ??
      null
    );
  }
  if (ref.type === "NPC") {
    return combatants.find((c) => c.combatantType === "NPC" && c.npcId === ref.npcId)?.id ?? null;
  }
  return combatants.find((c) => c.combatantType === "Monster" && c.monsterId === ref.monsterId)?.id ?? null;
}

/**
 * Convenience helper: resolve a CombatantRef to a position.
 * Returns null if the combatant is not found or has no position.
 */
export function getPositionByRef(
  combatants: readonly CombatantStateRecord[],
  ref: CombatantRef,
): { x: number; y: number } | null {
  const state = findCombatantStateByRef(combatants, ref);
  if (!state) return null;
  return getPosition(state.resources ?? {});
}
