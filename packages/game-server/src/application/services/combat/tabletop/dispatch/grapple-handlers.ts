/**
 * GrappleHandlers — shove, grapple, and escape-grapple action handlers.
 *
 * Extracted from ActionDispatcher (Phase: God-Module Decomposition §2.2).
 */

import { ValidationError } from "../../../../errors.js";
import { inferActorRef, findCombatantByName } from "../combat-text-parser.js";
import type { TabletopEventEmitter } from "../tabletop-event-emitter.js";
import type { TabletopCombatServiceDeps, ActionParseResult } from "../tabletop-types.js";
import type { LlmRoster } from "../../../../commands/game-command.js";
import { hasSpentAction } from "../../helpers/resource-utils.js";

export class GrappleHandlers {
  constructor(
    private readonly deps: TabletopCombatServiceDeps,
    private readonly eventEmitter: TabletopEventEmitter,
    private readonly debugLogsEnabled: boolean,
  ) {}

  /**
   * Handle Shove action – contested athletics check to push or knock prone.
   */
  async handleShoveAction(
    sessionId: string,
    encounterId: string,
    actorId: string,
    shoveInfo: { targetName: string; shoveType: "push" | "prone" },
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    const actor = inferActorRef(actorId, roster);

    const targetRef = findCombatantByName(shoveInfo.targetName, roster);
    if (!targetRef) {
      throw new ValidationError(`Could not find target: ${shoveInfo.targetName}`);
    }

    const encounter = await this.deps.combatRepo.getEncounterById(encounterId);
    const shoveSeed = (encounter?.round ?? 1) * 1000 + (encounter?.turn ?? 0) * 10 + 1;

    const result = await this.deps.actions.shove(sessionId, {
      encounterId,
      actor,
      target: targetRef,
      shoveType: shoveInfo.shoveType,
      seed: shoveSeed,
    });

    const outcome = result.result.success
      ? `pushed to (${result.result.pushedTo?.x}, ${result.result.pushedTo?.y})`
      : result.result.hit
        ? "resisted the save"
        : "Unarmed Strike missed";

    const shoveTypeLabel = shoveInfo.shoveType === "prone" ? "Shove prone" : "Shove push";
    // D&D 5e 2024: Shove replaces one attack. If actor has Extra Attack, they may have attacks remaining.
    const isActionFullySpent = hasSpentAction(result.actor.resources);
    return {
      requiresPlayerInput: false,
      actionComplete: isActionFullySpent,
      type: "SIMPLE_ACTION_COMPLETE",
      action: "Shove",
      message: result.result.hit
        ? `${shoveTypeLabel}: ${shoveInfo.targetName} ${outcome}. Attack ${result.result.attackTotal} vs AC ${result.result.targetAC} (hit). Save DC ${result.result.dc}, target rolls ${result.result.abilityUsed}: ${result.result.total} vs DC ${result.result.dc}`
        : `${shoveTypeLabel}: ${shoveInfo.targetName} ${outcome}. Attack ${result.result.attackTotal} vs AC ${result.result.targetAC}`,
    };
  }

  /**
   * Handle Grapple action – contested athletics check to apply Grappled condition.
   */
  async handleGrappleAction(
    sessionId: string,
    encounterId: string,
    actorId: string,
    grappleInfo: { targetName: string },
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    const actor = inferActorRef(actorId, roster);

    const targetRef = findCombatantByName(grappleInfo.targetName, roster);
    if (!targetRef) {
      throw new ValidationError(`Could not find target: ${grappleInfo.targetName}`);
    }

    const encounter = await this.deps.combatRepo.getEncounterById(encounterId);
    const grappleSeed = (encounter?.round ?? 1) * 1000 + (encounter?.turn ?? 0) * 10 + 1;

    const result = await this.deps.actions.grapple(sessionId, {
      encounterId,
      actor,
      target: targetRef,
      seed: grappleSeed,
    });

    const outcome = result.result.success
      ? "grappled"
      : result.result.hit
        ? "resisted the save"
        : "Unarmed Strike missed";

    // D&D 5e 2024: Grapple replaces one attack. If actor has Extra Attack, they may have attacks remaining.
    const isActionFullySpent = hasSpentAction(result.actor.resources);
    return {
      requiresPlayerInput: false,
      actionComplete: isActionFullySpent,
      type: "SIMPLE_ACTION_COMPLETE",
      action: "Grapple",
      message: result.result.hit
        ? `Grapple: ${grappleInfo.targetName} ${outcome}. Attack ${result.result.attackTotal} vs AC ${result.result.targetAC} (hit). Save DC ${result.result.dc}, target rolls ${result.result.abilityUsed}: ${result.result.total} vs DC ${result.result.dc}`
        : `Grapple: ${grappleInfo.targetName} ${outcome}. Attack ${result.result.attackTotal} vs AC ${result.result.targetAC}`,
    };
  }

  async handleEscapeGrappleAction(
    sessionId: string,
    encounterId: string,
    actorId: string,
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    const actor = inferActorRef(actorId, roster);

    const encounter = await this.deps.combatRepo.getEncounterById(encounterId);
    const seed = (encounter?.round ?? 1) * 1000 + (encounter?.turn ?? 0) * 10 + 2;

    const result = await this.deps.actions.escapeGrapple(sessionId, {
      encounterId,
      actor,
      seed,
    });

    const outcome = result.result.success ? "broke free" : "failed to escape";

    return {
      requiresPlayerInput: false,
      actionComplete: true,
      type: "SIMPLE_ACTION_COMPLETE",
      action: "Escape Grapple",
      message: `Escape Grapple: ${outcome}. DC ${result.result.dc}, rolls ${result.result.abilityUsed}: ${result.result.total} vs DC ${result.result.dc}`,
    };
  }
}
