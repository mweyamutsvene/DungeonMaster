/**
 * AiContextBuilder - Constructs combat context payloads for AI decision making.
 *
 * Layer: Application
 * Responsibility: Build rich context including battlefield, allies, enemies, and state.
 */

import type { CombatantStateRecord, CombatEncounterRecord } from "../../../types.js";
import type { ICharacterRepository, IMonsterRepository, INPCRepository } from "../../../repositories/index.js";
import type { FactionService } from "../helpers/faction-service.js";
import type { ICombatantResolver } from "../helpers/combatant-resolver.js";
import type { CombatMap } from "../../../../domain/rules/combat-map.js";
import { getMapZones, getCoverLevel } from "../../../../domain/rules/combat-map.js";
import { renderBattlefield, createCombatantEntity } from "../../../../domain/rules/battlefield-renderer.js";
import { listCreatureAbilities, getClassAbilities } from "../../../../domain/abilities/creature-abilities.js";
import { readConditionNames } from "../../../../domain/entities/combat/conditions.js";
import { getResourcePools } from "../helpers/resource-utils.js";
import { extractDamageDefenses } from "../../../../domain/rules/damage-defenses.js";
import { calculateDistance } from "../../../../domain/rules/movement.js";
import { ClassFeatureResolver } from "../../../../domain/entities/classes/class-feature-resolver.js";
import type { TurnStepResult, AiCombatContext } from "./ai-types.js";
import { getInventory } from "../helpers/resource-utils.js";
import { lookupMagicItem } from "../../../../domain/entities/items/magic-item-catalog.js";

export class AiContextBuilder {
  private readonly aiDebugEnabled =
    process.env.DM_AI_DEBUG === "1" ||
    process.env.DM_AI_DEBUG === "true" ||
    process.env.DM_AI_DEBUG === "yes";

  constructor(
    private readonly characters: ICharacterRepository,
    private readonly monsters: IMonsterRepository,
    private readonly npcs: INPCRepository,
    private readonly factionService: FactionService,
    private readonly combatantResolver: ICombatantResolver,
  ) {}

  /**
   * Extract position from combatant resources.
   */
  private getPosition(c: CombatantStateRecord): { x: number; y: number } | undefined {
    const resources = c.resources as Record<string, unknown> | null;
    return resources?.position as { x: number; y: number } | undefined;
  }

  /**
   * Extract action economy from combatant resources.
   */
  private getEconomy(c: CombatantStateRecord): {
    actionSpent: boolean;
    bonusActionSpent: boolean;
    reactionSpent: boolean;
    movementSpent: boolean;
    movementRemaining?: number;
  } | undefined {
    const resources = c.resources as Record<string, unknown> | null;
    if (!resources || typeof resources !== "object") return undefined;

    const movementRemaining =
      typeof resources.movementRemaining === "number" ? resources.movementRemaining : undefined;

    return {
      actionSpent: resources.actionSpent === true,
      bonusActionSpent: resources.bonusActionUsed === true,
      reactionSpent: resources.reactionUsed === true,
      movementSpent: resources.movementSpent === true,
      ...(movementRemaining !== undefined ? { movementRemaining } : {}),
    };
  }

  /**
   * Extract resource pools from combatant resources (ki, spell slots, rage, etc.).
   */
  private getResourcePoolsForContext(c: CombatantStateRecord): Array<{ name: string; current: number; max: number }> | undefined {
    const pools = getResourcePools(c.resources);
    return pools.length > 0 ? pools : undefined;
  }

  /**
   * Extract active buff flags from combatant resources.
   * Combines boolean flags with ActiveEffect sources for a unified view.
   */
  private getActiveBuffs(c: CombatantStateRecord): string[] | undefined {
    const resources = c.resources as Record<string, unknown> | null;
    if (!resources || typeof resources !== "object") return undefined;

    // Boolean flag-based buffs (legacy + still-flag-based)
    const buffMap: Array<[string, string]> = [
      ["raging", "Raging"],
      ["dashed", "Dashed"],
      ["disengaged", "Disengaged"],
    ];

    const active = buffMap
      .filter(([key]) => resources[key] === true)
      .map(([, label]) => label);

    // Add ActiveEffect-sourced buffs (Reckless Attack, Dodge, spells, etc.)
    const effects = Array.isArray(resources.activeEffects) ? resources.activeEffects : [];
    const effectSources = new Set<string>();
    for (const eff of effects) {
      if (typeof eff === "object" && eff !== null && typeof (eff as any).source === "string") {
        effectSources.add((eff as any).source);
      }
    }
    for (const src of effectSources) {
      if (!active.includes(src)) {
        active.push(src);
      }
    }

    return active.length > 0 ? active : undefined;
  }

