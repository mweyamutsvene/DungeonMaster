import type { GameEventRecord, JsonValue } from "../types.js";
import type { ReactionOpportunity } from "../../domain/entities/combat/pending-action.js";
import type { CombatantRef } from "../services/combat/helpers/combatant-ref.js";

export interface IEventRepository {
  append(
    sessionId: string,
    input: { id: string; type: string; payload: JsonValue },
  ): Promise<GameEventRecord>;

  listBySession(
    sessionId: string,
    input?: { limit?: number; since?: Date },
  ): Promise<GameEventRecord[]>;
}

/**
 * Event payload types for combat events.
 */
export interface ReactionPromptEventPayload {
  encounterId: string;
  pendingActionId: string;
  combatantId: string;
  reactionOpportunity: ReactionOpportunity;
  actor: CombatantRef;
  actorName: string;
  expiresAt: string; // ISO timestamp
}

export interface ReactionResolvedEventPayload {
  encounterId: string;
  pendingActionId: string;
  combatantId: string;
  combatantName: string;
  reactionType: string;
  choice: "use" | "decline";
  result?: JsonValue;
}
