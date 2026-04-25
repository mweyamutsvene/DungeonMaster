/**
 * Session Tabletop Routes
 *
 * Handles tabletop-style combat with manual dice rolling.
 *
 * Endpoints:
 * - POST /sessions/:id/combat/initiate - Initiate combat action, request initiative roll
 * - POST /sessions/:id/combat/roll-result - Process dice roll result
 * - POST /sessions/:id/combat/action - Parse combat action (move, attack, bonus action)
 * - POST /sessions/:id/combat/move/complete - Complete move after reaction resolution
 */

import type { FastifyInstance } from "fastify";
import type { SessionRouteDeps } from "./types.js";
import { ValidationError } from "../../../../application/errors.js";
import type { CombatantStateRecord, CombatEncounterRecord } from "../../../../application/types.js";
import type { DamagePendingAction, AttackPendingAction, SavingThrowPendingAction } from "../../../../application/services/combat/tabletop/tabletop-types.js";
import { detectDamageReactions } from "../../../../domain/entities/classes/combat-text-profile.js";
import { getAllCombatTextProfiles } from "../../../../domain/entities/classes/registry.js";
import {
  normalizeResources,
  readBoolean,
  removeActiveEffectById,
  spendResourceFromPool,
} from "../../../../application/services/combat/helpers/resource-utils.js";
import { hasReactionAvailable } from "../../../../domain/rules/opportunity-attack.js";
import { combatantRefFromState } from "../../../../application/services/combat/helpers/combatant-ref.js";
import type {
  PendingRollInterruptData,
  RollInterruptOption,
} from "../../../../domain/entities/combat/pending-action.js";

function findEncounterForTabletopRoll(encounters: CombatEncounterRecord[]): CombatEncounterRecord | null {
  return encounters.find((encounter) => encounter.status === "Pending" || encounter.status === "Active")
    ?? encounters[0]
    ?? null;
}

function isDamagePendingAction(value: unknown): value is DamagePendingAction {
  if (!value || typeof value !== "object") return false;
  const pending = value as Partial<DamagePendingAction>;
  return pending.type === "DAMAGE"
    && typeof pending.actorId === "string"
    && typeof pending.targetId === "string";
}

function findCombatantByEntityId(combatants: CombatantStateRecord[], entityId: string): CombatantStateRecord | undefined {
  return combatants.find((combatant) =>
    combatant.characterId === entityId || combatant.monsterId === entityId || combatant.npcId === entityId,
  );
}