  /**
   * Extract concentration spell name from combatant resources.
   */
  private getConcentrationSpell(c: CombatantStateRecord): string | undefined {
    const resources = c.resources as Record<string, unknown> | null;
    if (!resources || typeof resources !== "object") return undefined;
    const spellName = resources.concentrationSpellName;
    return typeof spellName === "string" && spellName.length > 0 ? spellName : undefined;
  }

  /**
   * Extract death save state from combatant resources.
   */
  private getDeathSaves(c: CombatantStateRecord): { successes: number; failures: number } | undefined {
    const resources = c.resources as Record<string, unknown> | null;
    if (!resources || typeof resources !== "object") return undefined;
    const deathSaves = resources.deathSaves;
    if (!deathSaves || typeof deathSaves !== "object") return undefined;
    const ds = deathSaves as Record<string, unknown>;
    const successes = typeof ds.successes === "number" ? ds.successes : 0;
    const failures = typeof ds.failures === "number" ? ds.failures : 0;
    if (successes === 0 && failures === 0) return undefined;
    return { successes, failures };
  }

  /**
   * Build ally details for context (async - loads entity data for enrichment).
   */
  private async buildAllyDetails(
    allies: CombatantStateRecord[],
    nameMap: Map<string, string>,
  ): Promise<AiCombatContext["allies"]> {
    return Promise.all(
      allies.map(async (a) => {
        const position = this.getPosition(a);
        const conditions = readConditionNames(a.conditions);
        const concentrationSpell = this.getConcentrationSpell(a);
        const deathSaves = this.getDeathSaves(a);

        let className: string | undefined;
        let level: number | undefined;
        let armorClass: number | undefined;
        let speed: number | undefined;
        let size: string | undefined;
        let knownAbilities: string[] = [];
        let entityDefenses: ReturnType<typeof extractDamageDefenses> = {};

        if (a.combatantType === "Character" && a.characterId) {
          const char = await this.characters.getById(a.characterId);
          if (char) {
            className = char.className || undefined;
            level = char.level;
            const sheet = char.sheet as Record<string, unknown>;
            armorClass = sheet?.armorClass as number | undefined;
            speed = (sheet?.speed as number | undefined) ?? 30;
            size = (sheet?.size as string | undefined) ?? "Medium";
            entityDefenses = extractDamageDefenses(sheet);

            try {
              const abilities = listCreatureAbilities({ creature: char as unknown as Parameters<typeof listCreatureAbilities>[0]["creature"] });
              knownAbilities = abilities
                .filter((ab) => ab.economy === "bonus" || ab.economy === "reaction" || (ab.source !== "base" && ab.economy === "action"))
                .map((ab) => ab.name);
            } catch (err) {
              if (this.aiDebugEnabled) console.debug("[AiContextBuilder] listCreatureAbilities failed for ally character:", err);
            }
          }
        } else if (a.combatantType === "NPC" && a.npcId) {
          const npc = await this.npcs.getById(a.npcId);
          if (npc) {
            const statBlock = npc.statBlock as Record<string, unknown>;
            className = statBlock?.className as string | undefined;
            level = statBlock?.level as number | undefined;
            armorClass = statBlock?.armorClass as number | undefined;
            speed = (statBlock?.speed as number | undefined) ?? 30;
            size = statBlock?.size as string | undefined;
            entityDefenses = extractDamageDefenses(statBlock);

            try {
              const abilities = listCreatureAbilities({ creature: npc as unknown as Parameters<typeof listCreatureAbilities>[0]["creature"], monsterStatBlock: statBlock });
              knownAbilities = abilities
                .filter((ab) => ab.economy === "bonus" || ab.economy === "reaction" || (ab.source !== "base" && ab.economy === "action"))
                .map((ab) => ab.name);
            } catch (err) {
              if (this.aiDebugEnabled) console.debug("[AiContextBuilder] listCreatureAbilities failed for ally NPC:", err);
            }
          }
        } else if (a.combatantType === "Monster" && a.monsterId) {
          const monster = await this.monsters.getById(a.monsterId);
          if (monster) {
            const statBlock = monster.statBlock as Record<string, unknown>;
            armorClass = statBlock?.armorClass as number | undefined;
            speed = (statBlock?.speed as number | undefined) ?? 30;
            size = statBlock?.size as string | undefined;
            entityDefenses = extractDamageDefenses(statBlock);

            try {
              const abilities = listCreatureAbilities({ creature: monster as unknown as Parameters<typeof listCreatureAbilities>[0]["creature"], monsterStatBlock: statBlock });
              knownAbilities = abilities
                .filter((ab) => ab.economy === "bonus" || ab.economy === "reaction" || (ab.source !== "base" && ab.economy === "action"))
                .map((ab) => ab.name);
            } catch (err) {
              if (this.aiDebugEnabled) console.debug("[AiContextBuilder] listCreatureAbilities failed for ally monster:", err);
            }
          }
        }

        const { damageResistances, damageImmunities, damageVulnerabilities } = entityDefenses;
        return {
          name: nameMap.get(a.id) || "Ally",
          hp: {
            current: a.hpCurrent,
            max: a.hpMax,
            percentage: Math.round((a.hpCurrent / a.hpMax) * 100),
          },
          ...(conditions.length > 0 ? { conditions } : {}),
          ...(position ? { position } : {}),
          ac: armorClass,
          speed,
          ...(size ? { size } : {}),
          ...(className ? { class: className } : {}),
          ...(level ? { level } : {}),
          initiative: a.initiative,
          ...(knownAbilities.length > 0 ? { knownAbilities } : {}),
          ...(damageResistances && damageResistances.length > 0 ? { damageResistances } : {}),
          ...(damageImmunities && damageImmunities.length > 0 ? { damageImmunities } : {}),
          ...(damageVulnerabilities && damageVulnerabilities.length > 0 ? { damageVulnerabilities } : {}),
          ...(deathSaves ? { deathSaves } : {}),
          ...(concentrationSpell ? { concentrationSpell } : {}),
        };
      }),
    );
  }

