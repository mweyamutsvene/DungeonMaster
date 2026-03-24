/**
 * OpportunityAttackResolver — resolves OA/readied-action attacks during move completion.
 *
 * Extracted from TwoPhaseActionService.completeMove() (Phase: God-Module Decomposition §4a).
 *
 * Given a list of resolved reactions (from the pending-action), rolls attacks,
 * applies ActiveEffect modifiers, resolves damage defenses, applies retaliatory
 * damage, tracks rage, and emits events.
 */

import { nanoid } from "nanoid";
import type { ICombatRepository } from "../../../repositories/combat-repository.js";
import type { IEventRepository } from "../../../repositories/event-repository.js";
import type { ICombatantResolver } from "./combatant-resolver.js";
import type { CombatantRef } from "./combatant-ref.js";
import type {
  PendingAction,
  ReactionOpportunity,
  ReactionResponse,
} from "../../../../domain/entities/combat/pending-action.js";
import { applyDamageDefenses } from "../../../../domain/rules/damage-defenses.js";
import { SeededDiceRoller } from "../../../../domain/rules/dice-roller.js";
import { deriveRollModeFromConditions } from "../tabletop/combat-text-parser.js";
import { normalizeConditions } from "../../../../domain/entities/combat/conditions.js";
import { applyKoEffectsIfNeeded } from "./ko-handler.js";
import {
  normalizeResources,
  getActiveEffects,
} from "./resource-utils.js";
import {
  calculateFlatBonusFromEffects,
  calculateBonusFromEffects,
  hasAdvantageFromEffects,
  hasDisadvantageFromEffects,
  getDamageDefenseEffects,
} from "../../../../domain/entities/combat/effects.js";
import type { JsonValue } from "../../../types.js";

/** Simple string → int32 hash for deterministic OA dice seeding. */
export function hashForOA(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0;
  }
  return hash;
}

export interface OAExecutionResult {
  attackerId: string;
  attackerName: string;
  targetId: string;
  damage: number;
}

export interface ResolveOAInput {
  sessionId: string;
  pendingAction: PendingAction;
  encounter: { id: string; round: number; mapData?: unknown };
  actor: {
    id: string;
    hpCurrent: number;
    hpMax: number;
    resources?: unknown;
    conditions?: unknown;
    characterId?: string | null;
    monsterId?: string | null;
    npcId?: string | null;
    combatantType?: string;
  };
  combatants: readonly any[];
  moveFrom: { x: number; y: number };
}

export interface ResolveOAResult {
  executedOAs: OAExecutionResult[];
  targetStillAlive: boolean;
}

/**
 * Resolve all opportunity attacks / readied actions from a pending move.
 * Returns executed OA results and whether the target survived.
 */
