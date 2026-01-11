import { describe, it, expect } from 'vitest';
import { renderBattlefield, createCombatantEntity } from './battlefield-renderer.js';
import { createCombatMap, setTerrainAt } from './combat-map.js';

describe('battlefield-renderer - visual output', () => {
  it('should render a tactical combat scenario with terrain and combatants', () => {
    // Create a 30x30 map (6x6 grid)
    const map = createCombatMap({
      id: 'tactical-map',
      name: 'Goblin Ambush',
      width: 30,
      height: 30,
      gridSize: 5,
    });

    // Add some walls
    setTerrainAt(map, { x: 10, y: 10 }, 'wall');
    setTerrainAt(map, { x: 10, y: 15 }, 'wall');
    setTerrainAt(map, { x: 10, y: 20 }, 'wall');

    // Add cover
    setTerrainAt(map, { x: 5, y: 10 }, 'cover-half');
    setTerrainAt(map, { x: 20, y: 10 }, 'cover-half');

    // Add difficult terrain
    setTerrainAt(map, { x: 15, y: 20 }, 'difficult');
    setTerrainAt(map, { x: 20, y: 20 }, 'difficult');

    // Add combatants
    const entities = [
      createCombatantEntity(
        { name: 'Fighter', position: { x: 0, y: 5 }, hpCurrent: 36, hpMax: 36, faction: 'heroes' },
        '@',
        true,
        'heroes',
      ),
      createCombatantEntity(
        { name: 'Rogue', position: { x: 0, y: 10 }, hpCurrent: 28, hpMax: 28, faction: 'heroes' },
        '1',
        false,
        'heroes',
      ),
      createCombatantEntity(
        { name: 'Wizard', position: { x: 0, y: 15 }, hpCurrent: 22, hpMax: 22, faction: 'heroes' },
        '2',
        false,
        'heroes',
      ),
      createCombatantEntity(
        { name: 'Goblin Leader', position: { x: 25, y: 10 }, hpCurrent: 15, hpMax: 15, faction: 'goblins' },
        'A',
        false,
        'heroes',
      ),
      createCombatantEntity(
        { name: 'Goblin Archer 1', position: { x: 20, y: 5 }, hpCurrent: 7, hpMax: 7, faction: 'goblins' },
        'B',
        false,
        'heroes',
      ),
      createCombatantEntity(
        { name: 'Goblin Archer 2', position: { x: 20, y: 15 }, hpCurrent: 7, hpMax: 7, faction: 'goblins' },
        'C',
        false,
        'heroes',
      ),
    ];

    const result = renderBattlefield(map, entities);

    // Log the battlefield for visual inspection
    console.log('\n' + '='.repeat(60));
    console.log('BATTLEFIELD VISUALIZATION (Goblin Ambush)');
    console.log('='.repeat(60));
    console.log(result.grid);
    console.log('\n' + result.legend);
    console.log('='.repeat(60) + '\n');

    // Verify structure
    expect(result.grid).toBeTruthy();
    expect(result.legend).toBeTruthy();
    expect(result.coordinates.width).toBe(6);
    expect(result.coordinates.height).toBe(6);

    // Verify all combatants are present
    expect(result.grid).toContain('@');  // Fighter
    expect(result.grid).toContain('1');  // Rogue
    expect(result.grid).toContain('2');  // Wizard
    expect(result.grid).toContain('A');  // Goblin Leader
    expect(result.grid).toContain('B');  // Goblin Archer 1
    expect(result.grid).toContain('C');  // Goblin Archer 2

    // Verify legend mentions terrain key
    expect(result.legend).toContain('Terrain Key');
    expect(result.legend).toContain('normal ground');
  });
});
