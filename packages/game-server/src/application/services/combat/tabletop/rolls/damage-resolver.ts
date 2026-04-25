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
  CombatantStateRecord,
  JsonValue,
} from "../../../../types.js";
import {
  normalizeResources,
  getActiveEffects,
  setActiveEffects,
  getPosition,
  patchResources,
  canMakeAttack,
  getAttacksAllowedThisTurn,
  getAttacksUsedThisTurn,
} from "../../helpers/resource-utils.js";
import {
  getDamageDefenseEffects,
  type ActiveEffect,
  createEffect,
} from "../../../../../domain/entities/combat/effects.js";
import { applyKoEffectsIfNeeded, applyDamageWhileUnconscious } from "../../helpers/ko-handler.js";
import { applyDamageWithTempHp, readTempHp, withTempHp } from "../../helpers/temp-hp.js";
import { qualifiesForDarkOnesBlessing, darkOnesBlessingTempHp } from "../../../../../domain/entities/classes/warlock.js";
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
import { addActiveEffectsToResources } from "../../helpers/resource-utils.js";
import type {
  TabletopCombatServiceDeps,
  AttackPendingAction,
  DamagePendingAction,
  DamageResult,
  HitRiderEnhancementResult,
  HitRiderEnhancement,
  SaveOutcome,
} from "../tabletop-types.js";
import type { RollResultCommand } from "../../../../commands/game-command.js";
import type { WeaponMasteryResolver } from "./weapon-mastery-resolver.js";
import type { HitRiderResolver } from "./hit-rider-resolver.js";
import { findCombatantByEntityId, getEntityId } from "../../helpers/combatant-lookup.js";
import { rollModePrompt } from "../roll-state-machine.js";
import { computeFeatModifiers, shouldApplyDueling } from "../../../../../domain/rules/feat-modifiers.js";
import { ClassFeatureResolver } from "../../../../../domain/entities/classes/class-feature-resolver.js";
import { rogueCunningStrikeSaveDC } from "../../../../../domain/entities/classes/rogue.js";
import { mergeFightingStyleFeatId } from "../../../../../domain/entities/classes/fighting-style.js";
import { classHasFeature } from "../../../../../domain/entities/classes/registry.js";
import { ELEMENTAL_AFFINITY, COLOSSUS_SLAYER } from "../../../../../domain/entities/classes/feature-keys.js";

/**
 * Map a Draconic Sorcery subclass id (e.g., "draconic-sorcery-red") to the
 * damage type granted by its draconic ancestry. Returns undefined when the
 * subclass id does not match a known ancestry or is absent.
 */