  /**
   * Build enemy details for context (async - loads entity data).
   */
  private async buildEnemyDetails(
    enemies: CombatantStateRecord[],
    nameMap: Map<string, string>,
  ): Promise<AiCombatContext["enemies"]> {
    return Promise.all(
      enemies.map(async (e) => {
        const name = nameMap.get(e.id) || "Enemy";
        const position = this.getPosition(e);
        let className: string | undefined;
        let level: number | undefined;
        let armorClass: number | undefined;
        let speed: number | undefined;
        let size: string | undefined;
        let knownAbilities: string[] = [];
        let entityDefenses: ReturnType<typeof extractDamageDefenses> = {};

        let spellSaveDC: number | undefined;

        if (e.combatantType === "Character" && e.characterId) {
          const char = await this.characters.getById(e.characterId);
          if (char) {
            className = char.className || undefined;
            level = char.level;
            const sheet = char.sheet as Record<string, unknown>;
            armorClass = sheet?.armorClass as number | undefined;
            speed = (sheet?.speed as number | undefined) ?? 30;
            size = (sheet?.size as string | undefined) ?? "Medium";
            entityDefenses = extractDamageDefenses(sheet);
            spellSaveDC = this.extractSpellCasting(sheet).spellSaveDC;

            try {
              const abilities = listCreatureAbilities({ creature: char as unknown as Parameters<typeof listCreatureAbilities>[0]["creature"] });
              knownAbilities = abilities
                .filter((a) => a.economy === "bonus" || a.economy === "reaction" || (a.source !== "base" && a.economy === "action"))
                .map((a) => a.name);
            } catch (err) {
              if (this.aiDebugEnabled) console.debug("[AiContextBuilder] listCreatureAbilities failed for enemy character:", err);
            }
          }
        } else if (e.combatantType === "NPC" && e.npcId) {
          const npc = await this.npcs.getById(e.npcId);
          if (npc) {
            const statBlock = npc.statBlock as Record<string, unknown>;
            className = statBlock?.className as string | undefined;
            level = statBlock?.level as number | undefined;
            armorClass = statBlock?.armorClass as number | undefined;
            speed = (statBlock?.speed as number | undefined) ?? 30;
            size = statBlock?.size as string | undefined;
            entityDefenses = extractDamageDefenses(statBlock);
            spellSaveDC = this.extractSpellCasting(statBlock).spellSaveDC;

            try {
              const abilities = listCreatureAbilities({ creature: npc as unknown as Parameters<typeof listCreatureAbilities>[0]["creature"], monsterStatBlock: statBlock });
              knownAbilities = abilities
                .filter((a) => a.economy === "bonus" || a.economy === "reaction" || (a.source !== "base" && a.economy === "action"))
                .map((a) => a.name);
            } catch (err) {
              if (this.aiDebugEnabled) console.debug("[AiContextBuilder] listCreatureAbilities failed for enemy NPC:", err);
            }
          }
        } else if (e.combatantType === "Monster" && e.monsterId) {
          const monster = await this.monsters.getById(e.monsterId);
          if (monster) {
            const statBlock = monster.statBlock as Record<string, unknown>;
            armorClass = statBlock?.armorClass as number | undefined;
            speed = (statBlock?.speed as number | undefined) ?? 30;
            size = statBlock?.size as string | undefined;
            entityDefenses = extractDamageDefenses(statBlock);
            spellSaveDC = this.extractSpellCasting(statBlock).spellSaveDC;

            try {
              const abilities = listCreatureAbilities({ creature: monster as unknown as Parameters<typeof listCreatureAbilities>[0]["creature"], monsterStatBlock: statBlock });
              knownAbilities = abilities
                .filter((a) => a.economy === "bonus" || a.economy === "reaction" || (a.source !== "base" && a.economy === "action"))
                .map((a) => a.name);
            } catch (err) {
              if (this.aiDebugEnabled) console.debug("[AiContextBuilder] listCreatureAbilities failed for enemy monster:", err);
            }
          }
        }

        const conditions = readConditionNames(e.conditions);
        const concentrationSpell = this.getConcentrationSpell(e);
        const deathSaves = this.getDeathSaves(e);
        const { damageResistances, damageImmunities, damageVulnerabilities } = entityDefenses;
        return {
          name,
          class: className,
          level,
          hp: {
            current: e.hpCurrent,
            max: e.hpMax,
            percentage: Math.round((e.hpCurrent / e.hpMax) * 100),
          },
          ...(conditions.length > 0 ? { conditions } : {}),
          ...(position ? { position } : {}),
          ac: armorClass,
          speed,
          ...(size ? { size } : {}),
          initiative: e.initiative,
          ...(knownAbilities.length > 0 ? { knownAbilities } : {}),
          ...(damageResistances && damageResistances.length > 0 ? { damageResistances } : {}),
          ...(damageImmunities && damageImmunities.length > 0 ? { damageImmunities } : {}),
          ...(damageVulnerabilities && damageVulnerabilities.length > 0 ? { damageVulnerabilities } : {}),
          ...(spellSaveDC ? { spellSaveDC } : {}),
          ...(concentrationSpell ? { concentrationSpell } : {}),
          ...(deathSaves ? { deathSaves } : {}),
        };
      }),
    );
  }

