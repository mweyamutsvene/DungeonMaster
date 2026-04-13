/**
 * AttackReactionHandler — initiateAttack() + completeAttack() for two-phase attacks.
 *
 * Extracted from TwoPhaseActionService (Phase: God-Module Decomposition §4b).
 */

import { nanoid } from "nanoid";
import type { ICombatRepository } from "../../../repositories/combat-repository.js";
import type { IEventRepository, ReactionPromptEventPayload } from "../../../repositories/event-repository.js";
import type { IGameSessionRepository } from "../../../repositories/game-session-repository.js";
import type { PendingActionRepository } from "../../../repositories/pending-action-repository.js";
import type { ICombatantResolver } from "../helpers/combatant-resolver.js";
import type { CombatantRef } from "../helpers/combatant-ref.js";
import type { Position } from "../../../../domain/rules/movement.js";
import type {
  PendingAction,
  ReactionOpportunity,
  ReactionResponse,
  PendingAttackData,
  PendingDamageReactionData,
} from "../../../../domain/entities/combat/pending-action.js";
import { calculateDistance } from "../../../../domain/rules/movement.js";
import { hasReactionAvailable, canMakeSentinelReaction } from "../../../../domain/rules/opportunity-attack.js";
import { resolveEncounterOrThrow } from "../helpers/encounter-resolver.js";
import { findCombatantStateByRef, combatantRefFromState } from "../helpers/combatant-ref.js";
import { ValidationError, NotFoundError } from "../../../errors.js";
import {
  normalizeResources,
  readBoolean,
  getPosition,
  getActiveEffects,
} from "../helpers/resource-utils.js";
import { normalizeConditions, hasCondition, canTakeReactions } from "../../../../domain/entities/combat/conditions.js";
import { applyDamageDefenses } from "../../../../domain/rules/damage-defenses.js";
import { applyKoEffectsIfNeeded } from "../helpers/ko-handler.js";
import { calculateFlatBonusFromEffects } from "../../../../domain/entities/combat/effects.js";
import { detectAttackReactions, detectDamageReactions } from "../../../../domain/entities/classes/combat-text-profile.js";
import { getAllCombatTextProfiles } from "../../../../domain/entities/classes/registry.js";
import { SeededDiceRoller } from "../../../../domain/rules/dice-roller.js";
import type { JsonValue } from "../../../types.js";
import { resolveReadiedAttackTriggers, type ReadiedAttackTriggerResult } from "../helpers/readied-attack-trigger.js";

/** Deps shared with TwoPhaseActionService for damage-reaction initiation */
export interface DamageReactionInitiator {
  initiateDamageReaction(sessionId: string, input: {
    encounterId: string;
    target: CombatantRef;
    attackerId: CombatantRef;
    damageType: string;
    damageAmount: number;
    detectedReaction: { reactionType: string; context: Record<string, unknown> };
    targetCombatantId: string;
  }): Promise<{ status: "no_reactions" | "awaiting_reactions"; pendingActionId?: string }>;
}

export class AttackReactionHandler {
  constructor(
    private readonly sessions: IGameSessionRepository,
    private readonly combat: ICombatRepository,
    private readonly combatants: ICombatantResolver,
    private readonly pendingActions: PendingActionRepository,
    private readonly events?: IEventRepository,
  ) {}

