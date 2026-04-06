import { describe, it, expect } from 'vitest';
import {
  makeDeathSave,
  applyDeathSaveResult,
  needsDeathSave,
  resetDeathSaves,
  takeDamageWhileUnconscious,
  attemptStabilize,
  type DeathSaves,
  type DeathSaveResult,
} from './death-saves.js';

describe('Death Saves', () => {
  describe('makeDeathSave', () => {
    it('should succeed on roll >= 10', () => {
      const current: DeathSaves = { successes: 0, failures: 0 };
      const result = makeDeathSave(10, current);
      expect(result.outcome).toBe('success');
      expect((result as any).criticalSuccess).toBe(false);
    });

    it('should fail on roll < 10', () => {
      const current: DeathSaves = { successes: 0, failures: 0 };
      const result = makeDeathSave(9, current);
      expect(result.outcome).toBe('failure');
      expect((result as any).criticalFailure).toBe(false);
    });

    it('should critical success on natural 20 (regain 1 HP)', () => {
      const current: DeathSaves = { successes: 2, failures: 2 };
      const result = makeDeathSave(20, current);
      expect(result.outcome).toBe('success');
      expect((result as any).criticalSuccess).toBe(true);
      expect((result as any).hpRestored).toBe(1);
    });

    it('should critical fail on natural 1 (2 failures)', () => {
      const current: DeathSaves = { successes: 1, failures: 0 };
      const result = makeDeathSave(1, current);
      expect(result.outcome).toBe('failure');
      expect((result as any).criticalFailure).toBe(true);
      expect((result as any).failuresAdded).toBe(2);
    });

    it('should stabilize on 3rd success', () => {
      const current: DeathSaves = { successes: 2, failures: 1 };
      const result = makeDeathSave(15, current);
      expect(result.outcome).toBe('stabilized');
    });

    it('should die on 3rd failure', () => {
      const current: DeathSaves = { successes: 1, failures: 2 };
      const result = makeDeathSave(5, current);
      expect(result.outcome).toBe('dead');
    });

    it('should die immediately on natural 1 if already at 1 failure', () => {
      const current: DeathSaves = { successes: 0, failures: 1 };
      const result = makeDeathSave(1, current);
      expect(result.outcome).toBe('dead');
    });
  });

  describe('applyDeathSaveResult', () => {
    it('should increment successes on normal success', () => {
      const current: DeathSaves = { successes: 1, failures: 0 };
      const result: DeathSaveResult = { outcome: 'success', criticalSuccess: false };
      const updated = applyDeathSaveResult(current, result);
      expect(updated.successes).toBe(2);
      expect(updated.failures).toBe(0);
    });

    it('should increment failures on normal failure', () => {
      const current: DeathSaves = { successes: 0, failures: 1 };
      const result: DeathSaveResult = { outcome: 'failure', criticalFailure: false };
      const updated = applyDeathSaveResult(current, result);
      expect(updated.successes).toBe(0);
      expect(updated.failures).toBe(2);
    });

    it('should add 2 failures on critical failure', () => {
      const current: DeathSaves = { successes: 1, failures: 0 };
      const result: DeathSaveResult = { outcome: 'failure', criticalFailure: true, failuresAdded: 2 };
      const updated = applyDeathSaveResult(current, result);
      expect(updated.failures).toBe(2);
    });

    it('should reset on critical success', () => {
      const current: DeathSaves = { successes: 2, failures: 2 };
      const result: DeathSaveResult = { outcome: 'success', criticalSuccess: true, hpRestored: 1 };
      const updated = applyDeathSaveResult(current, result);
      expect(updated.successes).toBe(0);
      expect(updated.failures).toBe(0);
    });
  });

  describe('needsDeathSave', () => {
    it('should return true when at 0 HP and not stabilized', () => {
      expect(needsDeathSave(0, { successes: 1, failures: 1 }, false)).toBe(true);
    });

    it('should return false when above 0 HP', () => {
      expect(needsDeathSave(1, { successes: 0, failures: 0 }, false)).toBe(false);
    });

    it('should return false when stabilized', () => {
      expect(needsDeathSave(0, { successes: 3, failures: 0 }, true)).toBe(false);
    });

    it('should return false when at 3 successes', () => {
      expect(needsDeathSave(0, { successes: 3, failures: 0 }, false)).toBe(false);
    });
  });

  describe('takeDamageWhileUnconscious', () => {
    it('should add 1 failure for normal damage', () => {
      const current: DeathSaves = { successes: 0, failures: 1 };
      const result = takeDamageWhileUnconscious(current, 5, false, 20);
      expect(result.deathSaves.failures).toBe(2);
      expect(result.instantDeath).toBe(false);
    });

    it('should add 2 failures for critical hit', () => {
      const current: DeathSaves = { successes: 1, failures: 0 };
      const result = takeDamageWhileUnconscious(current, 8, true, 20);
      expect(result.deathSaves.failures).toBe(2);
      expect(result.instantDeath).toBe(false);
    });

    it('should cause instant death if damage >= max HP', () => {
      const current: DeathSaves = { successes: 0, failures: 0 };
      const result = takeDamageWhileUnconscious(current, 25, false, 20);
      expect(result.instantDeath).toBe(true);
    });

    it('should cause instant death if failures reach 3', () => {
      const current: DeathSaves = { successes: 0, failures: 2 };
      const result = takeDamageWhileUnconscious(current, 5, false, 20);
      expect(result.deathSaves.failures).toBe(3);
      expect(result.instantDeath).toBe(true);
    });
  });

  describe('resetDeathSaves', () => {
    it('should return fresh death saves', () => {
      const reset = resetDeathSaves();
      expect(reset.successes).toBe(0);
      expect(reset.failures).toBe(0);
    });
  });

  describe('attemptStabilize', () => {
    it('should succeed on check total of exactly 10 (meets DC)', () => {
      const result = attemptStabilize(10);
      expect(result.success).toBe(true);
      expect(result.checkTotal).toBe(10);
      expect(result.dc).toBe(10);
    });

    it('should fail on check total of 9 (below DC)', () => {
      const result = attemptStabilize(9);
      expect(result.success).toBe(false);
      expect(result.checkTotal).toBe(9);
      expect(result.dc).toBe(10);
    });

    it('should succeed on high check total', () => {
      const result = attemptStabilize(20);
      expect(result.success).toBe(true);
      expect(result.checkTotal).toBe(20);
      expect(result.dc).toBe(10);
    });

    it('should always have DC 10', () => {
      expect(attemptStabilize(1).dc).toBe(10);
      expect(attemptStabilize(15).dc).toBe(10);
      expect(attemptStabilize(25).dc).toBe(10);
    });
  });
});
