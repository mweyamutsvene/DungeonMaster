import { NotFoundError, ValidationError } from "../errors.js";
import type { ICombatRepository } from "../repositories/combat-repository.js";
import type { IGameSessionRepository } from "../repositories/game-session-repository.js";
import type { CombatEncounterRecord, CombatantStateRecord } from "../types.js";

/**
 * Resolve the active combatant for an encounter.
 * Validates turn index is within bounds.
 */
export async function resolveActiveCombatant(
  combat: ICombatRepository,
  encounter: CombatEncounterRecord,
): Promise<{ combatants: CombatantStateRecord[]; active: CombatantStateRecord }> {
  const combatants = await combat.listCombatants(encounter.id);
  const active = combatants[encounter.turn] ?? null;
  if (!active) {
    throw new ValidationError(
      `Encounter turn index out of range: turn=${encounter.turn} combatants=${combatants.length}`,
    );
  }
  return { combatants, active };
}

export async function resolveEncounterOrThrow(
  sessions: IGameSessionRepository,
  combat: ICombatRepository,
  sessionId: string,
  encounterId?: string,
): Promise<CombatEncounterRecord> {
  const session = await sessions.getById(sessionId);
  if (!session) throw new NotFoundError(`Session not found: ${sessionId}`);

  if (encounterId) {
    const enc = await combat.getEncounterById(encounterId);
    if (!enc || enc.sessionId !== sessionId) throw new NotFoundError(`Encounter not found: ${encounterId}`);
    return enc;
  }

  const encounters = await combat.listEncountersBySession(sessionId);
  const latest = encounters[0];
  if (!latest) throw new NotFoundError(`No combat encounter for session: ${sessionId}`);
  return latest;
}
