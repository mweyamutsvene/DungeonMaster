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
import type { ResourcePool } from "../../../../domain/entities/combat/resource-pool.js";
import { getArmorTrainingForClass } from "../../../../domain/entities/classes/registry.js";
import { getSpeciesTraits } from "../../../../domain/entities/creatures/species-registry.js";
import type { 
  SessionCharacterRecord, 
  SessionMonsterRecord, 
  SessionNPCRecord,
  CombatantStateRecord,
} from "../../../types.js";
import { readNumber, readString, readArray, readObject } from "./json-helpers.js";
import type { FightingStyleId } from "../../../../domain/entities/classes/fighting-style.js";
import { isFightingStyleId } from "../../../../domain/entities/classes/fighting-style.js";
import type { EquippedItems, EquippedArmorCategory } from "../../../../domain/entities/items/equipped-items.js";
import { lookupArmor } from "../../../../domain/entities/items/armor-catalog.js";

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
 * Handles both legacy string[] and structured ActiveCondition[] formats.
 */
function extractConditions(conditions: unknown): string[] {
  if (!Array.isArray(conditions)) return [];
  // Handle ActiveCondition objects
  return conditions.map((c) => {
    if (typeof c === 'string') return c;
    if (typeof c === 'object' && c !== null && 'condition' in c) return (c as { condition: string }).condition;
    return '';
  }).filter(Boolean);
}

/**
 * Extract equipped armor and shield from the character sheet JSON.
 *
 * Checks two sources in order:
 * 1. Pre-enriched `equippedArmor`/`equippedShield` fields (set by `enrichSheetArmor()` at character creation)
 * 2. Fallback: `sheet.equipment.armor.name` looked up in the armor catalog
 *
 * Returns undefined if the character has no armor or shield equipped.
 */
