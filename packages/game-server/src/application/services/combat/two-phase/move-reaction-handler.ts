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
  calculateDistance,
  getGrappleDragSpeedMultiplier,
  type MovementAttempt,
  type CreatureSizeForDrag,
} from "../../../../domain/rules/movement.js";
import { getTerrainSpeedModifier, isPitEntry, type CombatMap } from "../../../../domain/rules/combat-map.js";
import { hasReactionAvailable } from "../../../../domain/rules/opportunity-attack.js";
import { resolveEncounterOrThrow } from "../helpers/encounter-resolver.js";
import { findCombatantStateByRef } from "../helpers/combatant-ref.js";
import { ValidationError, NotFoundError } from "../../../errors.js";
import {
  normalizeResources,
  readBoolean,
  getPosition,
  getEffectiveSpeed,
} from "../helpers/resource-utils.js";
import { SeededDiceRoller } from "../../../../domain/rules/dice-roller.js";
import { syncEntityPosition } from "../helpers/sync-map-entity.js";
import { resolveZoneDamageForPath } from "../helpers/zone-damage-resolver.js";
import { resolveMovementTriggers } from "../helpers/movement-trigger-resolver.js";
import { syncAuraZones } from "../helpers/aura-sync.js";
import { applyKoEffectsIfNeeded } from "../helpers/ko-handler.js";
import { resolvePitEntry } from "../helpers/pit-terrain-resolver.js";
import { creatureHasEvasion } from "../../../../domain/rules/evasion.js";
import { normalizeConditions, hasCondition, removeCondition, getFrightenedSourceId, isFrightenedMovementBlocked, getExhaustionLevel, getExhaustionSpeedReduction } from "../../../../domain/entities/combat/conditions.js";
import { hashForOA, resolveOpportunityAttacks, type SpellOaDeps } from "../helpers/opportunity-attack-resolver.js";
import { detectOpportunityAttacks } from "../helpers/oa-detection.js";
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
    private readonly spellOaDeps?: SpellOaDeps,
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

    // --- D&D 2024 Exhaustion: speed reduced by 5 × level ft ---
    const actorConditions = normalizeConditions(actor.conditions as unknown[]);
    const exhaustionSpeedReduction = getExhaustionSpeedReduction(getExhaustionLevel(actorConditions));
    if (exhaustionSpeedReduction > 0) {
      effectiveSpeed = Math.max(0, effectiveSpeed - exhaustionSpeedReduction);
    }

    // --- Frightened: cannot willingly move closer to fear source ---
    const fearSourceId = getFrightenedSourceId(actorConditions);
    if (fearSourceId) {
      const fearSource = combatants.find(c => c.id === fearSourceId);
      if (fearSource) {
        const fearSourcePos = getPosition(normalizeResources(fearSource.resources));
        if (fearSourcePos) {
          const currentDistToSource = calculateDistance(currentPos, fearSourcePos);
          const newDistToSource = calculateDistance(input.destination, fearSourcePos);
          if (isFrightenedMovementBlocked(actorConditions, currentDistToSource, newDistToSource)) {
            throw new ValidationError(
              "Cannot move closer to the source of fear — Frightened condition prevents willingly approaching",
            );
          }
        }
      }
    }

    // --- Prone stand-up: D&D 5e 2024 ---
    let standUpCost = 0;
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

    // --- Grapple drag: D&D 5e 2024 ---
    // When a grappling creature moves, the grappled creature moves with them.
    // Speed is halved unless the grappled creature is Tiny or 2+ sizes smaller.
    let isDraggingGrappled = false;
    const grappledCombatants: Array<typeof combatants[number]> = [];
    for (const other of combatants) {
      if (other.id === actor.id) continue;
      if (other.hpCurrent <= 0) continue;
      const otherConditions = normalizeConditions(other.conditions as unknown[]);
      const grappledCondition = otherConditions.find(
        c => c.condition === "Grappled" && c.source === actor.id,
      );
      if (grappledCondition) {
        grappledCombatants.push(other);
      }
    }

    if (grappledCombatants.length > 0) {
      isDraggingGrappled = true;
      // Apply drag speed penalty: check if any grappled creature requires half speed
      const actorSize = (resources.size as CreatureSizeForDrag) ?? "Medium";
      let needsHalfSpeed = false;
      for (const grappledCombatant of grappledCombatants) {
        const grappledRes = normalizeResources(grappledCombatant.resources);
        const grappledSize = (grappledRes.size as CreatureSizeForDrag) ?? "Medium";
        const dragMultiplier = getGrappleDragSpeedMultiplier(actorSize, grappledSize);
        if (dragMultiplier < 1.0) {
          needsHalfSpeed = true;
          break;
        }
      }
      if (needsHalfSpeed) {
        effectiveSpeed = Math.floor(effectiveSpeed * 0.5);
        if (effectiveSpeed <= 0) {
          throw new ValidationError("Cannot move — dragging a grappled creature reduces speed to 0");
        }
      }
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

    // Tabletop/two-phase path: detect OAs via shared helper, then create reaction opportunities.
    const oaDetections = detectOpportunityAttacks({
      combatants,
      actor,
      from: currentPos,
      to: input.destination,
      pathCells: path,
      includeObserverFeatFlags: true,
    });

    const opportunityAttacks: Array<{
      combatantId: string;
      combatantName: string;
      opportunityId?: string;
      canAttack: boolean;
      hasReaction: boolean;
    }> = [];

    const reactionOpportunities: ReactionOpportunity[] = [];

    for (const detection of oaDetections) {
      const other = detection.combatant;
      const otherName = await this.combatants.getName(
        other.combatantType === "Character" && other.characterId ? { type: "Character", characterId: other.characterId } :
        other.combatantType === "Monster" && other.monsterId ? { type: "Monster", monsterId: other.monsterId } :
        other.combatantType === "NPC" && other.npcId ? { type: "NPC", npcId: other.npcId } :
        { type: "Character", characterId: "" },
        other,
      );

      const opportunityId = detection.canAttack ? nanoid() : undefined;

      opportunityAttacks.push({
        combatantId: other.id,
        combatantName: otherName,
        opportunityId,
        canAttack: detection.canAttack,
        hasReaction: detection.hasReaction,
      });

      if (detection.canAttack) {
        reactionOpportunities.push({
          id: opportunityId!,
          combatantId: other.id,
          reactionType: "opportunity_attack",
          canUse: true,
          ...(detection.canCastSpellAsOA ? { oaType: "spell" as const } : {}),
          context: {
            targetId: actor.id,
            reach: detection.reach,
          },
        });
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
        spellOaDeps: this.spellOaDeps,
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
    let resourcesAfterMove = updatedResources;

    await this.combat.updateCombatantState(actor.id, {
      resources: updatedResources as JsonValue,
    });

    if (targetStillAlive) {
      const actorAfterMove = (await this.combat.listCombatants(encounter.id)).find((c) => c.id === actor.id);
      const terrainMap = encounter.mapData as CombatMap | undefined;
      if (actorAfterMove && terrainMap && isPitEntry(terrainMap, moveData.from, finalPosition)) {
        const actorStats = await this.combatants.getCombatStats(pendingAction.actor);
        const pitSeed = hashForOA(`${encounter.id}:${pendingAction.id}:${moveData.from.x}:${moveData.from.y}:${finalPosition.x}:${finalPosition.y}:pit`);
        const pitResult = resolvePitEntry(
          terrainMap,
          moveData.from,
          finalPosition,
          actorStats.abilityScores.dexterity,
          actorAfterMove.hpCurrent,
          actorAfterMove.conditions,
          new SeededDiceRoller(pitSeed),
        );

        if (pitResult.triggered) {
          resourcesAfterMove = {
            ...updatedResources,
            movementRemaining: pitResult.movementEnds ? 0 : updatedResources.movementRemaining,
            movementSpent: pitResult.movementEnds ? true : updatedResources.movementSpent,
          };

          await this.combat.updateCombatantState(actor.id, {
            hpCurrent: pitResult.hpAfter,
            conditions: pitResult.updatedConditions as unknown as JsonValue,
            resources: resourcesAfterMove as JsonValue,
          });

          if (pitResult.damageApplied > 0) {
            await applyKoEffectsIfNeeded(actorAfterMove, actorAfterMove.hpCurrent, pitResult.hpAfter, this.combat);
          }

          if (pitResult.hpAfter <= 0) {
            targetStillAlive = false;
          }
        }
      }
    }

    // Keep CombatMap entities[] in sync with the position update
    await syncEntityPosition(this.combat, encounter.id, actor.id, finalPosition);

    // Sync aura zones for this combatant
    const actorEntityId = actor.characterId ?? actor.monsterId ?? actor.npcId ?? actor.id;
    await syncAuraZones(this.combat, encounter.id, actorEntityId, finalPosition);

    // --- Grapple drag: move grappled creatures to mover's new position ---
    if (targetStillAlive) {
      for (const other of combatants) {
        if (other.id === actor.id) continue;
        if (other.hpCurrent <= 0) continue;
        const otherConditions = normalizeConditions(other.conditions as unknown[]);
        const grappledByActor = otherConditions.some(
          c => c.condition === "Grappled" && c.source === actor.id,
        );
        if (grappledByActor) {
          const otherRes = normalizeResources(other.resources);
          const updatedOtherRes = { ...otherRes, position: finalPosition } as JsonValue;
          await this.combat.updateCombatantState(other.id, {
            resources: updatedOtherRes,
          });
          await syncEntityPosition(this.combat, encounter.id, other.id, finalPosition);
        }
      }
    }

    // --- Zone damage during movement (if creature survived OAs) ---
    if (targetStillAlive) {
      const combatMap = encounter.mapData as unknown as CombatMap | undefined;
      if (combatMap && (combatMap.zones?.length ?? 0) > 0) {
        const actorIsPC = actor.combatantType === "Character" || actor.combatantType === "NPC";
        // Check Evasion for the moving creature (Monk 7/Rogue 7 — DEX save zone damage)
        let actorHasEvasion = false;
        try {
          const actorStats = await this.combatants.getCombatStats(pendingAction.actor);
          actorHasEvasion = creatureHasEvasion(actorStats.className, actorStats.level);
        } catch { /* monsters/NPCs won't have class features */ }
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
          { combatRepo: this.combat, hasEvasion: actorHasEvasion },
        );
        if (zoneDmg.creatureDied) {
          targetStillAlive = false;
          finalPosition = zoneDmg.finalPosition;
          await this.combat.updateCombatantState(actor.id, {
            resources: { ...resourcesAfterMove, position: finalPosition } as JsonValue,
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
    // Check Evasion for the moving creature (Monk 7/Rogue 7 — DEX save trigger damage)
    let actorHasEvasion = false;
    try {
      const ref: CombatantRef = actor.characterId
        ? { type: "Character", characterId: actor.characterId }
        : actor.monsterId
          ? { type: "Monster", monsterId: actor.monsterId }
          : { type: "NPC", npcId: actor.npcId! };
      const actorStats = await this.combatants.getCombatStats(ref);
      actorHasEvasion = creatureHasEvasion(actorStats.className, actorStats.level);
    } catch { /* monsters/NPCs won't have class features */ }
    const result = await resolveMovementTriggers(
      actor as any,
      {
        combatRepo: this.combat,
        hasEvasion: actorHasEvasion,
      },
    );
    return {
      aborted: result.aborted,
      totalDamage: result.totalDamage,
      messages: result.messages,
    };
  }
}
