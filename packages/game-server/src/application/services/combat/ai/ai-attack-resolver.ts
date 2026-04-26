/**
 * AiAttackResolver - two-phase AI attack resolution (roll-to-hit → roll-damage → apply).
 *
 * Extracted from AiActionExecutor to reduce the god-module size and prevent
 * drift from the tabletop resolution path by centralising the shared logic.
 *
 * Layer: Application
 */

import type { CombatEncounterRecord, CombatantStateRecord } from "../../../types.js";
import type { TwoPhaseActionService } from "../two-phase-action-service.js";
import type { ICombatRepository } from "../../../repositories/index.js";
import type { PendingActionRepository } from "../../../repositories/pending-action-repository.js";
import type { ICombatantResolver } from "../helpers/combatant-resolver.js";
import type { IEventRepository } from "../../../repositories/event-repository.js";
import type { ActorRef } from "./ai-types.js";
import type { CombatantRef } from "../helpers/combatant-ref.js";
import type { DiceRoller } from "../../../../domain/rules/dice-roller.js";
import { nanoid } from "nanoid";
import { normalizeResources, getActiveEffects, readBoolean, useAttack, getPosition } from "../helpers/resource-utils.js";
import { applyKoEffectsIfNeeded, applyDamageWhileUnconscious } from "../helpers/ko-handler.js";
import { breakConcentration, getConcentrationSpellName } from "../helpers/concentration-helper.js";
import { applyDamageWithTempHp, readTempHp, withTempHp } from "../helpers/temp-hp.js";
import { hasReactionAvailable } from "../../../../domain/rules/opportunity-attack.js";
import { applyDamageDefenses } from "../../../../domain/rules/damage-defenses.js";
import type { DamageDefenses } from "../../../../domain/rules/damage-defenses.js";
import {
  hasAdvantageFromEffects,
  hasDisadvantageFromEffects,
  calculateBonusFromEffects,
  calculateFlatBonusFromEffects,
  getDamageDefenseEffects,
} from "../../../../domain/entities/combat/effects.js";
import { normalizeConditions, getExhaustionD20Penalty } from "../../../../domain/entities/combat/conditions.js";
import { calculateDistance } from "../../../../domain/rules/movement.js";
import { deriveRollModeFromConditions } from "../tabletop/combat-text-parser.js";
import { detectDamageReactions, getEligibleOnHitEnhancements } from "../../../../domain/entities/classes/combat-text-profile.js";
import { getAllCombatTextProfiles } from "../../../../domain/entities/classes/registry.js";
import { checkFlanking } from "../../../../domain/rules/flanking.js";
import type { CombatMap } from "../../../../domain/rules/combat-map-types.js";
import { getObscurationAttackModifiers } from "../../../../domain/rules/combat-map-sight.js";
import { resolveReadiedAttackTriggers } from "../helpers/readied-attack-trigger.js";
import { divineSmiteDice } from "../../../../domain/entities/classes/paladin.js";
import { getResourcePools } from "../helpers/resource-utils.js";

type AiLogger = (msg: string) => void;

