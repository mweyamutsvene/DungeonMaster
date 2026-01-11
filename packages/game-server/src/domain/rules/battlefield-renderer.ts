/**
 * ASCII Battlefield Renderer for AI Context
 * 
 * Converts tactical combat map into compact character grid with legend.
 * Supports custom character mappings per map for flexibility (dungeons, overworld, etc.)
 */

import type { CombatMap, TerrainType } from "./combat-map.js";
import type { Position } from "./movement.js";

/**
 * Character mappings for terrain/objects/entities.
 * Maps can define custom mappings, or use defaults.
 */
export interface CharacterMappings {
  terrain: Record<TerrainType, string>;
  objects?: Record<string, string>;  // Custom object types (barrel, fire, etc.)
  empty: string;  // Default character for empty/normal terrain
}

/**
 * Default character mappings for standard dungeon/combat maps.
 */
export const DEFAULT_MAPPINGS: CharacterMappings = {
  terrain: {
    "normal": ".",
    "difficult": "~",
    "water": "≈",
    "lava": "^",
    "wall": "#",
    "obstacle": "O",
    "cover-half": "|",
    "cover-three-quarters": "H",
    "cover-full": "X",
    "elevated": "=",
    "pit": "_",
    "hazard": "!",
  },
  objects: {
    "barrel": "B",
    "crate": "B",
    "table": "T",
    "torch": "*",
    "campfire": "F",
    "fire": "F",
    "door": "D",
    "stairs": "S",
    "rubble": "%",
    "boulder": "O",
    "pillar": "P",
    "chest": "C",
    "potion": "!",
    "treasure": "$",
    "scroll": "?",
    "weapon": "+",
  },
  empty: ".",
};

/**
 * Entity on battlefield (creature or item with position).
 */
export interface BattlefieldEntity {
  id: string;
  character: string;  // Display character (1-9, A-Z, @, etc.)
  name: string;
  position: Position;
  description?: string;  // Detailed info for legend
  type: "ally" | "enemy" | "self" | "item" | "object";
}

/**
 * Rendered battlefield result.
 */
export interface RenderedBattlefield {
  /** ASCII grid with coordinate axes */
  grid: string;
  /** Legend mapping characters to entities */
  legend: string;
  /** Raw grid data (2D array) */
  gridData: string[][];
  /** Coordinate mappings */
  coordinates: {
    width: number;
    height: number;
    gridSize: number;
  };
}

/**
 * Render battlefield as ASCII grid with legend.
 * 
 * Priority order (what shows on grid):
 * 1. Creatures/players (always visible)
 * 2. Items (lootable objects)
 * 3. Objects (furniture, obstacles)
 * 4. Terrain (base layer)
 */
