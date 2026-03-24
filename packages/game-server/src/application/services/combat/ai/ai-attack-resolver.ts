/**
 * AiAttackResolver - two-phase AI attack resolution (roll-to-hit → roll-damage → apply).
 *
 * Extracted from AiActionExecutor to reduce the god-module size and prevent
 * drift from the tabletop resolution path by centralising the shared logic.
 *
 * Layer: Application
 */

import type { CombatantStateRecord } from "../../../types.js";
import type { TwoPhaseActionService } from "../two-phase-action-service.js";
import type { ICombatRepository } from "../../../repositories/index.js";
import type { PendingActionRepository } from "../../../repositories/pending-action-repository.js";
import type { ICombatantResolver } from "../helpers/combatant-resolver.js";
import type { IEventRepository } from "../../../repositories/event-repository.js";
import type { ActorRef } from "./ai-types.js";
import type { CombatantRef } from "../helpers/combatant-ref.js";
import type { DiceRoller } from "../../../../domain/rules/dice-roller.js";
import { nanoid } from "nanoid";
import { normalizeResources, getActiveEffects, readBoolean, spendAction } from "../helpers/resource-utils.js";
import { applyKoEffectsIfNeeded, applyDamageWhileUnconscious } from "../helpers/ko-handler.js";
import { hasReactionAvailable } from "../../../../domain/rules/opportunity-attack.js";
import { applyDamageDefenses } from "../../../../domain/rules/damage-defenses.js";
import {
  hasAdvantageFromEffects,
  hasDisadvantageFromEffects,
  calculateBonusFromEffects,
  calculateFlatBonusFromEffects,
  getDamageDefenseEffects,
} from "../../../../domain/entities/combat/effects.js";
import { normalizeConditions } from "../../../../domain/entities/combat/conditions.js";
import { deriveRollModeFromConditions } from "../tabletop/combat-text-parser.js";
import { detectDamageReactions } from "../../../../domain/entities/classes/combat-text-profile.js";
import { getAllCombatTextProfiles } from "../../../../domain/entities/classes/registry.js";

type AiLogger = (msg: string) => void;

export interface AiAttackResolverDeps {
  combat: ICombatRepository;
  twoPhaseActions: TwoPhaseActionService;
  pendingActions: PendingActionRepository;
  combatantResolver: ICombatantResolver;
  events?: IEventRepository;
  diceRoller: DiceRoller;
  aiLog: AiLogger;
}

export interface AiAttackParams {
  sessionId: string;
  encounterId: string;
  /** The attacking AI combatant. */
  aiCombatant: CombatantStateRecord;
  /** The attack's target combatant. */
  targetCombatant: CombatantStateRecord;
  actorRef: ActorRef;
  targetRef: ActorRef;
  attackName: string;
  /** Pre-fetched from combatantResolver.getMonsterAttacks; pass [] for non-monsters. */
  monsterAttacks: unknown[];
}

/**
 * Outcome of a two-phase attack resolution attempt.
 *
 * - `not_applicable`: chosen attack name was not found in monsterAttacks; caller should fall
 *   through to the normal actionService.attack() path.
 * - `miss`: attack missed; action already spent, AttackResolved event emitted.
 * - `awaiting_reactions`: player has a counter-reaction (Shield, etc.) pending.
 * - `hit`: attack landed and damage was applied; action already spent, events emitted.
 * - `awaiting_damage_reaction`: hit applied but a damage reaction (Absorb Elements, etc.) is pending.
 */
export type AiAttackOutcome =
  | { status: "not_applicable" }
  | { status: "miss" }
  | { status: "awaiting_reactions"; pendingActionId: string; attackTotal: number }
  | { status: "hit"; damageApplied: number }
  | { status: "awaiting_damage_reaction"; pendingActionId: string; damageApplied: number };

/**
 * Resolves an AI two-phase attack: dice rolls, reactions, damage, KO, retaliatory damage,
 * event emission, and action-economy spending.
 *
 * The caller (AiActionExecutor.executeAttack) handles bonus-action execution and final
 * TurnStepResult construction from the returned outcome.
 */
export class AiAttackResolver {
  constructor(private readonly deps: AiAttackResolverDeps) {}

