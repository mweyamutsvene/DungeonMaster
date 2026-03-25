/**
 * AiMovementResolver - shared two-phase movement pipeline for AI combat actions.
 *
 * Extracted from AiActionExecutor to eliminate near-identical code across
 * executeMove, executeMoveToward, and executeMoveAwayFrom (~300 lines saved).
 *
 * Layer: Application
 */

import type { CombatantStateRecord } from "../../../types.js";
import type { TwoPhaseActionService } from "../two-phase-action-service.js";
import type { ICombatRepository } from "../../../repositories/index.js";
import type { PendingActionRepository } from "../../../repositories/pending-action-repository.js";
import type { ICombatantResolver } from "../helpers/combatant-resolver.js";
import type { ActorRef } from "./ai-types.js";
import type { CombatantRef } from "../helpers/combatant-ref.js";
import type { CombatMap } from "../../../../domain/rules/combat-map.js";
import { calculateDistance } from "../../../../domain/rules/movement.js";
import { syncEntityPosition } from "../helpers/sync-map-entity.js";
import { syncAuraZones } from "../helpers/aura-sync.js";
import { resolveZoneDamageForPath } from "../helpers/zone-damage-resolver.js";

type AiLogger = (msg: string) => void;

type AiReactionDecider = (
  combatant: CombatantStateRecord,
  reactionType: "opportunity_attack" | "shield_spell" | "counterspell" | "other",
  context: { targetName?: string; hpPercent?: number; attackTotal?: number; currentAC?: number; spellName?: string },
) => Promise<boolean>;

export interface AiMovementDeps {
  combat: ICombatRepository;
  twoPhaseActions: TwoPhaseActionService;
  pendingActions: PendingActionRepository;
  combatantResolver: ICombatantResolver;
  aiDecideReaction: AiReactionDecider;
  aiLog: AiLogger;
}

export interface AiMovementContext {
  sessionId: string;
  encounterId: string;
  aiCombatant: CombatantStateRecord;
  actorRef: ActorRef;
  allCombatants: CombatantStateRecord[];
  /** May be undefined when the actor has no position set (executeMove only). */
  currentPos?: { x: number; y: number };
  finalDestination: { x: number; y: number };
  effectiveSpeed: number;
  resources: Record<string, unknown>;
  pathCells?: { x: number; y: number }[];
  pathCostFeet?: number;
  pathNarrationHints?: string[];
  /**
   * Override the path used for zone damage checks.
   * Defaults to pathCells ?? [finalDestination].
   * executeMove passes generateLinearPath(currentPos, finalDestination) here.
   */
  zoneDamagePath?: { x: number; y: number }[];
}

export interface AiOaDecision {
  attackerId: string;
  used: boolean;
  reason: string;
}

export type AiMovementOutcome =
  | { kind: "aborted_by_trigger"; message: string }
  | { kind: "player_oa_pending"; pendingActionId: string; playerOAsCount: number; opportunityAttacks: unknown[] }
  | { kind: "no_reactions"; movedFeet: number; pathCostFeet: number; newMovementRemaining: number }
  | { kind: "completed"; movedFeet: number; opportunityAttacks: unknown[]; aiDecisions: AiOaDecision[] };

/**
 * Generate a cell-by-cell straight-line path between two grid positions (5ft cells).
 * Uses DDA-style line rasterisation aligned to a 5ft grid.
 */
export function generateLinearPath(
  from: { x: number; y: number },
  to: { x: number; y: number },
): { x: number; y: number }[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 5) return [to]; // same or adjacent cell
  const steps = Math.max(1, Math.round(dist / 5));
  const cells: { x: number; y: number }[] = [];
  for (let i = 1; i <= steps; i++) {
    const ratio = i / steps;
    cells.push({
      x: Math.round(from.x + dx * ratio),
      y: Math.round(from.y + dy * ratio),
    });
  }
  return cells;
}

/**
 * Shared two-phase movement pipeline used by all AI movement actions.
 *
 * Handles: initiateMove → trigger/no_reactions/OA-resolution → player-OA-prompt → completeMove.
 *
 * Callers are responsible for: input validation, destination computation,
 * bonus action execution, and building the final TurnStepResult.
 */
