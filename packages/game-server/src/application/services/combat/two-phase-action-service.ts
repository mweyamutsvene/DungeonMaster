/**
 * Two-phase action execution service for handling reactions.
 *
 * Thin facade that delegates to focused handler modules:
 * - MoveReactionHandler    — initiateMove / completeMove
 * - AttackReactionHandler  — initiateAttack / completeAttack
 * - SpellReactionHandler   — initiateSpellCast / completeSpellCast
 * - DamageReactionHandler  — initiateDamageReaction / completeDamageReaction
 *
 * Decomposed in Phase 4 of the God-Module Decomposition plan.
 */

import type { ICombatRepository } from "../../repositories/combat-repository.js";
import type { IEventRepository } from "../../repositories/event-repository.js";
import type { IGameSessionRepository } from "../../repositories/game-session-repository.js";
import type { PendingActionRepository } from "../../repositories/pending-action-repository.js";
import type { ICombatantResolver } from "./helpers/combatant-resolver.js";
import type { CombatantRef } from "./helpers/combatant-ref.js";
import type { Position } from "../../../domain/rules/movement.js";
import { MoveReactionHandler } from "./two-phase/move-reaction-handler.js";
import { AttackReactionHandler } from "./two-phase/attack-reaction-handler.js";
import { SpellReactionHandler } from "./two-phase/spell-reaction-handler.js";
import { DamageReactionHandler } from "./two-phase/damage-reaction-handler.js";

export interface InitiateMoveInput {
  encounterId?: string;
  actor: CombatantRef;
  destination: Position;
  /** Pre-computed A* path (cell positions, excludes start). If provided, used for OA detection and cost calculation. */
  pathCells?: Position[];
  /** Pre-computed path cost in feet (from A* pathfinding). If provided, used instead of Euclidean distance. */
  pathCostFeet?: number;
  /** Narration hints from pathfinding (terrain descriptions, detours, etc.). */
  pathNarrationHints?: string[];
}

export interface InitiateMoveResult {
  status: "no_reactions" | "awaiting_reactions" | "aborted_by_trigger";
  pendingActionId?: string;
  opportunityAttacks: Array<{
    combatantId: string;
    combatantName: string;
    opportunityId?: string;
    canAttack: boolean;
    hasReaction: boolean;
  }>;
  /** If the actor was Prone, how much speed was spent standing up */
  standUpCost?: number;
  /** Damage taken from on_voluntary_move triggers (e.g., Booming Blade) */
  voluntaryMoveTriggerDamage?: number;
  /** Messages describing on_voluntary_move trigger damage */
  voluntaryMoveTriggerMessages?: string[];
}

export interface CompleteMoveInput {
  pendingActionId: string;
}

export interface CompleteMoveResult {
  movedFeet: number;
  from: Position;
  to: Position;
  opportunityAttacks: Array<{
    attackerId: string;
    attackerName: string;
    targetId: string;
    damage: number;
  }>;
}

/**
 * Thin facade — delegates to focused handler modules.
 */
export class TwoPhaseActionService {
  private readonly moveHandler: MoveReactionHandler;
  private readonly attackHandler: AttackReactionHandler;
  private readonly spellHandler: SpellReactionHandler;
  private readonly damageHandler: DamageReactionHandler;

  constructor(
    private readonly sessions: IGameSessionRepository,
    private readonly combat: ICombatRepository,
    private readonly combatants: ICombatantResolver,
    private readonly pendingActions: PendingActionRepository,
    private readonly events?: IEventRepository,
  ) {
    this.moveHandler = new MoveReactionHandler(sessions, combat, combatants, pendingActions, events);
    this.attackHandler = new AttackReactionHandler(sessions, combat, combatants, pendingActions, events);
    this.spellHandler = new SpellReactionHandler(sessions, combat, combatants, pendingActions, events);
    this.damageHandler = new DamageReactionHandler(sessions, combat, combatants, pendingActions, events);
  }