  async resolve(params: AiAttackParams): Promise<AiAttackOutcome> {
    const { combat, twoPhaseActions, pendingActions, combatantResolver, events, diceRoller, aiLog } = this.deps;
    const { sessionId, encounterId, aiCombatant, targetCombatant, actorRef, targetRef, attackName, monsterAttacks } = params;

    // Find the chosen attack in the monster's stat block
    const desiredName = (attackName ?? "").trim().toLowerCase();
    const picked = monsterAttacks.find(
      (a: any) => typeof a?.name === "string" && a.name.trim().toLowerCase() === desiredName,
    ) as Record<string, unknown> | undefined;

    if (!picked) {
      return { status: "not_applicable" };
    }

    // ── Extract attack spec from picked attack ──
    const attackBonusBase = typeof picked.attackBonus === "number" ? picked.attackBonus : 0;
    const dmg = typeof picked.damage === "object" && picked.damage !== null
      ? picked.damage as Record<string, unknown>
      : null;
    const diceCount = dmg && typeof dmg.diceCount === "number" ? dmg.diceCount : 1;
    const diceSides = dmg && typeof dmg.diceSides === "number" ? dmg.diceSides : 6;
    const modifier = dmg && typeof dmg.modifier === "number" ? dmg.modifier : 0;

    // ── ActiveEffect integration: advantage/disadvantage + attack bonus + AC bonus ──
    const attackerActiveEffects = getActiveEffects(aiCombatant.resources ?? {});
    const targetActiveEffects = getActiveEffects(targetCombatant.resources ?? {});
    const attackKind: "melee" | "ranged" = (picked as any).kind === "ranged" ? "ranged" : "melee";

    let effectAdvantage = 0;
    let effectDisadvantage = 0;

    // Attacker's self-effects
    if (hasAdvantageFromEffects(attackerActiveEffects, "attack_rolls")) effectAdvantage++;
    if (attackKind === "melee" && hasAdvantageFromEffects(attackerActiveEffects, "melee_attack_rolls")) effectAdvantage++;
    if (attackKind === "ranged" && hasAdvantageFromEffects(attackerActiveEffects, "ranged_attack_rolls")) effectAdvantage++;
    if (hasDisadvantageFromEffects(attackerActiveEffects, "attack_rolls")) effectDisadvantage++;
    if (attackKind === "melee" && hasDisadvantageFromEffects(attackerActiveEffects, "melee_attack_rolls")) effectDisadvantage++;
    if (attackKind === "ranged" && hasDisadvantageFromEffects(attackerActiveEffects, "ranged_attack_rolls")) effectDisadvantage++;

    // Target's effects on incoming attacks (Dodge → disadvantage, Reckless Attack → advantage)
    for (const eff of targetActiveEffects) {
      if (eff.target !== "attack_rolls" && eff.target !== "melee_attack_rolls" && eff.target !== "ranged_attack_rolls") continue;
      if (eff.target === "melee_attack_rolls" && attackKind !== "melee") continue;
      if (eff.target === "ranged_attack_rolls" && attackKind !== "ranged") continue;
      if (!eff.targetCombatantId || eff.targetCombatantId !== targetCombatant.id) continue;
      if (eff.type === "advantage") effectAdvantage++;
      if (eff.type === "disadvantage") effectDisadvantage++;
    }

    // Resolve roll mode from conditions + effects
    const attackerCondNames = normalizeConditions(aiCombatant.conditions as unknown[]).map((c) => c.condition);
    const targetCondNames = normalizeConditions(targetCombatant.conditions as unknown[]).map((c) => c.condition);
    const rollMode = deriveRollModeFromConditions(attackerCondNames, targetCondNames, attackKind, effectAdvantage, effectDisadvantage);

    // Roll d20
    let d20: number;
    if (rollMode === "advantage") {
      const r1 = diceRoller.d20().total;
      const r2 = diceRoller.d20().total;
      d20 = Math.max(r1, r2);
    } else if (rollMode === "disadvantage") {
      const r1 = diceRoller.d20().total;
      const r2 = diceRoller.d20().total;
      d20 = Math.min(r1, r2);
    } else {
      d20 = diceRoller.d20().total;
    }
    const critical = d20 === 20;

    // Attack bonus from ActiveEffects (Bless, etc.)
    const atkBonusResult = calculateBonusFromEffects(attackerActiveEffects, "attack_rolls");
    let effectAtkBonus = atkBonusResult.flatBonus;
    for (const dr of atkBonusResult.diceRolls) {
      const count = Math.abs(dr.count);
      const sign = dr.count < 0 ? -1 : 1;
      for (let i = 0; i < count; i++) {
        effectAtkBonus += sign * diceRoller.rollDie(dr.sides).total;
      }
    }
    const attackBonus = attackBonusBase + effectAtkBonus;
    const attackTotal = d20 + attackBonus;

    console.log(
      `[AiAttackResolver] d20=${d20} + ${attackBonusBase} + effect(${effectAtkBonus}) = ${attackTotal}${rollMode !== "normal" ? ` [${rollMode}]` : ""}`,
    );

    // Get target AC
    const targetResources = normalizeResources(targetCombatant.resources);
    let targetAC: number;
    try {
      const targetStats = await combatantResolver.getCombatStats(targetRef as CombatantRef);
      targetAC = targetStats.armorClass;
    } catch {
      targetAC = typeof targetResources.armorClass === "number" ? (targetResources.armorClass as number) : 10;
    }
    const acBonusFromEffects = calculateFlatBonusFromEffects(targetActiveEffects, "armor_class");
    targetAC += acBonusFromEffects;

    // Initiate attack to check for Shield / Deflect Attacks reaction
    const initiateResult = await twoPhaseActions.initiateAttack(sessionId, {
      encounterId,
      actor: actorRef as CombatantRef,
      target: targetRef as CombatantRef,
      attackName,
      attackRoll: attackTotal,
    });

    // D&D 5e 2024: Rage attack tracking — any attack roll (hit or miss) counts
    {
      const atkRes = normalizeResources(aiCombatant.resources);
      if (atkRes.raging === true) {
        await combat.updateCombatantState(aiCombatant.id, {
          resources: { ...atkRes, rageAttackedThisTurn: true } as any,
        });
      }
    }

    // ── MISS ──
    if (initiateResult.status === "miss") {
      console.log("[AiAttackResolver] Attack missed, no reaction opportunity");

      if (events) {
        await events.append(sessionId, {
          id: nanoid(),
          type: "AttackResolved",
          payload: {
            encounterId,
            attacker: actorRef,
            target: targetRef,
            attackName,
            attackRoll: d20,
            attackBonus,
            attackTotal,
            targetAC,
            hit: false,
            critical: false,
            damageApplied: 0,
          },
        });
      }

      await combat.updateCombatantState(aiCombatant.id, {
        resources: spendAction(aiCombatant.resources),
      });

      return { status: "miss" };
    }

    // ── AWAITING REACTIONS (Shield / Deflect Attacks) ──
    if (initiateResult.status === "awaiting_reactions" && initiateResult.pendingActionId) {
      console.log("[AiAttackResolver] Awaiting player reaction");

      const pendingAction = await pendingActions.getById(initiateResult.pendingActionId);
      if (pendingAction) {
        const attackData = pendingAction.data as any;
        const shieldDmgType = typeof (picked as any).damageType === "string"
          ? (picked as any).damageType
          : undefined;
        attackData.damageSpec = { diceCount, diceSides, modifier, damageType: shieldDmgType };
        attackData.critical = critical;
        attackData.sessionId = sessionId;
        attackData.targetAC = targetAC;
        await pendingActions.update(pendingAction);
      }

      await combat.setPendingAction(encounterId, {
        id: initiateResult.pendingActionId,
        type: "reaction_pending",
        pendingActionId: initiateResult.pendingActionId,
        attackerName: attackName,
        target: targetRef,
        attackRoll: attackTotal,
      });

      await combat.updateCombatantState(aiCombatant.id, {
        resources: spendAction(aiCombatant.resources),
      });

      return {
        status: "awaiting_reactions",
        pendingActionId: initiateResult.pendingActionId,
        attackTotal,
      };
    }

    // ── HIT (no reaction triggered) ──
    if (initiateResult.status === "hit") {
      console.log("[AiAttackResolver] Hit with no reaction, resolving damage");

      const effectiveDiceCount = critical ? diceCount * 2 : diceCount;
      const damageRoll = diceRoller.rollDie(diceSides, effectiveDiceCount, modifier);
      let damageApplied = Math.max(0, damageRoll.total);

      // ActiveEffect: extra damage from attacker (Rage, Hunter's Mark, etc.)
      {
        const dmgEffects = attackerActiveEffects.filter(
          (e) =>
            (e.type === "bonus" || e.type === "penalty") &&
            (e.target === "damage_rolls" ||
              (e.target === "melee_damage_rolls" && attackKind === "melee") ||
              (e.target === "ranged_damage_rolls" && attackKind === "ranged")) &&
            (!e.targetCombatantId || e.targetCombatantId === targetCombatant.id),
        );
        let effectDmgTotal = 0;
        for (const eff of dmgEffects) {
          if (eff.type === "bonus") effectDmgTotal += eff.value ?? 0;
          if (eff.type === "penalty") effectDmgTotal -= eff.value ?? 0;
          if (eff.diceValue) {
            const sign = eff.type === "penalty" ? -1 : 1;
            const count = Math.abs(eff.diceValue.count);
            for (let i = 0; i < count; i++) {
              effectDmgTotal += sign * diceRoller.rollDie(eff.diceValue.sides).total;
            }
          }
        }
        if (effectDmgTotal !== 0) {
          damageApplied = Math.max(0, damageApplied + effectDmgTotal);
        }
      }

      // Apply damage resistance / immunity / vulnerability (stat-block + ActiveEffects)
      const pickedDmgType =
        typeof (picked as any).damageType === "string" ? (picked as any).damageType : undefined;
      if (damageApplied > 0 && pickedDmgType) {
        try {
          const tgtStats = await combatantResolver.getCombatStats(targetRef as CombatantRef);
          const defenses = tgtStats.damageDefenses ? { ...tgtStats.damageDefenses } : ({} as any);

          const effDef = getDamageDefenseEffects(targetActiveEffects, pickedDmgType);
          if (effDef.resistances) {
            defenses.damageResistances = [
              ...new Set([...(defenses.damageResistances ?? []), pickedDmgType.toLowerCase()]),
            ];
          }
          if (effDef.vulnerabilities) {
            defenses.damageVulnerabilities = [
              ...new Set([...(defenses.damageVulnerabilities ?? []), pickedDmgType.toLowerCase()]),
            ];
          }
          if (effDef.immunities) {
            defenses.damageImmunities = [
              ...new Set([...(defenses.damageImmunities ?? []), pickedDmgType.toLowerCase()]),
            ];
          }

          if (defenses.damageResistances || defenses.damageImmunities || defenses.damageVulnerabilities) {
            const defResult = applyDamageDefenses(damageApplied, pickedDmgType, defenses);
            damageApplied = defResult.adjustedDamage;
          }
        } catch {
          /* proceed without defenses */
        }
      }

      if (damageApplied > 0) {
        const hpBefore = targetCombatant.hpCurrent;
        const hpAfter = Math.max(0, hpBefore - damageApplied);
        await combat.updateCombatantState(targetCombatant.id, { hpCurrent: hpAfter });

        await applyKoEffectsIfNeeded(
          targetCombatant,
          hpBefore,
          hpAfter,
          combat,
          (msg) => aiLog(`[KO] ${msg}`),
        );

        if (hpBefore === 0 && targetCombatant.combatantType === "Character") {
          await applyDamageWhileUnconscious(
            targetCombatant,
            damageApplied,
            critical ?? false,
            combat,
            (msg) => aiLog(`[KO] ${msg}`),
          );
        }

        // D&D 5e 2024: Rage damage-taken tracking
        {
          const tgtRes = normalizeResources(targetCombatant.resources);
          if (tgtRes.raging === true) {
            await combat.updateCombatantState(targetCombatant.id, {
              resources: { ...tgtRes, rageDamageTakenThisTurn: true } as any,
            });
          }
        }
      }

      // ActiveEffect: retaliatory damage (Armor of Agathys, Fire Shield)
      if (damageApplied > 0 && attackKind === "melee") {
        const retaliatory = targetActiveEffects.filter((e) => e.type === "retaliatory_damage");
        if (retaliatory.length > 0 && aiCombatant.hpCurrent > 0) {
          let totalRetaliatoryDamage = 0;
          for (const eff of retaliatory) {
            let retDmg = eff.value ?? 0;
            if (eff.diceValue) {
              for (let i = 0; i < eff.diceValue.count; i++) {
                retDmg += diceRoller.rollDie(eff.diceValue.sides).total;
              }
            }
            totalRetaliatoryDamage += retDmg;
            aiLog(`Retaliatory damage (${eff.source ?? "effect"}): ${retDmg} ${eff.damageType ?? ""}`);
          }
          if (totalRetaliatoryDamage > 0) {
            const atkHpBefore = aiCombatant.hpCurrent;
            const atkHpAfter = Math.max(0, atkHpBefore - totalRetaliatoryDamage);
            await combat.updateCombatantState(aiCombatant.id, { hpCurrent: atkHpAfter });
            await applyKoEffectsIfNeeded(
              aiCombatant,
              atkHpBefore,
              atkHpAfter,
              combat,
              (msg) => aiLog(`[KO] ${msg}`),
            );
            aiLog(`Retaliatory damage: ${totalRetaliatoryDamage} to AI attacker (HP: ${atkHpBefore} → ${atkHpAfter})`);
          }
        }
      }

      // Mark action as spent
      await combat.updateCombatantState(aiCombatant.id, {
        resources: spendAction(aiCombatant.resources),
      });

      // Emit AttackResolved + DamageApplied events
      if (events) {
        const hpAfterForEvent = damageApplied > 0
          ? Math.max(0, targetCombatant.hpCurrent - damageApplied)
          : targetCombatant.hpCurrent;
        await events.append(sessionId, {
          id: nanoid(),
          type: "AttackResolved",
          payload: {
            encounterId,
            attacker: actorRef,
            target: targetRef,
            attackName,
            attackRoll: d20,
            attackBonus,
            attackTotal,
            targetAC,
            hit: true,
            critical,
            damageApplied,
          },
        });
        if (damageApplied > 0) {
          await events.append(sessionId, {
            id: nanoid(),
            type: "DamageApplied",
            payload: {
              encounterId,
              target: targetRef as CombatantRef,
              amount: damageApplied,
              hpCurrent: hpAfterForEvent,
              source: attackName,
            },
          });
        }
      }

      // Damage reaction detection (Absorb Elements, Hellish Rebuke, etc.)
      if (damageApplied > 0 && pickedDmgType && targetCombatant.combatantType === "Character") {
        const freshTargetResources = normalizeResources(
          (await combat.listCombatants(encounterId))
            .find((c) => c.id === targetCombatant.id)?.resources ?? targetCombatant.resources,
        );
        const stillHasReaction =
          hasReactionAvailable({ reactionUsed: false, ...freshTargetResources } as any) &&
          !readBoolean(freshTargetResources, "reactionUsed");

        if (stillHasReaction && targetCombatant.hpCurrent - damageApplied > 0) {
          try {
            const tgtStats = await combatantResolver.getCombatStats(targetRef as CombatantRef);
            const dmgInput = {
              className: tgtStats.className?.toLowerCase() ?? "",
              level: tgtStats.level ?? 1,
              abilityScores: (tgtStats.abilityScores ?? {}) as Record<string, number>,
              resources: freshTargetResources,
              hasReaction: true,
              isCharacter: true,
              damageType: pickedDmgType,
              damageAmount: damageApplied,
              attackerId:
                actorRef.type === "Monster"
                  ? (actorRef as any).monsterId
                  : (actorRef as any).characterId ?? "",
            };

            const dmgReactions = detectDamageReactions(dmgInput, getAllCombatTextProfiles());
            if (dmgReactions.length > 0) {
              const dr = dmgReactions[0]!;
              const drResult = await twoPhaseActions.initiateDamageReaction(sessionId, {
                encounterId,
                target: targetRef as CombatantRef,
                attackerId: actorRef as CombatantRef,
                damageType: pickedDmgType,
                damageAmount: damageApplied,
                detectedReaction: dr,
                targetCombatantId: targetCombatant.id,
              });

              if (drResult.status === "awaiting_reactions" && drResult.pendingActionId) {
                await combat.setPendingAction(encounterId, {
                  id: drResult.pendingActionId,
                  type: "reaction_pending",
                  pendingActionId: drResult.pendingActionId,
                  reactionType: dr.reactionType,
                  target: targetRef,
                });

                console.log(`[AiAttackResolver] Damage reaction (${dr.reactionType}) pending`);
                return {
                  status: "awaiting_damage_reaction",
                  pendingActionId: drResult.pendingActionId,
                  damageApplied,
                };
              }
            }
          } catch {
            /* skip damage reaction detection if stats unavailable */
          }
        }
      }

      return { status: "hit", damageApplied };
    }

    // Fallback: unexpected initiateResult status
    return { status: "not_applicable" };
  }
}
