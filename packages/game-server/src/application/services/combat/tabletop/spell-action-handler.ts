/**
 * SpellActionHandler - Resolves spell casting in tabletop combat.
 *
 * Handles four delivery modes:
 *   1. Simple (Magic Missile, Bless)          → SIMPLE_ACTION_COMPLETE
 *   2. Spell attack roll (Fire Bolt, etc.)     → creates ATTACK pending action
 *   3. Save-based (Burning Hands, Hold Person) → auto-rolls target save
 *   4. Healing (Cure Wounds, Healing Word)     → auto-rolls healing dice, restores HP
 *
 * Extracted from TabletopCombatService (Phase 3, Step 15).
 */

import { ValidationError } from "../../../errors.js";
import {
  hasResourceAvailable,
  spendResourceFromPool,
  normalizeResources,
  getActiveEffects,
  addActiveEffectsToResources,
  getPosition,
  isConditionImmuneByEffects,
} from "../helpers/resource-utils.js";
import {
  breakConcentration,
  getConcentrationSpellName,
  isConcentrationBreakingCondition,
} from "../helpers/concentration-helper.js";
import { applyKoEffectsIfNeeded } from "../helpers/ko-handler.js";
import {
  inferActorRef,
  findCombatantByName,
  deriveRollModeFromConditions,
} from "./combat-text-parser.js";
import { applyDamageDefenses, extractDamageDefenses } from "../../../../domain/rules/damage-defenses.js";
import {
  normalizeConditions,
  readConditionNames,
  addCondition,
  createCondition,
  removeCondition,
  type Condition,
} from "../../../../domain/entities/combat/conditions.js";
import {
  createEffect,
  type EffectType,
  type EffectTarget,
  type EffectDuration,
  type ActiveEffect,
  type DiceValue,
  type SaveToEnd,
} from "../../../../domain/entities/combat/effects.js";
import {
  createZone,
  type ZoneEffect,
  type ZoneType,
  type ZoneShape,
  type ZoneEffectTrigger,
  type CombatZone,
} from "../../../../domain/entities/combat/zones.js";
import type { CombatMap } from "../../../../domain/rules/combat-map.js";
import { addZone, getMapZones } from "../../../../domain/rules/combat-map.js";
import { nanoid } from "nanoid";

import type { TabletopEventEmitter } from "./tabletop-event-emitter.js";
import type { LlmRoster } from "../../../commands/game-command.js";
import type {
  TabletopCombatServiceDeps,
  AttackPendingAction,
  WeaponSpec,
  ActionParseResult,
  SavingThrowPendingAction,
} from "./tabletop-types.js";
import { SavingThrowResolver } from "./saving-throw-resolver.js";
import type { JsonValue } from "../../../types.js";

export class SpellActionHandler {
  private readonly savingThrowResolver: SavingThrowResolver | null;

  constructor(
    private readonly deps: TabletopCombatServiceDeps,
    private readonly eventEmitter: TabletopEventEmitter,
    private readonly debugLogsEnabled: boolean,
  ) {
    this.savingThrowResolver = deps.diceRoller
      ? new SavingThrowResolver(deps.combatRepo, deps.diceRoller, debugLogsEnabled)
      : null;
  }

