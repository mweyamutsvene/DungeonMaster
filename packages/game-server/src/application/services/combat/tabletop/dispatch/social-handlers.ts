/**
 * SocialHandlers — dash/dodge/disengage, ready, help, hide, search action handlers.
 *
 * Extracted from ActionDispatcher (Phase: God-Module Decomposition §2.2).
 */

import { ValidationError } from "../../../../errors.js";
import { ClassFeatureResolver } from "../../../../../domain/entities/classes/class-feature-resolver.js";
import { classHasFeature } from "../../../../../domain/entities/classes/registry.js";
import { CUNNING_ACTION } from "../../../../../domain/entities/classes/feature-keys.js";
import { calculateDistance } from "../../../../../domain/rules/movement.js";
import {
  normalizeResources,
  readBoolean,
  getPosition,
} from "../../helpers/resource-utils.js";
import { findCombatantByEntityId } from "../../helpers/combatant-lookup.js";
import {
  inferActorRef,
  findCombatantByName,
  getActorNameFromRoster,
  tryParseReadyText,
} from "../combat-text-parser.js";
import type { TabletopEventEmitter } from "../tabletop-event-emitter.js";
import type { TabletopCombatServiceDeps, ActionParseResult } from "../tabletop-types.js";
import type { LlmRoster } from "../../../../commands/game-command.js";

export class SocialHandlers {
  constructor(
    private readonly deps: TabletopCombatServiceDeps,
    private readonly eventEmitter: TabletopEventEmitter,
    private readonly debugLogsEnabled: boolean,
  ) {}

  async handleSimpleAction(
    _sessionId: string,
    encounterId: string,
    actorId: string,
    action: "dash" | "dodge" | "disengage",
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    const actor = inferActorRef(actorId, roster);
    const sessionId = _sessionId;

    if (action === "dash") {
      await this.deps.actions.dash(sessionId, { encounterId, actor });
      return { requiresPlayerInput: false, actionComplete: true, type: "SIMPLE_ACTION_COMPLETE", action: "Dash", message: "Dashed." };
    }
    if (action === "dodge") {
      await this.deps.actions.dodge(sessionId, { encounterId, actor });
      return { requiresPlayerInput: false, actionComplete: true, type: "SIMPLE_ACTION_COMPLETE", action: "Dodge", message: "Dodged." };
    }
    if (action === "disengage") {
      await this.deps.actions.disengage(sessionId, { encounterId, actor });
      return { requiresPlayerInput: false, actionComplete: true, type: "SIMPLE_ACTION_COMPLETE", action: "Disengage", message: "Disengaged." };
    }

    throw new ValidationError(`Unknown simple action: ${action}`);
  }

  /**
   * Handle the Ready action.
   *
   * D&D 5e 2024: Ready uses your Action. You specify a trigger and a response.
   * When the trigger occurs (before your next turn), you use your Reaction to
   * take the readied response. The readied action expires at the start of your
   * next turn if not triggered.
   */
  async handleReadyAction(
    sessionId: string,
    encounterId: string,
    actorId: string,
    text: string,
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    const actorRef = inferActorRef(actorId, roster);

    // Parse ready details from text
    const parsed = tryParseReadyText(text);
    const responseType = parsed?.responseType ?? "attack";
    const triggerType = parsed?.triggerType ?? "creature_moves_within_range";
    const triggerDescription = parsed?.triggerDescription ?? "a creature moves within reach";

    // Find actor combatant and spend the action
    const combatants = await this.deps.combatRepo.listCombatants(encounterId);
    const actorState = combatants.find(c =>
      (c.combatantType === "Character" && c.characterId && actorRef.type === "Character" && c.characterId === actorRef.characterId) ||
      (c.combatantType === "Monster" && c.monsterId && actorRef.type === "Monster" && c.monsterId === actorRef.monsterId) ||
      (c.combatantType === "NPC" && c.npcId && actorRef.type === "NPC" && c.npcId === actorRef.npcId)
    );
    if (!actorState) throw new ValidationError("Actor not found in encounter");

    const resources = normalizeResources(actorState.resources);
    if (readBoolean(resources, "actionSpent")) {
      throw new ValidationError("Actor has already spent their action this turn");
    }

    // Store readied action in resources
    const readiedAction: Record<string, unknown> = {
      responseType,
      triggerType,
      triggerDescription,
      ...(parsed?.targetName ? { targetName: parsed.targetName } : {}),
      ...(parsed?.spellName ? { spellName: parsed.spellName } : {}),
    };

    // D&D 5e 2024: Readying a spell requires concentration until the trigger fires.
    // If already concentrating on something else, that concentration breaks.
    const updatedResources: Record<string, unknown> = {
      ...resources,
      actionSpent: true,
      readiedAction,
    };
    if (parsed?.spellName) {
      updatedResources.concentrationSpellName = `Ready: ${parsed.spellName}`;
    }

    await this.deps.combatRepo.updateCombatantState(actorState.id, {
      resources: updatedResources as any,
    });

    if (this.debugLogsEnabled) {
      console.log(`[SocialHandlers] Ready action: ${responseType} on trigger "${triggerDescription}"`);
    }

    const actorName = getActorNameFromRoster(actorId, roster);
    const message = `${actorName} readies ${responseType === "attack" ? "an attack" : `a ${responseType}`} — will trigger when ${triggerDescription}.`;

    return {
      requiresPlayerInput: false,
      actionComplete: true,
      type: "SIMPLE_ACTION_COMPLETE",
      action: "Ready",
      message,
    };
  }

