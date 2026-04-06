/**
 * AttackHandler — executes AI attack decisions.
 * Supports two-phase flow for Shield/Deflect Attacks reactions.
 */

import type { AiActionHandler, AiActionHandlerContext, AiActionHandlerDeps, AiHandlerResult } from "../ai-action-handler.js";
import { normalizeResources, hasResourceAvailable, getPosition } from "../../helpers/resource-utils.js";
import { hasReactionAvailable } from "../../../../../domain/rules/opportunity-attack.js";
import { calculateDistance } from "../../../../../domain/rules/movement.js";
import { AiAttackResolver } from "../ai-attack-resolver.js";
import type { ActorRef } from "../ai-types.js";

export class AttackHandler implements AiActionHandler {
  handles(action: string): boolean {
    return action === "attack";
  }

  async execute(ctx: AiActionHandlerContext, deps: AiActionHandlerDeps): Promise<AiHandlerResult> {
    const { sessionId, encounterId, aiCombatant, decision, allCombatants, actorRef } = ctx;
    const { actionService, twoPhaseActions, combat, pendingActions, combatantResolver, diceRoller, events, aiLog, executeBonusAction } = deps;

    aiLog("[AttackHandler] Executing attack action: " + JSON.stringify({ target: decision.target, attackName: decision.attackName }));

    if (!decision.target || !decision.attackName) {
      aiLog("[AttackHandler] Attack failed: missing parameters");
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Attack requires target and attackName",
        data: { reason: "missing_parameters" },
      };
    }

