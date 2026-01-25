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
  PendingAttackData
} from "../../../domain/entities/combat/pending-action.js";
import { 
  attemptMovement, 
  crossesThroughReach,
  calculateDistance,
  type MovementAttempt 
} from "../../../domain/rules/movement.js";
import { canMakeOpportunityAttack, hasReactionAvailable } from "../../../domain/rules/opportunity-attack.js";
import { resolveEncounterOrThrow } from "./helpers/encounter-resolver.js";
import { findCombatantStateByRef } from "./helpers/combatant-ref.js";
import { ValidationError, NotFoundError } from "../../errors.js";
import { 
  normalizeResources, 
  readBoolean, 
  getPosition 
} from "./helpers/resource-utils.js";
import type { JsonValue } from "../../types.js";

export interface InitiateMoveInput {
  encounterId?: string;
  actor: CombatantRef;
  destination: Position;
}

export interface InitiateMoveResult {
  status: "no_reactions" | "awaiting_reactions";
  pendingActionId?: string;
  opportunityAttacks: Array<{
    combatantId: string;
    combatantName: string;
    opportunityId?: string;
    canAttack: boolean;
    hasReaction: boolean;
  }>;
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

    // Get actor's speed
    const speedValue = resources.speed;
    const speed = typeof speedValue === "number" ? speedValue : 30;
    const hasDashed = readBoolean(resources, "dashed") ?? false;
    const effectiveSpeed = hasDashed ? speed * 2 : speed;

    // Validate movement
    const movementAttempt: MovementAttempt = {
      from: currentPos,
      to: input.destination,
      speed: effectiveSpeed,
    };

    const movementResult = attemptMovement(movementAttempt);
    if (!movementResult.success) {
      throw new ValidationError(movementResult.reason || "Movement not allowed");
    }

    // Calculate path (simple straight line for now)
    const path = [input.destination]; // TODO: Break into 5ft increments

    // Detect opportunity attacks
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

      const crossesReach = crossesThroughReach(
        { from: currentPos, to: input.destination },
        otherPos,
        reach,
      );

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

