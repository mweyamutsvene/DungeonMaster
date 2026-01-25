/**
 * Unit tests for Action Economy Tracking System
 * 
 * Tests that action tracking works correctly for abilities that require
 * specific actions to be used first (e.g., Flurry of Blows requires Attack action).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Combat } from "../../../../domain/combat/combat.js";
import { Character } from "../../../../domain/entities/creatures/character.js";
import { Monster } from "../../../../domain/entities/creatures/monster.js";
import { AbilityScores } from "../../../../domain/entities/core/ability-scores.js";
import { SeededDiceRoller } from "../../../../domain/rules/dice-roller.js";
import { FlurryOfBlowsExecutor, MartialArtsExecutor, OffhandAttackExecutor } from "./executors/index.js";
import type { AbilityExecutionContext } from "../../../../domain/abilities/ability-executor.js";

describe('Action Economy Tracking', () => {
  let combat: Combat;
  let monk: Character;
  let goblin: Monster;

  beforeEach(() => {
    // Create level 2 Monk with ki points
    monk = new Character({
      id: 'monk-1',
      name: 'Test Monk',
      level: 2,
      characterClass: 'Monk',
      classId: 'monk',
      experiencePoints: 300,
      maxHP: 20,
      currentHP: 20,
      armorClass: 15,
      speed: 30,
      abilityScores: new AbilityScores({
        strength: 10,
        dexterity: 16,
        constitution: 14,
        intelligence: 10,
        wisdom: 14,
        charisma: 8,
      }),
    });

    // Create goblin target
    goblin = new Monster({
      id: 'goblin-1',
      name: 'Goblin',
      currentHP: 7,
      maxHP: 7,
      armorClass: 15,
      speed: 30,
      challengeRating: 0.25,
      experienceValue: 50,
      abilityScores: new AbilityScores({
        strength: 8,
        dexterity: 14,
        constitution: 10,
        intelligence: 10,
        wisdom: 8,
        charisma: 8,
      }),
    });

    // Create combat encounter
    const diceRoller = new SeededDiceRoller(42);
    combat = new Combat(diceRoller, [monk, goblin]);
  });

  describe('Flurry of Blows', () => {
    it('should fail if Attack action was not used this turn', async () => {
      const executor = new FlurryOfBlowsExecutor();
      const context: AbilityExecutionContext = {
        sessionId: 'test-session',
        encounterId: 'test-encounter',
        abilityId: 'flurry-of-blows',
        actor: monk,
        combat,
        params: { 
          actor: monk,
          target: goblin,
          targetId: goblin.getId(),
          resources: { resourcePools: [{ name: 'ki', current: 2, max: 2 }] }
        },
        services: {
          attack: async () => ({ success: true, damage: 5 })
        },
      };

      const result = await executor.execute(context);

      expect(result.success).toBe(false);
      expect(result.error).toBe('ATTACK_ACTION_REQUIRED');
      expect(result.summary).toContain('requires using the Attack action first');
    });

    it('should succeed if Attack action was used this turn', async () => {
      // Simulate using Attack action
      combat.spendAction(monk.getId(), 'Attack');

      const executor = new FlurryOfBlowsExecutor();
      const context: AbilityExecutionContext = {
        sessionId: 'test-session',
        encounterId: 'test-encounter',
        abilityId: 'flurry-of-blows',
        actor: monk,
        combat,
        params: { 
          actor: monk,
          target: goblin,
          targetId: goblin.getId(),
          resources: { resourcePools: [{ name: 'ki', current: 2, max: 2 }] }
        },
        services: {
          attack: async () => ({ success: true, damage: 5 })
        },
      };

      const result = await executor.execute(context);

      if (!result.success) {
        console.log('Failure reason:', result.error, result.summary);
      }

      expect(result.success).toBe(true);
      expect(result.data?.abilityName).toBe('Flurry of Blows');
    });

    it('should track that Attack action was used', () => {
      combat.spendAction(monk.getId(), 'Attack');

      const hasUsedAttack = combat.hasUsedAction(monk.getId(), 'Attack');
      expect(hasUsedAttack).toBe(true);
    });

    it('should reset action tracking on new turn', () => {
      // Use action on monk's turn
      combat.spendAction(monk.getId(), 'Attack');
      expect(combat.hasUsedAction(monk.getId(), 'Attack')).toBe(true);

      // End turn and start goblin's turn
      combat.endTurn();
      expect(combat.getActiveCreature().getId()).toBe(goblin.getId());

      // Start new round - monk's turn again
      combat.endTurn();
      expect(combat.getActiveCreature().getId()).toBe(monk.getId());

      // Action should be reset
      expect(combat.hasUsedAction(monk.getId(), 'Attack')).toBe(false);
    });
  });

  describe('Martial Arts', () => {
    it('should fail if Attack action was not used this turn', async () => {
      const executor = new MartialArtsExecutor();
      const context: AbilityExecutionContext = {
        sessionId: 'test-session',
        encounterId: 'test-encounter',
        abilityId: 'martial-arts',
        actor: monk,
        combat,
        params: { 
          actor: monk,
          target: goblin,
          targetId: goblin.getId(),
          resources: { resourcePools: [{ name: 'ki', current: 2, max: 2 }] }
        },
        services: {
          attack: async () => ({ success: true, damage: 4 })
        },
      };

      const result = await executor.execute(context);

      expect(result.success).toBe(false);
      expect(result.error).toBe('ATTACK_ACTION_REQUIRED');
    });

    it('should succeed if Attack action was used this turn', async () => {
      combat.spendAction(monk.getId(), 'Attack');

      const executor = new MartialArtsExecutor();
      const context: AbilityExecutionContext = {
        sessionId: 'test-session',
        encounterId: 'test-encounter',
        abilityId: 'martial-arts',
        actor: monk,
        combat,
        params: { 
          actor: monk,
          target: goblin,
          targetId: goblin.getId(),
          resources: { resourcePools: [{ name: 'ki', current: 2, max: 2 }] }
        },
        services: {
          attack: async () => ({ success: true, damage: 4 })
        },
      };

      const result = await executor.execute(context);

      expect(result.success).toBe(true);
      expect(result.data?.abilityName).toBe('Martial Arts');
    });
  });

  describe('Multiple Action Tracking', () => {
    it('should track specific action types independently', () => {
      // Track that Attack was used
      combat.spendAction(monk.getId(), 'Attack');
      expect(combat.hasUsedAction(monk.getId(), 'Attack')).toBe(true);
      expect(combat.hasUsedAction(monk.getId(), 'Dash')).toBe(false);
      expect(combat.hasUsedAction(monk.getId(), 'Dodge')).toBe(false);
    });

    it('should only allow one action per turn', () => {
      combat.spendAction(monk.getId(), 'Attack');

      // Should throw when trying to spend action again
      expect(() => {
        combat.spendAction(monk.getId(), 'Dash');
      }).toThrow('Action already spent this turn');
    });

    it('should reset action availability after turn ends', () => {
      // Use action
      combat.spendAction(monk.getId(), 'Attack');
      expect(combat.canSpendAction(monk.getId())).toBe(false);

      // End turn
      combat.endTurn();

      // Next creature's turn - goblin can use action
      expect(combat.canSpendAction(goblin.getId())).toBe(true);
    });
  });

  describe('Offhand Attack', () => {
    it('should fail if Attack action was not used this turn', async () => {
      const executor = new OffhandAttackExecutor();
      const context: AbilityExecutionContext = {
        sessionId: 'test-session',
        encounterId: 'test-encounter',
        abilityId: 'offhand-attack',
        actor: monk,
        combat,
        params: {
          actor: monk,
          target: goblin,
          targetId: goblin.getId(),
        },
        services: {
          attack: async () => ({ success: true, damage: 3 })
        },
      };

      const result = await executor.execute(context);

      expect(result.success).toBe(false);
      expect(result.error).toBe('ATTACK_ACTION_REQUIRED');
      expect(result.summary).toContain('Must make a main-hand attack');
    });

    it('should succeed if Attack action was used this turn', async () => {
      combat.spendAction(monk.getId(), 'Attack');

      const executor = new OffhandAttackExecutor();
      const context: AbilityExecutionContext = {
        sessionId: 'test-session',
        encounterId: 'test-encounter',
        abilityId: 'offhand-attack',
        actor: monk,
        combat,
        params: {
          actor: monk,
          target: goblin,
          targetId: goblin.getId(),
          targetName: 'Goblin',
        },
        services: {
          attack: async () => ({ result: { success: true, damage: 4 } })
        },
      };

      const result = await executor.execute(context);

      expect(result.success).toBe(true);
      expect(result.data?.abilityName).toBe('Off-hand Attack');
    });
  });
});
