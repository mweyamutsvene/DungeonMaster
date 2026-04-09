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
import type { ICharacterRepository } from "../../../repositories/character-repository.js";
import type { IMonsterRepository } from "../../../repositories/monster-repository.js";
import type { INPCRepository } from "../../../repositories/npc-repository.js";
import type { ICombatantResolver } from "./combatant-resolver.js";
import type { CombatantRef } from "./combatant-ref.js";
import type {
  PendingAction,
  ReactionOpportunity,
  ReactionResponse,
} from "../../../../domain/entities/combat/pending-action.js";
import { applyDamageDefenses } from "../../../../domain/rules/damage-defenses.js";
import { SeededDiceRoller, type DiceRoller } from "../../../../domain/rules/dice-roller.js";
import { deriveRollModeFromConditions } from "../tabletop/combat-text-parser.js";
import { normalizeConditions, getExhaustionD20Penalty } from "../../../../domain/entities/combat/conditions.js";
import { applyKoEffectsIfNeeded } from "./ko-handler.js";
import {
  normalizeResources,
  getActiveEffects,
  getPosition,
} from "./resource-utils.js";
import { getObscurationAttackModifiers } from "../../../../domain/rules/combat-map-sight.js";
import type { CombatMap } from "../../../../domain/rules/combat-map-types.js";
import {
  calculateFlatBonusFromEffects,
  calculateBonusFromEffects,
  hasAdvantageFromEffects,
  hasDisadvantageFromEffects,
  getDamageDefenseEffects,
} from "../../../../domain/entities/combat/effects.js";
import type { JsonValue } from "../../../types.js";
import { resolveSpell } from "./spell-slot-manager.js";
import { prepareSpellCast } from "./spell-slot-manager.js";
import { isEligibleWarCasterSpell } from "../../../../domain/rules/war-caster-oa.js";
import { AiSpellDelivery, findSpellDefinition } from "../ai/handlers/ai-spell-delivery.js";

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
 * Optional deps for resolving War Caster spell-as-OA.
 * When present, spell-type OA reactions will use spell delivery instead of weapon attacks.
 */
export interface SpellOaDeps {
  characters: ICharacterRepository;
  monsters: IMonsterRepository;
  npcs: INPCRepository;
  diceRoller: DiceRoller;
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
    spellOaDeps?: SpellOaDeps;
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

    // ── War Caster spell-as-OA branch ──
    if (opp.oaType === "spell" && deps.spellOaDeps) {
      const spellResult = await resolveSpellOA(
        sessionId, encounter, attacker, actor, reaction, opp, deps,
      );
      if (spellResult) {
        executedOAs.push(spellResult.oaResult);
        if (!spellResult.targetStillAlive) {
          targetStillAlive = false;
        }
        // Mark reaction as used
        const attackerResources = normalizeResources(attacker.resources);
        await deps.combat.updateCombatantState(attacker.id, {
          resources: { ...attackerResources, reactionUsed: true } as JsonValue,
        });
        if (!targetStillAlive) break;
        continue;
      }
      // If spell OA resolution failed (no spell specified, invalid spell, etc.),
      // fall through to weapon OA as fallback
    }

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
      const attackerActiveConditions = normalizeConditions(attacker.conditions as unknown[]);
      const attackerCondNames = attackerActiveConditions.map((c: any) => c.condition);
      const targetCondNames = normalizeConditions(actor.conditions as unknown[]).map((c: any) => c.condition);

      // OA distance: compute from positions (melee, typically ≤5ft)
      const oaAttackerPos = getPosition(normalizeResources(attacker.resources));
      const oaTargetPos = getPosition(normalizeResources(actor.resources));
      const oaDistanceFt = oaAttackerPos && oaTargetPos
        ? Math.hypot(oaTargetPos.x - oaAttackerPos.x, oaTargetPos.y - oaAttackerPos.y)
        : 5; // Default to 5ft for OAs (they're leaving reach)

      // D&D 5e 2024: Obscuration-based attack modifiers
      const oaMapData = encounter.mapData as CombatMap | undefined;
      if (oaMapData && oaAttackerPos && oaTargetPos) {
        const obscMods = getObscurationAttackModifiers(oaMapData, oaAttackerPos, oaTargetPos);
        effectAdv += obscMods.advantage;
        effectDisadv += obscMods.disadvantage;
      }

      const rollMode = deriveRollModeFromConditions(attackerCondNames, targetCondNames, attackKind, effectAdv, effectDisadv, oaDistanceFt);

