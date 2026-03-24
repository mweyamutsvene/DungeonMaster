/**
 * MoveReactionHandler — initiateMove() + completeMove() for two-phase movement.
 *
 * Extracted from TwoPhaseActionService (Phase: God-Module Decomposition §4b).
 */

import { nanoid } from "nanoid";
import type { ICombatRepository } from "../../../repositories/combat-repository.js";
import type { IEventRepository, ReactionPromptEventPayload } from "../../../repositories/event-repository.js";
import type { IGameSessionRepository } from "../../../repositories/game-session-repository.js";
import type { PendingActionRepository } from "../../../repositories/pending-action-repository.js";
import type { ICombatantResolver } from "../helpers/combatant-resolver.js";
import type { CombatantRef } from "../helpers/combatant-ref.js";
import type { Position } from "../../../../domain/rules/movement.js";
import type {
  PendingAction,
  ReactionOpportunity,
  PendingMoveData,
} from "../../../../domain/entities/combat/pending-action.js";
import {
  attemptMovement,
  crossesThroughReach,
  calculateDistance,
  type MovementAttempt,
} from "../../../../domain/rules/movement.js";
import { getTerrainSpeedModifier, type CombatMap } from "../../../../domain/rules/combat-map.js";
import { canMakeOpportunityAttack, hasReactionAvailable } from "../../../../domain/rules/opportunity-attack.js";
import { resolveEncounterOrThrow } from "../helpers/encounter-resolver.js";
import { findCombatantStateByRef } from "../helpers/combatant-ref.js";
import { ValidationError, NotFoundError } from "../../../errors.js";
import {
  normalizeResources,
  readBoolean,
  getPosition,
  getEffectiveSpeed,
} from "../helpers/resource-utils.js";
import { syncEntityPosition } from "../helpers/sync-map-entity.js";
import { resolveZoneDamageForPath } from "../helpers/zone-damage-resolver.js";
import { resolveMovementTriggers } from "../helpers/movement-trigger-resolver.js";
import { syncAuraZones } from "../helpers/aura-sync.js";
import { normalizeConditions, hasCondition, removeCondition } from "../../../../domain/entities/combat/conditions.js";
import { resolveOpportunityAttacks } from "../helpers/opportunity-attack-resolver.js";
import type { JsonValue } from "../../../types.js";
import type {
  InitiateMoveInput,
  InitiateMoveResult,
  CompleteMoveInput,
  CompleteMoveResult,
} from "../two-phase-action-service.js";

export class MoveReactionHandler {
  constructor(
    private readonly sessions: IGameSessionRepository,
    private readonly combat: ICombatRepository,
    private readonly combatants: ICombatantResolver,
    private readonly pendingActions: PendingActionRepository,
    private readonly events?: IEventRepository,
  ) {}

