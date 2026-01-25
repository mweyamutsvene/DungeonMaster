/**
 * AiActionExecutor - Executes AI combat decisions by delegating to game services.
 *
 * Layer: Application
 * Responsibility: Translate AiDecision into actual game state changes.
 */

import type { CombatantStateRecord } from "../../../types.js";
import type { ICombatantResolver } from "../helpers/combatant-resolver.js";
import type { ActionService as CombatActionService } from "../action-service.js";
import type { TwoPhaseActionService } from "../two-phase-action-service.js";
import type { ICombatRepository } from "../../../repositories/index.js";
import type { PendingActionRepository } from "../../../repositories/pending-action-repository.js";
import type { AbilityRegistry } from "../abilities/ability-registry.js";
import type { AiDecision, TurnStepResult, ActorRef } from "./ai-types.js";

/** Logger signature for diagnostic output */
type AiLogger = (msg: string) => void;

/**
 * AI reaction decision callback type.
 * Used for opportunity attacks and other reaction decisions.
 */
type AiReactionDecider = (
  combatant: CombatantStateRecord,
  reactionType: "opportunity_attack" | "shield_spell" | "other",
  context: { targetName?: string; hpPercent?: number },
) => Promise<boolean>;

export class AiActionExecutor {
  constructor(
    private readonly actionService: CombatActionService,
    private readonly twoPhaseActions: TwoPhaseActionService,
    private readonly combat: ICombatRepository,
    private readonly pendingActions: PendingActionRepository,
    private readonly combatantResolver: ICombatantResolver,
    private readonly abilityRegistry: AbilityRegistry,
    private readonly aiDecideReaction: AiReactionDecider,
    private readonly aiLog: AiLogger,
  ) {}

