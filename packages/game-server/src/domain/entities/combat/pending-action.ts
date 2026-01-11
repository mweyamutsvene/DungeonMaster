/**
 * Domain types for two-phase action execution with reaction opportunities.
 * 
 * Actions that can trigger reactions are split into:
 * 1. Initiate phase: Detect reaction opportunities, create pending action
 * 2. Complete phase: Resolve reactions, execute action
 */

import type { Position } from "../../rules/movement.js";
import type { CombatantRef } from "../../../application/services/combat/helpers/combatant-ref.js";

export type PendingActionType = "move" | "spell_cast" | "attack";
export type ReactionType = "opportunity_attack" | "counterspell" | "shield" | "absorb_elements" | "hellish_rebuke";

/**
 * Tracks an action awaiting reaction resolution.
 */
export interface PendingAction {
  /** Unique ID for this pending action */
  id: string;
  
  /** Encounter this action belongs to */
  encounterId: string;
  
  /** Who is performing the action */
  actor: CombatantRef;
  
  /** Type of action being performed */
  type: PendingActionType;
  
  /** Action-specific data */
  data: PendingMoveData | PendingSpellCastData | PendingAttackData;
  
  /** Reaction opportunities detected */
  reactionOpportunities: ReactionOpportunity[];
  
  /** Reactions that have been responded to */
  resolvedReactions: ReactionResponse[];
  
  /** When this pending action was created */
  createdAt: Date;
  
  /** Timeout for pending action (auto-decline after this) */
  expiresAt: Date;
}

/**
 * Data for pending movement action.
 */
export interface PendingMoveData {
  type: "move";
  from: Position;
  to: Position;
  path: Position[];
}

/**
 * Data for pending spell cast action.
 */
export interface PendingSpellCastData {
  type: "spell_cast";
  spellName: string;
  spellLevel: number;
  target?: CombatantRef;
  targetPosition?: Position;
}

/**
 * Data for pending attack action (for Shield reaction).
 */
export interface PendingAttackData {
  type: "attack";
  target: CombatantRef;
  attackName?: string;
  attackRoll: number;
}

/**
 * A reaction opportunity for a combatant.
 */
export interface ReactionOpportunity {
  /** Unique ID for this opportunity */
  id: string;
  
  /** Who can react */
  combatantId: string;
  
  /** Type of reaction */
  reactionType: ReactionType;
  
  /** Whether this combatant can legally use this reaction */
  canUse: boolean;
  
  /** Reason they can't use it (if canUse is false) */
  reason?: string;
  
  /** Additional context for the reaction */
  context: Record<string, unknown>;
}

/**
 * A combatant's response to a reaction opportunity.
 */
export interface ReactionResponse {
  /** Which opportunity this responds to */
  opportunityId: string;
  
  /** Who is responding */
  combatantId: string;
  
  /** What they chose to do */
  choice: "use" | "decline";
  
  /** When they responded */
  respondedAt: Date;
  
  /** Result of executing the reaction (if used) */
  result?: unknown;
}

/**
 * Status of a pending action.
 */
export type PendingActionStatus = 
  | "awaiting_reactions"  // Waiting for player reactions
  | "ready_to_complete"   // All reactions resolved, ready to execute
  | "completed"           // Action has been completed
  | "cancelled"           // Action was cancelled
  | "expired";            // Timed out waiting for reactions
