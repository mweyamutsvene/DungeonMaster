/**
 * Two-phase action execution service for handling reactions.
 *
 * Thin facade that delegates to focused handler modules:
 * - MoveReactionHandler  — initiateMove / completeMove
 * - AttackReactionHandler — initiateAttack / completeAttack
 * - SpellReactionHandler  — initiateSpellCast / completeSpellCast
 *
 * Keeps initiateDamageReaction / completeDamageReaction inline (small).
 *
 * Decomposed in Phase 4 of the God-Module Decomposition plan.
 */

import { nanoid } from "nanoid";
import type { ICombatRepository } from "../../repositories/combat-repository.js";
import type { IEventRepository, ReactionPromptEventPayload } from "../../repositories/event-repository.js";
import type { IGameSessionRepository } from "../../repositories/game-session-repository.js";
import type { PendingActionRepository } from "../../repositories/pending-action-repository.js";
import type { ICombatantResolver } from "./helpers/combatant-resolver.js";
import type { CombatantRef } from "./helpers/combatant-ref.js";
import type { Position } from "../../../domain/rules/movement.js";
import type {
  PendingAction,
  ReactionOpportunity,
  ReactionResponse,
  PendingDamageReactionData,
} from "../../../domain/entities/combat/pending-action.js";
import { hasReactionAvailable } from "../../../domain/rules/opportunity-attack.js";
import { findCombatantStateByRef } from "./helpers/combatant-ref.js";
import { ValidationError, NotFoundError } from "../../errors.js";
import { normalizeResources, readBoolean } from "./helpers/resource-utils.js";
import { applyKoEffectsIfNeeded } from "./helpers/ko-handler.js";
import type { JsonValue } from "../../types.js";
import { MoveReactionHandler } from "./two-phase/move-reaction-handler.js";
import { AttackReactionHandler } from "./two-phase/attack-reaction-handler.js";
import { SpellReactionHandler } from "./two-phase/spell-reaction-handler.js";

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

  // ── Damage Reaction (inline — small enough to keep here) ──

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
    const pendingActionId = nanoid();
    const drData: PendingDamageReactionData = {
      type: "damage_reaction",
      attackerId: input.attackerId,
      damageType: input.damageType,
      damageAmount: input.damageAmount,
      sessionId,
    };

    const reactionOpportunity: ReactionOpportunity = {
      id: nanoid(),
      combatantId: input.targetCombatantId,
      reactionType: input.detectedReaction.reactionType as ReactionOpportunity["reactionType"],
      canUse: true,
      context: input.detectedReaction.context,
    };

    const pendingAction: PendingAction = {
      id: pendingActionId,
      encounterId: input.encounterId,
      actor: input.attackerId,
      type: "damage_reaction",
      data: drData,
      reactionOpportunities: [reactionOpportunity],
      resolvedReactions: [],
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60000),
    };

    await this.pendingActions.create(pendingAction);

    // Emit reaction prompt
    if (this.events) {
      const combatants = await this.combat.listCombatants(input.encounterId);
      const targetState = findCombatantStateByRef(combatants, input.target);
      const targetName = targetState
        ? await this.combatants.getName(input.target, targetState)
        : "Unknown";

      const payload: ReactionPromptEventPayload = {
        encounterId: input.encounterId,
        pendingActionId,
        combatantId: input.targetCombatantId,
        reactionOpportunity,
        actor: input.attackerId,
        actorName: targetName,
        expiresAt: pendingAction.expiresAt.toISOString(),
      };

      await this.events.append(sessionId, {
        id: nanoid(),
        type: "ReactionPrompt",
        payload,
      });
    }

    return {
      status: "awaiting_reactions",
      pendingActionId,
    };
  }

  /**
   * Phase 2: Complete damage reaction after player responds.
   *
   * Absorb Elements: Heal back floor(damageAmount / 2), mark resistance condition.
   * Hellish Rebuke: Deal 2d10 fire damage to attacker (DEX save for half).
   */
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
    const pendingAction = await this.pendingActions.getById(input.pendingActionId);
    if (!pendingAction) {
      throw new NotFoundError(`Pending action not found: ${input.pendingActionId}`);
    }

    if (pendingAction.type !== "damage_reaction") {
      throw new ValidationError("Pending action is not a damage reaction");
    }

    const drData = pendingAction.data as PendingDamageReactionData;
    const encounter = await this.combat.getEncounterById(pendingAction.encounterId);
    if (!encounter) throw new NotFoundError("Encounter not found");

    const combatants = await this.combat.listCombatants(encounter.id);

    // Check if player chose to use the reaction
    const usedReaction = pendingAction.resolvedReactions.find(
      (r: ReactionResponse) => r.choice === "use",
    );

    const opp = pendingAction.reactionOpportunities[0];
    const reactionType = opp?.reactionType ?? "unknown";

    if (!usedReaction || !opp) {
      await this.pendingActions.markCompleted(input.pendingActionId);
      await this.pendingActions.delete(input.pendingActionId);
      return { reactionType, used: false };
    }

    const reactorState = combatants.find((c) => c.id === opp.combatantId);
    if (!reactorState) {
      await this.pendingActions.markCompleted(input.pendingActionId);
      await this.pendingActions.delete(input.pendingActionId);
      return { reactionType, used: false };
    }

    let healBack: number | undefined;
    let retaliationDamage: number | undefined;
    let retaliationSaved: boolean | undefined;

    const { spendResourceFromPool } = await import("./helpers/resource-utils.js");

    if (reactionType === "absorb_elements") {
      healBack = Math.floor(drData.damageAmount / 2);
      if (healBack > 0) {
        const reactorResources = normalizeResources(reactorState.resources);
        const maxHp = typeof reactorResources.hpMax === "number" ? reactorResources.hpMax : reactorState.hpCurrent + healBack;
        const newHp = Math.min(maxHp, reactorState.hpCurrent + healBack);
        await this.combat.updateCombatantState(reactorState.id, { hpCurrent: newHp });
      }

      const slotToSpend = typeof opp.context.slotToSpend === "string" ? opp.context.slotToSpend : "spellSlot_1";
      let updatedResources: JsonValue;
      try {
        updatedResources = spendResourceFromPool(reactorState.resources, slotToSpend, 1);
      } catch {
        updatedResources = reactorState.resources as JsonValue;
      }
      const normalizedUpdated = normalizeResources(updatedResources);
      await this.combat.updateCombatantState(reactorState.id, {
        resources: { ...normalizedUpdated, reactionUsed: true } as JsonValue,
      });

      if (this.events) {
        const reactorRef: CombatantRef = reactorState.characterId
          ? { type: "Character", characterId: reactorState.characterId }
          : { type: "Monster", monsterId: reactorState.monsterId ?? "" };
        const reactorName = await this.combatants.getName(reactorRef, reactorState);
        await this.events.append(sessionId, {
          id: nanoid(),
          type: "AbsorbElements",
          payload: {
            encounterId: encounter.id,
            casterId: reactorState.id,
            casterName: reactorName,
            damageType: drData.damageType,
            healBack,
            hpAfter: Math.min(
              typeof normalizeResources(reactorState.resources).hpMax === "number"
                ? normalizeResources(reactorState.resources).hpMax as number : 999,
              reactorState.hpCurrent + healBack,
            ),
          },
        });
      }
    } else if (reactionType === "hellish_rebuke") {
      const attacker = findCombatantStateByRef(combatants, drData.attackerId);
      if (attacker && attacker.hpCurrent > 0 && input.diceRoller) {
        const spellSaveDC = typeof opp.context.spellSaveDC === "number" ? opp.context.spellSaveDC : 13;
        const dmgRoll = input.diceRoller.rollDie(10, 2, 0);
        let totalDamage = Math.max(0, dmgRoll.total);

        let dexSaveMod = 0;
        try {
          const attackerStats = await this.combatants.getCombatStats(drData.attackerId);
          const dex = (attackerStats.abilityScores as Record<string, number>).dexterity ?? 10;
          dexSaveMod = Math.floor((dex - 10) / 2);
        } catch { /* default 0 */ }
        const saveRoll = input.diceRoller.rollDie(20);
        const saveTotal = saveRoll.total + dexSaveMod;
        retaliationSaved = saveTotal >= spellSaveDC;

        if (retaliationSaved) {
          totalDamage = Math.floor(totalDamage / 2);
        }
        retaliationDamage = totalDamage;

        if (totalDamage > 0) {
          const attackerHpAfter = Math.max(0, attacker.hpCurrent - totalDamage);
          await this.combat.updateCombatantState(attacker.id, { hpCurrent: attackerHpAfter });
          await applyKoEffectsIfNeeded(attacker, attacker.hpCurrent, attackerHpAfter, this.combat);

          if (this.events) {
            const attackerName = await this.combatants.getName(drData.attackerId, attacker);
            await this.events.append(sessionId, {
              id: nanoid(),
              type: "DamageApplied",
              payload: {
                encounterId: encounter.id,
                target: drData.attackerId,
                targetName: attackerName,
                amount: totalDamage,
                hpCurrent: attackerHpAfter,
                damageType: "fire",
                source: "HellishRebuke",
              },
            });
          }
        }
      }

      const slotToSpend = typeof opp.context.slotToSpend === "string" ? opp.context.slotToSpend : "spellSlot_1";
      let updatedResources: JsonValue;
      try {
        updatedResources = spendResourceFromPool(reactorState.resources, slotToSpend, 1);
      } catch {
        updatedResources = reactorState.resources as JsonValue;
      }
      const normalizedUpdated = normalizeResources(updatedResources);
      await this.combat.updateCombatantState(reactorState.id, {
        resources: { ...normalizedUpdated, reactionUsed: true } as JsonValue,
      });

      if (this.events) {
        const reactorRef: CombatantRef = reactorState.characterId
          ? { type: "Character", characterId: reactorState.characterId }
          : { type: "Monster", monsterId: reactorState.monsterId ?? "" };
        const reactorName = await this.combatants.getName(reactorRef, reactorState);
        await this.events.append(sessionId, {
          id: nanoid(),
          type: "HellishRebuke",
          payload: {
            encounterId: encounter.id,
            casterId: reactorState.id,
            casterName: reactorName,
            targetId: drData.attackerId,
            damage: retaliationDamage ?? 0,
            saved: retaliationSaved ?? false,
          },
        });
      }
    }

    await this.pendingActions.markCompleted(input.pendingActionId);
    await this.pendingActions.delete(input.pendingActionId);

    return {
      reactionType,
      used: true,
      healBack,
      retaliationDamage,
      retaliationSaved,
    };
  }
}