  /**
   * Phase 1: Initiate attack, detect defensive reaction opportunities (Shield, Deflect Attacks, etc.).
   */
  async initiate(sessionId: string, input: {
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

    // Get target AC from combat stats (sheet), not resources
    const targetResources = normalizeResources(target.resources);
    let targetAC: number;
    try {
      const targetStats = await this.combatants.getCombatStats(input.target);
      targetAC = targetStats.armorClass;
    } catch {
      targetAC = typeof targetResources.armorClass === "number" ? targetResources.armorClass : 10;
    }

    // AC bonus from target's ActiveEffects (Shield of Faith, etc.)
    const targetActiveEffects = getActiveEffects(target.resources ?? {});
    const acBonusFromEffects = calculateFlatBonusFromEffects(targetActiveEffects, 'armor_class');
    targetAC += acBonusFromEffects;

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

    // Check if target can use any defensive reactions
    // Target must be alive and not incapacitated/unconscious/stunned to react
    const targetConditions = normalizeConditions(target.conditions as unknown[]);
    const targetIsCharacter = target.combatantType === "Character";
    if (!targetIsCharacter || target.hpCurrent <= 0 || !canTakeReactions(targetConditions)) {
      return {
        status: "hit",
        attackRoll: input.attackRoll,
        targetAC,
        shieldOpportunities: [],
      };
    }

    const hasReaction = hasReactionAvailable({ reactionUsed: false, ...targetResources } as any);

    const shieldOpportunities: Array<{
      combatantId: string;
      combatantName: string;
      canUse: boolean;
      hasReaction: boolean;
      hasSpellSlot: boolean;
      newAC?: number;
    }> = [];

    const reactionOpportunities: ReactionOpportunity[] = [];

    // Generic attack reaction detection via class profiles
    try {
      const targetStats = await this.combatants.getCombatStats(input.target);
      const detectionInput = {
        className: targetStats.className?.toLowerCase() ?? "",
        level: targetStats.level ?? 1,
        abilityScores: targetStats.abilityScores as Record<string, number>,
        resources: targetResources,
        hasReaction,
        isCharacter: targetIsCharacter,
        attackRoll: input.attackRoll,
        attackerId: actor.id,
        targetAC,
      };

      const detected = detectAttackReactions(detectionInput, getAllCombatTextProfiles());
      const targetName = detected.length > 0
        ? await this.combatants.getName(input.target, target)
        : "";

      for (const reaction of detected) {
        reactionOpportunities.push({
          id: nanoid(),
          combatantId: target.id,
          reactionType: reaction.reactionType as ReactionOpportunity["reactionType"],
          canUse: true,
          context: reaction.context,
        });

        shieldOpportunities.push({
          combatantId: target.id,
          combatantName: targetName,
          canUse: true,
          hasReaction: true,
          hasSpellSlot: true,
          newAC: typeof reaction.context.newAC === "number" ? reaction.context.newAC : undefined,
        });
      }
    } catch {
      // If we can't look up target stats, skip reaction detection
    }

    // ── Sentinel Feat Effect #3: nearby allies can react to ally being attacked ──
    const actorPos = getPosition(normalizeResources(actor.resources));
    if (actorPos) {
      for (const other of combatants) {
        // Skip the attacker and the target
        if (other.id === actor.id) continue;
        if (other.id === target.id) continue;
        // Must be alive
        if (other.hpCurrent <= 0) continue;

        const otherResources = normalizeResources(other.resources);
        const otherPos = getPosition(otherResources);
        if (!otherPos) continue;

        const sentinelFlag = readBoolean(otherResources, "sentinelEnabled") ?? false;
        if (!sentinelFlag) continue;

        const otherHasReaction = hasReactionAvailable({ reactionUsed: false, ...otherResources } as any)
          && !readBoolean(otherResources, "reactionUsed");

        const dist = calculateDistance(otherPos, actorPos);

        // D&D 5e 2024: Incapacitated, Stunned, Unconscious, Paralyzed, and Petrified
        // all prevent taking reactions (they include the Incapacitated condition).
        const otherConditions = normalizeConditions(other.conditions as unknown[]);
        const observerIncapacitated =
          hasCondition(otherConditions, "Incapacitated") ||
          hasCondition(otherConditions, "Stunned") ||
          hasCondition(otherConditions, "Unconscious") ||
          hasCondition(otherConditions, "Paralyzed") ||
          hasCondition(otherConditions, "Petrified");

        const sentinelCheck = canMakeSentinelReaction({
          observerHasSentinel: true,
          observerHasReaction: otherHasReaction,
          observerIncapacitated,
          distanceToAttacker: dist,
          observerIsTarget: false,
        });

        if (sentinelCheck.canReact) {
          const otherRef = combatantRefFromState(other);
          if (!otherRef) continue;
          const otherName = await this.combatants.getName(otherRef, other);

          const oppId = nanoid();
          reactionOpportunities.push({
            id: oppId,
            combatantId: other.id,
            reactionType: "sentinel_attack",
            canUse: true,
            context: {
              attackerId: actor.id,
              sentinelName: otherName,
            },
          });

          shieldOpportunities.push({
            combatantId: other.id,
            combatantName: otherName,
            canUse: true,
            hasReaction: true,
            hasSpellSlot: false,
          });
        }
      }
    }

    // If no reaction opportunities, attack hits
    if (reactionOpportunities.length === 0) {
      return {
        status: "hit",
        attackRoll: input.attackRoll,
        targetAC,
        shieldOpportunities,
      };
    }

    // Create pending action for reaction resolution
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

    // Emit reaction prompt(s)
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
          payload,
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
   * Phase 2: Complete attack after reaction resolution (Shield, Deflect Attacks, etc.).
   */
  async complete(
    sessionId: string,
    input: {
      pendingActionId: string;
      diceRoller?: { rollDie(sides: number, count?: number, modifier?: number): { total: number; rolls: number[] } };
    },
    damageReactionInitiator: DamageReactionInitiator,
  ): Promise<{
    hit: boolean;
    shieldUsed: boolean;
    finalAC: number;
    attackRoll: number;
    damageApplied: number;
    redirect?: {
      hit: boolean;
      attackRoll: number;
      targetAC: number;
      damage: number;
    };
    damageReaction?: {
      pendingActionId: string;
      reactionType: string;
    };
    sentinelAttacks?: Array<{
      attackerId: string;
      attackerName: string;
      targetId: string;
      attackRoll: number;
      targetAC: number;
      hit: boolean;
      damage: number;
    }>;
    readiedAttackTriggers?: ReadiedAttackTriggerResult[];
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
      (r: ReactionResponse) => r.choice === "use" &&
        pendingAction.reactionOpportunities.find((o) => o.id === r.opportunityId)?.reactionType === "shield",
    );
    const shieldOpp = shieldReaction
      ? pendingAction.reactionOpportunities.find((o) => o.id === shieldReaction.opportunityId)
      : null;

    // Check if Deflect Attacks was used
    const deflectReaction = pendingAction.resolvedReactions.find(
      (r: ReactionResponse) => r.choice === "use" &&
        pendingAction.reactionOpportunities.find((o) => o.id === r.opportunityId)?.reactionType === "deflect_attacks",
    );
    const deflectOpp = deflectReaction
      ? pendingAction.reactionOpportunities.find((o) => o.id === deflectReaction.opportunityId)
      : null;

    // Check if Uncanny Dodge was used (Rogue level 5+)
    const uncannyDodgeReaction = pendingAction.resolvedReactions.find(
      (r: ReactionResponse) => r.choice === "use" &&
        pendingAction.reactionOpportunities.find((o) => o.id === r.opportunityId)?.reactionType === "uncanny_dodge",
    );

    const targetResources = normalizeResources(target.resources);
    let finalAC: number;
    if (typeof attackData.targetAC === "number") {
      finalAC = attackData.targetAC;
    } else {
      try {
        const stats = await this.combatants.getCombatStats(attackData.target);
        finalAC = stats.armorClass;
      } catch {
        finalAC = typeof targetResources.armorClass === "number" ? targetResources.armorClass : 10;
      }
    }
    let shieldUsed = false;

    if (shieldReaction) {
      finalAC += 5;
      shieldUsed = true;

      // Spend spell slot for Shield (use context.slotToSpend for Pact Magic support)
      const { spendResourceFromPool } = await import("../helpers/resource-utils.js");
      const shieldSlot = shieldOpp && typeof shieldOpp.context.slotToSpend === "string"
        ? shieldOpp.context.slotToSpend
        : "spellSlot_1";
      let updatedResources: JsonValue;
      try {
        updatedResources = spendResourceFromPool(target.resources, shieldSlot, 1);
      } catch {
        updatedResources = target.resources;
      }

      const normalizedUpdated = normalizeResources(updatedResources);
      await this.combat.updateCombatantState(target.id, {
        resources: { ...normalizedUpdated, reactionUsed: true } as JsonValue,
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
          },
        });
      }
    }