  /**
   * Extract ability scores from a stat block or character sheet.
   */
  private extractAbilityScores(source: Record<string, unknown> | undefined): AiCombatContext["combatant"]["abilityScores"] {
    if (!source) return undefined;
    const scores = source.abilityScores as Record<string, unknown> | undefined;
    if (!scores || typeof scores !== "object") return undefined;
    const str = typeof scores.strength === "number" ? scores.strength : undefined;
    const dex = typeof scores.dexterity === "number" ? scores.dexterity : undefined;
    const con = typeof scores.constitution === "number" ? scores.constitution : undefined;
    const int = typeof scores.intelligence === "number" ? scores.intelligence : undefined;
    const wis = typeof scores.wisdom === "number" ? scores.wisdom : undefined;
    const cha = typeof scores.charisma === "number" ? scores.charisma : undefined;
    if (str === undefined && dex === undefined && con === undefined && int === undefined && wis === undefined && cha === undefined) return undefined;
    return {
      strength: str ?? 10,
      dexterity: dex ?? 10,
      constitution: con ?? 10,
      intelligence: int ?? 10,
      wisdom: wis ?? 10,
      charisma: cha ?? 10,
    };
  }

  /**
   * Extract spell save DC and spell attack bonus from a stat block or character sheet.
   */
  private extractSpellCasting(source: Record<string, unknown> | undefined): { spellSaveDC?: number; spellAttackBonus?: number } {
    if (!source) return {};
    const dc = typeof source.spellSaveDC === "number" ? source.spellSaveDC : undefined;
    const bonus = typeof source.spellAttackBonus === "number" ? source.spellAttackBonus : undefined;
    return { spellSaveDC: dc, spellAttackBonus: bonus };
  }

