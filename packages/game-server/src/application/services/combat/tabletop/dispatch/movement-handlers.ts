/**
 * MovementHandlers — move, move-toward, and jump action handlers.
 *
 * Extracted from ActionDispatcher (Phase: God-Module Decomposition §2b).
 */

import { ValidationError } from "../../../../errors.js";
import { calculateDistance, calculateLongJumpDistance, calculateHighJumpDistance, computeJumpLandingPosition } from "../../../../../domain/rules/movement.js";
import { findPath, findAdjacentPosition } from "../../../../../domain/rules/pathfinding.js";
import type { CombatMap } from "../../../../../domain/rules/combat-map.js";
import { getCellAt, isPitEntry } from "../../../../../domain/rules/combat-map.js";
import { abilityCheck } from "../../../../../domain/rules/ability-checks.js";
import { SeededDiceRoller } from "../../../../../domain/rules/dice-roller.js";
import {
  normalizeConditions,
  addCondition,
  createCondition,
  type Condition,
} from "../../../../../domain/entities/combat/conditions.js";
import {
  getPosition,
  getEffectiveSpeed,
  getActiveEffects,
  isConditionImmuneByEffects,
} from "../../helpers/resource-utils.js";
import { findCombatantByEntityId } from "../../helpers/combatant-lookup.js";
import {
  calculateBonusFromEffects,
  hasAdvantageFromEffects,
  hasDisadvantageFromEffects,
} from "../../../../../domain/entities/combat/effects.js";
import {
  inferActorRef,
  getActorNameFromRoster,
  getNameFromCombatantRef,
  type ParsedJump,
} from "../combat-text-parser.js";
import { findCombatantStateByRef, getPositionByRef } from "../../helpers/combatant-ref.js";
import { syncEntityPosition } from "../../helpers/sync-map-entity.js";
import { resolveZoneDamageForPath } from "../../helpers/zone-damage-resolver.js";
import { syncAuraZones } from "../../helpers/aura-sync.js";
import { applyKoEffectsIfNeeded } from "../../helpers/ko-handler.js";
import { resolvePitEntry } from "../../helpers/pit-terrain-resolver.js";
import { creatureHasEvasion } from "../../../../../domain/rules/evasion.js";
import type { TabletopEventEmitter } from "../tabletop-event-emitter.js";
import { buildPathNarration } from "../path-narrator.js";
import { hashStringToInt32 } from "../../helpers/combat-utils.js";
import type {
  TabletopCombatServiceDeps,
  ActionParseResult,
} from "../tabletop-types.js";
import type {
  LlmRoster,
  CombatantRef,
} from "../../../../commands/game-command.js";
import type {
  SessionCharacterRecord,
  SessionMonsterRecord,
  CombatantStateRecord,
} from "../../../../types.js";

export class MovementHandlers {
  constructor(
    private readonly deps: TabletopCombatServiceDeps,
    private readonly eventEmitter: TabletopEventEmitter,
    private readonly debugLogsEnabled: boolean,
  ) {}