  // ── Move ──

  async initiateMove(sessionId: string, input: InitiateMoveInput): Promise<InitiateMoveResult> {
    return this.moveHandler.initiate(sessionId, input);
  }

  async completeMove(sessionId: string, input: CompleteMoveInput): Promise<CompleteMoveResult> {
    return this.moveHandler.complete(sessionId, input);
  }

  // ── Spell Cast ──

  async initiateSpellCast(sessionId: string, input: {
    encounterId?: string;
    actor: CombatantRef;
    spellName: string;
    spellLevel: number;
    target?: CombatantRef;
    targetPosition?: Position;
  }): Promise<{
    status: "no_reactions" | "awaiting_reactions";
    pendingActionId?: string;
    counterspellOpportunities: Array<{
      combatantId: string;
      combatantName: string;
      canUse: boolean;
      hasReaction: boolean;
      hasSpellSlot: boolean;
    }>;
  }> {
    return this.spellHandler.initiate(sessionId, input);
  }

  async completeSpellCast(sessionId: string, input: {
    pendingActionId: string;
    diceRoller?: { rollDie(sides: number, count?: number, modifier?: number): { total: number; rolls: number[] } };
  }): Promise<{
    wasCountered: boolean;
    counterspells: Array<{
      casterId: string;
      casterName: string;
      success: boolean;
      abilityCheckDC?: number;
      abilityCheckRoll?: number;
    }>;
  }> {
    return this.spellHandler.complete(sessionId, input);
  }

  // ── Attack ──

  async initiateAttack(sessionId: string, input: {
    encounterId?: string;
    actor: CombatantRef;
    target: CombatantRef;
    attackName?: string;
    attackRoll: number;
  }): Promise<{
    status: "no_reactions" | "awaiting_reactions" | "hit" | "miss";
    pendingActionId?: string;
    attackRoll: number;
    targetAC: number;
    shieldOpportunities: Array<{
      combatantId: string;
      combatantName: string;
      canUse: boolean;
      hasReaction: boolean;
      hasSpellSlot: boolean;
      newAC?: number;
    }>;
  }> {
    return this.attackHandler.initiate(sessionId, input);
  }

  async completeAttack(sessionId: string, input: {
    pendingActionId: string;
    diceRoller?: { rollDie(sides: number, count?: number, modifier?: number): { total: number; rolls: number[] } };
  }): Promise<{
    hit: boolean;
    shieldUsed: boolean;
    finalAC: number;
    attackRoll: number;
    damageApplied: number;
    redirect?: {
      hit: boolean;
      attackRoll: number;
      targetAC: number;
      damage: number;
    };
    /** If set, a damage reaction (Absorb Elements / Hellish Rebuke) is pending */
    damageReaction?: {
      pendingActionId: string;
      reactionType: string;
    };
  }> {
    return this.attackHandler.complete(sessionId, input, this);
  }

  // ── Damage Reaction ──

  async initiateDamageReaction(sessionId: string, input: {
    encounterId: string;
    target: CombatantRef;
    attackerId: CombatantRef;
    damageType: string;
    damageAmount: number;
    detectedReaction: { reactionType: string; context: Record<string, unknown> };
    targetCombatantId: string;
  }): Promise<{
    status: "no_reactions" | "awaiting_reactions";
    pendingActionId?: string;
  }> {
    return this.damageHandler.initiate(sessionId, input);
  }

  async completeDamageReaction(sessionId: string, input: {
    pendingActionId: string;
    diceRoller?: { rollDie(sides: number, count?: number, modifier?: number): { total: number; rolls: number[] } };
  }): Promise<{
    reactionType: string;
    used: boolean;
    healBack?: number;
    retaliationDamage?: number;
    retaliationSaved?: boolean;
  }> {
    return this.damageHandler.complete(sessionId, input);
  }
}
