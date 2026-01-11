/**
 * Death saving throw mechanics for D&D 5e
 * When a character drops to 0 HP, they make death saves each turn
 */

export interface DeathSaves {
  successes: number; // 0-3
  failures: number;  // 0-3
}

export type DeathSaveResult = 
  | { outcome: 'success'; criticalSuccess: false }
  | { outcome: 'success'; criticalSuccess: true; hpRestored: 1 }
  | { outcome: 'failure'; criticalFailure: false }
  | { outcome: 'failure'; criticalFailure: true; failuresAdded: 2 }
  | { outcome: 'stabilized' }
  | { outcome: 'dead' };

/**
 * Make a death saving throw (d20)
 * - DC 10 to succeed
 * - Natural 20: regain 1 HP and become conscious
 * - Natural 1: counts as 2 failures
 * - 3 successes: stabilized (unconscious but no more saves needed)
 * - 3 failures: dead
 */
export function makeDeathSave(roll: number, current: DeathSaves): DeathSaveResult {
  // Natural 20: critical success, regain 1 HP
  if (roll === 20) {
    return { outcome: 'success', criticalSuccess: true, hpRestored: 1 };
  }

  // Natural 1: critical failure, counts as 2 failures
  if (roll === 1) {
    const newFailures = Math.min(current.failures + 2, 3);
    if (newFailures >= 3) {
      return { outcome: 'dead' };
    }
    return { outcome: 'failure', criticalFailure: true, failuresAdded: 2 };
  }

  // DC 10 check
  if (roll >= 10) {
    // Success
    const newSuccesses = current.successes + 1;
    if (newSuccesses >= 3) {
      return { outcome: 'stabilized' };
    }
    return { outcome: 'success', criticalSuccess: false };
  } else {
    // Failure
    const newFailures = current.failures + 1;
    if (newFailures >= 3) {
      return { outcome: 'dead' };
    }
    return { outcome: 'failure', criticalFailure: false };
  }
}

/**
 * Apply death save result to current death saves
 */
export function applyDeathSaveResult(
  current: DeathSaves,
  result: DeathSaveResult
): DeathSaves {
  if (result.outcome === 'dead' || result.outcome === 'stabilized') {
    return current; // No change to counters, handled by caller
  }

  if (result.outcome === 'success') {
    if (result.criticalSuccess) {
      // Critical success - counters reset (handled by HP restoration)
      return { successes: 0, failures: 0 };
    }
    return {
      ...current,
      successes: Math.min(current.successes + 1, 3),
    };
  }

  if (result.outcome === 'failure') {
    const failuresToAdd = result.criticalFailure ? 2 : 1;
    return {
      ...current,
      failures: Math.min(current.failures + failuresToAdd, 3),
    };
  }

  return current;
}

/**
 * Check if a combatant needs to make death saves
 * (unconscious with 0 HP and not stabilized)
 */
export function needsDeathSave(
  hpCurrent: number,
  deathSaves: DeathSaves | null,
  isStabilized: boolean
): boolean {
  return hpCurrent === 0 && !isStabilized && (deathSaves === null || deathSaves.successes < 3);
}

/**
 * Reset death saves (when HP restored above 0)
 */
export function resetDeathSaves(): DeathSaves {
  return { successes: 0, failures: 0 };
}

/**
 * Taking damage while at 0 HP causes automatic death save failure
 * Massive damage (crit while unconscious) = instant death
 */
export function takeDamageWhileUnconscious(
  current: DeathSaves,
  damage: number,
  isCritical: boolean,
  maxHp: number
): { deathSaves: DeathSaves; instantDeath: boolean } {
  // Massive damage = instant death (damage >= max HP)
  if (damage >= maxHp) {
    return { deathSaves: current, instantDeath: true };
  }

  // Critical hit = 2 failures
  const failuresToAdd = isCritical ? 2 : 1;
  const newFailures = Math.min(current.failures + failuresToAdd, 3);

  return {
    deathSaves: { ...current, failures: newFailures },
    instantDeath: newFailures >= 3,
  };
}