function extractEquipment(sheet: Record<string, unknown>): EquippedItems | undefined {
  let armor: EquippedItems["armor"];
  let shield: EquippedItems["shield"];

  // 1. Check pre-enriched equippedArmor (from enrichSheetArmor at creation time)
  const enriched = sheet.equippedArmor;
  if (enriched && typeof enriched === "object") {
    const ea = enriched as Record<string, unknown>;
    const name = ea.name;
    const category = ea.category;
    const acFormula = ea.acFormula;
    if (
      typeof name === "string" &&
      typeof category === "string" &&
      acFormula && typeof acFormula === "object"
    ) {
      const formula = acFormula as Record<string, unknown>;
      armor = {
        name: name,
        category: category as EquippedArmorCategory,
        armorClass: {
          base: typeof formula.base === "number" ? formula.base : 10,
          addDexterityModifier: typeof formula.addDexterityModifier === "boolean" ? formula.addDexterityModifier : true,
          ...(typeof formula.dexterityModifierMax === "number" ? { dexterityModifierMax: formula.dexterityModifierMax } : {}),
        },
      };
    }
  }

  // 2. Fallback: look up armor from sheet.equipment.armor.name in catalog
  if (!armor) {
    const equip = sheet.equipment;
    if (equip && typeof equip === "object" && !Array.isArray(equip)) {
      const equipObj = equip as Record<string, unknown>;
      const armorObj = equipObj.armor;
      if (armorObj && typeof armorObj === "object") {
        const armorName = (armorObj as Record<string, unknown>).name;
        if (typeof armorName === "string") {
          const catalogEntry = lookupArmor(armorName);
          if (catalogEntry) {
            armor = {
              name: catalogEntry.name,
              category: catalogEntry.category,
              armorClass: { ...catalogEntry.acFormula },
            };
          }
        }
      }
    }
  }

  // Check pre-enriched equippedShield
  const enrichedShield = sheet.equippedShield;
  if (enrichedShield && typeof enrichedShield === "object") {
    const es = enrichedShield as Record<string, unknown>;
    if (typeof es.name === "string" && typeof es.armorClassBonus === "number") {
      shield = { name: es.name, armorClassBonus: es.armorClassBonus };
    }
  }

  // Fallback: look for shield in sheet.equipment.shield
  if (!shield) {
    const equip = sheet.equipment;
    if (equip && typeof equip === "object" && !Array.isArray(equip)) {
      const equipObj = equip as Record<string, unknown>;
      const shieldObj = equipObj.shield;
      if (shieldObj && typeof shieldObj === "object") {
        const shieldName = (shieldObj as Record<string, unknown>).name;
        if (typeof shieldName === "string") {
          shield = { name: shieldName, armorClassBonus: 2 }; // Standard shield +2 AC
        }
      }
    }
  }

  if (!armor && !shield) return undefined;
  return { armor, shield };
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
  const tempHP = combatantState?.hpTemp ?? 0;
  const armorClass = readNumber(sheet, 'armorClass') ?? readNumber(sheet, 'ac') ?? 10;
  const speed = readNumber(sheet, 'speed') ?? 30;
  
  // Parse optional fields
  const experiencePoints = readNumber(sheet, 'experiencePoints') ?? readNumber(sheet, 'xp') ?? 0;
  const featIds = readArray<string>(sheet, 'featIds') ?? readArray<string>(sheet, 'feats') ?? [];
  const resourcePools = extractResourcePools(readArray(sheet, 'resourcePools'));
  
  // Parse fighting style
  const fightingStyleRaw = readString(sheet, 'fightingStyle');
  const fightingStyle = fightingStyleRaw && isFightingStyleId(fightingStyleRaw) ? fightingStyleRaw : undefined;
  
  // Parse class ID
  const classId = readString(sheet, 'classId') ?? record.className?.toLowerCase();
  
  // Parse subclass info (e.g., "Open Hand" for Monk, "Champion" for Fighter)
  const subclass = readString(sheet, 'subclass');
  const subclassLevel = readNumber(sheet, 'subclassLevel') ?? undefined;

  // Parse multiclass class levels from sheet (if present)
  const rawClassLevels = readArray(sheet, 'classLevels');
  const classLevels = rawClassLevels
    ? (rawClassLevels as Array<Record<string, unknown>>)
        .filter((cl) => typeof cl.classId === "string" && typeof cl.level === "number")
        .map((cl) => ({
          classId: cl.classId as string,
          level: cl.level as number,
          ...(typeof cl.subclass === "string" ? { subclass: cl.subclass } : {}),
        }))
    : undefined;
  
  // Parse species and look up combat-relevant traits
  const speciesName = readString(sheet, 'species') ?? readString(sheet, 'race');
  const speciesTraits = speciesName ? getSpeciesTraits(speciesName) : undefined;
  
  // Conditions from combat state (not sheet)
  const conditions = combatantState ? extractConditions(combatantState.conditions) : [];

  // Merge species damage resistances with any already on the sheet
  const sheetResistances = readArray<string>(sheet, 'damageResistances') ?? [];
  const speciesResistances = speciesTraits?.damageResistances ?? [];
  const mergedResistances = [...new Set([...sheetResistances, ...speciesResistances])];

  // Extract equipped armor/shield so getAC() can detect when armor is worn
  const equipment = extractEquipment(sheet);

  // Derive armor training from class proficiencies (e.g., Wizard → no heavy armor)
  const armorTraining = classId ? getArmorTrainingForClass(classId) : undefined;

  // Parse new EM-M2/M3/M4 fields
  const asiChoices = readArray(sheet, 'asiChoices') as CharacterData['asiChoices'];
  const skillProficiencies = readArray<string>(sheet, 'skillProficiencies');
  const skillExpertise = readArray<string>(sheet, 'skillExpertise');
  const preparedSpells = readArray<string>(sheet, 'preparedSpells');
  const knownSpells = readArray<string>(sheet, 'knownSpells');

  const data: CharacterData = {
    id: combatantState?.id ?? record.id,  // Use combatant ID in combat context
    name: record.name,
    maxHP,
    currentHP,
    tempHP,
    armorClass,
    speed: speciesTraits?.speed ?? speed,
    abilityScores: new AbilityScores(abilityScores),
    level,
    characterClass: record.className ?? 'Fighter',
    classId: classId as CharacterData['classId'],
    subclass,
    subclassLevel,
    experiencePoints,
    resourcePools,
    featIds,
    fightingStyle,
    darkvisionRange: readNumber(sheet, 'darkvisionRange') ?? readNumber(sheet, 'darkvision') ?? speciesTraits?.darkvisionRange ?? 0,
    speciesDamageResistances: mergedResistances.length > 0 ? mergedResistances : undefined,
    speciesSaveAdvantages: speciesTraits?.saveAdvantages,
    equipment,
    armorTraining,
    classLevels: classLevels && classLevels.length > 0 ? classLevels : undefined,
    asiChoices: asiChoices && asiChoices.length > 0 ? asiChoices : undefined,
    skillProficiencies: skillProficiencies && skillProficiencies.length > 0 ? skillProficiencies : undefined,
    skillExpertise: skillExpertise && skillExpertise.length > 0 ? skillExpertise : undefined,
    preparedSpells: preparedSpells && preparedSpells.length > 0 ? preparedSpells : undefined,
    knownSpells: knownSpells && knownSpells.length > 0 ? knownSpells : undefined,
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
  const tempHP = combatantState?.hpTemp ?? 0;
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
    tempHP,
    armorClass,
    speed,
    abilityScores: new AbilityScores(abilityScores),
    challengeRating,
    experienceValue,
    damageResistances: readArray<string>(statBlock, 'damageResistances') ?? undefined,
    damageImmunities: readArray<string>(statBlock, 'damageImmunities') ?? undefined,
    damageVulnerabilities: readArray<string>(statBlock, 'damageVulnerabilities') ?? undefined,
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
  const tempHP = combatantState?.hpTemp ?? 0;
  const armorClass = readNumber(statBlock, 'armorClass') ?? readNumber(statBlock, 'ac') ?? 10;
  const speed = readNumber(statBlock, 'speed') ?? 30;
  const proficiencyBonus = readNumber(statBlock, 'proficiencyBonus') ?? undefined;
  const challengeRating = readNumber(statBlock, 'challengeRating') ?? readNumber(statBlock, 'cr') ?? undefined;
  const role = readString(statBlock, 'role');
  
  // Conditions from combat state
  const conditions = combatantState ? extractConditions(combatantState.conditions) : [];

  const data: NPCData = {
    id: combatantState?.id ?? record.id,  // Use combatant ID in combat context
    name: record.name,
    maxHP,
    currentHP,
    tempHP,
    armorClass,
    speed,
    abilityScores: new AbilityScores(abilityScores),
    proficiencyBonus,
    challengeRating,
    role,
    damageResistances: readArray<string>(statBlock, 'damageResistances') ?? undefined,
    damageImmunities: readArray<string>(statBlock, 'damageImmunities') ?? undefined,
    damageVulnerabilities: readArray<string>(statBlock, 'damageVulnerabilities') ?? undefined,
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
  hpTemp: number;
  conditions: string[];
} {
  return {
    hpCurrent: creature.getCurrentHP(),
    hpTemp: creature.getTempHP(),
    conditions: Array.from(creature.getConditions()),
  };
}
