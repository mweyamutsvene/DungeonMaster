import { nanoid } from "nanoid";

import { resolveAttack, type AttackSpec } from "../../../../domain/combat/attack-resolver.js";
import { SeededDiceRoller } from "../../../../domain/rules/dice-roller.js";
import { concentrationCheckOnDamage } from "../../../../domain/rules/concentration.js";
import {
  getConcentrationSpellName,
  breakConcentration,
  computeConSaveModifier,
} from "../helpers/concentration-helper.js";
import type { INarrativeGenerator } from "../../../../infrastructure/llm/narrative-generator.js";

import { NotFoundError, ValidationError } from "../../../errors.js";
import { normalizeConditions, getExhaustionD20Penalty, isAttackBlockedByCharm } from "../../../../domain/entities/combat/conditions.js";
import {
  canMakeAttack,
  useAttack,
  getActiveEffects,
  normalizeResources,
  getPosition,
} from "../helpers/resource-utils.js";
import {
  hasAdvantageFromEffects,
  hasDisadvantageFromEffects,
  calculateFlatBonusFromEffects,
  calculateBonusFromEffects,
  getDamageDefenseEffects,
} from "../../../../domain/entities/combat/effects.js";
import { applyKoEffectsIfNeeded } from "../helpers/ko-handler.js";
import { deriveRollModeFromConditions } from "../tabletop/combat-text-parser.js";
import type { ICombatRepository } from "../../../repositories/combat-repository.js";
import type { IEventRepository } from "../../../repositories/event-repository.js";
import type { IGameSessionRepository } from "../../../repositories/game-session-repository.js";
import type { CombatantStateRecord } from "../../../types.js";
import type { ICombatantResolver } from "../helpers/combatant-resolver.js";
import { findCombatantStateByRef } from "../helpers/combatant-ref.js";
import { resolveEncounterOrThrow } from "../helpers/encounter-resolver.js";
import { isRecord, readNumber } from "../helpers/json-helpers.js";
import { calculateDistance } from "../../../../domain/rules/movement.js";
import { hasElevationAdvantage, type CombatMap } from "../../../../domain/rules/combat-map.js";
import {
  type AttackActionInput,
  hashStringToInt32,
  buildCreatureAdapter,
  parseAttackSpec,
} from "../helpers/combat-utils.js";

export class AttackActionHandler {
  constructor(
    private readonly sessions: IGameSessionRepository,
    private readonly combat: ICombatRepository,
    private readonly combatants: ICombatantResolver,
    private readonly events?: IEventRepository,
    private readonly narrativeGenerator?: INarrativeGenerator,
  ) {}

