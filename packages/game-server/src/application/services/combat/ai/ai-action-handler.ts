/**
 * AiActionHandler — interface + context types for the AI action registry/strategy pattern.
 *
 * Each AI action type (attack, move, castSpell, etc.) is handled by a dedicated
 * class implementing `AiActionHandler`. Handlers are registered in `AiActionRegistry`
 * and discovered via `handles()`.  The main `execute()` path in `AiActionExecutor`
 * becomes a simple registry lookup + dispatch — no if/else chain required.
 *
 * Layer: Application
 */

import type { CombatantStateRecord } from "../../../types.js";
import type { ICombatantResolver } from "../helpers/combatant-resolver.js";
import type { ActionService as CombatActionService } from "../action-service.js";
import type { TwoPhaseActionService } from "../two-phase-action-service.js";
import type { ICombatRepository } from "../../../repositories/index.js";
import type { ICharacterRepository } from "../../../repositories/character-repository.js";
import type { IMonsterRepository } from "../../../repositories/monster-repository.js";
import type { INPCRepository } from "../../../repositories/npc-repository.js";
import type { IEventRepository } from "../../../repositories/event-repository.js";
import type { PendingActionRepository } from "../../../repositories/pending-action-repository.js";
import type { AbilityRegistry } from "../abilities/ability-registry.js";
import type { AiDecision, TurnStepResult } from "./ai-types.js";
import type { DiceRoller } from "../../../../domain/rules/dice-roller.js";
import type { ActorRef } from "./ai-types.js";
import type { AiMovementDeps } from "./ai-movement-resolver.js";

/** Logger signature for diagnostic output. */
export type AiLogger = (msg: string) => void;

/** AI reaction decision callback type. */
export type AiReactionDecider = (
  combatant: CombatantStateRecord,
  reactionType: "opportunity_attack" | "shield_spell" | "counterspell" | "other",
  context: { targetName?: string; hpPercent?: number; attackTotal?: number; currentAC?: number; spellName?: string },
) => Promise<boolean>;

/**
 * Shorthand for a completed handler result (step number is added by the orchestrator).
 */
export type AiHandlerResult = Omit<TurnStepResult, "step">;

/**
 * Runtime data bundle passed to every handler's `execute()` call.
 * Carries the per-turn state that changes between calls.
 */
export interface AiActionHandlerContext {
  sessionId: string;
  encounterId: string;
  aiCombatant: CombatantStateRecord;
  decision: AiDecision;
  allCombatants: CombatantStateRecord[];
  actorRef: ActorRef | null;
}

/**
 * Services and shared helper methods passed to every handler.
 * Static deps injected once — handlers never hold a reference to `AiActionExecutor`.
 */
export interface AiActionHandlerDeps {
  // ── core services ──────────────────────────────────────────────────
  actionService: CombatActionService;
  twoPhaseActions: TwoPhaseActionService;
  combat: ICombatRepository;
  pendingActions: PendingActionRepository;
  combatantResolver: ICombatantResolver;
  abilityRegistry: AbilityRegistry;
  aiDecideReaction: AiReactionDecider;
  aiLog: AiLogger;
  diceRoller?: DiceRoller;
  events?: IEventRepository;
  characters?: ICharacterRepository;
  monsters?: IMonsterRepository;
  npcs?: INPCRepository;

  // ── shared helpers (bound methods from AiActionExecutor) ──────────
  /** Find a combatant by name — exact or partial match. */
  findCombatantByName(
    name: string,
    allCombatants: CombatantStateRecord[],
  ): Promise<CombatantStateRecord | null>;
  /** Convert a combatant record to an ActorRef for service calls. */
  toCombatantRef(c: CombatantStateRecord): ActorRef | null;
  /** Build A* movement deps bundle for resolveAiMovement(). */
  getMovementDeps(): AiMovementDeps;
  /** Execute the bonus action portion of a decision (if present). */
  executeBonusAction(
    sessionId: string,
    encounterId: string,
    aiCombatant: CombatantStateRecord,
    decision: AiDecision,
    actorRef: ActorRef | null,
  ): Promise<{ action: string; summary: string } | null>;
}

/**
 * Strategy interface for a single AI action type.
 *
 * Implementations live in `ai/handlers/` — one file per action (or small group).
 * Register handlers in `AiActionExecutor.setupRegistry()`.
 */
export interface AiActionHandler {
  /**
   * Return true if this handler can execute the given action string.
   * Usually a simple equality check, but may handle multiple variants
   * (e.g. `BasicActionHandler` handles `disengage`, `dash`, `dodge`).
   */
  handles(action: string): boolean;

  /**
   * Execute the action and return the result.
   * Never throws — return `ok: false` with a reason on failure.
   */
  execute(ctx: AiActionHandlerContext, deps: AiActionHandlerDeps): Promise<AiHandlerResult>;
}