  /**
   * Handle Cast Spell action with spell slot management and mechanical resolution.
   */
  async handleCastSpell(
    sessionId: string,
    encounterId: string,
    actorId: string,
    castInfo: { spellName: string; targetName?: string },
    characters: any[],
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    const actor = inferActorRef(actorId, roster);

    // Look up spell info from the caster's character sheet
    const character = characters.find((c) => c.id === actorId);
    const sheet = character && typeof character.sheet === "object" ? character.sheet : null;
    const preparedSpells: Array<{
      name: string;
      level: number;
      concentration?: boolean;
      attackType?: "ranged_spell" | "melee_spell";
      saveAbility?: string;
      damage?: { diceCount: number; diceSides: number; modifier?: number };
      damageType?: string;
      halfDamageOnSave?: boolean;
      /** Conditions to apply on save failure (e.g. Hold Person → ["Paralyzed"]) */
      conditions?: { onFailure?: string[] };
      /** Healing dice (e.g. Cure Wounds: { diceCount: 2, diceSides: 8 }) */
      healing?: { diceCount: number; diceSides: number; modifier?: number };
      /** Whether this spell uses a bonus action (e.g. Healing Word) */
      isBonusAction?: boolean;
      /** ActiveEffect declarations — generic buff/debuff system */
      effects?: Array<{
        type: EffectType;
        target: EffectTarget;
        value?: number;
        diceValue?: { count: number; sides: number };
        damageType?: string;
        duration: EffectDuration;
        roundsRemaining?: number;
        triggerAt?: "start_of_turn" | "end_of_turn" | "on_voluntary_move";
        saveToEnd?: { ability: string; dc: number };
        conditionName?: string;
        /** Save allowed when this trigger fires (e.g., STR save to avoid knockback on move) */
        triggerSave?: { ability: string; dc: number; halfDamageOnSave?: boolean };
        /** Conditions applied when trigger fires (e.g., Restrained, Prone) */
        triggerConditions?: string[];
        /** Who receives this effect */
        appliesTo?: "self" | "target" | "allies" | "enemies";
      }>;
      /** Zone (area effect) declaration — persistent area on the battlefield */
      zone?: {
        type: ZoneType;
        radiusFeet: number;
        shape?: ZoneShape;
        /** If true, zone follows the caster (aura) */
        attachToSelf?: boolean;
        /** For line/cone shapes: direction point or line endpoint */
        direction?: { x: number; y: number };
        /** For line shapes: width in feet (default 5) */
        width?: number;
        effects: Array<{
          trigger: ZoneEffectTrigger;
          damage?: { diceCount: number; diceSides: number; modifier?: number };
          damageType?: string;
          saveAbility?: string;
          saveDC?: number;
          halfDamageOnSave?: boolean;
          conditions?: string[];
          activeEffect?: { type: EffectType; target: EffectTarget; value?: number };
          affectsAllies?: boolean;
          affectsEnemies?: boolean;
          affectsSelf?: boolean;
        }>;
      };
    }> = Array.isArray(sheet?.preparedSpells) ? sheet.preparedSpells : [];

    // Find the spell by name (case-insensitive)
    const spellMatch = preparedSpells.find(
      (s) => s.name.toLowerCase() === castInfo.spellName.toLowerCase(),
    );
    const spellLevel = spellMatch?.level ?? 0;
    const isConcentration = spellMatch?.concentration ?? false;

    // Handle spell slot spending for leveled spells
    if (spellLevel > 0) {
      const encounters = await this.deps.combatRepo.listEncountersBySession(sessionId);
      const encounter = encounters.find((e: any) => e.status === "Active") ?? encounters[0];
      if (encounter) {
        const combatants = await this.deps.combatRepo.listCombatants(encounter.id);
        const actorCombatant = combatants.find(
          (c: any) => c.characterId === actorId || c.monsterId === actorId || c.npcId === actorId,
        );
        if (actorCombatant) {
          const poolName = `spellSlot_${spellLevel}`;
          const resources = actorCombatant.resources;

          if (!hasResourceAvailable(resources, poolName, 1)) {
            throw new ValidationError(`No level ${spellLevel} spell slots remaining`);
          }

          let updatedResources = spendResourceFromPool(resources, poolName, 1);

          // Handle concentration tracking
          if (isConcentration) {
            const normalized = normalizeResources(updatedResources);
            if (normalized.concentrationSpellName) {
              if (this.debugLogsEnabled) console.log(`[SpellActionHandler] Concentration on "${normalized.concentrationSpellName}" ended (replaced by ${castInfo.spellName})`);
              // Clean up effects/zones from the old concentration spell
              await breakConcentration(
                actorCombatant,
                encounter.id,
                this.deps.combatRepo,
                this.debugLogsEnabled ? (msg) => console.log(`[SpellActionHandler] ${msg}`) : undefined,
              );
              // Re-fetch resources after breakConcentration modified them
              const freshCombatant = (await this.deps.combatRepo.listCombatants(encounter.id))
                .find((c: any) => c.id === actorCombatant.id);
              updatedResources = freshCombatant?.resources ?? updatedResources;
            }
            const normalizedAfter = normalizeResources(updatedResources);
            updatedResources = { ...normalizedAfter, concentrationSpellName: castInfo.spellName } as any;
          }

          await this.deps.combatRepo.updateCombatantState(actorCombatant.id, {
            resources: updatedResources,
          });
        }
      }
    }

    // --- Spell attack roll (Fire Bolt, Guiding Bolt, etc.) ---
    if (spellMatch?.attackType) {
      return this.handleSpellAttack(sessionId, encounterId, actorId, castInfo, spellMatch, spellLevel, sheet, roster);
    }

    // --- Healing spell (Cure Wounds, Healing Word, etc.) ---
    if (spellMatch?.healing && this.deps.diceRoller) {
      return this.handleHealingSpell(sessionId, encounterId, actorId, castInfo, spellMatch, spellLevel, sheet, characters, actor, roster);
    }

    // --- Save-based spell (Burning Hands, etc.) ---
    if (spellMatch?.saveAbility && this.deps.diceRoller) {
      return this.handleSaveSpell(sessionId, encounterId, actorId, castInfo, spellMatch, spellLevel, sheet, characters, actor, roster);
    }

    // --- Zone spell (Spirit Guardians, Spike Growth, Cloud of Daggers, etc.) ---
    if (spellMatch?.zone) {
      return this.handleZoneSpell(sessionId, encounterId, actorId, castInfo, spellMatch, isConcentration, roster);
    }

    // --- Buff/debuff spell with effect declarations (Bless, Shield of Faith, etc.) ---
    if (spellMatch?.effects && spellMatch.effects.length > 0) {
      return this.handleBuffDebuffSpell(sessionId, encounterId, actorId, castInfo, spellMatch, isConcentration, characters, roster);
    }

    // --- Simple spell (Magic Missile, buffs, etc.) ---
    await this.deps.actions.castSpell(sessionId, {
      encounterId,
      actor,
      spellName: castInfo.spellName,
    });

    const targetNote = castInfo.targetName ? ` at ${castInfo.targetName}` : "";
    const slotNote = spellLevel > 0 ? ` (level ${spellLevel} slot spent)` : "";

    return {
      requiresPlayerInput: false,
      actionComplete: true,
      type: "SIMPLE_ACTION_COMPLETE",
      action: "CastSpell",
      message: `Cast ${castInfo.spellName}${targetNote}.${slotNote}`,
    };
  }