    const hit = attackData.attackRoll >= finalAC;
    let damageApplied = 0;
    let redirectResult: { hit: boolean; attackRoll: number; targetAC: number; damage: number } | undefined;

    // If attack hits, roll and apply damage
    if (hit && attackData.damageSpec && input.diceRoller) {
      const { diceCount, diceSides, modifier } = attackData.damageSpec;
      const effectiveDiceCount = attackData.critical ? diceCount * 2 : diceCount;
      const damageRoll = input.diceRoller.rollDie(diceSides, effectiveDiceCount, modifier);
      damageApplied = Math.max(0, damageRoll.total);

      // Apply damage resistance/immunity/vulnerability
      const damageTypeFromSpec = attackData.damageSpec.damageType;
      if (damageApplied > 0 && damageTypeFromSpec) {
        try {
          const tgtStats = await this.combatants.getCombatStats(attackData.target);
          if (tgtStats.damageDefenses) {
            const defResult = applyDamageDefenses(damageApplied, damageTypeFromSpec, tgtStats.damageDefenses);
            damageApplied = defResult.adjustedDamage;
          }
        } catch { /* proceed without defenses */ }
      }

      // Apply Deflect Attacks damage reduction (Monk reaction)
      if (damageApplied > 0 && deflectReaction && deflectOpp && input.diceRoller) {
        const deflectCtx = deflectOpp.context as {
          dexMod?: number;
          monkLevel?: number;
          proficiencyBonus?: number;
          martialArtsDieSize?: number;
        };
        const dexMod = deflectCtx.dexMod ?? 0;
        const monkLevel = deflectCtx.monkLevel ?? 1;
        const deflectRoll = input.diceRoller.rollDie(10);
        const totalReduction = deflectRoll.total + dexMod + monkLevel;
        damageApplied = Math.max(0, damageApplied - totalReduction);

        // Mark reaction as used
        const targetRes = normalizeResources(target.resources);
        await this.combat.updateCombatantState(target.id, {
          resources: { ...targetRes, reactionUsed: true } as JsonValue,
        });

        // Emit Deflect Attacks event
        if (this.events) {
          const targetName = await this.combatants.getName(attackData.target, target);
          await this.events.append(sessionId, {
            id: nanoid(),
            type: "DeflectAttacks",
            payload: {
              encounterId: encounter.id,
              deflectorId: target.id,
              deflectorName: targetName,
              deflectRoll: deflectRoll.total,
              dexMod,
              monkLevel,
              totalReduction,
              damageAfterReduction: damageApplied,
            },
          });
        }

        // --- Deflect Attacks Ki Redirect (D&D 5e 2024) ---
        if (damageApplied === 0 && input.diceRoller) {
          const { hasResourceAvailable, spendResourceFromPool } = await import("../helpers/resource-utils.js");
          const freshCombatants = await this.combat.listCombatants(encounter.id);
          const freshTarget = findCombatantStateByRef(freshCombatants, attackData.target);
          const currentResources = freshTarget?.resources ?? target.resources;

          if (hasResourceAvailable(currentResources, "ki", 1)) {
            const updatedResources = spendResourceFromPool(currentResources, "ki", 1);
            await this.combat.updateCombatantState(target.id, {
              resources: updatedResources as JsonValue,
            });

            const attacker = findCombatantStateByRef(combatants, pendingAction.actor);
            if (attacker && attacker.hpCurrent > 0) {
              const profBonus = deflectCtx.proficiencyBonus ?? 2;
              const maDieSize = deflectCtx.martialArtsDieSize ?? 6;
              const attackModifier = dexMod + profBonus;

              const redirectAttackRoll = input.diceRoller.rollDie(20);
              const redirectTotal = redirectAttackRoll.total + attackModifier;

              let attackerAC: number;
              try {
                const attackerStats = await this.combatants.getCombatStats(pendingAction.actor);
                attackerAC = attackerStats.armorClass;
              } catch {
                const attackerRes = normalizeResources(attacker.resources);
                attackerAC = typeof attackerRes.armorClass === "number" ? attackerRes.armorClass : 10;
              }

              const redirectHit = redirectTotal >= attackerAC;
              let redirectDamage = 0;

              if (redirectHit) {
                const die1 = input.diceRoller.rollDie(maDieSize);
                const die2 = input.diceRoller.rollDie(maDieSize);
                redirectDamage = die1.total + die2.total + dexMod;
                redirectDamage = Math.max(1, redirectDamage);

                const attackerHpAfter = Math.max(0, attacker.hpCurrent - redirectDamage);
                await this.combat.updateCombatantState(attacker.id, { hpCurrent: attackerHpAfter });
                await applyKoEffectsIfNeeded(attacker, attacker.hpCurrent, attackerHpAfter, this.combat);

                if (this.events) {
                  const attackerName = await this.combatants.getName(pendingAction.actor, attacker);
                  await this.events.append(sessionId, {
                    id: nanoid(),
                    type: "DamageApplied",
                    payload: {
                      encounterId: encounter.id,
                      target: pendingAction.actor,
                      targetName: attackerName,
                      amount: redirectDamage,
                      hpCurrent: attackerHpAfter,
                      damageType: "force",
                      source: "DeflectAttacksRedirect",
                    },
                  });
                }
              }

              if (this.events) {
                const deflectorName = await this.combatants.getName(attackData.target, target);
                const attackerName = await this.combatants.getName(pendingAction.actor, attacker);
                await this.events.append(sessionId, {
                  id: nanoid(),
                  type: "DeflectAttacksRedirect",
                  payload: {
                    encounterId: encounter.id,
                    deflectorId: target.id,
                    deflectorName,
                    targetId: attacker.id,
                    targetName: attackerName,
                    attackRoll: redirectTotal,
                    attackerAC,
                    hit: redirectHit,
                    damage: redirectDamage,
                    martialArtsDieSize: maDieSize,
                    dexMod,
                    proficiencyBonus: profBonus,
                  },
                });
              }

              redirectResult = {
                hit: redirectHit,
                attackRoll: redirectTotal,
                targetAC: attackerAC,
                damage: redirectDamage,
              };
            }
          }
        }
      }

      // Apply Uncanny Dodge damage halving (Rogue reaction)
      if (damageApplied > 0 && uncannyDodgeReaction) {
        damageApplied = Math.floor(damageApplied / 2);

        // Mark reaction as used
        const targetRes = normalizeResources(target.resources);
        await this.combat.updateCombatantState(target.id, {
          resources: { ...targetRes, reactionUsed: true } as JsonValue,
        });

        // Emit Uncanny Dodge event
        if (this.events) {
          const targetName = await this.combatants.getName(attackData.target, target);
          await this.events.append(sessionId, {
            id: nanoid(),
            type: "UncannyDodge",
            payload: {
              encounterId: encounter.id,
              dodgerId: target.id,
              dodgerName: targetName,
              damageAfterReduction: damageApplied,
            },
          });
        }
      }

      if (damageApplied > 0) {
        const hpBefore = target.hpCurrent;
        const hpAfter = Math.max(0, hpBefore - damageApplied);
        await this.combat.updateCombatantState(target.id, { hpCurrent: hpAfter });
        await applyKoEffectsIfNeeded(target, hpBefore, hpAfter, this.combat);

        // D&D 5e 2024: Rage damage-taken tracking for attack target
        {
          const tgtRes = normalizeResources(target.resources);
          if (tgtRes.raging === true) {
            await this.combat.updateCombatantState(target.id, {
              resources: { ...tgtRes, rageDamageTakenThisTurn: true } as any,
            });
          }
        }

        // Emit damage event
        if (this.events) {
          const targetName = await this.combatants.getName(attackData.target, target);
          await this.events.append(sessionId, {
            id: nanoid(),
            type: "DamageApplied",
            payload: {
              encounterId: encounter.id,
              target: attackData.target,
              targetName,
              amount: damageApplied,
              hpCurrent: hpAfter,
            },
          });
        }

        // Emit attack resolved event
        if (this.events) {
          await this.events.append(sessionId, {
            id: nanoid(),
            type: "AttackResolved",
            payload: {
              encounterId: encounter.id,
              attacker: pendingAction.actor,
              target: attackData.target,
              attackName: attackData.attackName,
              attackRoll: attackData.attackRoll,
              targetAC: finalAC,
              hit: true,
              critical: attackData.critical ?? false,
              damageApplied,
            },
          });
        }
      }
    } else if (!hit) {
      // Emit attack miss event
      if (this.events) {
        await this.events.append(sessionId, {
          id: nanoid(),
          type: "AttackResolved",
          payload: {
            encounterId: encounter.id,
            attacker: pendingAction.actor,
            target: attackData.target,
            attackName: attackData.attackName,
            attackRoll: attackData.attackRoll,
            targetAC: finalAC,
            hit: false,
            critical: false,
            damageApplied: 0,
            shieldUsed,
          },
        });
      }
    }

