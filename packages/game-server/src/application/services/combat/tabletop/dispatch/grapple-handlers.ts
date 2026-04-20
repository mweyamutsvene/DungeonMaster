/**
 * GrappleHandlers — shove, grapple, and escape-grapple action handlers.
 *
 * D&D 5e 2024 tabletop dice flow:
 * - Grapple/shove create an ATTACK pending action with `contestType` set.
 * - Player rolls d20 for Unarmed Strike vs AC.
 * - On HIT, RollStateMachine resolves saving throw inline (target STR/DEX save vs DC).
 * - On MISS, no save step; attack slot consumed.
 * - Escape Grapple stays programmatic (auto-resolved, design decision D3).
 *
 * Extracted from ActionDispatcher (Phase: God-Module Decomposition §2.2).
 */

import { ValidationError } from "../../../../errors.js";
import { inferActorRef, findCombatantByName, deriveRollModeFromConditions } from "../combat-text-parser.js";
import type { TabletopEventEmitter } from "../tabletop-event-emitter.js";
import type { TabletopCombatServiceDeps, ActionParseResult, AttackPendingAction, WeaponSpec } from "../tabletop-types.js";
import type { LlmRoster } from "../../../../commands/game-command.js";
import {
  getPosition,
  normalizeResources,
  canMakeAttack,
  setAttacksAllowed,
  getAttacksAllowedThisTurn,
} from "../../helpers/resource-utils.js";
import { normalizeConditions } from "../../../../../domain/entities/combat/conditions.js";
import { findCombatantByEntityId } from "../../helpers/combatant-lookup.js";
import { ClassFeatureResolver } from "../../../../../domain/entities/classes/class-feature-resolver.js";
import { getAbilityModifier, getProficiencyBonus } from "../../../../../domain/rules/ability-checks.js";
import { calculateDistance } from "../../../../../domain/rules/movement.js";
import { isTargetTooLarge, type CreatureSize } from "../../../../../domain/rules/grapple-shove.js";
import { rollModePrompt } from "../roll-state-machine.js";

export class GrappleHandlers {
  constructor(
    private readonly deps: TabletopCombatServiceDeps,
    private readonly eventEmitter: TabletopEventEmitter,
    private readonly debugLogsEnabled: boolean,
  ) {}

  /**
   * Handle Shove action – creates ATTACK pending action with contestType for tabletop dice flow.
   * D&D 5e 2024: Shove replaces one attack. Unarmed Strike vs AC, then target STR/DEX save vs DC.
   */
  async handleShoveAction(
    sessionId: string,
    encounterId: string,
    actorId: string,
    shoveInfo: { targetName: string; shoveType: "push" | "prone" },
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    const contestType = shoveInfo.shoveType === "prone" ? "shove_prone" as const : "shove_push" as const;
    return this.createContestPendingAction(
      sessionId, encounterId, actorId, shoveInfo.targetName, contestType, roster,
      /* requiresFreeHand */ false,
    );
  }

  /**
   * Handle Grapple action – creates ATTACK pending action with contestType for tabletop dice flow.
   * D&D 5e 2024: Grapple replaces one attack. Unarmed Strike vs AC, then target STR/DEX save vs DC.
   * Requires at least one free hand.
   */
  async handleGrappleAction(
    sessionId: string,
    encounterId: string,
    actorId: string,
    grappleInfo: { targetName: string },
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    return this.createContestPendingAction(
      sessionId, encounterId, actorId, grappleInfo.targetName, "grapple", roster,
      /* requiresFreeHand */ true,
    );
  }

  /**
   * Handle Escape Grapple action – programmatic auto-resolve (design decision D3).
   * The player chose "escape grapple" as their action — making them roll a bare ability
   * check adds friction without strategic value.
   */
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

  // ── Private: shared contest pending action creation ──