  // ----- Private sub-handlers -----

  private async handleSpellAttack(
    sessionId: string,
    encounterId: string,
    actorId: string,
    castInfo: { spellName: string; targetName?: string },
    spellMatch: { attackType?: string; damage?: { diceCount: number; diceSides: number; modifier?: number }; damageType?: string },
    spellLevel: number,
    sheet: any,
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    const targetName = castInfo.targetName;
    if (!targetName) {
      throw new ValidationError(`${castInfo.spellName} requires a target. Usage: cast ${castInfo.spellName} at <target>`);
    }

    const targetRef = findCombatantByName(targetName, roster);
    if (!targetRef) {
      throw new ValidationError(`Target "${targetName}" not found`);
    }

    const targetId = (targetRef as any).characterId ?? (targetRef as any).monsterId ?? (targetRef as any).npcId;
    const spellAttackBonus = sheet?.spellAttackBonus ?? 5;

    // Build weapon spec for the spell attack
    const spellDamage = spellMatch.damage ?? { diceCount: 1, diceSides: 10, modifier: 0 };
    const damageFormula = `${spellDamage.diceCount}d${spellDamage.diceSides}${(spellDamage.modifier ?? 0) > 0 ? `+${spellDamage.modifier}` : (spellDamage.modifier ?? 0) < 0 ? `${spellDamage.modifier}` : ""}`;

    const spellWeaponSpec: WeaponSpec = {
      name: castInfo.spellName,
      kind: spellMatch.attackType === "melee_spell" ? "melee" : "ranged",
      attackBonus: spellAttackBonus,
      damage: { diceCount: spellDamage.diceCount, diceSides: spellDamage.diceSides, modifier: spellDamage.modifier ?? 0 },
      damageFormula,
      damageType: spellMatch.damageType,
    };

    const encounters = await this.deps.combatRepo.listEncountersBySession(sessionId);
    const encounter = encounters.find((e: any) => e.status === "Active") ?? encounters[0];
    if (!encounter) throw new ValidationError("No active encounter");

    // Derive roll mode from conditions (advantage/disadvantage)
    const combatants = await this.deps.combatRepo.listCombatants(encounter.id);
    const actorCombatant = combatants.find(
      (c: any) => c.characterId === actorId || c.monsterId === actorId || c.npcId === actorId,
    );
    const actorConditions: string[] = readConditionNames(actorCombatant?.conditions);
    const inferredKind = spellMatch.attackType === "melee_spell" ? "melee" as const : "ranged" as const;
    const rollMode = deriveRollModeFromConditions(actorConditions, [], inferredKind);

    const pendingAction: AttackPendingAction = {
      type: "ATTACK",
      timestamp: new Date(),
      actorId,
      attacker: actorId,
      target: targetId,
      targetId,
      weaponSpec: spellWeaponSpec,
      rollMode,
    };

    await this.deps.combatRepo.setPendingAction(encounter.id, pendingAction);

    const slotNote = spellLevel > 0 ? ` (level ${spellLevel} slot spent)` : "";
    const rollModeNote = rollMode !== "normal" ? ` (${rollMode})` : "";

    return {
      requiresPlayerInput: true,
      actionComplete: false,
      type: "REQUEST_ROLL",
      rollType: "attack",
      diceNeeded: "d20",
      advantage: rollMode === "advantage",
      disadvantage: rollMode === "disadvantage",
      message: `Casting ${castInfo.spellName} at ${targetName}${slotNote}${rollModeNote}. Roll a d20 for spell attack.`,
    };
  }

