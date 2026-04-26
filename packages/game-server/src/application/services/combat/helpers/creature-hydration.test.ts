/**
 * Tests for creature hydration utilities
 */

import { describe, it, expect } from 'vitest';
import { hydrateCharacter, hydrateMonster, hydrateNPC, extractCombatantState } from './creature-hydration.js';
import type { SessionCharacterRecord, SessionMonsterRecord, SessionNPCRecord, CombatantStateRecord } from '../../../types.js';
import { FixedDiceRoller } from '../../../../domain/rules/dice-roller.js';
import { hydrateCombat, extractCombatState, extractActionEconomy } from './combat-hydration.js';
import type { Creature } from '../../../../domain/entities/creatures/creature.js';

describe('Creature Hydration', () => {
  describe('hydrateCharacter', () => {
    it('should hydrate a basic character from record', () => {
      const record: SessionCharacterRecord = {
        id: 'char-1',
        sessionId: 'session-1',
        name: 'Aragorn',
        level: 5,
        className: 'Fighter',
        sheet: {
          abilityScores: {
            strength: 16,
            dexterity: 14,
            constitution: 15,
            intelligence: 10,
            wisdom: 12,
            charisma: 11,
          },
          maxHP: 42,
          currentHP: 42,
          armorClass: 18,
          speed: 30,
          proficiencyBonus: 3,
          experiencePoints: 6500,
          featIds: ['feat_alert'],
        },
        faction: 'heroes',
        aiControlled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const character = hydrateCharacter(record);

      expect(character.getName()).toBe('Aragorn');
      expect(character.getLevel()).toBe(5);
      expect(character.getClass()).toBe('Fighter');
      expect(character.getCurrentHP()).toBe(42);
      expect(character.getMaxHP()).toBe(42);
      expect(character.getAC()).toBeGreaterThan(0);
      expect(character.getSpeed()).toBe(30);
      expect(character.getAbilityModifier('strength')).toBe(3);
      expect(character.getFeatIds()).toContain('feat_alert');
    });

    it('should apply combat state HP and conditions', () => {
      const record: SessionCharacterRecord = {
        id: 'char-1',
        sessionId: 'session-1',
        name: 'Gandalf',
        level: 10,
        className: 'Wizard',
        sheet: {
          abilityScores: {
            strength: 10,
            dexterity: 14,
            constitution: 13,
            intelligence: 18,
            wisdom: 16,
            charisma: 15,
          },
          maxHP: 60,
          currentHP: 60,
          armorClass: 13,
          speed: 30,
        },
        faction: 'heroes',
        aiControlled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const combatantState: CombatantStateRecord = {
        id: 'combatant-1',
        encounterId: 'encounter-1',
        combatantType: 'Character',
        characterId: 'char-1',
        monsterId: null,
        npcId: null,
        initiative: 15,
        hpCurrent: 30,  // Damaged in combat
        hpMax: 60,
        hpTemp: 0,
        conditions: ['Poisoned', 'Frightened'],
        resources: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const character = hydrateCharacter(record, combatantState);

      expect(character.getCurrentHP()).toBe(30);
      const conditions = character.getConditions();
      expect(conditions.length).toBe(2);
      expect(character.hasCondition('Poisoned')).toBe(true);
      expect(character.hasCondition('Frightened')).toBe(true);
    });

    it('overlays combat-facing HP/AC/speed from wild shape form state', () => {
      const record: SessionCharacterRecord = {
        id: 'char-druid-1',
        sessionId: 'session-1',
        name: 'Leaf',
        level: 2,
        className: 'Druid',
        sheet: {
          abilityScores: {
            strength: 10,
            dexterity: 12,
            constitution: 14,
            intelligence: 10,
            wisdom: 16,
            charisma: 10,
          },
          maxHP: 18,
          currentHP: 18,
          armorClass: 12,
          speed: 30,
          classId: 'druid',
        },
        faction: 'party',
        aiControlled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const combatantState: CombatantStateRecord = {
        id: 'combatant-druid-1',
        encounterId: 'enc-1',
        combatantType: 'Character',
        characterId: 'char-druid-1',
        monsterId: null,
        npcId: null,
        initiative: 15,
        hpCurrent: 18,
        hpMax: 18,
        hpTemp: 0,
        conditions: [],
        resources: {
          wildShapeActive: true,
          wildShapeForm: {
            formName: 'Beast of the Land',
            armorClass: 13,
            speedFeet: 30,
            maxHp: 10,
            hpRemainingInForm: 6,
            attacks: [
              {
                name: 'Bestial Strike',
                kind: 'melee',
                attackBonus: 5,
                damage: { diceCount: 1, diceSides: 8, modifier: 0 },
                damageType: 'slashing',
              },
            ],
            originalCharacterId: 'char-druid-1',
            appliedAtRound: 1,
            hitDiceUsed: 0,
          },
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const character = hydrateCharacter(record, combatantState);

      expect(character.getCurrentHP()).toBe(6);
      expect(character.getMaxHP()).toBe(10);
      expect(character.getAC()).toBe(13);
      expect(character.getSpeed()).toBe(30);
    });

    it('should populate equipment from pre-enriched equippedArmor on sheet', () => {
      const record: SessionCharacterRecord = {
        id: 'char-armored',
        sessionId: 'session-1',
        name: 'Armored Barbarian',
        level: 5,
        className: 'Barbarian',
        sheet: {
          abilityScores: {
            strength: 16,
            dexterity: 14,
            constitution: 16,
            intelligence: 8,
            wisdom: 12,
            charisma: 10,
          },
          maxHP: 55,
          currentHP: 55,
          armorClass: 18,
          speed: 30,
          classId: 'barbarian',
          // Pre-enriched by enrichSheetArmor() at creation time
          equippedArmor: {
            name: 'Plate',
            category: 'heavy',
            acFormula: { base: 18, addDexterityModifier: false },
          },
        },
        faction: 'heroes',
        aiControlled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const character = hydrateCharacter(record);

      // With plate armor equipped, should get plate AC (18), NOT Unarmored Defense
      // Barbarian Unarmored Defense = 10 + DEX(2) + CON(3) = 15
      expect(character.getAC()).toBe(18);
    });

    it('should populate equipment from sheet.equipment.armor via catalog lookup', () => {
      const record: SessionCharacterRecord = {
        id: 'char-chain',
        sessionId: 'session-1',
        name: 'Chain Mail Fighter',
        level: 3,
        className: 'Fighter',
        sheet: {
          abilityScores: {
            strength: 16,
            dexterity: 12,
            constitution: 14,
            intelligence: 10,
            wisdom: 10,
            charisma: 10,
          },
          maxHP: 28,
          currentHP: 28,
          armorClass: 16,
          speed: 30,
          classId: 'fighter',
          equipment: {
            armor: { name: 'Chain Mail' },
            weapon: { name: 'Longsword' },
          },
        },
        faction: 'heroes',
        aiControlled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const character = hydrateCharacter(record);

      // Chain Mail = base 16, no DEX modifier
      expect(character.getAC()).toBe(16);
    });

    it('should use Unarmored Defense when no armor is equipped for Barbarian', () => {
      const record: SessionCharacterRecord = {
        id: 'char-unarmored',
        sessionId: 'session-1',
        name: 'Unarmored Barbarian',
        level: 5,
        className: 'Barbarian',
        sheet: {
          abilityScores: {
            strength: 16,
            dexterity: 14,
            constitution: 16,
            intelligence: 8,
            wisdom: 12,
            charisma: 10,
          },
          maxHP: 55,
          currentHP: 55,
          armorClass: 15,
          speed: 30,
          classId: 'barbarian',
          // No equippedArmor, no equipment.armor — truly unarmored
        },
        faction: 'heroes',
        aiControlled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const character = hydrateCharacter(record);

      // Barbarian Unarmored Defense = 10 + DEX(2) + CON(3) = 15
      expect(character.getAC()).toBe(15);
    });

    it('should populate shield from pre-enriched equippedShield on sheet', () => {
      const record: SessionCharacterRecord = {
        id: 'char-shield',
        sessionId: 'session-1',
        name: 'Shield Fighter',
        level: 3,
        className: 'Fighter',
        sheet: {
          abilityScores: {
            strength: 16,
            dexterity: 12,
            constitution: 14,
            intelligence: 10,
            wisdom: 10,
            charisma: 10,
          },
          maxHP: 28,
          currentHP: 28,
          armorClass: 18,
          speed: 30,
          classId: 'fighter',
          equippedArmor: {
            name: 'Chain Mail',
            category: 'heavy',
            acFormula: { base: 16, addDexterityModifier: false },
          },
          equippedShield: { name: 'Shield', armorClassBonus: 2 },
        },
        faction: 'heroes',
        aiControlled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const character = hydrateCharacter(record);

      // Chain Mail 16 + Shield 2 = 18
      expect(character.getAC()).toBe(18);
    });

    it('should hydrate subclass and subclassLevel from sheet', () => {
      const record: SessionCharacterRecord = {
        id: 'char-monk',
        sessionId: 'session-1',
        name: 'Open Hand Monk',
        level: 5,
        className: 'Monk',
        sheet: {
          abilityScores: {
            strength: 10,
            dexterity: 18,
            constitution: 14,
            intelligence: 10,
            wisdom: 16,
            charisma: 8,
          },
          maxHP: 38,
          currentHP: 38,
          armorClass: 17,
          speed: 40,
          classId: 'monk',
          subclass: 'Open Hand',
          subclassLevel: 3,
        },
        faction: 'heroes',
        aiControlled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const character = hydrateCharacter(record);

      expect(character.getSubclass()).toBe('Open Hand');
      expect(character.getSubclassLevel()).toBe(3);
    });

    it('should leave subclass undefined when not present on sheet', () => {
      const record: SessionCharacterRecord = {
        id: 'char-fighter',
        sessionId: 'session-1',
        name: 'No Subclass Fighter',
        level: 2,
        className: 'Fighter',
        sheet: {
          abilityScores: {
            strength: 16,
            dexterity: 14,
            constitution: 15,
            intelligence: 10,
            wisdom: 12,
            charisma: 11,
          },
          maxHP: 20,
          currentHP: 20,
          armorClass: 16,
          speed: 30,
          classId: 'fighter',
        },
        faction: 'heroes',
        aiControlled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const character = hydrateCharacter(record);

      expect(character.getSubclass()).toBeUndefined();
      expect(character.getSubclassLevel()).toBeUndefined();
    });
  });

  describe('hydrateMonster', () => {
    it('should hydrate a monster from record', () => {
      const record: SessionMonsterRecord = {
        id: 'monster-1',
        sessionId: 'session-1',
        name: 'Goblin',
        monsterDefinitionId: 'goblin',
        statBlock: {
          abilityScores: {
            strength: 8,
            dexterity: 14,
            constitution: 10,
            intelligence: 10,
            wisdom: 8,
            charisma: 8,
          },
          maxHP: 7,
          currentHP: 7,
          armorClass: 15,
          speed: 30,
          challengeRating: 0.25,
          experienceValue: 50,
        },
        faction: 'enemies',
        aiControlled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const monster = hydrateMonster(record);

      expect(monster.getName()).toBe('Goblin');
      expect(monster.getChallengeRating()).toBe(0.25);
      expect(monster.getExperienceValue()).toBe(50);
      expect(monster.getCurrentHP()).toBe(7);
      expect(monster.getMaxHP()).toBe(7);
      expect(monster.getProficiencyBonus()).toBe(2);
    });

    it('should handle combat state', () => {
      const record: SessionMonsterRecord = {
        id: 'monster-1',
        sessionId: 'session-1',
        name: 'Orc',
        monsterDefinitionId: 'orc',
        statBlock: {
          abilityScores: {
            strength: 16,
            dexterity: 12,
            constitution: 16,
            intelligence: 7,
            wisdom: 11,
            charisma: 10,
          },
          maxHP: 15,
          currentHP: 15,
          armorClass: 13,
          speed: 30,
          challengeRating: 0.5,
          experienceValue: 100,
        },
        faction: 'enemies',
        aiControlled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const combatantState: CombatantStateRecord = {
        id: 'combatant-2',
        encounterId: 'encounter-1',
        combatantType: 'Monster',
        characterId: null,
        monsterId: 'monster-1',
        npcId: null,
        initiative: 12,
        hpCurrent: 5,  // Badly wounded
        hpMax: 15,
        hpTemp: 0,
        conditions: ['Prone'],
        resources: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const monster = hydrateMonster(record, combatantState);

      expect(monster.getCurrentHP()).toBe(5);
      expect(monster.hasCondition('Prone')).toBe(true);
    });
  });

  describe('hydrateNPC', () => {
    it('should hydrate an NPC from record', () => {
      const record: SessionNPCRecord = {
        id: 'npc-1',
        sessionId: 'session-1',
        name: 'Guard Captain',
        statBlock: {
          abilityScores: {
            strength: 14,
            dexterity: 12,
            constitution: 14,
            intelligence: 10,
            wisdom: 11,
            charisma: 12,
          },
          maxHP: 20,
          currentHP: 20,
          armorClass: 16,
          speed: 30,
          proficiencyBonus: 2,
          role: 'Guard',
        },
        faction: 'guards',
        aiControlled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const npc = hydrateNPC(record);

      expect(npc.getName()).toBe('Guard Captain');
      expect(npc.getRole()).toBe('Guard');
      expect(npc.getProficiencyBonus()).toBe(2);
      expect(npc.getCurrentHP()).toBe(20);
    });

    it('should hydrate a class-backed NPC using sheet (className + level)', () => {
      const record: SessionNPCRecord = {
        id: 'npc-class-1',
        sessionId: 'session-1',
        name: 'Allied Wizard',
        statBlock: null,
        className: 'Wizard',
        level: 5,
        sheet: {
          classId: 'wizard',
          abilityScores: {
            strength: 8,
            dexterity: 14,
            constitution: 13,
            intelligence: 18,
            wisdom: 12,
            charisma: 10,
          },
          maxHP: 32,
          currentHP: 32,
          armorClass: 13,
          speed: 30,
          subclass: 'Evoker',
          featIds: ['feat_war_caster'],
        },
        faction: 'allies',
        aiControlled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const npc = hydrateNPC(record);

      expect(npc.getName()).toBe('Allied Wizard');
      expect(npc.getLevel()).toBe(5);
      expect(npc.getClassId()).toBe('wizard');
      expect(npc.getSubclass()).toBe('Evoker');
      expect(npc.getCurrentHP()).toBe(32);
      expect(npc.getMaxHP()).toBe(32);
      expect(npc.getFeatIds()).toContain('feat_war_caster');
    });

    it('should apply combat state HP to class-backed NPC', () => {
      const record: SessionNPCRecord = {
        id: 'npc-class-2',
        sessionId: 'session-1',
        name: 'NPC Fighter',
        statBlock: null,
        className: 'Fighter',
        level: 3,
        sheet: {
          classId: 'fighter',
          abilityScores: {
            strength: 16,
            dexterity: 13,
            constitution: 15,
            intelligence: 10,
            wisdom: 12,
            charisma: 11,
          },
          maxHP: 28,
          currentHP: 28,
          armorClass: 17,
          speed: 30,
        },
        faction: 'allies',
        aiControlled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const combatantState: CombatantStateRecord = {
        id: 'combatant-npc-class',
        encounterId: 'encounter-1',
        combatantType: 'NPC',
        characterId: null,
        monsterId: null,
        npcId: 'npc-class-2',
        initiative: 12,
        hpCurrent: 10,
        hpMax: 28,
        hpTemp: 0,
        conditions: ['Poisoned'],
        resources: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const npc = hydrateNPC(record, combatantState);

      expect(npc.getCurrentHP()).toBe(10);
      expect(npc.getMaxHP()).toBe(28);
      expect(npc.hasCondition('Poisoned')).toBe(true);
    });

    it('class-backed NPC with no classId on sheet falls back to className lowercase', () => {
      const record: SessionNPCRecord = {
        id: 'npc-class-3',
        sessionId: 'session-1',
        name: 'Rogue NPC',
        statBlock: null,
        className: 'Rogue',
        level: 4,
        sheet: {
          // No classId field — should fall back to className.toLowerCase()
          abilityScores: {
            strength: 10,
            dexterity: 18,
            constitution: 12,
            intelligence: 14,
            wisdom: 10,
            charisma: 12,
          },
          maxHP: 24,
          currentHP: 24,
          armorClass: 14,
          speed: 30,
        },
        faction: 'allies',
        aiControlled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const npc = hydrateNPC(record);

      expect(npc.getLevel()).toBe(4);
      expect(npc.getClassId()).toBe('rogue');
    });
  });

  describe('extractCombatantState', () => {
    it('should extract dirty state from Character', () => {
      const record: SessionCharacterRecord = {
        id: 'char-1',
        sessionId: 'session-1',
        name: 'Legolas',
        level: 7,
        className: 'Ranger',
        sheet: {
          abilityScores: {
            strength: 13,
            dexterity: 18,
            constitution: 14,
            intelligence: 12,
            wisdom: 15,
            charisma: 11,
          },
          maxHP: 55,
          currentHP: 55,
          armorClass: 16,
          speed: 35,
        },
        faction: 'heroes',
        aiControlled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const character = hydrateCharacter(record);
      
      // Simulate combat damage and conditions
      character.takeDamage(20);
      character.addCondition('Restrained');
      
      const state = extractCombatantState(character);

      expect(state.hpCurrent).toBe(35);  // 55 - 20
      expect(state.conditions).toContain('restrained');  // lowercase
      expect(state.conditions.length).toBe(1);
    });

    it('should handle death state', () => {
      const record: SessionMonsterRecord = {
        id: 'monster-1',
        sessionId: 'session-1',
        name: 'Zombie',
        monsterDefinitionId: 'zombie',
        statBlock: {
          abilityScores: {
            strength: 13,
            dexterity: 6,
            constitution: 16,
            intelligence: 3,
            wisdom: 6,
            charisma: 5,
          },
          maxHP: 22,
          currentHP: 22,
          armorClass: 8,
          speed: 20,
          challengeRating: 0.25,
          experienceValue: 50,
        },
        faction: 'undead',
        aiControlled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const monster = hydrateMonster(record);
      
      // Kill the monster
      monster.takeDamage(30);
      
      const state = extractCombatantState(monster);

      expect(state.hpCurrent).toBe(0);
      expect(monster.isDead()).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing sheet fields with defaults', () => {
      const record: SessionCharacterRecord = {
        id: 'char-minimal',
        sessionId: 'session-1',
        name: 'MinimalChar',
        level: 1,
        className: 'Fighter',
        sheet: {
          // Missing most fields - should use defaults
          abilityScores: {
            strength: 10,
            dexterity: 10,
            constitution: 10,
            intelligence: 10,
            wisdom: 10,
            charisma: 10,
          },
        },
        faction: 'heroes',
        aiControlled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const character = hydrateCharacter(record);

      expect(character.getName()).toBe('MinimalChar');
      expect(character.getLevel()).toBe(1);
      expect(character.getCurrentHP()).toBeGreaterThan(0);  // Should have default HP
      expect(character.getMaxHP()).toBeGreaterThan(0);
      expect(character.getAC()).toBeGreaterThan(0);  // Should have default AC
      expect(character.getSpeed()).toBeGreaterThan(0);  // Should have default speed
    });

    it('should handle malformed JSON gracefully', () => {
      const record: SessionCharacterRecord = {
        id: 'char-bad',
        sessionId: 'session-1',
        name: 'BadChar',
        level: 3,
        className: 'Wizard',
        sheet: {
          abilityScores: null,  // Bad data
          maxHP: 'not a number' as any,  // Bad type
          armorClass: undefined,  // Missing
          speed: -50,  // Invalid value (negative)
        },
        faction: 'heroes',
        aiControlled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Should not throw, use defaults
      expect(() => hydrateCharacter(record)).not.toThrow();
      
      const character = hydrateCharacter(record);
      expect(character.getName()).toBe('BadChar');
      expect(character.getAbilityModifier('strength')).toBe(0);  // Default 10 → +0
    });

    it('should handle round-trip hydration (hydrate → extract → hydrate)', () => {
      const originalRecord: SessionCharacterRecord = {
        id: 'char-roundtrip',
        sessionId: 'session-1',
        name: 'RoundTrip',
        level: 7,
        className: 'Ranger',
        sheet: {
          abilityScores: {
            strength: 14,
            dexterity: 18,
            constitution: 13,
            intelligence: 11,
            wisdom: 15,
            charisma: 10,
          },
          maxHP: 55,
          currentHP: 55,
          armorClass: 16,
          speed: 35,
          featIds: ['feat_alert', 'feat_sharpshooter'],
        },
        faction: 'heroes',
        aiControlled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // First hydration
      const character1 = hydrateCharacter(originalRecord);
      
      // Simulate combat
      character1.takeDamage(20);
      character1.addCondition('Poisoned');
      
      // Extract state
      const state1 = extractCombatantState(character1);
      
      // Create combatant record with extracted state
      const combatantRecord: CombatantStateRecord = {
        id: 'combatant-1',
        encounterId: 'encounter-1',
        combatantType: 'Character',
        characterId: 'char-roundtrip',
        monsterId: null,
        npcId: null,
        initiative: 18,
        hpCurrent: state1.hpCurrent,
        hpMax: 55,
        hpTemp: state1.hpTemp,
        conditions: state1.conditions,
        resources: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      // Second hydration with combat state
      const character2 = hydrateCharacter(originalRecord, combatantRecord);
      
      // Verify state matches
      expect(character2.getCurrentHP()).toBe(character1.getCurrentHP());
      expect(character2.getCurrentHP()).toBe(35);  // 55 - 20
      expect(character2.hasCondition('Poisoned')).toBe(true);
      expect(character2.getConditions()).toEqual(character1.getConditions());
    });
  });

  describe('Combat Integration', () => {
    it('should hydrate Combat instance from records and advance turn', () => {
      const diceRoller = new FixedDiceRoller(10);
      
      // Create character record
      const charRecord: SessionCharacterRecord = {
        id: 'char-combat',
        sessionId: 'session-1',
        name: 'Fighter',
        level: 5,
        className: 'Fighter',
        sheet: {
          abilityScores: {
            strength: 16,
            dexterity: 14,
            constitution: 15,
            intelligence: 10,
            wisdom: 12,
            charisma: 11,
          },
          maxHP: 42,
          currentHP: 42,
          armorClass: 18,
          speed: 30,
        },
        faction: 'heroes',
        aiControlled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      // Create monster record
      const monsterRecord: SessionMonsterRecord = {
        id: 'monster-combat',
        sessionId: 'session-1',
        name: 'Goblin',
        monsterDefinitionId: 'goblin',
        statBlock: {
          abilityScores: {
            strength: 8,
            dexterity: 14,
            constitution: 10,
            intelligence: 10,
            wisdom: 8,
            charisma: 8,
          },
          maxHP: 7,
          currentHP: 7,
          armorClass: 15,
          speed: 30,
          challengeRating: 0.25,
          experienceValue: 50,
        },
        faction: 'enemies',
        aiControlled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      // Create combatant state records (turn order)
      const combatantRecords: CombatantStateRecord[] = [
        {
          id: 'combatant-char',
          encounterId: 'encounter-1',
          combatantType: 'Character',
          characterId: 'char-combat',
          monsterId: null,
          npcId: null,
          initiative: 15,
          hpCurrent: 42,
          hpMax: 42,
          conditions: [],
          resources: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'combatant-monster',
          encounterId: 'encounter-1',
          combatantType: 'Monster',
          characterId: null,
          monsterId: 'monster-combat',
          npcId: null,
          initiative: 12,
          hpCurrent: 7,
          hpMax: 7,
          conditions: [],
          resources: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      
      // Create encounter record
      const encounter = {
        id: 'encounter-1',
        sessionId: 'session-1',
        status: 'Active',
        round: 1,
        turn: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      // Hydrate creatures
      const character = hydrateCharacter(charRecord, combatantRecords[0]);
      const monster = hydrateMonster(monsterRecord, combatantRecords[1]);
      
      const creatures: Map<string, Creature> = new Map();
      creatures.set('combatant-char', character);
      creatures.set('combatant-monster', monster);
      
      // Hydrate Combat
      const combat = hydrateCombat(encounter, combatantRecords, creatures, diceRoller);
      
      // Verify initial state
      expect(combat.getRound()).toBe(1);
      expect(combat.getTurnIndex()).toBe(0);
      expect(combat.getOrder().length).toBe(2);
      
      // Verify active creature
      const activeCreature = combat.getActiveCreature();
      expect(activeCreature.getName()).toBe('Fighter');
      
      // Verify action economy
      expect(combat.canSpendAction('combatant-char')).toBe(true);
      expect(combat.canSpendBonusAction('combatant-char')).toBe(true);
      
      // Spend action
      combat.spendAction('combatant-char');
      expect(combat.canSpendAction('combatant-char')).toBe(false);
      
      // Extract action economy for persistence
      const resources = extractActionEconomy(combat, 'combatant-char', {});
      expect(resources).toHaveProperty('actionSpent', true);
      
      // Advance turn
      combat.endTurn();
      
      // Verify turn advanced
      expect(combat.getTurnIndex()).toBe(1);
      expect(combat.getRound()).toBe(1);  // Same round
      
      // Verify new active creature
      const newActive = combat.getActiveCreature();
      expect(newActive.getName()).toBe('Goblin');
      
      // Verify action economy reset for new active
      expect(combat.canSpendAction('combatant-monster')).toBe(true);
      
      // Advance turn again (should wrap to new round)
      combat.endTurn();
      
      // Verify round advanced
      expect(combat.getRound()).toBe(2);
      expect(combat.getTurnIndex()).toBe(0);
      
      // Verify action economy reset for all on new round
      expect(combat.canSpendAction('combatant-char')).toBe(true);
      expect(combat.canSpendAction('combatant-monster')).toBe(true);
      
      // Extract final state
      const finalState = extractCombatState(combat);
      expect(finalState.round).toBe(2);
      expect(finalState.turn).toBe(0);
    });

    it('should verify action economy JSON format backward compatibility', () => {
      const diceRoller = new FixedDiceRoller(10);
      
      // Create minimal setup
      const charRecord: SessionCharacterRecord = {
        id: 'char-1',
        sessionId: 'session-1',
        name: 'TestChar',
        level: 1,
        className: 'Fighter',
        sheet: {
          abilityScores: {
            strength: 10,
            dexterity: 10,
            constitution: 10,
            intelligence: 10,
            wisdom: 10,
            charisma: 10,
          },
          maxHP: 10,
          currentHP: 10,
          armorClass: 10,
          speed: 30,
        },
        faction: 'heroes',
        aiControlled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      const combatantRecord: CombatantStateRecord = {
        id: 'combatant-1',
        encounterId: 'encounter-1',
        combatantType: 'Character',
        characterId: 'char-1',
        monsterId: null,
        npcId: null,
        initiative: 10,
        hpCurrent: 10,
        hpMax: 10,
        hpTemp: 0,
        conditions: [],
        resources: {
          // Old format (used by clearActionSpent helper)
          actionSpent: true,
          bonusActionSpent: false,
          reactionSpent: false,
          movementRemaining: 20,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      const encounter = {
        id: 'encounter-1',
        sessionId: 'session-1',
        status: 'Active',
        round: 1,
        turn: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      // Hydrate with old format resources
      const character = hydrateCharacter(charRecord, combatantRecord);
      const creatures = new Map([['combatant-1', character]]);
      const combat = hydrateCombat(encounter, [combatantRecord], creatures, diceRoller);
      
      // Verify old format was parsed correctly
      expect(combat.canSpendAction('combatant-1')).toBe(false);  // actionSpent was true
      expect(combat.canSpendBonusAction('combatant-1')).toBe(true);  // bonusActionSpent was false
      
      // Extract and verify format matches old structure
      const extracted = extractActionEconomy(combat, 'combatant-1', combatantRecord.resources) as any;
      
      expect(extracted).toHaveProperty('actionSpent');
      expect(extracted).toHaveProperty('bonusActionSpent');
      expect(extracted).toHaveProperty('reactionSpent');
      expect(extracted).toHaveProperty('movementRemaining');
      
      expect(typeof extracted.actionSpent).toBe('boolean');
      expect(typeof extracted.bonusActionSpent).toBe('boolean');
      expect(typeof extracted.reactionSpent).toBe('boolean');
      expect(typeof extracted.movementRemaining).toBe('number');
    });
  });

  describe('ENT-L3: NPC proficiency bonus from CR', () => {
    it('should use explicit proficiencyBonus when provided in statBlock', () => {
      const record: SessionNPCRecord = {
        id: 'npc-explicit',
        sessionId: 'session-1',
        name: 'Custom NPC',
        statBlock: {
          abilityScores: { strength: 14, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 11, charisma: 12 },
          maxHP: 40,
          currentHP: 40,
          armorClass: 16,
          speed: 30,
          proficiencyBonus: 4,
          challengeRating: 5,
        },
        faction: 'enemies',
        aiControlled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const npc = hydrateNPC(record);
      // Explicit proficiencyBonus takes priority over CR-derived value
      expect(npc.getProficiencyBonus()).toBe(4);
    });

    it('should compute proficiency bonus from CR when proficiencyBonus not provided', () => {
      const makeNPCWithCR = (cr: number) => hydrateNPC({
        id: `npc-cr-${cr}`,
        sessionId: 'session-1',
        name: `CR ${cr} NPC`,
        statBlock: {
          abilityScores: { strength: 14, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 11, charisma: 12 },
          maxHP: 40,
          currentHP: 40,
          armorClass: 16,
          speed: 30,
          challengeRating: cr,
        },
        faction: 'enemies',
        aiControlled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      expect(makeNPCWithCR(0.25).getProficiencyBonus()).toBe(2);
      expect(makeNPCWithCR(1).getProficiencyBonus()).toBe(2);
      expect(makeNPCWithCR(4).getProficiencyBonus()).toBe(2);
      expect(makeNPCWithCR(5).getProficiencyBonus()).toBe(3);
      expect(makeNPCWithCR(8).getProficiencyBonus()).toBe(3);
      expect(makeNPCWithCR(9).getProficiencyBonus()).toBe(4);
      expect(makeNPCWithCR(12).getProficiencyBonus()).toBe(4);
      expect(makeNPCWithCR(13).getProficiencyBonus()).toBe(5);
      expect(makeNPCWithCR(17).getProficiencyBonus()).toBe(6);
      expect(makeNPCWithCR(21).getProficiencyBonus()).toBe(7);
      expect(makeNPCWithCR(25).getProficiencyBonus()).toBe(8);
      expect(makeNPCWithCR(30).getProficiencyBonus()).toBe(9);
    });

    it('should default to +2 when neither proficiencyBonus nor CR are provided', () => {
      const record: SessionNPCRecord = {
        id: 'npc-default',
        sessionId: 'session-1',
        name: 'Basic NPC',
        statBlock: {
          abilityScores: { strength: 10, dexterity: 10, constitution: 10, intelligence: 10, wisdom: 10, charisma: 10 },
          maxHP: 10,
          currentHP: 10,
          armorClass: 10,
          speed: 30,
        },
        faction: 'party',
        aiControlled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const npc = hydrateNPC(record);
      expect(npc.getProficiencyBonus()).toBe(2);
    });
  });

  describe('ENT-L4: darkvision from sheet override', () => {
    it('should use sheet darkvisionRange over species default', () => {
      const record: SessionCharacterRecord = {
        id: 'char-dv-override',
        sessionId: 'session-1',
        name: 'Custom Darkvision',
        level: 5,
        className: 'Fighter',
        sheet: {
          abilityScores: { strength: 16, dexterity: 14, constitution: 15, intelligence: 10, wisdom: 12, charisma: 11 },
          maxHP: 42,
          currentHP: 42,
          armorClass: 18,
          speed: 30,
          darkvisionRange: 120,
          species: 'Elf',
        },
        faction: 'heroes',
        aiControlled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const character = hydrateCharacter(record);
      // Sheet override (120) takes priority over species default (60 for Elf)
      expect(character.getDarkvisionRange()).toBe(120);
    });

    it('should fall back to species darkvision when sheet has none', () => {
      const record: SessionCharacterRecord = {
        id: 'char-dv-species',
        sessionId: 'session-1',
        name: 'Elf Fighter',
        level: 5,
        className: 'Fighter',
        sheet: {
          abilityScores: { strength: 16, dexterity: 14, constitution: 15, intelligence: 10, wisdom: 12, charisma: 11 },
          maxHP: 42,
          currentHP: 42,
          armorClass: 18,
          speed: 30,
          species: 'Elf',
        },
        faction: 'heroes',
        aiControlled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const character = hydrateCharacter(record);
      // Should use Elf darkvision (60)
      expect(character.getDarkvisionRange()).toBe(60);
    });

    it('should default to 0 when neither sheet nor species provide darkvision', () => {
      const record: SessionCharacterRecord = {
        id: 'char-dv-none',
        sessionId: 'session-1',
        name: 'Human Fighter',
        level: 5,
        className: 'Fighter',
        sheet: {
          abilityScores: { strength: 16, dexterity: 14, constitution: 15, intelligence: 10, wisdom: 12, charisma: 11 },
          maxHP: 42,
          currentHP: 42,
          armorClass: 18,
          speed: 30,
          species: 'Human',
        },
        faction: 'heroes',
        aiControlled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const character = hydrateCharacter(record);
      expect(character.getDarkvisionRange()).toBe(0);
    });
  });
});
