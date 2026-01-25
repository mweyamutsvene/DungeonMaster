/**
 * D&D 5e Saving Throw System
 * 
 * Handles saving throw calculations, rolls, and results.
 */

export type AbilityType = 'strength' | 'dexterity' | 'constitution' | 'intelligence' | 'wisdom' | 'charisma';

export interface SavingThrowParams {
  /** Creature making the save */
  creature: {
    abilityScores?: Record<string, number>;
    proficiencies?: string[];
    level?: number;
  };
  /** DC to beat */
  dc: number;
  /** Ability score to use for the save */
  ability: AbilityType;
  /** Roll with advantage */
  advantage?: boolean;
  /** Roll with disadvantage */
  disadvantage?: boolean;
}

export interface SavingThrowResult {
  /** Whether the save succeeded */
  success: boolean;
  /** The d20 roll(s) */
  rolls: number[];
  /** The chosen roll (after advantage/disadvantage) */
  roll: number;
  /** Total modifier added to the roll */
  modifier: number;
  /** Final total (roll + modifier) */
  total: number;
  /** DC that was being checked against */
  dc: number;
  /** Whether this was a critical success (natural 20) */
  criticalSuccess: boolean;
  /** Whether this was a critical failure (natural 1) */
  criticalFailure: boolean;
}

/**
 * Calculate ability modifier from ability score.
 * 
 * @param abilityScore - Ability score (typically 1-30)
 * @returns Modifier (-5 to +10 for standard range)
 */
export function getAbilityModifier(abilityScore: number): number {
  return Math.floor((abilityScore - 10) / 2);
}

/**
 * Calculate proficiency bonus based on character level.
 * 
 * @param level - Character level (1-20)
 * @returns Proficiency bonus (+2 to +6)
 */
export function getProficiencyBonus(level: number): number {
  return Math.floor((level - 1) / 4) + 2;
}

/**
 * Roll a d20 with optional advantage/disadvantage.
 * 
 * @param advantage - Roll twice, take higher
 * @param disadvantage - Roll twice, take lower
 * @returns Object with all rolls and the chosen roll
 */
export function rollD20(advantage?: boolean, disadvantage?: boolean): { rolls: number[]; chosenRoll: number } {
  const roll1 = Math.floor(Math.random() * 20) + 1;
  
  // Normal roll
  if (!advantage && !disadvantage) {
    return { rolls: [roll1], chosenRoll: roll1 };
  }
  
  // Advantage or disadvantage cancels to normal if both are present
  if (advantage && disadvantage) {
    return { rolls: [roll1], chosenRoll: roll1 };
  }
  
  const roll2 = Math.floor(Math.random() * 20) + 1;
  const rolls = [roll1, roll2];
  
  if (advantage) {
    return { rolls, chosenRoll: Math.max(roll1, roll2) };
  }
  
  // disadvantage
  return { rolls, chosenRoll: Math.min(roll1, roll2) };
}

/**
 * Make a saving throw.
 * 
 * @param params - Saving throw parameters
 * @returns Saving throw result
 */
export function makeSavingThrow(params: SavingThrowParams): SavingThrowResult {
  const { creature, dc, ability, advantage, disadvantage } = params;
  
  // Get ability score and calculate modifier
  const abilityScore = creature.abilityScores?.[ability] || 10;
  const abilityMod = getAbilityModifier(abilityScore);
  
  // Check for proficiency in this save
  const proficiencySaveKey = `${ability}_save`;
  const isProficient = creature.proficiencies?.includes(proficiencySaveKey) ?? false;
  
  // Calculate proficiency bonus if applicable
  const level = creature.level || 1;
  const profBonus = isProficient ? getProficiencyBonus(level) : 0;
  
  // Total modifier
  const modifier = abilityMod + profBonus;
  
  // Roll the d20
  const { rolls, chosenRoll } = rollD20(advantage, disadvantage);
  
  // Calculate total
  const total = chosenRoll + modifier;
  
  // Determine success/failure
  const success = total >= dc;
  const criticalSuccess = chosenRoll === 20;
  const criticalFailure = chosenRoll === 1;
  
  return {
    success,
    rolls,
    roll: chosenRoll,
    modifier,
    total,
    dc,
    criticalSuccess,
    criticalFailure,
  };
}

/**
 * Calculate save DC for a creature's ability.
 * Standard formula: 8 + proficiency bonus + ability modifier
 * 
 * @param level - Character level
 * @param abilityScore - Ability score for the DC (e.g., Wisdom for monk)
 * @returns Save DC
 */
export function calculateSaveDC(level: number, abilityScore: number): number {
  const profBonus = getProficiencyBonus(level);
  const abilityMod = getAbilityModifier(abilityScore);
  return 8 + profBonus + abilityMod;
}