/** Shape of a monster attack entry from the stat block. */
interface MonsterAttackSpec {
  name: string;
  attackBonus?: number;
  kind?: "melee" | "ranged";
  damageType?: string;
  damage?: {
    diceCount: number;
    diceSides: number;
    modifier: number;
  } | null;
}

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
  /** Optional pre-loaded encounter for flanking/map checks (avoids redundant DB call). */
  encounter?: CombatEncounterRecord;
  /** Optional pre-loaded combatant list for flanking checks (avoids redundant DB call). */
  allCombatants?: CombatantStateRecord[];
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
      (a: unknown) => {
        const entry = a as Record<string, unknown>;
        return typeof entry?.name === "string" && entry.name.trim().toLowerCase() === desiredName;
      },
    ) as MonsterAttackSpec | undefined;

    if (!picked) {
      return { status: "not_applicable" };
    }

    // ── Extract attack spec from picked attack ──
    const attackBonusBase = typeof picked.attackBonus === "number" ? picked.attackBonus : 0;
    const dmg = picked.damage ?? null;
    const diceCount = dmg && typeof dmg.diceCount === "number" ? dmg.diceCount : 1;
    const diceSides = dmg && typeof dmg.diceSides === "number" ? dmg.diceSides : 6;
    const modifier = dmg && typeof dmg.modifier === "number" ? dmg.modifier : 0;

    // ── ActiveEffect integration: advantage/disadvantage + attack bonus + AC bonus ──
    const attackerActiveEffects = getActiveEffects(aiCombatant.resources ?? {});
    const targetActiveEffects = getActiveEffects(targetCombatant.resources ?? {});
    const targetEntityId = targetCombatant.characterId ?? targetCombatant.monsterId ?? targetCombatant.npcId ?? targetCombatant.id;
    const attackKind: "melee" | "ranged" = picked.kind === "ranged" ? "ranged" : "melee";

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
      if (!eff.targetCombatantId) continue;
      if (eff.targetCombatantId !== targetCombatant.id && eff.targetCombatantId !== targetEntityId) continue;
      if (eff.type === "advantage") effectAdvantage++;
      if (eff.type === "disadvantage") effectDisadvantage++;
    }

    // Resolve roll mode from conditions + effects
    const attackerConditions = normalizeConditions(aiCombatant.conditions as unknown[]);
    const targetConditions = normalizeConditions(targetCombatant.conditions as unknown[]);

    // Compute distance for Prone distance-aware advantage
    const aiPos = getPosition(normalizeResources(aiCombatant.resources));
    const tgtPos = getPosition(normalizeResources(targetCombatant.resources));
    const distanceFt = aiPos && tgtPos ? calculateDistance(aiPos, tgtPos) : undefined;

    // D&D 5e 2024 Flanking (optional rule): melee attacks gain advantage when flanking.
    // Prefer pre-loaded encounter/combatants from caller to avoid redundant DB queries.
    const encounter = params.encounter ?? await combat.getEncounterById(encounterId);
    const mapData = encounter?.mapData as unknown as CombatMap | undefined;

    // D&D 5e 2024: Obscuration-based attack modifiers
    if (mapData && aiPos && tgtPos) {
      const obscMods = getObscurationAttackModifiers(mapData, aiPos, tgtPos);
      effectAdvantage += obscMods.advantage;
      effectDisadvantage += obscMods.disadvantage;
    }

    if (attackKind === "melee" && aiPos && tgtPos) {
      if (mapData?.flankingEnabled) {
        const allCombatants = params.allCombatants ?? await combat.listCombatants(encounterId);
        const attackerFaction = this.getActorFaction(aiCombatant);
        const allyPositions: Array<{ x: number; y: number }> = [];
        for (const c of allCombatants) {
          if (c.id === aiCombatant.id || c.id === targetCombatant.id) continue;
          if (c.hpCurrent <= 0) continue;
          if (this.getActorFaction(c) !== attackerFaction) continue;
          const cPos = getPosition(normalizeResources(c.resources));
          if (cPos) allyPositions.push(cPos);
        }
        if (checkFlanking(aiPos, tgtPos, allyPositions)) {
          effectAdvantage++;
          aiLog(`[AiAttackResolver] Flanking detected → advantage on melee attack`);
        }
      }
    }

    const rollMode = deriveRollModeFromConditions(attackerConditions, targetConditions, attackKind, effectAdvantage, effectDisadvantage, distanceFt);

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
    const attackBonus = attackBonusBase + effectAtkBonus + getExhaustionD20Penalty(attackerConditions);
    const attackTotal = d20 + attackBonus;

    aiLog(`[AiAttackResolver] d20=${d20} + ${attackBonusBase} + effect(${effectAtkBonus}) = ${attackTotal}${rollMode !== "normal" ? ` [${rollMode}]` : ""}`);

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
          resources: { ...atkRes, rageAttackedThisTurn: true },
        });
      }
    }

    // ── MISS ──
    if (initiateResult.status === "miss") {
      aiLog("[AiAttackResolver] Attack missed, no reaction opportunity");

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
        resources: useAttack(aiCombatant.resources),
      });

      // Readied action triggers: "creature_attacks" fires even on a miss
      await resolveReadiedAttackTriggers(sessionId, encounterId, aiCombatant.id, {
        combat, combatants: combatantResolver, events,
      });

      return { status: "miss" };
    }

    // ── AWAITING REACTIONS (Shield / Deflect Attacks) ──
    if (initiateResult.status === "awaiting_reactions" && initiateResult.pendingActionId) {
      aiLog("[AiAttackResolver] Awaiting player reaction");

      const pendingAction = await pendingActions.getById(initiateResult.pendingActionId);
      if (pendingAction) {
        const attackData = pendingAction.data as unknown as Record<string, unknown>;
        const shieldDmgType = typeof picked.damageType === "string"
          ? picked.damageType
          : undefined;
        attackData.damageSpec = { diceCount, diceSides, modifier, damageType: shieldDmgType };
        attackData.critical = critical;
        attackData.sessionId = sessionId;
        attackData.targetAC = targetAC;
        attackData.d20Roll = d20;
        attackData.attackBonus = attackBonus;
        attackData.attackTotal = attackTotal;
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
        resources: useAttack(aiCombatant.resources),
      });

      return {
        status: "awaiting_reactions",
        pendingActionId: initiateResult.pendingActionId,
        attackTotal,
      };
    }

    // ── HIT (no reaction triggered) ──
    if (initiateResult.status === "hit") {
      aiLog("[AiAttackResolver] Hit with no reaction, resolving damage");

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
            (!e.targetCombatantId || e.targetCombatantId === targetCombatant.id || e.targetCombatantId === targetEntityId),
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

      // AI2-M7: Divine Smite / on-hit enhancements for AI paladins (and other classes)
      // Check if the attacker has on-hit enhancements available (Divine Smite, etc.)
      if (attackKind === "melee") {
        try {
          const attackerStats = await combatantResolver.getCombatStats(actorRef as CombatantRef);
          const className = attackerStats.className?.toLowerCase() ?? "";
          const level = attackerStats.level ?? 1;
          const attackerRes = normalizeResources(aiCombatant.resources);
          const pools = getResourcePools(aiCombatant.resources);

          // Check for Divine Smite eligibility (Paladin level 2+)
          if (className === "paladin" && level >= 2) {
            // Find the highest spell slot available (use highest on crits, lowest otherwise)
            const spellSlots = pools
              .filter(p => /^spellSlot_\d+$/i.test(p.name) && p.current > 0)
              .map(p => ({
                pool: p,
                level: parseInt(p.name.replace(/^spellSlot_/i, ""), 10),
              }))
              .sort((a, b) => critical ? b.level - a.level : a.level - b.level);

            if (spellSlots.length > 0) {
              const chosen = spellSlots[0]!;
              const smiteDiceCount = divineSmiteDice(chosen.level);
              const effectiveDice = critical ? smiteDiceCount * 2 : smiteDiceCount;
              const smiteDamage = diceRoller.rollDie(8, effectiveDice).total;
              damageApplied += smiteDamage;
              aiLog(`[AiAttackResolver] Divine Smite (L${chosen.level} slot): ${effectiveDice}d8 = ${smiteDamage} radiant damage${critical ? " (crit!)" : ""}`);

              // Spend the spell slot
              const updatedPools = pools.map(p =>
                p.name === chosen.pool.name ? { ...p, current: p.current - 1 } : p,
              );
              await combat.updateCombatantState(aiCombatant.id, {
                resources: { ...attackerRes, resourcePools: updatedPools },
              });
            }
          }

          // Check other on-hit enhancements via combat text profiles
          const eligible = getEligibleOnHitEnhancements(
            attackKind,
            className,
            level,
            attackerRes,
            pools,
            getAllCombatTextProfiles(),
            undefined, // bonusAction
            undefined, // subclass — CombatantCombatStats doesn't carry subclass
          );
          for (const enh of eligible) {
            if (enh.keyword === "divine-smite") continue; // Already handled above
            aiLog(`[AiAttackResolver] On-hit enhancement available: ${enh.displayName} (not auto-applied — requires player choice)`);
          }
        } catch {
          /* proceed without enhancements if stats unavailable */
        }
      }

      // Apply damage resistance / immunity / vulnerability (stat-block + ActiveEffects)
      const pickedDmgType = picked.damageType;
      if (damageApplied > 0 && pickedDmgType) {
        try {
          const tgtStats = await combatantResolver.getCombatStats(targetRef as CombatantRef);
          const defenses: DamageDefenses = tgtStats.damageDefenses ? { ...tgtStats.damageDefenses } : {};

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

      let actualHpAfter = targetCombatant.hpCurrent;
      if (damageApplied > 0) {
        const hpBefore = targetCombatant.hpCurrent;
        const tempBefore = readTempHp(targetCombatant.resources);
        const abs = applyDamageWithTempHp(hpBefore, tempBefore, damageApplied);
        const hpAfter = abs.hpAfter;
        actualHpAfter = hpAfter;
        await combat.updateCombatantState(targetCombatant.id, { hpCurrent: hpAfter });
        if (abs.tempAbsorbed > 0 || tempBefore > 0) {
          const updatedRes = withTempHp(targetCombatant.resources, abs.tempHpAfter);
          await combat.updateCombatantState(targetCombatant.id, { resources: updatedRes as any });
          aiLog(`Temp HP absorbed ${abs.tempAbsorbed} of ${damageApplied} damage (tempHp ${tempBefore} → ${abs.tempHpAfter}).`);
        }

        await applyKoEffectsIfNeeded(
          targetCombatant,
          hpBefore,
          hpAfter,
          combat,
          (msg) => aiLog(`[KO] ${msg}`),
        );

        // D&D 5e 2024: Unconscious/0 HP ends concentration immediately.
        if (hpAfter === 0) {
          const spellName = getConcentrationSpellName(targetCombatant.resources);
          if (spellName) {
            await breakConcentration(targetCombatant, encounterId, combat, (msg) => aiLog(`[KO] ${msg}`));
          }
        }

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
              resources: { ...tgtRes, rageDamageTakenThisTurn: true },
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
            if (atkHpAfter === 0) {
              const spellName = getConcentrationSpellName(aiCombatant.resources);
              if (spellName) {
                await breakConcentration(aiCombatant, encounterId, combat, (msg) => aiLog(`[KO] ${msg}`));
              }
            }
            aiLog(`Retaliatory damage: ${totalRetaliatoryDamage} to AI attacker (HP: ${atkHpBefore} → ${atkHpAfter})`);
          }
        }
      }

      // Mark attack as used (respects multiattack counter)
      await combat.updateCombatantState(aiCombatant.id, {
        resources: useAttack(aiCombatant.resources),
      });

      // Emit AttackResolved + DamageApplied events
      if (events) {
        const hpAfterForEvent = damageApplied > 0
          ? actualHpAfter
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
          hasReactionAvailable({ reactionUsed: readBoolean(freshTargetResources, "reactionUsed") ?? false }) &&
          !readBoolean(freshTargetResources, "reactionUsed");

        if (stillHasReaction && actualHpAfter > 0) {
          try {
            const tgtStats = await combatantResolver.getCombatStats(targetRef as CombatantRef);
            const attackerEntityId =
              actorRef.type === "Monster" ? actorRef.monsterId
              : actorRef.type === "Character" ? actorRef.characterId
              : actorRef.npcId;
            const dmgInput = {
              className: tgtStats.className?.toLowerCase() ?? "",
              level: tgtStats.level ?? 1,
              abilityScores: (tgtStats.abilityScores ?? {}) as Record<string, number>,
              resources: freshTargetResources,
              hasReaction: true,
              isCharacter: true,
              damageType: pickedDmgType,
              damageAmount: damageApplied,
              attackerId: attackerEntityId,
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

                aiLog(`[AiAttackResolver] Damage reaction (${dr.reactionType}) pending`);
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

      // Readied action triggers: "creature_attacks" fires after attack resolves
      await resolveReadiedAttackTriggers(sessionId, encounterId, aiCombatant.id, {
        combat, combatants: combatantResolver, events,
      });

      return { status: "hit", damageApplied };
    }

    // Fallback: unexpected initiateResult status
    return { status: "not_applicable" };
  }

  private getActorFaction(combatant: CombatantStateRecord): string {
    const char = combatant.character;
    const mon = combatant.monster;
    const npc = combatant.npc;
    if (char?.faction) return char.faction;
    if (mon?.faction) return mon.faction;
    if (npc?.faction) return npc.faction;
    const resFaction = (combatant.resources as Record<string, unknown> | null)?.faction;
    if (typeof resFaction === "string") return resFaction;
    if (combatant.combatantType === "Character") return "party";
    if (combatant.combatantType === "NPC") return "party";
    return "enemies";
  }
}