export async function resolveOpportunityAttacks(
  input: ResolveOAInput,
  deps: {
    combat: ICombatRepository;
    combatants: ICombatantResolver;
    events?: IEventRepository;
  },
): Promise<ResolveOAResult> {
  const { sessionId, pendingAction, encounter, actor, combatants } = input;
  const executedOAs: OAExecutionResult[] = [];

  const usedReactions = pendingAction.resolvedReactions.filter(
    (r: ReactionResponse) => r.choice === "use" && r.opportunityId,
  );

  let targetStillAlive = true;

  for (const reaction of usedReactions) {
    const opp = pendingAction.reactionOpportunities.find(
      (o: ReactionOpportunity) => o.id === reaction.opportunityId,
    );

    if (!opp || (opp.reactionType !== "opportunity_attack" && opp.reactionType !== "readied_action")) continue;

    const attacker = combatants.find((c: any) => c.id === reaction.combatantId);
    if (!attacker || attacker.hpCurrent <= 0) continue;

    let hit = false;
    let totalDamage = 0;
    let attackRoll = 0;
    let critical = false;

    // Check if player OA results were already provided (from /combat/move/complete with rolls)
    const storedResult = reaction.result as {
      attackRoll?: number;
      totalAttack?: number;
      hit?: boolean;
      damageRoll?: number;
      totalDamage?: number;
      critical?: boolean;
    } | undefined;

    if (storedResult && storedResult.hit !== undefined) {
      // Use stored player OA results
      hit = storedResult.hit;
      attackRoll = storedResult.totalAttack ?? storedResult.attackRoll ?? 0;
      totalDamage = storedResult.totalDamage ?? 0;
      critical = storedResult.critical ?? false;
    } else {
      // Auto-roll for monster OAs (or player OAs without stored results)
      const attackerRef: CombatantRef =
        attacker.combatantType === "Character" && attacker.characterId ? { type: "Character", characterId: attacker.characterId } :
        attacker.combatantType === "Monster" && attacker.monsterId ? { type: "Monster", monsterId: attacker.monsterId } :
        attacker.combatantType === "NPC" && attacker.npcId ? { type: "NPC", npcId: attacker.npcId } :
        { type: "Character", characterId: "" };
      const attackerStats = await deps.combatants.getCombatStats(attackerRef);

      const strMod = Math.floor((attackerStats.abilityScores.strength - 10) / 2);
      const dexMod = Math.floor((attackerStats.abilityScores.dexterity - 10) / 2);
      const profBonus = attackerStats.proficiencyBonus;
      let attackMod = Math.max(strMod, dexMod) + profBonus;

      // ── ActiveEffect integration for OA ──
      const attackerActiveEffects = getActiveEffects(attacker.resources ?? {});
      const targetActiveEffects = getActiveEffects(actor.resources ?? {});
      const attackKind: "melee" | "ranged" = "melee"; // OAs are always melee

      // Advantage/disadvantage from ActiveEffects
      let effectAdv = 0;
      let effectDisadv = 0;
      if (hasAdvantageFromEffects(attackerActiveEffects, 'attack_rolls')) effectAdv++;
      if (hasAdvantageFromEffects(attackerActiveEffects, 'melee_attack_rolls')) effectAdv++;
      if (hasDisadvantageFromEffects(attackerActiveEffects, 'attack_rolls')) effectDisadv++;
      if (hasDisadvantageFromEffects(attackerActiveEffects, 'melee_attack_rolls')) effectDisadv++;

      // Target's effects on incoming attacks (e.g., Dodge → disadvantage)
      const actorEntityId = actor.characterId ?? actor.monsterId ?? actor.npcId ?? actor.id;
      for (const eff of targetActiveEffects) {
        if (eff.target !== 'attack_rolls' && eff.target !== 'melee_attack_rolls') continue;
        if (!eff.targetCombatantId || eff.targetCombatantId !== actorEntityId) continue;
        if (eff.type === 'advantage') effectAdv++;
        if (eff.type === 'disadvantage') effectDisadv++;
      }

      // Derive roll mode from conditions + effects
      const attackerCondNames = normalizeConditions(attacker.conditions as unknown[]).map((c: any) => c.condition);
      const targetCondNames = normalizeConditions(actor.conditions as unknown[]).map((c: any) => c.condition);
      const rollMode = deriveRollModeFromConditions(attackerCondNames, targetCondNames, attackKind, effectAdv, effectDisadv);

      // Attack bonus from ActiveEffects (Bless, etc.)
      const atkBonusResult = calculateBonusFromEffects(attackerActiveEffects, 'attack_rolls');
      attackMod += atkBonusResult.flatBonus;

      // Create a deterministic dice roller per OA
      const oaSeed = hashForOA(`${encounter.id}:${encounter.round}:${attacker.id}:${actor.id}:oa`);
      const oaDice = new SeededDiceRoller(oaSeed);

      // Pre-roll dice-based attack bonuses
      for (const dr of atkBonusResult.diceRolls) {
        const count = Math.abs(dr.count);
        const sign = dr.count < 0 ? -1 : 1;
        for (let i = 0; i < count; i++) {
          attackMod += sign * oaDice.rollDie(dr.sides).total;
        }
      }

      // Roll d20 (respect advantage/disadvantage)
      const d20Roll1 = oaDice.rollDie(20).total;
      let d20Roll: number;
      if (rollMode === "advantage") {
        const d20Roll2 = oaDice.rollDie(20).total;
        d20Roll = Math.max(d20Roll1, d20Roll2);
      } else if (rollMode === "disadvantage") {
        const d20Roll2 = oaDice.rollDie(20).total;
        d20Roll = Math.min(d20Roll1, d20Roll2);
      } else {
        d20Roll = d20Roll1;
      }

      attackRoll = d20Roll + attackMod;
      critical = d20Roll === 20;

      // Get target AC from resources + ActiveEffect bonuses (Shield of Faith, etc.)
      const actorResources = normalizeResources(actor.resources);
      const baseTargetAC = typeof actorResources.armorClass === "number" ? actorResources.armorClass : 10;
      const acBonusFromEffects = calculateFlatBonusFromEffects(targetActiveEffects, 'armor_class');
      const effectiveTargetAC = baseTargetAC + acBonusFromEffects;

      // Nat 20 always hits, nat 1 always misses
      hit = d20Roll === 20 || (d20Roll !== 1 && attackRoll >= effectiveTargetAC);

      if (hit) {
        // Use monster's actual attack if available, else default 1d8 + ability mod
        let diceSides = 8;
        let diceCount = 1;
        let damageMod = Math.max(strMod, dexMod);
        let oaDamageType: string | undefined;

        if (attacker.combatantType === "Monster" && attacker.monsterId) {
          try {
            const attacks = await deps.combatants.getMonsterAttacks(attacker.monsterId);
            const meleeAttack = attacks.find((a: any) => a && typeof a === 'object' && (a as any).kind !== 'ranged');
            if (meleeAttack && typeof meleeAttack === 'object') {
              const dmg = (meleeAttack as any).damage;
              if (dmg && typeof dmg.diceSides === 'number') diceSides = dmg.diceSides;
              if (dmg && typeof dmg.diceCount === 'number') diceCount = dmg.diceCount;
              if (dmg && typeof dmg.modifier === 'number') damageMod = dmg.modifier;
              if (typeof (meleeAttack as any).damageType === 'string') oaDamageType = (meleeAttack as any).damageType;
            }
          } catch { /* fall back to defaults */ }
        }

        let baseDamage = 0;
        const effectiveDiceCount = critical ? diceCount * 2 : diceCount;
        for (let i = 0; i < effectiveDiceCount; i++) {
          baseDamage += oaDice.rollDie(diceSides).total;
        }
        totalDamage = baseDamage + damageMod;

        // Extra damage from ActiveEffects (Rage, Hunter's Mark, etc.)
        const dmgEffects = attackerActiveEffects.filter(
          (e: any) => (e.type === 'bonus' || e.type === 'penalty')
            && (e.target === 'damage_rolls' || e.target === 'melee_damage_rolls')
            && (!e.targetCombatantId || e.targetCombatantId === actorEntityId),
        );
        for (const eff of dmgEffects) {
          if (eff.type === 'bonus') totalDamage += eff.value ?? 0;
          if (eff.type === 'penalty') totalDamage -= eff.value ?? 0;
          if (eff.diceValue) {
            const sign = eff.type === 'penalty' ? -1 : 1;
            for (let i = 0; i < eff.diceValue.count; i++) {
              totalDamage += sign * oaDice.rollDie(eff.diceValue.sides).total;
            }
          }
        }
        totalDamage = Math.max(0, totalDamage);

        // Damage defense from ActiveEffects (resistance, immunity, vulnerability)
        if (oaDamageType) {
          const effDef = getDamageDefenseEffects(targetActiveEffects, oaDamageType);
          const statDefenses = attackerStats.damageDefenses ?? {};
          const mergedDefenses: any = { ...statDefenses };
          if (effDef.resistances) {
            mergedDefenses.damageResistances = [...new Set([...(mergedDefenses.damageResistances ?? []), oaDamageType.toLowerCase()])];
          }
          if (effDef.vulnerabilities) {
            mergedDefenses.damageVulnerabilities = [...new Set([...(mergedDefenses.damageVulnerabilities ?? []), oaDamageType.toLowerCase()])];
          }
          if (effDef.immunities) {
            mergedDefenses.damageImmunities = [...new Set([...(mergedDefenses.damageImmunities ?? []), oaDamageType.toLowerCase()])];
          }
          if (mergedDefenses.damageResistances || mergedDefenses.damageImmunities || mergedDefenses.damageVulnerabilities) {
            const defResult = applyDamageDefenses(totalDamage, oaDamageType, mergedDefenses);
            totalDamage = defResult.adjustedDamage;
          }
        }
      }
    }

    if (hit && totalDamage > 0) {
      // Apply damage to moving creature
      const oaHpBefore = actor.hpCurrent;
      const newHP = Math.max(0, oaHpBefore - totalDamage);
      await deps.combat.updateCombatantState(actor.id, {
        hpCurrent: newHP,
      });

      // Apply KO effects if character dropped to 0 HP from opportunity attack
      await applyKoEffectsIfNeeded(actor as any, oaHpBefore, newHP, deps.combat);

      // D&D 5e 2024: Rage damage-taken tracking for OA target
      {
        const actorRes = normalizeResources(actor.resources);
        if (actorRes.raging === true) {
          await deps.combat.updateCombatantState(actor.id, {
            resources: { ...actorRes, rageDamageTakenThisTurn: true } as any,
          });
        }
      }

      // ── ActiveEffect: retaliatory damage (Armor of Agathys, Fire Shield) ──
      const targetRetEffects = getActiveEffects(actor.resources ?? {}).filter((e: any) => e.type === 'retaliatory_damage');
      if (targetRetEffects.length > 0 && attacker.hpCurrent > 0) {
        const retSeed = hashForOA(`${encounter.id}:${encounter.round}:${attacker.id}:${actor.id}:oa:ret`);
        const retDice = new SeededDiceRoller(retSeed);
        let totalRetDmg = 0;
        for (const eff of targetRetEffects) {
          let retDmg = eff.value ?? 0;
          if (eff.diceValue) {
            for (let i = 0; i < eff.diceValue.count; i++) {
              retDmg += retDice.rollDie(eff.diceValue.sides).total;
            }
          }
          totalRetDmg += retDmg;
        }
        if (totalRetDmg > 0) {
          const retHpBefore = attacker.hpCurrent;
          const retHpAfter = Math.max(0, retHpBefore - totalRetDmg);
          await deps.combat.updateCombatantState(attacker.id, { hpCurrent: retHpAfter });
          await applyKoEffectsIfNeeded(attacker as any, retHpBefore, retHpAfter, deps.combat);
        }
      }

      const attackerName = await deps.combatants.getName(
        attacker.combatantType === "Character" && attacker.characterId ? { type: "Character", characterId: attacker.characterId } :
        attacker.combatantType === "Monster" && attacker.monsterId ? { type: "Monster", monsterId: attacker.monsterId } :
        attacker.combatantType === "NPC" && attacker.npcId ? { type: "NPC", npcId: attacker.npcId } :
        { type: "Character", characterId: "" },
        attacker,
      );

      executedOAs.push({
        attackerId: attacker.id,
        attackerName,
        targetId: actor.id,
        damage: totalDamage,
      });

      // Emit OA event
      if (deps.events) {
        await deps.events.append(sessionId, {
          id: nanoid(),
          type: "OpportunityAttack",
          payload: {
            encounterId: encounter.id,
            attackerId: attacker.id,
            attackerName,
            targetId: actor.id,
            attackRoll,
            hit: true,
            critical,
            damage: totalDamage,
          },
        });
      }

      // CRITICAL: Check if target died from this OA
      if (newHP <= 0) {
        targetStillAlive = false;
        break; // No more OAs resolve if target is dead
      }
    }

    // Mark reaction as used (and clear readied action if this was a readied reaction)
    const attackerResources = normalizeResources(attacker.resources);
    const updatedAttackerResources: Record<string, unknown> = { ...attackerResources, reactionUsed: true };
    if (opp.reactionType === "readied_action") {
      updatedAttackerResources.readiedAction = undefined;
    }
    await deps.combat.updateCombatantState(attacker.id, {
      resources: updatedAttackerResources as JsonValue,
    });
  }

  return { executedOAs, targetStillAlive };
}