  private async handleSaveSpell(
    sessionId: string,
    encounterId: string,
    actorId: string,
    castInfo: { spellName: string; targetName?: string },
    spellMatch: { saveAbility?: string; damage?: { diceCount: number; diceSides: number; modifier?: number }; damageType?: string; halfDamageOnSave?: boolean; conditions?: { onFailure?: string[] } },
    spellLevel: number,
    sheet: any,
    characters: any[],
    actor: any,
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    const targetName = castInfo.targetName;
    if (!targetName) {
      throw new ValidationError(`${castInfo.spellName} requires a target. Usage: cast ${castInfo.spellName} at <target>`);
    }

    const targetRef = findCombatantByName(targetName, roster);
    if (!targetRef) {
      throw new ValidationError(`Target "${targetName}" not found`);
    }

    const targetId = (targetRef as any).characterId ?? (targetRef as any).monsterId ?? (targetRef as any).npcId;
    const spellSaveDC = sheet?.spellSaveDC ?? 13;
    const saveAbility = spellMatch.saveAbility!;

    // Look up target's save modifier
    const allMonsters = await this.deps.monsters.listBySession(sessionId);
    const allNpcs = await this.deps.npcs.listBySession(sessionId);
    const targetMonster = allMonsters.find((m) => m.id === targetId);
    const targetChar = characters.find((c) => c.id === targetId);
    const targetNpc = allNpcs.find((n) => n.id === targetId);
    const targetStats = (targetMonster as any)?.statBlock ?? (targetChar as any)?.sheet ?? (targetNpc as any)?.statBlock ?? {};
    const targetAbilityScore = targetStats?.abilityScores?.[saveAbility] ?? 10;
    const saveMod = Math.floor((targetAbilityScore - 10) / 2);

    // Auto-roll save for target
    const saveRoll = this.deps.diceRoller!.d20();
    const saveTotal = saveRoll.total + saveMod;
    const saveSuccess = saveTotal >= spellSaveDC;

    if (this.debugLogsEnabled) console.log(`[SpellActionHandler] ${targetName} ${saveAbility} save: d20(${saveRoll.total}) + ${saveMod} = ${saveTotal} vs DC ${spellSaveDC} → ${saveSuccess ? "SUCCESS" : "FAILURE"}`);

    // Calculate damage
    const spellDamage = spellMatch.damage;
    let damageMessage = "";
    if (spellDamage) {
      const damageRoll = this.deps.diceRoller!.rollDie(spellDamage.diceSides, spellDamage.diceCount);
      let totalDamage = damageRoll.total + (spellDamage.modifier ?? 0);

      // Half damage on save (D&D 5e standard for many save spells)
      const halfOnSave = spellMatch.halfDamageOnSave ?? true;
      if (saveSuccess && halfOnSave) {
        totalDamage = Math.floor(totalDamage / 2);
      } else if (saveSuccess && !halfOnSave) {
        totalDamage = 0;
      }

      if (totalDamage > 0) {
        // Apply damage to target
        const encounters = await this.deps.combatRepo.listEncountersBySession(sessionId);
        const encounter = encounters.find((e: any) => e.status === "Active") ?? encounters[0];
        if (encounter) {
          const combatants = await this.deps.combatRepo.listCombatants(encounter.id);
          const targetCombatant = combatants.find(
            (c: any) => c.characterId === targetId || c.monsterId === targetId || c.npcId === targetId,
          );
          if (targetCombatant) {
            // Apply damage resistance/immunity/vulnerability for spell damage
            const spellDmgType = spellMatch.damageType;
            if (spellDmgType && totalDamage > 0) {
              const spellDefenses = extractDamageDefenses(targetStats);
              if (spellDefenses.damageResistances || spellDefenses.damageImmunities || spellDefenses.damageVulnerabilities) {
                const defResult = applyDamageDefenses(totalDamage, spellDmgType, spellDefenses);
                totalDamage = defResult.adjustedDamage;
              }
            }
            const hpBefore = targetCombatant.hpCurrent;
            const hpAfter = Math.max(0, hpBefore - totalDamage);
            await this.deps.combatRepo.updateCombatantState(targetCombatant.id, { hpCurrent: hpAfter });

            // Apply KO effects if target dropped to 0 HP
            await applyKoEffectsIfNeeded(targetCombatant, hpBefore, hpAfter, this.deps.combatRepo);

            await this.eventEmitter.emitDamageEvents(sessionId, encounter.id, actorId, targetId, characters, allMonsters as any, totalDamage, hpAfter);
            damageMessage = ` ${totalDamage} ${spellMatch.damageType ?? ""} damage (HP: ${hpBefore} → ${hpAfter}).`;

            // Check victory
            if (hpAfter <= 0 && this.deps.victoryPolicy) {
              const allCombatants = await this.deps.combatRepo.listCombatants(encounter.id);
              const result = await this.deps.victoryPolicy.evaluate({ combatants: allCombatants });
              if (result) {
                await this.deps.combatRepo.updateEncounter(encounter.id, { status: result });
              }
            }
          }
        }
      } else {
        damageMessage = " No damage (save succeeded).";
      }
    }

    // Handle condition-based spell effects (e.g., Hold Person → Paralyzed)
    let conditionMessage = "";
    if (!saveSuccess && spellMatch.conditions?.onFailure) {
      const encounters = await this.deps.combatRepo.listEncountersBySession(sessionId);
      const encounter = encounters.find((e: any) => e.status === "Active") ?? encounters[0];
      if (encounter) {
        const combatants = await this.deps.combatRepo.listCombatants(encounter.id);
        const targetCombatant = combatants.find(
          (c: any) => c.characterId === targetId || c.monsterId === targetId || c.npcId === targetId,
        );
        if (targetCombatant) {
          let conditions = normalizeConditions(targetCombatant.conditions);
          const appliedConditions: string[] = [];
          for (const cond of spellMatch.conditions.onFailure) {
            if (!isConditionImmuneByEffects(targetCombatant.resources, cond)) {
              conditions = addCondition(conditions, createCondition(cond as Condition, "until_removed", {
                source: castInfo.spellName,
              }));
              appliedConditions.push(cond);
            }
          }
          if (appliedConditions.length > 0) {
            await this.deps.combatRepo.updateCombatantState(targetCombatant.id, {
              conditions: conditions as any,
            });
            conditionMessage = ` ${appliedConditions.join(", ")} applied!`;

            // Check if any applied condition should auto-break concentration
            if (appliedConditions.some(isConcentrationBreakingCondition)) {
              const concSpell = getConcentrationSpellName(targetCombatant.resources);
              if (concSpell) {
                await breakConcentration(targetCombatant, encounter.id, this.deps.combatRepo,
                  this.debugLogsEnabled ? (msg) => console.log(`[SpellActionHandler] ${msg}`) : undefined,
                );
              }
            }
          }
        }
      }
    }

    // Mark action spent
    await this.deps.actions.castSpell(sessionId, {
      encounterId,
      actor,
      spellName: castInfo.spellName,
    });

    const slotNote = spellLevel > 0 ? ` (level ${spellLevel} slot spent)` : "";
    const saveResult = saveSuccess ? "Save succeeded" : "Save failed";

    return {
      requiresPlayerInput: false,
      actionComplete: true,
      type: "SIMPLE_ACTION_COMPLETE",
      action: "CastSpell",
      message: `Cast ${castInfo.spellName} at ${targetName}.${slotNote} ${saveAbility.charAt(0).toUpperCase() + saveAbility.slice(1)} save DC ${spellSaveDC}: d20(${saveRoll.total})+${saveMod}=${saveTotal}. ${saveResult}.${damageMessage}${conditionMessage}`,
    };
  }