  async execute(sessionId: string, input: AttackActionInput): Promise<{ result: unknown; target: CombatantStateRecord; narrative?: string }> {
    const encounter = await resolveEncounterOrThrow(this.sessions, this.combat, sessionId, input.encounterId);
    const combatants = await this.combat.listCombatants(encounter.id);

    const active = combatants[encounter.turn] ?? null;
    if (!active) {
      throw new ValidationError(
        `Encounter turn index out of range: turn=${encounter.turn} combatants=${combatants.length}`,
      );
    }

    const attackerState = findCombatantStateByRef(combatants, input.attacker);
    if (!attackerState) throw new NotFoundError("Attacker not found in encounter");

    if (attackerState.id !== active.id) {
      throw new ValidationError("It is not the attacker's turn");
    }

    if (!canMakeAttack(attackerState.resources)) {
      throw new ValidationError("Attacker has already spent their action this turn");
    }

    const targetState = findCombatantStateByRef(combatants, input.target);
    if (!targetState) throw new NotFoundError("Target not found in encounter");
    if (targetState.hpCurrent <= 0) throw new ValidationError("Target is already defeated");

    // D&D 2024 Charmed: can't attack the charmer
    const attackerConditionsForCharm = normalizeConditions(attackerState.conditions as unknown[]);
    if (isAttackBlockedByCharm(attackerConditionsForCharm, targetState.id)) {
      throw new ValidationError("Cannot attack this target — Charmed condition prevents targeting the charmer");
    }

    if (input.seed !== undefined && !Number.isInteger(input.seed)) {
      throw new ValidationError("seed must be an integer");
    }

    const attackerStats = await this.combatants.getCombatStats(input.attacker);
    const targetStats = await this.combatants.getCombatStats(input.target);

    const attackerAC = attackerStats.armorClass;
    const attackerAbilityScores = attackerStats.abilityScores;
    const attackerFeatIds = attackerStats.featIds;
    const attackerEquippedWeapon = attackerStats.equipment?.weapon;
    const attackerEquippedArmor = attackerStats.equipment?.armor;

    const targetAC = targetStats.armorClass;
    const targetAbilityScores = targetStats.abilityScores;
    const targetEquippedWeapon = targetStats.equipment?.weapon;
    const targetEquippedArmor = targetStats.equipment?.armor;

    let spec: AttackSpec | null = null;

    if (input.spec !== undefined) {
      spec = parseAttackSpec(input.spec);
    }

    if ((input.attacker.type === "Monster" || input.attacker.type === "NPC") && !spec) {
      // Resolve attack from statBlock by name for Monsters and NPCs.
      const attacks = input.attacker.type === "Monster"
        ? await this.combatants.getMonsterAttacks(input.attacker.monsterId)
        : await this.combatants.getAttacks(input.attacker);
      const desiredName = (input.monsterAttackName ?? "").trim().toLowerCase();
      const picked = attacks.find(
        (a: unknown) => isRecord(a) && typeof a.name === "string" && a.name.trim().toLowerCase() === desiredName,
      );

      if (picked && isRecord(picked)) {
        const attackBonus = readNumber(picked, "attackBonus");
        const dmg = isRecord((picked as any).damage) ? ((picked as any).damage as Record<string, unknown>) : null;
        const diceCount = dmg ? readNumber(dmg, "diceCount") : null;
        const diceSides = dmg ? readNumber(dmg, "diceSides") : null;
        const modifierVal = dmg ? (dmg.modifier as unknown) : undefined;

        if (
          attackBonus !== null &&
          Number.isInteger(attackBonus) &&
          diceCount !== null &&
          Number.isInteger(diceCount) &&
          diceCount >= 1 &&
          diceSides !== null &&
          Number.isInteger(diceSides) &&
          diceSides >= 2
        ) {
          const modN = modifierVal === undefined ? 0 : typeof modifierVal === "number" ? modifierVal : null;
          if (modN !== null && Number.isInteger(modN)) {
            const extractedDamageType = typeof (picked as any).damageType === "string" ? (picked as any).damageType : undefined;
            spec = {
              name: typeof (picked as any).name === "string" ? (picked as any).name : undefined,
              kind: ((picked as any).kind === "ranged" ? "ranged" : "melee") as any,
              attackBonus,
              damage: { diceCount, diceSides, modifier: modN },
              damageType: extractedDamageType,
            };
          }
        }
      }
    }

    if (!spec) {
      throw new ValidationError("Attack spec is required (or provide monsterAttackName for monster attackers)");
    }

    const seed =
      (input.seed as number | undefined) ??
      hashStringToInt32(
        `${sessionId}:${encounter.id}:${encounter.round}:${encounter.turn}:${JSON.stringify(input.attacker)}:${JSON.stringify(input.target)}:${JSON.stringify(spec)}`,
      );

    const diceRoller = new SeededDiceRoller(seed);

    // -- ActiveEffect integration: advantage/disadvantage + AC bonus + attack bonus + extra damage + defenses --
    const attackerActiveEffects = getActiveEffects(attackerState.resources ?? {});
    const targetActiveEffects = getActiveEffects(targetState.resources ?? {});
    const attackKind: "melee" | "ranged" = spec.kind === "ranged" ? "ranged" : "melee";

    // Count advantage/disadvantage sources from ActiveEffects
    let effectAdvantage = 0;
    let effectDisadvantage = 0;

    // Attacker's self-effects
    if (hasAdvantageFromEffects(attackerActiveEffects, 'attack_rolls')) effectAdvantage++;
    if (attackKind === 'melee' && hasAdvantageFromEffects(attackerActiveEffects, 'melee_attack_rolls')) effectAdvantage++;
    if (attackKind === 'ranged' && hasAdvantageFromEffects(attackerActiveEffects, 'ranged_attack_rolls')) effectAdvantage++;
    if (hasDisadvantageFromEffects(attackerActiveEffects, 'attack_rolls')) effectDisadvantage++;
    if (attackKind === 'melee' && hasDisadvantageFromEffects(attackerActiveEffects, 'melee_attack_rolls')) effectDisadvantage++;
    if (attackKind === 'ranged' && hasDisadvantageFromEffects(attackerActiveEffects, 'ranged_attack_rolls')) effectDisadvantage++;

    // Target's effects on incoming attacks (e.g., Dodge → disadvantage, Reckless Attack → advantage)
    for (const eff of targetActiveEffects) {
      if (eff.target !== 'attack_rolls' && eff.target !== 'melee_attack_rolls' && eff.target !== 'ranged_attack_rolls') continue;
      if (eff.target === 'melee_attack_rolls' && attackKind !== 'melee') continue;
      if (eff.target === 'ranged_attack_rolls' && attackKind !== 'ranged') continue;
      if (!eff.targetCombatantId || eff.targetCombatantId !== targetState.id) continue;
      if (eff.type === 'advantage') effectAdvantage++;
      if (eff.type === 'disadvantage') effectDisadvantage++;
    }

    // Resolve advantage/disadvantage from conditions + effects
    const attackerConditions = normalizeConditions(attackerState.conditions as unknown[]);
    const targetConditions = normalizeConditions(targetState.conditions as unknown[]);

    // Compute attacker-to-target distance for Prone distance-aware advantage
    const attackerResources = normalizeResources(attackerState.resources);
    const targetResources = normalizeResources(targetState.resources);
    const attackerPos = getPosition(attackerResources);
    const targetPos = getPosition(targetResources);
    const distanceFt = attackerPos && targetPos ? calculateDistance(attackerPos, targetPos) : undefined;
    const combatMap = encounter.mapData as unknown as CombatMap | undefined;
    const elevationAdvantage = combatMap
      ? hasElevationAdvantage(combatMap, attackerPos, targetPos)
      : false;

    const effectRollMode = deriveRollModeFromConditions(attackerConditions, targetConditions, attackKind, effectAdvantage, effectDisadvantage, distanceFt);
    if (!spec.mode || spec.mode === "normal") {
      spec.mode = effectRollMode;
    }

    // D&D 5e 2024: Exhaustion penalty on attack rolls (-2 per exhaustion level)
    const exhaustionPenalty = getExhaustionD20Penalty(attackerConditions);
    if (exhaustionPenalty !== 0) {
      spec.attackBonus += exhaustionPenalty;
    }

    // Attack bonus from ActiveEffects (Bless, etc.)
    const atkBonusResult = calculateBonusFromEffects(attackerActiveEffects, 'attack_rolls');
    spec.attackBonus += atkBonusResult.flatBonus;
    // Pre-roll dice-based attack bonuses and add to flat bonus
    for (const dr of atkBonusResult.diceRolls) {
      const count = Math.abs(dr.count);
      const sign = dr.count < 0 ? -1 : 1;
      for (let i = 0; i < count; i++) {
        spec.attackBonus += sign * diceRoller.rollDie(dr.sides).total;
      }
    }

    // AC bonus from target's ActiveEffects (Shield of Faith, etc.)
    const acBonusFromEffects = calculateFlatBonusFromEffects(targetActiveEffects, 'armor_class');
    const effectAdjustedTargetAC = targetAC + acBonusFromEffects;

    // Extra damage from ActiveEffects (Rage, Hunter's Mark, etc.)
    let effectExtraDamage = 0;
    {
      const dmgEffects = attackerActiveEffects.filter(
        e => (e.type === 'bonus' || e.type === 'penalty')
          && (e.target === 'damage_rolls'
            || (e.target === 'melee_damage_rolls' && attackKind === 'melee')
            || (e.target === 'ranged_damage_rolls' && attackKind === 'ranged'))
          && (!e.targetCombatantId || e.targetCombatantId === targetState.id)
      );
      for (const eff of dmgEffects) {
        if (eff.type === 'bonus') effectExtraDamage += eff.value ?? 0;
        if (eff.type === 'penalty') effectExtraDamage -= eff.value ?? 0;
        if (eff.diceValue) {
          const sign = eff.type === 'penalty' ? -1 : 1;
          const count = Math.abs(eff.diceValue.count);
          for (let i = 0; i < count; i++) {
            effectExtraDamage += sign * diceRoller.rollDie(eff.diceValue.sides).total;
          }
        }
      }
    }
    // Add extra damage to the spec modifier so resolveAttack includes it
    if (effectExtraDamage !== 0) {
      spec.damage = { ...spec.damage, modifier: (spec.damage.modifier ?? 0) + effectExtraDamage };
    }

    // Merge ActiveEffect damage defenses with stat-block defenses
    const mergedDefenses = targetStats.damageDefenses ? { ...targetStats.damageDefenses } : undefined;
    if (spec.damageType) {
      const effDef = getDamageDefenseEffects(targetActiveEffects, spec.damageType);
      if (effDef.resistances || effDef.vulnerabilities || effDef.immunities) {
        const defenses = mergedDefenses ?? {} as any;
        if (effDef.resistances) {
          defenses.damageResistances = [...new Set([...(defenses.damageResistances ?? []), spec.damageType.toLowerCase()])];
        }
        if (effDef.vulnerabilities) {
          defenses.damageVulnerabilities = [...new Set([...(defenses.damageVulnerabilities ?? []), spec.damageType.toLowerCase()])];
        }
        if (effDef.immunities) {
          defenses.damageImmunities = [...new Set([...(defenses.damageImmunities ?? []), spec.damageType.toLowerCase()])];
        }
      }
    }

    const attacker = buildCreatureAdapter({
      armorClass: attackerAC,
      abilityScores: attackerAbilityScores,
      featIds: attackerFeatIds,
      classId: attackerStats.className,
      level: attackerStats.level,
      hpCurrent: attackerState.hpCurrent,
      conditions: attackerConditions.map((c) => String(c.condition)),
    }).creature as unknown as any;

    const targetAdapter = buildCreatureAdapter({
      armorClass: effectAdjustedTargetAC,
      abilityScores: targetAbilityScores,
      hpCurrent: targetState.hpCurrent,
      conditions: targetConditions.map((c) => String(c.condition)),
    });

    const target = targetAdapter.creature as unknown as any;
    const result = resolveAttack(diceRoller, attacker, target, spec, {
      targetDefenses: mergedDefenses,
      elevationAdvantage,
      attackerDistance: distanceFt,
    });

    const newHp = targetAdapter.getHpCurrent();
    console.log(`[ActionService.attack] HP change: ${targetState.hpCurrent} -> ${newHp} (target: ${targetState.id}, combatantType: ${targetState.combatantType})`);
    const updatedTarget = await this.combat.updateCombatantState(targetState.id, { hpCurrent: newHp });
    console.log(`[ActionService.attack] DB updated, returned hpCurrent: ${updatedTarget.hpCurrent}`);

    // Apply KO effects if target dropped to 0 HP
    await applyKoEffectsIfNeeded(targetState, targetState.hpCurrent, newHp, this.combat);

    // -- ActiveEffect: retaliatory damage (Armor of Agathys, Fire Shield) --
    const damageApplied = targetState.hpCurrent - newHp;
    if (damageApplied > 0 && attackKind === "melee") {
      const retaliatory = targetActiveEffects.filter(e => e.type === 'retaliatory_damage');
      if (retaliatory.length > 0 && attackerState.hpCurrent > 0) {
        let totalRetaliatoryDamage = 0;
        for (const eff of retaliatory) {
          let retDmg = eff.value ?? 0;
          if (eff.diceValue) {
            for (let i = 0; i < eff.diceValue.count; i++) {
              retDmg += diceRoller.rollDie(eff.diceValue.sides).total;
            }
          }
          totalRetaliatoryDamage += retDmg;
          console.log(`[ActionService.attack] Retaliatory damage (${eff.source ?? 'effect'}): ${retDmg} ${eff.damageType ?? ''}`);
        }
        if (totalRetaliatoryDamage > 0) {
          const atkHpBefore = attackerState.hpCurrent;
          const atkHpAfter = Math.max(0, atkHpBefore - totalRetaliatoryDamage);
          await this.combat.updateCombatantState(attackerState.id, { hpCurrent: atkHpAfter });
          await applyKoEffectsIfNeeded(attackerState, atkHpBefore, atkHpAfter, this.combat);
          console.log(`[ActionService.attack] Retaliatory damage: ${totalRetaliatoryDamage} to attacker (HP: ${atkHpBefore} → ${atkHpAfter})`);
        }
      }
    }

    await this.combat.updateCombatantState(attackerState.id, {
      resources: useAttack(attackerState.resources),
    });

    let narrative: string | undefined;

    if (this.events) {
      await this.events.append(sessionId, {
        id: nanoid(),
        type: "AttackResolved",
        payload: {
          encounterId: encounter.id,
          attacker: input.attacker,
          target: input.target,
          attackName: spec.name || attackerEquippedWeapon,
          // Flattened fields for easier consumption
          attackRoll: result.attack.d20,
          attackBonus: spec.attackBonus,
          attackTotal: result.attack.total,
          targetAC: targetAC,
          hit: result.hit,
          critical: result.critical,
          damageApplied: result.damage.applied,
          // Full result for backward compatibility
          result,
        },
      });

      if ((result as any).hit && (result as any).damage?.applied > 0) {
        await this.events.append(sessionId, {
          id: nanoid(),
          type: "DamageApplied",
          payload: {
            encounterId: encounter.id,
            target: input.target,
            amount: (result as any).damage.applied,
            hpCurrent: newHp,
          },
        });
      }
    }

    // Concentration check runs unconditionally (not gated on this.events)
    if ((result as any).hit && (result as any).damage?.applied > 0) {
      const concentrationSpellName = getConcentrationSpellName(updatedTarget.resources);
      if (concentrationSpellName) {
        // CON saving throw modifier (ability mod + proficiency if proficient)
        const conSaveMod = computeConSaveModifier(
          targetAbilityScores.constitution,
          targetStats.proficiencyBonus,
          // saveProficiencies not available via CombatantCombatStats yet;
          // fall back to just ability modifier + 0 proficiency override
        );

        const appliedDamage = (result as any).damage.applied as number;
        const checkResult = concentrationCheckOnDamage(
          new SeededDiceRoller(seed + 1000),
          appliedDamage,
          conSaveMod,
        );

        if (!checkResult.maintained) {
          await breakConcentration(
            updatedTarget, encounter.id, this.combat,
          );
        }

        // Emit concentration event if events are configured
        if (this.events) {
          const eventType = checkResult.maintained
            ? "ConcentrationMaintained"
            : "ConcentrationBroken";
          await this.events.append(sessionId, {
            id: nanoid(),
            type: eventType,
            payload: {
              encounterId: encounter.id,
              combatant: input.target,
              spellName: concentrationSpellName,
              dc: checkResult.dc,
              roll: checkResult.check.total,
              damage: appliedDamage,
            },
          });
        }
      }
    }

    if (this.events) {
      // Generate narrative text if a narrative generator is configured
      if (this.narrativeGenerator) {
        try {
          const session = await this.sessions.getById(sessionId);
          const narrativeEvent = {
            type: "AttackResolved",
            weaponName: spec.name || attackerEquippedWeapon,
            attacker: attackerStats.name,
            target: targetStats.name,
            attackerAC: attackerAC,
            targetAC: targetAC,
            attackerArmor: attackerEquippedArmor,
            hit: (result as any).hit,
            critical: (result as any).critical,
            attackRoll: (result as any).attack?.d20,
            attackTotal: (result as any).attack?.total,
            damageApplied: (result as any).damage?.applied,
          };
          narrative = await this.narrativeGenerator.narrate({
            storyFramework: session?.storyFramework ?? {},
            events: [narrativeEvent],
            seed,
          });
        } catch (err) {
          console.error("[ActionService] Attack narration failed:", err);
        }
      }
    }

    return { result, target: updatedTarget, narrative };
  }
}
