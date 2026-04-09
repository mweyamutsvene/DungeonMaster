/**
 * DamageResolver — handles all damage-roll resolution for tabletop combat.
 *
 * Responsibilities:
 *   - Base damage calculation + modifier
 *   - ActiveEffect bonus/penalty damage
 *   - Damage resistance/vulnerability/immunity
 *   - HP reduction, KO effects, death save auto-fails
 *   - Rage damage tracking + rage end on KO
 *   - Concentration checks after damage
 *   - Retaliatory damage (Armor of Agathys, Fire Shield)
 *   - Sneak Attack used tracking
 *   - Weapon mastery on-hit effects
 *   - Hit-rider enhancement resolution (Stunning Strike, Divine Smite, OHT)
 *   - Flurry/spell-strike chaining
 *   - Victory evaluation + loot drop
 *   - Thrown weapon drop on ground
 *
 * Extracted from RollStateMachine.handleDamageRoll (CO-M4).
 */

import { nanoid } from "nanoid";
import { ValidationError } from "../../../../errors.js";
import type {
  SessionCharacterRecord,
  SessionMonsterRecord,
  SessionNPCRecord,
  CombatEncounterRecord,
} from "../../../../types.js";
import {
  normalizeResources,
  getActiveEffects,
  setActiveEffects,
  getPosition,
} from "../../helpers/resource-utils.js";
import {
  getDamageDefenseEffects,
  type ActiveEffect,
} from "../../../../../domain/entities/combat/effects.js";
import { applyKoEffectsIfNeeded, applyDamageWhileUnconscious } from "../../helpers/ko-handler.js";
import { applyDamageDefenses, extractDamageDefenses } from "../../../../../domain/rules/damage-defenses.js";
import type { CombatVictoryStatus } from "../../combat-victory-policy.js";
import { parseDamageModifier } from "../combat-text-parser.js";
import type { TabletopEventEmitter } from "../tabletop-event-emitter.js";
import { concentrationCheckOnDamage } from "../../../../../domain/rules/concentration.js";
import {
  getConcentrationSpellName,
  breakConcentration,
  computeConSaveModifier,
} from "../../helpers/concentration-helper.js";
import { addGroundItem } from "../../../../../domain/rules/combat-map.js";
import type { CombatMap } from "../../../../../domain/rules/combat-map.js";
import type { GroundItem } from "../../../../../domain/entities/items/ground-item.js";
import type {
  TabletopCombatServiceDeps,
  AttackPendingAction,
  DamagePendingAction,
  DamageResult,
  HitRiderEnhancementResult,
} from "../tabletop-types.js";
import type { RollResultCommand } from "../../../../commands/game-command.js";
import type { WeaponMasteryResolver } from "./weapon-mastery-resolver.js";
import type { HitRiderResolver } from "./hit-rider-resolver.js";
import { findCombatantByEntityId, getEntityId } from "../../helpers/combatant-lookup.js";

export class DamageResolver {
  constructor(
    private readonly deps: TabletopCombatServiceDeps,
    private readonly eventEmitter: TabletopEventEmitter,
    private readonly hitRiderResolver: HitRiderResolver,
    private readonly weaponMasteryResolver: WeaponMasteryResolver,
    private readonly debugLogsEnabled: boolean,
  ) {}

