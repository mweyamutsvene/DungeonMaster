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
  PendingSpellCastData 
} from "../../../domain/entities/combat/pending-action.js";
import { 
  attemptMovement, 
  crossesThroughReach,
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

        opportunityAttacks.push({
          combatantId: other.id,
          combatantName: otherName,
          canAttack: canAttack.canAttack,
          hasReaction,
        });

        if (canAttack.canAttack) {
          reactionOpportunities.push({
            id: nanoid(),
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

    // TODO: Execute opportunity attacks from resolvedReactions where choice === "use"
    // For now, just update position
    
    const resources = normalizeResources(actor.resources);
    const updatedResources = {
      ...resources,
      position: moveData.to,
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
          to: moveData.to,
          distanceMoved: Math.hypot(moveData.to.x - moveData.from.x, moveData.to.y - moveData.from.y) * 5,
        } as JsonValue,
      });
    }

    // Mark as completed and cleanup
    await this.pendingActions.markCompleted(input.pendingActionId);
    await this.pendingActions.delete(input.pendingActionId);

    return {
      movedFeet: Math.hypot(moveData.to.x - moveData.from.x, moveData.to.y - moveData.from.y) * 5,
      from: moveData.from,
      to: moveData.to,
      opportunityAttacks: [], // TODO: Return executed OAs
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
}
