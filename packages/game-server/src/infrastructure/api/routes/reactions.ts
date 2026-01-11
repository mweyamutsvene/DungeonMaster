/**
 * API routes for reaction system (opportunity attacks, counterspells, etc.)
 */

import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import type { PendingActionRepository } from "../../../application/repositories/pending-action-repository.js";
import type { IEventRepository, ReactionResolvedEventPayload } from "../../../application/repositories/event-repository.js";
import type { ICombatantResolver } from "../../../application/services/combat/helpers/combatant-resolver.js";
import { NotFoundError, ValidationError } from "../../../application/errors.js";
import type { JsonValue } from "../../../application/types.js";

export function registerReactionRoutes(
  app: FastifyInstance,
  deps: {
    pendingActions: PendingActionRepository;
    events: IEventRepository;
    combatants: ICombatantResolver;
  },
): void {
  /**
   * POST /encounters/:encounterId/reactions/:pendingActionId/respond
   * 
   * Player responds to a reaction prompt.
   */
  app.post<{
    Params: { encounterId: string; pendingActionId: string };
    Body: {
      combatantId: string;
      opportunityId: string;
      choice: "use" | "decline";
    };
  }>("/encounters/:encounterId/reactions/:pendingActionId/respond", async (req, reply) => {
    const { encounterId, pendingActionId } = req.params;
    const { combatantId, opportunityId, choice } = req.body;

    if (!combatantId || !opportunityId) {
      throw new ValidationError("combatantId and opportunityId are required");
    }

    if (choice !== "use" && choice !== "decline") {
      throw new ValidationError("choice must be 'use' or 'decline'");
    }

    // Get pending action
    const pendingAction = await deps.pendingActions.getById(pendingActionId);
    if (!pendingAction) {
      throw new NotFoundError(`Pending action not found: ${pendingActionId}`);
    }

    if (pendingAction.encounterId !== encounterId) {
      throw new ValidationError("Encounter ID mismatch");
    }

    // Verify this opportunity exists
    const opportunity = pendingAction.reactionOpportunities.find((o: any) => o.id === opportunityId);
    if (!opportunity) {
      throw new NotFoundError(`Reaction opportunity not found: ${opportunityId}`);
    }

    if (opportunity.combatantId !== combatantId) {
      throw new ValidationError("Combatant ID does not match opportunity");
    }

    // Check if already responded
    const alreadyResponded = pendingAction.resolvedReactions.some(
      (r: any) => r.opportunityId === opportunityId
    );
    if (alreadyResponded) {
      throw new ValidationError("Already responded to this reaction opportunity");
    }

    // Add response
    const response = {
      opportunityId,
      combatantId,
      choice,
      respondedAt: new Date(),
      result: undefined, // Will be filled in during completeMove/completeSpellCast
    };

    await deps.pendingActions.addReactionResponse(pendingActionId, response);

    // Emit event
    const combatantRef =
      opportunity.context.targetId ?
        { type: "Character" as const, characterId: combatantId } :
        { type: "Monster" as const, monsterId: combatantId };

    // TODO: Get actual combatant state to resolve name properly
    const combatantName = combatantId; // Placeholder

    const payload: ReactionResolvedEventPayload = {
      encounterId,
      pendingActionId,
      combatantId,
      combatantName,
      reactionType: opportunity.reactionType,
      choice,
    };

    await deps.events.append("session", { // TODO: Get actual sessionId
      id: nanoid(),
      type: "ReactionResolved",
      payload: payload as JsonValue,
    });

    // Check if all reactions are now resolved
    const status = await deps.pendingActions.getStatus(pendingActionId);

    return {
      success: true,
      pendingActionId,
      status,
      message: choice === "use" ? "Reaction will be executed" : "Reaction declined",
    };
  });

  /**
   * GET /encounters/:encounterId/reactions/:pendingActionId
   * 
   * Get status of a pending action.
   */
  app.get<{
    Params: { encounterId: string; pendingActionId: string };
  }>("/encounters/:encounterId/reactions/:pendingActionId", async (req, reply) => {
    const { encounterId, pendingActionId } = req.params;

    const pendingAction = await deps.pendingActions.getById(pendingActionId);
    if (!pendingAction) {
      throw new NotFoundError(`Pending action not found: ${pendingActionId}`);
    }

    if (pendingAction.encounterId !== encounterId) {
      throw new ValidationError("Encounter ID mismatch");
    }

    const status = await deps.pendingActions.getStatus(pendingActionId);

    return {
      pendingAction: {
        id: pendingAction.id,
        type: pendingAction.type,
        actor: pendingAction.actor,
        status,
        reactionOpportunities: pendingAction.reactionOpportunities,
        resolvedReactions: pendingAction.resolvedReactions,
        expiresAt: pendingAction.expiresAt,
      },
    };
  });

  /**
   * GET /encounters/:encounterId/reactions
   * 
   * List all pending reactions for an encounter.
   */
  app.get<{
    Params: { encounterId: string };
  }>("/encounters/:encounterId/reactions", async (req, reply) => {
    const { encounterId } = req.params;

    const pendingActions = await deps.pendingActions.listByEncounter(encounterId);

    return {
      pendingActions: pendingActions.map(pa => ({
        id: pa.id,
        type: pa.type,
        actor: pa.actor,
        status: "awaiting_reactions", // TODO: Get actual status
        reactionOpportunities: pa.reactionOpportunities,
        resolvedReactions: pa.resolvedReactions,
        expiresAt: pa.expiresAt,
      })),
    };
  });
}
