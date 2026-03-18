/**
 * API routes for reaction system (opportunity attacks, counterspells, etc.)
 */

import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import type { PendingActionRepository } from "../../../application/repositories/pending-action-repository.js";
import type { IEventRepository, ReactionResolvedEventPayload } from "../../../application/repositories/event-repository.js";
import type { ICombatRepository } from "../../../application/repositories/combat-repository.js";
import type { ICombatantResolver } from "../../../application/services/combat/helpers/combatant-resolver.js";
import type { TwoPhaseActionService } from "../../../application/services/combat/two-phase-action-service.js";
import type { AiTurnOrchestrator } from "../../../application/services/combat/ai/ai-turn-orchestrator.js";
import type { DiceRoller } from "../../../domain/rules/dice-roller.js";
import { NotFoundError, ValidationError } from "../../../application/errors.js";
import type { JsonValue } from "../../../application/types.js";

export function registerReactionRoutes(
  app: FastifyInstance,
  deps: {
    pendingActions: PendingActionRepository;
    events: IEventRepository;
    combat: ICombatRepository;
    combatants: ICombatantResolver;
    twoPhaseActions: TwoPhaseActionService;
    aiOrchestrator: AiTurnOrchestrator;
    diceRoller?: DiceRoller;
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

    console.log(`[Reactions] ${choice} reaction (${pendingActionId.slice(0, 8)}…)`);

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

    // Get the encounter to obtain sessionId for event emission
    const encounter = await deps.combat.getEncounterById(encounterId);
    if (!encounter) {
      throw new NotFoundError(`Encounter not found: ${encounterId}`);
    }


    // Add response
    const response = {
      opportunityId,
      combatantId,
      choice,
      respondedAt: new Date(),
      result: undefined, // Will be filled in during completeMove/completeSpellCast
    };

    try {
      await deps.pendingActions.addReactionResponse(pendingActionId, response);

    } catch (err) {
      console.error("[Reactions] Failed to add response:", err);
      throw err;
    }

    // Emit event
    const combatantRef =
      opportunity.context.targetId ?
        { type: "Character" as const, characterId: combatantId } :
        { type: "Monster" as const, monsterId: combatantId };

    // Resolve combatant name from encounter roster
    const combatants = await deps.combat.listCombatants(encounterId);
    const combatantState = combatants.find(c =>
      (c.characterId === combatantId || c.monsterId === combatantId || c.npcId === combatantId)
    );
    const combatantName = combatantState
      ? await deps.combatants.getName(combatantRef, combatantState)
      : combatantId;

    const payload: ReactionResolvedEventPayload = {
      encounterId,
      pendingActionId,
      combatantId,
      combatantName,
      reactionType: opportunity.reactionType,
      choice,
    };

    await deps.events.append(encounter.sessionId, {
      id: nanoid(),
      type: "ReactionResolved",
      payload: payload as JsonValue,
    });

    // Check if all reactions are now resolved
    const status = await deps.pendingActions.getStatus(pendingActionId);

    // Auto-complete attack pending actions after all reactions are resolved
    if (status === "ready_to_complete" && pendingAction.type === "attack") {
      try {
        const completeResult = await deps.twoPhaseActions.completeAttack(
          encounter.sessionId,
          {
            pendingActionId,
            diceRoller: deps.diceRoller,
          },
        );
        console.log(`[Reactions] Attack resolved: hit=${completeResult.hit}, dmg=${completeResult.damageApplied ?? 0}${completeResult.redirect ? `, redirect: hit=${completeResult.redirect.hit}, dmg=${completeResult.redirect.damage}` : ""}`);

        // Check if a damage reaction is now pending (Absorb Elements, Hellish Rebuke)
        if (completeResult.damageReaction) {
          // Store the NEW damage reaction pending action on the encounter
          await deps.combat.setPendingAction(encounterId, {
            id: completeResult.damageReaction.pendingActionId,
            type: "reaction_pending",
            pendingActionId: completeResult.damageReaction.pendingActionId,
            reactionType: completeResult.damageReaction.reactionType,
          });

          return {
            success: true,
            pendingActionId: completeResult.damageReaction.pendingActionId,
            status: "awaiting_damage_reaction",
            message: `Damage reaction (${completeResult.damageReaction.reactionType}) available`,
            attackResult: completeResult,
          };
        }

        // Clear the pending action from the encounter
        await deps.combat.setPendingAction(encounterId, null as any);

        // Resume AI turns after Shield reaction is resolved
        try {
          await deps.aiOrchestrator.processAllMonsterTurns(encounter.sessionId, encounterId);
        } catch (resumeErr) {
          // Expected: AI turn may have ended naturally
        }

        const reactionLabel = opportunity.reactionType === "shield" ? "Shield spell" : opportunity.reactionType === "deflect_attacks" ? "Deflect Attacks" : "Reaction";
        return {
          success: true,
          pendingActionId,
          status: "completed",
          message: choice === "use" ? `${reactionLabel} used - attack resolved` : `${reactionLabel} declined - attack resolved`,
          attackResult: completeResult,
        };
      } catch (completeErr) {
        console.error("[Reactions] Failed to auto-complete attack:", completeErr);
        // Fall through to normal response
      }
    }

    // Auto-complete spell_cast pending actions after all Counterspell reactions are resolved
    if (status === "ready_to_complete" && pendingAction.type === "spell_cast") {
      try {
        const spellResult = await deps.twoPhaseActions.completeSpellCast(
          encounter.sessionId,
          {
            pendingActionId,
            diceRoller: deps.diceRoller,
          },
        );
        console.log(`[Reactions] Spell resolved: countered=${spellResult.wasCountered}`);

        // Clear the pending action from the encounter
        await deps.combat.setPendingAction(encounterId, null as any);

        // Resume AI turns after Counterspell reaction is resolved
        try {
          await deps.aiOrchestrator.processAllMonsterTurns(encounter.sessionId, encounterId);
        } catch (resumeErr) {
          // Expected: AI turn may have ended naturally
        }

        const wasCountered = spellResult.wasCountered;
        const spellName = (pendingAction.data as any)?.spellName ?? "spell";
        return {
          success: true,
          pendingActionId,
          status: "completed",
          message: wasCountered
            ? `${spellName} was countered by Counterspell!`
            : choice === "decline"
              ? `Counterspell declined - ${spellName} resolves`
              : `Counterspell attempted but failed - ${spellName} resolves`,
          spellCastResult: spellResult,
        };
      } catch (completeErr) {
        console.error("[Reactions] Failed to auto-complete spell cast:", completeErr);
        // Fall through to normal response
      }
    }

    // Auto-complete damage_reaction pending actions after all reactions are resolved
    if (status === "ready_to_complete" && pendingAction.type === "damage_reaction") {
      try {
        const drResult = await deps.twoPhaseActions.completeDamageReaction(
          encounter.sessionId,
          {
            pendingActionId,
            diceRoller: deps.diceRoller,
          },
        );
        console.log(`[Reactions] Damage reaction resolved: used=${drResult.used}, type=${drResult.reactionType}`);

        // Clear the pending action from the encounter
        await deps.combat.setPendingAction(encounterId, null as any);

        // Resume AI turns
        try {
          await deps.aiOrchestrator.processAllMonsterTurns(encounter.sessionId, encounterId);
        } catch (resumeErr) {
          // Expected: AI turn may have ended naturally
        }

        const reactionLabel = drResult.reactionType === "absorb_elements" ? "Absorb Elements" : drResult.reactionType === "hellish_rebuke" ? "Hellish Rebuke" : "Damage Reaction";
        return {
          success: true,
          pendingActionId,
          status: "completed",
          message: drResult.used ? `${reactionLabel} used` : `${reactionLabel} declined`,
          damageReactionResult: drResult,
        };
      } catch (completeErr) {
        console.error("[Reactions] Failed to auto-complete damage reaction:", completeErr);
        // Fall through to normal response
      }
    }

    // Auto-complete move pending actions after all reactions are resolved
    // This handles the case where a player DECLINES an opportunity attack —
    // without this, nobody calls completeMove and the AI turn never resumes.
    if (status === "ready_to_complete" && pendingAction.type === "move") {
      // Only auto-complete when there are NO player OAs that chose "use" (those need rolls via /combat/move/complete)
      const moveCombatants = await deps.combat.listCombatants(encounterId);
      const playerOAsUsed = pendingAction.resolvedReactions
        .filter((r: any) => r.choice === "use")
        .filter((r: any) => {
          const cs = moveCombatants.find(
            (c: any) => c.id === r.combatantId
          );
          return cs?.combatantType === "Character";
        });

      if (playerOAsUsed.length === 0) {
        try {
          const moveResult = await deps.twoPhaseActions.completeMove(
            encounter.sessionId,
            { pendingActionId },
          );
          console.log(`[Reactions] Move resolved`);

          // Clear the pending action from the encounter
          await deps.combat.setPendingAction(encounterId, null as any);

          // Resume AI turns after move completes
          try {
            await deps.aiOrchestrator.processAllMonsterTurns(encounter.sessionId, encounterId);
          } catch (resumeErr) {
            // Expected: AI turn may have ended naturally
          }

          return {
            success: true,
            pendingActionId,
            status: "completed",
            message: choice === "use" ? "Reaction used - movement resolved" : "Reaction declined - movement continues",
            moveResult,
          };
        } catch (completeErr) {
          console.error("[Reactions] Failed to auto-complete move:", completeErr);
          // Fall through to normal response
        }
      }
    }

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
      pendingActions: await Promise.all(pendingActions.map(async pa => ({
        id: pa.id,
        type: pa.type,
        actor: pa.actor,
        status: await deps.pendingActions.getStatus(pa.id),
        reactionOpportunities: pa.reactionOpportunities,
        resolvedReactions: pa.resolvedReactions,
        expiresAt: pa.expiresAt,
      }))),
    };
  });
}