  /**
   * Create an ATTACK pending action with contestType for grapple/shove.
   * Follows the same pattern as AttackHandlers.handleAttackAction():
   * 1. Validate target (exists, range, size)
   * 2. Initialize multi-attack pool
   * 3. Check canMakeAttack
   * 4. Compute roll mode from conditions
   * 5. Build weapon spec + contest DC
   * 6. Create & store pending action
   * 7. Return REQUEST_ROLL
   */
  private async createContestPendingAction(
    sessionId: string,
    encounterId: string,
    actorId: string,
    targetName: string,
    contestType: "grapple" | "shove_push" | "shove_prone",
    roster: LlmRoster,
    requiresFreeHand: boolean,
  ): Promise<ActionParseResult> {
    // ── 1. Resolve target ──
    const targetRef = findCombatantByName(targetName, roster);
    if (!targetRef) {
      throw new ValidationError(`Could not find target: ${targetName}`);
    }
    const targetId = targetRef.type === "Character"
      ? (targetRef as any).characterId
      : targetRef.type === "Monster"
        ? (targetRef as any).monsterId
        : (targetRef as any).npcId;

    // ── 2. Load combatants and actor/target state ──
    const combatants = await this.deps.combatRepo.listCombatants(encounterId);
    const actorCombatant = findCombatantByEntityId(combatants, actorId);
    if (!actorCombatant) throw new ValidationError("Actor not found in encounter");

    const targetCombatant = findCombatantByEntityId(combatants, targetId);
    if (!targetCombatant) throw new ValidationError("Target not found in encounter");
    if (targetCombatant.hpCurrent <= 0) throw new ValidationError("Target is down");

    // ── 3. Validate range (5ft melee reach) ──
    const actorPos = getPosition(actorCombatant.resources ?? {});
    const targetPos = getPosition(targetCombatant.resources ?? {});
    if (!actorPos || !targetPos) throw new ValidationError("Actor and target must have positions set");

    const actorResources = normalizeResources(actorCombatant.resources ?? {});
    const reach = typeof actorResources.reach === "number" ? actorResources.reach : 5;
    const dist = calculateDistance(actorPos, targetPos);
    if (dist > reach + 0.0001) {
      throw new ValidationError(`Target is out of reach (${Math.round(dist)}ft > ${Math.round(reach)}ft)`);
    }

    // ── 4. Validate size (max one size larger) ──
    const characters = await this.deps.characters.listBySession(sessionId);
    const monsters = await this.deps.monsters.listBySession(sessionId);
    const npcs = await this.deps.npcs.listBySession(sessionId);

    const actorEntity = characters.find(c => c.id === actorId)
      ?? monsters.find(m => m.id === actorId)
      ?? npcs.find(n => n.id === actorId);
    const targetEntity = characters.find(c => c.id === targetId)
      ?? monsters.find(m => m.id === targetId)
      ?? npcs.find(n => n.id === targetId);

    const actorSheet = (actorEntity as any)?.sheet ?? (actorEntity as any)?.statBlock ?? {};
    const targetSheet = (targetEntity as any)?.sheet ?? (targetEntity as any)?.statBlock ?? {};

    const actorSize: CreatureSize = actorSheet.size ?? "Medium";
    const targetSize: CreatureSize = targetSheet.size ?? "Medium";
    if (isTargetTooLarge(actorSize, targetSize)) {
      throw new ValidationError(`Target is too large to ${contestType === "grapple" ? "grapple" : "shove"} (more than one size larger)`);
    }

    // ── 5. Free hand check for grapple ──
    if (requiresFreeHand) {
      // TODO: Implement proper free hand tracking. For now, allow grapple attempts.
      // D&D 5e 2024 requires at least one free hand that isn't holding a weapon/shield.
    }

    // ── 6. Initialize multi-attack pool (matching AttackHandlers pattern) ──
    const actorChar = characters.find(c => c.id === actorId);
    const actorClassName = actorChar?.className ?? actorSheet?.className ?? "";
    const actorLevel = ClassFeatureResolver.getLevel(actorSheet, actorChar?.level);

    let currentResources = actorCombatant.resources;
    if (getAttacksAllowedThisTurn(currentResources) === 1) {
      const attacksPerAction = ClassFeatureResolver.getAttacksPerAction(actorSheet, actorClassName, actorLevel);
      if (attacksPerAction > 1) {
        currentResources = setAttacksAllowed(currentResources, attacksPerAction);
        await this.deps.combatRepo.updateCombatantState(actorCombatant.id, {
          resources: currentResources as any,
        });
      }
    }

    if (!canMakeAttack(currentResources)) {
      throw new ValidationError("Actor has no attacks remaining this turn");
    }

    // ── 7. Compute roll mode from conditions ──
    const actorConditions = normalizeConditions(actorCombatant.conditions as unknown[]);
    const targetConditions = normalizeConditions(targetCombatant.conditions as unknown[]);
    const rollMode = deriveRollModeFromConditions(
      actorConditions, targetConditions, "melee", 0, 0, dist,
    );

    // ── 8. Build unarmed strike weapon spec ──
    const actorAbilityScores = actorSheet?.abilityScores ?? {};
    const strMod = getAbilityModifier(actorAbilityScores.strength ?? 10);
    const profBonus = getProficiencyBonus(actorLevel);
    const unarmedStats = ClassFeatureResolver.getUnarmedStrikeStats(actorSheet, actorClassName, actorLevel);

    const weaponSpec: WeaponSpec = {
      name: "Unarmed Strike",
      kind: "melee",
      attackBonus: unarmedStats.attackBonus,
      damage: { diceCount: 1, diceSides: unarmedStats.damageDie, modifier: unarmedStats.damageModifier },
      damageType: "bludgeoning",
    };

    // ── 9. Pre-compute contest DC: 8 + STR mod + proficiency bonus ──
    const contestDC = 8 + strMod + profBonus;

    // ── 10. Create and store ATTACK pending action ──
    const actionLabel = contestType === "grapple" ? "Grapple" : "Shove";
    const pendingAction: AttackPendingAction = {
      type: "ATTACK",
      timestamp: new Date(),
      actorId,
      attacker: actorId,
      target: targetName,
      targetId,
      weaponSpec,
      rollMode,
      contestType,
      contestDC,
    };

    await this.deps.combatRepo.setPendingAction(encounterId, pendingAction);

    // ── 11. Return REQUEST_ROLL ──
    const rollModeText = rollModePrompt(rollMode);
    const diceNeeded = "d20";
    const targetDisplayName = (targetEntity as any)?.name ?? targetName;

    return {
      requiresPlayerInput: true,
      actionComplete: false,
      type: "REQUEST_ROLL",
      action: actionLabel,
      rollType: "attack",
      diceNeeded,
      advantage: rollMode === "advantage",
      disadvantage: rollMode === "disadvantage",
      message: `Roll a d20${rollModeText} for Unarmed Strike (${actionLabel}) vs ${targetDisplayName} (no modifiers; server applies bonuses).`,
      pendingAction,
    };
  }
}