  async handleMoveAction(
    sessionId: string,
    encounterId: string,
    actorId: string,
    destination: { x: number; y: number },
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    const actorRef = inferActorRef(actorId, roster);

    const moveInit = await this.deps.twoPhaseActions.initiateMove(sessionId, {
      encounterId,
      actor: actorRef,
      destination,
    });

    if (moveInit.status === "aborted_by_trigger") {
      const triggerMsg = moveInit.voluntaryMoveTriggerMessages?.join(" ") ?? "Movement trigger damage!";
      return {
        requiresPlayerInput: false,
        actionComplete: true,
        type: "move",
        message: `${triggerMsg} ${actorId} is knocked out and cannot move.`,
      };
    }

    if (moveInit.status === "no_reactions") {
      const combatantStates = await this.deps.combatRepo.listCombatants(encounterId);
      const actorState = combatantStates.find((c: any) => {
        if (actorRef.type === "Character") return c.characterId === actorRef.characterId;
        if (actorRef.type === "Monster") return c.monsterId === actorRef.monsterId;
        return c.npcId === actorRef.npcId;
      });

      if (!actorState) throw new ValidationError("Actor not found in encounter");

      const resources = (actorState.resources as any) ?? {};
      const currentPos = resources.position;
      const encounterForTerrain = await this.deps.combatRepo.getEncounterById(encounterId);
      const terrainMap = encounterForTerrain?.mapData as CombatMap | undefined;

      const movedFeet = currentPos ? calculateDistance(currentPos, destination) : null;
      // Calculate remaining movement after this move
      const currentRemaining = typeof resources.movementRemaining === "number"
        ? resources.movementRemaining
        : getEffectiveSpeed(actorState.resources);
      let newMovementRemaining = Math.max(0, currentRemaining - (movedFeet ?? 0));
      let updatedConditions = actorState.conditions;
      let updatedHpCurrent = actorState.hpCurrent;

      if (currentPos && terrainMap && isPitEntry(terrainMap, currentPos, destination)) {
        const actorStats = await this.deps.combatants.getCombatStats(actorRef);
        const pitSeed = hashStringToInt32(`${sessionId}:${encounterId}:${actorState.id}:${currentPos.x}:${currentPos.y}:${destination.x}:${destination.y}:pit`);
        const pitResult = resolvePitEntry(
          terrainMap,
          currentPos,
          destination,
          actorStats.abilityScores.dexterity,
          actorState.hpCurrent,
          actorState.conditions,
          new SeededDiceRoller(pitSeed),
        );

        if (pitResult.triggered) {
          updatedConditions = pitResult.updatedConditions as any;
          updatedHpCurrent = pitResult.hpAfter;
          if (pitResult.movementEnds) {
            newMovementRemaining = 0;
          }
        }
      }

      await this.deps.combatRepo.updateCombatantState(actorState.id, {
        hpCurrent: updatedHpCurrent,
        conditions: updatedConditions as any,
        resources: {
          ...resources,
          position: destination,
          movementSpent: newMovementRemaining <= 0,
          movementRemaining: newMovementRemaining,
          lastMovePath: currentPos ? {
            cells: [
              { x: currentPos.x, y: currentPos.y, terrain: "normal", stepCostFeet: 0, cumulativeCostFeet: 0 },
              { x: destination.x, y: destination.y, terrain: "normal", stepCostFeet: movedFeet ?? 0, cumulativeCostFeet: movedFeet ?? 0 },
            ],
            costFeet: movedFeet ?? 0,
          } : undefined,
        } as any,
      });

      if (updatedHpCurrent < actorState.hpCurrent) {
        await applyKoEffectsIfNeeded(actorState, actorState.hpCurrent, updatedHpCurrent, this.deps.combatRepo);
      }

      // Keep CombatMap entities[] in sync with the position update
      await syncEntityPosition(this.deps.combatRepo, encounterId, actorState.id, destination);

      // Sync aura zones for this combatant
      await syncAuraZones(this.deps.combatRepo, encounterId, actorId, destination);

      // --- Zone damage during movement ---
      const encounters = await this.deps.combatRepo.listEncountersBySession(sessionId);
      const encounter = encounters.find((e: any) => e.status === "Active") ?? encounters[0];
      let zoneDamageNote = "";
      if (encounter && currentPos && updatedHpCurrent > 0) {
        const combatMap = encounter.mapData as unknown as CombatMap | undefined;
        if (combatMap && (combatMap.zones?.length ?? 0) > 0) {
          const actorEntityId = actorState.characterId ?? actorState.monsterId ?? actorState.npcId ?? actorState.id;
          const actorIsPC = actorState.combatantType === "Character" || actorState.combatantType === "NPC";
          // Check Evasion for the moving creature (Monk 7/Rogue 7 — DEX save zone damage)
          let actorHasEvasion = false;
          try {
            const actorStats = await this.deps.combatants.getCombatStats(actorRef);
            actorHasEvasion = creatureHasEvasion(actorStats.className, actorStats.level);
          } catch { /* monsters/NPCs won't have class features */ }
          const zoneDmgResult = await resolveZoneDamageForPath(
            [destination],
            currentPos,
            actorState,
            combatMap,
            (srcId: string) => {
              const src = findCombatantByEntityId(combatantStates, srcId);
              const srcIsPC = src ? (src.combatantType === "Character" || src.combatantType === "NPC") : false;
              return actorIsPC === srcIsPC;
            },
            { damageResistances: [], damageImmunities: [], damageVulnerabilities: [] },
            { combatRepo: this.deps.combatRepo, hasEvasion: actorHasEvasion, debugLog: this.debugLogsEnabled },
          );
          if (zoneDmgResult.totalDamage > 0) {
            zoneDamageNote = ` Zone damage: ${zoneDmgResult.totalDamage} HP.`;
          }
        }
      }

      const actorName = getActorNameFromRoster(actorId, roster);
      const narration = await this.eventEmitter.generateNarration("movementComplete", {
        actorName,
        from: currentPos,
        to: destination,
        distance: movedFeet,
      });

      return {
        requiresPlayerInput: false,
        actionComplete: true,
        type: "MOVE_COMPLETE",
        movedTo: destination,
        movedFeet,
        opportunityAttacks: moveInit.opportunityAttacks,
        message: `Moved to (${destination.x}, ${destination.y})${movedFeet !== null ? ` (${Math.round(movedFeet)}ft)` : ""}.${zoneDamageNote}`,
        narration,
        // Synthesize a simple 2-cell path for straight-line moves (start → end)
        pathCells: currentPos ? [
          { x: currentPos.x, y: currentPos.y, terrain: "normal" as const, stepCostFeet: 0, cumulativeCostFeet: 0 },
          { x: destination.x, y: destination.y, terrain: "normal" as const, stepCostFeet: movedFeet ?? 0, cumulativeCostFeet: movedFeet ?? 0 },
        ] : undefined,
        pathCostFeet: movedFeet ?? undefined,
      };
    }

    return {
      requiresPlayerInput: false,
      actionComplete: false,
      type: "REACTION_CHECK",
      pendingActionId: moveInit.pendingActionId,
      opportunityAttacks: moveInit.opportunityAttacks,
      message: "Opportunity attacks possible. Resolve reactions, then complete the move.",
    };
  }