export async function resolveAiMovement(
  deps: AiMovementDeps,
  ctx: AiMovementContext,
): Promise<AiMovementOutcome> {
  const { combat, twoPhaseActions, pendingActions, combatantResolver, aiDecideReaction } = deps;
  const {
    sessionId, encounterId, aiCombatant, actorRef, allCombatants,
    currentPos, finalDestination, effectiveSpeed, resources,
    pathCells, pathCostFeet, pathNarrationHints, zoneDamagePath,
  } = ctx;

  const moveInit = await twoPhaseActions.initiateMove(sessionId, {
    encounterId,
    actor: actorRef as CombatantRef,
    destination: finalDestination,
    pathCells,
    pathCostFeet,
    pathNarrationHints,
  });

  // ── Aborted by voluntary-move trigger (e.g., Booming Blade) ──
  if (moveInit.status === "aborted_by_trigger") {
    const msg = moveInit.voluntaryMoveTriggerMessages?.join(" ") ?? "Movement trigger damage!";
    return { kind: "aborted_by_trigger", message: msg };
  }

  // ── No reactions: move immediately ──
  if (moveInit.status === "no_reactions") {
    const movedFeet = currentPos ? Math.round(calculateDistance(currentPos, finalDestination)) : 0;
    const effectivePathCost = pathCostFeet ?? movedFeet;
    const currentRemaining = typeof resources.movementRemaining === "number"
      ? resources.movementRemaining
      : effectiveSpeed;
    const newMovementRemaining = Math.max(0, currentRemaining - effectivePathCost);

    await combat.updateCombatantState(aiCombatant.id, {
      resources: {
        ...resources,
        position: finalDestination,
        movementSpent: newMovementRemaining <= 0,
        movementRemaining: newMovementRemaining,
      } as any,
    });

    await syncEntityPosition(combat, encounterId, aiCombatant.id, finalDestination);

    const entityId = aiCombatant.characterId ?? aiCombatant.monsterId ?? aiCombatant.npcId ?? aiCombatant.id;
    await syncAuraZones(combat, encounterId, entityId, finalDestination);

    // Zone damage along movement path
    if (currentPos) {
      const encounter = await combat.getEncounterById(encounterId);
      if (encounter) {
        const combatMap = encounter.mapData as unknown as CombatMap | undefined;
        if (combatMap && (combatMap.zones?.length ?? 0) > 0) {
          const isPC = aiCombatant.combatantType === "Character" || aiCombatant.combatantType === "NPC";
          const allCombatantsForZone = await combat.listCombatants(encounterId);
          const damagePath = zoneDamagePath ?? pathCells ?? [finalDestination];
          await resolveZoneDamageForPath(
            damagePath,
            currentPos,
            aiCombatant,
            combatMap,
            (srcId: string) => {
              const src = allCombatantsForZone.find(
                (c: any) => (c.characterId ?? c.monsterId ?? c.npcId) === srcId,
              );
              const srcIsPC = src
                ? src.combatantType === "Character" || src.combatantType === "NPC"
                : false;
              return isPC === srcIsPC;
            },
            { damageResistances: [], damageImmunities: [], damageVulnerabilities: [] },
            { combatRepo: combat },
          );
        }
      }
    }

    return { kind: "no_reactions", movedFeet, pathCostFeet: effectivePathCost, newMovementRemaining };
  }

  // ── Reactions pending: resolve AI OAs, detect player OAs ──
  const aiDecisions: AiOaDecision[] = [];

  if (moveInit.status === "awaiting_reactions" && moveInit.pendingActionId) {
    const pendingAction = await pendingActions.getById(moveInit.pendingActionId);
    if (!pendingAction) {
      return { kind: "completed", movedFeet: 0, opportunityAttacks: [], aiDecisions: [] };
    }

    for (const opp of moveInit.opportunityAttacks) {
      if (!opp.canAttack) {
        aiDecisions.push({ attackerId: opp.combatantId, used: false, reason: "cannot_attack" });
        continue;
      }

      const attackerState = allCombatants.find((c) => c.id === opp.combatantId);
      if (!attackerState) {
        aiDecisions.push({ attackerId: opp.combatantId, used: false, reason: "attacker_not_found" });
        continue;
      }

      if (attackerState.combatantType === "Character") {
        aiDecisions.push({ attackerId: opp.combatantId, used: false, reason: "player_prompted" });
        continue;
      }

      const shouldUseReaction = await aiDecideReaction(attackerState, "opportunity_attack", {
        targetName: await combatantResolver.getName(actorRef as CombatantRef, aiCombatant),
        hpPercent: attackerState.hpCurrent / attackerState.hpMax,
      });

      aiDecisions.push({
        attackerId: opp.combatantId,
        used: shouldUseReaction,
        reason: shouldUseReaction ? "ai_used" : "ai_declined",
      });

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
        await pendingActions.update({
          ...pendingAction,
          resolvedReactions: updatedResolvedReactions,
        });
      }
    }
  }

  // Check if any player OAs need prompting
  const playerOAsNeedingInput = aiDecisions.filter((d) => d.reason === "player_prompted");
  if (playerOAsNeedingInput.length > 0 && moveInit.pendingActionId) {
    await combat.setPendingAction(encounterId, {
      id: moveInit.pendingActionId,
      type: "opportunity_attack_pending",
      pendingActionId: moveInit.pendingActionId,
      opportunities: moveInit.opportunityAttacks.map((opp) => ({
        combatantId: opp.combatantId,
        combatantName: opp.combatantName,
        canAttack: opp.canAttack,
        hasReaction: opp.hasReaction,
        opportunityId: opp.opportunityId,
      })),
      target: actorRef,
      destination: finalDestination,
    });

    return {
      kind: "player_oa_pending",
      pendingActionId: moveInit.pendingActionId,
      playerOAsCount: playerOAsNeedingInput.length,
      opportunityAttacks: moveInit.opportunityAttacks,
    };
  }

  // No player OAs — complete the move
  const moveComplete = await twoPhaseActions.completeMove(sessionId, {
    pendingActionId: moveInit.pendingActionId || "",
  });

  return {
    kind: "completed",
    movedFeet: moveComplete.movedFeet,
    opportunityAttacks: moveComplete.opportunityAttacks,
    aiDecisions,
  };
}