async function tryInitiateDamageReaction(
  deps: SessionRouteDeps,
  sessionId: string,
  encounterId: string,
  pendingDamage: DamagePendingAction,
  rollResult: unknown,
): Promise<{ pendingActionId: string; reactionType: string } | null> {
  const totalDamage = typeof (rollResult as { totalDamage?: unknown })?.totalDamage === "number"
    ? (rollResult as { totalDamage: number }).totalDamage
    : 0;
  if (totalDamage <= 0) return null;

  const combatEnded = (rollResult as { combatEnded?: unknown })?.combatEnded;
  if (combatEnded === true) return null;

  const damageType = pendingDamage.weaponSpec?.damageType;
  if (typeof damageType !== "string" || damageType.trim().length === 0) return null;

  const encounter = await deps.combatRepo.getEncounterById(encounterId);
  if (!encounter || encounter.status !== "Active") return null;

  // With queue semantics: a multi-attack follow-up ATTACK in the queue is expected and
  // should NOT block a damage reaction. Only bail if the head is a non-ATTACK action
  // (which would indicate an unusual concurrent state, e.g., another pending reaction).
  const headAfterRoll = await deps.combatRepo.getPendingAction(encounterId);
  if (headAfterRoll && (headAfterRoll as Record<string, unknown>).type !== "ATTACK") return null;

  const combatants = await deps.combatRepo.listCombatants(encounterId);
  const targetCombatant = findCombatantByEntityId(combatants, pendingDamage.targetId);
  if (!targetCombatant || targetCombatant.combatantType !== "Character" || !targetCombatant.characterId) {
    return null;
  }
  if (targetCombatant.hpCurrent <= 0) return null;

  const attackerCombatant = findCombatantByEntityId(combatants, pendingDamage.actorId);
  if (!attackerCombatant) return null;

  const targetRef = combatantRefFromState(targetCombatant);
  const attackerRef = combatantRefFromState(attackerCombatant);
  if (!targetRef || targetRef.type !== "Character" || !attackerRef) return null;

  const targetResources = normalizeResources(targetCombatant.resources);
  const stillHasReaction = hasReactionAvailable({ reactionUsed: false, ...targetResources } as any)
    && !readBoolean(targetResources, "reactionUsed");
  if (!stillHasReaction) return null;

  let targetStats: { className?: string; level?: number; abilityScores?: Record<string, number> };
  try {
    targetStats = await deps.combatants.getCombatStats(targetRef);
  } catch {
    const targetCharacter = await deps.charactersRepo.getById(targetRef.characterId);
    if (!targetCharacter) return null;

    const sheet = (targetCharacter.sheet ?? {}) as Record<string, unknown>;
    const rawAbilityScores = (sheet.abilityScores ?? {}) as Record<string, unknown>;
    const fallbackAbilityScores: Record<string, number> = {};
    for (const [ability, value] of Object.entries(rawAbilityScores)) {
      if (typeof value === "number") {
        fallbackAbilityScores[ability] = value;
      }
    }

    targetStats = {
      className:
        targetCharacter.className
        ?? (typeof sheet.className === "string" ? sheet.className : undefined)
        ?? "",
      level:
        targetCharacter.level
        ?? (typeof sheet.level === "number" ? sheet.level : undefined)
        ?? 1,
      abilityScores: fallbackAbilityScores,
    };
  }

  const attackerEntityId = attackerRef.type === "Character"
    ? attackerRef.characterId
    : attackerRef.type === "Monster"
      ? attackerRef.monsterId
      : attackerRef.npcId;

  const detectedReactions = detectDamageReactions(
    {
      className: targetStats.className?.toLowerCase() ?? "",
      level: targetStats.level ?? 1,
      abilityScores: (targetStats.abilityScores ?? {}) as Record<string, number>,
      resources: targetResources,
      hasReaction: true,
      isCharacter: true,
      damageType,
      damageAmount: totalDamage,
      attackerId: attackerEntityId,
    },
    getAllCombatTextProfiles(),
  );

  if (detectedReactions.length === 0) return null;

  const detectedReaction = detectedReactions[0]!;
  const initiateResult = await deps.twoPhaseActions.initiateDamageReaction(sessionId, {
    encounterId,
    target: targetRef,
    attackerId: attackerRef,
    damageType,
    damageAmount: totalDamage,
    detectedReaction,
    targetCombatantId: targetCombatant.id,
  });

  if (initiateResult.status !== "awaiting_reactions" || !initiateResult.pendingActionId) {
    return null;
  }

  // With queue semantics: reaction_pending must be at HEAD so it's resolved before any
  // queued follow-up attack (e.g., Extra Attack, Flurry strike 2). Read and save any
  // queued follow-up, clear it, push reaction_pending first, then re-push the follow-up.
  const queuedFollowUp = await deps.combatRepo.getPendingAction(encounterId);
  if (queuedFollowUp) {
    await deps.combatRepo.clearPendingAction(encounterId);
  }
  await deps.combatRepo.setPendingAction(encounterId, {
    id: initiateResult.pendingActionId,
    type: "reaction_pending",
    pendingActionId: initiateResult.pendingActionId,
    reactionType: detectedReaction.reactionType,
    target: targetRef,
  });
  if (queuedFollowUp) {
    await deps.combatRepo.setPendingAction(encounterId, queuedFollowUp);
  }

  return {
    pendingActionId: initiateResult.pendingActionId,
    reactionType: detectedReaction.reactionType,
  };
}