export function renderBattlefield(
  map: CombatMap,
  entities: BattlefieldEntity[],
  mappings: CharacterMappings = DEFAULT_MAPPINGS,
): RenderedBattlefield {
  const { width, height, gridSize } = map;
  const gridWidth = Math.ceil(width / gridSize);
  const gridHeight = Math.ceil(height / gridSize);

  // Initialize grid with terrain
  const grid: string[][] = [];
  for (let y = 0; y < gridHeight; y++) {
    grid[y] = [];
    for (let x = 0; x < gridWidth; x++) {
      // Find cell at this position
      const cellX = x * gridSize;
      const cellY = y * gridSize;
      const cell = map.cells.find(c => c.position.x === cellX && c.position.y === cellY);
      
      if (cell) {
        // Check for objects in cell first
        if (cell.objects && cell.objects.length > 0) {
          // Use first object's character
          const objChar = mappings.objects?.[cell.objects[0].toLowerCase()];
          grid[y][x] = objChar || mappings.terrain[cell.terrain] || mappings.empty;
        } else {
          grid[y][x] = mappings.terrain[cell.terrain] || mappings.empty;
        }
      } else {
        grid[y][x] = mappings.empty;
      }
    }
  }

  // Place map entities (items, static objects)
  for (const entity of map.entities) {
    const gridX = Math.floor(entity.position.x / gridSize);
    const gridY = Math.floor(entity.position.y / gridSize);
    
    if (gridX >= 0 && gridX < gridWidth && gridY >= 0 && gridY < gridHeight) {
      // Use entity type to determine character
      const char = entity.type === "item" ? "!" : 
                   entity.type === "object" ? "O" : 
                   "?";
      grid[gridY][gridX] = char;
    }
  }

  // Place battlefield entities (creatures - highest priority)
  for (const entity of entities) {
    const gridX = Math.floor(entity.position.x / gridSize);
    const gridY = Math.floor(entity.position.y / gridSize);
    
    if (gridX >= 0 && gridX < gridWidth && gridY >= 0 && gridY < gridHeight) {
      grid[gridY][gridX] = entity.character;
    }
  }

  // Build ASCII string with coordinate axes
  const lines: string[] = [];
  
  // Top axis (X coordinates)
  const topAxis = "     " + Array.from({ length: gridWidth }, (_, i) => i % 10).join("");
  lines.push(topAxis);
  
  // Grid rows with Y coordinate labels
  for (let y = 0; y < gridHeight; y++) {
    const yLabel = y.toString().padStart(3, " ");
    const row = "  " + yLabel + " " + grid[y].join("");
    lines.push(row);
  }

  // Build legend
  const legendLines: string[] = ["", "Battlefield Legend:"];
  
  // Group entities by type
  const self = entities.filter(e => e.type === "self");
  const allies = entities.filter(e => e.type === "ally");
  const enemies = entities.filter(e => e.type === "enemy");
  const items = entities.filter(e => e.type === "item");
  const objects = entities.filter(e => e.type === "object");

  if (self.length > 0) {
    legendLines.push("");
    legendLines.push("You:");
    for (const e of self) {
      const pos = `(${Math.floor(e.position.x / gridSize)},${Math.floor(e.position.y / gridSize)})`;
      legendLines.push(`  ${e.character} ${pos} = ${e.description || e.name}`);
    }
  }

  if (allies.length > 0) {
    legendLines.push("");
    legendLines.push("Allies:");
    for (const e of allies) {
      const pos = `(${Math.floor(e.position.x / gridSize)},${Math.floor(e.position.y / gridSize)})`;
      legendLines.push(`  ${e.character} ${pos} = ${e.description || e.name}`);
    }
  }

  if (enemies.length > 0) {
    legendLines.push("");
    legendLines.push("Enemies:");
    for (const e of enemies) {
      const pos = `(${Math.floor(e.position.x / gridSize)},${Math.floor(e.position.y / gridSize)})`;
      legendLines.push(`  ${e.character} ${pos} = ${e.description || e.name}`);
    }
  }

  if (items.length > 0 || objects.length > 0) {
    legendLines.push("");
    legendLines.push("Objects & Items:");
    for (const e of [...objects, ...items]) {
      const pos = `(${Math.floor(e.position.x / gridSize)},${Math.floor(e.position.y / gridSize)})`;
      legendLines.push(`  ${e.character} ${pos} = ${e.description || e.name}`);
    }
  }

  // Add terrain key
  legendLines.push("");
  legendLines.push("Terrain Key:");
  legendLines.push(`  . = normal ground`);
  legendLines.push(`  # = wall (blocks movement and sight)`);
  legendLines.push(`  ~ = difficult terrain (half speed)`);
  legendLines.push(`  | = half cover (+2 AC)`);
  legendLines.push(`  H = three-quarters cover (+5 AC)`);
  legendLines.push(`  X = full cover (can't be targeted)`);

  return {
    grid: lines.join("\n"),
    legend: legendLines.join("\n"),
    gridData: grid,
    coordinates: {
      width: gridWidth,
      height: gridHeight,
      gridSize,
    },
  };
}

/**
 * Create battlefield entity from combatant data.
 */
export function createCombatantEntity(
  combatant: {
    name: string;
    position: Position;
    hpCurrent: number;
    hpMax: number;
    faction?: string;
  },
  character: string,
  isSelf: boolean,
  playerFaction: string,
): BattlefieldEntity {
  const hpPercent = Math.round((combatant.hpCurrent / combatant.hpMax) * 100);
  const hpDesc = `${combatant.hpCurrent}/${combatant.hpMax} HP (${hpPercent}%)`;
  
  const isAlly = combatant.faction === playerFaction;
  const type = isSelf ? "self" : isAlly ? "ally" : "enemy";

  return {
    id: combatant.name,
    character,
    name: combatant.name,
    position: combatant.position,
    description: `${combatant.name} (${hpDesc})`,
    type,
  };
}