  /**
   * Handle "move toward <creature>" — resolve target position, A* pathfind,
   * and delegate to the standard handleMoveAction with the computed destination.
   */
  async handleMoveTowardAction(
    sessionId: string,
    encounterId: string,
    actorId: string,
    targetRef: CombatantRef,
    desiredRange: number | undefined,
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    const range = desiredRange ?? 5;
    const actorRef = inferActorRef(actorId, roster);

    // Resolve positions
    const combatantStates = await this.deps.combatRepo.listCombatants(encounterId);
    const actorPos = getPositionByRef(combatantStates, actorRef);
    const targetPos = getPositionByRef(combatantStates, targetRef);

    if (!actorPos) throw new ValidationError("Actor has no position on the map.");
    if (!targetPos) throw new ValidationError("Target has no position on the map.");

    // Already in range?
    if (calculateDistance(actorPos, targetPos) <= range) {
      return {
        requiresPlayerInput: false,
        actionComplete: true,
        type: "MOVE_COMPLETE",
        movedTo: actorPos,
        movedFeet: 0,
        message: `Already within ${range}ft of the target.`,
      };
    }

    // Get encounter map
    const encounter = await this.deps.combatRepo.getEncounterById(encounterId);
    const map = encounter?.mapData as unknown as CombatMap | undefined;

    if (!map || !map.cells || map.cells.length === 0) {
      // No map data — fall back to direct move toward target position minus desired range
      const dx = targetPos.x - actorPos.x;
      const dy = targetPos.y - actorPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const ratio = Math.max(0, (dist - range)) / dist;
      const destination = {
        x: Math.round((actorPos.x + dx * ratio) / 5) * 5,
        y: Math.round((actorPos.y + dy * ratio) / 5) * 5,
      };
      return this.handleMoveAction(sessionId, encounterId, actorId, destination, roster);
    }

    // Find the best adjacent cell within desired range of the target
    const occupiedPositions = combatantStates
      .filter(c => {
        const p = getPosition(c.resources ?? {});
        return p && c.hpCurrent > 0
                   && !(c.characterId === (actorRef as any).characterId && actorRef.type === "Character")
                   && !(c.monsterId === (actorRef as any).monsterId && actorRef.type === "Monster")
                   && !(c.npcId === (actorRef as any).npcId && actorRef.type === "NPC");
      })
      .map(c => getPosition(c.resources ?? {})!)
      .filter(Boolean);

    const destination = findAdjacentPosition(map, targetPos, actorPos, range);
    if (!destination) {
      throw new ValidationError(`Cannot find a passable position within ${range}ft of the target.`);
    }

    // Get actor's remaining movement
    const actorState = findCombatantStateByRef(combatantStates, actorRef);
    const resources = (actorState?.resources as any) ?? {};
    const movementRemaining = typeof resources.movementRemaining === "number"
      ? resources.movementRemaining
      : getEffectiveSpeed(actorState?.resources);

    // A* pathfinding
    const pathResult = findPath(map, actorPos, destination, {
      maxCostFeet: movementRemaining,
      avoidHazards: true,
      occupiedPositions,
    });

    // Determine actual destination from pathfinding
    let finalDestination = destination;
    let pathCells = pathResult.path;
    let pathCellsDetailed = pathResult.cells;
    const isPartial = pathResult.blocked && !!pathResult.reachablePosition;

    if (pathResult.blocked && pathResult.reachablePosition) {
      // Can't reach destination — move as far as possible
      finalDestination = pathResult.reachablePosition;
      // Trim path to only include cells up to reachable position
      const reachableIdx = pathCells.findIndex(
        p => p.x === pathResult.reachablePosition!.x && p.y === pathResult.reachablePosition!.y,
      );
      if (reachableIdx >= 0) {
        pathCells = pathCells.slice(0, reachableIdx + 1);
        pathCellsDetailed = pathCellsDetailed.slice(0, reachableIdx + 1);
      }
    } else if (pathResult.blocked && !pathResult.reachablePosition) {
      throw new ValidationError(
        `No path to the target. ${pathResult.narrationHints.join(" ")}`,
      );
    }

    // Build narration using the centralized path narrator
    const actorName = getActorNameFromRoster(actorId, roster);
    const targetName = getNameFromCombatantRef(targetRef, roster);
    const pathNarration = buildPathNarration({
      actorName,
      targetName,
      pathCells,
      pathCostFeet: pathResult.totalCostFeet,
      desiredRange: range,
      narrationHints: pathResult.narrationHints,
      partial: isPartial,
      startPosition: actorPos,
      endPosition: finalDestination,
    });

    // Delegate to initiateMove with path data for accurate OA detection and cost
    const actorRefForMove = inferActorRef(actorId, roster);
    const moveInit = await this.deps.twoPhaseActions.initiateMove(sessionId, {
      encounterId,
      actor: actorRefForMove,
      destination: finalDestination,
      pathCells,
      pathCostFeet: pathResult.totalCostFeet,
      pathNarrationHints: pathResult.narrationHints,
    });

    if (moveInit.status === "aborted_by_trigger") {
      const triggerMsg = moveInit.voluntaryMoveTriggerMessages?.join(" ") ?? "Movement trigger damage!";
      return {
        requiresPlayerInput: false,
        actionComplete: true,
        type: "move_towards",
        message: `${triggerMsg} ${actorId} is knocked out and cannot move.`,
      };
    }

    if (moveInit.status === "no_reactions") {
      // Update position (same logic as handleMoveAction)
      const freshCombatants = await this.deps.combatRepo.listCombatants(encounterId);
      const freshActor = freshCombatants.find((c: any) => {
        if (actorRefForMove.type === "Character") return c.characterId === actorRefForMove.characterId;
        if (actorRefForMove.type === "Monster") return c.monsterId === actorRefForMove.monsterId;
        return c.npcId === actorRefForMove.npcId;
      });

      if (!freshActor) throw new ValidationError("Actor not found in encounter");

      const res = (freshActor.resources as any) ?? {};
      const curRemaining = typeof res.movementRemaining === "number"
        ? res.movementRemaining
        : (typeof res.speed === "number" ? res.speed : 30);
      let newRemaining = Math.max(0, curRemaining - pathResult.totalCostFeet);
      let updatedConditions = freshActor.conditions;
      let updatedHpCurrent = freshActor.hpCurrent;

      if (map && isPitEntry(map, actorPos, finalDestination)) {
        const actorStats = await this.deps.combatants.getCombatStats(actorRefForMove);
        const pitSeed = hashStringToInt32(`${sessionId}:${encounterId}:${freshActor.id}:${actorPos.x}:${actorPos.y}:${finalDestination.x}:${finalDestination.y}:pit`);
        const pitResult = resolvePitEntry(
          map,
          actorPos,
          finalDestination,
          actorStats.abilityScores.dexterity,
          freshActor.hpCurrent,
          freshActor.conditions,
          new SeededDiceRoller(pitSeed),
        );

        if (pitResult.triggered) {
          updatedConditions = pitResult.updatedConditions as any;
          updatedHpCurrent = pitResult.hpAfter;
          if (pitResult.movementEnds) {
            newRemaining = 0;
          }
        }
      }

      await this.deps.combatRepo.updateCombatantState(freshActor.id, {
        hpCurrent: updatedHpCurrent,
        conditions: updatedConditions as any,
        resources: {
          ...res,
          position: finalDestination,
          movementSpent: newRemaining <= 0,
          movementRemaining: newRemaining,
          lastMovePath: {
            cells: pathCellsDetailed,
            costFeet: pathResult.totalCostFeet,
          },
        } as any,
      });

      if (updatedHpCurrent < freshActor.hpCurrent) {
        await applyKoEffectsIfNeeded(freshActor, freshActor.hpCurrent, updatedHpCurrent, this.deps.combatRepo);
      }

      // Keep CombatMap entities[] in sync with the position update
      await syncEntityPosition(this.deps.combatRepo, encounterId, freshActor.id, finalDestination);

      const actorName_ = getActorNameFromRoster(actorId, roster);
      const narration = await this.eventEmitter.generateNarration("movementComplete", {
        actorName: actorName_,
        from: actorPos,
        to: finalDestination,
        distance: pathResult.totalCostFeet,
      });

      // Use buildPathNarration output as the primary narration, enriched with LLM narration
      const fullNarration = narration
        ? `${narration} ${pathNarration}`.trim()
        : pathNarration;

      return {
        requiresPlayerInput: false,
        actionComplete: true,
        type: "MOVE_COMPLETE",
        movedTo: finalDestination,
        movedFeet: pathResult.totalCostFeet,
        opportunityAttacks: moveInit.opportunityAttacks,
        message: `Moved to (${finalDestination.x}, ${finalDestination.y}) (${Math.round(pathResult.totalCostFeet)}ft). ${pathNarration}`.trim(),
        narration: fullNarration,
        pathCells: pathCellsDetailed,
        pathCostFeet: pathResult.totalCostFeet,
        pathfinding: {
          totalCostFeet: pathResult.totalCostFeet,
          terrainEncountered: pathResult.terrainEncountered,
          narrationHints: pathResult.narrationHints,
          wasBlocked: pathResult.blocked,
        },
      };
    }

    return {
      requiresPlayerInput: false,
      actionComplete: false,
      type: "REACTION_CHECK",
      pendingActionId: moveInit.pendingActionId,
      opportunityAttacks: moveInit.opportunityAttacks,
      message: `Opportunity attacks possible. Resolve reactions, then complete the move. ${pathNarration}`.trim(),
    };
  }