  /**
   * Derive class abilities from className + level for the AI context.
   * Returns a simplified list the LLM can use for tactical decisions.
   */
  private getClassAbilitiesForContext(className?: string, level?: number): AiCombatContext["combatant"]["classAbilities"] {
    if (!className || !level || level <= 0) return undefined;
    const abilities = getClassAbilities(className.toLowerCase(), level);
    if (abilities.length === 0) return undefined;
    return abilities.map(a => ({
      name: a.name,
      economy: a.economy,
      ...(a.resourceCost ? { resourceCost: `${a.resourceCost.amount} ${a.resourceCost.pool}` } : {}),
      ...(a.summary ? { effect: a.summary } : {}),
    }));
  }

  /**
   * Parse the number of attacks from a monster's Multiattack action description.
   * Returns the count if a Multiattack action is found, otherwise 1.
   */
  private parseMultiattackCount(actions: unknown[]): number {
    if (!Array.isArray(actions)) return 1;
    const multiattack = actions.find(
      (a: any) => typeof a?.name === "string" && a.name.toLowerCase() === "multiattack",
    ) as { description?: string } | undefined;
    if (!multiattack?.description) return 1;

    const desc = multiattack.description.toLowerCase();
    const wordMap: Record<string, number> = {
      two: 2, three: 3, four: 4, five: 5, six: 6,
    };
    for (const [word, count] of Object.entries(wordMap)) {
      if (desc.includes(word)) return count;
    }
    // Try numeric: "makes 2 attacks"
    const numMatch = desc.match(/(\d+)\s*(?:attacks|strikes)/);
    if (numMatch) return parseInt(numMatch[1], 10);
    return 1;
  }

