/**
 * Tests for Goblin ability executors: Nimble Escape
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AbilityRegistry } from './ability-registry.js';
import { NimbleEscapeExecutor } from './executors/index.js';
import type { AbilityExecutionContext } from '../../../../domain/abilities/ability-executor.js';

describe('Goblin Ability Executors', () => {
  let registry: AbilityRegistry;

  beforeEach(() => {
    registry = new AbilityRegistry();
    registry.register(new NimbleEscapeExecutor());
  });

  describe('NimbleEscapeExecutor', () => {
    it('should match monster:bonus:nimble-escape', () => {
      const executor = registry.findExecutor('monster:bonus:nimble-escape');
      expect(executor).toBeInstanceOf(NimbleEscapeExecutor);
    });

    it('should match LLM-friendly "Nimble Escape"', () => {
      const executor = registry.findExecutor('Nimble Escape');
      expect(executor).toBeInstanceOf(NimbleEscapeExecutor);
    });

    it('should match legacy nimble_escape_disengage', () => {
      const executor = registry.findExecutor('nimble_escape_disengage');
      expect(executor).toBeInstanceOf(NimbleEscapeExecutor);
    });

    it('should match legacy nimble_escape_hide', () => {
      const executor = registry.findExecutor('nimble_escape_hide');
      expect(executor).toBeInstanceOf(NimbleEscapeExecutor);
    });

    it('should execute Disengage when choice is "disengage"', async () => {
      const mockDisengage = vi.fn().mockResolvedValue({ success: true });

      const context: AbilityExecutionContext = {
        sessionId: 'test-session',
        encounterId: 'test-encounter',
        actor: { id: 'goblin-123', name: 'Sneaky Goblin' } as any,
        combat: {} as any,
        abilityId: 'nimble_escape_disengage',
        params: {
          actor: { type: 'Monster', monsterId: 'goblin-123' },
          choice: 'disengage',
        },
        services: {
          disengage: mockDisengage,
          hide: vi.fn(),
        },
      };

      const result = await registry.execute(context);

      expect(result.success).toBe(true);
      expect(result.summary).toContain('Nimble Escape');
      expect(result.summary).toContain('Disengage');
      expect(mockDisengage).toHaveBeenCalledWith({
        encounterId: 'test-encounter',
        actor: { type: 'Monster', monsterId: 'goblin-123' },
      });
    });

    it('should execute Hide when choice is "hide"', async () => {
      const mockHide = vi.fn().mockResolvedValue({ success: true });

      const context: AbilityExecutionContext = {
        sessionId: 'test-session',
        encounterId: 'test-encounter',
        actor: { id: 'goblin-123', name: 'Sneaky Goblin' } as any,
        combat: {} as any,
        abilityId: 'nimble_escape_hide',
        params: {
          actor: { type: 'Monster', monsterId: 'goblin-123' },
          choice: 'hide',
        },
        services: {
          disengage: vi.fn(),
          hide: mockHide,
        },
      };

      const result = await registry.execute(context);

      expect(result.success).toBe(true);
      expect(result.summary).toContain('Nimble Escape');
      expect(result.summary).toContain('Hid');
      expect(mockHide).toHaveBeenCalledWith({
        encounterId: 'test-encounter',
        actor: { type: 'Monster', monsterId: 'goblin-123' },
      });
    });

    it('should infer Disengage from ability ID "nimble_escape_disengage"', async () => {
      const mockDisengage = vi.fn().mockResolvedValue({ success: true });

      const context: AbilityExecutionContext = {
        sessionId: 'test-session',
        encounterId: 'test-encounter',
        actor: { id: 'goblin-123', name: 'Sneaky Goblin' } as any,
        combat: {} as any,
        abilityId: 'nimble_escape_disengage',
        params: {
          actor: { type: 'Monster', monsterId: 'goblin-123' },
          // No explicit choice - should infer from abilityId
        },
        services: {
          disengage: mockDisengage,
          hide: vi.fn(),
        },
      };

      const result = await registry.execute(context);

      expect(result.success).toBe(true);
      expect(mockDisengage).toHaveBeenCalled();
    });

    it('should infer Hide from ability ID "nimble_escape_hide"', async () => {
      const mockHide = vi.fn().mockResolvedValue({ success: true });

      const context: AbilityExecutionContext = {
        sessionId: 'test-session',
        encounterId: 'test-encounter',
        actor: { id: 'goblin-123', name: 'Sneaky Goblin' } as any,
        combat: {} as any,
        abilityId: 'nimble_escape_hide',
        params: {
          actor: { type: 'Monster', monsterId: 'goblin-123' },
          // No explicit choice - should infer from abilityId
        },
        services: {
          disengage: vi.fn(),
          hide: mockHide,
        },
      };

      const result = await registry.execute(context);

      expect(result.success).toBe(true);
      expect(mockHide).toHaveBeenCalled();
    });

    it('should default to Disengage when choice is ambiguous', async () => {
      const mockDisengage = vi.fn().mockResolvedValue({ success: true });

      const context: AbilityExecutionContext = {
        sessionId: 'test-session',
        encounterId: 'test-encounter',
        actor: { id: 'goblin-123', name: 'Sneaky Goblin' } as any,
        combat: {} as any,
        abilityId: 'monster:bonus:nimble-escape',
        params: {
          actor: { type: 'Monster', monsterId: 'goblin-123' },
          // No choice and ID doesn't indicate which action
        },
        services: {
          disengage: mockDisengage,
          hide: vi.fn(),
        },
      };

      const result = await registry.execute(context);

      expect(result.success).toBe(true);
      expect(result.summary).toContain('Disengage');
      expect(mockDisengage).toHaveBeenCalled();
    });

    it('should fail gracefully when services are missing', async () => {
      const context: AbilityExecutionContext = {
        sessionId: 'test-session',
        encounterId: 'test-encounter',
        actor: { id: 'goblin-123', name: 'Sneaky Goblin' } as any,
        combat: {} as any,
        abilityId: 'nimble_escape_disengage',
        params: {
          actor: { type: 'Monster', monsterId: 'goblin-123' },
        },
        services: {
          // Missing disengage and hide services
        },
      };

      const result = await registry.execute(context);

      expect(result.success).toBe(false);
      expect(result.error).toBe('MISSING_SERVICE');
    });

    it('should fail when bonus action is already used', async () => {
      const context: AbilityExecutionContext = {
        sessionId: 'test-session',
        encounterId: 'test-encounter',
        actor: { id: 'goblin-123', name: 'Sneaky Goblin' } as any,
        combat: {} as any,
        abilityId: 'monster:bonus:nimble-escape',
        params: {
          actor: { type: 'Monster', monsterId: 'goblin-123' },
          resources: { bonusActionUsed: true },
        },
        services: {
          disengage: vi.fn(),
          hide: vi.fn(),
        },
      };

      const result = await registry.execute(context);

      expect(result.success).toBe(false);
      expect(result.error).toBe('NO_BONUS_ACTION');
    });

    it('should fail when creature is incapacitated', async () => {
      const context: AbilityExecutionContext = {
        sessionId: 'test-session',
        encounterId: 'test-encounter',
        actor: { id: 'goblin-123', name: 'Sneaky Goblin' } as any,
        combat: {} as any,
        abilityId: 'monster:bonus:nimble-escape',
        params: {
          actor: { type: 'Monster', monsterId: 'goblin-123' },
          conditions: ['Incapacitated'],
        },
        services: {
          disengage: vi.fn(),
          hide: vi.fn(),
        },
      };

      const result = await registry.execute(context);

      expect(result.success).toBe(false);
      expect(result.error).toBe('INCAPACITATED');
    });

    it('should fail when creature is stunned', async () => {
      const context: AbilityExecutionContext = {
        sessionId: 'test-session',
        encounterId: 'test-encounter',
        actor: { id: 'goblin-123', name: 'Sneaky Goblin' } as any,
        combat: {} as any,
        abilityId: 'monster:bonus:nimble-escape',
        params: {
          actor: { type: 'Monster', monsterId: 'goblin-123' },
          conditions: ['Stunned'],
        },
        services: {
          disengage: vi.fn(),
          hide: vi.fn(),
        },
      };

      const result = await registry.execute(context);

      expect(result.success).toBe(false);
      expect(result.error).toBe('INCAPACITATED');
    });

    it('should succeed when no resources or conditions are provided (backward compat)', async () => {
      const mockDisengage = vi.fn().mockResolvedValue({ success: true });

      const context: AbilityExecutionContext = {
        sessionId: 'test-session',
        encounterId: 'test-encounter',
        actor: { id: 'goblin-123', name: 'Sneaky Goblin' } as any,
        combat: {} as any,
        abilityId: 'monster:bonus:nimble-escape',
        params: {
          actor: { type: 'Monster', monsterId: 'goblin-123' },
          // No resources or conditions — backward compat path
        },
        services: {
          disengage: mockDisengage,
          hide: vi.fn(),
        },
      };

      const result = await registry.execute(context);

      expect(result.success).toBe(true);
      expect(mockDisengage).toHaveBeenCalled();
    });
  });
});