function draconicAncestryDamageType(subclassId: string | undefined): string | undefined {
  if (!subclassId) return undefined;
  const id = subclassId.toLowerCase();
  if (id.includes("red") || id.includes("gold") || id.includes("brass")) return "fire";
  if (id.includes("blue") || id.includes("bronze")) return "lightning";
  if (id.includes("green")) return "poison";
  if (id.includes("black") || id.includes("copper")) return "acid";
  if (id.includes("white") || id.includes("silver")) return "cold";
  return undefined;
}

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
    // CO-M5: Pre-load combatants once. Reloaded after HP mutations that may affect
    // downstream logic (KO, concentration, retaliatory damage, victory check).
    let combatants = await this.deps.combatRepo.listCombatants(encounter.id);

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

    // ── Fighting Style: Dueling (+2 damage one-handed melee, no other weapons) ──
    // Also TWF-style ability modifier on offhand attacks, and GWF die-min transform.
    const actorCharForStyle = characters.find((c) => c.id === action.actorId);
    const actorSheetForStyle = (actorCharForStyle?.sheet ?? {}) as Record<string, unknown>;
    const rawFeatIdsDmg = (actorSheetForStyle.featIds as string[] | undefined)
      ?? (actorSheetForStyle.feats as string[] | undefined) ?? [];
    const fightingStyleDmg = actorSheetForStyle.fightingStyle as string | undefined;
    const mergedFeatsDmg = mergeFightingStyleFeatId(rawFeatIdsDmg, fightingStyleDmg);
    const dmgFeatMods = computeFeatModifiers(mergedFeatsDmg);
    // Dueling: +2 bonus to damage when wielding a melee weapon in one hand and no two-handed
    if (
      dmgFeatMods.duelingDamageBonus &&
      shouldApplyDueling({
        attackKind: action.weaponSpec?.kind,
        weapon: {
          hands: action.weaponSpec?.hands,
          properties: action.weaponSpec?.properties,
        },
        // If this is an offhand attack, an offhand weapon is definitionally
        // wielded, so Dueling must not apply. (Mainhand attacks with an
        // offhand weapon equipped are not yet detectable here — tracked
        // separately; for now this at least gates the offhand case.)
        offhandWeaponEquipped: action.bonusAction === "offhand-attack",
      })
    ) {
      totalDamage += dmgFeatMods.duelingDamageBonus;
      if (this.debugLogsEnabled) console.log(`[DamageResolver] Dueling fighting style: +${dmgFeatMods.duelingDamageBonus} damage`);
    }
    // Two-Weapon Fighting: add ability modifier to offhand damage
    // (Normally offhand attack omits the mod; TWF style restores it.)
    if (
      dmgFeatMods.twoWeaponFightingAddsAbilityModifierToBonusAttackDamage &&
      action.bonusAction === "offhand-attack"
    ) {
      // Compute STR or DEX mod (whichever is higher for a light weapon per 2024 RAW)
      const abilityScores = (actorSheetForStyle.abilityScores as Record<string, number> | undefined) ?? {};
      const strMod = Math.floor(((abilityScores.strength ?? 10) - 10) / 2);
      const dexMod = Math.floor(((abilityScores.dexterity ?? 10) - 10) / 2);
      const useMod = action.weaponSpec?.kind === "ranged" ? dexMod : Math.max(strMod, dexMod);
      if (useMod > 0) {
        totalDamage += useMod;
        if (this.debugLogsEnabled) console.log(`[DamageResolver] TWF fighting style: +${useMod} offhand damage`);
      }
    }

    // ── ActiveEffect: extra damage (flat + dice) ──
    // Both flat bonuses (Rage +2) and dice bonuses (Hex 1d6) are added server-side.
    // The displayed damage formula only includes flat bonuses for informational purposes —
    // dice bonuses are intentionally omitted from the formula to avoid double-counting
    // (the player types raw dice results; the server adds all bonuses automatically).
    const actorCombatant = findCombatantByEntityId(combatants, action.actorId);
    const actorRes = actorCombatant?.resources ?? {} as Record<string, unknown>;
    let effectBonusSuffix = ""; // human-readable suffix for damage messages (e.g., " + 4[hex]")
    {
      const attackerEffects = getActiveEffects(actorCombatant?.resources ?? {});
      const targetId = action.targetId;
      const isMelee = action.weaponSpec?.kind === "melee";
      const isRanged = action.weaponSpec?.kind === "ranged";
      // Filter for damage_rolls effects, honouring targetCombatantId for Hunter's Mark etc.
      // Also match melee/ranged-specific damage effects.
      // Exclude effects with triggerAt === 'on_next_weapon_hit' — those belong exclusively
      // to the HitRider pipeline (HitRiderResolver.assembleOnHitEnhancements) which is
      // responsible for rolling their dice, applying saves, consuming the rider, and
      // ending concentration. Without this exclusion, smite-spell riders (Searing /
      // Thunderous / Wrathful / Branding Smite, Ensnaring Strike, Divine Favor, etc.)
      // would be double-counted — once here and once in the enhancement loop below.
      const dmgEffects = attackerEffects.filter(
        e => (e.type === 'bonus' || e.type === 'penalty')
          && e.triggerAt !== 'on_next_weapon_hit'
          && (e.target === 'damage_rolls'
            || (e.target === 'melee_damage_rolls' && isMelee)
            || (e.target === 'ranged_damage_rolls' && isRanged))
          && (!e.targetCombatantId || e.targetCombatantId === targetId)
      );
      let effectFlatDmg = 0;
      let effectDiceDmg = 0;
      const effectDiceLabels: string[] = [];
      for (const eff of dmgEffects) {
        // Flat bonuses/penalties
        if (eff.type === 'bonus') effectFlatDmg += eff.value ?? 0;
        if (eff.type === 'penalty') effectFlatDmg -= eff.value ?? 0;
        // Dice bonuses (Hex 1d6, Hunter's Mark 1d6) — rolled server-side
        if (eff.diceValue && this.deps.diceRoller) {
          const sign = eff.type === 'penalty' ? -1 : 1;
          const label = eff.source ?? "effect";
          const count = Math.abs(eff.diceValue.count);
          let diceTotal = 0;
          for (let i = 0; i < count; i++) {
            diceTotal += this.deps.diceRoller.rollDie(eff.diceValue.sides).total;
          }
          effectDiceDmg += sign * diceTotal;
          effectDiceLabels.push(`${sign > 0 ? "+" : "-"} ${Math.abs(sign * diceTotal)}[${label}]`);
        }
      }
      const effectDmgTotal = effectFlatDmg + effectDiceDmg;
      if (effectDmgTotal !== 0) {
        totalDamage = Math.max(0, totalDamage + effectDmgTotal);
        if (this.debugLogsEnabled) console.log(`[DamageResolver] ActiveEffect damage bonus: +${effectFlatDmg} flat, +${effectDiceDmg} dice (total now ${totalDamage})`);
      }
      // Build human-readable suffix showing dice contributions in damage messages
      if (effectDiceLabels.length > 0) {
        effectBonusSuffix = ` ${effectDiceLabels.join(" ")}`;
      }
    }

    // ── Class feature damage riders (Elemental Affinity, Colossus Slayer) ──
    // Applied after active-effect bonuses but before damage-type defenses so that
    // resistance/vulnerability applies to the total. Both features are
    // once-per-turn, tracked via resource flags that reset on turn start.
    {
      const className = typeof actorCharForStyle?.className === "string" ? actorCharForStyle.className : null;
      const level = typeof actorCharForStyle?.level === "number"
        ? actorCharForStyle.level
        : (typeof (actorSheetForStyle.level) === "number" ? (actorSheetForStyle.level as number) : 0);
      const subclass = typeof actorSheetForStyle.subclass === "string" ? actorSheetForStyle.subclass : undefined;
      const dmgType = action.weaponSpec?.damageType?.toLowerCase();
      const actorResRec = actorRes as Record<string, unknown>;

      // Elemental Affinity (Draconic Sorcery, L5): +CHA mod to one instance of
      // damage per turn whose type matches draconic ancestry.
      if (
        className &&
        dmgType &&
        classHasFeature(className, ELEMENTAL_AFFINITY, level, subclass) &&
        !actorResRec.elementalAffinityUsedThisTurn
      ) {
        const ancestryDamageType = draconicAncestryDamageType(subclass);
        if (ancestryDamageType && ancestryDamageType === dmgType) {
          const abilityScores = (actorSheetForStyle.abilityScores as Record<string, number> | undefined) ?? {};
          const chaMod = Math.floor(((abilityScores.charisma ?? 10) - 10) / 2);
          if (chaMod > 0) {
            totalDamage += chaMod;
            effectBonusSuffix += ` + ${chaMod}[elemental-affinity]`;
            // Mark flag immediately on the in-memory resource snapshot so the
            // next damage event this turn won't re-apply.
            actorResRec.elementalAffinityUsedThisTurn = true;
            if (actorCombatant) {
              await this.deps.combatRepo.updateCombatantState(actorCombatant.id, {
                resources: { ...actorResRec, elementalAffinityUsedThisTurn: true } as any,
              });
            }
            if (this.debugLogsEnabled) console.log(`[DamageResolver] Elemental Affinity: +${chaMod} ${dmgType} damage`);
          }
        }
      }

      // Colossus Slayer (Ranger — Hunter, L3): +1d8 damage once per turn when
      // target has taken any damage (HP below max).
      if (
        className &&
        classHasFeature(className, COLOSSUS_SLAYER, level, subclass) &&
        !actorResRec.colossusSlayerUsedThisTurn &&
        this.deps.diceRoller
      ) {
        const targetForCS = findCombatantByEntityId(combatants, action.targetId);
        const csHpMax = targetForCS?.hpMax ?? 0;
        const csHpBefore = targetForCS?.hpCurrent ?? 0;
        if (targetForCS && csHpMax > 0 && csHpBefore > 0 && csHpBefore < csHpMax) {
          const csDie = this.deps.diceRoller.rollDie(8).total;
          totalDamage += csDie;
          effectBonusSuffix += ` + ${csDie}[colossus-slayer]`;
          actorResRec.colossusSlayerUsedThisTurn = true;
          if (actorCombatant) {
            await this.deps.combatRepo.updateCombatantState(actorCombatant.id, {
              resources: { ...actorResRec, colossusSlayerUsedThisTurn: true } as any,
            });
          }
          if (this.debugLogsEnabled) console.log(`[DamageResolver] Colossus Slayer: +${csDie} damage (wounded target)`);
        }
      }
    }

    // Apply damage resistance/immunity/vulnerability
    const damageType = action.weaponSpec?.damageType;
    if (totalDamage > 0 && damageType) {
      const targetSheet = (target as any).statBlock ?? (target as any).sheet ?? {};
      const defenses = extractDamageDefenses(targetSheet);

      // ── ActiveEffect: damage defense modifiers (resistance/vulnerability/immunity) ──
      // Includes Rage B/P/S resistance, spell-granted resistances, etc.
      const targetCombatantForDefenses = findCombatantByEntityId(combatants, action.targetId);
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

    // Apply damage — use cached combatants (no HP mutations since load)
    const targetCombatant = findCombatantByEntityId(combatants, action.targetId);

    const hpBefore = targetCombatant?.hpCurrent ?? 0;
    let hpAfter = hpBefore;

    if (targetCombatant) {
      const tempBefore = readTempHp(targetCombatant.resources);
      const abs = applyDamageWithTempHp(targetCombatant.hpCurrent, tempBefore, totalDamage);
      hpAfter = abs.hpAfter;
      if (this.debugLogsEnabled) console.log(`[DamageResolver] HP change: ${hpBefore} -> ${hpAfter} (target: ${targetCombatant.id}, damage: ${totalDamage}, tempAbsorbed: ${abs.tempAbsorbed})`);
      await this.deps.combatRepo.updateCombatantState(targetCombatant.id, { hpCurrent: hpAfter });
      if (abs.tempAbsorbed > 0 || tempBefore > 0) {
        const updatedRes = withTempHp(targetCombatant.resources, abs.tempHpAfter);
        await this.deps.combatRepo.updateCombatantState(targetCombatant.id, { resources: updatedRes as any });
      }
      await this.eventEmitter.emitDamageEvents(sessionId, encounter.id, actorId, action.targetId, characters, monsters, totalDamage, hpAfter);

      // D&D 5e 2024: Rage damage-taken tracking — track when a raging creature takes damage
      if (totalDamage > 0) {
        const targetRes = normalizeResources(targetCombatant.resources);
        if (targetRes.raging === true) {
          await this.deps.combatRepo.updateCombatantState(targetCombatant.id, {
            resources: patchResources(targetRes, { rageDamageTakenThisTurn: true }),
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
      // Re-fetch combatants after HP mutation for accurate resource/condition state
      if (hpAfter === 0) {
        combatants = await this.deps.combatRepo.listCombatants(encounter.id);
        const koTargetForRage = combatants.find((c: any) => c.id === targetCombatant.id);
        if (koTargetForRage) {
          const koRes = normalizeResources(koTargetForRage.resources);
          if (koRes.raging === true) {
            const effects = getActiveEffects(koTargetForRage.resources ?? {});
            const nonRageEffects = effects.filter((e: ActiveEffect) => e.source !== "Rage");
            const updatedRes = setActiveEffects({ ...koRes, raging: false }, nonRageEffects);
            await this.deps.combatRepo.updateCombatantState(koTargetForRage.id, { resources: updatedRes });
            if (this.debugLogsEnabled) console.log(`[DamageResolver] Rage ended on KO for ${action.targetId}`);
          }
        }
      }

      // D&D 5e 2024: Dark One's Blessing (Fiend Warlock L3+) — when the Warlock reduces a
      // creature from >0 HP to 0 HP, gain temp HP equal to max(1, CHA mod + Warlock level).
      // Temp HP does NOT stack: the higher of current-vs-new pool wins (RAW).
      if (hpBefore > 0 && hpAfter === 0) {
        const actorChar = characters.find((c) => c.id === actorId);
        if (actorChar) {
          const actorSheet = (actorChar.sheet ?? {}) as Record<string, unknown> & {
            className?: string | null;
            level?: number;
            subclass?: string;
            classLevels?: ReadonlyArray<{ classId: string; level: number; subclass?: string }>;
            abilityScores?: { charisma?: number } & Record<string, number | undefined>;
          };
          const blessing = qualifiesForDarkOnesBlessing({
            className: actorChar.className ?? actorSheet.className,
            level: actorChar.level ?? actorSheet.level,
            subclass: actorSheet.subclass,
            classLevels: actorSheet.classLevels,
            abilityScores: actorSheet.abilityScores,
          });
          if (blessing) {
            const actorCombatantForBlessing = combatants.find((c: any) => c.characterId === actorId || c.id === actorId);
            if (actorCombatantForBlessing) {
              const grantedTemp = darkOnesBlessingTempHp(blessing.chaMod, blessing.warlockLevel);
              const currentTemp = readTempHp(actorCombatantForBlessing.resources);
              // Temp HP doesn't stack — take higher pool (5e 2024 RAW)
              const newTemp = Math.max(currentTemp, grantedTemp);
              if (newTemp !== currentTemp) {
                const updatedRes = withTempHp(actorCombatantForBlessing.resources, newTemp);
                await this.deps.combatRepo.updateCombatantState(actorCombatantForBlessing.id, { resources: updatedRes as any });
                if (this.debugLogsEnabled) console.log(`[DamageResolver] Dark One's Blessing: ${actorId} gains ${grantedTemp} temp HP (had ${currentTemp} → ${newTemp})`);
              }
            }
          }
        }
      }

      // KO-triggered side effects: auto-break concentration, death save auto-fails
      await this.handleKoSideEffects(
        targetCombatant, hpBefore, hpAfter, totalDamage, action,
        combatants, encounter, sessionId, target, characters, monsters,
      );

      // Concentration check for surviving targets
      await this.handleConcentrationCheck(
        targetCombatant, hpAfter, totalDamage, target,
        combatants, encounter, sessionId, action.targetId, characters, monsters,
      );

      // Retaliatory damage (Armor of Agathys, Fire Shield)
      await this.handleRetaliatoryDamage(
        targetCombatant, totalDamage, action, actorId, combatants, encounter,
      );
    }

    // Mark Sneak Attack as used for this turn if it was applied
    if ((action.sneakAttackDice && action.sneakAttackDice > 0) || action.cunningStrike) {
      const actorForSneak = combatants.find((c: any) => c.characterId === actorId);
      if (actorForSneak) {
        const actorRes = normalizeResources(actorForSneak.resources);
        await this.deps.combatRepo.updateCombatantState(actorForSneak.id, {
          resources: patchResources(actorRes, { sneakAttackUsedThisTurn: true }),
        });
        if (this.debugLogsEnabled) console.log(`[DamageResolver] Sneak Attack used this turn — marked`);
      }
    }

    await this.deps.combatRepo.clearPendingAction(encounter.id);

    const targetName = target && "name" in target ? (target as { name: string }).name : "Target";
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
    let enhancementTotal = 0; // accumulated bonus damage from bonusDice enhancements (e.g. Divine Smite)
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
          // D&D 5e 2024: Apply per-type damage defenses for enhancement damage
          if (bonusDamage > 0 && enhancement.bonusDice.damageType) {
            const targetForDefenses = findCombatantByEntityId(combatants, action.targetId);
            if (targetForDefenses) {
              const tgtRecord =
                monsters.find((m) => m.id === action.targetId) ||
                characters.find((c) => c.id === action.targetId) ||
                npcs.find((n) => n.id === action.targetId);
              const tgtSheet = (tgtRecord as any)?.statBlock ?? (tgtRecord as any)?.sheet ?? {};
              const defenses = extractDamageDefenses(tgtSheet);
              // Include ActiveEffect-granted defense modifiers
              const tgtEffects = getActiveEffects(targetForDefenses.resources ?? {});
              const effDef = getDamageDefenseEffects(tgtEffects, enhancement.bonusDice.damageType);
              if (effDef.resistances) {
                defenses.damageResistances = [...new Set([...(defenses.damageResistances ?? []), enhancement.bonusDice.damageType.toLowerCase()])];
              }
              if (effDef.vulnerabilities) {
                defenses.damageVulnerabilities = [...new Set([...(defenses.damageVulnerabilities ?? []), enhancement.bonusDice.damageType.toLowerCase()])];
              }
              if (effDef.immunities) {
                defenses.damageImmunities = [...new Set([...(defenses.damageImmunities ?? []), enhancement.bonusDice.damageType.toLowerCase()])];
              }
              if (defenses.damageResistances || defenses.damageImmunities || defenses.damageVulnerabilities) {
                const defResult = applyDamageDefenses(bonusDamage, enhancement.bonusDice.damageType, defenses);
                bonusDamage = defResult.adjustedDamage;
                if (this.debugLogsEnabled) console.log(`[DamageResolver] Enhancement damage defense: ${defResult.defenseApplied} (${enhancement.bonusDice.damageType}) → ${bonusDamage}`);
              }
            }
          }
          if (bonusDamage > 0) {
            // Re-fetch after potential HP mutations from prior enhancement iterations
            combatants = await this.deps.combatRepo.listCombatants(encounter.id);
            const targetCombatantForBonus = findCombatantByEntityId(combatants, action.targetId);
            if (targetCombatantForBonus) {
              const bonusHpBefore = targetCombatantForBonus.hpCurrent;
              const newHp = Math.max(0, bonusHpBefore - bonusDamage);
              await this.deps.combatRepo.updateCombatantState(targetCombatantForBonus.id, { hpCurrent: newHp });
              await applyKoEffectsIfNeeded(targetCombatantForBonus, bonusHpBefore, newHp, this.deps.combatRepo);
              hpAfter = newHp;
              totalDamage += bonusDamage;
              enhancementTotal += bonusDamage;
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

    // D&D 5e 2024 Rogue Cunning Strike (L5+) — resolve the forgone-SA-die effect.
    // Only fires when the attack actually landed damage AND target survived
    // (effects on a KO'd creature are a no-op RAW).
    if (action.cunningStrike && totalDamage > 0 && hpAfter > 0) {
      const cunningStrikeResult = await this.resolveCunningStrike(
        action.cunningStrike, actorId, action.targetId, encounter.id, sessionId,
        characters, monsters, npcs,
      );
      if (cunningStrikeResult) {
        genericEnhancements.push(cunningStrikeResult);
      }
    }

    // Build damage equation display prefix — includes enhancement bonus (e.g. Divine Smite) when present
    const equationPrefix = enhancementTotal > 0
      ? `${rollValue} + ${damageModifier}${effectBonusSuffix} + ${enhancementTotal}`
      : `${rollValue} + ${damageModifier}${effectBonusSuffix}`;

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
        rollMode: action.rollMode,
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
        message: `${equationPrefix} = ${totalDamage} damage to ${targetName}! HP: ${hpBefore} → ${hpAfter}.${masterySuffix}${ohtSuffix}${ssSuffix}${enhSuffix} Second strike: Roll a d20${rollModePrompt(action.rollMode)}.`,
        ...(ohtResult ? { openHandTechnique: ohtResult } : {}),
        ...(stunningStrikeResult ? { stunningStrike: stunningStrikeResult } : {}),
      };
    }

    // Handle multi-attack spell strike chaining (Eldritch Blast beams, Scorching Ray rays)
    const isSpellStrikeNotLast = action.spellStrike && action.spellStrikeTotal && action.spellStrike < action.spellStrikeTotal;
    if (isSpellStrikeNotLast) {
      if (hpAfter > 0) {
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
          rollMode: action.rollMode,
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
          message: `${equationPrefix} = ${totalDamage} damage to ${targetName}! HP: ${hpBefore} → ${hpAfter}.${masterySuffix} Beam ${nextStrike} of ${action.spellStrikeTotal}: Roll a d20${rollModePrompt(action.rollMode)}.`,
        };
      }
      // Target dead — remaining beams are lost (D&D 5e: can't target dead creature)
      // TODO: Support mid-spell retargeting for multi-beam spells (Eldritch Blast RAW allows different targets per beam)
    }

    // Apply on-hit spell effects to target (e.g. Guiding Bolt: advantage on next attack)
    if (action.spellOnHitEffects?.length && hpAfter > 0) {
      combatants = await this.deps.combatRepo.listCombatants(encounter.id);
      const effectTarget = findCombatantByEntityId(combatants, action.targetId);
      if (effectTarget) {
        for (const effDef of action.spellOnHitEffects) {
          const effect = createEffect(
            nanoid(),
            effDef.type,
            effDef.target,
            effDef.duration,
            {
              source: action.weaponSpec?.name ?? "spell",
              sourceCombatantId: actorId,
              description: `${action.weaponSpec?.name ?? "spell"} (${effDef.type} on ${effDef.target})`,
            },
          );
          const updatedResources = addActiveEffectsToResources(effectTarget.resources ?? {}, effect);
          await this.deps.combatRepo.updateCombatantState(effectTarget.id, { resources: updatedResources as JsonValue });
          if (this.debugLogsEnabled)
            console.log(`[DamageResolver] Applied spell on-hit effect: ${effDef.type} → ${effDef.target} on ${effectTarget.id}`);
        }
      }
    }

    if (action.bonusAction !== "offhand-attack") {
      await this.eventEmitter.markActionSpent(encounter.id, actorId);
    }

    // D&D 5e 2024: Loading property — mark that a Loading weapon was fired this turn
    if (action.weaponSpec?.properties?.some((p: string) => typeof p === "string" && p.toLowerCase() === "loading")) {
      const actorForLoading = findCombatantByEntityId(combatants, actorId);
      if (actorForLoading) {
        const loadRes = normalizeResources(actorForLoading.resources);
        await this.deps.combatRepo.updateCombatantState(actorForLoading.id, {
          resources: patchResources(loadRes, { loadingWeaponFiredThisTurn: true }),
        });
      }
    }

    // Drop thrown weapon on the ground at target position (hit)
    if (action.weaponSpec?.isThrownAttack) {
      await this.dropThrownWeaponOnGround(encounter, actorId, action.targetId, action.weaponSpec, encounter.round ?? 1, combatants);
    }

    // Check for victory/defeat if target was defeated
    let combatEnded = false;
    let victoryStatus: CombatVictoryStatus | undefined;
    if (hpAfter <= 0 && this.deps.victoryPolicy) {
      // Re-fetch combatants with updated HP for accurate victory evaluation
      combatants = await this.deps.combatRepo.listCombatants(encounter.id);
      victoryStatus = await this.deps.victoryPolicy.evaluate({ combatants }) ?? undefined;

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

    // ── Extra Attack chaining ──
    // After damage resolves, check if the actor has remaining attacks from Extra Attack.
    // Skip for bonus action attacks (FoB, offhand — have their own chaining), spell-strikes (handled above),
    // and Loading weapons (can only fire once per action per D&D 5e 2024 rules).
    const weaponHasLoading = action.weaponSpec?.properties?.some(
      (p: string) => p.toLowerCase() === "loading",
    ) ?? false;
    if (!combatEnded && !action.bonusAction && !action.spellStrike && !weaponHasLoading) {
      // Re-fetch actor's resources after markActionSpent updated them in the DB
      const freshCombatants = await this.deps.combatRepo.listCombatants(encounter.id);
      const freshActor = findCombatantByEntityId(freshCombatants, actorId);
      if (freshActor && canMakeAttack(freshActor.resources ?? {})) {
        const weaponName = action.weaponSpec?.name ?? "weapon";
        const enhSuffix = genericEnhancements.map((r) => ` ${r.summary}`).join("");

        // BUG-3 fix: Recompute rollMode for chained EA instead of copying from previous action.
        // Weapon mastery (e.g. Vex) may have just applied advantage effects to the actor.
        // Check the fresh actor's active effects for advantage/disadvantage on attack rolls
        // targeting this specific target (Vex uses targetCombatantId).
        const freshEffects = getActiveEffects(freshActor.resources ?? {});
        let chainedRollMode: "normal" | "advantage" | "disadvantage" = action.rollMode ?? "normal";
        const hasVexAdvantage = freshEffects.some(
          e => e.type === "advantage" && e.target === "attack_rolls"
            && e.duration === "until_triggered" && e.targetCombatantId === action.targetId,
        );
        if (hasVexAdvantage && chainedRollMode !== "disadvantage") {
          chainedRollMode = "advantage";
        }

        if (hpAfter > 0) {
          // Target alive — chain to same target with same weapon
          const nextPending: AttackPendingAction = {
            type: "ATTACK",
            timestamp: new Date(),
            actorId,
            attacker: actorId,
            target: action.targetId,
            targetId: action.targetId,
            weaponSpec: action.weaponSpec,
            rollMode: chainedRollMode,
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
            nextRollType: "attack",
            message: `${equationPrefix} = ${totalDamage} damage to ${targetName}! HP: ${hpBefore} → ${hpAfter}.${masterySuffix}${enhSuffix} Extra Attack: Roll a d20${rollModePrompt(chainedRollMode)} for ${weaponName} vs ${targetName}.`,
            ...(ohtResult ? { openHandTechnique: ohtResult } : {}),
            ...(stunningStrikeResult ? { stunningStrike: stunningStrikeResult } : {}),
          };
        } else {
          // Target dead — return to prompt for new target selection
          const remaining = getAttacksAllowedThisTurn(freshActor.resources ?? {}) - getAttacksUsedThisTurn(freshActor.resources ?? {});
          return {
            rollType: "attack",
            nextRollType: "attack",
            rawRoll: rollValue,
            modifier: damageModifier,
            total: totalDamage,
            totalDamage,
            targetName,
            hpBefore,
            hpAfter,
            targetHpRemaining: hpAfter,
            actionComplete: false,
            requiresPlayerInput: false,
            message: `${equationPrefix} = ${totalDamage} damage to ${targetName}! HP: ${hpBefore} → ${hpAfter}.${masterySuffix}${enhSuffix} Target defeated! You have ${remaining} attack(s) remaining.`,
            ...(ohtResult ? { openHandTechnique: ohtResult } : {}),
            ...(stunningStrikeResult ? { stunningStrike: stunningStrikeResult } : {}),
          };
        }
      }
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
        ? `${equationPrefix} = ${totalDamage} damage to ${targetName}! HP: ${hpBefore} → ${hpAfter}. ${victoryStatus}!${masterySuffix}${enhancementSuffix}`
        : `${equationPrefix} = ${totalDamage} damage to ${targetName}! HP: ${hpBefore} → ${hpAfter}${masterySuffix}${enhancementSuffix}`,
      narration,
      combatEnded,
      victoryStatus,
      ...(ohtResult ? { openHandTechnique: ohtResult } : {}),
      ...(stunningStrikeResult ? { stunningStrike: stunningStrikeResult } : {}),
      ...(genericEnhancements.length > 0 ? { enhancements: genericEnhancements } : {}),
    };
  }

  /**
   * D&D 5e 2024 Rogue Cunning Strike (L5+) effect resolution.
   * Called after damage is applied when one SA die has already been forgone.
   *
   * - poison: CON save vs DC → Poisoned on failure
   * - trip:   DEX save vs DC → Prone on failure
   * - withdraw: attacker gains disengaged flag (no OA on subsequent movement)
   */
  private async resolveCunningStrike(
    option: "poison" | "trip" | "withdraw",
    actorId: string,
    targetId: string,
    encounterId: string,
    _sessionId: string,
    characters: SessionCharacterRecord[],
    monsters: SessionMonsterRecord[],
    npcs: SessionNPCRecord[],
  ): Promise<HitRiderEnhancementResult | undefined> {
    const actorChar = characters.find((c) => c.id === actorId);
    const actorSheet = (actorChar?.sheet ?? {}) as Record<string, unknown>;
    const actorLevel = ClassFeatureResolver.getLevel(actorSheet as any, actorChar?.level);
    const abilityScores = (actorSheet.abilityScores as Record<string, number> | undefined) ?? {};
    const dex = abilityScores.dexterity ?? 10;
    const profBonus = ClassFeatureResolver.getProficiencyBonus(actorSheet as any, actorLevel);
    const saveDC = rogueCunningStrikeSaveDC(dex, profBonus);

    if (option === "withdraw") {
      // Grant disengaged flag: attacker can move without provoking OAs after this hit.
      // RAW also caps movement to half speed for this movement — not modeled; disengaged
      // flag is the mechanical essential (prevents OA).
      const combatants = await this.deps.combatRepo.listCombatants(encounterId);
      const actorCombatant = combatants.find(
        (c: any) => c.combatantType === "Character" && c.characterId === actorId,
      );
      if (actorCombatant) {
        const actorRes = normalizeResources(actorCombatant.resources);
        await this.deps.combatRepo.updateCombatantState(actorCombatant.id, {
          resources: { ...actorRes, disengaged: true } as any,
        });
        if (this.debugLogsEnabled) {
          console.log(`[DamageResolver] Cunning Strike (Withdraw): disengaged=true on ${actorId}`);
        }
      }
      return {
        abilityId: "class:rogue:cunning-strike",
        displayName: "Cunning Strike (Withdraw)",
        summary:
          "Cunning Strike (Withdraw): no Opportunity Attacks provoked on next half-speed move.",
      };
    }

    // Poison / Trip: build a synthetic HitRiderEnhancement and resolve via the
    // existing hit-rider pipeline (save + condition application).
    const isPoison = option === "poison";
    const enhancement: HitRiderEnhancement = {
      abilityId: "class:rogue:cunning-strike",
      displayName: `Cunning Strike (${isPoison ? "Poison" : "Trip"})`,
      postDamageEffect: "saving-throw",
      context: {
        saveAbility: isPoison ? "constitution" : "dexterity",
        saveDC,
        saveReason: `Cunning Strike (${isPoison ? "Poison" : "Trip"})`,
        sourceId: actorId,
        onSuccess: {
          summary: isPoison ? "Resists the poison." : "Keeps footing!",
        } satisfies SaveOutcome,
        onFailure: {
          conditions: { add: isPoison ? ["Poisoned"] : ["Prone"] },
          summary: isPoison ? "Poisoned!" : "Knocked Prone!",
        } satisfies SaveOutcome,
      },
    };

    return this.hitRiderResolver.resolvePostDamageEffect(
      enhancement, actorId, targetId, encounterId,
      characters, monsters, npcs,
    );
  }

  /**
   * Handle KO side effects: auto-break concentration on KO + death save auto-fails
   * for characters already at 0 HP taking damage.
   */
  private async handleKoSideEffects(
    targetCombatant: CombatantStateRecord,
    hpBefore: number,
    hpAfter: number,
    totalDamage: number,
    action: DamagePendingAction,
    combatants: CombatantStateRecord[],
    encounter: CombatEncounterRecord,
    sessionId: string,
    target: SessionCharacterRecord | SessionMonsterRecord | SessionNPCRecord,
    characters: SessionCharacterRecord[],
    monsters: SessionMonsterRecord[],
  ): Promise<void> {
    // Auto-break concentration on KO (Unconscious = Incapacitated → concentration ends)
    if (hpAfter === 0) {
      const koTarget = combatants.find((c: any) => c.id === targetCombatant.id);
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
  }

  /**
   * Handle concentration check: if the target is concentrating and survived damage,
   * auto-roll a CON save to maintain concentration.
   */
  private async handleConcentrationCheck(
    targetCombatant: CombatantStateRecord,
    hpAfter: number,
    totalDamage: number,
    target: SessionCharacterRecord | SessionMonsterRecord | SessionNPCRecord,
    combatants: CombatantStateRecord[],
    encounter: CombatEncounterRecord,
    sessionId: string,
    targetId: string,
    characters: SessionCharacterRecord[],
    monsters: SessionMonsterRecord[],
  ): Promise<void> {
    if (totalDamage <= 0 || hpAfter <= 0) return;

    const latestCombatant = findCombatantByEntityId(combatants, targetCombatant.id)
      ?? (await this.deps.combatRepo.listCombatants(encounter.id)).find((c: any) => c.id === targetCombatant.id);
    const spellName = getConcentrationSpellName(latestCombatant?.resources);
    if (!spellName || !this.deps.diceRoller) return;

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

    const targetEntityId = getEntityId(targetCombatant) ?? targetId;
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

  /**
   * Handle retaliatory damage effects (Armor of Agathys, Fire Shield)
   * triggered by melee attacks against targets with retaliatory_damage effects.
   */
  private async handleRetaliatoryDamage(
    targetCombatant: CombatantStateRecord,
    totalDamage: number,
    action: DamagePendingAction,
    actorId: string,
    combatants: CombatantStateRecord[],
    encounter: CombatEncounterRecord,
  ): Promise<void> {
    if (totalDamage <= 0 || action.weaponSpec?.kind !== "melee") return;

    const tgtEffects = getActiveEffects(targetCombatant.resources ?? {});
    const retaliatory = tgtEffects.filter(e => e.type === 'retaliatory_damage');
    if (retaliatory.length === 0 || !this.deps.diceRoller) return;

    const attackerForRetaliation = findCombatantByEntityId(combatants, actorId);
    if (!attackerForRetaliation || attackerForRetaliation.hpCurrent <= 0) return;

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
    combatantsCache?: any[],
  ): Promise<void> {
    const mapData = encounter.mapData as CombatMap | undefined;
    if (!mapData) return;

    // Find target position — that's where the thrown weapon lands
    const allCombatants = combatantsCache ?? await this.deps.combatRepo.listCombatants(encounter.id);
    const targetCombatant = findCombatantByEntityId(allCombatants, targetId);
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
    await this.deps.combatRepo.updateEncounter(encounter.id, { mapData: updatedMap as JsonValue });

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

    await this.deps.combatRepo.updateEncounter(encounter.id, { mapData: currentMap as JsonValue });
  }
}