  /**
   * Phase 1: Initiate movement, detect opportunity attacks.
   * Returns immediately with list of reaction opportunities.
   */
  async initiate(sessionId: string, input: InitiateMoveInput): Promise<InitiateMoveResult> {
    const encounter = await resolveEncounterOrThrow(this.sessions, this.combat, sessionId, input.encounterId);
    const combatants = await this.combat.listCombatants(encounter.id);

    const actor = findCombatantStateByRef(combatants, input.actor);
    if (!actor) throw new NotFoundError("Actor not found in encounter");

    // Check if actor has movement available
    const resources = normalizeResources(actor.resources);
    const movementSpent = readBoolean(resources, "movementSpent") ?? false;
    if (movementSpent) {
      throw new ValidationError("Actor has already moved this turn");
    }

    // Get current position
    const currentPos = getPosition(resources);
    if (!currentPos) {
      throw new ValidationError("Actor does not have a position set");
    }

    // Get actor's speed — use movementRemaining if set (creature already moved this turn)
    const speed = getEffectiveSpeed(actor.resources);
    const hasDashed = readBoolean(resources, "dashed") ?? false;
    const baseEffectiveSpeed = hasDashed ? speed * 2 : speed;
    const movementRemainingValue = resources.movementRemaining;
    let effectiveSpeed = typeof movementRemainingValue === "number"
      ? Math.min(baseEffectiveSpeed, movementRemainingValue)
      : baseEffectiveSpeed;

    // --- Prone stand-up: D&D 5e 2024 ---
    let standUpCost = 0;
    const actorConditions = normalizeConditions(actor.conditions as unknown[]);
    const isProne = hasCondition(actorConditions, "Prone");

    if (isProne) {
      const isGrappled = hasCondition(actorConditions, "Grappled");
      const isIncapacitated = hasCondition(actorConditions, "Incapacitated");
      const isStunned = hasCondition(actorConditions, "Stunned");
      const isParalyzed = hasCondition(actorConditions, "Paralyzed");
      const isUnconscious = hasCondition(actorConditions, "Unconscious");

      if (isGrappled || isIncapacitated || isStunned || isParalyzed || isUnconscious) {
        throw new ValidationError(
          "Cannot stand up while Grappled, Incapacitated, Stunned, Paralyzed, or Unconscious — movement blocked",
        );
      }

      standUpCost = Math.ceil(speed / 2);
      effectiveSpeed -= standUpCost;

      if (effectiveSpeed <= 0) {
        throw new ValidationError(
          `Cannot move — standing from Prone costs ${standUpCost}ft, leaving no movement remaining`,
        );
      }

      const updatedConditions = removeCondition(actorConditions, "Prone");
      const currentMovementRemaining = typeof resources.movementRemaining === "number"
        ? resources.movementRemaining
        : effectiveSpeed + standUpCost;
      const postStandUpRemaining = currentMovementRemaining - standUpCost;
      await this.combat.updateCombatantState(actor.id, {
        conditions: updatedConditions as any,
        resources: { ...resources, movementRemaining: postStandUpRemaining } as JsonValue,
      });
    }

    // Compute speed modifier from terrain + conditions
    let speedModifier = 1.0;

    if (!input.pathCostFeet) {
      if (encounter.mapData && typeof encounter.mapData === "object") {
        const map = encounter.mapData as unknown as CombatMap;
        if (map.cells) {
          const terrainMod = getTerrainSpeedModifier(map, input.destination);
          speedModifier = Math.min(speedModifier, terrainMod);
        }
      }
    }

    const conditionSpeedMod = typeof resources.speedModifier === "number" ? resources.speedModifier : undefined;
    if (conditionSpeedMod !== undefined && conditionSpeedMod < speedModifier) {
      speedModifier = conditionSpeedMod;
    }

    // Validate movement
    if (input.pathCostFeet !== undefined) {
      const adjustedCost = conditionSpeedMod !== undefined && conditionSpeedMod < 1.0
        ? input.pathCostFeet / conditionSpeedMod
        : input.pathCostFeet;
      if (adjustedCost > effectiveSpeed) {
        throw new ValidationError(
          `Movement cost ${Math.round(input.pathCostFeet)}ft exceeds available speed ${Math.round(effectiveSpeed)}ft`,
        );
      }
    } else {
      const movementAttempt: MovementAttempt = {
        from: currentPos,
        to: input.destination,
        speed: effectiveSpeed,
        speedModifier: speedModifier < 1.0 ? speedModifier : undefined,
      };

      const movementResult = attemptMovement(movementAttempt);
      if (!movementResult.success) {
        throw new ValidationError(movementResult.reason || "Movement not allowed");
      }
    }

    // ── on_voluntary_move triggers (e.g. Booming Blade) ──
    const moveTriggered = await this.applyVoluntaryMoveTriggers(actor, encounter.id);
    if (moveTriggered.aborted) {
      return {
        status: "aborted_by_trigger",
        opportunityAttacks: [],
        standUpCost: standUpCost > 0 ? standUpCost : undefined,
        voluntaryMoveTriggerDamage: moveTriggered.totalDamage,
        voluntaryMoveTriggerMessages: moveTriggered.messages,
      };
    }

    // Calculate path — use pre-computed A* cells or fall back to simple destination
    const path = input.pathCells ?? [input.destination];

    // Detect opportunity attacks using path cells for accurate detection
    const opportunityAttacks: Array<{
      combatantId: string;
      combatantName: string;
      opportunityId?: string;
      canAttack: boolean;
      hasReaction: boolean;
    }> = [];

    const reactionOpportunities: ReactionOpportunity[] = [];

    for (const other of combatants) {
      if (other.id === actor.id) continue;
      if (other.hpCurrent <= 0) continue;

      const otherResources = normalizeResources(other.resources);
      const otherPos = getPosition(otherResources);
      if (!otherPos) continue;

      const reachValue = otherResources.reach;
      const reach = typeof reachValue === "number" ? reachValue : 5;

      let crossesReach = false;
      if (path.length > 1) {
        let prevPos = currentPos;
        for (const cell of path) {
          if (crossesThroughReach({ from: prevPos, to: cell }, otherPos, reach)) {
            crossesReach = true;
            break;
          }
          prevPos = cell;
        }
      } else {
        crossesReach = crossesThroughReach(
          { from: currentPos, to: input.destination },
          otherPos,
          reach,
        );
      }

      if (crossesReach) {
        const hasReaction = hasReactionAvailable({ reactionUsed: false, ...otherResources } as any);
        const isDisengaged = readBoolean(resources, "disengaged") ?? false;
        const canAttack = canMakeOpportunityAttack(
          { reactionUsed: !hasReaction },
          {
            movingCreatureId: actor.id,
            observerId: other.id,
            disengaged: isDisengaged,
            canSee: true,
            observerIncapacitated: false,
            leavingReach: true,
          },
        );

        const otherName = await this.combatants.getName(
          other.combatantType === "Character" && other.characterId ? { type: "Character", characterId: other.characterId } :
          other.combatantType === "Monster" && other.monsterId ? { type: "Monster", monsterId: other.monsterId } :
          other.combatantType === "NPC" && other.npcId ? { type: "NPC", npcId: other.npcId } :
          { type: "Character", characterId: "" },
          other,
        );

        const opportunityId = canAttack.canAttack ? nanoid() : undefined;

        opportunityAttacks.push({
          combatantId: other.id,
          combatantName: otherName,
          opportunityId,
          canAttack: canAttack.canAttack,
          hasReaction,
        });

        if (canAttack.canAttack) {
          reactionOpportunities.push({
            id: opportunityId!,
            combatantId: other.id,
            reactionType: "opportunity_attack",
            canUse: true,
            context: {
              targetId: actor.id,
              reach,
            },
          });
        }
      }
    }

    // Detect readied action triggers (creature_moves_within_range)
    for (const other of combatants) {
      if (other.id === actor.id) continue;
      if (other.hpCurrent <= 0) continue;

      const otherResources = normalizeResources(other.resources);
      const readiedAction = otherResources.readiedAction as {
        responseType?: string;
        triggerType?: string;
        triggerDescription?: string;
        targetName?: string;
      } | undefined;

      if (!readiedAction || readiedAction.triggerType !== "creature_moves_within_range") continue;
      if (readiedAction.responseType !== "attack") continue;

      const hasReaction = hasReactionAvailable({ reactionUsed: false, ...otherResources } as any);
      if (!hasReaction) continue;

      const otherPos = getPosition(otherResources);
      if (!otherPos) continue;

      const reach = typeof otherResources.reach === "number" ? otherResources.reach : 5;

      const distBefore = calculateDistance(currentPos, otherPos);
      const distAfter = calculateDistance(input.destination, otherPos);
      const wasInReach = distBefore <= reach;
      const isNowInReach = distAfter <= reach;

      if (!wasInReach && isNowInReach) {
        const otherName = await this.combatants.getName(
          other.combatantType === "Character" && other.characterId ? { type: "Character", characterId: other.characterId } :
          other.combatantType === "Monster" && other.monsterId ? { type: "Monster", monsterId: other.monsterId } :
          other.combatantType === "NPC" && other.npcId ? { type: "NPC", npcId: other.npcId } :
          { type: "Character", characterId: "" },
          other,
        );

        const readiedOpportunityId = nanoid();

        opportunityAttacks.push({
          combatantId: other.id,
          combatantName: otherName,
          opportunityId: readiedOpportunityId,
          canAttack: true,
          hasReaction: true,
        });

        reactionOpportunities.push({
          id: readiedOpportunityId,
          combatantId: other.id,
          reactionType: "readied_action",
          canUse: true,
          context: {
            targetId: actor.id,
            reach,
            readiedAction,
          },
        });
      }
    }

    // If no reactions possible, return immediately
    if (reactionOpportunities.length === 0) {
      return {
        status: "no_reactions",
        opportunityAttacks,
        ...(standUpCost > 0 ? { standUpCost } : {}),
      };
    }

    // Create pending action
    const pendingActionId = nanoid();
    const moveData: PendingMoveData = {
      type: "move",
      from: currentPos,
      to: input.destination,
      path,
    };

    const pendingAction: PendingAction = {
      id: pendingActionId,
      encounterId: encounter.id,
      actor: input.actor,
      type: "move",
      data: moveData,
      reactionOpportunities,
      resolvedReactions: [],
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60000), // 60s timeout
    };

