/**
 * Pure functions for applying modifiers to dice rolls in tabletop combat flow.
 * These functions handle initiative, attack, and damage calculations with full transparency.
 */

export type Modifier = {
  source: string;    // "Dexterity", "Proficiency", "Magic Weapon", etc.
  value: number;     // Modifier value (can be negative)
};

export type ModifierResult = {
  rawRoll: number | number[];  // Original die roll(s)
  chosenRoll?: number;          // For advantage/disadvantage scenarios
  modifiers: Modifier[];
  total: number;
};

export type AttackModifierResult = ModifierResult & {
  advantage?: boolean;
  disadvantage?: boolean;
};

export type DamageModifierResult = ModifierResult & {
  damageType: string;
  criticalHit?: boolean;
};

export type DamageSpec = {
  diceCount: number;
  diceSides: number;
  damageType: string;
};

/**
 * Apply initiative modifiers to a raw d20 roll.
 * Initiative = d20 + DEX modifier + other bonuses
 */
export function applyInitiativeModifiers(input: {
  rawRoll: number;
  dexterityModifier: number;
  otherBonuses?: number;
}): ModifierResult {
  const modifiers: Modifier[] = [];

  if (input.dexterityModifier !== 0) {
    modifiers.push({
      source: 'Dexterity',
      value: input.dexterityModifier,
    });
  }

  if (input.otherBonuses) {
    modifiers.push({
      source: 'Other Bonuses',
      value: input.otherBonuses,
    });
  }

  const total = input.rawRoll + 
    input.dexterityModifier + 
    (input.otherBonuses ?? 0);

  return {
    rawRoll: input.rawRoll,
    modifiers,
    total,
  };
}

/**
 * Apply attack roll modifiers with advantage/disadvantage handling.
 * Attack = d20 (or best/worst of 2d20) + attack bonus
 */
export function applyAttackModifiers(input: {
  rawRoll: number | number[];  // Single or advantage/disadvantage (2d20)
  attackBonus: number;
  proficiencyBonus?: number;
  abilityModifier?: number;
  situationalBonuses?: number[];
  advantage?: boolean;
  disadvantage?: boolean;
}): AttackModifierResult {
  const modifiers: Modifier[] = [];
  
  // Determine which roll to use
  let chosenRoll: number;
  if (Array.isArray(input.rawRoll)) {
    if (input.rawRoll.length !== 2) {
      throw new Error('Advantage/disadvantage requires exactly 2 rolls');
    }
    
    if (input.advantage && input.disadvantage) {
      // Cancels out - use first roll
      chosenRoll = input.rawRoll[0];
    } else if (input.advantage) {
      chosenRoll = Math.max(...input.rawRoll);
    } else if (input.disadvantage) {
      chosenRoll = Math.min(...input.rawRoll);
    } else {
      // Multiple rolls but no advantage/disadvantage - use first
      chosenRoll = input.rawRoll[0];
    }
  } else {
    chosenRoll = input.rawRoll;
  }

  // Attack bonus typically includes proficiency + ability modifier
  if (input.attackBonus !== 0) {
    modifiers.push({
      source: 'Attack Bonus',
      value: input.attackBonus,
    });
  }

  // Optional: break down attack bonus into components
  if (input.proficiencyBonus !== undefined && input.proficiencyBonus !== 0) {
    modifiers.push({
      source: 'Proficiency',
      value: input.proficiencyBonus,
    });
  }

  if (input.abilityModifier !== undefined && input.abilityModifier !== 0) {
    modifiers.push({
      source: 'Ability Modifier',
      value: input.abilityModifier,
    });
  }

  // Situational bonuses (magic weapon, spell buffs, etc.)
  if (input.situationalBonuses) {
    input.situationalBonuses.forEach((bonus, i) => {
      if (bonus !== 0) {
        modifiers.push({
          source: `Situational Bonus ${i + 1}`,
          value: bonus,
        });
      }
    });
  }

  const totalModifier = modifiers.reduce((sum, mod) => sum + mod.value, 0);
  const total = chosenRoll + totalModifier;

  return {
    rawRoll: input.rawRoll,
    chosenRoll: Array.isArray(input.rawRoll) ? chosenRoll : undefined,
    modifiers,
    total,
    advantage: input.advantage,
    disadvantage: input.disadvantage,
  };
}

/**
 * Apply damage modifiers to a raw damage roll.
 * Damage = dice roll + ability modifier + other bonuses (x2 for critical hits)
 */
export function applyDamageModifiers(input: {
  rawRoll: number;
  weaponDamage: DamageSpec;
  abilityModifier: number;
  criticalHit?: boolean;
  feats?: string[];
  situationalBonuses?: number;
}): DamageModifierResult {
  const modifiers: Modifier[] = [];

  // Ability modifier always applies to damage
  if (input.abilityModifier !== 0) {
    modifiers.push({
      source: 'Ability Modifier',
      value: input.abilityModifier,
    });
  }

  // Situational bonuses
  if (input.situationalBonuses) {
    modifiers.push({
      source: 'Situational Bonus',
      value: input.situationalBonuses,
    });
  }

  let total = input.rawRoll + 
    input.abilityModifier + 
    (input.situationalBonuses ?? 0);

  // Critical hit doubles the dice roll (not the modifiers)
  if (input.criticalHit) {
    total += input.rawRoll; // Add raw roll again (doubles it)
    modifiers.push({
      source: 'Critical Hit',
      value: input.rawRoll, // Show the doubling as a modifier
    });
  }

  return {
    rawRoll: input.rawRoll,
    modifiers,
    total,
    damageType: input.weaponDamage.damageType,
    criticalHit: input.criticalHit,
  };
}

/**
 * Calculate ability modifier from ability score.
 * Modifier = floor((score - 10) / 2)
 */
export function calculateAbilityModifier(abilityScore: number): number {
  return Math.floor((abilityScore - 10) / 2);
}

/**
 * Calculate proficiency bonus from character level.
 * Proficiency Bonus = ceil(level / 4) + 1
 */
export function calculateProficiencyBonus(level: number): number {
  return Math.ceil(level / 4) + 1;
}

/**
 * Check if attack roll is a critical hit (natural 20).
 */
export function isCriticalHit(roll: number | number[]): boolean {
  const actualRoll = Array.isArray(roll) ? Math.max(...roll) : roll;
  return actualRoll === 20;
}

/**
 * Check if attack roll is a critical miss (natural 1).
 */
export function isCriticalMiss(roll: number | number[]): boolean {
  const actualRoll = Array.isArray(roll) ? Math.min(...roll) : roll;
  return actualRoll === 1;
}