  /**
   * Resolve a damage roll result: apply damage, trigger effects, check victory.
   *
   * This is the full damage resolution pipeline extracted from RollStateMachine.
   */
  async resolve(
    sessionId: string,
    encounter: CombatEncounterRecord,
    action: DamagePendingAction,
    command: RollResultCommand,
    actorId: string,
    characters: SessionCharacterRecord[],
    monsters: SessionMonsterRecord[],
    npcs: SessionNPCRecord[],
    rawText?: string,
  ): Promise<DamageResult> {
    const rollValue = command.value ?? (Array.isArray(command.values) ? command.values[0] : 0);

    const target =
      monsters.find((m) => m.id === action.targetId) ||
      characters.find((c) => c.id === action.targetId) ||
      npcs.find((n) => n.id === action.targetId);

    if (!target) {
      throw new ValidationError("Target not found");
    }

    // --- 2024 On-Hit Enhancement: match player opt-in keywords in damage text ---
    // Player includes keywords like "with stunning strike" or "with topple" in damage text.
    // Enhancement assembly is delegated to HitRiderResolver.
    if (rawText && !action.enhancements) {
      const enhancements = await this.hitRiderResolver.assembleOnHitEnhancements({
        rawText,
        actorId,
        encounterId: encounter.id,
        characters,
        weaponSpec: action.weaponSpec,
        bonusAction: action.bonusAction,
      });
      if (enhancements.length > 0) {
        action.enhancements = enhancements;
        if (this.debugLogsEnabled) console.log(`[DamageResolver] On-hit enhancements from damage text: ${enhancements.map((e) => e.displayName).join(", ")}`);
      }
    }

    const damageModifier = parseDamageModifier(action.weaponSpec?.damageFormula, action.weaponSpec?.damage?.modifier);
    let totalDamage = rollValue + damageModifier;

    // ── ActiveEffect: extra damage (flat + dice) ──
    // Includes Rage melee damage bonus, Hunter's Mark, etc.
    const actorCombatant = findCombatantByEntityId(
      await this.deps.combatRepo.listCombatants(encounter.id), action.actorId,
    );
    const actorRes = actorCombatant?.resources ?? {} as Record<string, unknown>;
    {
      const attackerEffects = getActiveEffects(actorCombatant?.resources ?? {});
      const targetId = action.targetId;
      const isMelee = action.weaponSpec?.kind === "melee";
      const isRanged = action.weaponSpec?.kind === "ranged";
      // Filter for damage_rolls effects, honouring targetCombatantId for Hunter's Mark etc.
      // Also match melee/ranged-specific damage effects
      const dmgEffects = attackerEffects.filter(
        e => (e.type === 'bonus' || e.type === 'penalty')
          && (e.target === 'damage_rolls'
            || (e.target === 'melee_damage_rolls' && isMelee)
            || (e.target === 'ranged_damage_rolls' && isRanged))
          && (!e.targetCombatantId || e.targetCombatantId === targetId)
      );
      let effectFlatDmg = 0;
      let effectDiceDmg = 0;
      for (const eff of dmgEffects) {
        if (eff.type === 'bonus') effectFlatDmg += eff.value ?? 0;
        if (eff.type === 'penalty') effectFlatDmg -= eff.value ?? 0;
        if (eff.diceValue && this.deps.diceRoller) {
          const sign = eff.type === 'penalty' ? -1 : 1;
          const count = Math.abs(eff.diceValue.count);
          for (let i = 0; i < count; i++) {
            effectDiceDmg += sign * this.deps.diceRoller.rollDie(eff.diceValue.sides).total;
          }
        }
      }
      const effectDmgTotal = effectFlatDmg + effectDiceDmg;
      if (effectDmgTotal !== 0) {
        totalDamage = Math.max(0, totalDamage + effectDmgTotal);
        if (this.debugLogsEnabled) console.log(`[DamageResolver] ActiveEffect damage bonus: +${effectFlatDmg} flat, +${effectDiceDmg} dice (total now ${totalDamage})`);
      }
    }

    // Apply damage resistance/immunity/vulnerability
    const damageType = action.weaponSpec?.damageType;
    if (totalDamage > 0 && damageType) {
      const targetSheet = (target as any).statBlock ?? (target as any).sheet ?? {};
      const defenses = extractDamageDefenses(targetSheet);

      // ── ActiveEffect: damage defense modifiers (resistance/vulnerability/immunity) ──
      // Includes Rage B/P/S resistance, spell-granted resistances, etc.
      const targetCombatantForDefenses = findCombatantByEntityId(
        await this.deps.combatRepo.listCombatants(encounter.id),
        action.targetId,
      );
      if (targetCombatantForDefenses) {
        const tgtEffects = getActiveEffects(targetCombatantForDefenses.resources ?? {});
        const effDef = getDamageDefenseEffects(tgtEffects, damageType);
        if (effDef.resistances) {
          const existing = defenses.damageResistances ?? [];
          defenses.damageResistances = [...new Set([...existing, damageType.toLowerCase()])];
        }
        if (effDef.vulnerabilities) {
          const existing = defenses.damageVulnerabilities ?? [];
          defenses.damageVulnerabilities = [...new Set([...existing, damageType.toLowerCase()])];
        }
        if (effDef.immunities) {
          const existing = defenses.damageImmunities ?? [];
          defenses.damageImmunities = [...new Set([...existing, damageType.toLowerCase()])];
        }
      }

      if (defenses.damageResistances || defenses.damageImmunities || defenses.damageVulnerabilities) {
        const defResult = applyDamageDefenses(totalDamage, damageType, defenses);
        totalDamage = defResult.adjustedDamage;
        if (this.debugLogsEnabled) console.log(`[DamageResolver] Damage defense: ${defResult.defenseApplied} (${damageType}) ${defResult.originalDamage} → ${totalDamage}`);
      }
    }

    // Apply damage
    const combatantStates = await this.deps.combatRepo.listCombatants(encounter.id);
    const targetCombatant = findCombatantByEntityId(combatantStates, action.targetId);

    const hpBefore = targetCombatant?.hpCurrent ?? 0;
    let hpAfter = hpBefore;

    if (targetCombatant) {
      hpAfter = Math.max(0, targetCombatant.hpCurrent - totalDamage);
      if (this.debugLogsEnabled) console.log(`[DamageResolver] HP change: ${hpBefore} -> ${hpAfter} (target: ${targetCombatant.id}, damage: ${totalDamage})`);
      await this.deps.combatRepo.updateCombatantState(targetCombatant.id, { hpCurrent: hpAfter });
      await this.eventEmitter.emitDamageEvents(sessionId, encounter.id, actorId, action.targetId, characters, monsters, totalDamage, hpAfter);

      // D&D 5e 2024: Rage damage-taken tracking — track when a raging creature takes damage
      if (totalDamage > 0) {
        const targetRes = normalizeResources(targetCombatant.resources);
        if (targetRes.raging === true) {
          await this.deps.combatRepo.updateCombatantState(targetCombatant.id, {
            resources: { ...targetRes, rageDamageTakenThisTurn: true } as any,
          });
          if (this.debugLogsEnabled) console.log(`[DamageResolver] Rage damage taken tracked for ${action.targetId}`);
        }
      }

      // If a CHARACTER drops to 0 HP from above 0 HP, initialize death saves + Unconscious
      const wasKod = await applyKoEffectsIfNeeded(
        targetCombatant, hpBefore, hpAfter, this.deps.combatRepo,
        this.debugLogsEnabled ? (msg) => console.log(`[DamageResolver] ${msg}`) : undefined,
      );

      // D&D 5e 2024: Rage ends immediately when a creature drops to 0 HP (unconscious)
      if (hpAfter === 0) {
        const koTargetForRage = (await this.deps.combatRepo.listCombatants(encounter.id))
          .find((c: any) => c.id === targetCombatant.id);
        if (koTargetForRage) {
          const koRes = normalizeResources(koTargetForRage.resources);
          if (koRes.raging === true) {
            const effects = getActiveEffects(koTargetForRage.resources ?? {});
            const nonRageEffects = effects.filter((e: ActiveEffect) => e.source !== "Rage");
            const updatedRes = setActiveEffects({ ...koRes, raging: false }, nonRageEffects);
            await this.deps.combatRepo.updateCombatantState(koTargetForRage.id, { resources: updatedRes as any });
            if (this.debugLogsEnabled) console.log(`[DamageResolver] Rage ended on KO for ${action.targetId}`);
          }
        }
      }

      // Auto-break concentration on KO (Unconscious = Incapacitated → concentration ends)
      if (hpAfter === 0 && targetCombatant) {
        const koTarget = (await this.deps.combatRepo.listCombatants(encounter.id))
          .find((c: any) => c.id === targetCombatant.id);
        if (koTarget) {
          const koSpellName = getConcentrationSpellName(koTarget.resources);
          if (koSpellName) {
            await breakConcentration(
              koTarget, encounter.id, this.deps.combatRepo,
              this.debugLogsEnabled ? (msg) => console.log(`[DamageResolver] ${msg}`) : undefined,
            );
            const targetEntityId = getEntityId(targetCombatant) ?? action.targetId;
            await this.eventEmitter.emitConcentrationEvent(
              sessionId, encounter.id, targetEntityId, characters, monsters,
              { maintained: false, spellName: koSpellName, dc: 0, roll: 0, damage: totalDamage },
            );
            if (this.debugLogsEnabled) console.log(`[DamageResolver] Concentration auto-broken on KO`);
          }
        }
      }

      // If a CHARACTER already at 0 HP takes more damage, auto-fail death saves
      if (hpBefore === 0 && targetCombatant.combatantType === "Character") {
        const isCritical = action.isCritical ?? false;
        await applyDamageWhileUnconscious(
          targetCombatant, totalDamage, isCritical, this.deps.combatRepo,
          this.debugLogsEnabled ? (msg) => console.log(`[DamageResolver] ${msg}`) : undefined,
        );
      }

      // Concentration check: if the target is concentrating and took damage, auto-roll CON save
      // If hpAfter === 0, concentration is auto-broken (handled by KO effects / condition-based break)
      if (totalDamage > 0 && hpAfter > 0 && targetCombatant) {
        const latestCombatant = (await this.deps.combatRepo.listCombatants(encounter.id))
          .find((c: any) => c.id === targetCombatant.id);
        const spellName = getConcentrationSpellName(latestCombatant?.resources);
        if (spellName && this.deps.diceRoller) {
          // Get CON save modifier from the character sheet or stat block
          const targetSheet = (target as any).sheet ?? (target as any).statBlock;
          const conScore = targetSheet?.abilityScores?.constitution ?? 10;
          const profBonus = targetSheet?.proficiencyBonus ?? 2;
          const saveProficiencies: string[] = Array.isArray(targetSheet?.saveProficiencies) ? targetSheet.saveProficiencies : [];
          const totalMod = computeConSaveModifier(conScore, profBonus, saveProficiencies);

          const result = concentrationCheckOnDamage(this.deps.diceRoller, totalDamage, totalMod);

          if (this.debugLogsEnabled) console.log(`[DamageResolver] Concentration check: ${result.check.total} vs DC ${result.dc} → ${result.maintained ? "maintained" : "LOST"}`);

          if (!result.maintained) {
            await breakConcentration(
              latestCombatant!,
              encounter.id,
              this.deps.combatRepo,
              this.debugLogsEnabled ? (msg) => console.log(`[DamageResolver] ${msg}`) : undefined,
            );
          }

          // Emit concentration event
          const targetEntityId = getEntityId(targetCombatant) ?? action.targetId;
          await this.eventEmitter.emitConcentrationEvent(
            sessionId, encounter.id, targetEntityId, characters, monsters,
            {
              maintained: result.maintained,
              spellName,
              dc: result.dc,
              roll: result.check.total,
              damage: totalDamage,
            },
          );
        }
      }

      // ── ActiveEffect: retaliatory damage (Armor of Agathys, Fire Shield) ──
      if (totalDamage > 0 && action.weaponSpec?.kind === "melee") {
        const tgtEffects = getActiveEffects(targetCombatant.resources ?? {});
        const retaliatory = tgtEffects.filter(e => e.type === 'retaliatory_damage');
        if (retaliatory.length > 0 && this.deps.diceRoller) {
          const attackerForRetaliation = findCombatantByEntityId(combatantStates, actorId);
          if (attackerForRetaliation && attackerForRetaliation.hpCurrent > 0) {
            let totalRetaliatoryDamage = 0;
            for (const eff of retaliatory) {
              let retDmg = eff.value ?? 0;
              if (eff.diceValue) {
                for (let i = 0; i < eff.diceValue.count; i++) {
                  retDmg += this.deps.diceRoller.rollDie(eff.diceValue.sides).total;
                }
              }
              totalRetaliatoryDamage += retDmg;
              if (this.debugLogsEnabled) console.log(`[DamageResolver] Retaliatory damage (${eff.source ?? 'effect'}): ${retDmg} ${eff.damageType ?? ''}`);
            }
            if (totalRetaliatoryDamage > 0) {
              const atkHpBefore = attackerForRetaliation.hpCurrent;
              const atkHpAfter = Math.max(0, atkHpBefore - totalRetaliatoryDamage);
              await this.deps.combatRepo.updateCombatantState(attackerForRetaliation.id, { hpCurrent: atkHpAfter });
              await applyKoEffectsIfNeeded(
                attackerForRetaliation, atkHpBefore, atkHpAfter, this.deps.combatRepo,
                this.debugLogsEnabled ? (msg) => console.log(`[DamageResolver] ${msg}`) : undefined,
              );
              if (this.debugLogsEnabled) console.log(`[DamageResolver] Retaliatory damage: ${totalRetaliatoryDamage} to ${actorId} (HP: ${atkHpBefore} → ${atkHpAfter})`);
            }
          }
        }
      }
    }

    // Mark Sneak Attack as used for this turn if it was applied
    if (action.sneakAttackDice && action.sneakAttackDice > 0) {
      const actorCombatant = combatantStates.find((c: any) => c.characterId === actorId);
      if (actorCombatant) {
        const actorRes = normalizeResources(actorCombatant.resources);
        await this.deps.combatRepo.updateCombatantState(actorCombatant.id, {
          resources: { ...actorRes, sneakAttackUsedThisTurn: true } as any,
        });
        if (this.debugLogsEnabled) console.log(`[DamageResolver] Sneak Attack used this turn — marked`);
      }
    }

    await this.deps.combatRepo.clearPendingAction(encounter.id);

    const targetName = (target as any).name ?? "Target";
    const isFlurryStrike1 = action.bonusAction === "flurry-of-blows" && action.flurryStrike === 1;
    const isFlurryStrike2 = action.bonusAction === "flurry-of-blows" && action.flurryStrike === 2;

    // --- Weapon Mastery: automatic on-hit effects ---
    // Applied after damage, before hit-rider enhancements (which are player opt-in).
    // Only triggers if target is still alive (hpAfter > 0) and weapon has mastery.
    let masterySuffix = "";
    if (action.weaponSpec?.mastery && hpAfter > 0 && totalDamage > 0) {
      masterySuffix = await this.weaponMasteryResolver.resolve(
        action.weaponSpec.mastery,
        actorId,
        action.targetId,
        encounter.id,
        sessionId,
        action.weaponSpec,
        characters,
        monsters,
        npcs,
      );
    }

    // Generic hit-rider enhancement resolution (System 2)
    // Processes ALL enhancements through the unified pipeline:
    // Stunning Strike saves, OHT effects, bonus dice (Divine Smite), etc.
    const enhancementResults: HitRiderEnhancementResult[] = [];
    if (action.enhancements && action.enhancements.length > 0 && hpAfter > 0) {
      for (const enhancement of action.enhancements) {
        // Bonus dice enhancements (e.g., Divine Smite radiant damage)
        if (enhancement.bonusDice) {
          let bonusDamage = 0;
          for (let i = 0; i < enhancement.bonusDice.diceCount; i++) {
            const dieRoll = this.deps.diceRoller?.rollDie(enhancement.bonusDice.diceSides);
            bonusDamage += dieRoll?.total ?? 0;
          }
          if (bonusDamage > 0) {
            const targetCombatantForBonus = findCombatantByEntityId(
              await this.deps.combatRepo.listCombatants(encounter.id),
              action.targetId,
            );
            if (targetCombatantForBonus) {
              const bonusHpBefore = targetCombatantForBonus.hpCurrent;
              const newHp = Math.max(0, bonusHpBefore - bonusDamage);
              await this.deps.combatRepo.updateCombatantState(targetCombatantForBonus.id, { hpCurrent: newHp });
              await applyKoEffectsIfNeeded(targetCombatantForBonus, bonusHpBefore, newHp, this.deps.combatRepo);
              hpAfter = newHp;
              totalDamage += bonusDamage;
            }
            enhancementResults.push({
              abilityId: enhancement.abilityId,
              displayName: enhancement.displayName,
              summary: `${enhancement.displayName}: ${bonusDamage} bonus damage!`,
            });
          }
        }

        // Post-damage effects (saving throws, condition application, etc.)
        if (enhancement.postDamageEffect) {
          const effectResult = await this.hitRiderResolver.resolvePostDamageEffect(
            enhancement, actorId, action.targetId, encounter.id,
            characters, monsters, npcs,
          );
          enhancementResults.push(effectResult);
        }
      }
    }

    // Map enhancement results to legacy response fields for backward compatibility
    // (test harness expects stunningStrike/openHandTechnique as separate response fields)
    const stunningStrikeResult = enhancementResults.find((r) => r.abilityId === "class:monk:stunning-strike");
    const ohtResult = enhancementResults.find((r) => r.abilityId === "class:monk:open-hand-technique");
    const genericEnhancements = enhancementResults.filter(
      (r) => r.abilityId !== "class:monk:stunning-strike" && r.abilityId !== "class:monk:open-hand-technique",
    );

    if (isFlurryStrike1) {
      const pendingAction2: AttackPendingAction = {
        type: "ATTACK",
        timestamp: new Date(),
        actorId,
        attacker: actorId,
        target: action.targetId,
        targetId: action.targetId,
        weaponSpec: action.weaponSpec,
        bonusAction: "flurry-of-blows",
        flurryStrike: 2,
        // On-hit enhancements are resolved per-strike via damage text keywords — nothing to propagate
      };

      await this.deps.combatRepo.setPendingAction(encounter.id, pendingAction2);

      const ohtSuffix = ohtResult ? ` ${ohtResult.summary}` : "";
      const ssSuffix = stunningStrikeResult ? ` ${stunningStrikeResult.summary}` : "";
      const enhSuffix = genericEnhancements.map((r) => ` ${r.summary}`).join("");
      return {
        rollType: "attack",
        rawRoll: rollValue,
        modifier: damageModifier,
        total: totalDamage,
        totalDamage,
        targetName,
        hpBefore,
        hpAfter,
        targetHpRemaining: hpAfter,
        actionComplete: false,
        requiresPlayerInput: true,
        type: "REQUEST_ROLL",
        diceNeeded: "d20",
        message: `${rollValue} + ${damageModifier} = ${totalDamage} damage to ${targetName}! HP: ${hpBefore} → ${hpAfter}.${masterySuffix}${ohtSuffix}${ssSuffix}${enhSuffix} Second strike: Roll a d20.`,
        ...(ohtResult ? { openHandTechnique: ohtResult } : {}),
        ...(stunningStrikeResult ? { stunningStrike: stunningStrikeResult } : {}),
      };
    }

    // Handle multi-attack spell strike chaining (Eldritch Blast beams, Scorching Ray rays)
    const isSpellStrikeNotLast = action.spellStrike && action.spellStrikeTotal && action.spellStrike < action.spellStrikeTotal;
    if (isSpellStrikeNotLast) {
      const nextStrike = action.spellStrike! + 1;
      const nextPending: AttackPendingAction = {
        type: "ATTACK",
        timestamp: new Date(),
        actorId,
        attacker: actorId,
        target: action.targetId,
        targetId: action.targetId,
        weaponSpec: action.weaponSpec,
        spellStrike: nextStrike,
        spellStrikeTotal: action.spellStrikeTotal,
      };

      await this.deps.combatRepo.setPendingAction(encounter.id, nextPending);

      return {
        rollType: "attack",
        rawRoll: rollValue,
        modifier: damageModifier,
        total: totalDamage,
        totalDamage,
        targetName,
        hpBefore,
        hpAfter,
        targetHpRemaining: hpAfter,
        actionComplete: false,
        requiresPlayerInput: true,
        type: "REQUEST_ROLL",
        diceNeeded: "d20",
        message: `${rollValue} + ${damageModifier} = ${totalDamage} damage to ${targetName}! HP: ${hpBefore} → ${hpAfter}.${masterySuffix} Beam ${nextStrike} of ${action.spellStrikeTotal}: Roll a d20.`,
      };
    }

    await this.eventEmitter.markActionSpent(encounter.id, actorId);

    // D&D 5e 2024: Loading property — mark that a Loading weapon was fired this turn
    if (action.weaponSpec?.properties?.some((p: string) => typeof p === "string" && p.toLowerCase() === "loading")) {
      const combatantStatesForLoading = await this.deps.combatRepo.listCombatants(encounter.id);
      const actorForLoading = findCombatantByEntityId(combatantStatesForLoading, actorId);
      if (actorForLoading) {
        const loadRes = normalizeResources(actorForLoading.resources);
        await this.deps.combatRepo.updateCombatantState(actorForLoading.id, {
          resources: { ...loadRes, loadingWeaponFiredThisTurn: true } as any,
        });
      }
    }

    // Drop thrown weapon on the ground at target position (hit)
    if (action.weaponSpec?.isThrownAttack) {
      await this.dropThrownWeaponOnGround(encounter, actorId, action.targetId, action.weaponSpec, encounter.round ?? 1);
    }

    // Check for victory/defeat if target was defeated
    let combatEnded = false;
    let victoryStatus: CombatVictoryStatus | undefined;
    if (hpAfter <= 0 && this.deps.victoryPolicy) {
      // Re-fetch combatants with updated HP
      const updatedCombatants = await this.deps.combatRepo.listCombatants(encounter.id);
      victoryStatus = await this.deps.victoryPolicy.evaluate({ combatants: updatedCombatants }) ?? undefined;

      if (victoryStatus) {
        combatEnded = true;
        // Update encounter status
        await this.deps.combatRepo.updateEncounter(encounter.id, { status: victoryStatus });

        // Emit CombatEnded event if event repo is available
        if (this.deps.events) {
          await this.deps.events.append(sessionId, {
            id: nanoid(),
            type: "CombatEnded",
            payload: { encounterId: encounter.id, result: victoryStatus },
          });
        }
      }
    }

    // Drop loot from defeated monsters onto the battlefield
    if (hpAfter <= 0 && targetCombatant?.combatantType === "Monster") {
      await this.dropMonsterLoot(encounter, targetCombatant, monsters);
    }

    const narration = await this.eventEmitter.generateNarration(combatEnded ? "combatVictory" : "damageDealt", {
      damageRoll: rollValue,
      damageModifier,
      totalDamage,
      targetName,
      hpBefore,
      hpAfter,
      defeated: hpAfter <= 0,
      victoryStatus,
    });

    const enhancementSuffix = genericEnhancements.map((r) => ` ${r.summary}`).join("");
    return {
      rollType: "damage",
      rawRoll: rollValue,
      modifier: damageModifier,
      total: totalDamage,
      totalDamage,
      targetName,
      hpBefore,
      hpAfter,
      targetHpRemaining: hpAfter,
      actionComplete: true,
      requiresPlayerInput: false,
      message: combatEnded
        ? `${rollValue} + ${damageModifier} = ${totalDamage} damage to ${targetName}! HP: ${hpBefore} → ${hpAfter}. ${victoryStatus}!${masterySuffix}${enhancementSuffix}`
        : `${rollValue} + ${damageModifier} = ${totalDamage} damage to ${targetName}! HP: ${hpBefore} → ${hpAfter}${masterySuffix}${enhancementSuffix}`,
      narration,
      combatEnded,
      victoryStatus,
      ...(ohtResult ? { openHandTechnique: ohtResult } : {}),
      ...(stunningStrikeResult ? { stunningStrike: stunningStrikeResult } : {}),
      ...(genericEnhancements.length > 0 ? { enhancements: genericEnhancements } : {}),
    };
  }