    // Mark as completed
    await this.pendingActions.markCompleted(input.pendingActionId);
    await this.pendingActions.delete(input.pendingActionId);

    // --- Damage reaction detection (Absorb Elements, Hellish Rebuke) ---
    let damageReactionResult: { pendingActionId: string; reactionType: string } | undefined;
    if (hit && damageApplied > 0 && attackData.damageSpec?.damageType) {
      const freshCombatants = await this.combat.listCombatants(encounter.id);
      const freshTarget = findCombatantStateByRef(freshCombatants, attackData.target);
      if (freshTarget && freshTarget.hpCurrent > 0 && freshTarget.combatantType === "Character") {
        const freshResources = normalizeResources(freshTarget.resources);
        const stillHasReaction = hasReactionAvailable({ reactionUsed: false, ...freshResources } as any)
          && !readBoolean(freshResources, "reactionUsed");

        if (stillHasReaction) {
          try {
            const targetStats = await this.combatants.getCombatStats(attackData.target);
            const dmgInput = {
              className: targetStats.className?.toLowerCase() ?? "",
              level: targetStats.level ?? 1,
              abilityScores: (targetStats.abilityScores ?? {}) as Record<string, number>,
              resources: freshResources,
              hasReaction: true,
              isCharacter: true,
              damageType: attackData.damageSpec.damageType,
              damageAmount: damageApplied,
              attackerId: pendingAction.actor.type === "Monster"
                ? (pendingAction.actor as any).monsterId
                : (pendingAction.actor as any).characterId ?? "",
            };

            const dmgReactions = detectDamageReactions(dmgInput, getAllCombatTextProfiles());
            if (dmgReactions.length > 0) {
              const dr = dmgReactions[0]!;
              const drResult = await damageReactionInitiator.initiateDamageReaction(sessionId, {
                encounterId: encounter.id,
                target: attackData.target,
                attackerId: pendingAction.actor,
                damageType: attackData.damageSpec.damageType,
                damageAmount: damageApplied,
                detectedReaction: dr,
                targetCombatantId: freshTarget.id,
              });
              if (drResult.status === "awaiting_reactions") {
                damageReactionResult = {
                  pendingActionId: drResult.pendingActionId!,
                  reactionType: dr.reactionType,
                };
              }
            }
          } catch { /* skip damage reaction if stats unavailable */ }
        }
      }
    }

