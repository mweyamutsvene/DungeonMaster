/**
 * Two-phase action execution service for handling reactions.
 * 
 * Actions that can trigger reactions are split into:
 * 1. Initiate phase: Detect reaction opportunities, create pending action
 * 2. Complete phase: Resolve reactions, execute action
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
  PendingMoveData,
  PendingSpellCastData,
  PendingAttackData,
  PendingDamageReactionData
} from "../../../domain/entities/combat/pending-action.js";
import { 
  attemptMovement, 
  crossesThroughReach,
  calculateDistance,
  type MovementAttempt 
} from "../../../domain/rules/movement.js";
import { getTerrainSpeedModifier, type CombatMap } from "../../../domain/rules/combat-map.js";
import { canMakeOpportunityAttack, hasReactionAvailable } from "../../../domain/rules/opportunity-attack.js";
import { resolveEncounterOrThrow } from "./helpers/encounter-resolver.js";
import { findCombatantStateByRef } from "./helpers/combatant-ref.js";
import { ValidationError, NotFoundError } from "../../errors.js";
import { 
  normalizeResources, 
  readBoolean, 
  getPosition,
  getActiveEffects,
  getEffectiveSpeed,
} from "./helpers/resource-utils.js";
import { syncEntityPosition } from "./helpers/sync-map-entity.js";
import { resolveZoneDamageForPath } from "./helpers/zone-damage-resolver.js";
import { resolveMovementTriggers } from "./helpers/movement-trigger-resolver.js";
import { syncAuraZones } from "./helpers/aura-sync.js";
import { applyDamageDefenses } from "../../../domain/rules/damage-defenses.js";
import { SeededDiceRoller } from "../../../domain/rules/dice-roller.js";
import { deriveRollModeFromConditions } from "./tabletop/combat-text-parser.js";
import { detectAttackReactions, detectDamageReactions, detectSpellReactions } from "../../../domain/entities/classes/combat-text-profile.js";
import { getAllCombatTextProfiles } from "../../../domain/entities/classes/registry.js";
import { normalizeConditions, hasCondition, removeCondition } from "../../../domain/entities/combat/conditions.js";
import { applyKoEffectsIfNeeded } from "./helpers/ko-handler.js";
import { calculateFlatBonusFromEffects, calculateBonusFromEffects, hasAdvantageFromEffects, hasDisadvantageFromEffects, getDamageDefenseEffects, type ActiveEffect } from "../../../domain/entities/combat/effects.js";
import type { JsonValue } from "../../types.js";

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

/** Simple string → int32 hash for deterministic OA dice seeding. */
function hashForOA(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0;
  }
  return hash;
}

/**
 * Service for handling two-phase actions with reactions.
 */
