import { nanoid } from "nanoid";

import { shoveTarget, grappleTarget, escapeGrapple, isTargetTooLarge } from "../../../../domain/rules/grapple-shove.js";
import { SeededDiceRoller } from "../../../../domain/rules/dice-roller.js";
import type { Position } from "../../../../domain/rules/movement.js";
import type { CombatMap } from "../../../../domain/rules/combat-map.js";
import { ClassFeatureResolver } from "../../../../domain/entities/classes/class-feature-resolver.js";
import {
  normalizeConditions,
  addCondition,
  removeCondition,
  createCondition,
  hasAbilityCheckDisadvantage,
  hasAutoFailStrDexSaves,
  getExhaustionD20Penalty,
  type Condition,
} from "../../../../domain/entities/combat/conditions.js";
import {
  normalizeResources,
  spendAction,
  getPosition,
  setPosition,
  isConditionImmuneByEffects,
  canMakeAttack,
  useAttack,
  setAttacksAllowed,
  getAttacksAllowedThisTurn,
} from "../helpers/resource-utils.js";
import { applyKoEffectsIfNeeded } from "../helpers/ko-handler.js";

import { NotFoundError, ValidationError } from "../../../errors.js";
import type { ICombatRepository } from "../../../repositories/combat-repository.js";
import type { IEventRepository } from "../../../repositories/event-repository.js";
import type { IGameSessionRepository } from "../../../repositories/game-session-repository.js";
import type { CombatEncounterRecord, CombatantStateRecord } from "../../../types.js";
import type { ICombatantResolver } from "../helpers/combatant-resolver.js";
import type { CombatantRef } from "../helpers/combatant-ref.js";
import { findCombatantStateByRef } from "../helpers/combatant-ref.js";

import {
  type ShoveActionInput,
  type GrappleActionInput,
  type SimpleActionBaseInput,
  getAbilityModifier,
  clamp,
  hashStringToInt32,
} from "../helpers/combat-utils.js";
import { resolvePitEntry } from "../helpers/pit-terrain-resolver.js";
import { resolveActiveActorOrThrow } from "../helpers/active-actor-resolver.js";
import { deriveRollModeFromConditions } from "../tabletop/combat-text-parser.js";

export class GrappleActionHandler {
  constructor(
    private readonly sessions: IGameSessionRepository,
    private readonly combat: ICombatRepository,
    private readonly combatants: ICombatantResolver,
    private readonly events?: IEventRepository,
  ) {}

  private async resolveActiveActorOrThrow(
    sessionId: string,
    input: { encounterId?: string; actor: CombatantRef; skipActionCheck?: boolean },
  ) {
    return resolveActiveActorOrThrow(this.sessions, this.combat, sessionId, input);
  }