  /**
   * Build entity info for the AI combatant itself.
   */
  private buildEntityInfo(
    entityData: Record<string, unknown>,
    aiCombatant: CombatantStateRecord,
  ): AiCombatContext["combatant"] {
    const aiPosition = this.getPosition(aiCombatant);
    const aiEconomy = this.getEconomy(aiCombatant);
    const aiConditions = readConditionNames(aiCombatant.conditions);
    const resourcePools = this.getResourcePoolsForContext(aiCombatant);
    const activeBuffs = this.getActiveBuffs(aiCombatant);
    const concentrationSpell = this.getConcentrationSpell(aiCombatant);

    if (aiCombatant.combatantType === "Monster") {
      const statBlock = entityData.statBlock as Record<string, unknown>;
      const defenses = extractDamageDefenses(statBlock);
      const ac = statBlock.armorClass as number | undefined;
      const speed = (statBlock.speed as number | undefined) ?? 30;
      const abilityScores = this.extractAbilityScores(statBlock);
      const size = statBlock.size as string | undefined;
      const monsterClass = statBlock.className as string | undefined;
      const monsterLevel = statBlock.level as number | undefined;
      const { spellSaveDC, spellAttackBonus } = this.extractSpellCasting(statBlock);
      const classAbilities = this.getClassAbilitiesForContext(monsterClass, monsterLevel);
      return {
        name: entityData.name as string,
        type: statBlock.type as string | undefined,
        alignment: statBlock.alignment as string | undefined,
        cr: statBlock.cr as number | undefined,
        ...(monsterClass ? { class: monsterClass } : {}),
        ...(monsterLevel ? { level: monsterLevel } : {}),
        hp: {
          current: aiCombatant.hpCurrent,
          max: aiCombatant.hpMax,
          percentage: Math.round((aiCombatant.hpCurrent / aiCombatant.hpMax) * 100),
        },
        ...(aiConditions.length > 0 ? { conditions: aiConditions } : {}),
        ...(aiPosition ? { position: aiPosition } : {}),
        ...(aiEconomy ? { economy: aiEconomy } : {}),
        ac,
        speed,
        ...(size ? { size } : {}),
        ...(abilityScores ? { abilityScores } : {}),
        ...(spellSaveDC ? { spellSaveDC } : {}),
        ...(spellAttackBonus ? { spellAttackBonus } : {}),
        initiative: aiCombatant.initiative,
        ...(resourcePools ? { resourcePools } : {}),
        ...(concentrationSpell ? { concentrationSpell } : {}),
        ...(defenses.damageResistances && defenses.damageResistances.length > 0 ? { damageResistances: defenses.damageResistances } : {}),
        ...(defenses.damageImmunities && defenses.damageImmunities.length > 0 ? { damageImmunities: defenses.damageImmunities } : {}),
        ...(defenses.damageVulnerabilities && defenses.damageVulnerabilities.length > 0 ? { damageVulnerabilities: defenses.damageVulnerabilities } : {}),
        ...(activeBuffs ? { activeBuffs } : {}),
        traits: (statBlock.traits as unknown[]) || [],
        attacks: (statBlock.attacks as unknown[]) || [],
        actions: (statBlock.actions as unknown[]) || [],
        bonusActions: (statBlock.bonusActions as unknown[]) || [],
        reactions: (statBlock.reactions as unknown[]) || [],
        spells: (statBlock.spells as unknown[]) || [],
        abilities: (statBlock.abilities as unknown[]) || [],
        features: (statBlock.features as unknown[]) || [],
        ...(classAbilities ? { classAbilities } : {}),
        attacksPerAction: this.parseMultiattackCount((statBlock.actions as unknown[]) || []),
      };
    } else if (aiCombatant.combatantType === "NPC") {
      const statBlock = entityData.statBlock as Record<string, unknown>;
      const defenses = extractDamageDefenses(statBlock);
      const ac = statBlock.armorClass as number | undefined;
      const speed = (statBlock.speed as number | undefined) ?? 30;
      const abilityScores = this.extractAbilityScores(statBlock);
      const npcSize = statBlock.size as string | undefined;
      const npcClass = statBlock.className as string | undefined;
      const npcLevel = statBlock.level as number | undefined;
      const { spellSaveDC, spellAttackBonus } = this.extractSpellCasting(statBlock);
      const classAbilities = this.getClassAbilitiesForContext(npcClass, npcLevel);
      return {
        name: entityData.name as string,
        class: npcClass,
        level: npcLevel,
        hp: {
          current: aiCombatant.hpCurrent,
          max: aiCombatant.hpMax,
          percentage: Math.round((aiCombatant.hpCurrent / aiCombatant.hpMax) * 100),
        },
        ...(aiConditions.length > 0 ? { conditions: aiConditions } : {}),
        ...(aiPosition ? { position: aiPosition } : {}),
        ...(aiEconomy ? { economy: aiEconomy } : {}),
        ac,
        speed,
        ...(npcSize ? { size: npcSize } : {}),
        ...(abilityScores ? { abilityScores } : {}),
        ...(spellSaveDC ? { spellSaveDC } : {}),
        ...(spellAttackBonus ? { spellAttackBonus } : {}),
        initiative: aiCombatant.initiative,
        ...(resourcePools ? { resourcePools } : {}),
        ...(concentrationSpell ? { concentrationSpell } : {}),
        ...(defenses.damageResistances && defenses.damageResistances.length > 0 ? { damageResistances: defenses.damageResistances } : {}),
        ...(defenses.damageImmunities && defenses.damageImmunities.length > 0 ? { damageImmunities: defenses.damageImmunities } : {}),
        ...(defenses.damageVulnerabilities && defenses.damageVulnerabilities.length > 0 ? { damageVulnerabilities: defenses.damageVulnerabilities } : {}),
        ...(activeBuffs ? { activeBuffs } : {}),
        traits: (statBlock.traits as unknown[]) || [],
        attacks: (statBlock.attacks as unknown[]) || [],
        actions: (statBlock.actions as unknown[]) || [],
        bonusActions: (statBlock.bonusActions as unknown[]) || [],
        reactions: (statBlock.reactions as unknown[]) || [],
        spells: (statBlock.spells as unknown[]) || [],
        abilities: (statBlock.abilities as unknown[]) || [],
        features: (statBlock.features as unknown[]) || [],
        ...(classAbilities ? { classAbilities } : {}),
        attacksPerAction: ClassFeatureResolver.getAttacksPerAction(null, npcClass, npcLevel),
      };
    } else {
      // AI-controlled Character
      const sheet = entityData.sheet as Record<string, unknown>;
      const defenses = extractDamageDefenses(sheet);
      const ac = sheet?.armorClass as number | undefined;
      const speed = (sheet?.speed as number | undefined) ?? 30;
      const abilityScores = this.extractAbilityScores(sheet);
      const charSize = (sheet?.size as string | undefined) ?? "Medium";
      const { spellSaveDC, spellAttackBonus } = this.extractSpellCasting(sheet);
      const charClass = entityData.className as string | undefined;
      const charLevel = entityData.level as number | undefined;
      const classAbilities = this.getClassAbilitiesForContext(charClass, charLevel);
      return {
        name: entityData.name as string,
        class: charClass,
        level: charLevel,
        hp: {
          current: aiCombatant.hpCurrent,
          max: aiCombatant.hpMax,
          percentage: Math.round((aiCombatant.hpCurrent / aiCombatant.hpMax) * 100),
        },
        ...(aiConditions.length > 0 ? { conditions: aiConditions } : {}),
        ...(aiPosition ? { position: aiPosition } : {}),
        ...(aiEconomy ? { economy: aiEconomy } : {}),
        ac,
        speed,
        size: charSize,
        ...(abilityScores ? { abilityScores } : {}),
        ...(spellSaveDC ? { spellSaveDC } : {}),
        ...(spellAttackBonus ? { spellAttackBonus } : {}),
        initiative: aiCombatant.initiative,
        ...(resourcePools ? { resourcePools } : {}),
        ...(concentrationSpell ? { concentrationSpell } : {}),
        ...(defenses.damageResistances && defenses.damageResistances.length > 0 ? { damageResistances: defenses.damageResistances } : {}),
        ...(defenses.damageImmunities && defenses.damageImmunities.length > 0 ? { damageImmunities: defenses.damageImmunities } : {}),
        ...(defenses.damageVulnerabilities && defenses.damageVulnerabilities.length > 0 ? { damageVulnerabilities: defenses.damageVulnerabilities } : {}),
        ...(activeBuffs ? { activeBuffs } : {}),
        traits: (sheet?.traits as unknown[]) || [],
        attacks: (sheet?.attacks as unknown[]) || [],
        actions: (sheet?.actions as unknown[]) || [],
        bonusActions: (sheet?.bonusActions as unknown[]) || [],
        reactions: (sheet?.reactions as unknown[]) || [],
        spells: (sheet?.spells as unknown[]) || [],
        abilities: (sheet?.abilities as unknown[]) || [],
        features: (sheet?.features as unknown[]) || [],
        ...(classAbilities ? { classAbilities } : {}),
        attacksPerAction: ClassFeatureResolver.getAttacksPerAction(null, charClass, charLevel),
      };
    }
  }