  /**
   * Handle Help action – give ally advantage on next attack against target.
   * D&D 5e 2024: Helper must be within 5 feet of the target creature.
   */
  async handleHelpAction(
    sessionId: string,
    encounterId: string,
    actorId: string,
    targetName: string,
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    const actor = inferActorRef(actorId, roster);

    const targetRef = findCombatantByName(targetName, roster);
    if (!targetRef) {
      throw new ValidationError(`Could not find target: ${targetName}`);
    }

    // D&D 5e 2024: Help action requires being within 5 feet of the target
    const combatants = await this.deps.combatRepo.listCombatants(encounterId);
    const actorCombatant = findCombatantByEntityId(combatants, actorId);
    const targetEntityId =
      (targetRef as any).characterId ?? (targetRef as any).monsterId ?? (targetRef as any).npcId;
    const targetCombatant = findCombatantByEntityId(combatants, targetEntityId);
    if (actorCombatant && targetCombatant) {
      const actorPos = getPosition(normalizeResources(actorCombatant.resources ?? {}));
      const targetPos = getPosition(normalizeResources(targetCombatant.resources ?? {}));
      if (actorPos && targetPos) {
        const distance = calculateDistance(actorPos, targetPos);
        if (distance > 5.0001) {
          throw new ValidationError(
            `Help action requires being within 5 feet of ${targetName}. You are ${Math.round(distance)} ft away.`,
          );
        }
      }
    }

    await this.deps.actions.help(sessionId, { encounterId, actor, target: targetRef });

    return {
      requiresPlayerInput: false,
      actionComplete: true,
      type: "SIMPLE_ACTION_COMPLETE",
      action: "Help",
      message: `Helped attack ${targetName}.`,
    };
  }

  /**
   * Handle Hide action – make stealth check to gain Hidden condition.
   * Rogues with Cunning Action can use this as a bonus action.
   */
  async handleHideAction(
    sessionId: string,
    encounterId: string,
    actorId: string,
    characters: any[],
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    const actor = inferActorRef(actorId, roster);

    const actorChar = characters.find((c) => c.id === actorId);
    const actorSheet = (actorChar?.sheet ?? {}) as any;
    const actorClassName = actorChar?.className ?? actorSheet?.className ?? "";
    const actorLevel = ClassFeatureResolver.getLevel(actorSheet, actorChar?.level);

    const hasCunningAction = classHasFeature(actorClassName, CUNNING_ACTION, actorLevel);

    const result = await this.deps.actions.hide(sessionId, {
      encounterId,
      actor,
      isBonusAction: hasCunningAction,
    });

    const outcome = result.result.success
      ? `now Hidden (Stealth: ${result.result.stealthRoll})`
      : `failed to hide${result.result.reason ? ` - ${result.result.reason}` : ""}`;

    const actionType = hasCunningAction ? "Cunning Action: Hide" : "Hide";

    return {
      requiresPlayerInput: false,
      actionComplete: true,
      type: "SIMPLE_ACTION_COMPLETE",
      action: "Hide",
      message: `${actionType}: ${outcome}`,
    };
  }

  /**
   * Handle the Search action — Perception check to reveal Hidden creatures.
   */
  async handleSearchAction(
    sessionId: string,
    encounterId: string,
    actorId: string,
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    const actor = inferActorRef(actorId, roster);

    const result = await this.deps.actions.search(sessionId, {
      encounterId,
      actor,
    });

    const foundNames = result.result.found;
    const outcome = foundNames.length > 0
      ? `found ${foundNames.join(", ")} (Perception: ${result.result.roll})`
      : `found nothing (Perception: ${result.result.roll})`;

    return {
      requiresPlayerInput: false,
      actionComplete: true,
      type: "SIMPLE_ACTION_COMPLETE",
      action: "Search",
      message: `Search: ${outcome}`,
    };
  }
}