  async shove(sessionId: string, input: ShoveActionInput): Promise<{
    actor: CombatantStateRecord;
    target: CombatantStateRecord;
    result: {
      success: boolean;
      shoveType: "push" | "prone";
      attackRoll: number;
      attackTotal: number;
      targetAC: number;
      hit: boolean;
      dc: number;
      saveRoll: number;
      total: number;
      abilityUsed: "strength" | "dexterity";
      reason?: string;
      pushedTo?: Position;
    };
  }> {
    if (input.seed !== undefined && !Number.isInteger(input.seed)) {
      throw new ValidationError("seed must be an integer");
    }

    const { encounter, combatants, actorState } = await this.resolveActiveActorOrThrow(sessionId, {
      encounterId: input.encounterId,
      actor: input.actor,
      skipActionCheck: true,
    });

    // D&D 5e 2024: Shove replaces one attack within a multi-attack action (Unarmed Strike).
    // Set up attacksAllowedThisTurn based on Extra Attack, then check canMakeAttack.
    const actorStats = await this.combatants.getCombatStats(input.actor);
    let currentResources = actorState.resources;
    const attacksPerAction = ClassFeatureResolver.getAttacksPerAction(null, actorStats.className, actorStats.level);
    if (attacksPerAction > 1 && getAttacksAllowedThisTurn(currentResources) === 1) {
      currentResources = setAttacksAllowed(currentResources, attacksPerAction);
    }
    if (!canMakeAttack(currentResources)) {
      throw new ValidationError("Actor has no attacks remaining this turn");
    }

    const targetState = findCombatantStateByRef(combatants, input.target);
    if (!targetState) throw new NotFoundError("Target not found in encounter");
    if (targetState.hpCurrent <= 0) throw new ValidationError("Target is down");
    if (targetState.id === actorState.id) throw new ValidationError("Cannot shove self");

    const actorResources = normalizeResources(actorState.resources);
    const targetResources = normalizeResources(targetState.resources);

    const actorPos = getPosition(actorResources);
    const targetPos = getPosition(targetResources);
    if (!actorPos || !targetPos) {
      throw new ValidationError("Actor and target must have positions set");
    }

    const reachValue = actorResources.reach;
    const reach = typeof reachValue === "number" ? reachValue : 5;
    const dx = targetPos.x - actorPos.x;
    const dy = targetPos.y - actorPos.y;
    const dist = Math.hypot(dx, dy);
    if (!(dist <= reach + 0.0001)) {
      throw new ValidationError("Target is out of reach");
    }

    const shoveType = input.shoveType ?? "push";
    const seed =
      (input.seed as number | undefined) ??
      hashStringToInt32(
        `${sessionId}:${encounter.id}:${encounter.round}:${encounter.turn}:Shove:${JSON.stringify(input.actor)}:${JSON.stringify(input.target)}:${shoveType}`,
      );

    const targetStats = await this.combatants.getCombatStats(input.target);

    const attackerStrMod = getAbilityModifier(actorStats.abilityScores.strength);
    const targetStrMod = getAbilityModifier(targetStats.abilityScores.strength);
    const targetDexMod = getAbilityModifier(targetStats.abilityScores.dexterity);

    // Check size - target can be at most one size larger
    const targetTooLarge = isTargetTooLarge(actorStats.size, targetStats.size);

    // Conditions-based modifiers
    const actorShoveConditions = normalizeConditions(actorState.conditions as unknown[]);
    const targetShoveConditions = normalizeConditions(targetState.conditions as unknown[]);

    // Use deriveRollModeFromConditions for comprehensive advantage/disadvantage computation
    // (handles attacker self-advantage, target incoming advantage, Prone distance-aware, etc.)
    const attackerMode = deriveRollModeFromConditions(actorShoveConditions, targetShoveConditions, "melee", 0, 0, dist);

    // Check if target auto-fails STR/DEX saves (Stunned, Paralyzed, Petrified, Unconscious)
    const targetAutoFail = hasAutoFailStrDexSaves(targetShoveConditions);

    // TODO: Domain resolveUnarmedStrike() uses abilityCheck() which omits save proficiency
    // and nat 1/20 auto-fail/success rules. The tabletop path (SavingThrowResolver) handles
    // these correctly. Fix in follow-up PR to align both paths.
    const shoveOptions = {
      attackerMode,
      attackerD20Penalty: getExhaustionD20Penalty(actorShoveConditions),
      targetSaveMode: hasAbilityCheckDisadvantage(targetShoveConditions) ? "disadvantage" as const : "normal" as const,
      targetSavePenalty: getExhaustionD20Penalty(targetShoveConditions),
      targetAutoFail,
    };

    const dice = new SeededDiceRoller(seed);

    const result = shoveTarget(
      attackerStrMod,
      actorStats.proficiencyBonus,
      targetStats.armorClass,
      targetStrMod,
      targetDexMod,
      targetTooLarge,
      dice,
      shoveOptions,
    );

    // Consume one attack from the multi-attack pool (marks action spent when all attacks used).
    const updatedActor = await this.combat.updateCombatantState(actorState.id, {
      resources: useAttack(currentResources),
    });

    let updatedTarget = targetState;
    let pushedTo: Position | undefined;

    if (result.success && shoveType === "push") {
      const len = dist > 0.0001 ? dist : 1;
      const ux = dx / len;
      const uy = dy / len;
      const proposed: Position = {
        x: Math.round((targetPos.x + ux * 5) * 100) / 100,
        y: Math.round((targetPos.y + uy * 5) * 100) / 100,
      };

      const map = encounter.mapData as any;
      const width = typeof map?.width === "number" ? map.width : null;
      const height = typeof map?.height === "number" ? map.height : null;
      pushedTo = {
        x: width === null ? proposed.x : clamp(proposed.x, 0, width),
        y: height === null ? proposed.y : clamp(proposed.y, 0, height),
      };

      const updatedTargetResources = setPosition(targetState.resources, pushedTo);
      // Slow Fall (Monk L4+): if the SHOVED target is a Monk, they get the reduction.
      const targetMonkLevel = (targetStats.className ?? "").toLowerCase() === "monk" ? targetStats.level : 0;
      const targetHasReaction = !((targetState.resources as Record<string, unknown> | undefined)?.reactionUsed);
      const pitResult = resolvePitEntry(
        encounter.mapData as CombatMap | undefined,
        targetPos,
        pushedTo,
        targetStats.abilityScores.dexterity,
        targetState.hpCurrent,
        targetState.conditions,
        new SeededDiceRoller(hashStringToInt32(`${sessionId}:${encounter.id}:${targetState.id}:${targetPos.x}:${targetPos.y}:${pushedTo.x}:${pushedTo.y}:pit`)),
        { monkLevel: targetMonkLevel, hasReaction: targetHasReaction },
      );

      const slowFallTriggered = (pitResult.slowFallReduction ?? 0) > 0;
      const forcedMovementResources = pitResult.triggered
        ? {
            ...(updatedTargetResources as Record<string, unknown>),
            movementRemaining: 0,
            movementSpent: true,
            ...(slowFallTriggered ? { reactionUsed: true } : {}),
          }
        : updatedTargetResources;

      const targetPatch: Partial<Pick<CombatantStateRecord, "resources" | "hpCurrent" | "conditions">> = {
        resources: forcedMovementResources,
      };
      if (pitResult.triggered) {
        targetPatch.hpCurrent = pitResult.hpAfter;
        targetPatch.conditions = pitResult.updatedConditions as any;
      }

      updatedTarget = await this.combat.updateCombatantState(targetState.id, targetPatch);

      if (pitResult.triggered && pitResult.damageApplied > 0) {
        await applyKoEffectsIfNeeded(targetState, targetState.hpCurrent, pitResult.hpAfter, this.combat);
      }
    }

    if (result.success && shoveType === "prone") {
      if (!isConditionImmuneByEffects(targetState.resources, "Prone")) {
        let conditions = normalizeConditions(targetState.conditions);
        conditions = addCondition(conditions, createCondition("Prone" as Condition, "until_removed"));
        updatedTarget = await this.combat.updateCombatantState(targetState.id, {
          conditions: conditions as any,
        });
      }
    }

    if (this.events) {
      await this.events.append(sessionId, {
        id: nanoid(),
        type: "ActionResolved",
        payload: {
          encounterId: encounter.id,
          actor: input.actor,
          action: "Shove",
          target: input.target,
          shoveType,
          success: result.success,
          attackRoll: result.attackRoll,
          attackTotal: result.attackTotal,
          targetAC: result.targetAC,
          hit: result.hit,
          dc: result.dc,
          saveRoll: result.saveRoll,
          total: result.total,
          abilityUsed: result.abilityUsed,
          ...(pushedTo ? { pushedTo } : {}),
        },
      });
    }

    return {
      actor: updatedActor,
      target: updatedTarget,
      result: {
        success: result.success,
        shoveType,
        attackRoll: result.attackRoll,
        attackTotal: result.attackTotal,
        targetAC: result.targetAC,
        hit: result.hit,
        dc: result.dc,
        saveRoll: result.saveRoll,
        total: result.total,
        abilityUsed: result.abilityUsed,
        reason: result.reason,
        ...(pushedTo ? { pushedTo } : {}),
      },
    };
  }

