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
import type { ICharacterRepository } from "../../../repositories/character-repository.js";
import type { IEventRepository } from "../../../repositories/event-repository.js";
import type { PendingActionRepository } from "../../../repositories/pending-action-repository.js";
import type { AbilityRegistry } from "../abilities/ability-registry.js";
import type { AiDecision, TurnStepResult, ActorRef } from "./ai-types.js";
import type { DiceRoller } from "../../../../domain/rules/dice-roller.js";
import type { CombatantRef } from "../helpers/combatant-ref.js";
import { normalizeResources, hasResourceAvailable, getEffectiveSpeed, getPosition, spendAction } from "../helpers/resource-utils.js";
import { findPreparedSpellInSheet, prepareSpellCast } from "../helpers/spell-slot-manager.js";
import { hasReactionAvailable } from "../../../../domain/rules/opportunity-attack.js";
import { calculateDistance } from "../../../../domain/rules/movement.js";
import { findPath, findAdjacentPosition, findRetreatPosition } from "../../../../domain/rules/pathfinding.js";
import type { CombatMap } from "../../../../domain/rules/combat-map.js";
import { getMapZones } from "../../../../domain/rules/combat-map.js";
import { normalizeConditions, hasCondition } from "../../../../domain/entities/combat/conditions.js";
import { buildPathNarration } from "../tabletop/path-narrator.js";
import { resolveAiMovement, generateLinearPath, type AiMovementDeps } from "./ai-movement-resolver.js";
import { AiAttackResolver } from "./ai-attack-resolver.js";
import { getInventory } from "../helpers/resource-utils.js";
import { findInventoryItem, useConsumableItem } from "../../../../domain/entities/items/inventory.js";
import { POTION_HEALING_FORMULAS } from "../../../../domain/entities/items/magic-item-catalog.js";
import { lookupMagicItem } from "../../../../domain/entities/items/magic-item-catalog.js";

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
    private readonly diceRoller?: DiceRoller,
    private readonly events?: IEventRepository,
    /** Character repository for spell slot + concentration bookkeeping. Optional for backward compat. */
    private readonly characters?: ICharacterRepository,
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
   * Check if action economy allows this action type.
   */
  private isActionConsuming(action: string): boolean {
    return ["attack", "disengage", "dash", "dodge", "help", "castSpell", "shove", "grapple", "hide", "search", "useObject"].includes(action);
  }

  /**
   * Get action economy from combatant resources.
   */
  private getEconomy(aiCombatant: CombatantStateRecord): { actionSpent: boolean; bonusActionSpent: boolean } {
    const resources = aiCombatant.resources as Record<string, unknown> | null;
    return {
      actionSpent: resources?.actionSpent === true,
      bonusActionSpent: resources?.bonusActionSpent === true,
    };
  }

  /** Build deps bundle for resolveAiMovement. */
  private getMovementDeps(): AiMovementDeps {
    return {
      combat: this.combat,
      twoPhaseActions: this.twoPhaseActions,
      pendingActions: this.pendingActions,
      combatantResolver: this.combatantResolver,
      aiDecideReaction: this.aiDecideReaction,
      aiLog: this.aiLog,
    };
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

      // Server-side action economy enforcement
      const economy = this.getEconomy(aiCombatant);
      if (economy.actionSpent && this.isActionConsuming(decision.action)) {
        this.aiLog(`[AiActionExecutor] Rejecting ${decision.action} - action already spent this turn`);
        return {
          action: decision.action,
          ok: false,
          summary: `Cannot ${decision.action} - action already spent this turn. Use "move" or "endTurn" instead.`,
          data: { reason: "action_spent", suggestedAction: "move" },
        };
      }

      if (decision.action === "attack") {
        return this.executeAttack(sessionId, encounterId, aiCombatant, decision, allCombatants, actorRef);
      }

      if (decision.action === "move") {
        return this.executeMove(sessionId, encounterId, aiCombatant, decision, allCombatants, actorRef);
      }

      if (decision.action === "moveToward") {
        return this.executeMoveToward(sessionId, encounterId, aiCombatant, decision, allCombatants, actorRef);
      }

      if (decision.action === "moveAwayFrom") {
        return this.executeMoveAwayFrom(sessionId, encounterId, aiCombatant, decision, allCombatants, actorRef);
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

      if (decision.action === "grapple") {
        return this.executeGrapple(sessionId, encounterId, aiCombatant, decision, allCombatants, actorRef);
      }

      if (decision.action === "escapeGrapple") {
        return this.executeEscapeGrapple(sessionId, encounterId, aiCombatant, decision, actorRef);
      }

      if (decision.action === "hide") {
        return this.executeHide(sessionId, encounterId, aiCombatant, decision, actorRef);
      }

      if (decision.action === "search") {
        return this.executeSearch(sessionId, encounterId, aiCombatant, decision, actorRef);
      }

      if (decision.action === "useObject") {
        return this.executeUseObject(sessionId, encounterId, aiCombatant, decision, actorRef);
      }

      if (decision.action === "endTurn") {
        return this.executeEndTurn(sessionId, encounterId, aiCombatant, decision, actorRef);
      }

      return {
        action: decision.action,
        ok: false,
        summary: `Action ${decision.action} not recognized. Use 'attack', 'move', 'dodge', 'dash', 'disengage', 'help', 'shove', 'grapple', 'hide', 'search', 'castSpell', or 'endTurn'.`,
        data: { reason: "unknown_action" },
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

  /** Execute an attack action. Supports two-phase reactions (Shield, Deflect Attacks, damage reactions). */
  async executeAttack(
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

    // ── Range validation: enforce D&D 5e distance rules before attacking ──
    const actorResources = normalizeResources(aiCombatant.resources);
    const actorPos = getPosition(actorResources);
    const targetPos = getPosition(normalizeResources(targetCombatant.resources));
    if (actorPos && targetPos) {
      const dist = calculateDistance(actorPos, targetPos);
      // Look up the chosen attack to determine melee vs ranged and reach/range
      const monsterAttacks = actorRef.type === "Monster"
        ? await this.combatantResolver.getMonsterAttacks(actorRef.monsterId)
        : [];
      const desiredName = (decision.attackName ?? "").trim().toLowerCase();
      const chosenAttack = monsterAttacks.find(
        (a: any) => typeof a?.name === "string" && a.name.trim().toLowerCase() === desiredName,
      ) as Record<string, unknown> | undefined;
      const attackKindCheck: "melee" | "ranged" = (chosenAttack as any)?.kind === "ranged" ? "ranged" : "melee";

      if (attackKindCheck === "melee") {
        const reachValue = (chosenAttack as any)?.reach ?? (actorResources as any).reach;
        const reach = typeof reachValue === "number" ? reachValue : 5;
        if (dist > reach + 0.0001) {
          this.aiLog(`[AiActionExecutor] Melee attack out of reach: ${Math.round(dist)}ft > ${reach}ft`);
          return {
            action: decision.action,
            ok: false,
            summary: `Failed: Target is ${Math.round(dist)}ft away, but ${decision.attackName} has ${reach}ft reach. Move closer first.`,
            data: { reason: "out_of_reach", distance: Math.round(dist), reach },
          };
        }
      } else {
        // Ranged attack: check max range
        const rangeObj = (chosenAttack as any)?.range;
        let maxRange = 600; // D&D 5e default: no range means 600ft
        if (typeof rangeObj === "string") {
          const parts = rangeObj.split("/").map(Number);
          if (parts.length >= 2 && !isNaN(parts[1]!)) maxRange = parts[1]!;
          else if (parts.length >= 1 && !isNaN(parts[0]!)) maxRange = parts[0]!;
        } else if (rangeObj && typeof rangeObj === "object") {
          maxRange = typeof rangeObj.long === "number" ? rangeObj.long
            : typeof rangeObj.max === "number" ? rangeObj.max
            : typeof rangeObj.normal === "number" ? rangeObj.normal
            : 600;
        }
        if (dist > maxRange + 0.0001) {
          this.aiLog(`[AiActionExecutor] Ranged attack out of range: ${Math.round(dist)}ft > ${maxRange}ft`);
          return {
            action: decision.action,
            ok: false,
            summary: `Failed: Target is ${Math.round(dist)}ft away, beyond ${decision.attackName}'s ${maxRange}ft range. Move closer first.`,
            data: { reason: "out_of_range", distance: Math.round(dist), maxRange },
          };
        }
      }
    }

    // Check if target is a Character with Shield reaction available
    const targetResources = normalizeResources(targetCombatant.resources);
    const targetHasShield = targetCombatant.combatantType === "Character"
      && targetResources.hasShieldPrepared === true
      && hasReactionAvailable({ reactionUsed: !!targetResources.reactionUsed } as any)
      && hasResourceAvailable(targetCombatant.resources, "spellSlot_1", 1);

    // Check if target is a Character that may have Deflect Attacks (Monk reaction)
    // We check the basic prerequisites here; the full eligibility check is in initiateAttack()
    const targetHasDeflectReaction = targetCombatant.combatantType === "Character"
      && hasReactionAvailable({ reactionUsed: !!targetResources.reactionUsed } as any);

    // If target has Shield or Deflect Attacks and we have a dice roller, use two-phase flow
    // This allows initiateAttack() to detect all reaction opportunities
    if ((targetHasShield || targetHasDeflectReaction) && this.diceRoller) {
      console.log("[AiActionExecutor] Target may have reactions (Shield/Deflect) - using two-phase attack flow");

      const monsterAttacks = actorRef.type === "Monster"
        ? await this.combatantResolver.getMonsterAttacks(actorRef.monsterId)
        : [];

      const attackOutcome = await new AiAttackResolver({
        combat: this.combat,
        twoPhaseActions: this.twoPhaseActions,
        pendingActions: this.pendingActions,
        combatantResolver: this.combatantResolver,
        events: this.events,
        diceRoller: this.diceRoller,
        aiLog: this.aiLog,
      }).resolve({
        sessionId, encounterId,
        aiCombatant, targetCombatant,
        actorRef, targetRef,
        attackName: decision.attackName,
        monsterAttacks,
      });

      if (attackOutcome.status === "not_applicable") {
        console.log("[AiActionExecutor] Two-phase flow: attack not found, falling back to normal flow");
        // Fall through to normal path below
      } else if (attackOutcome.status === "miss") {
        const bonusResult = await this.executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);
        const mainSummary = `Attack missed ${decision.target}`;
        const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;
        return {
          action: decision.action,
          ok: true,
          summary: fullSummary,
          data: { hit: false, damage: 0, target: decision.target, attackName: decision.attackName },
        };
      } else if (attackOutcome.status === "awaiting_reactions") {
        // Before returning: persist bonus action for after reaction resolves
        if (decision.bonusAction) {
          const currentRes = normalizeResources(aiCombatant.resources);
          await this.combat.updateCombatantState(aiCombatant.id, {
            resources: { ...currentRes, pendingBonusAction: decision.bonusAction } as any,
          });
        }
        return {
          action: decision.action,
          ok: true,
          summary: `Attack on ${decision.target} - awaiting player reaction`,
          data: {
            awaitingPlayerInput: true,
            pendingActionId: attackOutcome.pendingActionId,
            target: decision.target,
            attackName: decision.attackName,
            attackRoll: attackOutcome.attackTotal,
          },
        };
      } else if (attackOutcome.status === "awaiting_damage_reaction") {
        return {
          action: decision.action,
          ok: true,
          summary: `Attack hit ${decision.target} for ${attackOutcome.damageApplied} damage - awaiting damage reaction`,
          data: {
            awaitingPlayerInput: true,
            pendingActionId: attackOutcome.pendingActionId,
            hit: true,
            damage: attackOutcome.damageApplied,
            target: decision.target,
            attackName: decision.attackName,
          },
        };
      } else if (attackOutcome.status === "hit") {
        const bonusResult = await this.executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);
        const mainSummary = `Attack hit ${decision.target} for ${attackOutcome.damageApplied} damage`;
        const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;
        return {
          action: decision.action,
          ok: true,
          summary: fullSummary,
          data: { hit: true, damage: attackOutcome.damageApplied, target: decision.target, attackName: decision.attackName },
        };
      }
    }

    // Normal flow (no Shield protection needed)
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

    const resources = (aiCombatant.resources as Record<string, unknown>) ?? {};
    const currentPos = resources.position as { x: number; y: number } | undefined;
    const speed = getEffectiveSpeed(aiCombatant.resources);
    const hasDashed = (resources.dashed as boolean) ?? false;
    let effectiveSpeed = hasDashed ? speed * 2 : speed;

    // Account for Prone stand-up cost
    const aiConditions = normalizeConditions(aiCombatant.conditions as unknown[]);
    const isProne = hasCondition(aiConditions, "Prone");
    if (isProne) {
      const standUpCost = Math.ceil(speed / 2);
      effectiveSpeed -= standUpCost;
      this.aiLog(`[AiActionExecutor] Prone stand-up costs ${standUpCost}ft, effective speed: ${effectiveSpeed}ft`);
      if (effectiveSpeed <= 0) {
        return {
          action: decision.action,
          ok: false,
          summary: `Failed: Standing from Prone costs ${standUpCost}ft, no movement remaining`,
          data: { reason: "prone_no_movement" },
        };
      }
    }

    // Validate/clamp destination if needed
    let finalDestination = decision.destination;
    if (currentPos) {
      const requestedDistance = calculateDistance(currentPos, decision.destination);
      if (requestedDistance > effectiveSpeed) {
        const ratio = (effectiveSpeed * 0.99) / requestedDistance;
        const dx = decision.destination.x - currentPos.x;
        const dy = decision.destination.y - currentPos.y;
        finalDestination = {
          x: Math.round(currentPos.x + dx * ratio),
          y: Math.round(currentPos.y + dy * ratio),
        };
        const clampedDist = calculateDistance(currentPos, finalDestination);
        this.aiLog(`[AiActionExecutor] Clamped move from ${requestedDistance.toFixed(1)}ft to ${clampedDist.toFixed(1)}ft (max ${effectiveSpeed}ft): (${decision.destination.x}, ${decision.destination.y}) -> (${finalDestination.x}, ${finalDestination.y})`);
      }
    }

    const outcome = await resolveAiMovement(this.getMovementDeps(), {
      sessionId,
      encounterId,
      aiCombatant,
      actorRef,
      allCombatants,
      currentPos,
      finalDestination,
      effectiveSpeed,
      resources,
      zoneDamagePath: currentPos ? generateLinearPath(currentPos, finalDestination) : undefined,
    });

    if (outcome.kind === "aborted_by_trigger") {
      return {
        action: decision.action,
        ok: false,
        summary: `${outcome.message} Knocked out before moving.`,
        data: { reason: "knocked_out_by_movement_trigger" },
      };
    }

    if (outcome.kind === "player_oa_pending") {
      return {
        action: decision.action,
        ok: true,
        summary: `Moved toward (${finalDestination.x}, ${finalDestination.y}) - awaiting ${outcome.playerOAsCount} player OA(s)`,
        data: {
          awaitingPlayerInput: true,
          playerOAsCount: outcome.playerOAsCount,
          pendingActionId: outcome.pendingActionId,
        },
      };
    }

    const bonusResult = await this.executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);

    if (outcome.kind === "no_reactions") {
      const mainSummary = `Moved ${outcome.movedFeet}ft to (${finalDestination.x}, ${finalDestination.y})`;
      const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;
      return {
        action: decision.action,
        ok: true,
        summary: fullSummary,
        data: {
          movedFeet: outcome.movedFeet,
          destination: finalDestination,
          opportunityAttacks: [],
          ...(bonusResult ? { bonusAction: bonusResult } : {}),
        },
      };
    }

    // outcome.kind === "completed"
    const usedCount = outcome.aiDecisions.filter((d) => d.used).length;
    const playerPromptCount = outcome.aiDecisions.filter((d) => d.reason === "player_prompted").length;
    const oaSummary =
      outcome.opportunityAttacks.length > 0
        ? `, triggered ${usedCount}/${outcome.opportunityAttacks.length} OA(s)` +
          (playerPromptCount > 0 ? ` (${playerPromptCount} awaiting player input)` : "")
        : "";
    const mainSummary = `Moved ${outcome.movedFeet}ft to (${finalDestination.x}, ${finalDestination.y})${oaSummary}`;
    const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;

    return {
      action: decision.action,
      ok: true,
      summary: fullSummary,
      data: {
        movedFeet: outcome.movedFeet,
        destination: decision.destination,
        opportunityAttacks: outcome.opportunityAttacks,
        aiReactionDecisions: outcome.aiDecisions,
        ...(bonusResult ? { bonusAction: bonusResult } : {}),
      },
    };
  }
  /**
   * Execute a "moveToward" decision: resolve target position, A* pathfind, clamp to speed, two-phase move.
   */
  private async executeMoveToward(
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
        summary: "Failed: moveToward requires a target name",
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

    // Resolve actor position
    const resources = (aiCombatant.resources as Record<string, unknown>) ?? {};
    const currentPos = resources.position as { x: number; y: number } | undefined;
    if (!currentPos) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Actor has no position",
        data: { reason: "no_actor_position" },
      };
    }

    // Resolve target combatant
    const targetCombatant = await this.findCombatantByName(decision.target, allCombatants);
    if (!targetCombatant) {
      return {
        action: decision.action,
        ok: false,
        summary: `Failed: Target "${decision.target}" not found`,
        data: { reason: "target_not_found" },
      };
    }

    const targetResources = (targetCombatant.resources as Record<string, unknown>) ?? {};
    const targetPos = targetResources.position as { x: number; y: number } | undefined;
    if (!targetPos) {
      return {
        action: decision.action,
        ok: false,
        summary: `Failed: Target "${decision.target}" has no position`,
        data: { reason: "target_no_position" },
      };
    }

    const desiredRange = decision.desiredRange ?? 5;

    // Check if already in range
    const currentDistance = calculateDistance(currentPos, targetPos);
    if (currentDistance <= desiredRange) {
      return {
        action: decision.action,
        ok: true,
        summary: `Already within ${desiredRange}ft of ${decision.target} (${Math.round(currentDistance)}ft away)`,
        data: { movedFeet: 0, alreadyInRange: true },
      };
    }

    // Calculate effective speed
    const speed = getEffectiveSpeed(aiCombatant.resources);
    const hasDashed = (resources.dashed as boolean) ?? false;
    let effectiveSpeed = hasDashed ? speed * 2 : speed;

    // Account for Prone stand-up cost
    const aiConditions = normalizeConditions(aiCombatant.conditions as unknown[]);
    const isProne = hasCondition(aiConditions, "Prone");
    if (isProne) {
      const standUpCost = Math.ceil(speed / 2);
      effectiveSpeed -= standUpCost;
      this.aiLog(`[AiActionExecutor] Prone stand-up costs ${standUpCost}ft, effective speed: ${effectiveSpeed}ft`);
      if (effectiveSpeed <= 0) {
        return {
          action: decision.action,
          ok: false,
          summary: `Failed: Standing from Prone costs ${Math.ceil(speed / 2)}ft, no movement remaining`,
          data: { reason: "prone_no_movement" },
        };
      }
    }

    // Try to get combat map for A* pathfinding
    let combatMap: CombatMap | undefined;
    try {
      const encounter = await this.combat.getEncounterById(encounterId);
      combatMap = encounter?.mapData as unknown as CombatMap | undefined;
    } catch {
      // No map available, fall back to linear interpolation
    }

    let finalDestination: { x: number; y: number };
    let pathCells: { x: number; y: number }[] | undefined;
    let pathCostFeet: number | undefined;
    let pathNarrationHints: string[] | undefined;

    if (combatMap) {
      // Use A* pathfinding
      const dest = findAdjacentPosition(combatMap, targetPos, currentPos, desiredRange);
      if (!dest) {
        return {
          action: decision.action,
          ok: false,
          summary: `Failed: No reachable position within ${desiredRange}ft of ${decision.target}`,
          data: { reason: "no_reachable_position" },
        };
      }

      // Build occupied positions (exclude self and target)
      const occupiedPositions = allCombatants
        .filter((c) => c.id !== aiCombatant.id && c.id !== targetCombatant.id)
        .map((c) => (c.resources as Record<string, unknown>)?.position as { x: number; y: number })
        .filter((p): p is { x: number; y: number } => !!p && typeof p.x === "number" && typeof p.y === "number");

      const pathResult = findPath(combatMap, currentPos, dest, {
        maxCostFeet: effectiveSpeed,
        occupiedPositions,
        zones: getMapZones(combatMap),
      });

      if (pathResult.blocked && pathResult.path.length === 0) {
        return {
          action: decision.action,
          ok: false,
          summary: `Failed: Path to ${decision.target} is completely blocked`,
          data: { reason: "path_blocked" },
        };
      }

      // Use reachable position (might be partial path if speed insufficient to reach destination)
      finalDestination = pathResult.reachablePosition ?? dest;
      pathCells = pathResult.path;
      pathCostFeet = pathResult.totalCostFeet;
      pathNarrationHints = pathResult.narrationHints;
    } else {
      // No map: linear interpolation toward target, clamped to speed
      const dx = targetPos.x - currentPos.x;
      const dy = targetPos.y - currentPos.y;
      const dist = currentDistance - desiredRange;
      const moveDist = Math.min(dist, effectiveSpeed);
      const ratio = moveDist / currentDistance;
      finalDestination = {
        x: Math.round(currentPos.x + dx * ratio),
        y: Math.round(currentPos.y + dy * ratio),
      };
    }

    // Resolve names for summaries
    const targetName = await this.combatantResolver.getName(
      this.toCombatantRef(targetCombatant) ?? actorRef,
      targetCombatant,
    );
    const actorName = await this.combatantResolver.getName(actorRef, aiCombatant);

    const outcome = await resolveAiMovement(this.getMovementDeps(), {
      sessionId,
      encounterId,
      aiCombatant,
      actorRef,
      allCombatants,
      currentPos,
      finalDestination,
      effectiveSpeed,
      resources,
      pathCells,
      pathCostFeet,
      pathNarrationHints,
    });

    if (outcome.kind === "aborted_by_trigger") {
      return {
        action: decision.action,
        ok: false,
        summary: `${outcome.message} Knocked out before moving.`,
        data: { reason: "knocked_out_by_movement_trigger" },
      };
    }

    if (outcome.kind === "player_oa_pending") {
      return {
        action: decision.action,
        ok: true,
        summary: `Moved toward ${targetName} - awaiting ${outcome.playerOAsCount} player OA(s)`,
        data: {
          awaitingPlayerInput: true,
          playerOAsCount: outcome.playerOAsCount,
          pendingActionId: outcome.pendingActionId,
        },
      };
    }

    const bonusResult = await this.executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);

    if (outcome.kind === "no_reactions") {
      const pathNarration = buildPathNarration({
        actorName,
        targetName,
        pathCells,
        pathCostFeet: outcome.pathCostFeet,
        desiredRange,
        narrationHints: pathNarrationHints,
        partial: pathCostFeet != null && outcome.pathCostFeet < calculateDistance(currentPos, finalDestination),
        startPosition: currentPos,
        endPosition: finalDestination,
      });
      const fullSummary = bonusResult ? `${pathNarration} ${bonusResult.summary}` : pathNarration;
      return {
        action: decision.action,
        ok: true,
        summary: fullSummary,
        data: {
          movedFeet: outcome.pathCostFeet,
          destination: finalDestination,
          targetName,
          desiredRange,
          pathNarration,
          pathNarrationHints,
          opportunityAttacks: [],
          ...(bonusResult ? { bonusAction: bonusResult } : {}),
        },
      };
    }

    // outcome.kind === "completed"
    const usedCount = outcome.aiDecisions.filter((d) => d.used).length;
    const oaSummary = outcome.opportunityAttacks.length > 0
      ? ` Triggered ${usedCount}/${outcome.opportunityAttacks.length} OA(s).`
      : "";
    const pathNarration = buildPathNarration({
      actorName,
      targetName,
      pathCells,
      pathCostFeet: outcome.movedFeet,
      desiredRange,
      narrationHints: pathNarrationHints,
      partial: false,
      startPosition: currentPos,
      endPosition: finalDestination,
    });
    const mainSummary = `${pathNarration}${oaSummary}`;
    const fullSummary = bonusResult ? `${mainSummary} ${bonusResult.summary}` : mainSummary;

    return {
      action: decision.action,
      ok: true,
      summary: fullSummary,
      data: {
        movedFeet: outcome.movedFeet,
        destination: finalDestination,
        targetName,
        desiredRange,
        pathNarration,
        pathNarrationHints,
        opportunityAttacks: outcome.opportunityAttacks,
        aiReactionDecisions: outcome.aiDecisions,
        ...(bonusResult ? { bonusAction: bonusResult } : {}),
      },
    };
  }

  /**
   * Execute a "moveAwayFrom" decision: move as far as possible AWAY from the named target.
   * Server handles retreat pathfinding — LLM only needs to name who to flee from.
   */
  private async executeMoveAwayFrom(
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
        summary: "Failed: moveAwayFrom requires a target name",
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

    const resources = (aiCombatant.resources as Record<string, unknown>) ?? {};
    const currentPos = resources.position as { x: number; y: number } | undefined;
    if (!currentPos) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Actor has no position",
        data: { reason: "no_actor_position" },
      };
    }

    // Resolve target position (flee FROM this creature)
    const targetCombatant = await this.findCombatantByName(decision.target, allCombatants);
    if (!targetCombatant) {
      return {
        action: decision.action,
        ok: false,
        summary: `Failed: Target "${decision.target}" not found`,
        data: { reason: "target_not_found" },
      };
    }

    const targetResources = (targetCombatant.resources as Record<string, unknown>) ?? {};
    const targetPos = targetResources.position as { x: number; y: number } | undefined;
    if (!targetPos) {
      return {
        action: decision.action,
        ok: false,
        summary: `Failed: Target "${decision.target}" has no position`,
        data: { reason: "target_no_position" },
      };
    }

    // Calculate effective speed
    const speed = getEffectiveSpeed(aiCombatant.resources);
    const hasDashed = (resources.dashed as boolean) ?? false;
    let effectiveSpeed = hasDashed ? speed * 2 : speed;

    // Account for Prone stand-up cost
    const aiConditions = normalizeConditions(aiCombatant.conditions as unknown[]);
    const isProne = hasCondition(aiConditions, "Prone");
    if (isProne) {
      const standUpCost = Math.ceil(speed / 2);
      effectiveSpeed -= standUpCost;
      if (effectiveSpeed <= 0) {
        return {
          action: decision.action,
          ok: false,
          summary: `Failed: Standing from Prone costs ${Math.ceil(speed / 2)}ft, no movement remaining`,
          data: { reason: "prone_no_movement" },
        };
      }
    }

    // Try to get combat map
    let combatMap: CombatMap | undefined;
    try {
      const encounter = await this.combat.getEncounterById(encounterId);
      combatMap = encounter?.mapData as unknown as CombatMap | undefined;
    } catch {
      // No map
    }

    // Build occupied positions (exclude self)
    const occupiedPositions = allCombatants
      .filter((c) => c.id !== aiCombatant.id)
      .map((c) => (c.resources as Record<string, unknown>)?.position as { x: number; y: number })
      .filter((p): p is { x: number; y: number } => !!p && typeof p.x === "number" && typeof p.y === "number");

    // Get zones for pathfinding awareness
    let zones: import("../../../../domain/entities/combat/zones.js").CombatZone[] | undefined;
    if (combatMap) {
      zones = getMapZones(combatMap);
    }

    const retreatDest = findRetreatPosition(
      combatMap,
      currentPos,
      targetPos,
      effectiveSpeed,
      occupiedPositions,
      zones,
    );

    const retreatDistance = calculateDistance(currentPos, retreatDest);
    if (retreatDistance < 1) {
      return {
        action: decision.action,
        ok: true,
        summary: `Cannot retreat further from ${decision.target} — surrounded or blocked`,
        data: { movedFeet: 0, blocked: true },
      };
    }

    // Use A* pathfinding to get the actual path if map is available
    let pathCells: { x: number; y: number }[] | undefined;
    let pathCostFeet: number | undefined;
    let pathNarrationHints: string[] | undefined;

    if (combatMap) {
      const pathResult = findPath(combatMap, currentPos, retreatDest, {
        maxCostFeet: effectiveSpeed,
        occupiedPositions,
        zones,
      });
      if (!pathResult.blocked || pathResult.path.length > 0) {
        retreatDest.x = (pathResult.reachablePosition ?? retreatDest).x;
        retreatDest.y = (pathResult.reachablePosition ?? retreatDest).y;
        pathCells = pathResult.path;
        pathCostFeet = pathResult.totalCostFeet;
        pathNarrationHints = pathResult.narrationHints;
      }
    }

    // Resolve names for summaries
    const actorName = await this.combatantResolver.getName(actorRef, aiCombatant);
    const targetName = await this.combatantResolver.getName(
      this.toCombatantRef(targetCombatant) ?? actorRef,
      targetCombatant,
    );

    const outcome = await resolveAiMovement(this.getMovementDeps(), {
      sessionId,
      encounterId,
      aiCombatant,
      actorRef,
      allCombatants,
      currentPos,
      finalDestination: retreatDest,
      effectiveSpeed,
      resources,
      pathCells,
      pathCostFeet,
      pathNarrationHints,
    });

    if (outcome.kind === "aborted_by_trigger") {
      return {
        action: decision.action,
        ok: false,
        summary: `${outcome.message} Knocked out before retreating.`,
        data: { reason: "knocked_out_by_movement_trigger" },
      };
    }

    if (outcome.kind === "player_oa_pending") {
      return {
        action: decision.action,
        ok: true,
        summary: `Retreating from ${targetName} — awaiting ${outcome.playerOAsCount} player OA(s)`,
        data: {
          awaitingPlayerInput: true,
          playerOAsCount: outcome.playerOAsCount,
          pendingActionId: outcome.pendingActionId,
        },
      };
    }

    const bonusResult = await this.executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);

    if (outcome.kind === "no_reactions") {
      const newDist = Math.round(calculateDistance(retreatDest, targetPos));
      const mainSummary = `${actorName} retreats ${outcome.pathCostFeet}ft from ${targetName} (now ${newDist}ft away)`;
      const fullSummary = bonusResult ? `${mainSummary}. ${bonusResult.summary}` : mainSummary;

      return {
        action: decision.action,
        ok: true,
        summary: fullSummary,
        data: {
          movedFeet: outcome.pathCostFeet,
          destination: retreatDest,
          targetName,
          retreatedFromDistance: Math.round(calculateDistance(currentPos, targetPos)),
          newDistance: newDist,
          ...(bonusResult ? { bonusAction: bonusResult } : {}),
        },
      };
    }

    // outcome.kind === "completed"
    const newDist = Math.round(calculateDistance(retreatDest, targetPos));
    const usedCount = outcome.aiDecisions.filter((d) => d.used).length;
    const oaSummary = outcome.opportunityAttacks.length > 0
      ? ` Triggered ${usedCount}/${outcome.opportunityAttacks.length} OA(s).`
      : "";
    const mainSummary = `${actorName} retreats ${outcome.movedFeet}ft from ${targetName} (now ${newDist}ft away).${oaSummary}`;
    const fullSummary = bonusResult ? `${mainSummary} ${bonusResult.summary}` : mainSummary;

    return {
      action: decision.action,
      ok: true,
      summary: fullSummary,
      data: {
        movedFeet: outcome.movedFeet,
        destination: retreatDest,
        targetName,
        newDistance: newDist,
        opportunityAttacks: outcome.opportunityAttacks,
        aiReactionDecisions: outcome.aiDecisions,
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

    // Determine spell level from the decision or default to 1
    const spellLevelRaw = (decision as Record<string, unknown>).spellLevel;
    const spellLevel = typeof spellLevelRaw === "number" ? spellLevelRaw : 1;

    // ── Spell metadata lookup ──────────────────────────────────────────
    // Only Character-type casters have spell slots tracked in combatant resources.
    // Monsters use statBlock.spells (informational only, no slot pool in resources).
    const isCharacterCaster = aiCombatant.combatantType === "Character" && !!aiCombatant.characterId;

    // Resolve concentration flag from the caster's character sheet (if available).
    // Monster/NPC casters without a character sheet fall back to isConcentration=false.
    let isConcentration = false;
    if (isCharacterCaster && this.characters) {
      try {
        const characterRecord = await this.characters.getById(aiCombatant.characterId!);
        if (characterRecord) {
          const spellDef = findPreparedSpellInSheet(characterRecord.sheet, spellName);
          if (spellDef) {
            isConcentration = spellDef.concentration ?? false;
          }
        }
      } catch {
        // Non-fatal: fall back to isConcentration=false
      }
    }

    // Use two-phase spell cast flow to detect Counterspell opportunities
    const initiateResult = await this.twoPhaseActions.initiateSpellCast(sessionId, {
      encounterId,
      actor: actorRef as CombatantRef,
      spellName,
      spellLevel,
    });

    console.log("[AiActionExecutor] initiateSpellCast result:", {
      status: initiateResult.status,
      pendingActionId: initiateResult.pendingActionId,
      counterspellOpportunities: initiateResult.counterspellOpportunities.length,
    });

    if (initiateResult.status === "awaiting_reactions" && initiateResult.pendingActionId) {
      console.log("[AiActionExecutor] Spell cast awaiting Counterspell reaction from player");

      // Spend spell slot + manage concentration BEFORE storing the pending action.
      // D&D 5e 2024: slot is expended when the spell is cast, even if Counterspelled.
      // Only for Character casters — monsters don't track spell slots in resources.
      if (isCharacterCaster) {
        await prepareSpellCast(
          aiCombatant.id,
          encounterId,
          spellName,
          spellLevel,
          isConcentration,
          this.combat,
        );
      }

      // Store pending action on encounter for reaction route polling
      await this.combat.setPendingAction(encounterId, {
        id: initiateResult.pendingActionId,
        type: "reaction_pending",
        pendingActionId: initiateResult.pendingActionId,
        reactionType: "counterspell",
        spellName,
        spellLevel,
      });

      // Mark action as spent — re-fetch fresh resources to avoid overwriting slot change
      const freshCombatants = await this.combat.listCombatants(encounterId);
      const freshActor = freshCombatants.find((c) => c.id === aiCombatant.id);
      await this.combat.updateCombatantState(aiCombatant.id, {
        resources: spendAction((freshActor ?? aiCombatant).resources),
      });

      return {
        action: decision.action,
        ok: true,
        summary: `Casting ${spellName} - awaiting Counterspell reaction`,
        data: {
          awaitingPlayerInput: true,
          pendingActionId: initiateResult.pendingActionId,
          spellName,
          spellLevel,
        },
      };
    }

    // No Counterspell opportunities — spell resolves immediately.
    // Spend slot + manage concentration using shared helper (Character casters only).
    if (isCharacterCaster) {
      await prepareSpellCast(
        aiCombatant.id,
        encounterId,
        spellName,
        spellLevel,
        isConcentration,
        this.combat,
      );
    }

    // TODO: [SpellDelivery] AI spell mechanical effects (damage, healing, saving throws,
    // buffs, zone effects) are NOT applied in the AI path. Full delivery requires the
    // interactive tabletop dice flow (SpellAttackDeliveryHandler returns requiresPlayerInput=true).
    // Tracked in plan-spell-path-unification.prompt.md.
    // Use cosmetic castSpell to mark action spent + emit ActionResolved event.
    await this.actionService.castSpell(sessionId, { encounterId, actor: actorRef, spellName });

    // Process bonus action if included
    const bonusResult = await this.executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);
    const mainSummary = `Cast spell: ${spellName}`;
    const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;

    return {
      action: decision.action,
      ok: true,
      summary: fullSummary,
      data: { spellName, spellLevel, ...(bonusResult ? { bonusAction: bonusResult } : {}) },
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
      attackRoll: result.result.attackRoll,
      attackTotal: result.result.attackTotal,
      targetAC: result.result.targetAC,
      hit: result.result.hit,
      dc: result.result.dc,
      saveRoll: result.result.saveRoll,
      total: result.result.total,
      abilityUsed: result.result.abilityUsed,
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

    const mainSummary = result.result.hit
      ? `Shove failed against ${decision.target} (save DC ${result.result.dc}, target rolled ${result.result.total})`
      : `Shove failed against ${decision.target} (Unarmed Strike missed: ${result.result.attackTotal} vs AC ${result.result.targetAC})`;
    const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;
    return {
      action: decision.action,
      ok: true,
      summary: fullSummary,
      data,
    };
  }

  private async executeGrapple(
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
        summary: "Failed: Grapple requires target",
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
    const result = await this.actionService.grapple(sessionId, {
      encounterId,
      actor: actorRef,
      target: targetRef,
      ...(seed !== undefined ? { seed } : {}),
    } as Parameters<CombatActionService["grapple"]>[1]);

    const data: Record<string, unknown> = {
      target: decision.target,
      success: result.result.success,
      attackRoll: result.result.attackRoll,
      attackTotal: result.result.attackTotal,
      targetAC: result.result.targetAC,
      hit: result.result.hit,
      dc: result.result.dc,
      saveRoll: result.result.saveRoll,
      total: result.result.total,
      abilityUsed: result.result.abilityUsed,
      ...(seed !== undefined ? { seed } : {}),
    };

    // Process bonus action if included
    const bonusResult = await this.executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);
    if (bonusResult) {
      data.bonusAction = bonusResult;
    }

    if (result.result.success) {
      const mainSummary = `Grapple succeeded: ${decision.target} is grappled (attack ${result.result.attackTotal} vs AC ${result.result.targetAC}, save DC ${result.result.dc}, target rolled ${result.result.total})`;
      const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;
      return { action: decision.action, ok: true, summary: fullSummary, data };
    }

    const mainSummary = result.result.hit
      ? `Grapple failed against ${decision.target} (save DC ${result.result.dc}, target rolled ${result.result.total})`
      : `Grapple failed against ${decision.target} (Unarmed Strike missed: ${result.result.attackTotal} vs AC ${result.result.targetAC})`;
    const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;
    return {
      action: decision.action,
      ok: true,
      summary: fullSummary,
      data,
    };
  }

  private async executeEscapeGrapple(
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

    // Use explicit seed from decision, or compute a deterministic round/turn-based seed
    // (matching the tabletop handler convention) to avoid non-deterministic hash seeds
    // that incorporate random nanoid session/encounter IDs.
    let seed: number;
    if (typeof (decision as Record<string, unknown>).seed === "number") {
      seed = (decision as Record<string, unknown>).seed as number;
    } else {
      const encounter = await this.combat.getEncounterById(encounterId);
      seed = (encounter?.round ?? 1) * 1000 + (encounter?.turn ?? 0) * 10 + 2;
    }

    const result = await this.actionService.escapeGrapple(sessionId, {
      encounterId,
      actor: actorRef,
      seed,
    });

    const data: Record<string, unknown> = {
      success: result.result.success,
      dc: result.result.dc,
      saveRoll: result.result.saveRoll,
      total: result.result.total,
      abilityUsed: result.result.abilityUsed,
      seed,
    };

    // Process bonus action if included
    const bonusResult = await this.executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);
    if (bonusResult) {
      data.bonusAction = bonusResult;
    }

    if (result.result.success) {
      const mainSummary = `Escape Grapple succeeded (DC ${result.result.dc}, rolled ${result.result.total})`;
      const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;
      return { action: decision.action, ok: true, summary: fullSummary, data };
    }

    const mainSummary = `Escape Grapple failed (DC ${result.result.dc}, rolled ${result.result.total})`;
    const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;
    return { action: decision.action, ok: true, summary: fullSummary, data };
  }

  private async executeHide(
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

    const result = await this.actionService.hide(sessionId, {
      encounterId,
      actor: actorRef,
      hasCover: true, // AI assumes cover is available
    });

    const data: Record<string, unknown> = {
      success: result.result.success,
      stealthRoll: result.result.stealthRoll,
    };

    // Process bonus action if included
    const bonusResult = await this.executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);
    if (bonusResult) {
      data.bonusAction = bonusResult;
    }

    const mainSummary = result.result.success
      ? `Hide succeeded: stealth roll ${result.result.stealthRoll}`
      : `Hide failed: stealth roll ${result.result.stealthRoll}${result.result.reason ? ` (${result.result.reason})` : ""}`;
    const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;

    return {
      action: decision.action,
      ok: true,
      summary: fullSummary,
      data,
    };
  }

  private async executeSearch(
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

    const result = await this.actionService.search(sessionId, {
      encounterId,
      actor: actorRef,
    });

    const data: Record<string, unknown> = {
      found: result.result.found,
      roll: result.result.roll,
    };

    // Process bonus action if included
    const bonusResult = await this.executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);
    if (bonusResult) {
      data.bonusAction = bonusResult;
    }

    const mainSummary = result.result.found.length > 0
      ? `Search: found ${result.result.found.join(", ")} (perception roll ${result.result.roll})`
      : `Search: no hidden creatures found (perception roll ${result.result.roll})`;
    const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;

    return {
      action: decision.action,
      ok: true,
      summary: fullSummary,
      data,
    };
  }

  private async executeUseObject(
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

    const resources = normalizeResources(aiCombatant.resources);
    if (resources.actionSpent) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Action already spent this turn",
        data: { reason: "action_already_spent" },
      };
    }

    // Check inventory for healing potions
    const inventory = getInventory(aiCombatant.resources);
    const healingPotion = inventory.find(item => {
      const formula = POTION_HEALING_FORMULAS[item.magicItemId ?? ""];
      if (formula) return item.quantity > 0;
      const itemDef = lookupMagicItem(item.name);
      return itemDef && POTION_HEALING_FORMULAS[itemDef.id] && item.quantity > 0;
    });

    if (!healingPotion) {
      return {
        action: decision.action,
        ok: false,
        summary: "No usable objects available. Use 'attack', 'move', or 'endTurn' instead.",
        data: { reason: "no_usable_objects" },
      };
    }

    // Use the healing potion
    const potionFormula = POTION_HEALING_FORMULAS[healingPotion.magicItemId ?? ""]
      ?? POTION_HEALING_FORMULAS[lookupMagicItem(healingPotion.name)?.id ?? ""];
    if (!potionFormula) {
      return {
        action: decision.action,
        ok: false,
        summary: "No usable healing potions available.",
        data: { reason: "no_usable_objects" },
      };
    }

    // Consume the item
    const { updatedInventory } = useConsumableItem(inventory, healingPotion.name);

    // Roll healing dice
    let healAmount = 0;
    let healMessage = "";
    if (this.diceRoller) {
      const diceResult = this.diceRoller.rollDie(potionFormula.diceSides, potionFormula.diceCount, potionFormula.modifier);
      healAmount = diceResult.total;
      healMessage = `${potionFormula.diceCount}d${potionFormula.diceSides}+${potionFormula.modifier} = ${healAmount}`;
    }

    // Apply healing
    const hpBefore = aiCombatant.hpCurrent;
    const hpMax = aiCombatant.hpMax;
    const hpAfter = Math.min(hpMax, hpBefore + healAmount);
    const actualHeal = hpAfter - hpBefore;

    // Update resources: consume item + spend action
    const updatedResources = {
      ...resources,
      actionSpent: true,
      inventory: updatedInventory,
    };

    await this.combat.updateCombatantState(aiCombatant.id, {
      hpCurrent: hpAfter,
      resources: updatedResources as any,
    });

    const data: Record<string, unknown> = {
      item: healingPotion.name,
      healAmount: actualHeal,
      hpBefore,
      hpAfter,
      hpMax,
    };

    // Process bonus action if included
    const bonusResult = await this.executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);
    if (bonusResult) {
      data.bonusAction = bonusResult;
    }

    const mainSummary = `Drinks ${healingPotion.name} and heals ${actualHeal} HP (${healMessage}). HP: ${hpAfter}/${hpMax}`;
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
  async executeBonusAction(
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
        const actorEntityId = actorRef.type === "Monster" ? actorRef.monsterId!
          : actorRef.type === "Character" ? actorRef.characterId!
          : actorRef.npcId!;
        const result = await this.abilityRegistry.execute({
          sessionId,
          encounterId,
          actor: {
            getId: () => actorEntityId,
            getName: () => (aiCombatant as any).name ?? "Unknown",
            getCurrentHP: () => aiCombatant.hpCurrent ?? 0,
            getMaxHP: () => aiCombatant.hpMax ?? 0,
            getSpeed: () => 30,
            modifyHP: () => ({ actualChange: 0 }),
          },
          combat: {
            hasUsedAction: () => true,
            getRound: () => 0,
            getTurnIndex: () => 0,
            addEffect: () => {},
            getPosition: () => undefined,
            setPosition: () => {},
          },
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
              this.actionService.disengage(sessionId, { ...params, skipActionCheck: true }),
            dash: async (params: Parameters<CombatActionService["dash"]>[1]) =>
              this.actionService.dash(sessionId, { ...params, skipActionCheck: true }),
            dodge: async (params: Parameters<CombatActionService["dodge"]>[1]) =>
              this.actionService.dodge(sessionId, { ...params, skipActionCheck: true }),
            hide: async (params: Parameters<CombatActionService["hide"]>[1]) =>
              this.actionService.hide(sessionId, { ...params, isBonusAction: true, skipActionCheck: true }),
            attack: async (params: Parameters<CombatActionService["attack"]>[1]) =>
              this.actionService.attack(sessionId, params),
          },
        });

        // If execution includes resource spending, update combatant resources
        if (result.success && result.data?.spendResource) {
          const spendResource = result.data.spendResource as { poolName: string; amount: number };
          const { spendResourceFromPool } = await import("../helpers/resource-utils.js");
          // Re-read fresh state to preserve any flags set by the executor (e.g., disengaged)
          const freshCombatants = await this.combat.listCombatants(encounterId);
          const freshCombatant = freshCombatants.find((c) => c.id === aiCombatant.id);
          const freshResources = freshCombatant?.resources ?? aiCombatant.resources;
          const updatedResources = spendResourceFromPool(
            freshResources,
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
        const hideResult = await this.actionService.hide(sessionId, { encounterId, actor: actorRef, isBonusAction: true });
        const outcome = hideResult.result.success ? `Hidden (Stealth: ${hideResult.result.stealthRoll})` : `failed to hide`;
        return { action: "hide", summary: `${outcome} (bonus action)` };
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
        const hideResult = await this.actionService.hide(sessionId, { encounterId, actor: actorRef, isBonusAction: true });
        const outcome = hideResult.result.success ? `Hidden (Stealth: ${hideResult.result.stealthRoll})` : `failed to hide`;
        return { action: "hide", summary: `${outcome} (bonus action via Cunning Action)` };
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