  /**
   * Drop a thrown weapon on the ground at the target position after a thrown attack.
   * Creates a GroundItem from the WeaponSpec and persists the updated map.
   *
   * Public so RollStateMachine can call it from the attack-miss path.
   */
  async dropThrownWeaponOnGround(
    encounter: CombatEncounterRecord,
    actorId: string,
    targetId: string,
    weaponSpec: { name: string; kind: "melee" | "ranged"; attackBonus: number; damage?: { diceCount: number; diceSides: number; modifier: number }; damageType?: string; properties?: string[]; normalRange?: number; longRange?: number; mastery?: string },
    round: number,
  ): Promise<void> {
    const mapData = encounter.mapData as CombatMap | undefined;
    if (!mapData) return;

    // Find target position — that's where the thrown weapon lands
    const combatants = await this.deps.combatRepo.listCombatants(encounter.id);
    const targetCombatant = findCombatantByEntityId(combatants, targetId);
    const targetPos = targetCombatant ? getPosition(targetCombatant.resources ?? {}) : null;
    if (!targetPos) return;

    // Build range string from normalRange/longRange
    let rangeStr: string | undefined;
    if (weaponSpec.normalRange && weaponSpec.normalRange > 0) {
      rangeStr = weaponSpec.longRange
        ? `${weaponSpec.normalRange}/${weaponSpec.longRange}`
        : `${weaponSpec.normalRange}`;
    }

    const groundItem: GroundItem = {
      id: nanoid(),
      name: weaponSpec.name,
      position: { ...targetPos },
      source: "thrown",
      droppedBy: actorId,
      round,
      weaponStats: {
        name: weaponSpec.name,
        kind: weaponSpec.kind === "ranged" ? "ranged" : "melee",
        ...(rangeStr ? { range: rangeStr } : {}),
        attackBonus: weaponSpec.attackBonus,
        damage: weaponSpec.damage ?? { diceCount: 1, diceSides: 4, modifier: 0 },
        ...(weaponSpec.damageType ? { damageType: weaponSpec.damageType } : {}),
        ...(weaponSpec.properties ? { properties: weaponSpec.properties } : {}),
        ...(weaponSpec.mastery ? { mastery: weaponSpec.mastery } : {}),
      },
    };

    const updatedMap = addGroundItem(mapData, groundItem);
    await this.deps.combatRepo.updateEncounter(encounter.id, { mapData: updatedMap as any });

    if (this.debugLogsEnabled) {
      console.log(`[DamageResolver] Thrown weapon ${weaponSpec.name} dropped at (${targetPos.x}, ${targetPos.y}) by ${actorId}`);
    }
  }