  async grapple(sessionId: string, input: GrappleActionInput): Promise<{
    actor: CombatantStateRecord;
    target: CombatantStateRecord;
    result: {
      success: boolean;
      attackRoll: number;
      attackTotal: number;
      targetAC: number;
      hit: boolean;
      dc: number;
      saveRoll: number;
      total: number;
      abilityUsed: "strength" | "dexterity";
      reason?: string;
    };
  }> {
    if (input.seed !== undefined && !Number.isInteger(input.seed)) {
      throw new ValidationError("seed must be an integer");
    }

    const { encounter, combatants, actorState } = await this.resolveActiveActorOrThrow(sessionId, {
      encounterId: input.encounterId,
      actor: input.actor,
      skipActionCheck: true,
    });

    // D&D 5e 2024: Grapple replaces one attack within a multi-attack action (Unarmed Strike).
    // Set up attacksAllowedThisTurn based on Extra Attack, then check canMakeAttack.
    const actorStats = await this.combatants.getCombatStats(input.actor);
    let currentResources = actorState.resources;
    const attacksPerAction = ClassFeatureResolver.getAttacksPerAction(null, actorStats.className, actorStats.level);
    if (attacksPerAction > 1 && getAttacksAllowedThisTurn(currentResources) === 1) {
      currentResources = setAttacksAllowed(currentResources, attacksPerAction);
    }
    if (!canMakeAttack(currentResources)) {
      throw new ValidationError("Actor has no attacks remaining this turn");
    }

    const targetState = findCombatantStateByRef(combatants, input.target);
    if (!targetState) throw new NotFoundError("Target not found in encounter");
    if (targetState.hpCurrent <= 0) throw new ValidationError("Target is down");
    if (targetState.id === actorState.id) throw new ValidationError("Cannot grapple self");

    const actorResources = normalizeResources(actorState.resources);
    const targetResources = normalizeResources(targetState.resources);

    const actorPos = getPosition(actorResources);
    const targetPos = getPosition(targetResources);
    if (!actorPos || !targetPos) {
      throw new ValidationError("Actor and target must have positions set");
    }

    const reachValue = actorResources.reach;
    const reach = typeof reachValue === "number" ? reachValue : 5;
    const dx = targetPos.x - actorPos.x;
    const dy = targetPos.y - actorPos.y;
    const dist = Math.hypot(dx, dy);
    if (!(dist <= reach + 0.0001)) {
      throw new ValidationError("Target is out of reach");
    }

    const seed =
      (input.seed as number | undefined) ??
      hashStringToInt32(
        `${sessionId}:${encounter.id}:${encounter.round}:${encounter.turn}:Grapple:${JSON.stringify(input.actor)}:${JSON.stringify(input.target)}`,
      );

    const targetStats = await this.combatants.getCombatStats(input.target);

    const attackerStrMod = getAbilityModifier(actorStats.abilityScores.strength);
    const targetStrMod = getAbilityModifier(targetStats.abilityScores.strength);
    const targetDexMod = getAbilityModifier(targetStats.abilityScores.dexterity);

    // Check size - target can be at most one size larger
    const targetTooLarge = isTargetTooLarge(actorStats.size, targetStats.size);

    // Check free hand - character needs at least one free hand to grapple
    const hasFreeHand = !actorStats.hasTwoHandedWeapon;

    // Conditions-based modifiers
    const actorGrappleConditions = normalizeConditions(actorState.conditions as unknown[]);
    const targetGrappleConditions = normalizeConditions(targetState.conditions as unknown[]);

    // Use deriveRollModeFromConditions for comprehensive advantage/disadvantage computation
    // (handles attacker self-advantage, target incoming advantage, Prone distance-aware, etc.)
    const grappleAttackerMode = deriveRollModeFromConditions(actorGrappleConditions, targetGrappleConditions, "melee", 0, 0, dist);

    // Check if target auto-fails STR/DEX saves (Stunned, Paralyzed, Petrified, Unconscious)
    const grappleTargetAutoFail = hasAutoFailStrDexSaves(targetGrappleConditions);

    // TODO: Domain resolveUnarmedStrike() uses abilityCheck() which omits save proficiency
    // and nat 1/20 auto-fail/success rules. The tabletop path (SavingThrowResolver) handles
    // these correctly. Fix in follow-up PR to align both paths.
    const grappleOptions = {
      attackerMode: grappleAttackerMode,
      attackerD20Penalty: getExhaustionD20Penalty(actorGrappleConditions),
      targetSaveMode: hasAbilityCheckDisadvantage(targetGrappleConditions) ? "disadvantage" as const : "normal" as const,
      targetSavePenalty: getExhaustionD20Penalty(targetGrappleConditions),
      targetAutoFail: grappleTargetAutoFail,
    };

    const dice = new SeededDiceRoller(seed);

    const result = grappleTarget(
      attackerStrMod,
      actorStats.proficiencyBonus,
      targetStats.armorClass,
      targetStrMod,
      targetDexMod,
      targetTooLarge,
      hasFreeHand,
      dice,
      grappleOptions,
    );

    // Consume one attack from the multi-attack pool (marks action spent when all attacks used).
    const updatedActor = await this.combat.updateCombatantState(actorState.id, {
      resources: useAttack(currentResources),
    });

    let updatedTarget = targetState;

    if (result.success) {
      // Apply Grappled condition to target, storing grappler identity for escape contests
      if (!isConditionImmuneByEffects(targetState.resources, "Grappled")) {
        let conditions = normalizeConditions(targetState.conditions);
        conditions = addCondition(conditions, createCondition("Grappled" as Condition, "until_removed", {
          source: actorState.id,
        }));
        updatedTarget = await this.combat.updateCombatantState(targetState.id, {
          conditions: conditions as any,
        });
      }
    }

    if (this.events) {
      await this.events.append(sessionId, {
        id: nanoid(),
        type: "ActionResolved",
        payload: {
          encounterId: encounter.id,
          actor: input.actor,
          action: "Grapple",
          target: input.target,
          success: result.success,
          attackRoll: result.attackRoll,
          attackTotal: result.attackTotal,
          targetAC: result.targetAC,
          hit: result.hit,
          dc: result.dc,
          saveRoll: result.saveRoll,
          total: result.total,
          abilityUsed: result.abilityUsed,
        },
      });
    }

    return {
      actor: updatedActor,
      target: updatedTarget,
      result: {
        success: result.success,
        attackRoll: result.attackRoll,
        attackTotal: result.attackTotal,
        targetAC: result.targetAC,
        hit: result.hit,
        dc: result.dc,
        saveRoll: result.saveRoll,
        total: result.total,
        abilityUsed: result.abilityUsed,
        reason: result.reason,
      },
    };
  }