  /**
   * Handle jump as part of movement.
   *
   * D&D 5e 2024 — Jump is NOT an action; it's part of movement.
   * Long Jump: leap up to STR score feet (half standing). Each foot costs 1 ft of movement.
   * High Jump: leap 3 + STR mod feet (half standing). Each foot costs 1 ft of movement.
   *
   * The jumpDistanceMultiplier (e.g. from Step of the Wind) is consumed here.
   *
   * Position is updated: Long Jump moves horizontally toward the nearest hostile
   * (or a specified direction target). High Jump is vertical (no horizontal displacement).
   *
   * If you land in Difficult Terrain → DC 10 DEX (Acrobatics) check or Prone.
   */
  async handleJumpAction(
    _sessionId: string,
    encounterId: string,
    actorId: string,
    jump: ParsedJump,
    characters: SessionCharacterRecord[],
    monsters: SessionMonsterRecord[],
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    const actorRef = inferActorRef(actorId, roster);

    // --- Resolve Strength & Dexterity scores/modifiers ---
    let strengthScore = 10;
    let strengthModifier = 0;
    let dexterityModifier = 0;
    let proficiencyBonus = 0;
    let acrobaticsProficient = false;

    const resolveAbilityScores = (scores: any, sheet: any) => {
      if (scores && typeof scores.strength === "number") {
        strengthScore = scores.strength;
        strengthModifier = Math.floor((strengthScore - 10) / 2);
      }
      if (scores && typeof scores.dexterity === "number") {
        dexterityModifier = Math.floor((scores.dexterity - 10) / 2);
      }
      if (typeof sheet?.proficiencyBonus === "number") {
        proficiencyBonus = sheet.proficiencyBonus;
      }
      // Check for Acrobatics proficiency
      const skillProf: string[] = Array.isArray(sheet?.skillProficiencies) ? sheet.skillProficiencies : [];
      acrobaticsProficient = skillProf.some((s: string) => s.toLowerCase() === "acrobatics");
    };

    if (actorRef.type === "Character") {
      const character = characters.find((c: any) => c.id === actorId);
      const sheet = (character?.sheet ?? {}) as any;
      resolveAbilityScores(sheet?.abilityScores, sheet);
    } else if (actorRef.type === "Monster") {
      const monster = monsters.find((m: any) => m.id === actorId);
      const statBlock = (monster?.statBlock ?? {}) as any;
      resolveAbilityScores(statBlock?.abilityScores, statBlock);
    }

    // --- Resolve jump distance multiplier from combat state ---
    const combatantStates = await this.deps.combatRepo.listCombatants(encounterId);
    const actorState = combatantStates.find((c: any) => {
      if (actorRef.type === "Character") return c.characterId === (actorRef as any).characterId;
      if (actorRef.type === "Monster") return c.monsterId === (actorRef as any).monsterId;
      return c.npcId === (actorRef as any).npcId;
    });

    if (!actorState) throw new ValidationError("Actor not found in encounter");

    const resources = (actorState.resources as any) ?? {};
    const jumpMultiplier = typeof resources.jumpDistanceMultiplier === "number"
      ? resources.jumpDistanceMultiplier
      : 1;

    // --- Determine movement already spent this turn ---
    const movementRemaining = typeof resources.movementRemaining === "number"
      ? resources.movementRemaining
      : getEffectiveSpeed(actorState.resources);

    // Running start: needs ≥ 10 ft of movement already spent (a simplification —
    // the rule says "move at least 10 feet immediately before the jump").
    const totalSpeed = getEffectiveSpeed(actorState.resources);
    const movementUsed = totalSpeed - movementRemaining;
    const hasRunningStart = movementUsed >= 10;

    // --- Calculate jump distance ---
    const jumpResult = jump.jumpType === "high"
      ? calculateHighJumpDistance(strengthModifier, hasRunningStart, jumpMultiplier)
      : calculateLongJumpDistance(strengthScore, hasRunningStart, jumpMultiplier);

    // If the player requested a specific distance, cap it
    const requestedDistance = jump.requestedDistanceFeet ?? jumpResult.maxDistanceFeet;
    const actualJumpDistance = Math.min(requestedDistance, jumpResult.maxDistanceFeet);

    // Jump costs movement 1:1
    if (actualJumpDistance > movementRemaining) {
      throw new ValidationError(
        `Not enough movement to jump ${actualJumpDistance}ft. ` +
        `Movement remaining: ${Math.round(movementRemaining)}ft. ` +
        `Max jump distance: ${jumpResult.maxDistanceFeet}ft (${jump.jumpType} jump${hasRunningStart ? ", running start" : ", standing"}${jumpMultiplier > 1 ? `, ×${jumpMultiplier} multiplier` : ""}).`,
      );
    }

    // --- Compute landing position ---
    const currentPosition = resources.position ?? { x: 0, y: 0 };

    // Determine direction target for the jump
    let directionTarget: { x: number; y: number } | undefined;
    if (jump.directionCoords) {
      directionTarget = jump.directionCoords;
    } else if (jump.directionTarget) {
      directionTarget = getPositionByRef(combatantStates, jump.directionTarget) ?? undefined;
    } else {
      // Default: jump toward the nearest hostile creature
      directionTarget = this.findNearestHostilePosition(actorRef, combatantStates, currentPosition);
    }

    const landingPosition = computeJumpLandingPosition(
      currentPosition,
      actualJumpDistance,
      jump.jumpType,
      directionTarget,
    );

    // --- Check terrain at landing position for Difficult Terrain ---
    let landedInDifficultTerrain = false;
    let proneFromLanding = false;
    let acrobaticsCheckSummary = "";

    const encounter = await this.deps.combatRepo.getEncounterById(encounterId);
    const map = encounter?.mapData as unknown as CombatMap | undefined;

    if (map && map.cells && map.cells.length > 0) {
      const landingCell = getCellAt(map, landingPosition);
      if (landingCell && landingCell.terrain === "difficult") {
        landedInDifficultTerrain = true;

        // DC 10 Dexterity (Acrobatics) check or Prone
        if (this.deps.diceRoller) {
          // Apply ActiveEffect bonuses to the acrobatics (ability) check
          const acroEffects = getActiveEffects(actorState.resources);
          const acroBonus = calculateBonusFromEffects(acroEffects, 'ability_checks', 'dexterity');
          let acroEffectBonus = acroBonus.flatBonus;
          for (const dr of acroBonus.diceRolls) {
            acroEffectBonus += this.deps.diceRoller.rollDie(dr.sides, dr.count).total;
          }
          const acroHasAdv = hasAdvantageFromEffects(acroEffects, 'ability_checks', 'dexterity');
          const acroHasDisadv = hasDisadvantageFromEffects(acroEffects, 'ability_checks', 'dexterity');
          const acroMode: 'advantage' | 'disadvantage' | 'normal' =
            acroHasAdv && !acroHasDisadv ? 'advantage'
            : acroHasDisadv && !acroHasAdv ? 'disadvantage'
            : 'normal';

          const acrobaticsResult = abilityCheck(this.deps.diceRoller, {
            dc: 10,
            abilityModifier: dexterityModifier + acroEffectBonus,
            proficiencyBonus,
            proficient: acrobaticsProficient,
            mode: acroMode,
          });

          if (!acrobaticsResult.success) {
            proneFromLanding = true;
            acrobaticsCheckSummary = `Acrobatics check failed (rolled ${acrobaticsResult.total} vs DC 10) — Prone!`;
          } else {
            acrobaticsCheckSummary = `Acrobatics check passed (rolled ${acrobaticsResult.total} vs DC 10).`;
          }
        } else {
          // No dice roller available — auto-fail Acrobatics (conservative)
          proneFromLanding = true;
          acrobaticsCheckSummary = "Landed in difficult terrain — Prone (no dice roller for Acrobatics check).";
        }
      }
    }

    // --- Spend the movement and update position ---
    const newMovementRemaining = Math.max(0, movementRemaining - actualJumpDistance);

    await this.deps.combatRepo.updateCombatantState(actorState.id, {
      resources: {
        ...resources,
        position: landingPosition,
        movementRemaining: newMovementRemaining,
        movementSpent: newMovementRemaining <= 0,
      } as any,
    });

    // Keep CombatMap entities[] in sync with the jump landing position
    await syncEntityPosition(this.deps.combatRepo, encounterId, actorState.id, landingPosition);

    // --- Apply Prone condition if failed Acrobatics check ---
    if (proneFromLanding) {
      if (!isConditionImmuneByEffects(actorState.resources, "Prone")) {
        let conditions = normalizeConditions(actorState.conditions);
        conditions = addCondition(conditions, createCondition("Prone" as Condition, "until_removed", {
          source: "Jump: difficult terrain landing",
        }));
        await this.deps.combatRepo.updateCombatantState(actorState.id, {
          conditions: conditions as any,
        });
      }
    }

    // --- Build result ---
    const actorName = getActorNameFromRoster(actorId, roster);
    const jumpTypeLabel = jump.jumpType === "high" ? "High Jump" : "Long Jump";
    const runningLabel = hasRunningStart ? "running start" : "standing";
    const multiplierLabel = jumpMultiplier > 1 ? `, ×${jumpMultiplier} multiplier` : "";

    let message = `${actorName} performs a ${jumpTypeLabel} (${runningLabel}${multiplierLabel}): ${actualJumpDistance}ft`;
    if (jump.jumpType === "long") {
      message += ` to (${landingPosition.x}, ${landingPosition.y})`;
    }
    message += `. Movement remaining: ${Math.round(newMovementRemaining)}ft.`;
    if (acrobaticsCheckSummary) {
      message += ` ${acrobaticsCheckSummary}`;
    }

    const narration = await this.eventEmitter.generateNarration("jumpComplete", {
      actorName,
      jumpType: jump.jumpType,
      distance: actualJumpDistance,
      hasRunningStart,
      jumpMultiplier,
      landingPosition,
      landedInDifficultTerrain,
      proneFromLanding,
    });

    return {
      requiresPlayerInput: false,
      actionComplete: true,
      type: "JUMP_COMPLETE",
      action: jumpTypeLabel,
      message,
      narration: narration ?? undefined,
      movedFeet: actualJumpDistance,
      movedTo: landingPosition,
    };
  }

