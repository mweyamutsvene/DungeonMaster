import type { DiceRoller } from "./dice-roller.js";
import { d20Test, type D20TestResult, type RollMode } from "./advantage.js";
import type { Ability } from "../entities/core/ability-scores.js";
import type { Skill } from "../entities/core/skills.js";
import { getGoverningAbility } from "../entities/core/skills.js";
import type { Creature } from "../entities/creatures/creature.js";

export interface AbilityCheckOptions {
  dc: number;
  abilityModifier: number;
  proficiencyBonus?: number;
  proficient?: boolean;
  mode?: RollMode;
}

export function abilityCheck(
  diceRoller: DiceRoller,
  options: AbilityCheckOptions,
): D20TestResult {
  const proficiencyBonus = options.proficiencyBonus ?? 0;
  const proficient = options.proficient ?? false;

  if (!Number.isInteger(options.abilityModifier)) {
    throw new Error("Ability modifier must be an integer");
  }
  if (!Number.isInteger(proficiencyBonus) || proficiencyBonus < 0) {
    throw new Error("Proficiency bonus must be an integer >= 0");
  }

  const modifier = options.abilityModifier + (proficient ? proficiencyBonus : 0);
  return d20Test(diceRoller, options.dc, modifier, options.mode ?? "normal");
}

export interface SkillCheckOptions {
  dc: number;
  abilityModifiers: Readonly<Record<Ability, number>>;
  skill: Skill;
  proficiencyBonus?: number;
  proficient?: boolean;
  mode?: RollMode;
}

export function skillCheck(
  diceRoller: DiceRoller,
  options: SkillCheckOptions,
): D20TestResult {
  const ability = getGoverningAbility(options.skill);
  const abilityModifier = options.abilityModifiers[ability];

  if (!Number.isInteger(abilityModifier)) {
    throw new Error(`Missing/invalid ability modifier for ${ability}`);
  }

  return abilityCheck(diceRoller, {
    dc: options.dc,
    abilityModifier,
    proficiencyBonus: options.proficiencyBonus,
    proficient: options.proficient,
    mode: options.mode,
  });
}

export function savingThrow(
  diceRoller: DiceRoller,
  dc: number,
  abilityModifier: number,
  mode: RollMode = "normal",
): D20TestResult {
  return abilityCheck(diceRoller, { dc, abilityModifier, mode });
}

type D20ModeProvider = {
  getD20TestModeForAbility?: (ability: Ability, baseMode: RollMode) => RollMode;
};

function getAdjustedMode(creature: Creature, ability: Ability, baseMode: RollMode): RollMode {
  const maybe = creature as unknown as D20ModeProvider;
  if (typeof maybe.getD20TestModeForAbility !== "function") return baseMode;
  return maybe.getD20TestModeForAbility(ability, baseMode);
}

export interface CreatureAbilityCheckOptions {
  dc: number;
  ability: Ability;
  abilityModifier: number;
  proficiencyBonus?: number;
  proficient?: boolean;
  mode?: RollMode;
}

export function abilityCheckForCreature(
  diceRoller: DiceRoller,
  creature: Creature,
  options: CreatureAbilityCheckOptions,
): D20TestResult {
  const mode = getAdjustedMode(creature, options.ability, options.mode ?? "normal");
  return abilityCheck(diceRoller, {
    dc: options.dc,
    abilityModifier: options.abilityModifier,
    proficiencyBonus: options.proficiencyBonus,
    proficient: options.proficient,
    mode,
  });
}

export interface CreatureSkillCheckOptions {
  dc: number;
  abilityModifiers: Readonly<Record<Ability, number>>;
  skill: Skill;
  proficiencyBonus?: number;
  proficient?: boolean;
  mode?: RollMode;
}

export function skillCheckForCreature(
  diceRoller: DiceRoller,
  creature: Creature,
  options: CreatureSkillCheckOptions,
): D20TestResult {
  const ability = getGoverningAbility(options.skill);
  const mode = getAdjustedMode(creature, ability, options.mode ?? "normal");
  return skillCheck(diceRoller, {
    dc: options.dc,
    skill: options.skill,
    abilityModifiers: options.abilityModifiers,
    proficiencyBonus: options.proficiencyBonus,
    proficient: options.proficient,
    mode,
  });
}

export function savingThrowForCreature(
  diceRoller: DiceRoller,
  creature: Creature,
  dc: number,
  ability: Ability,
  abilityModifier: number,
  mode: RollMode = "normal",
): D20TestResult {
  return savingThrow(diceRoller, dc, abilityModifier, getAdjustedMode(creature, ability, mode));
}