  /**
   * Escape from a grapple (2024 rules).
   * DC = 8 + grappler's STR mod + grappler's proficiency bonus.
   * Escapee rolls Athletics (STR) or Acrobatics (DEX) — picks higher.
   * On success the Grappled condition is removed.
   */
  async escapeGrapple(sessionId: string, input: SimpleActionBaseInput): Promise<{
    actor: CombatantStateRecord;
    result: {
      success: boolean;
      dc: number;
      saveRoll: number;
      total: number;
      abilityUsed: "strength" | "dexterity";
      reason?: string;
    };
  }> {
    if (input.seed !== undefined && !Number.isInteger(input.seed)) {
      throw new ValidationError("seed must be an integer");
    }

    const { encounter, combatants, actorState } = await this.resolveActiveActorOrThrow(sessionId, {
      encounterId: input.encounterId,
      actor: input.actor,
    });

    // Verify actor is actually grappled
    const actorConditions = normalizeConditions(actorState.conditions);
    const isGrappled = actorConditions.some(c => c.condition === "Grappled");
    if (!isGrappled) {
      throw new ValidationError("Actor is not grappled");
    }

    const seed =
      (input.seed as number | undefined) ??
      hashStringToInt32(
        `${sessionId}:${encounter.id}:${encounter.round}:${encounter.turn}:EscapeGrapple:${JSON.stringify(input.actor)}`,
      );

    const actorStats = await this.combatants.getCombatStats(input.actor);

    const escapeeStrMod = getAbilityModifier(actorStats.abilityScores.strength);
    const escapeeDexMod = getAbilityModifier(actorStats.abilityScores.dexterity);

    // Look up skill proficiencies for Athletics (STR) and Acrobatics (DEX)
    const skills = actorStats.skills;
    const skillProficiency = skills ? {
      athleticsBonus: typeof skills.athletics === "number" ? actorStats.proficiencyBonus : 0,
      acrobaticsBonus: typeof skills.acrobatics === "number" ? actorStats.proficiencyBonus : 0,
    } : undefined;

    // Find who grappled the actor — look for grapple source on the condition,
    // or fallback to STR +0 / prof +2 if grappler can't be identified
    let grapplerStrMod = 0;
    let grapplerProfBonus = 2;
    const grapplerCondition = actorConditions.find(c => c.condition === "Grappled" && c.source);
    if (grapplerCondition?.source) {
      const grappler = combatants.find(c => c.id === grapplerCondition.source);
      if (grappler) {
        const grapplerRef: CombatantRef =
          grappler.combatantType === "Character"
            ? { type: "Character", characterId: grappler.characterId ?? grappler.id }
            : grappler.combatantType === "NPC"
              ? { type: "NPC", npcId: grappler.npcId ?? grappler.id }
              : { type: "Monster", monsterId: grappler.monsterId ?? grappler.id };
        const grapplerStats = await this.combatants.getCombatStats(grapplerRef);
        grapplerStrMod = getAbilityModifier(grapplerStats.abilityScores.strength);
        grapplerProfBonus = grapplerStats.proficiencyBonus;
      }
    }

    const dice = new SeededDiceRoller(seed);

    // Conditions-based modifiers for the escapee
    const escapeOptions = {
      mode: hasAbilityCheckDisadvantage(actorConditions) ? "disadvantage" as const : "normal" as const,
      d20Penalty: getExhaustionD20Penalty(actorConditions),
    };

    const result = escapeGrapple(
      grapplerStrMod,
      grapplerProfBonus,
      escapeeStrMod,
      escapeeDexMod,
      dice,
      skillProficiency,
      escapeOptions,
    );

    // Spend action
    const updatedResources = spendAction(actorState.resources);

    let updatedActor: CombatantStateRecord;
    if (result.success) {
      // Remove Grappled condition on success
      const conditions = removeCondition(actorConditions, "Grappled" as Condition);
      updatedActor = await this.combat.updateCombatantState(actorState.id, {
        resources: updatedResources,
        conditions: conditions as any,
      });
    } else {
      updatedActor = await this.combat.updateCombatantState(actorState.id, {
        resources: updatedResources,
      });
    }

    if (this.events) {
      await this.events.append(sessionId, {
        id: nanoid(),
        type: "ActionResolved",
        payload: {
          encounterId: encounter.id,
          actor: input.actor,
          action: "EscapeGrapple",
          success: result.success,
          dc: result.dc,
          saveRoll: result.saveRoll,
          total: result.total,
          abilityUsed: result.abilityUsed,
        },
      });
    }

    return {
      actor: updatedActor,
      result: {
        success: result.success,
        dc: result.dc,
        saveRoll: result.saveRoll,
        total: result.total,
        abilityUsed: result.abilityUsed,
        reason: result.reason,
      },
    };
  }
}