  /**
   * Find the position of the nearest hostile creature relative to the actor.
   * Used as the default jump direction when no explicit target is specified.
   */
  findNearestHostilePosition(
    actorRef: CombatantRef,
    combatantStates: CombatantStateRecord[],
    actorPosition: { x: number; y: number },
  ): { x: number; y: number } | undefined {
    let nearestDist = Infinity;
    let nearestPos: { x: number; y: number } | undefined;

    const actorType = actorRef.type; // "Character" or "Monster" or "NPC"

    for (const combatant of combatantStates) {
      // Skip self
      if (actorType === "Character" && combatant.characterId === (actorRef as any).characterId) continue;
      if (actorType === "Monster" && combatant.monsterId === (actorRef as any).monsterId) continue;
      if (actorType === "NPC" && combatant.npcId === (actorRef as any).npcId) continue;

      // Identify hostiles: Characters are hostile to Monsters/NPCs and vice versa
      const isHostile =
        (actorType === "Character" && (combatant.combatantType === "Monster" || combatant.combatantType === "NPC")) ||
        (actorType !== "Character" && combatant.combatantType === "Character");

      if (!isHostile) continue;

      const pos = getPosition(combatant.resources ?? {});
      if (!pos) continue;

      const dist = calculateDistance(actorPosition, pos);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestPos = pos;
      }
    }

    return nearestPos;
  }
}
