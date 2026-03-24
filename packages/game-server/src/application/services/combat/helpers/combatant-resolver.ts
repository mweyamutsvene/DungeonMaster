import type { Ability } from "../../../../domain/entities/core/ability-scores.js";
import type { CreatureSize } from "../../../../domain/entities/core/types.js";
import { isTwoHanded } from "../../../../domain/entities/items/weapon-properties.js";
import { parseCharacterSheet, parseStatBlockJson, type EquipmentJson } from "./hydration-types.js";
import type { DamageDefenses } from "../../../../domain/rules/damage-defenses.js";

import { ValidationError } from "../../../errors.js";
import type { ICharacterRepository } from "../../../repositories/character-repository.js";
import type { IMonsterRepository } from "../../../repositories/monster-repository.js";
import type { INPCRepository } from "../../../repositories/npc-repository.js";
import type { CombatantStateRecord } from "../../../types.js";

import type { CombatantRef } from "./combatant-ref.js";
import { isRecord, readNumber } from "./json-helpers.js";
import { extractAbilityScores, type AbilityScoresData } from "./combat-utils.js";

type CombatantEquipment = {
  weapon?: string;
  armor?: string;
  hasTwoHanded?: boolean;
};

export type SkillProficiencies = Partial<Record<string, number>>;

export type CombatantCombatStats = {
  name: string;
  armorClass: number;
  abilityScores: AbilityScoresData;
  featIds?: readonly string[];
  equipment?: CombatantEquipment;
  /** Creature size (Tiny, Small, Medium, Large, Huge, Gargantuan). Defaults to Medium if not specified. */
  size: CreatureSize;
  /** Skill modifiers (e.g., { stealth: 10, perception: 5 }) */
  skills?: SkillProficiencies;
  /** Character/creature level. Defaults to 1 if not specified. */
  level: number;
  /** Proficiency bonus. Calculated from level if not specified. */
  proficiencyBonus: number;
  /** Whether the character has a two-handed weapon equipped */
  hasTwoHandedWeapon?: boolean;
  /** Damage resistances, immunities, and vulnerabilities */
  damageDefenses?: DamageDefenses;
  /** Character class name (e.g., "monk", "fighter"). Only set for Characters. */
  className?: string;
};

export interface ICombatantResolver {
  getName(ref: CombatantRef, state: CombatantStateRecord): Promise<string>;
  getNames(combatants: CombatantStateRecord[]): Promise<Map<string, string>>;
  getCombatStats(ref: CombatantRef): Promise<CombatantCombatStats>;
  getMonsterAttacks(monsterId: string): Promise<unknown[]>;
}

function extractEquippedFromSheet(sheet: Record<string, unknown>): CombatantEquipment {
  const equip = sheet.equipment as EquipmentJson | undefined;
  if (!equip || typeof equip !== "object") return {};

  const weaponName = equip.weapon?.name;

  let armorText: string | undefined;
  if (equip.armor?.name) {
    armorText = equip.armor.name;
  }
  if (equip.shield?.name) {
    armorText = armorText ? `${armorText} and ${equip.shield.name}` : equip.shield.name;
  }

  const weaponProperties = equip.weapon?.properties;
  const hasTwoHanded = isTwoHanded(weaponProperties);

  return {
    weapon: typeof weaponName === "string" ? weaponName : undefined,
    armor: armorText,
    hasTwoHanded,
  };
}

/**
 * Extract skill proficiencies from a sheet or statBlock.
 * Returns a map of skill names to their total modifier.
 */
