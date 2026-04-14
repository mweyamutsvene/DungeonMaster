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
      if (result.outcome === 'success') {
        expect(result.criticalSuccess).toBe(false);
      }
    });

    it('should fail on roll < 10', () => {
      const current: DeathSaves = { successes: 0, failures: 0 };
      const result = makeDeathSave(9, current);
      expect(result.outcome).toBe('failure');
      if (result.outcome === 'failure') {
        expect(result.criticalFailure).toBe(false);
      }
    });

    it('should critical success on natural 20 (regain 1 HP)', () => {
      const current: DeathSaves = { successes: 2, failures: 2 };
      const result = makeDeathSave(20, current);
      expect(result.outcome).toBe('success');
      if (result.outcome === 'success') {
        expect(result.criticalSuccess).toBe(true);
        if (result.criticalSuccess === true) {
          expect(result.hpRestored).toBe(1);
        }
      }
    });

    it('should critical fail on natural 1 (2 failures)', () => {
      const current: DeathSaves = { successes: 1, failures: 0 };
      const result = makeDeathSave(1, current);
      expect(result.outcome).toBe('failure');
      if (result.outcome === 'failure') {
        expect(result.criticalFailure).toBe(true);
        if (result.criticalFailure === true) {
          expect(result.failuresAdded).toBe(2);
        }
      }
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
    // Helper: mock DiceRoller that returns a fixed d20 result
    function mockRoller(d20Result: number) {
      return {
        d20: (mod = 0) => ({ total: d20Result + mod, rolls: [d20Result] }),
        rollDie: (_sides: number, _count = 1, mod = 0) => ({
          total: d20Result + mod,
          rolls: [d20Result],
        }),
      };
    }

    it('should succeed when Medicine check total meets DC 10 exactly', () => {
      // WIS mod=0, prof=0, roll=10 → total=10
      const result = attemptStabilize(0, 0, mockRoller(10));
      expect(result.success).toBe(true);
      expect(result.roll).toBe(10);
      expect(result.dc).toBe(10);
    });

    it('should fail when Medicine check total is below DC 10', () => {
      // WIS mod=0, prof=0, roll=9 → total=9
      const result = attemptStabilize(0, 0, mockRoller(9));
      expect(result.success).toBe(false);
      expect(result.roll).toBe(9);
      expect(result.dc).toBe(10);
    });

    it('should add WIS modifier and proficiency bonus to the roll', () => {
      // WIS mod=3, prof=2, roll=8 → total=13 (success)
      const result = attemptStabilize(3, 2, mockRoller(8));
      expect(result.success).toBe(true);
      expect(result.roll).toBe(13);
      expect(result.dc).toBe(10);
    });

    it('should always have DC 10', () => {
      expect(attemptStabilize(0, 0, mockRoller(1)).dc).toBe(10);
      expect(attemptStabilize(0, 0, mockRoller(15)).dc).toBe(10);
      expect(attemptStabilize(5, 3, mockRoller(10)).dc).toBe(10);
    });

    // RULES-L4: tests with a competent healer (WIS mod=2, prof=2)
    it('should succeed when healer has WIS mod=2 and prof=2 and rolls 10 (total 14)', () => {
      // 10 + 2 + 2 = 14 >= DC 10
      const result = attemptStabilize(2, 2, mockRoller(10));
      expect(result.success).toBe(true);
      expect(result.roll).toBe(14);
    });

    it('should fail when healer has WIS mod=2 and prof=2 but rolls only 5 (total 9)', () => {
      // 5 + 2 + 2 = 9 < DC 10
      const result = attemptStabilize(2, 2, mockRoller(5));
      expect(result.success).toBe(false);
      expect(result.roll).toBe(9);
    });
  });
});
