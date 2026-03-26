/**
 * AiSpellDelivery - resolves spell mechanical effects for AI casters.
 *
 * Provides save-based, healing, spell attack, and buff/debuff delivery.
 * Gracefully degrades if spell definition lacks mechanical data.
 */

import type { CombatantStateRecord } from "../../../../types.js";
import type { ICombatRepository } from "../../../../repositories/combat-repository.js";
import type { ICharacterRepository } from "../../../../repositories/character-repository.js";
import type { IMonsterRepository, INPCRepository } from "../../../../repositories/index.js";
import type { DiceRoller } from "../../../../../domain/rules/dice-roller.js";
import type { PreparedSpellDefinition } from "../../../../../domain/entities/spells/prepared-spell-definition.js";
import { getUpcastBonusDice, getCantripDamageDice } from "../../../../../domain/entities/spells/prepared-spell-definition.js";
import { SavingThrowResolver } from "../../tabletop/rolls/saving-throw-resolver.js";
import { applyKoEffectsIfNeeded } from "../../helpers/ko-handler.js";
import { applyDamageDefenses, extractDamageDefenses } from "../../../../../domain/rules/damage-defenses.js";
import { applyEvasion } from "../../../../../domain/rules/evasion.js";
import { normalizeResources, addActiveEffectsToResources } from "../../helpers/resource-utils.js";
import { normalizeConditions, removeCondition } from "../../../../../domain/entities/combat/conditions.js";
import { createEffect } from "../../../../../domain/entities/combat/effects.js";
import { nanoid } from "nanoid";

/** Look up a spell from character preparedSpells or monster spells array. */
export function findSpellDefinition(
  source: unknown,
  spellName: string,
): PreparedSpellDefinition | null {
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const s = source as Record<string, unknown>;
  const lower = spellName.toLowerCase();
  for (const key of ["preparedSpells", "spells"] as const) {
    const arr = s[key];
    if (!Array.isArray(arr)) continue;
    const match = arr.find(
      (entry): entry is PreparedSpellDefinition =>
        entry !== null &&
        typeof entry === "object" &&
        !Array.isArray(entry) &&
        typeof (entry as Record<string, unknown>).name === "string" &&
        ((entry as Record<string, unknown>).name as string).toLowerCase() === lower,
    );
    if (match) return match;
  }
  return null;
}

export interface AiSpellDeliveryDeps {
  combat: ICombatRepository;
  characters?: ICharacterRepository;
  monsters: IMonsterRepository;
  npcs: INPCRepository;
  diceRoller: DiceRoller;
}

export interface SpellDeliveryResult {
  applied: boolean;
  summary: string;
}

export class AiSpellDelivery {
  private readonly saveResolver: SavingThrowResolver;

  constructor(private readonly deps: AiSpellDeliveryDeps) {
    this.saveResolver = new SavingThrowResolver(deps.combat, deps.diceRoller, false);
  }

  async deliver(
    sessionId: string,
    encounterId: string,
    caster: CombatantStateRecord,
    spellDef: PreparedSpellDefinition,
    targetCombatant: CombatantStateRecord | null,
    targetName: string | undefined,
    castAtLevel: number | undefined,
    casterSource: Record<string, unknown>,
  ): Promise<SpellDeliveryResult> {
    const combatants = await this.deps.combat.listCombatants(encounterId);
    const chars = this.deps.characters
      ? ((await this.deps.characters.listBySession(sessionId)) as any[])
      : [];
    const mons = (await this.deps.monsters.listBySession(sessionId)) as any[];
    const npcArr = (await this.deps.npcs.listBySession(sessionId)) as any[];
    const effectiveLevel = castAtLevel ?? spellDef.level;

    if (spellDef.attackType) {
      return this.deliverSpellAttack(
        caster, spellDef, targetCombatant, targetName,
        effectiveLevel, casterSource, chars, mons, npcArr,
      );
    }
    if (spellDef.healing) {
      return this.deliverHealing(
        caster, spellDef, targetCombatant, targetName,
        effectiveLevel, casterSource,
      );
    }
    if (spellDef.saveAbility) {
      return this.deliverSaveBased(
        encounterId, caster, spellDef, targetCombatant, effectiveLevel,
        casterSource, combatants, chars, mons, npcArr,
      );
    }
    if (spellDef.effects && spellDef.effects.length > 0) {
      return this.deliverBuffDebuff(caster, spellDef, targetCombatant, combatants);
    }
    return { applied: false, summary: "" };
  }