    await this.pendingActions.create(pendingAction);

    // Emit reaction prompts
    if (this.events) {
      const actorName = await this.combatants.getName(input.actor, actor);

      for (const opp of reactionOpportunities) {
        const payload: ReactionPromptEventPayload = {
          encounterId: encounter.id,
          pendingActionId,
          combatantId: opp.combatantId,
          reactionOpportunity: opp,
          actor: input.actor,
          actorName,
          expiresAt: pendingAction.expiresAt.toISOString(),
        };

        await this.events.append(sessionId, {
          id: nanoid(),
          type: "ReactionPrompt",
          payload,
        });
      }
    }

    return {
      status: "awaiting_reactions",
      pendingActionId,
      opportunityAttacks,
      ...(standUpCost > 0 ? { standUpCost } : {}),
    };
  }

  /**
   * Phase 2: Complete movement after reactions are resolved.
   * Executes OA attacks that were accepted, applies damage, updates position.
   */
  async complete(sessionId: string, input: CompleteMoveInput): Promise<CompleteMoveResult> {
    const pendingAction = await this.pendingActions.getById(input.pendingActionId);
    if (!pendingAction) {
      throw new NotFoundError(`Pending action not found: ${input.pendingActionId}`);
    }

    if (pendingAction.type !== "move") {
      throw new ValidationError("Pending action is not a move");
    }

    const status = await this.pendingActions.getStatus(input.pendingActionId);
    if (status !== "ready_to_complete" && status !== "awaiting_reactions") {
      throw new ValidationError(`Cannot complete move in status: ${status}`);
    }

    const moveData = pendingAction.data as PendingMoveData;
    const encounter = await this.combat.getEncounterById(pendingAction.encounterId);
    if (!encounter) {
      throw new NotFoundError("Encounter not found");
    }

    const combatants = await this.combat.listCombatants(encounter.id);
    const actor = findCombatantStateByRef(combatants, pendingAction.actor);
    if (!actor) {
      throw new NotFoundError("Actor not found");
    }

    // Delegate OA resolution to the resolver
    const oaResult = await resolveOpportunityAttacks(
      {
        sessionId,
        pendingAction,
        encounter: { id: encounter.id, round: encounter.round, mapData: encounter.mapData },
        actor,
        combatants,
        moveFrom: moveData.from,
      },
      {
        combat: this.combat,
        combatants: this.combatants,
        events: this.events,
      },
    );

    let targetStillAlive = oaResult.targetStillAlive;
    let finalPosition = targetStillAlive ? moveData.to : moveData.from;

    const resources = normalizeResources(actor.resources);
    // Calculate remaining movement after this move
    const distanceMoved = calculateDistance(moveData.from, finalPosition);
    const currentRemaining = typeof resources.movementRemaining === "number"
      ? resources.movementRemaining
      : getEffectiveSpeed(actor.resources);
    const newMovementRemaining = Math.max(0, currentRemaining - distanceMoved);
    const updatedResources = {
      ...resources,
      position: finalPosition,
      movementSpent: newMovementRemaining <= 0,
      movementRemaining: newMovementRemaining,
    };

    await this.combat.updateCombatantState(actor.id, {
      resources: updatedResources as JsonValue,
    });

    // Keep CombatMap entities[] in sync with the position update
    await syncEntityPosition(this.combat, encounter.id, actor.id, finalPosition);

    // Sync aura zones for this combatant
    const actorEntityId = actor.characterId ?? actor.monsterId ?? actor.npcId ?? actor.id;
    await syncAuraZones(this.combat, encounter.id, actorEntityId, finalPosition);

    // --- Zone damage during movement (if creature survived OAs) ---
    if (targetStillAlive) {
      const combatMap = encounter.mapData as unknown as CombatMap | undefined;
      if (combatMap && (combatMap.zones?.length ?? 0) > 0) {
        const actorIsPC = actor.combatantType === "Character" || actor.combatantType === "NPC";
        const zoneDmg = await resolveZoneDamageForPath(
          moveData.path ?? [moveData.to],
          moveData.from,
          actor,
          combatMap,
          (srcId: string) => {
            const src = combatants.find((c: any) => (c.characterId ?? c.monsterId ?? c.npcId) === srcId);
            const srcIsPC = src ? (src.combatantType === "Character" || src.combatantType === "NPC") : false;
            return actorIsPC === srcIsPC;
          },
          { damageResistances: [], damageImmunities: [], damageVulnerabilities: [] },
          { combatRepo: this.combat },
        );
        if (zoneDmg.creatureDied) {
          targetStillAlive = false;
          finalPosition = zoneDmg.finalPosition;
          await this.combat.updateCombatantState(actor.id, {
            resources: { ...updatedResources, position: finalPosition } as JsonValue,
          });
          await syncEntityPosition(this.combat, encounter.id, actor.id, finalPosition);
        }
      }
    }

    // Emit movement event
    if (this.events) {
      await this.events.append(sessionId, {
        id: nanoid(),
        type: "Move",
        payload: {
          encounterId: encounter.id,
          actorId: actor.id,
          from: moveData.from,
          to: finalPosition,
          distanceMoved: calculateDistance(moveData.from, finalPosition),
          interrupted: !targetStillAlive,
        },
      });
    }

    // Mark as completed and cleanup
    await this.pendingActions.markCompleted(input.pendingActionId);
    await this.pendingActions.delete(input.pendingActionId);

    return {
      movedFeet: calculateDistance(moveData.from, finalPosition),
      from: moveData.from,
      to: finalPosition,
      opportunityAttacks: oaResult.executedOAs,
    };
  }

  // ── Private: on_voluntary_move trigger resolution ──

  private async applyVoluntaryMoveTriggers(
    actor: { id: string; hpCurrent: number; hpMax: number; resources?: unknown; characterId?: string | null; monsterId?: string | null; npcId?: string | null; combatantType?: string },
    encounterId: string,
  ): Promise<{ aborted: boolean; totalDamage: number; messages: string[] }> {
    const result = await resolveMovementTriggers(
      actor as any,
      {
        combatRepo: this.combat,
      },
    );
    return {
      aborted: result.aborted,
      totalDamage: result.totalDamage,
      messages: result.messages,
    };
  }
}