  /**
   * Handle healing spell (Cure Wounds, Healing Word, etc.).
   *
   * D&D 5e 2024 healing flow:
   *  - Roll healing dice + spellcasting modifier
   *  - Clamp to target's max HP
   *  - If target was at 0 HP: remove Unconscious, reset death saves (revive)
   *  - Healing Word is a bonus action; Cure Wounds uses the regular action
   */
  private async handleHealingSpell(
    sessionId: string,
    encounterId: string,
    actorId: string,
    castInfo: { spellName: string; targetName?: string },
    spellMatch: {
      healing?: { diceCount: number; diceSides: number; modifier?: number };
      isBonusAction?: boolean;
    },
    spellLevel: number,
    sheet: any,
    characters: any[],
    actor: any,
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    const targetName = castInfo.targetName;
    if (!targetName) {
      throw new ValidationError(
        `${castInfo.spellName} requires a target. Usage: cast ${castInfo.spellName} on <target>`,
      );
    }

    const targetRef = findCombatantByName(targetName, roster);
    if (!targetRef) {
      throw new ValidationError(`Target "${targetName}" not found`);
    }

    const targetId =
      (targetRef as any).characterId ??
      (targetRef as any).monsterId ??
      (targetRef as any).npcId;

    // Find the encounter and target combatant
    const encounters = await this.deps.combatRepo.listEncountersBySession(sessionId);
    const encounter = encounters.find((e: any) => e.status === "Active") ?? encounters[0];
    if (!encounter) throw new ValidationError("No active encounter");

    const combatants = await this.deps.combatRepo.listCombatants(encounter.id);
    const targetCombatant = combatants.find(
      (c: any) =>
        c.characterId === targetId ||
        c.monsterId === targetId ||
        c.npcId === targetId,
    );
    if (!targetCombatant) throw new ValidationError(`Target combatant not found in encounter`);

    // Validate target isn't dead (3 death save failures)
    const resources = targetCombatant.resources as any;
    const deathSaves = resources?.deathSaves;
    if (deathSaves && deathSaves.failures >= 3) {
      throw new ValidationError(`${targetName} is dead and cannot be healed`);
    }

    // Roll healing dice
    const healing = spellMatch.healing!;
    const spellMod = healing.modifier ?? (sheet?.spellcastingAbility
      ? Math.floor(((sheet?.abilityScores?.[sheet.spellcastingAbility] ?? 10) - 10) / 2)
      : 0);
    const healRoll = this.deps.diceRoller!.rollDie(healing.diceSides, healing.diceCount);
    const healTotal = Math.max(0, healRoll.total + spellMod);

    // Apply healing (clamp to maxHp)
    const hpBefore = targetCombatant.hpCurrent;
    const hpMax = targetCombatant.hpMax;
    const hpAfter = Math.min(hpMax, hpBefore + healTotal);
    const actualHealing = hpAfter - hpBefore;

    const updatePatch: Record<string, any> = { hpCurrent: hpAfter };

    // If healed from 0 HP → remove Unconscious, reset death saves (revive)
    let revivedFromUnconscious = false;
    if (hpBefore === 0 && hpAfter > 0) {
      revivedFromUnconscious = true;
      let conditions = normalizeConditions(targetCombatant.conditions);
      conditions = removeCondition(conditions, "Unconscious");
      updatePatch.conditions = conditions as any;

      // Reset death saves
      const targetResources = targetCombatant.resources ?? {};
      updatePatch.resources = {
        ...(targetResources as any),
        deathSaves: { successes: 0, failures: 0 },
      };
    }

    await this.deps.combatRepo.updateCombatantState(targetCombatant.id, updatePatch);

    // Emit healing events
    const allMonsters = await this.deps.monsters.listBySession(sessionId);
    await this.eventEmitter.emitHealingEvents(
      sessionId,
      encounter.id,
      actorId,
      targetId,
      characters,
      allMonsters as any,
      actualHealing,
      hpAfter,
    );

    // Mark action spent (bonus action for Healing Word, regular action for Cure Wounds)
    const isBonusAction = spellMatch.isBonusAction ?? false;
    await this.deps.actions.castSpell(sessionId, {
      encounterId: encounter.id,
      actor,
      spellName: castInfo.spellName,
      skipActionCheck: isBonusAction,
    });

    // If bonus action spell, also mark bonus action used on resources
    if (isBonusAction) {
      const actorCombatant = combatants.find(
        (c: any) =>
          c.characterId === actorId ||
          c.monsterId === actorId ||
          c.npcId === actorId,
      );
      if (actorCombatant) {
        const actorResources = actorCombatant.resources ?? {};
        await this.deps.combatRepo.updateCombatantState(actorCombatant.id, {
          resources: { ...(actorResources as any), bonusActionUsed: true } as any,
        });
      }
    }

    const slotNote = spellLevel > 0 ? ` (level ${spellLevel} slot spent)` : "";
    const healFormula = `${healing.diceCount}d${healing.diceSides}${spellMod > 0 ? `+${spellMod}` : spellMod < 0 ? `${spellMod}` : ""}`;
    const reviveNote = revivedFromUnconscious ? ` ${targetName} regains consciousness!` : "";
    const bonusNote = isBonusAction ? " [bonus action]" : "";

    if (this.debugLogsEnabled)
      console.log(
        `[SpellActionHandler] Healing: ${castInfo.spellName} on ${targetName}: ${healFormula} = ${healTotal} (HP: ${hpBefore} → ${hpAfter})${reviveNote}`,
      );

    return {
      requiresPlayerInput: false,
      actionComplete: true,
      type: "SIMPLE_ACTION_COMPLETE",
      action: "CastSpell",
      message: `Cast ${castInfo.spellName} on ${targetName}.${slotNote}${bonusNote} Healed ${actualHealing} HP (${healFormula} rolled ${healRoll.total}+${spellMod}=${healTotal}). HP: ${hpBefore} → ${hpAfter}.${reviveNote}`,
    };
  }