export function registerSessionTabletopRoutes(app: FastifyInstance, deps: SessionRouteDeps): void {

  /**
   * POST /sessions/:id/combat/initiate
   * Start a tabletop combat flow by parsing intent and requesting initiative roll.
   */
  app.post<{
    Params: { id: string };
    Body: { text: string; actorId: string };
  }>("/sessions/:id/combat/initiate", async (req) => {
    if (!deps.intentParser) {
      throw new ValidationError("LLM intent parser is not configured");
    }

    const sessionId = req.params.id;
    const { text, actorId } = req.body;

    if (!text || typeof text !== "string") {
      throw new ValidationError("text is required");
    }
    if (!actorId || typeof actorId !== "string") {
      throw new ValidationError("actorId is required");
    }

    console.log(`[CLI → initiate] "${text}"`);

    // Sweep expired items (e.g. Goodberry berries whose longRestsRemaining === 0)
    // from every session character's sheet BEFORE the encounter is built, so
    // combatant.resources.inventory reflects the cleaned state once initiative
    // is submitted and hydration runs.
    const sessionChars = await deps.charactersRepo.listBySession(sessionId);
    const sessionCharIds = sessionChars.map((c) => c.id);
    if (sessionCharIds.length > 0) {
      await deps.inventoryService.sweepExpiredItems(sessionId, sessionCharIds);
    }

    return deps.tabletopCombat.initiateAction(sessionId, text, actorId);
  });

  /**
   * POST /sessions/:id/combat/roll-result
   * Process a dice roll result (initiative, attack, or damage).
   */
  app.post<{
    Params: { id: string };
    Body: { text: string; actorId: string };
  }>("/sessions/:id/combat/roll-result", async (req) => {
    try {
      const sessionId = req.params.id;
      const { text, actorId } = req.body;

      if (!text || typeof text !== "string") {
        throw new ValidationError("text is required");
      }
      if (!actorId || typeof actorId !== "string") {
        throw new ValidationError("actorId is required");
      }

      const encounters = await deps.combatRepo.listEncountersBySession(sessionId);
      const encounter = findEncounterForTabletopRoll(encounters);
      const pendingBeforeRoll = encounter
        ? await deps.combatRepo.getPendingAction(encounter.id)
        : null;

      console.log(`[CLI → roll] "${text}"`);
      const rollResult = await deps.tabletopCombat.processRollResult(sessionId, text, actorId);

      if (encounter && isDamagePendingAction(pendingBeforeRoll)) {
        const damageReaction = await tryInitiateDamageReaction(
          deps,
          sessionId,
          encounter.id,
          pendingBeforeRoll,
          rollResult,
        );
        if (damageReaction) {
          return {
            ...(rollResult as unknown as Record<string, unknown>),
            damageReaction,
          };
        }
      }

      return rollResult;
    } catch (err) {
      console.error("Roll result endpoint error:", err);
      console.error("Stack:", (err as Error).stack);
      req.log.error({ err, stack: (err as Error).stack }, "Roll result endpoint error");
      throw err;
    }
  });

  /**
   * POST /sessions/:id/combat/action
   * Parse and execute a combat action (move, attack, bonus action).
   */
  app.post<{
    Params: { id: string };
    Body: { text: string; actorId: string; encounterId: string };
  }>("/sessions/:id/combat/action", async (req) => {
    const sessionId = req.params.id;
    const { text, actorId, encounterId } = req.body;

    if (!text || typeof text !== "string") {
      throw new ValidationError("text is required");
    }
    if (!actorId || typeof actorId !== "string") {
      throw new ValidationError("actorId is required");
    }
    if (!encounterId || typeof encounterId !== "string") {
      throw new ValidationError("encounterId is required");
    }

    console.log(`[CLI → action] "${text}"`);
    return deps.tabletopCombat.parseCombatAction(sessionId, text, actorId, encounterId);
  });

  /**
   * POST /sessions/:id/combat/move/complete
   * Complete a move after reaction resolution (opportunity attacks).
   * Accepts optional roll data for player opportunity attacks.
   */
  app.post<{
    Params: { id: string };
    Body: { pendingActionId: string; roll?: number; rollType?: string };
  }>("/sessions/:id/combat/move/complete", async (req) => {
    const sessionId = req.params.id;
    await deps.sessions.getSessionOrThrow(sessionId);

    const pendingActionId = req.body?.pendingActionId;
    if (!pendingActionId || typeof pendingActionId !== "string") {
      throw new ValidationError("pendingActionId is required");
    }

    const roll = typeof req.body?.roll === "number" ? req.body.roll : undefined;
    const rollType = typeof req.body?.rollType === "string" ? req.body.rollType : undefined;

    return deps.tabletopCombat.completeMove(sessionId, pendingActionId, roll, rollType);
  });

  /**
   * POST /sessions/:id/combat/:encounterId/pending-roll-interrupt/resolve
   *
   * Resolves a paused d20 roll interrupt (Bardic Inspiration, Lucky feat,
   * Halfling Lucky, Portent, Cutting Words, etc.).
   *
   * Body:
   *   actorId  — entity ID of the actor who rolled
   *   choice   — "decline"
   *            | { kind: "bardic-inspiration" }
   *            | { kind: "lucky-feat" }
   *            | { kind: "halfling-lucky" }
   *            | { kind: "portent"; portentEffectId: string }
   *
   * The handler reads the `roll_interrupt` blob from the encounter's
   * pendingAction slot, applies the choice, then calls processRollResult
   * to continue with normal hit/miss logic via `interruptResolved = true`.
   */
  app.post<{
    Params: { id: string; encounterId: string };
    Body: {
      actorId: string;
      choice: "decline" | { kind: RollInterruptOption["kind"]; [k: string]: unknown };
    };
  }>("/sessions/:id/combat/:encounterId/pending-roll-interrupt/resolve", async (req) => {
    const sessionId = req.params.id;
    const { encounterId } = req.params;
    const { actorId, choice } = req.body;

    if (!actorId || typeof actorId !== "string") throw new ValidationError("actorId is required");
    if (!choice) throw new ValidationError("choice is required");

    // Read interrupt state
    const rawPending = await deps.combatRepo.getPendingAction(encounterId);
    if (!rawPending || (rawPending as Record<string, unknown>).type !== "roll_interrupt") {
      throw new ValidationError("No roll interrupt pending for this encounter");
    }
    const interruptData = rawPending as unknown as PendingRollInterruptData;

    // ── Save interrupt resume path ──────────────────────────────────────────
    if (interruptData.resumeContext.kind === "save") {
      const saveCtx = interruptData.resumeContext;
      const originalSaveAction = saveCtx.originalSaveAction as unknown as SavingThrowPendingAction;
      const rawD20 = interruptData.rawRoll[0] ?? 1;

      let interruptForcedRoll: number | undefined = rawD20; // default: keep original d20
      let interruptBonusAdjustment: number | undefined;

      if (choice === "decline") {
        // Use original d20, no bonus
      } else if (choice.kind === "bardic-inspiration") {
        const biOption = interruptData.options.find(
          o => o.kind === "bardic-inspiration" && (!(choice as any).effectId || o.effectId === (choice as any).effectId),
        ) as Extract<RollInterruptOption, { kind: "bardic-inspiration" }> | undefined;
        if (!biOption) throw new ValidationError("Bardic Inspiration option not found in interrupt");
        if (!deps.diceRoller) throw new ValidationError("DiceRoller not available");

        const biRoll = deps.diceRoller.rollDie(biOption.sides).total;
        interruptBonusAdjustment = biRoll;

        const combatants = await deps.combatRepo.listCombatants(encounterId);
        const actorCombatant = combatants.find(
          c => c.characterId === actorId || c.monsterId === actorId || c.npcId === actorId,
        );
        if (actorCombatant) {
          const updatedResources = removeActiveEffectById(actorCombatant.resources ?? {}, biOption.effectId);
          await deps.combatRepo.updateCombatantState(actorCombatant.id, { resources: updatedResources as any });
        }
        console.log(`[roll-interrupt] Save BI used: +${biRoll} (1d${biOption.sides})`);

      } else if (choice.kind === "lucky-feat") {
        if (!deps.diceRoller) throw new ValidationError("DiceRoller not available");
        const newRoll = deps.diceRoller.d20().total;
        interruptForcedRoll = newRoll;

        const combatants = await deps.combatRepo.listCombatants(encounterId);
        const actorCombatant = combatants.find(
          c => c.characterId === actorId || c.monsterId === actorId || c.npcId === actorId,
        );
        if (actorCombatant) {
          const res = normalizeResources(actorCombatant.resources);
          const updated = spendResourceFromPool(res, "luckPoints", 1);
          await deps.combatRepo.updateCombatantState(actorCombatant.id, { resources: updated as any });
        }
        console.log(`[roll-interrupt] Save Lucky feat: rerolled d20 → ${newRoll}`);

      } else if (choice.kind === "halfling-lucky") {
        if (!deps.diceRoller) throw new ValidationError("DiceRoller not available");
        const newRoll = deps.diceRoller.d20().total;
        interruptForcedRoll = newRoll;
        console.log(`[roll-interrupt] Save Halfling Lucky: rerolled nat-1 → ${newRoll}`);

      } else if (choice.kind === "portent") {
        const portentOption = interruptData.options.find(
          o => o.kind === "portent" && o.portentEffectId === (choice as any).portentEffectId,
        ) as Extract<RollInterruptOption, { kind: "portent" }> | undefined;
        if (!portentOption) throw new ValidationError("Portent option not found");
        interruptForcedRoll = portentOption.valueRolled;

        const combatants = await deps.combatRepo.listCombatants(encounterId);
        const actorCombatant = combatants.find(
          c => c.characterId === actorId || c.monsterId === actorId || c.npcId === actorId,
        );
        if (actorCombatant) {
          const updatedResources = removeActiveEffectById(actorCombatant.resources ?? {}, portentOption.portentEffectId);
          await deps.combatRepo.updateCombatantState(actorCombatant.id, { resources: updatedResources as any });
        }
        console.log(`[roll-interrupt] Save Portent used: replacing d20 with ${portentOption.valueRolled}`);

      } else {
        throw new ValidationError(`Unknown interrupt choice kind: ${(choice as any).kind}`);
      }

      const resolvedSaveAction: SavingThrowPendingAction = {
        ...originalSaveAction,
        interruptResolved: true,
        ...(interruptForcedRoll !== undefined ? { interruptForcedRoll } : {}),
        ...(interruptBonusAdjustment !== undefined ? { interruptBonusAdjustment } : {}),
      };
      await deps.combatRepo.clearPendingAction(encounterId);
      await deps.combatRepo.setPendingAction(encounterId, resolvedSaveAction);
      // SAVING_THROW is in SKIP_ROLL_PARSE — roll text is ignored; handler reads from pending action
      return deps.tabletopCombat.processRollResult(sessionId, "resolved", actorId);
    }

    if ((interruptData.resumeContext as { kind: string }).kind !== "attack") {
      throw new ValidationError(`Unsupported roll interrupt kind: ${(interruptData.resumeContext as { kind: string }).kind}`);
    }

    const ctx = interruptData.resumeContext;
    const originalAction = ctx.originalAttackAction as unknown as AttackPendingAction;

    // Build the modified action that re-enters handleAttackRoll with resolved state
    let interruptForcedRoll: number | undefined;
    let interruptBonusAdjustment: number | undefined;

    if (choice === "decline") {
      // Nothing changes — re-run with original roll
    } else if (choice.kind === "bardic-inspiration") {
      // Find which option was chosen (the one with the matching effectId if supplied)
      const biOption = interruptData.options.find(
        o => o.kind === "bardic-inspiration" && (!(choice as any).effectId || o.effectId === (choice as any).effectId),
      ) as Extract<RollInterruptOption, { kind: "bardic-inspiration" }> | undefined;

      if (!biOption) throw new ValidationError("Bardic Inspiration option not found in interrupt");
      if (!deps.diceRoller) throw new ValidationError("DiceRoller not available — cannot roll BI die");

      const biRoll = deps.diceRoller.rollDie(biOption.sides).total;
      interruptBonusAdjustment = biRoll;

      // Consume the Bardic Inspiration effect from the actor's combatant resources
      const combatants = await deps.combatRepo.listCombatants(encounterId);
      const actorCombatant = combatants.find(
        c => c.characterId === actorId || c.monsterId === actorId || c.npcId === actorId,
      );
      if (actorCombatant) {
        const updatedResources = removeActiveEffectById(
          actorCombatant.resources ?? {},
          biOption.effectId,
        );
        await deps.combatRepo.updateCombatantState(actorCombatant.id, {
          resources: updatedResources as any,
        });
      }

      console.log(`[roll-interrupt] Bardic Inspiration used: +${biRoll} (1d${biOption.sides})`);

    } else if (choice.kind === "lucky-feat") {
      if (!deps.diceRoller) throw new ValidationError("DiceRoller not available — cannot reroll");

      const newRoll = deps.diceRoller.d20().total;
      interruptForcedRoll = newRoll;

      // Spend 1 luck point
      const combatants = await deps.combatRepo.listCombatants(encounterId);
      const actorCombatant = combatants.find(
        c => c.characterId === actorId || c.monsterId === actorId || c.npcId === actorId,
      );
      if (actorCombatant) {
        const res = normalizeResources(actorCombatant.resources);
        const updated = spendResourceFromPool(res, "luckPoints", 1);
        await deps.combatRepo.updateCombatantState(actorCombatant.id, {
          resources: updated as any,
        });
      }

      console.log(`[roll-interrupt] Lucky feat used: rerolled d20 → ${newRoll}`);

    } else if (choice.kind === "halfling-lucky") {
      if (!deps.diceRoller) throw new ValidationError("DiceRoller not available — cannot reroll");

      const newRoll = deps.diceRoller.d20().total;
      interruptForcedRoll = newRoll;
      console.log(`[roll-interrupt] Halfling Lucky used: rerolled nat-1 → ${newRoll}`);

    } else if (choice.kind === "portent") {
      const portentOption = interruptData.options.find(
        o => o.kind === "portent" && o.portentEffectId === (choice as any).portentEffectId,
      ) as Extract<RollInterruptOption, { kind: "portent" }> | undefined;

      if (!portentOption) throw new ValidationError("Portent option not found");
      interruptForcedRoll = portentOption.valueRolled;

      // Consume the portent effect
      const combatants = await deps.combatRepo.listCombatants(encounterId);
      const actorCombatant = combatants.find(
        c => c.characterId === actorId || c.monsterId === actorId || c.npcId === actorId,
      );
      if (actorCombatant) {
        const updatedResources = removeActiveEffectById(
          actorCombatant.resources ?? {},
          portentOption.portentEffectId,
        );
        await deps.combatRepo.updateCombatantState(actorCombatant.id, {
          resources: updatedResources as any,
        });
      }
      console.log(`[roll-interrupt] Portent used: replacing d20 with ${portentOption.valueRolled}`);

    } else {
      throw new ValidationError(`Unknown interrupt choice kind: ${(choice as any).kind}`);
    }

    // Reconstruct the attack pending action with interrupt-resolution flags and restore it
    const resolvedAction: AttackPendingAction = {
      ...originalAction,
      interruptResolved: true,
      ...(interruptBonusAdjustment !== undefined ? { interruptBonusAdjustment } : {}),
      ...(interruptForcedRoll !== undefined ? { interruptForcedRoll } : {}),
    };

    await deps.combatRepo.clearPendingAction(encounterId);
    await deps.combatRepo.setPendingAction(encounterId, resolvedAction);

    // Re-submit the original d20 roll through processRollResult.
    // handleAttackRoll will skip the interrupt check (interruptResolved=true)
    // and apply the bonus/forced-roll overrides set above.
    const originalD20 = interruptData.rawRoll[0] ?? 1;
    const rollText = `rolled ${originalD20}`;
    return deps.tabletopCombat.processRollResult(sessionId, rollText, actorId);
  });
}