  private async deliverSaveBased(
    encounterId: string,
    caster: CombatantStateRecord,
    spellDef: PreparedSpellDefinition,
    targetCombatant: CombatantStateRecord | null,
    effectiveLevel: number,
    casterSource: Record<string, unknown>,
    combatants: CombatantStateRecord[],
    chars: any[],
    mons: any[],
    npcArr: any[],
  ): Promise<SpellDeliveryResult> {
    const saveAbility = spellDef.saveAbility!;
    const dc = this.getSpellSaveDC(casterSource);
    const casterId = this.getEntityId(caster);
    const targets = this.resolveTargets(caster, combatants, targetCombatant, !!spellDef.area);
    if (targets.length === 0) return { applied: true, summary: "No valid targets in range" };

    let sharedDmg = 0;
    if (spellDef.damage) {
      let dice = spellDef.damage.diceCount;
      const up = getUpcastBonusDice(spellDef, effectiveLevel);
      if (up) dice += up.bonusDiceCount;
      sharedDmg =
        this.deps.diceRoller.rollDie(spellDef.damage.diceSides, dice).total +
        (spellDef.damage.modifier ?? 0);
    }

    const results: string[] = [];
    for (const t of targets) {
      const tId = this.getEntityId(t);
      const name = this.getDisplayName(t, chars, mons, npcArr);

      const saveAction = this.saveResolver.buildPendingAction({
        actorId: tId,
        sourceId: casterId,
        ability: saveAbility,
        dc,
        reason: spellDef.name,
        onSuccess: { summary: "Save succeeded" },
        onFailure: {
          summary: "Save failed",
          conditions: spellDef.conditions?.onFailure
            ? { add: spellDef.conditions.onFailure }
            : undefined,
        },
      });

      const res = await this.saveResolver.resolve(
        saveAction, encounterId, chars, mons, npcArr,
      );
      let dmg = sharedDmg;

      if (spellDef.damage && dmg > 0) {
        dmg = applyEvasion(dmg, res.success, !!res.hasEvasion, spellDef.halfDamageOnSave ?? true);
        if (dmg > 0) {
          const defs = extractDamageDefenses(this.getStatSource(t, chars, mons, npcArr));
          if (
            spellDef.damageType &&
            (defs.damageResistances || defs.damageImmunities || defs.damageVulnerabilities)
          ) {
            dmg = applyDamageDefenses(dmg, spellDef.damageType, defs).adjustedDamage;
          }
          const hpBefore = t.hpCurrent;
          const hpAfter = Math.max(0, hpBefore - dmg);
          await this.deps.combat.updateCombatantState(t.id, { hpCurrent: hpAfter });
          await applyKoEffectsIfNeeded(t, hpBefore, hpAfter, this.deps.combat);
          const cond =
            res.conditionsApplied.length > 0
              ? ", " + res.conditionsApplied.join(", ") + " applied"
              : "";
          results.push(
            name +
              ": " + saveAbility + " save " +
              (res.success ? "succeeded" : "failed") +
              " (" + res.total + " vs DC " + dc + "), " +
              dmg + " " + (spellDef.damageType ?? "") +
              " damage (HP: " + hpBefore + "->" + hpAfter + ")" + cond,
          );
        } else {
          results.push(name + ": " + saveAbility + " save succeeded, no damage");
        }
      } else {
        const cond =
          res.conditionsApplied.length > 0
            ? res.conditionsApplied.join(", ") + " applied"
            : res.success
              ? "save succeeded"
              : "save failed";
        results.push(
          name +
            ": " + saveAbility + " save " +
            (res.success ? "succeeded" : "failed") +
            " (" + res.total + " vs DC " + dc + "), " + cond,
        );
      }
    }
    return { applied: true, summary: spellDef.name + " -- " + results.join("; ") };
  }

  private async deliverHealing(
    caster: CombatantStateRecord,
    spellDef: PreparedSpellDefinition,
    targetCombatant: CombatantStateRecord | null,
    targetName: string | undefined,
    effectiveLevel: number,
    casterSource: Record<string, unknown>,
  ): Promise<SpellDeliveryResult> {
    const healing = spellDef.healing!;
    const target = targetCombatant ?? caster;
    const mod = healing.modifier ?? this.getSpellcastingModifier(casterSource);
    let dice = healing.diceCount;
    const up = getUpcastBonusDice(spellDef, effectiveLevel);
    if (up) dice += up.bonusDiceCount;
    const total = Math.max(
      0,
      this.deps.diceRoller.rollDie(healing.diceSides, dice).total + mod,
    );
    const hpBefore = target.hpCurrent;
    const hpAfter = Math.min(target.hpMax, hpBefore + total);
    const actual = hpAfter - hpBefore;

    const patch: Record<string, any> = { hpCurrent: hpAfter };
    if (hpBefore === 0 && hpAfter > 0) {
      let conditions = normalizeConditions(target.conditions);
      conditions = removeCondition(conditions, "Unconscious");
      patch.conditions = conditions as any;
      patch.resources = {
        ...normalizeResources(target.resources ?? {}),
        deathSaves: { successes: 0, failures: 0 },
      };
    }
    await this.deps.combat.updateCombatantState(target.id, patch);

    const who = target.id === caster.id ? "self" : (targetName ?? "ally");
    return {
      applied: true,
      summary:
        spellDef.name + " healed " + who + " for " + actual +
        " HP (HP: " + hpBefore + "->" + hpAfter + ")",
    };
  }