  /**
   * Render battlefield visualization if map data is present.
   */
  private renderBattlefieldContext(
    encounter: CombatEncounterRecord,
    aiCombatant: CombatantStateRecord,
    entityInfo: AiCombatContext["combatant"],
    allies: CombatantStateRecord[],
    enemies: CombatantStateRecord[],
    nameMap: Map<string, string>,
  ): AiCombatContext["battlefield"] | undefined {
    if (!encounter.mapData) return undefined;

    const map = encounter.mapData as CombatMap;
    const aiPosition = this.getPosition(aiCombatant);
    const entities: Parameters<typeof renderBattlefield>[1] = [];

    // Add self
    if (aiPosition) {
      entities.push(
        createCombatantEntity(
          {
            name: entityInfo.name,
            position: aiPosition,
            hpCurrent: aiCombatant.hpCurrent,
            hpMax: aiCombatant.hpMax,
            faction: undefined,
          },
          "@",
          true,
          "Unknown",
        ),
      );
    }

    // Add allies with numeric characters
    let allyChar = 1;
    for (const ally of allies) {
      const pos = this.getPosition(ally);
      const name = nameMap.get(ally.id) || "Ally";
      if (pos && ally.id !== aiCombatant.id) {
        entities.push(
          createCombatantEntity(
            { name, position: pos, hpCurrent: ally.hpCurrent, hpMax: ally.hpMax, faction: undefined },
            allyChar.toString(),
            false,
            "Unknown",
          ),
        );
        allyChar = (allyChar % 9) + 1;
      }
    }

    // Add enemies with letter characters
    let enemyChar = "A".charCodeAt(0);
    for (const enemy of enemies) {
      const pos = this.getPosition(enemy);
      const name = nameMap.get(enemy.id) || "Enemy";
      if (pos) {
        entities.push(
          createCombatantEntity(
            { name, position: pos, hpCurrent: enemy.hpCurrent, hpMax: enemy.hpMax, faction: undefined },
            String.fromCharCode(enemyChar),
            false,
            "Unknown",
          ),
        );
        enemyChar = enemyChar === "Z".charCodeAt(0) ? "A".charCodeAt(0) : enemyChar + 1;
      }
    }

    const rendered = renderBattlefield(map, entities);
    return {
      grid: rendered.grid,
      legend: rendered.legend,
      size: { width: map.width, height: map.height },
    };
  }