      // D&D 5e 2024: Exhaustion penalty on attack rolls
      const oaExhaustionPenalty = getExhaustionD20Penalty(attackerActiveConditions);
      if (oaExhaustionPenalty !== 0) {
        attackMod += oaExhaustionPenalty;
      }

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

// ── War Caster spell OA resolution ──

interface SpellOAResult {
  oaResult: OAExecutionResult;
  targetStillAlive: boolean;
}

/**
 * Resolve a War Caster spell-as-opportunity-attack.
 *
 * Uses the spell name from the reaction result (player-specified or AI-selected).
 * Falls back to null if the spell cannot be resolved, allowing weapon OA fallback.
 */
async function resolveSpellOA(
  sessionId: string,
  encounter: { id: string; round: number; mapData?: unknown },
  attacker: any,
  actor: any,
  reaction: ReactionResponse,
  opp: ReactionOpportunity,
  deps: {
    combat: ICombatRepository;
    combatants: ICombatantResolver;
    events?: IEventRepository;
    spellOaDeps?: SpellOaDeps;
  },
): Promise<SpellOAResult | null> {
  if (!deps.spellOaDeps) return null;

  // Get spell name from reaction result
  const storedResult = reaction.result as Record<string, unknown> | undefined;
  const spellName = storedResult?.spellName as string | undefined;
  if (!spellName) return null;

  // Resolve spell definition — try catalog first, then character sheet
  const attackerRef: CombatantRef =
    attacker.combatantType === "Character" && attacker.characterId
      ? { type: "Character", characterId: attacker.characterId }
      : attacker.combatantType === "Monster" && attacker.monsterId
        ? { type: "Monster", monsterId: attacker.monsterId }
        : attacker.combatantType === "NPC" && attacker.npcId
          ? { type: "NPC", npcId: attacker.npcId }
          : { type: "Character", characterId: "" };

  // Get the caster's source data (character sheet or stat block)
  let casterSource: Record<string, unknown> = {};
  if (attacker.characterId) {
    const char = await deps.spellOaDeps.characters.getById(attacker.characterId);
    if (char) casterSource = (char.sheet ?? {}) as Record<string, unknown>;
  } else if (attacker.monsterId) {
    const mon = await deps.spellOaDeps.monsters.getById(attacker.monsterId);
    if (mon) casterSource = (mon.statBlock ?? mon) as Record<string, unknown>;
  } else if (attacker.npcId) {
    const npc = await deps.spellOaDeps.npcs.getById(attacker.npcId);
    if (npc) casterSource = ((npc as any).sheet ?? (npc as any).statBlock ?? {}) as Record<string, unknown>;
  }

  // Resolve spell from catalog (shared with tabletop path) or from caster source
  const spellDef = resolveSpell(spellName, casterSource) ?? findSpellDefinition(casterSource, spellName);
  if (!spellDef) return null;

  // Validate War Caster eligibility
  if (!isEligibleWarCasterSpell(spellDef)) return null;

  // Spend spell slot + handle concentration (cantrips skip this)
  const castAtLevel = storedResult?.castAtLevel as number | undefined;
  if (spellDef.level > 0) {
    try {
      await prepareSpellCast(
        attacker.id,
        encounter.id,
        spellName,
        spellDef.level,
        spellDef.concentration ?? false,
        deps.combat,
        undefined,
        castAtLevel,
      );
    } catch {
      // No spell slot available — fall back to weapon OA
      return null;
    }
  }

  // Deliver spell effects via AiSpellDelivery (handles all delivery modes)
  const delivery = new AiSpellDelivery({
    combat: deps.combat,
    characters: deps.spellOaDeps.characters,
    monsters: deps.spellOaDeps.monsters,
    npcs: deps.spellOaDeps.npcs,
    diceRoller: deps.spellOaDeps.diceRoller,
  });

  // The target of the spell is the moving creature (actor)
  const result = await delivery.deliver(
    sessionId,
    encounter.id,
    attacker,
    spellDef,
    actor,
    undefined,
    castAtLevel ?? (spellDef.level > 0 ? spellDef.level : undefined),
    casterSource,
  );

  // Calculate damage from post-delivery HP change
  const updatedActor = (await deps.combat.listCombatants(encounter.id))
    .find((c: any) => c.id === actor.id);
  const hpAfter = updatedActor?.hpCurrent ?? actor.hpCurrent;
  const damage = Math.max(0, actor.hpCurrent - hpAfter);

  const attackerName = await deps.combatants.getName(attackerRef, attacker);

  const oaResult: OAExecutionResult = {
    attackerId: attacker.id,
    attackerName,
    targetId: actor.id,
    damage,
  };

  // Emit spell OA event
  if (deps.events) {
    await deps.events.append(sessionId, {
      id: nanoid(),
      type: "OpportunityAttack",
      payload: {
        encounterId: encounter.id,
        attackerId: attacker.id,
        attackerName,
        targetId: actor.id,
        spellName,
        spellOA: true,
        damage,
        summary: result.summary,
      },
    });
  }

  // D&D 5e 2024: Rage damage-taken tracking for OA target
  if (damage > 0) {
    const actorRes = normalizeResources(actor.resources);
    if (actorRes.raging === true) {
      await deps.combat.updateCombatantState(actor.id, {
        resources: { ...actorRes, rageDamageTakenThisTurn: true } as any,
      });
    }
  }

  return {
    oaResult,
    targetStillAlive: hpAfter > 0,
  };
}