  private async deliverSpellAttack(
    _caster: CombatantStateRecord,
    spellDef: PreparedSpellDefinition,
    targetCombatant: CombatantStateRecord | null,
    targetName: string | undefined,
    effectiveLevel: number,
    casterSource: Record<string, unknown>,
    chars: any[],
    mons: any[],
    npcArr: any[],
  ): Promise<SpellDeliveryResult> {
    if (!targetCombatant || !targetName) {
      return { applied: false, summary: "No target for spell attack" };
    }
    const atkBonus = this.getSpellAttackBonus(casterSource);
    const ac = this.getTargetAC(targetCombatant, chars, mons, npcArr);
    const atkRoll = this.deps.diceRoller.rollDie(20, 1);
    const atkTotal = atkRoll.total + atkBonus;
    const isCrit = atkRoll.total === 20;
    const hit = isCrit || atkTotal >= ac;

    if (!hit) {
      return {
        applied: true,
        summary:
          spellDef.name + " attack at " + targetName +
          ": d20(" + atkRoll.total + ")+" + atkBonus + "=" + atkTotal +
          " vs AC " + ac + " -- MISS",
      };
    }

    const sd = spellDef.damage ?? { diceCount: 1, diceSides: 10, modifier: 0 };
    let dice = sd.diceCount;
    if (spellDef.level === 0) {
      dice = getCantripDamageDice(sd.diceCount, (casterSource.level as number) ?? 1);
    }
    const up = getUpcastBonusDice(spellDef, effectiveLevel);
    if (up) dice += up.bonusDiceCount;
    if (isCrit) dice *= 2;

    let totalDmg =
      this.deps.diceRoller.rollDie(sd.diceSides, dice).total + (sd.modifier ?? 0);
    const defs = extractDamageDefenses(
      this.getStatSource(targetCombatant, chars, mons, npcArr),
    );
    if (
      spellDef.damageType &&
      (defs.damageResistances || defs.damageImmunities || defs.damageVulnerabilities)
    ) {
      totalDmg = applyDamageDefenses(totalDmg, spellDef.damageType, defs).adjustedDamage;
    }

    const hpBefore = targetCombatant.hpCurrent;
    const hpAfter = Math.max(0, hpBefore - totalDmg);
    await this.deps.combat.updateCombatantState(targetCombatant.id, { hpCurrent: hpAfter });
    await applyKoEffectsIfNeeded(targetCombatant, hpBefore, hpAfter, this.deps.combat);

    const crit = isCrit ? " CRITICAL HIT!" : "";
    return {
      applied: true,
      summary:
        spellDef.name + " attack at " + targetName +
        ": d20(" + atkRoll.total + ")+" + atkBonus + "=" + atkTotal +
        " vs AC " + ac + " -- HIT!" + crit + " " +
        totalDmg + " " + (spellDef.damageType ?? "") +
        " damage (HP: " + hpBefore + "->" + hpAfter + ")",
    };
  }

