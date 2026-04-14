/**
 * Domain types for two-phase action execution with reaction opportunities.
 * 
 * Actions that can trigger reactions are split into:
 * 1. Initiate phase: Detect reaction opportunities, create pending action
 * 2. Complete phase: Resolve reactions, execute action
 *
 * ## Dual Pending Action Architecture (CO-L7)
 *
 * There are TWO parallel systems for tracking pending actions:
 *
 * 1. **Encounter-level `pendingAction` field** (`ICombatRepository.setPendingAction/getPendingAction/clearPendingAction`)
 *    - Singleton JSON blob stored on the Encounter record.
 *    - Used by the **tabletop dice flow** (RollStateMachine): ATTACK, DAMAGE, INITIATIVE, INITIATIVE_SWAP.
 *    - Only ONE pending action exists at a time per encounter.
 *    - Set/cleared synchronously within a single request cycle.
 *
 * 2. **PendingActionRepository** (`IPendingActionRepository.create/getById/update/delete/listByEncounter`)
 *    - Multi-record store for **reaction opportunities** (two-phase flow).
 *    - Used by TwoPhaseActionService for opportunity attacks, Shield, Counterspell, etc.
 *    - Multiple pending reactions can exist simultaneously.
 *    - Has TTL/expiration support.
 *
 * These two systems serve different purposes and do NOT conflict in normal operation:
 * - Encounter `pendingAction` = "what roll does the player need to submit next?"
 * - PendingActionRepository = "which reactions are available for other combatants?"
 *
 * However, when the encounter `pendingAction` is set to `"reaction_pending"`, it signals
 * that the tabletop flow is paused waiting for reactions from PendingActionRepository.
 * This is the only synchronization point between the two systems.
 *
 * TODO: CO-L7 — Consider unifying into a single state machine where encounter-level
 * pending action delegates to PendingActionRepository for all action types, or at minimum
 * add helper functions that keep both systems in sync when transitioning between
 * tabletop roll flow and reaction flow.
 */

import type { Position } from "../../rules/movement.js";
import type { CombatantRef } from "../../../application/services/combat/helpers/combatant-ref.js";

export type PendingActionType = "move" | "spell_cast" | "attack" | "damage_reaction" | "lucky_reroll" | "ability_check";
export type ReactionType = "opportunity_attack" | "counterspell" | "shield" | "absorb_elements" | "hellish_rebuke" | "deflect_attacks" | "uncanny_dodge" | "readied_action" | "sentinel_attack" | "lucky_reroll" | "silvery_barbs" | "interception" | "protection";

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
  data: PendingMoveData | PendingSpellCastData | PendingAttackData | PendingDamageReactionData | PendingLuckyRerollData | PendingAbilityCheckData;
  
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
 * Data for pending damage reaction (Absorb Elements, Hellish Rebuke).
 * Created after damage is applied, when target has a damage-triggered reaction available.
 */
export interface PendingDamageReactionData {
  type: "damage_reaction";
  /** Who dealt the damage */
  attackerId: CombatantRef;
  /** Damage type that triggered the reaction */
  damageType: string;
  /** Amount of damage that was applied */
  damageAmount: number;
  /** Session ID for event emission */
  sessionId?: string;
}

/**
 * Data for pending Lucky reroll decision.
 * Stores enough context to either finalize a miss (decline) or resume attack roll flow (use).
 */
export interface PendingLuckyRerollData {
  type: "lucky_reroll";
  /** Session ID for event emission and AI resume hooks. */
  sessionId: string;
  /** Encounter actor entity ID (characterId / monsterId / npcId). */
  actorEntityId: string;
  /** Original attack roll values before Lucky decision. */
  originalRoll: number;
  originalTotal: number;
  attackBonus: number;
  targetAC: number;
  /** Serialized ATTACK pending action used to resume reroll flow if Lucky is spent. */
  originalAttackAction: Record<string, unknown>;
}

/**
 * Data for pending attack action (for Shield reaction).
 */
export interface PendingAttackData {
  type: "attack";
  target: CombatantRef;
  attackName?: string;
  attackRoll: number;
  /** Full attack info stored for damage resolution after Shield response */
  damageSpec?: { diceCount: number; diceSides: number; modifier: number; damageType?: string };
  /** Whether the attack was a critical hit (nat 20) */
  critical?: boolean;
  /** Seed used for dice rolls (to reproduce damage roll deterministically) */
  seed?: number;
  /** Session ID for the attack (needed for completion) */
  sessionId?: string;
  /** Target AC before Shield */
  targetAC?: number;
}

/**
 * Data for pending ability check (contested checks like grapple/shove).
 * TODO: CO-L3 — Integrate with grapple/shove contested roll flow.
 * When both sides roll ability checks (e.g., Athletics vs Acrobatics),
 * this pending action type will allow player-rolled contested checks.
 */
export interface PendingAbilityCheckData {
  type: "ability_check";
  /** The ability being checked (e.g. "athletics", "acrobatics"). */
  ability: string;
  /** Optional contested ability (for opposed checks). */
  contestedAbility?: string;
  /** DC for non-contested checks, or undefined for player-vs-player contests. */
  dc?: number;
  /** Session ID for event emission. */
  sessionId?: string;
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
  
  /** Type of OA reaction: 'weapon' (default) or 'spell' (War Caster) */
  oaType?: "weapon" | "spell";
  
  /** Additional context for the reaction */
  context: Record<string, unknown>;
}

/**
 * Result of executing a reaction (e.g. opportunity attack roll outcomes).
 */
export interface ReactionResult {
  attackRoll?: number;
  totalAttack?: number;
  hit?: boolean;
  damageRoll?: number;
  totalDamage?: number;
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
  result?: ReactionResult;
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
