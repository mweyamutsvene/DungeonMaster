/**
 * Typed interfaces for raw JSON blobs stored in SQLite via Prisma.
 *
 * Prisma returns `sheet`, `statBlock`, `resources` etc. as `JsonValue`.
 * These interfaces + parsers provide a typed boundary for those blobs,
 * eliminating `as any` casts at the JSON parsing boundary.
 */
import { isRecord } from "./json-helpers.js";

/** Raw JSON shape of weapon/armor/shield equipment stored within a character sheet. */
export interface EquipmentJson {
  weapon?: { name?: string; properties?: string[] };
  armor?: { name?: string };
  shield?: { name?: string };
}

/** Raw JSON shape stored in the character's `sheet` column in SQLite. */
export interface CharacterSheet {
  abilityScores?: Record<string, number>;
  level?: number;
  /** Primary max HP field */
  maxHP?: number;
  /** Alternate max HP casing used by some callers */
  maxHp?: number;
  hitPoints?: number;
  /** Primary current HP field */
  currentHP?: number;
  /** Alternate current HP casing used by some callers */
  currentHp?: number;
  armorClass?: number;
  /** Alternate armor class abbreviation */
  ac?: number;
  speed?: number;
  proficiencyBonus?: number;
  experiencePoints?: number;
  xp?: number;
  featIds?: string[];
  /** Alternate feat ID list field name */
  feats?: string[];
  resourcePools?: unknown[];
  classId?: string;
  className?: string;
  skills?: Record<string, number>;
  size?: string;
  damageResistances?: string[];
  damageImmunities?: string[];
  damageVulnerabilities?: string[];
  equipment?: EquipmentJson;
  hitDiceRemaining?: number;
}

/** Raw JSON shape stored in the monster or NPC `statBlock` column in SQLite. */
export interface StatBlockJson {
  abilityScores?: Record<string, number>;
  maxHP?: number;
  hitPoints?: number;
  currentHP?: number;
  armorClass?: number;
  ac?: number;
  speed?: number;
  challengeRating?: number;
  cr?: number;
  experienceValue?: number;
  xp?: number;
  proficiencyBonus?: number;
  skills?: Record<string, number>;
  size?: string;
  damageResistances?: string[];
  damageImmunities?: string[];
  damageVulnerabilities?: string[];
  attacks?: unknown[];
  level?: number;
  role?: string;
}

/** Raw JSON shape for combatant resources stored in the encounter's combatant state. */
export interface CombatantResources {
  actionSpent?: boolean;
  reactionUsed?: boolean;
  disengaged?: boolean;
  bonusActionUsed?: boolean;
  dashed?: boolean;
  movementSpent?: boolean;
  attacksUsedThisTurn?: number;
  attacksAllowedThisTurn?: number;
  sneakAttackUsedThisTurn?: boolean;
  stunningStrikeUsedThisTurn?: boolean;
  rageAttackedThisTurn?: boolean;
  rageDamageTakenThisTurn?: boolean;
  lastMovePath?: unknown;
  cleaveUsedThisTurn?: boolean;
  nickUsedThisTurn?: boolean;
  loadingWeaponFiredThisTurn?: boolean;
  readiedAction?: unknown;
  position?: { x: number; y: number };
}

/** Parse an unknown value as a CharacterSheet. Returns empty object if not a plain object. */
export function parseCharacterSheet(v: unknown): CharacterSheet {
  if (!isRecord(v)) return {};
  return v as CharacterSheet;
}

/** Parse an unknown value as a StatBlockJson. Returns empty object if not a plain object. */
export function parseStatBlockJson(v: unknown): StatBlockJson {
  if (!isRecord(v)) return {};
  return v as StatBlockJson;
}

/** Parse an unknown value as CombatantResources. Returns empty object if not a plain object. */
export function parseCombatantResources(v: unknown): CombatantResources {
  if (!isRecord(v)) return {};
  return v as CombatantResources;
}