    // --- Sentinel reaction attacks ---
    const sentinelAttacks: Array<{
      attackerId: string;
      attackerName: string;
      targetId: string;
      attackRoll: number;
      targetAC: number;
      hit: boolean;
      damage: number;
    }> = [];

    const sentinelReactions = pendingAction.resolvedReactions.filter(
      (r) => r.choice === "use" &&
        pendingAction.reactionOpportunities.find((o) => o.id === r.opportunityId)?.reactionType === "sentinel_attack",
    );

    for (const sentinelReaction of sentinelReactions) {
      const sentinelOpp = pendingAction.reactionOpportunities.find((o) => o.id === sentinelReaction.opportunityId);
      if (!sentinelOpp) continue;

      const freshCombatantsForSentinel = await this.combat.listCombatants(encounter.id);
      const sentinelCombatant = freshCombatantsForSentinel.find((c) => c.id === sentinelOpp.combatantId);
      if (!sentinelCombatant || sentinelCombatant.hpCurrent <= 0) continue;

      const attacker = findCombatantStateByRef(freshCombatantsForSentinel, pendingAction.actor);
      if (!attacker || attacker.hpCurrent <= 0) continue;

      // Mark Sentinel's reaction as used
      const sentinelRes = normalizeResources(sentinelCombatant.resources);
      await this.combat.updateCombatantState(sentinelCombatant.id, {
        resources: { ...sentinelRes, reactionUsed: true } as JsonValue,
      });

      // Get Sentinel's attack stats
      const sentinelRef = combatantRefFromState(sentinelCombatant);
      if (!sentinelRef) continue;

      let sentinelAttackBonus = 0;
      let sentinelDamageDice = { count: 1, sides: 6, modifier: 0 };
      let sentinelAttackName = "melee attack";
      try {
        const attacks = await this.combatants.getAttacks(sentinelRef) as Array<{
          name?: string;
          kind?: string;
          attackBonus?: number;
          damage?: { diceCount?: number; diceSides?: number; modifier?: number };
        }>;
        const meleeAttack = attacks.find((a) => a.kind === "melee") ?? attacks[0];
        if (meleeAttack) {
          sentinelAttackBonus = meleeAttack.attackBonus ?? 0;
          sentinelAttackName = meleeAttack.name ?? "melee attack";
          if (meleeAttack.damage) {
            sentinelDamageDice = {
              count: meleeAttack.damage.diceCount ?? 1,
              sides: meleeAttack.damage.diceSides ?? 6,
              modifier: meleeAttack.damage.modifier ?? 0,
            };
          }
        }
      } catch { /* use defaults */ }

      // Get attacker's AC
      let attackerAC: number;
      try {
        const attackerStats = await this.combatants.getCombatStats(pendingAction.actor);
        attackerAC = attackerStats.armorClass;
      } catch {
        const attackerRes = normalizeResources(attacker.resources);
        attackerAC = typeof attackerRes.armorClass === "number" ? attackerRes.armorClass : 10;
      }

      // Roll Sentinel attack (deterministic via seed)
      const seed = (sentinelCombatant.id + pendingAction.id + "sentinel").split("").reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
      const sentinelDiceRoller = new SeededDiceRoller(seed);
      const d20Roll = sentinelDiceRoller.rollDie(20);
      const sentinelTotal = d20Roll.total + sentinelAttackBonus;
      const sentinelHit = sentinelTotal >= attackerAC;
      let sentinelDamage = 0;

      if (sentinelHit) {
        const dmgRoll = sentinelDiceRoller.rollDie(
          sentinelDamageDice.sides,
          sentinelDamageDice.count,
          sentinelDamageDice.modifier,
        );
        sentinelDamage = Math.max(1, dmgRoll.total);

        const attackerHpBefore = attacker.hpCurrent;
        const attackerHpAfter = Math.max(0, attackerHpBefore - sentinelDamage);
        await this.combat.updateCombatantState(attacker.id, { hpCurrent: attackerHpAfter });
        await applyKoEffectsIfNeeded(attacker, attackerHpBefore, attackerHpAfter, this.combat);
      }

      const sentinelName = (sentinelOpp.context as any).sentinelName ?? "Sentinel";
      const attackerName = await this.combatants.getName(pendingAction.actor, attacker);

      sentinelAttacks.push({
        attackerId: sentinelCombatant.id,
        attackerName: sentinelName,
        targetId: attacker.id,
        attackRoll: sentinelTotal,
        targetAC: attackerAC,
        hit: sentinelHit,
        damage: sentinelDamage,
      });

      // Emit Sentinel attack event
      if (this.events) {
        await this.events.append(sessionId, {
          id: nanoid(),
          type: "SentinelReactionAttack",
          payload: {
            encounterId: encounter.id,
            sentinelId: sentinelCombatant.id,
            sentinelName,
            targetId: attacker.id,
            targetName: attackerName,
            attackName: sentinelAttackName,
            attackRoll: sentinelTotal,
            targetAC: attackerAC,
            hit: sentinelHit,
            damage: sentinelDamage,
          },
        });
      }
    }

    // --- Readied action triggers (creature_attacks) ---
    // D&D 5e 2024: If any combatant has a readied action with "creature_attacks" trigger,
    // fire it now that the attack has resolved.
    const attackerState = findCombatantStateByRef(combatants, pendingAction.actor);
    let readiedAttackTriggers: ReadiedAttackTriggerResult[] | undefined;
    if (attackerState) {
      const triggers = await resolveReadiedAttackTriggers(
        sessionId,
        encounter.id,
        attackerState.id,
        { combat: this.combat, combatants: this.combatants, events: this.events },
      );
      if (triggers.length > 0) {
        readiedAttackTriggers = triggers;
      }
    }

    return {
      hit,
      shieldUsed,
      finalAC,
      attackRoll: attackData.attackRoll,
      damageApplied,
      redirect: redirectResult,
      damageReaction: damageReactionResult,
      sentinelAttacks: sentinelAttacks.length > 0 ? sentinelAttacks : undefined,
      readiedAttackTriggers,
    };
  }
}