  /**
   * Handle buff/debuff spell with declared ActiveEffect instances.
   * Resolves targets based on `appliesTo`, creates effects, and applies them.
   */
  private async handleBuffDebuffSpell(
    sessionId: string,
    encounterId: string,
    actorId: string,
    castInfo: { spellName: string; targetName?: string },
    spellMatch: {
      name: string;
      concentration?: boolean;
      effects?: Array<{
        type: EffectType;
        target: EffectTarget;
        value?: number;
        diceValue?: { count: number; sides: number };
        damageType?: string;
        duration: EffectDuration;
        roundsRemaining?: number;
        triggerAt?: "start_of_turn" | "end_of_turn" | "on_voluntary_move";
        saveToEnd?: { ability: string; dc: number };
        conditionName?: string;
        triggerSave?: { ability: string; dc: number; halfDamageOnSave?: boolean };
        triggerConditions?: string[];
        appliesTo?: "self" | "target" | "allies" | "enemies";
      }>;
    },
    isConcentration: boolean,
    characters: any[],
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    const encounters = await this.deps.combatRepo.listEncountersBySession(sessionId);
    const encounter = encounters.find((e: any) => e.status === "Active") ?? encounters[0];
    if (!encounter) throw new ValidationError("No active encounter");

    const combatants = await this.deps.combatRepo.listCombatants(encounter.id);
    const actorCombatant = combatants.find(
      (c: any) => c.characterId === actorId || c.monsterId === actorId || c.npcId === actorId,
    );

    const effectDeclarations = spellMatch.effects ?? [];
    const appliedTo: string[] = [];

    for (const effDef of effectDeclarations) {
      // Resolve target combatants
      const targetCombatantIds: string[] = [];
      const appliesTo = effDef.appliesTo ?? "target";

      if (appliesTo === "self") {
        if (actorCombatant) targetCombatantIds.push(actorCombatant.id);
      } else if (appliesTo === "target") {
        if (castInfo.targetName) {
          const targetRef = findCombatantByName(castInfo.targetName, roster);
          if (targetRef) {
            const tid = (targetRef as any).characterId ?? (targetRef as any).monsterId ?? (targetRef as any).npcId;
            const targetC = combatants.find((c: any) => c.characterId === tid || c.monsterId === tid || c.npcId === tid);
            if (targetC) targetCombatantIds.push(targetC.id);
          }
        }
      } else if (appliesTo === "allies") {
        // Same faction as caster
        const actorIsPC = actorCombatant?.combatantType === "Character" || actorCombatant?.combatantType === "NPC";
        for (const c of combatants) {
          if (c.hpCurrent <= 0) continue;
          const isPC = c.combatantType === "Character" || c.combatantType === "NPC";
          if (isPC === actorIsPC) targetCombatantIds.push(c.id);
        }
      } else if (appliesTo === "enemies") {
        const actorIsPC = actorCombatant?.combatantType === "Character" || actorCombatant?.combatantType === "NPC";
        for (const c of combatants) {
          if (c.hpCurrent <= 0) continue;
          const isPC = c.combatantType === "Character" || c.combatantType === "NPC";
          if (isPC !== actorIsPC) targetCombatantIds.push(c.id);
        }
      }

      // Create ActiveEffect for each target
      for (const targetCId of targetCombatantIds) {
        const entityId = (() => {
          const c = combatants.find((x: any) => x.id === targetCId);
          return c?.characterId ?? c?.monsterId ?? c?.npcId ?? targetCId;
        })();

        const effect = createEffect(
          nanoid(),
          effDef.type,
          effDef.target,
          isConcentration ? "concentration" : effDef.duration,
          {
            value: effDef.value,
            diceValue: effDef.diceValue ? { count: effDef.diceValue.count, sides: effDef.diceValue.sides } : undefined,
            damageType: effDef.damageType,
            roundsRemaining: effDef.roundsRemaining,
            source: castInfo.spellName,
            sourceCombatantId: actorId,
            description: `${castInfo.spellName} (${effDef.type} on ${effDef.target})`,
            triggerAt: effDef.triggerAt,
            saveToEnd: effDef.saveToEnd ? { ability: effDef.saveToEnd.ability as any, dc: effDef.saveToEnd.dc } : undefined,
            conditionName: effDef.conditionName,
            triggerSave: effDef.triggerSave ? { ability: effDef.triggerSave.ability as any, dc: effDef.triggerSave.dc, halfDamageOnSave: effDef.triggerSave.halfDamageOnSave } : undefined,
            triggerConditions: effDef.triggerConditions,
            // For effects that target "attacks against this creature" (e.g., Dodge, Faerie Fire)
            targetCombatantId: effDef.target === "attack_rolls" && (effDef.type === "advantage" || effDef.type === "disadvantage") && appliesTo === "enemies"
              ? entityId
              : undefined,
          },
        );

        const targetC = combatants.find((c: any) => c.id === targetCId);
        if (targetC) {
          const updatedResources = addActiveEffectsToResources(targetC.resources ?? {}, effect);
          await this.deps.combatRepo.updateCombatantState(targetCId, {
            resources: updatedResources as any,
          });
          if (!appliedTo.includes(entityId)) appliedTo.push(entityId);
          if (this.debugLogsEnabled) console.log(`[SpellActionHandler] Applied effect "${effDef.type}→${effDef.target}" to ${targetCId} from ${castInfo.spellName}`);
        }
      }
    }

    // Mark action spent
    const actor = inferActorRef(actorId, roster);
    await this.deps.actions.castSpell(sessionId, {
      encounterId,
      actor,
      spellName: castInfo.spellName,
    });

    const targetNote = appliedTo.length > 0 ? ` affecting ${appliedTo.length} target(s)` : "";
    const concNote = isConcentration ? " [concentration]" : "";

    return {
      requiresPlayerInput: false,
      actionComplete: true,
      type: "SIMPLE_ACTION_COMPLETE",
      action: "CastSpell",
      message: `Cast ${castInfo.spellName}${targetNote}.${concNote}`,
    };
  }