  /**
   * Drop loot from a defeated monster onto the battlefield as ground items.
   * Reads the `loot` array from the monster's stat block and places each item
   * at the monster's last known position on the map.
   */
  private async dropMonsterLoot(
    encounter: CombatEncounterRecord,
    targetCombatant: { monsterId: string | null; resources?: unknown },
    monsters: SessionMonsterRecord[],
  ): Promise<void> {
    const mapData = encounter.mapData as CombatMap | undefined;
    if (!mapData) return;

    // Find the monster record for its stat block
    const monsterId = targetCombatant.monsterId;
    const monster = monsters.find((m) => m.id === monsterId);
    if (!monster) return;

    const statBlock = monster.statBlock as Record<string, unknown> | undefined;
    const loot = statBlock?.loot;
    if (!Array.isArray(loot) || loot.length === 0) return;

    // Get monster's position for drop location
    const monsterPos = getPosition(targetCombatant.resources ?? {});
    if (!monsterPos) return;

    let currentMap = mapData;
    for (const lootEntry of loot) {
      if (!lootEntry || typeof lootEntry !== "object") continue;
      const entry = lootEntry as Record<string, unknown>;
      const name = entry.name;
      if (typeof name !== "string") continue;

      const groundItem: GroundItem = {
        id: nanoid(),
        name,
        position: { ...monsterPos },
        source: "loot",
        round: encounter.round ?? 1,
        ...(entry.weaponStats && typeof entry.weaponStats === "object"
          ? { weaponStats: entry.weaponStats as GroundItem["weaponStats"] }
          : {}),
        ...(entry.inventoryItem && typeof entry.inventoryItem === "object"
          ? { inventoryItem: entry.inventoryItem as GroundItem["inventoryItem"] }
          : {}),
      };

      currentMap = addGroundItem(currentMap, groundItem);

      if (this.debugLogsEnabled) {
        console.log(`[DamageResolver] Monster loot dropped: ${name} at (${monsterPos.x}, ${monsterPos.y})`);
      }
    }

    await this.deps.combatRepo.updateEncounter(encounter.id, { mapData: currentMap as any });
  }
}
