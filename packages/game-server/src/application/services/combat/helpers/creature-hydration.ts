/**
 * Creature Hydration Layer
 * 
 * Converts database records (SessionCharacterRecord, SessionMonsterRecord, SessionNPCRecord)
 * into rich domain entities (Character, Monster, NPC) for use in combat and other business logic.
 */

import { Character, type CharacterData } from "../../../../domain/entities/creatures/character.js";
import { Monster, type MonsterData } from "../../../../domain/entities/creatures/monster.js";
import { NPC, type NPCData } from "../../../../domain/entities/creatures/npc.js";
import { AbilityScores, type AbilityScoresData } from "../../../../domain/entities/core/ability-scores.js";
import { EquippedItems } from "../../../../domain/entities/items/equipped-items.js";
import type { ResourcePool } from "../../../../domain/entities/combat/resource-pool.js";
import type { 
  SessionCharacterRecord, 
  SessionMonsterRecord, 
  SessionNPCRecord,
  CombatantStateRecord,
} from "../../../types.js";

/**
 * Helper to safely read a number from JSON blob.
 */
function readNumber(obj: unknown, key: string): number | undefined {
  if (typeof obj !== 'object' || obj === null) return undefined;
  const val = (obj as Record<string, unknown>)[key];
  return typeof val === 'number' ? val : undefined;
}

/**
 * Helper to safely read a string from JSON blob.
 */
function readString(obj: unknown, key: string): string | undefined {
  if (typeof obj !== 'object' || obj === null) return undefined;
  const val = (obj as Record<string, unknown>)[key];
  return typeof val === 'string' ? val : undefined;
}

/**
 * Helper to safely read an array from JSON blob.
 */
function readArray<T = unknown>(obj: unknown, key: string): T[] | undefined {
  if (typeof obj !== 'object' || obj === null) return undefined;
  const val = (obj as Record<string, unknown>)[key];
  return Array.isArray(val) ? val : undefined;
}

/**
 * Helper to safely read an object from JSON blob.
 */
function readObject(obj: unknown, key: string): Record<string, unknown> | undefined {
  if (typeof obj !== 'object' || obj === null) return undefined;
  const val = (obj as Record<string, unknown>)[key];
  return typeof val === 'object' && val !== null ? val as Record<string, unknown> : undefined;
}

/**
 * Parse ability scores from JSON sheet.
 */
function extractAbilityScores(abilityScores: unknown): AbilityScoresData {
  const defaults: AbilityScoresData = {
    strength: 10,
    dexterity: 10,
    constitution: 10,
    intelligence: 10,
    wisdom: 10,
    charisma: 10,
  };

  if (typeof abilityScores !== 'object' || abilityScores === null) {
    return defaults;
  }

  const scores = abilityScores as Record<string, unknown>;
  return {
    strength: typeof scores.strength === 'number' ? scores.strength : defaults.strength,
    dexterity: typeof scores.dexterity === 'number' ? scores.dexterity : defaults.dexterity,
    constitution: typeof scores.constitution === 'number' ? scores.constitution : defaults.constitution,
    intelligence: typeof scores.intelligence === 'number' ? scores.intelligence : defaults.intelligence,
    wisdom: typeof scores.wisdom === 'number' ? scores.wisdom : defaults.wisdom,
    charisma: typeof scores.charisma === 'number' ? scores.charisma : defaults.charisma,
  };
}

/**
 * Parse resource pools from JSON (for characters).
 */
function extractResourcePools(resources: unknown): ResourcePool[] | undefined {
  if (!Array.isArray(resources)) return undefined;
  
  return resources
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
    .map((pool) => ({
      name: typeof pool.name === 'string' ? pool.name : 'unknown',
      current: typeof pool.current === 'number' ? pool.current : 0,
      max: typeof pool.max === 'number' ? pool.max : 0,
    }));
}

/**
 * Parse conditions from CombatantStateRecord.
 */
function extractConditions(conditions: unknown): string[] {
  if (!Array.isArray(conditions)) return [];
  return conditions.filter((c): c is string => typeof c === 'string');
}

/**
 * Hydrate a Character domain entity from database record.
 * 
 * @param record - SessionCharacterRecord from database
 * @param combatantState - Optional CombatantStateRecord for current HP/conditions in combat
 * @returns Character domain entity
 */