  private async deliverBuffDebuff(
    caster: CombatantStateRecord,
    spellDef: PreparedSpellDefinition,
    targetCombatant: CombatantStateRecord | null,
    combatants: CombatantStateRecord[],
  ): Promise<SpellDeliveryResult> {
    const effs = spellDef.effects ?? [];
    const isConc = spellDef.concentration ?? false;
    const casterId = this.getEntityId(caster);
    let count = 0;

    for (const ed of effs) {
      const ids: string[] = [];
      const appliesTo = ed.appliesTo ?? "target";
      if (appliesTo === "self") {
        ids.push(caster.id);
      } else if (appliesTo === "target" && targetCombatant) {
        ids.push(targetCombatant.id);
      } else if (appliesTo === "allies") {
        const isMonster = caster.combatantType === "Monster";
        for (const c of combatants) {
          if (c.hpCurrent > 0 && (c.combatantType === "Monster") === isMonster) {
            ids.push(c.id);
          }
        }
      } else if (appliesTo === "enemies") {
        const isMonster = caster.combatantType === "Monster";
        for (const c of combatants) {
          if (c.hpCurrent > 0 && (c.combatantType === "Monster") !== isMonster) {
            ids.push(c.id);
          }
        }
      }
      for (const tid of ids) {
        const effect = createEffect(
          nanoid(),
          ed.type,
          ed.target,
          isConc ? "concentration" : ed.duration,
          {
            value: ed.value,
            diceValue: ed.diceValue
              ? { count: ed.diceValue.count, sides: ed.diceValue.sides }
              : undefined,
            damageType: ed.damageType,
            roundsRemaining: ed.roundsRemaining,
            source: spellDef.name,
            sourceCombatantId: casterId,
            description: spellDef.name + " (" + ed.type + " on " + ed.target + ")",
            triggerAt: ed.triggerAt,
            saveToEnd: ed.saveToEnd
              ? { ability: ed.saveToEnd.ability as any, dc: ed.saveToEnd.dc }
              : undefined,
            conditionName: ed.conditionName,
            triggerSave: ed.triggerSave
              ? {
                  ability: ed.triggerSave.ability as any,
                  dc: ed.triggerSave.dc,
                  halfDamageOnSave: ed.triggerSave.halfDamageOnSave,
                }
              : undefined,
            triggerConditions: ed.triggerConditions,
          },
        );
        const tc = combatants.find((c) => c.id === tid);
        if (tc) {
          await this.deps.combat.updateCombatantState(tid, {
            resources: addActiveEffectsToResources(tc.resources ?? {}, effect) as any,
          });
          count++;
        }
      }
    }
    const cn = isConc ? " [concentration]" : "";
    return {
      applied: true,
      summary: spellDef.name + " applied to " + count + " target(s)" + cn,
    };
  }

  private getEntityId(c: CombatantStateRecord): string {
    return c.characterId ?? c.monsterId ?? c.npcId ?? c.id;
  }

  private getDisplayName(
    c: CombatantStateRecord, chars: any[], mons: any[], npcArr: any[],
  ): string {
    if (c.characterId) {
      const x = chars.find((x: any) => x.id === c.characterId);
      return x?.name ?? c.characterId;
    }
    if (c.monsterId) {
      const x = mons.find((x: any) => x.id === c.monsterId);
      return x?.name ?? c.monsterId;
    }
    if (c.npcId) {
      const x = npcArr.find((x: any) => x.id === c.npcId);
      return x?.name ?? c.npcId;
    }
    return c.id;
  }

  private getSpellSaveDC(s: Record<string, unknown>): number {
    return typeof s.spellSaveDC === "number" ? s.spellSaveDC : 13;
  }

  private getSpellAttackBonus(s: Record<string, unknown>): number {
    return typeof s.spellAttackBonus === "number" ? s.spellAttackBonus : 5;
  }

  private getSpellcastingModifier(s: Record<string, unknown>): number {
    const ab = s.spellcastingAbility as string | undefined;
    if (!ab) return 0;
    const scores = s.abilityScores as Record<string, number> | undefined;
    if (!scores) return 0;
    return Math.floor(((scores[ab] ?? 10) - 10) / 2);
  }

  private getTargetAC(
    t: CombatantStateRecord, chars: any[], mons: any[], npcArr: any[],
  ): number {
    return (this.getStatSource(t, chars, mons, npcArr).armorClass as number) ?? 10;
  }

  private getStatSource(
    c: CombatantStateRecord, chars: any[], mons: any[], npcArr: any[],
  ): Record<string, unknown> {
    if (c.characterId) {
      const x = chars.find((x: any) => x.id === c.characterId);
      return (x?.sheet as Record<string, unknown>) ?? {};
    }
    if (c.monsterId) {
      const x = mons.find((x: any) => x.id === c.monsterId);
      return (x?.statBlock as Record<string, unknown>) ?? {};
    }
    if (c.npcId) {
      const x = npcArr.find((x: any) => x.id === c.npcId);
      return (x?.statBlock as Record<string, unknown>) ?? {};
    }
    return {};
  }

  private resolveTargets(
    caster: CombatantStateRecord,
    combatants: CombatantStateRecord[],
    target: CombatantStateRecord | null,
    isAoE: boolean,
  ): CombatantStateRecord[] {
    if (isAoE) {
      const isMonster = caster.combatantType === "Monster";
      return combatants.filter(
        (c) => c.id !== caster.id && c.hpCurrent > 0 && (c.combatantType === "Monster") !== isMonster,
      );
    }
    if (target) return [target];
    const isMonster = caster.combatantType === "Monster";
    const enemies = combatants.filter(
      (c) => c.id !== caster.id && c.hpCurrent > 0 && (c.combatantType === "Monster") !== isMonster,
    );
    return enemies.length > 0 ? [enemies[0]!] : [];
  }
}
