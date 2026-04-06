/**
 * SaveSpellDeliveryHandler — handles saving throw spells.
 * Covers: Burning Hands, Hold Person, Thunderwave, etc.
 *
 * Supports both single-target spells and area-of-effect (AoE) spells.
 * AoE spells roll damage once and apply it to each creature in the area
 * with independent saving throws (D&D 5e 2024).
 *
 * Dispatches to handleAoE() when spellMatch.area is set, otherwise handleSingleTarget().
 *
 * Delegates save resolution to SavingThrowResolver which handles proficiency,
 * effect bonuses (Bless), and advantage/disadvantage on saves.
 */

import { ValidationError } from '../../../../errors.js';
import { normalizeResources, getPosition } from '../../helpers/resource-utils.js';
import { applyKoEffectsIfNeeded } from '../../helpers/ko-handler.js';
import { findCombatantByName } from '../combat-text-parser.js';
import { applyDamageDefenses, extractDamageDefenses } from '../../../../../domain/rules/damage-defenses.js';
import { applyEvasion } from '../../../../../domain/rules/evasion.js';
import { getCoverLevel, getCoverSaveBonus } from '../../../../../domain/rules/combat-map.js';
import { getCreaturesInArea, computeDirection } from '../../../../../domain/rules/area-of-effect.js';
import type { AreaTarget } from '../../../../../domain/rules/area-of-effect.js';
import type { Position } from '../../../../../domain/rules/movement.js';
import type { CombatMap } from '../../../../../domain/rules/combat-map.js';
import type { PreparedSpellDefinition } from '../../../../../domain/entities/spells/prepared-spell-definition.js';
import { getUpcastBonusDice } from '../../../../../domain/entities/spells/prepared-spell-definition.js';
import type { ActionParseResult } from '../tabletop-types.js';
import type { SpellCastingContext, SpellDeliveryDeps, SpellDeliveryHandler } from './spell-delivery-handler.js';
import { computeSpellSaveDC } from '../../../../../domain/rules/spell-casting.js';

/** Result of processing a single target in a save spell. */
interface TargetResult {
  targetName: string;
  saveSuccess: boolean;
  rawRoll: number;
  modifier: number;
  total: number;
  damage: number;
  hpBefore: number;
  hpAfter: number;
  conditionsApplied: string[];
  fullCover: boolean;
}

export class SaveSpellDeliveryHandler implements SpellDeliveryHandler {
  constructor(private readonly handlerDeps: SpellDeliveryDeps) {}

  canHandle(spell: PreparedSpellDefinition): boolean {
    return !!(spell.saveAbility && this.handlerDeps.deps.diceRoller);
  }

  async handle(ctx: SpellCastingContext): Promise<ActionParseResult> {
    if (ctx.spellMatch.area) {
      return this.handleAoE(ctx);
    }
    return this.handleSingleTarget(ctx);
  }

  // ——————————————————————————————————————————————
  // Single-target path (spells without area)
  // ——————————————————————————————————————————————