  /**
   * Normalize a name for fuzzy matching.
   */
  private normalizeName(name: string): string {
    return name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Find a combatant by name (exact or partial match).
   */
  private async findCombatantByName(
    desiredName: string,
    allCombatants: CombatantStateRecord[],
  ): Promise<CombatantStateRecord | null> {
    const nameMap = await this.combatantResolver.getNames(allCombatants);
    const desired = this.normalizeName(desiredName);
    if (!desired) return null;

    const named = allCombatants
      .map((c) => ({ combatant: c, name: nameMap.get(c.id) }))
      .filter((x): x is { combatant: CombatantStateRecord; name: string } => typeof x.name === "string");

    const exact = named.find((x) => this.normalizeName(x.name) === desired);
    if (exact) return exact.combatant;

    const partial = named.filter((x) => {
      const n = this.normalizeName(x.name);
      return n.includes(desired) || desired.includes(n);
    });
    if (partial.length === 1) return partial[0]!.combatant;

    return null;
  }

  /**
   * Build an ActorRef from a combatant state record.
   */
  buildActorRef(combatant: CombatantStateRecord): ActorRef | null {
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

  /**
   * Convert a combatant state to a ref for targeting.
   */
  private toCombatantRef(c: CombatantStateRecord): ActorRef | null {
    if (c.combatantType === "Character" && c.characterId)
      return { type: "Character", characterId: c.characterId };
    if (c.combatantType === "Monster" && c.monsterId)
      return { type: "Monster", monsterId: c.monsterId };
    if (c.combatantType === "NPC" && c.npcId) return { type: "NPC", npcId: c.npcId };
    return null;
  }

  /**
   * Execute an AI decision and return the result.
   */
  async execute(
    sessionId: string,
    encounterId: string,
    aiCombatant: CombatantStateRecord,
    decision: AiDecision,
    allCombatants: CombatantStateRecord[],
  ): Promise<Omit<TurnStepResult, "step">> {
    try {
      const actorRef = this.buildActorRef(aiCombatant);

      if (decision.action === "attack") {
        return this.executeAttack(sessionId, encounterId, aiCombatant, decision, allCombatants, actorRef);
      }

      if (decision.action === "move") {
        return this.executeMove(sessionId, encounterId, aiCombatant, decision, allCombatants, actorRef);
      }

      if (decision.action === "disengage" || decision.action === "dash" || decision.action === "dodge") {
        return this.executeBasicAction(sessionId, encounterId, aiCombatant, decision, actorRef);
      }

      if (decision.action === "help") {
        return this.executeHelp(sessionId, encounterId, aiCombatant, decision, allCombatants, actorRef);
      }

      if (decision.action === "castSpell") {
        return this.executeCastSpell(sessionId, encounterId, aiCombatant, decision, actorRef);
      }

      if (decision.action === "shove") {
        return this.executeShove(sessionId, encounterId, aiCombatant, decision, allCombatants, actorRef);
      }

      if (decision.action === "endTurn") {
        return this.executeEndTurn(sessionId, encounterId, aiCombatant, decision, actorRef);
      }

      return {
        action: decision.action,
        ok: false,
        summary: `Action ${decision.action} not yet implemented`,
        data: { reason: "not_implemented" },
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[AiActionExecutor] Error executing action:", error);
      return {
        action: decision.action,
        ok: false,
        summary: `Error executing ${decision.action}: ${message}`,
        data: { reason: "exception", message },
      };
    }
  }

  private async executeAttack(
    sessionId: string,
    encounterId: string,
    aiCombatant: CombatantStateRecord,
    decision: AiDecision,
    allCombatants: CombatantStateRecord[],
    actorRef: ActorRef | null,
  ): Promise<Omit<TurnStepResult, "step">> {
    console.log("[AiActionExecutor] Executing attack action:", {
      target: decision.target,
      attackName: decision.attackName,
    });

    if (!decision.target || !decision.attackName) {
      console.log("[AiActionExecutor] Attack failed: missing parameters");
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Attack requires target and attackName",
        data: { reason: "missing_parameters" },
      };
    }

    if (!actorRef) {
      console.log("[AiActionExecutor] Attack failed: invalid combatant reference");
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Invalid combatant reference",
        data: { reason: "invalid_combatant_reference" },
      };
    }

    const targetCombatant = await this.findCombatantByName(decision.target, allCombatants);
    if (!targetCombatant) {
      console.log("[AiActionExecutor] Attack failed: target not found:", decision.target);
      return {
        action: decision.action,
        ok: false,
        summary: `Failed: Target ${decision.target} not found`,
        data: { reason: "target_not_found", target: decision.target },
      };
    }

    const targetRef = this.toCombatantRef(targetCombatant);
    if (!targetRef) {
      console.log("[AiActionExecutor] Attack failed: invalid target reference");
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Invalid target reference",
        data: { reason: "invalid_target_reference" },
      };
    }

    console.log("[AiActionExecutor] Calling actionService.attack...", { attacker: actorRef, target: targetRef });
    const result = await this.actionService.attack(sessionId, {
      encounterId,
      attacker: actorRef,
      target: targetRef,
      monsterAttackName: decision.attackName,
    });
    const hit = Boolean((result.result as Record<string, unknown>).hit);
    const damage = hit ? ((result.result as Record<string, unknown>).damage as Record<string, unknown>)?.applied ?? 0 : 0;

    console.log("[AiActionExecutor] Attack completed:", { hit, damage });

    // Process bonus action if included
    const bonusResult = await this.executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);

    const mainSummary = hit
      ? `Attack hit ${decision.target} for ${damage} damage`
      : `Attack missed ${decision.target}`;
    const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;