  /**
   * Build complete combat context for AI decision maker.
   */
  async build(
    entityData: Record<string, unknown>,
    aiCombatant: CombatantStateRecord,
    allCombatants: CombatantStateRecord[],
    encounter: CombatEncounterRecord,
    recentNarrative: string[],
    actionHistory: string[],
    turnResults: TurnStepResult[],
    battlePlanView?: AiCombatContext["battlePlan"],
  ): Promise<AiCombatContext> {
    // Determine allies and enemies using faction service
    const allies = await this.factionService.getAllies(allCombatants, aiCombatant);
    const enemies = await this.factionService.getEnemies(allCombatants, aiCombatant);

    // Batch-load all names for allies and enemies
    const allRelevant = [...allies, ...enemies];
    const nameMap = await this.combatantResolver.getNames(allRelevant);

    // Build component parts
    const entityInfo = this.buildEntityInfo(entityData, aiCombatant);
    const allyDetails = await this.buildAllyDetails(allies, nameMap);
    const enemyDetails = await this.buildEnemyDetails(enemies, nameMap);

    // Check inventory for potions (for AI pre-filtering of useObject)
    const inventory = getInventory(aiCombatant.resources);
    const hasPotions = inventory.some(item => {
      if (item.quantity < 1) return false;
      const itemDef = lookupMagicItem(item.name);
      return !!(itemDef?.potionEffects);
    });

    // Inject pre-computed distances from self to each enemy and ally
    const selfPos = entityInfo.position;
    if (selfPos) {
      for (const enemy of enemyDetails) {
        if (enemy.position) {
          enemy.distanceFeet = Math.round(calculateDistance(selfPos, enemy.position));
        }
      }
      for (const ally of allyDetails) {
        if (ally.position) {
          ally.distanceFeet = Math.round(calculateDistance(selfPos, ally.position));
        }
      }
    }

    // Inject cover levels from self to each enemy (requires map data)
    const mapForCover = encounter.mapData as unknown as CombatMap | undefined;
    if (selfPos && mapForCover) {
      for (const enemy of enemyDetails) {
        if (enemy.position) {
          const cover = getCoverLevel(mapForCover, selfPos, enemy.position);
          if (cover !== "none") {
            enemy.coverFromMe = cover;
          }
        }
      }
    }

    const battlefield = this.renderBattlefieldContext(
      encounter,
      aiCombatant,
      entityInfo,
      allies,
      enemies,
      nameMap,
    );

    // Build zone context from map data
    const map = encounter.mapData as unknown as CombatMap | undefined;
    const mapZones = map ? getMapZones(map) : [];
    const zoneContext = mapZones.length > 0
      ? mapZones.map(z => ({
          id: z.id,
          center: { x: z.center.x, y: z.center.y },
          radiusFeet: z.radiusFeet,
          shape: z.shape,
          source: z.source,
          type: z.type,
          effects: z.effects.map(e => ({
            trigger: e.trigger,
            ...(e.damageType ? { damageType: e.damageType } : {}),
            ...(e.damage ? { damage: `${e.damage.diceCount}d${e.damage.diceSides}${e.damage.modifier ? `+${e.damage.modifier}` : ""}` } : {}),
            ...(e.saveAbility ? { saveAbility: e.saveAbility as string } : {}),
            ...(e.saveDC !== undefined ? { saveDC: e.saveDC } : {}),
          })),
        }))
      : undefined;

    return {
      combatant: entityInfo,
      combat: {
        round: encounter.round,
        turn: encounter.turn,
        totalCombatants: allCombatants.length,
      },
      allies: allyDetails,
      enemies: enemyDetails,
      hasPotions,
      ...(battlefield ? { battlefield } : {}),
      ...(zoneContext ? { zones: zoneContext } : {}),
      recentNarrative,
      actionHistory,
      turnResults,
      lastActionResult: turnResults.length > 0 ? turnResults[turnResults.length - 1] : null,
      ...(battlePlanView ? { battlePlan: battlePlanView } : {}),
    };
  }
}