  private async handleSingleTarget(ctx: SpellCastingContext): Promise<ActionParseResult> {
    const {
      sessionId,
      encounterId,
      actorId,
      castInfo,
      spellMatch,
      spellLevel,
      castAtLevel,
      sheet,
      characters,
      actor,
      roster,
      encounter,
      combatants,
      actorCombatant,
    } = ctx;
    const { deps, eventEmitter, debugLogsEnabled, savingThrowResolver } = this.handlerDeps;

    const targetName = castInfo.targetName;
    if (!targetName) {
      throw new ValidationError(
        `${castInfo.spellName} requires a target. Usage: cast ${castInfo.spellName} at <target>`,
      );
    }

    const targetRef = findCombatantByName(targetName, roster);
    if (!targetRef) {
      throw new ValidationError(`Target "${targetName}" not found`);
    }

    const targetId =
      (targetRef as any).characterId ?? (targetRef as any).monsterId ?? (targetRef as any).npcId;
    const spellSaveDC = computeSpellSaveDC(sheet);
    const saveAbility = spellMatch.saveAbility!;

    // Look up target's stats for damage resistance/immunity/vulnerability
    const allMonsters = await deps.monsters.listBySession(sessionId);
    const allNpcs = await deps.npcs.listBySession(sessionId);
    const targetMonster = allMonsters.find((m) => m.id === targetId);
    const targetChar = characters.find((c) => c.id === targetId);
    const targetNpc = allNpcs.find((n) => n.id === targetId);
    const targetStats =
      (targetMonster as any)?.statBlock ??
      (targetChar as any)?.sheet ??
      (targetNpc as any)?.statBlock ??
      {};

    // D&D 5e 2024: DEX saving throw cover bonus
    let coverBonus = 0;
    if (saveAbility === "dexterity") {
      const map = encounter?.mapData as unknown as CombatMap | undefined;
      if (map && map.cells && map.cells.length > 0) {
        const targetCombatant = combatants.find(
          (c: any) =>
            c.characterId === targetId || c.monsterId === targetId || c.npcId === targetId,
        );
        const casterPos = actorCombatant
          ? getPosition(normalizeResources(actorCombatant.resources ?? {}))
          : null;
        const targetPos = targetCombatant
          ? getPosition(normalizeResources(targetCombatant.resources ?? {}))
          : null;
        if (casterPos && targetPos) {
          const coverLevel = getCoverLevel(map, casterPos, targetPos);
          if (coverLevel === "full") {
            // Total cover — target is unaffected. Consume action economy and return.
            await deps.actions.castSpell(sessionId, {
              encounterId,
              actor,
              spellName: castInfo.spellName,
            });
            const effectiveLevel = castAtLevel ?? spellLevel;
            const slotNote = effectiveLevel > 0 ? ` (level ${effectiveLevel} slot spent)` : "";
            return {
              requiresPlayerInput: false,
              actionComplete: true,
              type: "SIMPLE_ACTION_COMPLETE" as const,
              action: "CastSpell",
              message: `Cast ${castInfo.spellName} at ${targetName}.${slotNote} ${targetName} has total cover and is unaffected.`,
            };
          }
          coverBonus = getCoverSaveBonus(coverLevel);
        }
      }
    }

    // Delegate save resolution to SavingThrowResolver (handles proficiency, effect bonuses,
    // advantage/disadvantage from Bless, conditions, etc.)
    const saveAction = savingThrowResolver!.buildPendingAction({
      actorId: targetId,
      sourceId: actorId,
      ability: saveAbility,
      dc: spellSaveDC,
      reason: castInfo.spellName,
      onSuccess: { summary: "Save succeeded" },
      onFailure: {
        summary: "Save failed",
        conditions: spellMatch.conditions?.onFailure
          ? { add: spellMatch.conditions.onFailure }
          : undefined,
      },
      context: coverBonus > 0 ? { coverBonus } : undefined,
    });

    const resolution = await savingThrowResolver!.resolve(
      saveAction,
      encounter.id,
      characters,
      allMonsters as any[],
      allNpcs as any[],
    );
    const saveSuccess = resolution.success;

    if (debugLogsEnabled)
      console.log(
        `[SaveSpellDeliveryHandler] ${targetName} ${saveAbility} save: d20(${resolution.rawRoll}) + ${resolution.modifier} = ${resolution.total} vs DC ${spellSaveDC} → ${saveSuccess ? "SUCCESS" : "FAILURE"}`,
      );

    // Calculate and apply damage
    const spellDamage = spellMatch.damage;
    let damageMessage = "";
    if (spellDamage) {
      // Upcast scaling: add bonus dice per slot level above base
      let diceCount = spellDamage.diceCount;
      const upcastBonus = getUpcastBonusDice(spellMatch, castAtLevel);
      if (upcastBonus) {
        diceCount += upcastBonus.bonusDiceCount;
      }
      const damageRoll = deps.diceRoller!.rollDie(spellDamage.diceSides, diceCount);
      let totalDamage = damageRoll.total + (spellDamage.modifier ?? 0);

      // Half damage on save (D&D 5e standard for many save spells)
      // Evasion (Rogue 7/Monk 7): DEX save success = 0 damage, failure = half damage
      const halfOnSave = spellMatch.halfDamageOnSave ?? true;
      totalDamage = applyEvasion(totalDamage, saveSuccess, !!resolution.hasEvasion, halfOnSave);

      if (totalDamage > 0) {
        const targetCombatant = combatants.find(
          (c: any) =>
            c.characterId === targetId || c.monsterId === targetId || c.npcId === targetId,
        );
        if (targetCombatant) {
          // Apply damage resistance/immunity/vulnerability for spell damage
          const spellDmgType = spellMatch.damageType;
          if (spellDmgType && totalDamage > 0) {
            const spellDefenses = extractDamageDefenses(targetStats);
            if (
              spellDefenses.damageResistances ||
              spellDefenses.damageImmunities ||
              spellDefenses.damageVulnerabilities
            ) {
              const defResult = applyDamageDefenses(totalDamage, spellDmgType, spellDefenses);
              totalDamage = defResult.adjustedDamage;
            }
          }
          const hpBefore = targetCombatant.hpCurrent;
          const hpAfter = Math.max(0, hpBefore - totalDamage);
          await deps.combatRepo.updateCombatantState(targetCombatant.id, { hpCurrent: hpAfter });

          // Apply KO effects if target dropped to 0 HP
          await applyKoEffectsIfNeeded(
            targetCombatant,
            hpBefore,
            hpAfter,
            deps.combatRepo,
          );

          await eventEmitter.emitDamageEvents(
            sessionId,
            encounter.id,
            actorId,
            targetId,
            characters,
            allMonsters as any,
            totalDamage,
            hpAfter,
          );
          damageMessage = ` ${totalDamage} ${spellMatch.damageType ?? ""} damage (HP: ${hpBefore} → ${hpAfter}).`;

          // Check victory
          if (hpAfter <= 0 && deps.victoryPolicy) {
            const allCombatants = await deps.combatRepo.listCombatants(encounter.id);
            const result = await deps.victoryPolicy.evaluate({ combatants: allCombatants });
            if (result) {
              await deps.combatRepo.updateEncounter(encounter.id, { status: result });
            }
          }
        }
      } else {
        damageMessage = " No damage (save succeeded).";
      }
    }

    // Condition message from resolver results (conditions already applied by resolver)
    const conditionMessage =
      resolution.conditionsApplied.length > 0
        ? ` ${resolution.conditionsApplied.join(", ")} applied!`
        : "";

    // Mark action spent
    await deps.actions.castSpell(sessionId, {
      encounterId,
      actor,
      spellName: castInfo.spellName,
    });

    const effectiveLevel = castAtLevel ?? spellLevel;
    const slotNote = effectiveLevel > 0 ? ` (level ${effectiveLevel} slot spent)` : "";
    const saveResult = saveSuccess ? "Save succeeded" : "Save failed";

    return {
      requiresPlayerInput: false,
      actionComplete: true,
      type: "SIMPLE_ACTION_COMPLETE",
      action: "CastSpell",
      message: `Cast ${castInfo.spellName} at ${targetName}.${slotNote} ${saveAbility.charAt(0).toUpperCase() + saveAbility.slice(1)} save DC ${spellSaveDC}: d20(${resolution.rawRoll})+${resolution.modifier}=${resolution.total}. ${saveResult}.${damageMessage}${conditionMessage}`,
    };
  }