  /**
   * Handle zone spell: creates a persistent CombatZone on the map.
   * Supports aura zones (Spirit Guardians), placed zones (Cloud of Daggers),
   * and stationary zones (Spike Growth).
   */
  private async handleZoneSpell(
    sessionId: string,
    encounterId: string,
    actorId: string,
    castInfo: { spellName: string; targetName?: string },
    spellMatch: {
      name: string;
      concentration?: boolean;
      zone?: {
        type: ZoneType;
        radiusFeet: number;
        shape?: ZoneShape;
        attachToSelf?: boolean;
        direction?: { x: number; y: number };
        width?: number;
        effects: Array<{
          trigger: ZoneEffectTrigger;
          damage?: { diceCount: number; diceSides: number; modifier?: number };
          damageType?: string;
          saveAbility?: string;
          saveDC?: number;
          halfDamageOnSave?: boolean;
          conditions?: string[];
          activeEffect?: { type: EffectType; target: EffectTarget; value?: number };
          affectsAllies?: boolean;
          affectsEnemies?: boolean;
          affectsSelf?: boolean;
        }>;
      };
    },
    isConcentration: boolean,
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    const zoneDef = spellMatch.zone!;

    const encounters = await this.deps.combatRepo.listEncountersBySession(sessionId);
    const encounter = encounters.find((e: any) => e.status === "Active") ?? encounters[0];
    if (!encounter) throw new ValidationError("No active encounter");

    const combatants = await this.deps.combatRepo.listCombatants(encounter.id);
    const actorCombatant = combatants.find(
      (c: any) => c.characterId === actorId || c.monsterId === actorId || c.npcId === actorId,
    );

    // Determine zone center — auras center on caster, placed zones use target position or caster position
    let map = encounter.mapData as unknown as CombatMap | undefined;
    let zoneCenter = { x: 0, y: 0 };

    // Helper: get position from mapData.entities first, then fall back to combatant resources
    const getEntityPosition = (entityId: string): { x: number; y: number } | null => {
      if (map) {
        const mapEntity = map.entities.find(e => e.id === entityId);
        if (mapEntity) return mapEntity.position;
      }
      // Fallback: read from combatant resources (entities are lazily populated in mapData)
      const combatant = combatants.find(
        (c: any) => c.characterId === entityId || c.monsterId === entityId || c.npcId === entityId,
      );
      if (combatant) return getPosition(combatant.resources);
      return null;
    };

    if (zoneDef.attachToSelf || zoneDef.type === "aura") {
      // Aura: center on caster
      const pos = getEntityPosition(actorId);
      if (pos) zoneCenter = pos;
    } else if (castInfo.targetName) {
      // Placed zone at target location — use target's position
      const targetRef = findCombatantByName(castInfo.targetName, roster);
      if (targetRef) {
        const tid = (targetRef as any).characterId ?? (targetRef as any).monsterId ?? (targetRef as any).npcId;
        const pos = getEntityPosition(tid);
        if (pos) zoneCenter = pos;
      }
    } else {
      // Default to caster's position
      const pos = getEntityPosition(actorId);
      if (pos) zoneCenter = pos;
    }

    // Build ZoneEffect array from spell declaration
    const zoneEffects: ZoneEffect[] = zoneDef.effects.map((eff) => {
      const ze: ZoneEffect = {
        trigger: eff.trigger,
        damage: eff.damage,
        damageType: eff.damageType,
        saveAbility: eff.saveAbility as any,
        saveDC: eff.saveDC,
        halfDamageOnSave: eff.halfDamageOnSave,
        conditions: eff.conditions,
        activeEffect: eff.activeEffect
          ? createEffect(
              nanoid(),
              eff.activeEffect.type,
              eff.activeEffect.target,
              isConcentration ? "concentration" : "permanent",
              {
                value: eff.activeEffect.value,
                source: castInfo.spellName,
                sourceCombatantId: actorId,
                description: `${castInfo.spellName} zone aura`,
              },
            )
          : undefined,
        affectsAllies: eff.affectsAllies,
        affectsEnemies: eff.affectsEnemies,
        affectsSelf: eff.affectsSelf,
      };
      return ze;
    });

    // Determine combat round/turn info
    const currentRound = encounter.round ?? 1;
    const currentTurnIndex = encounter.turn ?? 0;

    // Create the zone
    const zone = createZone(
      nanoid(),
      zoneDef.type,
      zoneCenter,
      zoneDef.radiusFeet,
      castInfo.spellName,
      actorId,
      zoneEffects,
      isConcentration ? "concentration" : "rounds",
      {
        attachedTo: zoneDef.attachToSelf || zoneDef.type === "aura" ? actorId : undefined,
        shape: zoneDef.shape ?? "circle",
        createdAtRound: currentRound,
        createdAtTurnIndex: currentTurnIndex,
        direction: zoneDef.direction,
        width: zoneDef.width,
      },
    );

    // Add zone to map data
    if (map) {
      const updatedMap = addZone(map, zone);
      await this.deps.combatRepo.updateEncounter(encounter.id, {
        mapData: updatedMap as unknown as JsonValue,
      });
      if (this.debugLogsEnabled) console.log(`[SpellActionHandler] Created zone "${zone.id}" for ${castInfo.spellName} at (${zoneCenter.x}, ${zoneCenter.y}) radius=${zoneDef.radiusFeet}ft`);
    }

    // Mark action spent
    const actor = inferActorRef(actorId, roster);
    await this.deps.actions.castSpell(sessionId, {
      encounterId,
      actor,
      spellName: castInfo.spellName,
    });

    const concNote = isConcentration ? " [concentration]" : "";
    const typeNote = zoneDef.type === "aura" ? " (aura, moves with caster)" : ` at (${zoneCenter.x}, ${zoneCenter.y})`;

    return {
      requiresPlayerInput: false,
      actionComplete: true,
      type: "SIMPLE_ACTION_COMPLETE",
      action: "CastSpell",
      message: `Cast ${castInfo.spellName}${typeNote}, ${zoneDef.radiusFeet}ft radius.${concNote}`,
    };
  }
}
