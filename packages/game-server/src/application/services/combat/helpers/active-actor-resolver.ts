import { NotFoundError, ValidationError } from "../../../errors.js";
import type { ICombatRepository } from "../../../repositories/combat-repository.js";
import type { IGameSessionRepository } from "../../../repositories/game-session-repository.js";
import type { CombatEncounterRecord, CombatantStateRecord } from "../../../types.js";
import type { CombatantRef } from "./combatant-ref.js";
import { findCombatantStateByRef } from "./combatant-ref.js";
import { resolveEncounterOrThrow } from "./encounter-resolver.js";
import { hasSpentAction, normalizeResources } from "./resource-utils.js";

export interface ResolveActiveActorInput {
  encounterId?: string;
  actor: CombatantRef;
  skipActionCheck?: boolean;
}

export interface ResolveActiveActorResult {
  encounter: CombatEncounterRecord;
  combatants: CombatantStateRecord[];
  active: CombatantStateRecord;
  actorState: CombatantStateRecord;
}

/**
 * Resolves the active actor for a combat action, validating turn order and action economy.
 * Shared by ActionService, GrappleActionHandler, and SkillActionHandler.
 */
export async function resolveActiveActorOrThrow(
  sessions: IGameSessionRepository,
  combat: ICombatRepository,
  sessionId: string,
  input: ResolveActiveActorInput,
): Promise<ResolveActiveActorResult> {
  const encounter = await resolveEncounterOrThrow(sessions, combat, sessionId, input.encounterId);
  const combatants = await combat.listCombatants(encounter.id);

  const active = combatants[encounter.turn] ?? null;
  if (!active) {
    throw new ValidationError(
      `Encounter turn index out of range: turn=${encounter.turn} combatants=${combatants.length}`,
    );
  }

  const actorState = findCombatantStateByRef(combatants, input.actor);
  if (!actorState) throw new NotFoundError("Actor not found in encounter");

  if (actorState.id !== active.id) {
    throw new ValidationError("It is not the actor's turn");
  }

  // Skip action check for bonus action abilities like Patient Defense
  if (!input.skipActionCheck && hasSpentAction(actorState.resources)) {
    throw new ValidationError("Actor has already spent their action this turn");
  }

  return { encounter, combatants, active, actorState };
}
