import { describe, it, expect } from 'vitest';
import { renderBattlefield, createCombatantEntity, DEFAULT_MAPPINGS } from './battlefield-renderer.js';
import { createCombatMap } from './combat-map.js';

describe('battlefield-renderer', () => {
  it('should render a simple 10x10 battlefield with combatants', () => {
    const map = createCombatMap({
      id: 'test-map',
      name: 'Test Arena',
      width: 50,
      height: 50,
      gridSize: 5,
    });

    const entities = [
      createCombatantEntity(
        { name: 'Fighter', position: { x: 10, y: 10 }, hpCurrent: 30, hpMax: 36, faction: 'heroes' },
        '@',
        true,
        'heroes',
      ),
      createCombatantEntity(
        { name: 'Rogue', position: { x: 15, y: 10 }, hpCurrent: 28, hpMax: 28, faction: 'heroes' },
        '1',
        false,
        'heroes',
      ),
      createCombatantEntity(
        { name: 'Goblin A', position: { x: 10, y: 40 }, hpCurrent: 7, hpMax: 7, faction: 'monsters' },
        'A',
        false,
        'heroes',
      ),
      createCombatantEntity(
        { name: 'Goblin B', position: { x: 15, y: 40 }, hpCurrent: 5, hpMax: 7, faction: 'monsters' },
        'B',
        false,
        'heroes',
      ),
    ];

    const result = renderBattlefield(map, entities);

    // Grid should be non-empty
    expect(result.grid).toBeTruthy();
    expect(result.grid.length).toBeGreaterThan(0);

    // Legend should mention all combatants
    expect(result.legend).toContain('@');
    expect(result.legend).toContain('Fighter');
    expect(result.legend).toContain('1');
    expect(result.legend).toContain('Rogue');
    expect(result.legend).toContain('A');
    expect(result.legend).toContain('Goblin A');
    expect(result.legend).toContain('B');
    expect(result.legend).toContain('Goblin B');

    // Grid should contain all character symbols
    expect(result.grid).toContain('@');
    expect(result.grid).toContain('1');
    expect(result.grid).toContain('A');
    expect(result.grid).toContain('B');

    // Should have coordinate axes
    expect(result.grid).toMatch(/[0-9]/);  // Should have numbers in axes

    // Verify structure
    expect(result.coordinates.width).toBe(10);
    expect(result.coordinates.height).toBe(10);
    expect(result.coordinates.gridSize).toBe(5);
  });

  it('should use default terrain character for empty cells', () => {
    const map = createCombatMap({
      id: 'test-map',
      name: 'Empty Room',
      width: 25,
      height: 25,
      gridSize: 5,
    });

    const result = renderBattlefield(map, []);

    // Should have dots for empty space
    expect(result.grid).toContain('.');

    // Should have terrain key in legend
    expect(result.legend).toContain('.');
  });

  it('should group entities by type in legend', () => {
    const map = createCombatMap({
      id: 'test-map',
      name: 'Test Arena',
      width: 25,
      height: 25,
      gridSize: 5,
    });

    const entities = [
      createCombatantEntity(
        { name: 'Warrior', position: { x: 10, y: 10 }, hpCurrent: 36, hpMax: 36, faction: 'heroes' },
        '@',
        true,
        'heroes',
      ),
      createCombatantEntity(
        { name: 'Cleric', position: { x: 15, y: 10 }, hpCurrent: 28, hpMax: 28, faction: 'heroes' },
        '1',
        false,
        'heroes',
      ),
      createCombatantEntity(
        { name: 'Orc', position: { x: 10, y: 20 }, hpCurrent: 15, hpMax: 15, faction: 'monsters' },
        'A',
        false,
        'heroes',
      ),
    ];

    const result = renderBattlefield(map, entities);

    // Legend should have grouped sections
    expect(result.legend).toContain('You:');
    expect(result.legend).toContain('Allies:');
    expect(result.legend).toContain('Enemies:');

    // Should show health info
    expect(result.legend).toContain('36/36 HP');
    expect(result.legend).toContain('28/28 HP');
    expect(result.legend).toContain('15/15 HP');
  });

  it('should handle combatants at map boundaries', () => {
    const map = createCombatMap({
      id: 'test-map',
      name: 'Boundary Test',
      width: 25,
      height: 25,
      gridSize: 5,
    });

    const entities = [
      createCombatantEntity(
        { name: 'Corner1', position: { x: 0, y: 0 }, hpCurrent: 10, hpMax: 10, faction: 'heroes' },
        '@',
        true,
        'heroes',
      ),
      createCombatantEntity(
        { name: 'Corner2', position: { x: 20, y: 0 }, hpCurrent: 10, hpMax: 10, faction: 'heroes' },
        '1',
        false,
        'heroes',
      ),
      createCombatantEntity(
        { name: 'Corner3', position: { x: 0, y: 20 }, hpCurrent: 10, hpMax: 10, faction: 'heroes' },
        '2',
        false,
        'heroes',
      ),
      createCombatantEntity(
        { name: 'Corner4', position: { x: 20, y: 20 }, hpCurrent: 10, hpMax: 10, faction: 'heroes' },
        '3',
        false,
        'heroes',
      ),
    ];

    const result = renderBattlefield(map, entities);

    // Should render all four corners
    expect(result.grid).toContain('@');
    expect(result.grid).toContain('1');
    expect(result.grid).toContain('2');
    expect(result.grid).toContain('3');

    // No errors during rendering
    expect(result.coordinates.width).toBe(5);
    expect(result.coordinates.height).toBe(5);
  });
});