function extractSkills(data: Record<string, unknown>): SkillProficiencies | undefined {
  const skills = data.skills;
  if (!skills || typeof skills !== "object") return undefined;

  const result: SkillProficiencies = {};
  for (const [key, value] of Object.entries(skills)) {
    if (typeof value === "number") {
      result[key.toLowerCase()] = value;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Calculate proficiency bonus from character level (D&D 5e).
 * Level 1-4: +2, Level 5-8: +3, Level 9-12: +4, Level 13-16: +5, Level 17-20: +6
 */
function calculateProficiencyBonus(level: number): number {
  return Math.floor((level - 1) / 4) + 2;
}

/**
 * Extract creature size from sheet/statBlock. Defaults to Medium if not found.
 */
function extractSize(data: Record<string, unknown>): CreatureSize {
  const size = data.size;
  if (typeof size === "string") {
    const normalized = size.charAt(0).toUpperCase() + size.slice(1).toLowerCase();
    const validSizes: CreatureSize[] = ["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"];
    if (validSizes.includes(normalized as CreatureSize)) {
      return normalized as CreatureSize;
    }
  }
  return "Medium"; // Default
}

function extractDefenses(data: Record<string, unknown>): DamageDefenses | undefined {
  const toStringArray = (val: unknown): string[] | undefined => {
    if (!Array.isArray(val)) return undefined;
    return val.filter((x): x is string => typeof x === "string");
  };
  const r = toStringArray(data.damageResistances);
  const i = toStringArray(data.damageImmunities);
  const v = toStringArray(data.damageVulnerabilities);
  if (!r && !i && !v) return undefined;
  return { damageResistances: r, damageImmunities: i, damageVulnerabilities: v };
}

export class CombatantResolver implements ICombatantResolver {
  constructor(
    private readonly characters: ICharacterRepository,
    private readonly monsters: IMonsterRepository,
    private readonly npcs: INPCRepository,
  ) {}

  async getName(ref: CombatantRef, state: CombatantStateRecord): Promise<string> {
    if (ref.type === "Character" && state.characterId) {
      const c = await this.characters.getById(state.characterId);
      return c?.name || "Unknown character";
    }
    if (ref.type === "Monster" && state.monsterId) {
      const m = await this.monsters.getById(state.monsterId);
      return m?.name || "The monster";
    }
    if (ref.type === "NPC" && state.npcId) {
      const n = await this.npcs.getById(state.npcId);
      return n?.name || "The NPC";
    }
    return "The actor";
  }

  async getNames(combatants: CombatantStateRecord[]): Promise<Map<string, string>> {
    const charIds = combatants.filter(c => c.combatantType === "Character" && c.characterId).map(c => c.characterId!);
    const monsterIds = combatants.filter(c => c.combatantType === "Monster" && c.monsterId).map(c => c.monsterId!);
    const npcIds = combatants.filter(c => c.combatantType === "NPC" && c.npcId).map(c => c.npcId!);

    const [chars, monsters, npcs] = await Promise.all([
      this.characters.getManyByIds(charIds),
      this.monsters.getManyByIds(monsterIds),
      this.npcs.getManyByIds(npcIds),
    ]);

    const nameMap = new Map<string, string>();
    for (const c of combatants) {
      if (c.combatantType === "Character" && c.characterId) {
        const char = chars.find(ch => ch.id === c.characterId);
        nameMap.set(c.id, char?.name || "Unknown character");
      } else if (c.combatantType === "Monster" && c.monsterId) {
        const mon = monsters.find(m => m.id === c.monsterId);
        nameMap.set(c.id, mon?.name || "The monster");
      } else if (c.combatantType === "NPC" && c.npcId) {
        const npc = npcs.find(n => n.id === c.npcId);
        nameMap.set(c.id, npc?.name || "The NPC");
      } else {
        nameMap.set(c.id, "The actor");
      }
    }

    return nameMap;
  }

  async getCombatStats(ref: CombatantRef): Promise<CombatantCombatStats> {
    if (ref.type === "Character") {
      const c = await this.characters.getById(ref.characterId);
      if (!c) throw new ValidationError(`Character not found: ${ref.characterId}`);
      if (!isRecord(c.sheet)) throw new ValidationError("Character sheet must be an object");
      const sheet = parseCharacterSheet(c.sheet);

      const armorClass = readNumber(c.sheet, "armorClass") ?? readNumber(c.sheet, "ac");
      const abilityScores = extractAbilityScores(sheet.abilityScores);
      const featIds = sheet.featIds;

      if (armorClass === null || !abilityScores) {
        throw new ValidationError("Character is missing required combat stats (armorClass, abilityScores)");
      }

      // Extract level and proficiency bonus
      const level = readNumber(c.sheet, "level") ?? c.level ?? 1;
      const proficiencyBonusFromSheet = readNumber(c.sheet, "proficiencyBonus");
      const proficiencyBonus = proficiencyBonusFromSheet ?? calculateProficiencyBonus(level);

      const equip = extractEquippedFromSheet(c.sheet);
      const className = sheet.className ?? (typeof c.className === "string" ? c.className : undefined);

      return {
        name: c.name,
        armorClass,
        abilityScores,
        featIds,
        equipment: equip,
        size: extractSize(c.sheet),
        skills: extractSkills(c.sheet),
        level,
        proficiencyBonus,
        hasTwoHandedWeapon: equip.hasTwoHanded,
        damageDefenses: extractDefenses(c.sheet),
        className,
      };
    }

    if (ref.type === "Monster") {
      const m = await this.monsters.getById(ref.monsterId);
      if (!m) throw new ValidationError(`Monster not found: ${ref.monsterId}`);
      if (!isRecord(m.statBlock)) throw new ValidationError("Monster statBlock must be an object");
      const statBlock = parseStatBlockJson(m.statBlock);

      const armorClass = readNumber(m.statBlock, "armorClass") ?? readNumber(m.statBlock, "ac");
      const abilityScores = extractAbilityScores(statBlock.abilityScores);
      if (armorClass === null || !abilityScores) {
        throw new ValidationError("Monster is missing required combat stats (armorClass, abilityScores)");
      }

      // Monsters use CR-based proficiency, approximate with level or default
      const cr = readNumber(m.statBlock, "challengeRating") ?? readNumber(m.statBlock, "cr");
      const monsterLevel = cr !== null ? Math.max(1, Math.floor(cr)) : 1;
      const proficiencyBonus = calculateProficiencyBonus(monsterLevel + 4); // Monsters are typically higher level equivalent

      return {
        name: m.name,
        armorClass,
        abilityScores,
        size: extractSize(m.statBlock),
        skills: extractSkills(m.statBlock),
        level: monsterLevel,
        proficiencyBonus,
        damageDefenses: extractDefenses(m.statBlock),
      };
    }

    const n = await this.npcs.getById(ref.npcId);
    if (!n) throw new ValidationError(`NPC not found: ${ref.npcId}`);
    if (!isRecord(n.statBlock)) throw new ValidationError("NPC statBlock must be an object");
    const statBlock = parseStatBlockJson(n.statBlock);

    const armorClass = readNumber(n.statBlock, "armorClass") ?? readNumber(n.statBlock, "ac");
    const abilityScores = extractAbilityScores(statBlock.abilityScores);
    if (armorClass === null || !abilityScores) {
      throw new ValidationError("NPC is missing required combat stats (armorClass, abilityScores)");
    }

    // NPCs may have a level or we default to 1
    const level = readNumber(n.statBlock, "level") ?? 1;
    const proficiencyBonusFromSheet = readNumber(n.statBlock, "proficiencyBonus");
    const proficiencyBonus = proficiencyBonusFromSheet ?? calculateProficiencyBonus(level);

    return {
      name: n.name,
      armorClass,
      abilityScores,
      size: extractSize(n.statBlock),
      skills: extractSkills(n.statBlock),
      level,
      proficiencyBonus,
      damageDefenses: extractDefenses(n.statBlock),
    };
  }

  async getMonsterAttacks(monsterId: string): Promise<unknown[]> {
    const m = await this.monsters.getById(monsterId);
    if (!m) throw new ValidationError(`Monster not found: ${monsterId}`);
    if (!isRecord(m.statBlock)) throw new ValidationError("Monster statBlock must be an object");

    const statBlock = parseStatBlockJson(m.statBlock);
    return Array.isArray(statBlock.attacks) ? statBlock.attacks : [];
  }
}