export class TwoPhaseActionService {
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
  async initiateMove(sessionId: string, input: InitiateMoveInput): Promise<InitiateMoveResult> {
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
    // Standing from Prone costs movement equal to half your base Speed.
    // After standing, the creature moves normally with remaining speed.
    // Creatures that cannot spend movement (Grappled, Incapacitated) cannot stand up.
    let standUpCost = 0;
    const actorConditions = normalizeConditions(actor.conditions as unknown[]);
    const isProne = hasCondition(actorConditions, "Prone");

    if (isProne) {
      // Check if the creature can stand (not Grappled/Incapacitated/etc.)
      const isGrappled = hasCondition(actorConditions, "Grappled");
      const isIncapacitated = hasCondition(actorConditions, "Incapacitated");
      const isStunned = hasCondition(actorConditions, "Stunned");
      const isParalyzed = hasCondition(actorConditions, "Paralyzed");
      const isUnconscious = hasCondition(actorConditions, "Unconscious");

      if (isGrappled || isIncapacitated || isStunned || isParalyzed || isUnconscious) {
        throw new ValidationError(
          "Cannot stand up while Grappled, Incapacitated, Stunned, Paralyzed, or Unconscious — movement blocked"
        );
      }

      // Stand-up costs half base speed (before Dash doubling)
      standUpCost = Math.ceil(speed / 2);
      effectiveSpeed -= standUpCost;

      if (effectiveSpeed <= 0) {
        throw new ValidationError(
          `Cannot move — standing from Prone costs ${standUpCost}ft, leaving no movement remaining`
        );
      }

      // Remove Prone condition and persist stand-up cost to movementRemaining immediately
      const updatedConditions = removeCondition(actorConditions, "Prone");
      const currentMovementRemaining = typeof resources.movementRemaining === "number"
        ? resources.movementRemaining
        : effectiveSpeed + standUpCost; // fallback to full speed before stand-up deduction
      const postStandUpRemaining = currentMovementRemaining - standUpCost;
      await this.combat.updateCombatantState(actor.id, {
        conditions: updatedConditions as any,
        resources: { ...resources, movementRemaining: postStandUpRemaining } as JsonValue,
      });
    }

    // Compute speed modifier from terrain + conditions
    let speedModifier = 1.0;

    // If we have a pre-computed A* path with cost, terrain is already factored in.
    // Only apply terrain modifier for straight-line (non-pathfinding) moves.
    if (!input.pathCostFeet) {
      // Terrain-based modifier: check destination terrain on the combat map
      if (encounter.mapData && typeof encounter.mapData === "object") {
        const map = encounter.mapData as unknown as CombatMap;
        if (map.cells) {
          const terrainMod = getTerrainSpeedModifier(map, input.destination);
          speedModifier = Math.min(speedModifier, terrainMod);
        }
      }
    }

    // Condition-based modifier (e.g. Stunning Strike partial → speedModifier: 0.5)
    const conditionSpeedMod = typeof resources.speedModifier === "number" ? resources.speedModifier : undefined;
    if (conditionSpeedMod !== undefined && conditionSpeedMod < speedModifier) {
      speedModifier = conditionSpeedMod;
    }

    // Validate movement
    if (input.pathCostFeet !== undefined) {
      // A* pathfinding already computed the cost — just check against effective speed
      const adjustedCost = conditionSpeedMod !== undefined && conditionSpeedMod < 1.0
        ? input.pathCostFeet / conditionSpeedMod  // condition modifier hadn't been applied to A* cost
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
    // Check if the moving creature has effects that trigger when it voluntarily moves.
    // Apply damage and remove the triggered effects. If the creature is KO'd, abort the move.
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

      // Path-based OA detection: check each cell transition along the path
      // for leaving reach. For non-linear paths, this is more accurate than
      // just checking start→end.
      let crossesReach = false;
      if (path.length > 1) {
        // Walk the path cell by cell
        let prevPos = currentPos;
        for (const cell of path) {
          if (crossesThroughReach({ from: prevPos, to: cell }, otherPos, reach)) {
            crossesReach = true;
            break;
          }
          prevPos = cell;
        }
      } else {
        // Single-step path (legacy straight-line)
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
          other
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
    // A combatant with a readied attack can react when a creature enters their reach.
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

      // Check if the combatant has their reaction available
      const hasReaction = hasReactionAvailable({ reactionUsed: false, ...otherResources } as any);
      if (!hasReaction) continue;

      const otherPos = getPosition(otherResources);
      if (!otherPos) continue;

      const reach = typeof otherResources.reach === "number" ? otherResources.reach : 5;

      // Check if the moving creature enters within reach of the readied attacker.
      // "Entering reach" means: creature was NOT within reach before, and IS within reach after.
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
          other
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
          payload: payload as JsonValue,
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
  async completeMove(sessionId: string, input: CompleteMoveInput): Promise<CompleteMoveResult> {
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

    // Execute opportunity attacks from resolved reactions
    const executedOAs: Array<{
      attackerId: string;
      attackerName: string;
      targetId: string;
      damage: number;
    }> = [];

    const usedReactions = pendingAction.resolvedReactions.filter(
      (r: ReactionResponse) => r.choice === "use" && r.opportunityId
    );

    let targetStillAlive = true;
    let finalPosition = moveData.to;

    // Player character OAs now prompt for rolls via /combat/move/complete endpoint.
    // By the time we reach here, all player OA results should be stored in resolvedReactions.
    // We use those stored results for player OAs and auto-roll for monster OAs.

    for (const reaction of usedReactions) {
      const opp = pendingAction.reactionOpportunities.find(
        (o: ReactionOpportunity) => o.id === reaction.opportunityId
      );
      
      if (!opp || (opp.reactionType !== "opportunity_attack" && opp.reactionType !== "readied_action")) continue;

      const attacker = combatants.find((c) => c.id === reaction.combatantId);
      if (!attacker || attacker.hpCurrent <= 0) continue;

      let hit = false;
      let totalDamage = 0;
      let attackRoll = 0;
      let critical = false;

      // Check if player OA results were already provided (from /combat/move/complete with rolls)
      const storedResult = reaction.result as { attackRoll?: number; totalAttack?: number; hit?: boolean; damageRoll?: number; totalDamage?: number; critical?: boolean } | undefined;
      
      if (storedResult && storedResult.hit !== undefined) {
        // Use stored player OA results
        hit = storedResult.hit;
        attackRoll = storedResult.totalAttack ?? storedResult.attackRoll ?? 0;
        totalDamage = storedResult.totalDamage ?? 0;
        critical = storedResult.critical ?? false;
      } else {
        // Auto-roll for monster OAs (or player OAs without stored results)
        const attackerRef: CombatantRef =
          attacker.combatantType === "Character" && attacker.characterId ? { type: "Character", characterId: attacker.characterId } :
          attacker.combatantType === "Monster" && attacker.monsterId ? { type: "Monster", monsterId: attacker.monsterId } :
          attacker.combatantType === "NPC" && attacker.npcId ? { type: "NPC", npcId: attacker.npcId } :
          { type: "Character", characterId: "" };
        const attackerStats = await this.combatants.getCombatStats(attackerRef);

        const strMod = Math.floor((attackerStats.abilityScores.strength - 10) / 2);
        const dexMod = Math.floor((attackerStats.abilityScores.dexterity - 10) / 2);
        const profBonus = attackerStats.proficiencyBonus;
        let attackMod = Math.max(strMod, dexMod) + profBonus;

        // ── ActiveEffect integration for OA ──
        const attackerActiveEffects = getActiveEffects(attacker.resources ?? {});
        const targetActiveEffects = getActiveEffects(actor.resources ?? {});
        const attackKind: "melee" | "ranged" = "melee"; // OAs are always melee

        // Advantage/disadvantage from ActiveEffects
        let effectAdv = 0;
        let effectDisadv = 0;
        if (hasAdvantageFromEffects(attackerActiveEffects, 'attack_rolls')) effectAdv++;
        if (hasAdvantageFromEffects(attackerActiveEffects, 'melee_attack_rolls')) effectAdv++;
        if (hasDisadvantageFromEffects(attackerActiveEffects, 'attack_rolls')) effectDisadv++;
        if (hasDisadvantageFromEffects(attackerActiveEffects, 'melee_attack_rolls')) effectDisadv++;

        // Target's effects on incoming attacks (e.g., Dodge → disadvantage)
        const actorEntityId = actor.characterId ?? actor.monsterId ?? actor.npcId ?? actor.id;
        for (const eff of targetActiveEffects) {
          if (eff.target !== 'attack_rolls' && eff.target !== 'melee_attack_rolls') continue;
          if (!eff.targetCombatantId || eff.targetCombatantId !== actorEntityId) continue;
          if (eff.type === 'advantage') effectAdv++;
          if (eff.type === 'disadvantage') effectDisadv++;
        }

        // Derive roll mode from conditions + effects
        const attackerCondNames = normalizeConditions(attacker.conditions as unknown[]).map(c => c.condition);
        const targetCondNames = normalizeConditions(actor.conditions as unknown[]).map(c => c.condition);
        const rollMode = deriveRollModeFromConditions(attackerCondNames, targetCondNames, attackKind, effectAdv, effectDisadv);

        // Attack bonus from ActiveEffects (Bless, etc.)
        const atkBonusResult = calculateBonusFromEffects(attackerActiveEffects, 'attack_rolls');
        attackMod += atkBonusResult.flatBonus;

        // Create a deterministic dice roller per OA
        const oaSeed = hashForOA(`${encounter.id}:${encounter.round}:${attacker.id}:${actor.id}:oa`);
        const oaDice = new SeededDiceRoller(oaSeed);

        // Pre-roll dice-based attack bonuses
        for (const dr of atkBonusResult.diceRolls) {
          const count = Math.abs(dr.count);
          const sign = dr.count < 0 ? -1 : 1;
          for (let i = 0; i < count; i++) {
            attackMod += sign * oaDice.rollDie(dr.sides).total;
          }
        }

        // Roll d20 (respect advantage/disadvantage)
        const d20Roll1 = oaDice.rollDie(20).total;
        let d20Roll: number;
        if (rollMode === "advantage") {
          const d20Roll2 = oaDice.rollDie(20).total;
          d20Roll = Math.max(d20Roll1, d20Roll2);
        } else if (rollMode === "disadvantage") {
          const d20Roll2 = oaDice.rollDie(20).total;
          d20Roll = Math.min(d20Roll1, d20Roll2);
        } else {
          d20Roll = d20Roll1;
        }

        attackRoll = d20Roll + attackMod;
        critical = d20Roll === 20;

        // Get target AC from resources + ActiveEffect bonuses (Shield of Faith, etc.)
        const actorResources = normalizeResources(actor.resources);
        const baseTargetAC = typeof actorResources.armorClass === "number" ? actorResources.armorClass : 10;
        const acBonusFromEffects = calculateFlatBonusFromEffects(targetActiveEffects, 'armor_class');
        const effectiveTargetAC = baseTargetAC + acBonusFromEffects;

        // Nat 20 always hits, nat 1 always misses
        hit = d20Roll === 20 || (d20Roll !== 1 && attackRoll >= effectiveTargetAC);

        if (hit) {
          // Use monster's actual attack if available, else default 1d8 + ability mod
          let diceSides = 8;
          let diceCount = 1;
          let damageMod = Math.max(strMod, dexMod);
          let oaDamageType: string | undefined;

          if (attacker.combatantType === "Monster" && attacker.monsterId) {
            try {
              const attacks = await this.combatants.getMonsterAttacks(attacker.monsterId);
              const meleeAttack = attacks.find((a: any) => a && typeof a === 'object' && (a as any).kind !== 'ranged');
              if (meleeAttack && typeof meleeAttack === 'object') {
                const dmg = (meleeAttack as any).damage;
                if (dmg && typeof dmg.diceSides === 'number') diceSides = dmg.diceSides;
                if (dmg && typeof dmg.diceCount === 'number') diceCount = dmg.diceCount;
                if (dmg && typeof dmg.modifier === 'number') damageMod = dmg.modifier;
                if (typeof (meleeAttack as any).damageType === 'string') oaDamageType = (meleeAttack as any).damageType;
              }
            } catch { /* fall back to defaults */ }
          }

          let baseDamage = 0;
          const effectiveDiceCount = critical ? diceCount * 2 : diceCount;
          for (let i = 0; i < effectiveDiceCount; i++) {
            baseDamage += oaDice.rollDie(diceSides).total;
          }
          totalDamage = baseDamage + damageMod;

          // Extra damage from ActiveEffects (Rage, Hunter's Mark, etc.)
          const dmgEffects = attackerActiveEffects.filter(
            e => (e.type === 'bonus' || e.type === 'penalty')
              && (e.target === 'damage_rolls' || e.target === 'melee_damage_rolls')
              && (!e.targetCombatantId || e.targetCombatantId === actorEntityId)
          );
          for (const eff of dmgEffects) {
            if (eff.type === 'bonus') totalDamage += eff.value ?? 0;
            if (eff.type === 'penalty') totalDamage -= eff.value ?? 0;
            if (eff.diceValue) {
              const sign = eff.type === 'penalty' ? -1 : 1;
              for (let i = 0; i < eff.diceValue.count; i++) {
                totalDamage += sign * oaDice.rollDie(eff.diceValue.sides).total;
              }
            }
          }
          totalDamage = Math.max(0, totalDamage);

          // Damage defense from ActiveEffects (resistance, immunity, vulnerability)
          if (oaDamageType) {
            const effDef = getDamageDefenseEffects(targetActiveEffects, oaDamageType);
            const statDefenses = attackerStats.damageDefenses ?? {};
            const mergedDefenses: any = { ...statDefenses };
            if (effDef.resistances) {
              mergedDefenses.damageResistances = [...new Set([...(mergedDefenses.damageResistances ?? []), oaDamageType.toLowerCase()])];
            }
            if (effDef.vulnerabilities) {
              mergedDefenses.damageVulnerabilities = [...new Set([...(mergedDefenses.damageVulnerabilities ?? []), oaDamageType.toLowerCase()])];
            }
            if (effDef.immunities) {
              mergedDefenses.damageImmunities = [...new Set([...(mergedDefenses.damageImmunities ?? []), oaDamageType.toLowerCase()])];
            }
            if (mergedDefenses.damageResistances || mergedDefenses.damageImmunities || mergedDefenses.damageVulnerabilities) {
              const defResult = applyDamageDefenses(totalDamage, oaDamageType, mergedDefenses);
              totalDamage = defResult.adjustedDamage;
            }
          }
        }
      }

      if (hit && totalDamage > 0) {
        // Apply damage to moving creature
        const oaHpBefore = actor.hpCurrent;
        const newHP = Math.max(0, oaHpBefore - totalDamage);
        await this.combat.updateCombatantState(actor.id, {
          hpCurrent: newHP,
        });

        // Apply KO effects if character dropped to 0 HP from opportunity attack
        await applyKoEffectsIfNeeded(actor, oaHpBefore, newHP, this.combat);

        // ── ActiveEffect: retaliatory damage (Armor of Agathys, Fire Shield) ──
        // OAs are always melee, so if the target has retaliatory damage effects, they fire
        const targetRetEffects = getActiveEffects(actor.resources ?? {}).filter(e => e.type === 'retaliatory_damage');
        if (targetRetEffects.length > 0 && attacker.hpCurrent > 0) {
          const retSeed = hashForOA(`${encounter.id}:${encounter.round}:${attacker.id}:${actor.id}:oa:ret`);
          const retDice = new SeededDiceRoller(retSeed);
          let totalRetDmg = 0;
          for (const eff of targetRetEffects) {
            let retDmg = eff.value ?? 0;
            if (eff.diceValue) {
              for (let i = 0; i < eff.diceValue.count; i++) {
                retDmg += retDice.rollDie(eff.diceValue.sides).total;
              }
            }
            totalRetDmg += retDmg;
          }
          if (totalRetDmg > 0) {
            const retHpBefore = attacker.hpCurrent;
            const retHpAfter = Math.max(0, retHpBefore - totalRetDmg);
            await this.combat.updateCombatantState(attacker.id, { hpCurrent: retHpAfter });
            await applyKoEffectsIfNeeded(attacker, retHpBefore, retHpAfter, this.combat);
          }
        }

        const attackerName = await this.combatants.getName(
          attacker.combatantType === "Character" && attacker.characterId ? { type: "Character", characterId: attacker.characterId } :
          attacker.combatantType === "Monster" && attacker.monsterId ? { type: "Monster", monsterId: attacker.monsterId } :
          attacker.combatantType === "NPC" && attacker.npcId ? { type: "NPC", npcId: attacker.npcId } :
          { type: "Character", characterId: "" },
          attacker
        );

        executedOAs.push({
          attackerId: attacker.id,
          attackerName,
          targetId: actor.id,
          damage: totalDamage,
        });

        // Emit OA event
        if (this.events) {
          await this.events.append(sessionId, {
            id: nanoid(),
            type: "OpportunityAttack",
            payload: {
              encounterId: encounter.id,
              attackerId: attacker.id,
              attackerName,
              targetId: actor.id,
              attackRoll,
              hit: true,
              critical,
              damage: totalDamage,
            } as JsonValue,
          });
        }

        // CRITICAL: Check if target died from this OA
        if (newHP <= 0) {
          targetStillAlive = false;
          // Target dies at their current position (from moveData), not destination
          finalPosition = moveData.from;
          break; // No more OAs resolve if target is dead
        }
      }

      // Mark reaction as used (and clear readied action if this was a readied reaction)
      const attackerResources = normalizeResources(attacker.resources);
      const updatedAttackerResources: Record<string, unknown> = { ...attackerResources, reactionUsed: true };
      if (opp.reactionType === "readied_action") {
        updatedAttackerResources.readiedAction = undefined;
      }
      await this.combat.updateCombatantState(attacker.id, {
        resources: updatedAttackerResources as JsonValue,
      });
    }
    
    const resources = normalizeResources(actor.resources);
    // Calculate remaining movement after this move
    const distanceMoved = calculateDistance(moveData.from, finalPosition);
    const currentRemaining = typeof resources.movementRemaining === "number"
      ? resources.movementRemaining
      : getEffectiveSpeed(actor.resources);
    const newMovementRemaining = Math.max(0, currentRemaining - distanceMoved);
    const updatedResources = {
      ...resources,
      position: finalPosition, // Use finalPosition (might be moveData.from if died)
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
        const moverId = actor.characterId ?? actor.monsterId ?? actor.npcId ?? actor.id;
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
          // Update position to where creature died from zone damage
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
          to: finalPosition, // Shows where they actually ended (might be where they started if died)
          distanceMoved: calculateDistance(moveData.from, finalPosition),
          interrupted: !targetStillAlive, // Flag to show movement was interrupted by death
        } as JsonValue,
      });
    }

    // Mark as completed and cleanup
    await this.pendingActions.markCompleted(input.pendingActionId);
    await this.pendingActions.delete(input.pendingActionId);

    return {
      movedFeet: calculateDistance(moveData.from, finalPosition),
      from: moveData.from,
      to: finalPosition,
      opportunityAttacks: executedOAs,
    };
  }

