/**
 * Tests for Monk ability executors
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AbilityRegistry } from './ability-registry.js';
import { 
  PatientDefenseExecutor, 
  StepOfTheWindExecutor, 
  MartialArtsExecutor 
} from './executors/index.js';
import type { AbilityExecutionContext } from '../../../../domain/abilities/ability-executor.js';

describe('Monk Ability Executors', () => {
  let registry: AbilityRegistry;

  // Helper to create mock combat for Phase 3 features
  const createMockCombat = () => ({
    getMovementState: vi.fn().mockReturnValue(undefined),
    getPosition: vi.fn().mockReturnValue({ x: 0, y: 0 }),
    initializeMovementState: vi.fn(),
    setJumpMultiplier: vi.fn(),
    hasUsedAction: vi.fn().mockReturnValue(true), // For Martial Arts
  });

  const createMockActor = () => ({
    getId: () => 'test-actor-1',
    getSpeed: () => 30,
  });

  beforeEach(() => {
    registry = new AbilityRegistry();
    registry.register(new PatientDefenseExecutor());
    registry.register(new StepOfTheWindExecutor());
    registry.register(new MartialArtsExecutor());
  });

  describe('PatientDefenseExecutor', () => {
    it('should match class:monk:patient-defense', () => {
      const executor = registry.findExecutor('class:monk:patient-defense');
      expect(executor).toBeInstanceOf(PatientDefenseExecutor);
    });

    it('should match LLM-friendly "Patient Defense"', () => {
      const executor = registry.findExecutor('Patient Defense');
      expect(executor).toBeInstanceOf(PatientDefenseExecutor);
    });

    it('should match legacy patient_defense', () => {
      const executor = registry.findExecutor('patient_defense');
      expect(executor).toBeInstanceOf(PatientDefenseExecutor);
    });

    it('should execute dodge action and spend ki', async () => {
      const mockDodge = vi.fn().mockResolvedValue({ actor: {} });

      const context: AbilityExecutionContext = {
        sessionId: 'test-session',
        encounterId: 'test-encounter',
        actor: {} as any,
        combat: {} as any,
        abilityId: 'patient_defense',
        params: {
          actor: { type: 'Character', characterId: 'monk-123' },
          resources: {
            resourcePools: [{ name: 'ki', current: 3, max: 5 }],
          },
        },
        services: {
          dodge: mockDodge,
        },
      };

      const result = await registry.execute(context);

      expect(result.success).toBe(true);
      expect(result.summary).toContain('Patient Defense');
      expect(result.summary).toContain('1 ki');
      expect(result.data?.kiSpent).toBe(1);
      expect(mockDodge).toHaveBeenCalledWith({
        encounterId: 'test-encounter',
        actor: { type: 'Character', characterId: 'monk-123' },
      });
    });

    it('should fail gracefully without dodge service', async () => {
      const context: AbilityExecutionContext = {
        sessionId: 'test-session',
        encounterId: 'test-encounter',
        actor: {} as any,
        combat: {} as any,
        abilityId: 'patient_defense',
        params: {
          actor: { type: 'Character', characterId: 'monk-123' },
        },
        services: {},
      };

      const result = await registry.execute(context);

      expect(result.success).toBe(false);
      expect(result.error).toBe('MISSING_SERVICE');
    });

    it('should fail when out of ki points', async () => {
      const mockDodge = vi.fn().mockResolvedValue({ actor: {} });

      const context: AbilityExecutionContext = {
        sessionId: 'test-session',
        encounterId: 'test-encounter',
        actor: {} as any,
        combat: {} as any,
        abilityId: 'patient_defense',
        params: {
          actor: { type: 'Character', characterId: 'monk-123' },
          resources: {
            resourcePools: [{ name: 'ki', current: 0, max: 5 }],
          },
        },
        services: {
          dodge: mockDodge,
        },
      };

      const result = await registry.execute(context);

      expect(result.success).toBe(false);
      expect(result.error).toBe('INSUFFICIENT_KI');
      expect(result.summary).toContain('Insufficient ki');
      expect(mockDodge).not.toHaveBeenCalled();
    });
  });

  describe('StepOfTheWindExecutor', () => {
    it('should match class:monk:step-of-the-wind', () => {
      const executor = registry.findExecutor('class:monk:step-of-the-wind');
      expect(executor).toBeInstanceOf(StepOfTheWindExecutor);
    });

    it('should match LLM-friendly "Step of the Wind"', () => {
      const executor = registry.findExecutor('Step of the Wind');
      expect(executor).toBeInstanceOf(StepOfTheWindExecutor);
    });

    it('should match legacy step_of_the_wind', () => {
      const executor = registry.findExecutor('step_of_the_wind');
      expect(executor).toBeInstanceOf(StepOfTheWindExecutor);
    });

    it.skip('should execute disengage with choice param', async () => {
      const mockDisengage = vi.fn().mockResolvedValue({ actor: {} });
      const mockCombat = createMockCombat();

      const context: AbilityExecutionContext = {
        sessionId: 'test-session',
        encounterId: 'test-encounter',
        actor: createMockActor() as any,
        combat: mockCombat as any,
        abilityId: 'step_of_the_wind',
        params: {
          actor: { type: 'Character', characterId: 'monk-123' },
          choice: 'disengage',
          resources: {
            resourcePools: [{ name: 'ki', current: 3, max: 5 }],
          },
        },
        services: {
          disengage: mockDisengage,
        },
      };

      const result = await registry.execute(context);

      expect(result.success).toBe(true);
      expect(result.summary).toContain('Step of the Wind');
      expect(result.summary).toContain('Disengaged');
      expect(result.summary).toContain('1 ki');
      expect(result.summary).toContain('jump distance doubled');
      expect(result.data?.kiSpent).toBe(1);
      expect(result.data?.jumpDoubled).toBe(true);
      expect(mockDisengage).toHaveBeenCalled();
      expect(mockCombat.setJumpMultiplier).toHaveBeenCalledWith('test-actor-1', 2);
    });

    it.skip('should execute dash with choice param', async () => {
      const mockDash = vi.fn().mockResolvedValue({ actor: {} });
      const mockCombat = createMockCombat();

      const context: AbilityExecutionContext = {
        sessionId: 'test-session',
        encounterId: 'test-encounter',
        actor: createMockActor() as any,
        combat: mockCombat as any,
        abilityId: 'step_of_the_wind',
        params: {
          actor: { type: 'Character', characterId: 'monk-123' },
          choice: 'dash',
          resources: {
            resourcePools: [{ name: 'ki', current: 3, max: 5 }],
          },
        },
        services: {
          dash: mockDash,
        },
      };

      const result = await registry.execute(context);

      expect(result.success).toBe(true);
      expect(result.summary).toContain('Step of the Wind');
      expect(result.summary).toContain('Dashed');
      expect(result.summary).toContain('1 ki');
      expect(result.summary).toContain('jump distance doubled');
      expect(result.data?.kiSpent).toBe(1);
      expect(result.data?.jumpDoubled).toBe(true);
      expect(mockDash).toHaveBeenCalled();
    });

    it.skip('should infer disengage from ability ID', async () => {
      const mockDisengage = vi.fn().mockResolvedValue({ actor: {} });
      const mockCombat = createMockCombat();

      const context: AbilityExecutionContext = {
        sessionId: 'test-session',
        encounterId: 'test-encounter',
        actor: createMockActor() as any,
        combat: mockCombat as any,
        abilityId: 'step_of_the_wind_disengage',
        params: {
          actor: { type: 'Character', characterId: 'monk-123' },
          resources: {
            resourcePools: [{ name: 'ki', current: 3, max: 5 }],
          },
        },
        services: {
          disengage: mockDisengage,
        },
      };

      const result = await registry.execute(context);

      expect(result.success).toBe(true);
      expect(result.data?.choice).toBe('disengage');
      expect(mockDisengage).toHaveBeenCalled();
    });

    it.skip('should default to disengage if ambiguous', async () => {
      const mockDisengage = vi.fn().mockResolvedValue({ actor: {} });
      const mockCombat = createMockCombat();

      const context: AbilityExecutionContext = {
        sessionId: 'test-session',
        encounterId: 'test-encounter',
        actor: createMockActor() as any,
        combat: mockCombat as any,
        abilityId: 'step_of_the_wind',
        params: {
          actor: { type: 'Character', characterId: 'monk-123' },
          resources: {
            resourcePools: [{ name: 'ki', current: 3, max: 5 }],
          },
        },
        services: {
          disengage: mockDisengage,
          dash: vi.fn(),
        },
      };

      const result = await registry.execute(context);

      expect(result.success).toBe(true);
      expect(result.data?.choice).toBe('disengage');
      expect(mockDisengage).toHaveBeenCalled();
    });
  });

  describe('MartialArtsExecutor', () => {
    it('should match class:monk:martial-arts', () => {
      const executor = registry.findExecutor('class:monk:martial-arts');
      expect(executor).toBeInstanceOf(MartialArtsExecutor);
    });

    it('should match LLM-friendly "Martial Arts"', () => {
      const executor = registry.findExecutor('Martial Arts');
      expect(executor).toBeInstanceOf(MartialArtsExecutor);
    });

    it('should match legacy martial_arts', () => {
      const executor = registry.findExecutor('martial_arts');
      expect(executor).toBeInstanceOf(MartialArtsExecutor);
    });

    it('should execute bonus unarmed strike after attack', async () => {
      const mockAttack = vi.fn().mockResolvedValue({
        result: {
          success: true,
          damage: 6,
        },
      });
      const mockCombat = createMockCombat();

      const context: AbilityExecutionContext = {
        sessionId: 'test-session',
        encounterId: 'test-encounter',
        actor: createMockActor() as any,
        combat: mockCombat as any,
        abilityId: 'martial_arts',
        params: {
          actor: { type: 'Character', characterId: 'monk-123' },
          target: { type: 'Monster', monsterId: 'goblin-456' },
          targetName: 'Goblin',
        },
        services: {
          attack: mockAttack,
        },
      };

      const result = await registry.execute(context);

      expect(result.success).toBe(true);
      expect(result.summary).toContain('Martial Arts');
      expect(result.summary).toContain('Goblin');
      expect(result.summary).toContain('6 damage');
      expect(mockAttack).toHaveBeenCalledWith({
        encounterId: 'test-encounter',
        actor: { type: 'Character', characterId: 'monk-123' },
        target: { type: 'Monster', monsterId: 'goblin-456' },
        attackType: 'unarmed',
      });
    });

    it('should handle missed attacks', async () => {
      const mockAttack = vi.fn().mockResolvedValue({
        result: {
          success: false,
        },
      });
      const mockCombat = createMockCombat();

      const context: AbilityExecutionContext = {
        sessionId: 'test-session',
        encounterId: 'test-encounter',
        actor: createMockActor() as any,
        combat: mockCombat as any,
        abilityId: 'martial_arts',
        params: {
          actor: { type: 'Character', characterId: 'monk-123' },
          target: { type: 'Monster', monsterId: 'goblin-456' },
          targetName: 'Goblin',
        },
        services: {
          attack: mockAttack,
        },
      };

      const result = await registry.execute(context);

      expect(result.success).toBe(true);
      expect(result.summary).toContain('missed');
    });

    it('should fail gracefully without target', async () => {
      const context: AbilityExecutionContext = {
        sessionId: 'test-session',
        encounterId: 'test-encounter',
        actor: {} as any,
        combat: {} as any,
        abilityId: 'martial_arts',
        params: {
          actor: { type: 'Character', characterId: 'monk-123' },
        },
        services: {
          attack: vi.fn(),
        },
      };

      const result = await registry.execute(context);

      expect(result.success).toBe(false);
      expect(result.error).toBe('MISSING_TARGET');
    });
  });
});