  // ——————————————————————————————————————————————
  // AoE path (spells with area)
  // ——————————————————————————————————————————————

  /**
   * Resolve an area-of-effect saving throw spell (Burning Hands, Fireball, Thunderwave, etc.)
   *
   * Damage is rolled ONCE and applied to each creature in the area independently;
   * each creature makes its own saving throw (D&D 5e 2024 AoE rules).
   *
   * Targeting:
   *   - Directional AoE (cone/cube/line): optional targetName sets the aim direction
   *     (the named creature is included if within the geometry).
   *   - Centered AoE (sphere/cylinder): optional targetName sets the center of the area;
   *     falls back to caster position when omitted.
   *   - No-position fallback: when combatants have no grid positions, applies to the named
   *     target only (single-target fallback) or all non-caster combatants if none named.
   */
  private async handleAoE(ctx: SpellCastingContext): Promise<ActionParseResult> {
    const {
      sessionId,
      encounterId,
      actorId,
      castInfo,
      spellMatch,
      spellLevel,
      castAtLevel,
      sheet,
      characters,
      actor,
      roster,
      encounter,
      combatants,
      actorCombatant,
    } = ctx;
    const { deps, eventEmitter, debugLogsEnabled, savingThrowResolver } = this.handlerDeps;

    const area = spellMatch.area!;
    const spellSaveDC = computeSpellSaveDC(sheet);
    const saveAbility = spellMatch.saveAbility!;

    const allMonsters = await deps.monsters.listBySession(sessionId);
    const allNpcs = await deps.npcs.listBySession(sessionId);

    // --- Resolve caster position ---
    const casterPos: Position | null = actorCombatant
      ? getPosition(normalizeResources(actorCombatant.resources ?? {}))
      : null;

    // --- Optionally resolve named target to set direction / center ---
    const targetName = castInfo.targetName;
    let targetEntityId: string | null = null;
    let targetCombatant: any | null = null;
    if (targetName) {
      const targetRef = findCombatantByName(targetName, roster);
      if (targetRef) {
        targetEntityId =
          (targetRef as any).characterId ?? (targetRef as any).monsterId ?? (targetRef as any).npcId;
        targetCombatant = combatants.find(
          (c: any) =>
            c.characterId === targetEntityId ||
            c.monsterId === targetEntityId ||
            c.npcId === targetEntityId,
        );
      }
    }
    const targetPos: Position | null = targetCombatant
      ? getPosition(normalizeResources(targetCombatant.resources ?? {}))
      : null;

    // --- Determine AoE origin and direction ---
    let origin: Position;
    let direction: Position | null = null;

    if (area.type === 'sphere' || area.type === 'cylinder') {
      // Centered AoE: origin is the aimed-at target position, or caster position as fallback
      origin = targetPos ?? casterPos ?? { x: 0, y: 0 };
    } else {
      // Directional AoE (cone / cube / line): origin is the caster
      origin = casterPos ?? { x: 0, y: 0 };
      if (casterPos && targetPos) {
        direction = computeDirection(casterPos, targetPos);
      }
    }

    // --- Build potential target list (combatants with grid positions) ---
    const areaTargets: AreaTarget[] = [];
    for (const c of combatants) {
      const entityId: string | undefined =
        (c as any).characterId ?? (c as any).monsterId ?? (c as any).npcId;
      if (!entityId || entityId === actorId) continue; // Exclude caster
      const pos = getPosition(normalizeResources((c as any).resources ?? {}));
      if (pos) {
        areaTargets.push({ id: entityId, position: pos });
      }
    }

    // --- Determine which creatures are affected ---
    let creaturesInArea: string[];
    if (casterPos || area.type === 'sphere' || area.type === 'cylinder') {
      // Use geometry when positions are available
      creaturesInArea = getCreaturesInArea(origin, area, direction, areaTargets);
    } else if (targetEntityId) {
      // No-position fallback: apply to the named target only
      creaturesInArea = [targetEntityId];
    } else {
      // No positions AND no named target: apply to all non-caster combatants
      creaturesInArea = combatants
        .map((c: any) => (c as any).characterId ?? (c as any).monsterId ?? (c as any).npcId)
        .filter((id: string | undefined): id is string => !!id && id !== actorId);
    }

    // --- Spend action (slot already spent by SpellActionHandler) ---
    await deps.actions.castSpell(sessionId, { encounterId, actor, spellName: castInfo.spellName });

    const effectiveLevel = castAtLevel ?? spellLevel;
    const slotNote = effectiveLevel > 0 ? ` (level ${effectiveLevel} slot spent)` : '';

    if (creaturesInArea.length === 0) {
      return {
        requiresPlayerInput: false,
        actionComplete: true,
        type: 'SIMPLE_ACTION_COMPLETE' as const,
        action: 'CastSpell',
        message: `Cast ${castInfo.spellName} (${area.size}ft ${area.type}).${slotNote} No creatures were in the area of effect.`,
      };
    }

    // --- Roll damage ONCE (shared across all targets per D&D 5e AoE rules) ---
    const spellDamage = spellMatch.damage;
    let sharedBaseDamage = 0;
    if (spellDamage) {
      let diceCount = spellDamage.diceCount;
      const upcastBonus = getUpcastBonusDice(spellMatch, castAtLevel);
      if (upcastBonus) diceCount += upcastBonus.bonusDiceCount;
      const roll = deps.diceRoller!.rollDie(spellDamage.diceSides, diceCount);
      sharedBaseDamage = roll.total + (spellDamage.modifier ?? 0);
    }

    // --- Process each creature in the area independently ---
    const targetResults: TargetResult[] = [];

    for (const entityId of creaturesInArea) {
      const targetComb = combatants.find(
        (c: any) =>
          c.characterId === entityId || c.monsterId === entityId || c.npcId === entityId,
      );
      if (!targetComb) continue;

      // Resolve display name
      const rosterEntry =
        roster.characters.find((c: any) => c.id === entityId) ??
        roster.monsters.find((m: any) => m.id === entityId) ??
        (roster.npcs ?? []).find((n: any) => n.id === entityId);
      const displayName: string = rosterEntry?.name ?? entityId;

      // Look up stats for damage defenses
      const tMonster = allMonsters.find((m: any) => m.id === entityId);
      const tChar = characters.find((c: any) => c.id === entityId);
      const tNpc = allNpcs.find((n: any) => n.id === entityId);
      const tStats =
        (tMonster as any)?.statBlock ??
        (tChar as any)?.sheet ??
        (tNpc as any)?.statBlock ??
        {};

      // Independent saving throw per creature
      const saveAction = savingThrowResolver!.buildPendingAction({
        actorId: entityId,
        sourceId: actorId,
        ability: saveAbility,
        dc: spellSaveDC,
        reason: castInfo.spellName,
        onSuccess: { summary: 'Save succeeded' },
        onFailure: {
          summary: 'Save failed',
          conditions: spellMatch.conditions?.onFailure
            ? { add: spellMatch.conditions.onFailure }
            : undefined,
        },
      });
      const resolution = await savingThrowResolver!.resolve(
        saveAction,
        encounter.id,
        characters,
        allMonsters as any[],
        allNpcs as any[],
      );
      const saveSuccess = resolution.success;

      if (debugLogsEnabled) {
        console.log(
          `[SaveSpellDeliveryHandler AoE] ${displayName} ${saveAbility} save: d20(${resolution.rawRoll})+${resolution.modifier}=${resolution.total} vs DC ${spellSaveDC} → ${saveSuccess ? 'SUCCESS' : 'FAILURE'}`,
        );
      }

      // Apply damage (using shared roll, adjusted per creature's saves/defenses)
      let totalDamage = sharedBaseDamage;
      const hpBefore: number = targetComb.hpCurrent;
      let hpAfter: number = hpBefore;

      if (spellDamage && totalDamage > 0) {
        const halfOnSave = spellMatch.halfDamageOnSave ?? true;
        totalDamage = applyEvasion(totalDamage, saveSuccess, !!resolution.hasEvasion, halfOnSave);

        const spellDmgType = spellMatch.damageType;
        if (spellDmgType && totalDamage > 0) {
          const defenses = extractDamageDefenses(tStats);
          if (defenses.damageResistances || defenses.damageImmunities || defenses.damageVulnerabilities) {
            const defResult = applyDamageDefenses(totalDamage, spellDmgType, defenses);
            totalDamage = defResult.adjustedDamage;
          }
        }

        if (totalDamage > 0) {
          hpAfter = Math.max(0, hpBefore - totalDamage);
          await deps.combatRepo.updateCombatantState(targetComb.id, { hpCurrent: hpAfter });
          await applyKoEffectsIfNeeded(targetComb, hpBefore, hpAfter, deps.combatRepo);
          await eventEmitter.emitDamageEvents(
            sessionId,
            encounter.id,
            actorId,
            entityId,
            characters,
            allMonsters as any,
            totalDamage,
            hpAfter,
          );
        }
      }

      targetResults.push({
        targetName: displayName,
        saveSuccess,
        rawRoll: resolution.rawRoll,
        modifier: resolution.modifier,
        total: resolution.total,
        damage: totalDamage,
        hpBefore,
        hpAfter,
        conditionsApplied: resolution.conditionsApplied,
        fullCover: false,
      });
    }

    // --- Victory check (once after all damage applied) ---
    if (deps.victoryPolicy) {
      const allCombatants = await deps.combatRepo.listCombatants(encounter.id);
      const victoryResult = await deps.victoryPolicy.evaluate({ combatants: allCombatants });
      if (victoryResult) {
        await deps.combatRepo.updateEncounter(encounter.id, { status: victoryResult });
      }
    }

    // --- Build result message ---
    const targetSummaries = targetResults
      .map((r) => {
        const savedStr = r.saveSuccess ? 'saved' : 'failed';
        const dmgStr = r.damage > 0 ? `${r.damage} dmg (${r.hpBefore}→${r.hpAfter} HP)` : 'no dmg';
        const condStr = r.conditionsApplied.length > 0 ? `, ${r.conditionsApplied.join(', ')}` : '';
        return `${r.targetName} [${savedStr}${condStr}]: ${dmgStr}`;
      })
      .join('; ');

    const areaDesc = `${area.size}ft ${area.type}`;
    const abilityName = saveAbility.charAt(0).toUpperCase() + saveAbility.slice(1);
    return {
      requiresPlayerInput: false,
      actionComplete: true,
      type: 'SIMPLE_ACTION_COMPLETE' as const,
      action: 'CastSpell',
      message: `Cast ${castInfo.spellName} (${areaDesc}).${slotNote} ${abilityName} save DC ${spellSaveDC}. Affected ${creaturesInArea.length} creature${creaturesInArea.length > 1 ? 's' : ''}: ${targetSummaries}`,
    };
  }
}