  /**
   * Phase 1: Initiate spell cast, detect counterspell opportunities.
   */
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
    const encounter = await resolveEncounterOrThrow(this.sessions, this.combat, sessionId, input.encounterId);
    const combatants = await this.combat.listCombatants(encounter.id);

    const actor = findCombatantStateByRef(combatants, input.actor);
    if (!actor) throw new NotFoundError("Actor not found in encounter");

    // Check for counterspell opportunities
    const counterspellOpportunities: Array<{
      combatantId: string;
      combatantName: string;
      canUse: boolean;
      hasReaction: boolean;
      hasSpellSlot: boolean;
    }> = [];

    const reactionOpportunities: ReactionOpportunity[] = [];

    for (const other of combatants) {
      if (other.id === actor.id) continue;
      if (other.hpCurrent <= 0) continue;

      const otherResources = normalizeResources(other.resources);
      const hasReaction = hasReactionAvailable({ reactionUsed: false, ...otherResources } as any);

      // Profile-driven Counterspell detection via spell reaction defs
      if (!hasReaction || other.combatantType !== "Character") continue;

      // Build a CombatantRef for this combatant to get their stats
      const otherRef: CombatantRef = other.characterId
        ? { type: "Character", characterId: other.characterId }
        : other.monsterId
          ? { type: "Monster", monsterId: other.monsterId }
          : { type: "NPC", npcId: other.npcId ?? "" };

      let otherStats: { className?: string; level?: number; abilityScores?: Record<string, number>; proficiencyBonus?: number } | null = null;
      try {
        otherStats = await this.combatants.getCombatStats(otherRef);
      } catch { continue; }

      // Compute distance between reactor and caster
      const actorPos = getPosition(normalizeResources(actor.resources));
      const otherPos = getPosition(otherResources);
      const distance = (actorPos && otherPos) ? calculateDistance(actorPos, otherPos) : 30; // default 30ft if no positions

      const spellDetectionInput = {
        className: otherStats.className?.toLowerCase() ?? "",
        level: otherStats.level ?? 1,
        abilityScores: (otherStats.abilityScores ?? {}) as Record<string, number>,
        resources: otherResources,
        hasReaction,
        isCharacter: true,
        spellName: input.spellName,
        spellLevel: input.spellLevel,
        casterId: actor.id,
        distance,
      };

      const detectedReactions = detectSpellReactions(spellDetectionInput, getAllCombatTextProfiles());
      if (detectedReactions.length === 0) continue;

      for (const detected of detectedReactions) {
        const otherName = await this.combatants.getName(otherRef, other);

        counterspellOpportunities.push({
          combatantId: other.id,
          combatantName: otherName,
          canUse: true,
          hasReaction,
          hasSpellSlot: true, // detection already verified slot availability
        });

        reactionOpportunities.push({
          id: nanoid(),
          combatantId: other.id,
          reactionType: "counterspell",
          canUse: true,
          context: {
            ...detected.context,
            spellName: input.spellName,
            spellLevel: input.spellLevel,
            casterId: actor.id,
          },
        });
      }
    }