    return {
      action: decision.action,
      ok: true,
      summary: fullSummary,
      data: {
        hit,
        damage,
        target: decision.target,
        attackName: decision.attackName,
        ...(bonusResult ? { bonusAction: bonusResult } : {}),
      },
    };
  }

  private async executeMove(
    sessionId: string,
    encounterId: string,
    aiCombatant: CombatantStateRecord,
    decision: AiDecision,
    allCombatants: CombatantStateRecord[],
    actorRef: ActorRef | null,
  ): Promise<Omit<TurnStepResult, "step">> {
    if (!decision.destination) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Move requires destination",
        data: { reason: "missing_destination" },
      };
    }

    if (!actorRef) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Invalid combatant reference",
        data: { reason: "invalid_combatant_reference" },
      };
    }

    // Initiate two-phase move to detect opportunity attacks
    const moveInit = await this.twoPhaseActions.initiateMove(sessionId, {
      encounterId,
      actor: actorRef,
      destination: decision.destination,
    });

    let movedFeet = 0;
    const aiDecisions: Array<{ attackerId: string; used: boolean; reason: string }> = [];

    // If there are reactions, resolve them automatically
    if (moveInit.status === "awaiting_reactions" && moveInit.pendingActionId) {
      const pendingAction = await this.pendingActions.getById(moveInit.pendingActionId);
      if (!pendingAction) {
        return {
          action: decision.action,
          ok: false,
          summary: "Failed: Pending action not found",
          data: { reason: "pending_action_missing" },
        };
      }

      // Resolve each reaction opportunity
      for (const opp of moveInit.opportunityAttacks) {
        if (!opp.canAttack) {
          aiDecisions.push({ attackerId: opp.combatantId, used: false, reason: "cannot_attack" });
          continue;
        }

        // Get the attacker's state
        const attackerState = allCombatants.find((c) => c.id === opp.combatantId);
        if (!attackerState) {
          aiDecisions.push({ attackerId: opp.combatantId, used: false, reason: "attacker_not_found" });
          continue;
        }

        // Player characters don't auto-resolve - their OAs are handled via /combat/roll-result
        if (attackerState.combatantType === "Character") {
          aiDecisions.push({ attackerId: opp.combatantId, used: false, reason: "player_prompted" });
          continue;
        }

        // AI decides whether to use reaction for AI/Monster attackers
        const shouldUseReaction = await this.aiDecideReaction(attackerState, "opportunity_attack", {
          targetName: await this.combatantResolver.getName(actorRef, aiCombatant),
          hpPercent: attackerState.hpCurrent / attackerState.hpMax,
        });

        aiDecisions.push({
          attackerId: opp.combatantId,
          used: shouldUseReaction,
          reason: shouldUseReaction ? "ai_used" : "ai_declined",
        });

        // Update pending action with AI's decision
        if (shouldUseReaction && opp.opportunityId) {
          const updatedResolvedReactions = [
            ...pendingAction.resolvedReactions,
            {
              opportunityId: opp.opportunityId,
              combatantId: opp.combatantId,
              choice: "use" as const,
              respondedAt: new Date(),
            },
          ];
          await this.pendingActions.update({
            ...pendingAction,
            resolvedReactions: updatedResolvedReactions,
          });
        }
      }
    }

    // Check if there are player OAs that need prompting
    const playerOAsNeedingInput = aiDecisions.filter((d) => d.reason === "player_prompted");
    if (playerOAsNeedingInput.length > 0 && moveInit.pendingActionId) {
      // Store the pending action in the encounter so the player can resolve it
      await this.combat.setPendingAction(encounterId, moveInit.pendingActionId);

      // Return success but indicate we're awaiting player input
      const mainSummary = `Moved toward (${decision.destination.x}, ${decision.destination.y}) - awaiting ${playerOAsNeedingInput.length} player OA(s)`;

      return {
        action: decision.action,
        ok: true,
        summary: mainSummary,
        data: {
          awaitingPlayerInput: true,
          playerOAsCount: playerOAsNeedingInput.length,
          pendingActionId: moveInit.pendingActionId,
        },
      };
    }

    // No player OAs, or all reactions resolved - complete the move
    const moveComplete = await this.twoPhaseActions.completeMove(sessionId, {
      pendingActionId: moveInit.pendingActionId || "",
    });

    movedFeet = moveComplete.movedFeet;

    // Process bonus action if included
    const bonusResult = await this.executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);

    const usedCount = aiDecisions.filter((d) => d.used).length;
    const playerPromptCount = aiDecisions.filter((d) => d.reason === "player_prompted").length;
    const oaSummary =
      moveInit.opportunityAttacks.length > 0
        ? `, triggered ${usedCount}/${moveInit.opportunityAttacks.length} OA(s)` +
          (playerPromptCount > 0 ? ` (${playerPromptCount} awaiting player input)` : "")
        : "";
    const mainSummary = `Moved ${movedFeet}ft to (${decision.destination.x}, ${decision.destination.y})${oaSummary}`;
    const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;

    return {
      action: decision.action,
      ok: true,
      summary: fullSummary,
      data: {
        movedFeet,
        destination: decision.destination,
        opportunityAttacks: moveComplete.opportunityAttacks,
        aiReactionDecisions: aiDecisions,
        ...(bonusResult ? { bonusAction: bonusResult } : {}),
      },
    };
  }

  private async executeBasicAction(
    sessionId: string,
    encounterId: string,
    aiCombatant: CombatantStateRecord,
    decision: AiDecision,
    actorRef: ActorRef | null,
  ): Promise<Omit<TurnStepResult, "step">> {
    if (!actorRef) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Invalid combatant reference",
        data: { reason: "invalid_combatant_reference" },
      };
    }

    let mainSummary = "";
    if (decision.action === "disengage") {
      await this.actionService.disengage(sessionId, { encounterId, actor: actorRef });
      mainSummary = "Disengaged (no opportunity attacks while moving this turn)";
    } else if (decision.action === "dash") {
      await this.actionService.dash(sessionId, { encounterId, actor: actorRef });
      mainSummary = "Dashed (movement speed doubled for this turn)";
    } else {
      await this.actionService.dodge(sessionId, { encounterId, actor: actorRef });
      mainSummary = "Dodged (enemies have disadvantage on attacks until next turn)";
    }

    // Process bonus action if included
    const bonusResult = await this.executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);
    const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;

    return {
      action: decision.action,
      ok: true,
      summary: fullSummary,
      data: bonusResult ? { bonusAction: bonusResult } : undefined,
    };
  }

  private async executeHelp(
    sessionId: string,
    encounterId: string,
    aiCombatant: CombatantStateRecord,
    decision: AiDecision,
    allCombatants: CombatantStateRecord[],
    actorRef: ActorRef | null,
  ): Promise<Omit<TurnStepResult, "step">> {
    if (!actorRef) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Invalid combatant reference",
        data: { reason: "invalid_combatant_reference" },
      };
    }
    if (!decision.target) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Help requires a target",
        data: { reason: "missing_target" },
      };
    }

    const targetCombatant = await this.findCombatantByName(decision.target, allCombatants);
    if (!targetCombatant) {
      return {
        action: decision.action,
        ok: false,
        summary: `Failed: Target ${decision.target} not found`,
        data: { reason: "target_not_found", target: decision.target },
      };
    }

    const targetRef = this.toCombatantRef(targetCombatant);
    if (!targetRef) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Invalid target reference",
        data: { reason: "invalid_target_reference" },
      };
    }

    await this.actionService.help(sessionId, { encounterId, actor: actorRef, target: targetRef });

    // Process bonus action if included
    const bonusResult = await this.executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);
    const mainSummary = `Helped ${decision.target} (next check/attack gains advantage, depending on context)`;
    const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;

    return {
      action: decision.action,
      ok: true,
      summary: fullSummary,
      data: { target: decision.target, ...(bonusResult ? { bonusAction: bonusResult } : {}) },
    };
  }

  private async executeCastSpell(
    sessionId: string,
    encounterId: string,
    aiCombatant: CombatantStateRecord,
    decision: AiDecision,
    actorRef: ActorRef | null,
  ): Promise<Omit<TurnStepResult, "step">> {
    if (!actorRef) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Invalid combatant reference",
        data: { reason: "invalid_combatant_reference" },
      };
    }

    const spellNameRaw = (decision as Record<string, unknown>).spellName;
    const spellName = typeof spellNameRaw === "string" ? spellNameRaw.trim() : "";
    if (spellName.length === 0) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: castSpell requires spellName",
        data: { reason: "missing_spell_name" },
      };
    }

    await this.actionService.castSpell(sessionId, { encounterId, actor: actorRef, spellName });

    // Process bonus action if included
    const bonusResult = await this.executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);
    const mainSummary = `Cast spell: ${spellName}`;
    const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;

    return {
      action: decision.action,
      ok: true,
      summary: fullSummary,
      data: { spellName, ...(bonusResult ? { bonusAction: bonusResult } : {}) },
    };
  }

  private async executeShove(
    sessionId: string,
    encounterId: string,
    aiCombatant: CombatantStateRecord,
    decision: AiDecision,
    allCombatants: CombatantStateRecord[],
    actorRef: ActorRef | null,
  ): Promise<Omit<TurnStepResult, "step">> {
    if (!decision.target) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Shove requires target",
        data: { reason: "missing_target" },
      };
    }

    if (!actorRef) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Invalid combatant reference",
        data: { reason: "invalid_combatant_reference" },
      };
    }

    const targetCombatant = await this.findCombatantByName(decision.target, allCombatants);
    if (!targetCombatant) {
      return {
        action: decision.action,
        ok: false,
        summary: `Failed: Target ${decision.target} not found`,
        data: { reason: "target_not_found", target: decision.target },
      };
    }

    const targetRef = this.toCombatantRef(targetCombatant);
    if (!targetRef) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Invalid target reference",
        data: { reason: "invalid_target_reference" },
      };
    }

    const seed = typeof (decision as Record<string, unknown>).seed === "number"
      ? (decision as Record<string, unknown>).seed as number
      : undefined;
    const result = await this.actionService.shove(sessionId, {
      encounterId,
      actor: actorRef,
      target: targetRef,
      shoveType: "push",
      ...(seed !== undefined ? { seed } : {}),
    } as Parameters<CombatActionService["shove"]>[1]);

    const data: Record<string, unknown> = {
      target: decision.target,
      success: result.result.success,
      attackerRoll: result.result.attackerRoll,
      targetRoll: result.result.targetRoll,
      ...(result.result.pushedTo ? { pushedTo: result.result.pushedTo } : {}),
      ...(seed !== undefined ? { seed } : {}),
    };

    // Process bonus action if included
    const bonusResult = await this.executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);
    if (bonusResult) {
      data.bonusAction = bonusResult;
    }

    if (result.result.success) {
      const mainSummary = result.result.pushedTo
        ? `Shove succeeded: pushed ${decision.target} to (${result.result.pushedTo.x}, ${result.result.pushedTo.y})`
        : `Shove succeeded against ${decision.target}`;
      const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;
      return { action: decision.action, ok: true, summary: fullSummary, data };
    }

    const mainSummary = `Shove failed against ${decision.target} (attacker ${result.result.attackerRoll} vs target ${result.result.targetRoll})`;
    const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;
    return {
      action: decision.action,
      ok: true,
      summary: fullSummary,
      data,
    };
  }

  private async executeEndTurn(
    sessionId: string,
    encounterId: string,
    aiCombatant: CombatantStateRecord,
    decision: AiDecision,
    actorRef: ActorRef | null,
  ): Promise<Omit<TurnStepResult, "step">> {
    // Process bonus action even if ending turn (e.g., Nimble Escape without main action)
    const bonusResult = await this.executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);
    const summary = bonusResult ? `Ended turn (bonus action: ${bonusResult.summary})` : "Ended turn";
    return {
      action: decision.action,
      ok: true,
      summary,
      data: bonusResult ? { bonusAction: bonusResult } : undefined,
    };
  }

  /**
   * Execute bonus action using the ability registry.
   * Falls back to legacy string matching for backward compatibility.
   * Returns summary of bonus action result, or null if none.
   */
  private async executeBonusAction(
    sessionId: string,
    encounterId: string,
    aiCombatant: CombatantStateRecord,
    decision: AiDecision,
    actorRef: ActorRef | null,
  ): Promise<{ action: string; summary: string } | null> {
    if (!decision.bonusAction || typeof decision.bonusAction !== "string") {
      return null;
    }

    if (!actorRef) {
      this.aiLog("[AiActionExecutor] Cannot execute bonus action: invalid actor ref");
      return null;
    }

    const bonusActionId = decision.bonusAction.trim();

    // Try registry first
    if (this.abilityRegistry.hasExecutor(bonusActionId)) {
      try {
        const result = await this.abilityRegistry.execute({
          sessionId,
          encounterId,
          actor: {} as never, // Not used by current executors
          combat: {} as never, // Not used by current executors
          abilityId: bonusActionId,
          params: {
            actor: actorRef,
            resources: aiCombatant.resources,
            target: decision.target
              ? {
                  type: actorRef.type === "Monster" ? "Character" : "Monster",
                  [actorRef.type === "Monster" ? "characterId" : "monsterId"]: decision.target,
                }
              : undefined,
            targetName: decision.target,
          },
          services: {
            disengage: async (params: Parameters<CombatActionService["disengage"]>[1]) =>
              this.actionService.disengage(sessionId, params),
            dash: async (params: Parameters<CombatActionService["dash"]>[1]) =>
              this.actionService.dash(sessionId, params),
            dodge: async (params: Parameters<CombatActionService["dodge"]>[1]) =>
              this.actionService.dodge(sessionId, params),
            hide: async () => {
              throw new Error("Hide action not yet implemented");
            },
            attack: async (params: Parameters<CombatActionService["attack"]>[1]) =>
              this.actionService.attack(sessionId, params),
          },
        });

        // If execution includes resource spending, update combatant resources
        if (result.success && result.data?.spendResource) {
          const spendResource = result.data.spendResource as { poolName: string; amount: number };
          const { spendResourceFromPool } = await import("../helpers/resource-utils.js");
          const updatedResources = spendResourceFromPool(
            aiCombatant.resources,
            spendResource.poolName,
            spendResource.amount,
          );
          await this.combat.updateCombatantState(aiCombatant.id, { resources: updatedResources });
        }

        return {
          action: bonusActionId,
          summary: result.summary,
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.aiLog(`[AiActionExecutor] Registry execution failed: ${message}`);
        // Fall through to legacy handling
      }
    }

    // Legacy string matching for backward compatibility
    const bonus = bonusActionId.toLowerCase();

    try {
      // Nimble Escape: Disengage as bonus action
      if (bonus === "nimble_escape_disengage" || bonus === "disengage") {
        await this.actionService.disengage(sessionId, { encounterId, actor: actorRef });
        return { action: "disengage", summary: "Disengaged (bonus action)" };
      }

      // Nimble Escape: Hide as bonus action
      if (bonus === "nimble_escape_hide" || bonus === "hide") {
        this.aiLog("[AiActionExecutor] Hide action not yet implemented in action service");
        return { action: "hide", summary: "Attempted to hide (bonus action, not fully implemented)" };
      }

      // Cunning Action (Rogue): Dash as bonus action
      if (bonus === "cunning_action_dash") {
        await this.actionService.dash(sessionId, { encounterId, actor: actorRef });
        return { action: "dash", summary: "Dashed (bonus action)" };
      }

      // Cunning Action (Rogue): Disengage as bonus action
      if (bonus === "cunning_action_disengage") {
        await this.actionService.disengage(sessionId, { encounterId, actor: actorRef });
        return { action: "disengage", summary: "Disengaged (bonus action)" };
      }

      // Cunning Action (Rogue): Hide as bonus action
      if (bonus === "cunning_action_hide") {
        this.aiLog("[AiActionExecutor] Hide action not yet implemented in action service");
        return { action: "hide", summary: "Attempted to hide (bonus action, not fully implemented)" };
      }

      // Off-hand attack (two-weapon fighting)
      if (bonus === "offhand_attack") {
        this.aiLog("[AiActionExecutor] Off-hand attack bonus action not yet implemented");
        return { action: "offhand_attack", summary: "Off-hand attack (not implemented)" };
      }

      // Flurry of Blows (Monk)
      if (bonus === "flurry_of_blows") {
        this.aiLog("[AiActionExecutor] Flurry of Blows bonus action not yet implemented");
        return { action: "flurry_of_blows", summary: "Flurry of Blows (not implemented)" };
      }

      // Unknown bonus action
      this.aiLog(`[AiActionExecutor] Unknown bonus action: ${decision.bonusAction}`);
      return { action: bonus, summary: `Bonus action ${decision.bonusAction} not implemented` };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.aiLog(`[AiActionExecutor] Bonus action failed: ${message}`);
      return { action: bonus, summary: `Bonus action failed: ${message}` };
    }
  }
}