    if (!actorRef) {
      aiLog("[AttackHandler] Attack failed: invalid combatant reference");
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Invalid combatant reference",
        data: { reason: "invalid_combatant_reference" },
      };
    }

    const targetCombatant = await deps.findCombatantByName(decision.target, allCombatants);
    if (!targetCombatant) {
      aiLog("[AttackHandler] Attack failed: target not found: " + decision.target);
      return {
        action: decision.action,
        ok: false,
        summary: `Failed: Target ${decision.target} not found`,
        data: { reason: "target_not_found", target: decision.target },
      };
    }

    const targetRef = deps.toCombatantRef(targetCombatant);
    if (!targetRef) {
      aiLog("[AttackHandler] Attack failed: invalid target reference");
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Invalid target reference",
        data: { reason: "invalid_target_reference" },
      };
    }

    // ── Range validation ────────────────────────────────────────────
    const actorResources = normalizeResources(aiCombatant.resources);
    const actorPos = getPosition(actorResources);
    const targetPos = getPosition(normalizeResources(targetCombatant.resources));
    if (actorPos && targetPos) {
      const dist = calculateDistance(actorPos, targetPos);
      const allAttacks = await combatantResolver.getAttacks(actorRef);
      const desiredName = (decision.attackName ?? "").trim().toLowerCase();
      const chosenAttack = allAttacks.find(
        (a: any) => typeof a?.name === "string" && a.name.trim().toLowerCase() === desiredName,
      ) as Record<string, unknown> | undefined;
      const attackKindCheck: "melee" | "ranged" = (chosenAttack as any)?.kind === "ranged" ? "ranged" : "melee";

      if (attackKindCheck === "melee") {
        const reachValue = (chosenAttack as any)?.reach ?? (actorResources as any).reach;
        const reach = typeof reachValue === "number" ? reachValue : 5;
        if (dist > reach + 0.0001) {
          aiLog(`[AttackHandler] Melee attack out of reach: ${Math.round(dist)}ft > ${reach}ft`);
          return {
            action: decision.action,
            ok: false,
            summary: `Failed: Target is ${Math.round(dist)}ft away, but ${decision.attackName} has ${reach}ft reach. Move closer first.`,
            data: { reason: "out_of_reach", distance: Math.round(dist), reach },
          };
        }
      } else {
        const rangeObj = (chosenAttack as any)?.range;
        let maxRange = 600;
        if (typeof rangeObj === "string") {
          const parts = rangeObj.split("/").map(Number);
          if (parts.length >= 2 && !isNaN(parts[1]!)) maxRange = parts[1]!;
          else if (parts.length >= 1 && !isNaN(parts[0]!)) maxRange = parts[0]!;
        } else if (rangeObj && typeof rangeObj === "object") {
          maxRange = typeof rangeObj.long === "number" ? rangeObj.long
            : typeof rangeObj.max === "number" ? rangeObj.max
            : typeof rangeObj.normal === "number" ? rangeObj.normal
            : 600;
        }
        if (dist > maxRange + 0.0001) {
          aiLog(`[AttackHandler] Ranged attack out of range: ${Math.round(dist)}ft > ${maxRange}ft`);
          return {
            action: decision.action,
            ok: false,
            summary: `Failed: Target is ${Math.round(dist)}ft away, beyond ${decision.attackName}'s ${maxRange}ft range. Move closer first.`,
            data: { reason: "out_of_range", distance: Math.round(dist), maxRange },
          };
        }
      }
    }

    // ── Reaction detection ──────────────────────────────────────────
    const targetResources = normalizeResources(targetCombatant.resources);
    const targetHasShield = targetCombatant.combatantType === "Character"
      && targetResources.hasShieldPrepared === true
      && hasReactionAvailable({ reactionUsed: !!targetResources.reactionUsed } as any)
      && hasResourceAvailable(targetCombatant.resources, "spellSlot_1", 1);

    const targetHasDeflectReaction = targetCombatant.combatantType === "Character"
      && hasReactionAvailable({ reactionUsed: !!targetResources.reactionUsed } as any);

    if ((targetHasShield || targetHasDeflectReaction) && diceRoller) {
      aiLog("[AttackHandler] Target may have reactions (Shield/Deflect) - using two-phase attack flow");

      const monsterAttacks = await combatantResolver.getAttacks(actorRef);

      const attackOutcome = await new AiAttackResolver({
        combat,
        twoPhaseActions,
        pendingActions,
        combatantResolver,
        events,
        diceRoller,
        aiLog,
      }).resolve({
        sessionId, encounterId,
        aiCombatant, targetCombatant,
        actorRef, targetRef: targetRef as ActorRef,
        attackName: decision.attackName,
        monsterAttacks,
      });

      if (attackOutcome.status !== "not_applicable") {
        if (attackOutcome.status === "miss") {
          const bonusResult = await executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);
          const mainSummary = `Attack missed ${decision.target}`;
          const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;
          return {
            action: decision.action,
            ok: true,
            summary: fullSummary,
            data: { hit: false, damage: 0, target: decision.target, attackName: decision.attackName },
          };
        } else if (attackOutcome.status === "awaiting_reactions") {
          if (decision.bonusAction) {
            const currentRes = normalizeResources(aiCombatant.resources);
            await combat.updateCombatantState(aiCombatant.id, {
              resources: { ...currentRes, pendingBonusAction: decision.bonusAction } as any,
            });
          }
          return {
            action: decision.action,
            ok: true,
            summary: `Attack on ${decision.target} - awaiting player reaction`,
            data: {
              awaitingPlayerInput: true,
              pendingActionId: attackOutcome.pendingActionId,
              target: decision.target,
              attackName: decision.attackName,
              attackRoll: attackOutcome.attackTotal,
            },
          };
        } else if (attackOutcome.status === "awaiting_damage_reaction") {
          return {
            action: decision.action,
            ok: true,
            summary: `Attack hit ${decision.target} for ${attackOutcome.damageApplied} damage - awaiting damage reaction`,
            data: {
              awaitingPlayerInput: true,
              pendingActionId: attackOutcome.pendingActionId,
              hit: true,
              damage: attackOutcome.damageApplied,
              target: decision.target,
              attackName: decision.attackName,
            },
          };
        } else if (attackOutcome.status === "hit") {
          const bonusResult = await executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);
          const mainSummary = `Attack hit ${decision.target} for ${attackOutcome.damageApplied} damage`;
          const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;
          return {
            action: decision.action,
            ok: true,
            summary: fullSummary,
            data: { hit: true, damage: attackOutcome.damageApplied, target: decision.target, attackName: decision.attackName },
          };
        }
      }
    }

    // ── Normal flow ─────────────────────────────────────────────────
    aiLog("[AttackHandler] Calling actionService.attack... " + JSON.stringify({ attacker: actorRef, target: targetRef }));
    const result = await actionService.attack(sessionId, {
      encounterId,
      attacker: actorRef,
      target: targetRef as ActorRef,
      monsterAttackName: decision.attackName,
    });
    const hit = Boolean((result.result as Record<string, unknown>).hit);
    const damage = hit ? ((result.result as Record<string, unknown>).damage as Record<string, unknown>)?.applied ?? 0 : 0;

    aiLog("[AttackHandler] Attack completed: " + JSON.stringify({ hit, damage }));

    const bonusResult = await executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);
    const mainSummary = hit
      ? `Attack hit ${decision.target} for ${damage} damage`
      : `Attack missed ${decision.target}`;
    const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;

    return {
      action: decision.action,
      ok: true,
      summary: fullSummary,
      data: {
        hit,
        damage,
        target: decision.target,
        attackName: decision.attackName,
        ...(bonusResult ? { bonusAction: bonusResult } : {}),
      },
    };
  }
}