    // If no reactions possible, return immediately
    if (reactionOpportunities.length === 0) {
      return {
        status: "no_reactions",
        opportunityAttacks,
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
      
      if (!opp || opp.reactionType !== "opportunity_attack") continue;

      const attacker = combatants.find((c) => c.id === reaction.combatantId);
      if (!attacker || attacker.hpCurrent <= 0) continue;

      let hit = false;
      let totalDamage = 0;
      let attackRoll = 0;

      if (attacker.combatantType === "Character" && reaction.result?.attackRoll) {
        // Player OA - use stored roll results
        hit = reaction.result.hit ?? false;
        totalDamage = reaction.result.damageTotal ?? 0;
        attackRoll = reaction.result.attackTotal ?? 0;
      } else {
        // Monster/NPC OA - auto-roll
        // Get attacker stats for attack resolution
        const attackerStats = await this.combatants.getCombatStats(
          attacker.combatantType === "Character" && attacker.characterId ? { type: "Character", characterId: attacker.characterId } :
          attacker.combatantType === "Monster" && attacker.monsterId ? { type: "Monster", monsterId: attacker.monsterId } :
          attacker.combatantType === "NPC" && attacker.npcId ? { type: "NPC", npcId: attacker.npcId } :
          { type: "Character", characterId: "" }
        );

        // Simple OA attack: 1d20 + ability modifier vs target AC
        const strMod = Math.floor((attackerStats.abilityScores.strength - 10) / 2);
        const dexMod = Math.floor((attackerStats.abilityScores.dexterity - 10) / 2);
        const attackMod = Math.max(strMod, dexMod);
        
        const d20Roll = Math.floor(Math.random() * 20) + 1;
        attackRoll = d20Roll + attackMod;
        
        // Get target AC from resources or use default
        const actorResources = normalizeResources(actor.resources);
        const targetAC = typeof actorResources.armorClass === "number" ? actorResources.armorClass : 10;
        hit = attackRoll >= targetAC;

        if (hit) {
          // Roll damage: 1d8 + ability modifier (simple weapon)
          const damageRoll = Math.floor(Math.random() * 8) + 1;
          totalDamage = damageRoll + attackMod;
        }
      }

      if (hit && totalDamage > 0) {
        // Apply damage to moving creature
        const newHP = Math.max(0, actor.hpCurrent - totalDamage);
        await this.combat.updateCombatantState(actor.id, {
          hpCurrent: newHP,
        });

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
              critical: false, // TODO: Track critical hits
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

      // Mark reaction as used
      const attackerResources = normalizeResources(attacker.resources);
      await this.combat.updateCombatantState(attacker.id, {
        resources: { ...attackerResources, reactionUsed: true } as JsonValue,
      });
    }
    
    const resources = normalizeResources(actor.resources);
    const updatedResources = {
      ...resources,
      position: finalPosition, // Use finalPosition (might be moveData.from if died)
      movementSpent: true,
    };

    await this.combat.updateCombatantState(actor.id, {
      resources: updatedResources as JsonValue,
    });

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

      // TODO: Check if they have counterspell prepared and spell slots
      const hasCounterspell = false; // Placeholder
      const hasSpellSlot = false; // Placeholder

      if (hasReaction && hasCounterspell && hasSpellSlot) {
        const otherName = await this.combatants.getName(
          other.combatantType === "Character" && other.characterId ? { type: "Character", characterId: other.characterId } :
          other.combatantType === "Monster" && other.monsterId ? { type: "Monster", monsterId: other.monsterId } :
          other.combatantType === "NPC" && other.npcId ? { type: "NPC", npcId: other.npcId } :
          { type: "Character", characterId: "" },
          other
        );

        counterspellOpportunities.push({
          combatantId: other.id,
          combatantName: otherName,
          canUse: true,
          hasReaction,
          hasSpellSlot,
        });

        reactionOpportunities.push({
          id: nanoid(),
          combatantId: other.id,
          reactionType: "counterspell",
          canUse: true,
          context: {
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
  }): Promise<{
    wasCountered: boolean;
    counterspells: Array<{
      casterId: string;
      casterName: string;
      success: boolean;
    }>;
  }> {
    const pendingAction = await this.pendingActions.getById(input.pendingActionId);
    if (!pendingAction) {
      throw new NotFoundError(`Pending action not found: ${input.pendingActionId}`);
    }

    if (pendingAction.type !== "spell_cast") {
      throw new ValidationError("Pending action is not a spell cast");
    }

    // Check if any counterspells were used
    const counterspells = pendingAction.resolvedReactions
      .filter((r: ReactionResponse) => r.choice === "use")
      .map((r: ReactionResponse) => ({
        casterId: r.combatantId,
        casterName: "Unknown", // TODO: Look up name
        success: true, // TODO: Resolve counterspell check
      }));

    const wasCountered = counterspells.some((c: { casterId: string; casterName: string; success: boolean }) => c.success);

    // Mark as completed
    await this.pendingActions.markCompleted(input.pendingActionId);
    await this.pendingActions.delete(input.pendingActionId);

    return {
      wasCountered,
      counterspells,
    };
  }

  /**
   * Phase 1: Initiate attack, detect Shield reaction opportunities.
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

    // Get target AC
    const targetResources = normalizeResources(target.resources);
    const targetAC = typeof targetResources.armorClass === "number" ? targetResources.armorClass : 10;

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

    // Check if target can use Shield reaction
    const targetIsCharacter = target.combatantType === "Character";
    if (!targetIsCharacter) {
      // Only PCs get Shield for now
      return {
        status: "hit",
        attackRoll: input.attackRoll,
        targetAC,
        shieldOpportunities: [],
      };
    }

    const hasReaction = hasReactionAvailable({ reactionUsed: false, ...targetResources } as any);
    
    // TODO: Check if target has Shield spell prepared and spell slots
    const hasShield = false; // Placeholder
    const hasSpellSlot = false; // Placeholder

    const shieldOpportunities: Array<{
      combatantId: string;
      combatantName: string;
      canUse: boolean;
      hasReaction: boolean;
      hasSpellSlot: boolean;
      newAC?: number;
    }> = [];

    const reactionOpportunities: ReactionOpportunity[] = [];

    if (hasReaction && hasShield && hasSpellSlot) {
      const targetName = await this.combatants.getName(input.target, target);
      const newAC = targetAC + 5;

      shieldOpportunities.push({
        combatantId: target.id,
        combatantName: targetName,
        canUse: true,
        hasReaction,
        hasSpellSlot,
        newAC,
      });

      reactionOpportunities.push({
        id: nanoid(),
        combatantId: target.id,
        reactionType: "shield",
        canUse: true,
        context: {
          attackerId: actor.id,
          attackRoll: input.attackRoll,
          currentAC: targetAC,
          newAC,
        },
      });
    }

    // If no Shield opportunity, attack hits
    if (reactionOpportunities.length === 0) {
      return {
        status: "hit",
        attackRoll: input.attackRoll,
        targetAC,
        shieldOpportunities,
      };
    }

    // Create pending action for Shield reaction
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

    // Emit Shield reaction prompt
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
   * Phase 2: Complete attack after Shield resolution.
   */
  async completeAttack(sessionId: string, input: {
    pendingActionId: string;
  }): Promise<{
    hit: boolean;
    shieldUsed: boolean;
    finalAC: number;
    attackRoll: number;
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
      (r: ReactionResponse) => r.choice === "use"
    );

    const targetResources = normalizeResources(target.resources);
    let finalAC = typeof targetResources.armorClass === "number" ? targetResources.armorClass : 10;
    let shieldUsed = false;

    if (shieldReaction) {
      finalAC += 5;
      shieldUsed = true;

      // Mark reaction as used
      await this.combat.updateCombatantState(target.id, {
        resources: { ...targetResources, reactionUsed: true } as JsonValue,
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

    // Mark as completed
    await this.pendingActions.markCompleted(input.pendingActionId);
    await this.pendingActions.delete(input.pendingActionId);

    return {
      hit,
      shieldUsed,
      finalAC,
      attackRoll: attackData.attackRoll,
    };
  }
}