    // If no reactions possible, return immediately
    if (reactionOpportunities.length === 0) {
      return {
        status: "no_reactions",
        counterspellOpportunities,
      };
    }

    // Create pending action
    const pendingActionId = nanoid();
    const spellData: PendingSpellCastData = {
      type: "spell_cast",
      spellName: input.spellName,
      spellLevel: input.spellLevel,
      target: input.target,
      targetPosition: input.targetPosition,
    };

    const pendingAction: PendingAction = {
      id: pendingActionId,
      encounterId: encounter.id,
      actor: input.actor,
      type: "spell_cast",
      data: spellData,
      reactionOpportunities,
      resolvedReactions: [],
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60000),
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
          payload: payload as JsonValue,
        });
      }
    }

    return {
      status: "awaiting_reactions",
      pendingActionId,
      counterspellOpportunities,
    };
  }

  /**
   * Phase 2: Complete spell cast after counterspell resolution.
   */
  async completeSpellCast(sessionId: string, input: {
    pendingActionId: string;
    /** DiceRoller for CON save resolution */
    diceRoller?: { rollDie(sides: number, count?: number, modifier?: number): { total: number; rolls: number[] } };
  }): Promise<{
    wasCountered: boolean;
    counterspells: Array<{
      casterId: string;
      casterName: string;
      success: boolean;
      saveDC?: number;
      saveRoll?: number;
    }>;
  }> {
    const pendingAction = await this.pendingActions.getById(input.pendingActionId);
    if (!pendingAction) {
      throw new NotFoundError(`Pending action not found: ${input.pendingActionId}`);
    }

    if (pendingAction.type !== "spell_cast") {
      throw new ValidationError("Pending action is not a spell cast");
    }

    const encounter = await this.combat.getEncounterById(pendingAction.encounterId);
    if (!encounter) throw new NotFoundError("Encounter not found");

    const combatants = await this.combat.listCombatants(encounter.id);

    // Resolve each counterspell attempt
    // D&D 5e 2024: Target (original caster) makes CON save vs counterspeller's spell save DC
    const counterspells: Array<{
      casterId: string;
      casterName: string;
      success: boolean;
      saveDC?: number;
      saveRoll?: number;
    }> = [];

    for (const resolved of pendingAction.resolvedReactions) {
      if (resolved.choice !== "use") continue;

      const opp = pendingAction.reactionOpportunities.find(
        (o) => o.id === resolved.opportunityId && o.reactionType === "counterspell",
      );
      if (!opp) continue;

      const counterspellerState = combatants.find((c) => c.id === opp.combatantId);
      if (!counterspellerState) continue;

      const counterspellerName = await this.combatants.getName(
        counterspellerState.characterId
          ? { type: "Character", characterId: counterspellerState.characterId }
          : { type: "Monster", monsterId: counterspellerState.monsterId ?? "" },
        counterspellerState,
      );

      // Get spell save DC from the reaction context (computed at detection time)
      const spellSaveDC = typeof opp.context.spellSaveDC === "number" ? opp.context.spellSaveDC : 13;
      const slotToSpend = typeof opp.context.slotToSpend === "string" ? opp.context.slotToSpend : "spellSlot_3";

      // Original caster makes CON save
      let saveTotal = 10; // Default if no dice roller
      if (input.diceRoller) {
        // Get caster's CON modifier
        const casterState = findCombatantStateByRef(combatants, pendingAction.actor);
        let conMod = 0;
        if (casterState) {
          try {
            const casterStats = await this.combatants.getCombatStats(pendingAction.actor);
            const con = (casterStats.abilityScores as Record<string, number>).constitution ?? 10;
            conMod = Math.floor((con - 10) / 2);
          } catch { /* default 0 */ }
        }
        const saveRoll = input.diceRoller.rollDie(20);
        saveTotal = saveRoll.total + conMod;
      }

      const success = saveTotal < spellSaveDC; // Failed save = spell countered
      counterspells.push({
        casterId: opp.combatantId,
        casterName: counterspellerName,
        success,
        saveDC: spellSaveDC,
        saveRoll: saveTotal,
      });

      // Spend the counterspeller's spell slot and mark reaction used
      if (counterspellerState) {
        const { spendResourceFromPool } = await import("./helpers/resource-utils.js");
        const csResources = normalizeResources(counterspellerState.resources);
        let updatedResources: JsonValue;
        try {
          updatedResources = spendResourceFromPool(counterspellerState.resources, slotToSpend, 1);
        } catch {
          updatedResources = counterspellerState.resources as JsonValue;
        }
        const normalizedUpdated = normalizeResources(updatedResources);
        await this.combat.updateCombatantState(counterspellerState.id, {
          resources: { ...normalizedUpdated, reactionUsed: true } as JsonValue,
        });
      }

      // Emit Counterspell event
      if (this.events) {
        await this.events.append(sessionId, {
          id: nanoid(),
          type: "Counterspell",
          payload: {
            encounterId: encounter.id,
            counterspellerId: opp.combatantId,
            counterspellerName,
            targetSpell: (pendingAction.data as PendingSpellCastData).spellName,
            spellSaveDC,
            saveRoll: saveTotal,
            success,
          } as JsonValue,
        });
      }

      // If one counterspell succeeds, spell is countered — stop checking
      if (success) break;
    }

    const wasCountered = counterspells.some((c) => c.success);

    // Mark as completed
    await this.pendingActions.markCompleted(input.pendingActionId);
    await this.pendingActions.delete(input.pendingActionId);

    return {
      wasCountered,
      counterspells,
    };
  }

  /**
   * Phase 1: Initiate attack, detect defensive reaction opportunities (Shield, Deflect Attacks, etc.).
   */
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
    const encounter = await resolveEncounterOrThrow(this.sessions, this.combat, sessionId, input.encounterId);
    const combatants = await this.combat.listCombatants(encounter.id);

    const actor = findCombatantStateByRef(combatants, input.actor);
    if (!actor) throw new NotFoundError("Actor not found in encounter");

    const target = findCombatantStateByRef(combatants, input.target);
    if (!target) throw new NotFoundError("Target not found in encounter");

    // Get target AC from combat stats (sheet), not resources
    const targetResources = normalizeResources(target.resources);
    let targetAC: number;
    try {
      const targetStats = await this.combatants.getCombatStats(input.target);
      targetAC = targetStats.armorClass;
    } catch {
      targetAC = typeof targetResources.armorClass === "number" ? targetResources.armorClass : 10;
    }

    // AC bonus from target's ActiveEffects (Shield of Faith, etc.)
    const targetActiveEffects = getActiveEffects(target.resources ?? {});
    const acBonusFromEffects = calculateFlatBonusFromEffects(targetActiveEffects, 'armor_class');
    targetAC += acBonusFromEffects;

    // Check if attack would hit without Shield
    const wouldHit = input.attackRoll >= targetAC;

    // If attack misses even without Shield, no need for Shield reaction
    if (!wouldHit) {
      return {
        status: "miss",
        attackRoll: input.attackRoll,
        targetAC,
        shieldOpportunities: [],
      };
    }

    // Check if target can use any defensive reactions
    const targetIsCharacter = target.combatantType === "Character";
    if (!targetIsCharacter) {
      // Only PCs get defensive reactions for now
      return {
        status: "hit",
        attackRoll: input.attackRoll,
        targetAC,
        shieldOpportunities: [],
      };
    }

    const hasReaction = hasReactionAvailable({ reactionUsed: false, ...targetResources } as any);

    const shieldOpportunities: Array<{
      combatantId: string;
      combatantName: string;
      canUse: boolean;
      hasReaction: boolean;
      hasSpellSlot: boolean;
      newAC?: number;
    }> = [];

    const reactionOpportunities: ReactionOpportunity[] = [];

    // Generic attack reaction detection via class profiles
    try {
      const targetStats = await this.combatants.getCombatStats(input.target);
      const detectionInput = {
        className: targetStats.className?.toLowerCase() ?? "",
        level: targetStats.level ?? 1,
        abilityScores: targetStats.abilityScores as Record<string, number>,
        resources: targetResources,
        hasReaction,
        isCharacter: targetIsCharacter,
        attackRoll: input.attackRoll,
        attackerId: actor.id,
        targetAC,
      };

      const detected = detectAttackReactions(detectionInput, getAllCombatTextProfiles());
      const targetName = detected.length > 0
        ? await this.combatants.getName(input.target, target)
        : "";

      for (const reaction of detected) {
        reactionOpportunities.push({
          id: nanoid(),
          combatantId: target.id,
          reactionType: reaction.reactionType as ReactionOpportunity["reactionType"],
          canUse: true,
          context: reaction.context,
        });

        shieldOpportunities.push({
          combatantId: target.id,
          combatantName: targetName,
          canUse: true,
          hasReaction: true,
          hasSpellSlot: true, // Generic — specific checks are in the detector
          newAC: typeof reaction.context.newAC === "number" ? reaction.context.newAC : undefined,
        });
      }
    } catch {
      // If we can't look up target stats, skip reaction detection
    }

    // If no reaction opportunities, attack hits
    if (reactionOpportunities.length === 0) {
      return {
        status: "hit",
        attackRoll: input.attackRoll,
        targetAC,
        shieldOpportunities,
      };
    }

    // Create pending action for reaction resolution (Shield, Deflect Attacks, Counterspell, etc.)
    const pendingActionId = nanoid();
    const attackData: PendingAttackData = {
      type: "attack",
      target: input.target,
      attackName: input.attackName,
      attackRoll: input.attackRoll,
    };

    const pendingAction: PendingAction = {
      id: pendingActionId,
      encounterId: encounter.id,
      actor: input.actor,
      type: "attack",
      data: attackData,
      reactionOpportunities,
      resolvedReactions: [],
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60000),
    };

    await this.pendingActions.create(pendingAction);

    // Emit reaction prompt(s)
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
          payload: payload as JsonValue,
        });
      }
    }

    return {
      status: "awaiting_reactions",
      pendingActionId,
      attackRoll: input.attackRoll,
      targetAC,
      shieldOpportunities,
    };
  }

  /**
   * Phase 2: Complete attack after reaction resolution (Shield, Deflect Attacks, etc.).
   */
  async completeAttack(sessionId: string, input: {
    pendingActionId: string;
    /** DiceRoller for damage resolution after reaction */
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
    const pendingAction = await this.pendingActions.getById(input.pendingActionId);
    if (!pendingAction) {
      throw new NotFoundError(`Pending action not found: ${input.pendingActionId}`);
    }

    if (pendingAction.type !== "attack") {
      throw new ValidationError("Pending action is not an attack");
    }

    const attackData = pendingAction.data as PendingAttackData;
    const encounter = await this.combat.getEncounterById(pendingAction.encounterId);
    if (!encounter) {
      throw new NotFoundError("Encounter not found");
    }

    const combatants = await this.combat.listCombatants(encounter.id);
    const target = findCombatantStateByRef(combatants, attackData.target);
    if (!target) {
      throw new NotFoundError("Target not found");
    }

    // Check if Shield was used
    const shieldReaction = pendingAction.resolvedReactions.find(
      (r: ReactionResponse) => r.choice === "use" && 
        pendingAction.reactionOpportunities.find((o) => o.id === r.opportunityId)?.reactionType === "shield"
    );

    // Check if Deflect Attacks was used
    const deflectReaction = pendingAction.resolvedReactions.find(
      (r: ReactionResponse) => r.choice === "use" &&
        pendingAction.reactionOpportunities.find((o) => o.id === r.opportunityId)?.reactionType === "deflect_attacks"
    );
    const deflectOpp = deflectReaction
      ? pendingAction.reactionOpportunities.find((o) => o.id === deflectReaction.opportunityId)
      : null;

    const targetResources = normalizeResources(target.resources);
    let finalAC: number;
    if (typeof attackData.targetAC === "number") {
      finalAC = attackData.targetAC;
    } else {
      // Fallback: read AC from combat stats
      try {
        const stats = await this.combatants.getCombatStats(attackData.target);
        finalAC = stats.armorClass;
      } catch {
        finalAC = typeof targetResources.armorClass === "number" ? targetResources.armorClass : 10;
      }
    }
    let shieldUsed = false;

    if (shieldReaction) {
      finalAC += 5;
      shieldUsed = true;

      // Spend level 1 spell slot for Shield
      const { spendResourceFromPool } = await import("./helpers/resource-utils.js");
      let updatedResources: JsonValue;
      try {
        updatedResources = spendResourceFromPool(target.resources, "spellSlot_1", 1);
      } catch {
        // If no spell slot available (shouldn't happen, was checked in initiateAttack)
        updatedResources = target.resources;
      }

      // Mark reaction as used and update spell slot
      const normalizedUpdated = normalizeResources(updatedResources);
      await this.combat.updateCombatantState(target.id, {
        resources: { ...normalizedUpdated, reactionUsed: true } as JsonValue,
      });

      // Emit Shield event
      if (this.events) {
        const targetName = await this.combatants.getName(attackData.target, target);
        await this.events.append(sessionId, {
          id: nanoid(),
          type: "ShieldCast",
          payload: {
            encounterId: encounter.id,
            casterId: target.id,
            casterName: targetName,
            previousAC: finalAC - 5,
            newAC: finalAC,
          } as JsonValue,
        });
      }
    }

    const hit = attackData.attackRoll >= finalAC;
    let damageApplied = 0;
    let redirectResult: { hit: boolean; attackRoll: number; targetAC: number; damage: number } | undefined;

    // If attack hits, roll and apply damage
    if (hit && attackData.damageSpec && input.diceRoller) {
      const { diceCount, diceSides, modifier } = attackData.damageSpec;
      const effectiveDiceCount = attackData.critical ? diceCount * 2 : diceCount;
      const damageRoll = input.diceRoller.rollDie(diceSides, effectiveDiceCount, modifier);
      damageApplied = Math.max(0, damageRoll.total);

      // Apply damage resistance/immunity/vulnerability
      const damageTypeFromSpec = attackData.damageSpec.damageType;
      if (damageApplied > 0 && damageTypeFromSpec) {
        try {
          const tgtStats = await this.combatants.getCombatStats(attackData.target);
          if (tgtStats.damageDefenses) {
            const defResult = applyDamageDefenses(damageApplied, damageTypeFromSpec, tgtStats.damageDefenses);
            damageApplied = defResult.adjustedDamage;
          }
        } catch { /* proceed without defenses */ }
      }

      // Apply Deflect Attacks damage reduction (Monk reaction)
      // Reduces damage by 1d10 + DEX mod + Monk level
      if (damageApplied > 0 && deflectReaction && deflectOpp && input.diceRoller) {
        const deflectCtx = deflectOpp.context as {
          dexMod?: number;
          monkLevel?: number;
          proficiencyBonus?: number;
          martialArtsDieSize?: number;
        };
        const dexMod = deflectCtx.dexMod ?? 0;
        const monkLevel = deflectCtx.monkLevel ?? 1;
        const deflectRoll = input.diceRoller.rollDie(10); // 1d10
        const totalReduction = deflectRoll.total + dexMod + monkLevel;
        damageApplied = Math.max(0, damageApplied - totalReduction);

        // Mark reaction as used
        const targetRes = normalizeResources(target.resources);
        await this.combat.updateCombatantState(target.id, {
          resources: { ...targetRes, reactionUsed: true } as JsonValue,
        });

        // Emit Deflect Attacks event
        if (this.events) {
          const targetName = await this.combatants.getName(attackData.target, target);
          await this.events.append(sessionId, {
            id: nanoid(),
            type: "DeflectAttacks",
            payload: {
              encounterId: encounter.id,
              deflectorId: target.id,
              deflectorName: targetName,
              deflectRoll: deflectRoll.total,
              dexMod,
              monkLevel,
              totalReduction,
              damageAfterReduction: damageApplied,
            } as JsonValue,
          });
        }

        // --- Deflect Attacks Ki Redirect (D&D 5e 2024) ---
        // If damage reduced to 0, monk can spend 1 Focus Point (ki) to make a
        // ranged Unarmed Strike (60 ft) against the attacker:
        //   Attack: d20 + DEX mod + proficiency bonus  vs  attacker AC
        //   Damage: 2 × Martial Arts die + DEX mod  (Force damage)
        if (damageApplied === 0 && input.diceRoller) {
          const { hasResourceAvailable, spendResourceFromPool } = await import("./helpers/resource-utils.js");
          // Re-read combatants to get fresh resources (we just set reactionUsed)
          const freshCombatants = await this.combat.listCombatants(encounter.id);
          const freshTarget = findCombatantStateByRef(freshCombatants, attackData.target);
          const currentResources = freshTarget?.resources ?? target.resources;

          if (hasResourceAvailable(currentResources, "ki", 1)) {
            // Spend 1 ki
            const updatedResources = spendResourceFromPool(currentResources, "ki", 1);
            await this.combat.updateCombatantState(target.id, {
              resources: updatedResources as JsonValue,
            });

            // Resolve redirect attack against the original attacker
            const attacker = findCombatantStateByRef(combatants, pendingAction.actor);
            if (attacker && attacker.hpCurrent > 0) {
              const profBonus = deflectCtx.proficiencyBonus ?? 2;
              const maDieSize = deflectCtx.martialArtsDieSize ?? 6;
              const attackModifier = dexMod + profBonus;

              // Roll attack: d20 + DEX mod + proficiency bonus
              const redirectAttackRoll = input.diceRoller.rollDie(20);
              const redirectTotal = redirectAttackRoll.total + attackModifier;

              // Get attacker's AC
              let attackerAC: number;
              try {
                const attackerStats = await this.combatants.getCombatStats(pendingAction.actor);
                attackerAC = attackerStats.armorClass;
              } catch {
                const attackerRes = normalizeResources(attacker.resources);
                attackerAC = typeof attackerRes.armorClass === "number" ? attackerRes.armorClass : 10;
              }

              const redirectHit = redirectTotal >= attackerAC;
              let redirectDamage = 0;

              if (redirectHit) {
                // 2 × Martial Arts die + DEX mod
                const die1 = input.diceRoller.rollDie(maDieSize);
                const die2 = input.diceRoller.rollDie(maDieSize);
                redirectDamage = die1.total + die2.total + dexMod;
                redirectDamage = Math.max(1, redirectDamage); // Minimum 1 damage

                // Apply damage to attacker
                const attackerHpAfter = Math.max(0, attacker.hpCurrent - redirectDamage);
                await this.combat.updateCombatantState(attacker.id, { hpCurrent: attackerHpAfter });

                // Apply KO effects if attacker dropped to 0 HP
                await applyKoEffectsIfNeeded(attacker, attacker.hpCurrent, attackerHpAfter, this.combat);

                // Emit redirect damage event
                if (this.events) {
                  const attackerName = await this.combatants.getName(pendingAction.actor, attacker);
                  await this.events.append(sessionId, {
                    id: nanoid(),
                    type: "DamageApplied",
                    payload: {
                      encounterId: encounter.id,
                      target: pendingAction.actor,
                      targetName: attackerName,
                      amount: redirectDamage,
                      hpCurrent: attackerHpAfter,
                      damageType: "force",
                      source: "DeflectAttacksRedirect",
                    } as JsonValue,
                  });
                }
              }

              // Emit redirect event
              if (this.events) {
                const deflectorName = await this.combatants.getName(attackData.target, target);
                const attackerName = await this.combatants.getName(pendingAction.actor, attacker);
                await this.events.append(sessionId, {
                  id: nanoid(),
                  type: "DeflectAttacksRedirect",
                  payload: {
                    encounterId: encounter.id,
                    deflectorId: target.id,
                    deflectorName,
                    targetId: attacker.id,
                    targetName: attackerName,
                    attackRoll: redirectTotal,
                    attackerAC,
                    hit: redirectHit,
                    damage: redirectDamage,
                    martialArtsDieSize: maDieSize,
                    dexMod,
                    proficiencyBonus: profBonus,
                  } as JsonValue,
                });
              }

              redirectResult = {
                hit: redirectHit,
                attackRoll: redirectTotal,
                targetAC: attackerAC,
                damage: redirectDamage,
              };
            }
          }
        }
      }

      if (damageApplied > 0) {
        const hpBefore = target.hpCurrent;
        const hpAfter = Math.max(0, hpBefore - damageApplied);
        await this.combat.updateCombatantState(target.id, { hpCurrent: hpAfter });

        // Apply KO effects if target dropped to 0 HP
        await applyKoEffectsIfNeeded(target, hpBefore, hpAfter, this.combat);

        // Emit damage event
        if (this.events) {
          const targetName = await this.combatants.getName(attackData.target, target);
          await this.events.append(sessionId, {
            id: nanoid(),
            type: "DamageApplied",
            payload: {
              encounterId: encounter.id,
              target: attackData.target,
              targetName,
              amount: damageApplied,
              hpCurrent: hpAfter,
            } as JsonValue,
          });
        }

        // Emit attack resolved event
        if (this.events) {
          await this.events.append(sessionId, {
            id: nanoid(),
            type: "AttackResolved",
            payload: {
              encounterId: encounter.id,
              attacker: pendingAction.actor,
              target: attackData.target,
              attackName: attackData.attackName,
              attackRoll: attackData.attackRoll,
              targetAC: finalAC,
              hit: true,
              critical: attackData.critical ?? false,
              damageApplied,
            } as JsonValue,
          });
        }
      }
    } else if (!hit) {
      // Emit attack miss event
      if (this.events) {
        await this.events.append(sessionId, {
          id: nanoid(),
          type: "AttackResolved",
          payload: {
            encounterId: encounter.id,
            attacker: pendingAction.actor,
            target: attackData.target,
            attackName: attackData.attackName,
            attackRoll: attackData.attackRoll,
            targetAC: finalAC,
            hit: false,
            critical: false,
            damageApplied: 0,
            shieldUsed,
          } as JsonValue,
        });
      }
    }

    // Mark as completed
    await this.pendingActions.markCompleted(input.pendingActionId);
    await this.pendingActions.delete(input.pendingActionId);

    // --- Damage reaction detection (Absorb Elements, Hellish Rebuke) ---
    // After damage is applied, check if target has a post-damage reaction available.
    // Shield/Deflect would have consumed the reaction already, so check fresh state.
    let damageReactionResult: { pendingActionId: string; reactionType: string } | undefined;
    if (hit && damageApplied > 0 && attackData.damageSpec?.damageType) {
      const freshCombatants = await this.combat.listCombatants(encounter.id);
      const freshTarget = findCombatantStateByRef(freshCombatants, attackData.target);
      if (freshTarget && freshTarget.hpCurrent > 0 && freshTarget.combatantType === "Character") {
        const freshResources = normalizeResources(freshTarget.resources);
        const stillHasReaction = hasReactionAvailable({ reactionUsed: false, ...freshResources } as any)
          && !readBoolean(freshResources, "reactionUsed");

        if (stillHasReaction) {
          try {
            const targetStats = await this.combatants.getCombatStats(attackData.target);
            const dmgInput = {
              className: targetStats.className?.toLowerCase() ?? "",
              level: targetStats.level ?? 1,
              abilityScores: (targetStats.abilityScores ?? {}) as Record<string, number>,
              resources: freshResources,
              hasReaction: true,
              isCharacter: true,
              damageType: attackData.damageSpec.damageType,
              damageAmount: damageApplied,
              attackerId: pendingAction.actor.type === "Monster"
                ? (pendingAction.actor as any).monsterId
                : (pendingAction.actor as any).characterId ?? "",
            };

            const dmgReactions = detectDamageReactions(dmgInput, getAllCombatTextProfiles());
            if (dmgReactions.length > 0) {
              const dr = dmgReactions[0]!;
              const drResult = await this.initiateDamageReaction(sessionId, {
                encounterId: encounter.id,
                target: attackData.target,
                attackerId: pendingAction.actor,
                damageType: attackData.damageSpec.damageType,
                damageAmount: damageApplied,
                detectedReaction: dr,
                targetCombatantId: freshTarget.id,
              });
              if (drResult.status === "awaiting_reactions") {
                damageReactionResult = {
                  pendingActionId: drResult.pendingActionId!,
                  reactionType: dr.reactionType,
                };
              }
            }
          } catch { /* skip damage reaction if stats unavailable */ }
        }
      }
    }

    return {
      hit,
      shieldUsed,
      finalAC,
      attackRoll: attackData.attackRoll,
      damageApplied,
      redirect: redirectResult,
      damageReaction: damageReactionResult,
    };
  }

  // ────────────────────────────────────────────────────────────
  // Damage Reaction Flow (Absorb Elements, Hellish Rebuke)
  // ────────────────────────────────────────────────────────────

  /**
   * Phase 1: Initiate a damage reaction after damage is applied.
   * Called internally by completeAttack() or externally by AI executor.
   */
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
      actor: input.attackerId, // actor is the attacker (who caused the damage)
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
      const encounter = await this.combat.getEncounterById(input.encounterId);
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
        actorName: targetName, // displayed as "your reaction"
        expiresAt: pendingAction.expiresAt.toISOString(),
      };

      await this.events.append(sessionId, {
        id: nanoid(),
        type: "ReactionPrompt",
        payload: payload as JsonValue,
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
      // Player declined
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
      // Absorb Elements: retroactive resistance — heal back half the triggering damage
      healBack = Math.floor(drData.damageAmount / 2);
      if (healBack > 0) {
        // Get max HP to cap healing
        const reactorResources = normalizeResources(reactorState.resources);
        const maxHp = typeof reactorResources.hpMax === "number" ? reactorResources.hpMax : reactorState.hpCurrent + healBack;
        const newHp = Math.min(maxHp, reactorState.hpCurrent + healBack);
        await this.combat.updateCombatantState(reactorState.id, { hpCurrent: newHp });
      }

      // Spend level 1 spell slot
      const slotToSpend = typeof opp.context.slotToSpend === "string" ? opp.context.slotToSpend : "spellSlot_1";
      const csResources = normalizeResources(reactorState.resources);
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

      // Emit Absorb Elements event
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
          } as JsonValue,
        });
      }
    } else if (reactionType === "hellish_rebuke") {
      // Hellish Rebuke: deal 2d10 fire damage to attacker (DEX save for half)
      const attacker = findCombatantStateByRef(combatants, drData.attackerId);
      if (attacker && attacker.hpCurrent > 0 && input.diceRoller) {
        // Compute spell save DC from context
        const spellSaveDC = typeof opp.context.spellSaveDC === "number" ? opp.context.spellSaveDC : 13;

        // Roll 2d10 fire damage
        const dmgRoll = input.diceRoller.rollDie(10, 2, 0);
        let totalDamage = Math.max(0, dmgRoll.total);

        // Attacker makes DEX save
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

        // Apply damage to attacker
        if (totalDamage > 0) {
          const attackerHpAfter = Math.max(0, attacker.hpCurrent - totalDamage);
          await this.combat.updateCombatantState(attacker.id, { hpCurrent: attackerHpAfter });

          // Apply KO effects if attacker dropped to 0 HP
          await applyKoEffectsIfNeeded(attacker, attacker.hpCurrent, attackerHpAfter, this.combat);

          // Emit damage event
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
              } as JsonValue,
            });
          }
        }
      }

      // Spend spell slot
      const slotToSpend = typeof opp.context.slotToSpend === "string" ? opp.context.slotToSpend : "spellSlot_1";
      const csResources = normalizeResources(reactorState.resources);
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

      // Emit Hellish Rebuke event
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
          } as JsonValue,
        });
      }
    }

    // Mark as completed
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

  // ── Private: on_voluntary_move trigger resolution ──

  /**
   * Check if the moving creature has ActiveEffects with triggerAt === 'on_voluntary_move'
   * (e.g. Booming Blade). Apply damage and remove the effects. Returns whether the creature
   * was KO'd (abort the move) and total damage dealt.
   *
   * Delegates to the generic movement-trigger-resolver which handles:
   * - Seeded dice (when deps provide rollD20 / rollDice)
   * - Real damage defenses (resistances, immunities, vulnerabilities)
   * - Saving throws (if triggerSave defined on the effect)
   * - Condition application (if triggerConditions defined on the effect)
   */
  private async applyVoluntaryMoveTriggers(
    actor: { id: string; hpCurrent: number; hpMax: number; resources?: unknown; characterId?: string | null; monsterId?: string | null; npcId?: string | null; combatantType?: string },
    encounterId: string,
  ): Promise<{ aborted: boolean; totalDamage: number; messages: string[] }> {
    const result = await resolveMovementTriggers(
      actor as any,
      {
        combatRepo: this.combat,
        // TODO: inject DiceRoller + getSaveModifier for full determinism
        // Currently falls back to average damage / auto-fail saves (same as zone-damage-resolver)
      },
    );
    return {
      aborted: result.aborted,
      totalDamage: result.totalDamage,
      messages: result.messages,
    };
  }
}