export function hydrateCharacter(
  record: SessionCharacterRecord,
  combatantState?: CombatantStateRecord,
): Character {
  const sheet = record.sheet as Record<string, unknown>;
  
  // Parse core stats from sheet JSON
  const abilityScores = extractAbilityScores(readObject(sheet, 'abilityScores'));
  const level = readNumber(sheet, 'level') ?? record.level;
  const maxHP = readNumber(sheet, 'maxHP') ?? readNumber(sheet, 'hitPoints') ?? 10;
  const currentHP = combatantState?.hpCurrent ?? readNumber(sheet, 'currentHP') ?? maxHP;
  const armorClass = readNumber(sheet, 'armorClass') ?? readNumber(sheet, 'ac') ?? 10;
  const speed = readNumber(sheet, 'speed') ?? 30;
  const proficiencyBonus = readNumber(sheet, 'proficiencyBonus') ?? Math.floor((level - 1) / 4) + 2;
  
  // Parse optional fields
  const experiencePoints = readNumber(sheet, 'experiencePoints') ?? readNumber(sheet, 'xp') ?? 0;
  const featIds = readArray<string>(sheet, 'featIds') ?? readArray<string>(sheet, 'feats') ?? [];
  const resourcePools = extractResourcePools(readArray(sheet, 'resourcePools'));
  
  // Parse class ID
  const classId = readString(sheet, 'classId') ?? record.className?.toLowerCase();
  
  // Conditions from combat state (not sheet)
  const conditions = combatantState ? extractConditions(combatantState.conditions) : [];

  const data: CharacterData = {
    id: combatantState?.id ?? record.id,  // Use combatant ID in combat context
    name: record.name,
    maxHP,
    currentHP,
    armorClass,
    speed,
    abilityScores: new AbilityScores(abilityScores),
    level,
    characterClass: record.className ?? 'Fighter',
    classId: classId as CharacterData['classId'],
    experiencePoints,
    resourcePools,
    featIds,
  };

  const character = new Character(data);
  
  // Apply conditions from combat state
  for (const condition of conditions) {
    character.addCondition(condition);
  }

  return character;
}

/**
 * Hydrate a Monster domain entity from database record.
 * 
 * @param record - SessionMonsterRecord from database
 * @param combatantState - Optional CombatantStateRecord for current HP/conditions in combat
 * @returns Monster domain entity
 */
export function hydrateMonster(
  record: SessionMonsterRecord,
  combatantState?: CombatantStateRecord,
): Monster {
  const statBlock = record.statBlock as Record<string, unknown>;
  
  // Parse core stats from statBlock JSON
  const abilityScores = extractAbilityScores(readObject(statBlock, 'abilityScores'));
  const maxHP = readNumber(statBlock, 'maxHP') ?? readNumber(statBlock, 'hitPoints') ?? 10;
  const currentHP = combatantState?.hpCurrent ?? readNumber(statBlock, 'currentHP') ?? maxHP;
  const armorClass = readNumber(statBlock, 'armorClass') ?? readNumber(statBlock, 'ac') ?? 10;
  const speed = readNumber(statBlock, 'speed') ?? 30;
  const challengeRating = readNumber(statBlock, 'challengeRating') ?? readNumber(statBlock, 'cr') ?? 0;
  const experienceValue = readNumber(statBlock, 'experienceValue') ?? readNumber(statBlock, 'xp') ?? 0;
  
  // Proficiency bonus derived from CR
  const proficiencyBonus = readNumber(statBlock, 'proficiencyBonus') ?? 2;
  
  // Conditions from combat state
  const conditions = combatantState ? extractConditions(combatantState.conditions) : [];

  const data: MonsterData = {
    id: combatantState?.id ?? record.id,  // Use combatant ID in combat context
    name: record.name,
    maxHP,
    currentHP,
    armorClass,
    speed,
    abilityScores: new AbilityScores(abilityScores),
    challengeRating,
    experienceValue,
  };

  const monster = new Monster(data);
  
  // Apply conditions from combat state
  for (const condition of conditions) {
    monster.addCondition(condition);
  }

  return monster;
}

/**
 * Hydrate an NPC domain entity from database record.
 * 
 * @param record - SessionNPCRecord from database
 * @param combatantState - Optional CombatantStateRecord for current HP/conditions in combat
 * @returns NPC domain entity
 */
export function hydrateNPC(
  record: SessionNPCRecord,
  combatantState?: CombatantStateRecord,
): NPC {
  const statBlock = record.statBlock as Record<string, unknown>;
  
  // Parse core stats from statBlock JSON
  const abilityScores = extractAbilityScores(readObject(statBlock, 'abilityScores'));
  const maxHP = readNumber(statBlock, 'maxHP') ?? readNumber(statBlock, 'hitPoints') ?? 10;
  const currentHP = combatantState?.hpCurrent ?? readNumber(statBlock, 'currentHP') ?? maxHP;
  const armorClass = readNumber(statBlock, 'armorClass') ?? readNumber(statBlock, 'ac') ?? 10;
  const speed = readNumber(statBlock, 'speed') ?? 30;
  const proficiencyBonus = readNumber(statBlock, 'proficiencyBonus') ?? 2;
  const role = readString(statBlock, 'role');
  
  // Conditions from combat state
  const conditions = combatantState ? extractConditions(combatantState.conditions) : [];

  const data: NPCData = {
    id: combatantState?.id ?? record.id,  // Use combatant ID in combat context
    name: record.name,
    maxHP,
    currentHP,
    armorClass,
    speed,
    abilityScores: new AbilityScores(abilityScores),
    proficiencyBonus,
    role,
  };

  const npc = new NPC(data);
  
  // Apply conditions from combat state
  for (const condition of conditions) {
    npc.addCondition(condition);
  }

  return npc;
}

/**
 * Extract dirty state from Creature for persistence to CombatantStateRecord.
 * 
 * @param creature - Domain Creature instance
 * @returns Partial update for CombatantStateRecord
 */
export function extractCombatantState(creature: Character | Monster | NPC): {
  hpCurrent: number;
  conditions: string[];
} {
  return {
    hpCurrent: creature.getCurrentHP(),
    conditions: Array.from(creature.getConditions()),
  };
}
