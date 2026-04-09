/**
 * D&D 5e Combat Map Types
 *
 * All type definitions and interfaces for the combat map system.
 * Part of the combat-map module family — see combat-map.ts for the re-export barrel.
 */

import type { Position } from "./movement.js";
import type { CombatZone } from "../entities/combat/zones.js";
import type { GroundItem } from "../entities/items/ground-item.js";

/**
 * Terrain type affects movement and cover.
 */
export type TerrainType =
  | "normal"           // Regular ground
  | "difficult"        // Rough terrain, costs 2ft per 1ft
  | "water"            // Requires swimming
  | "lava"             // Damages creatures
  | "wall"             // Impassable, blocks line of sight
  | "obstacle"         // Impassable, provides cover
  | "cover-half"       // Provides half cover (+2 AC)
  | "cover-three-quarters"  // Provides 3/4 cover (+5 AC)
  | "cover-full"       // Total cover (can't be targeted)
  // TODO: RULES-L3 — elevated terrain should grant advantage on attacks vs lower targets;
  //   pit terrain triggers DC 15 DEX save on entry, 1d6/10ft fall damage.
  //   See .github/prompts/plan-terrain-mechanics.prompt.md
  | "elevated"         // Higher ground (advantage on attacks)
  | "pit"              // Lower ground or hole
  | "hazard";          // Generic dangerous area

/**
 * Cover level for ranged attacks.
 */
export type CoverLevel = "none" | "half" | "three-quarters" | "full";

/**
 * D&D 5e 2024 Obscured Areas:
 * - Lightly Obscured: disadvantage on Perception checks relying on sight
 * - Heavily Obscured: creatures effectively Blinded when trying to see into/through it
 */
export type ObscuredLevel = "none" | "lightly" | "heavily";

/**
 * Map cell representing a 5ft x 5ft square.
 */
export interface MapCell {
  position: Position;
  terrain: TerrainType;
  /** Feet above base ground level for elevated terrain cells. */
  terrainElevation?: number;
  /** Pit depth in feet for pit terrain cells. */
  terrainDepth?: number;
  /** Whether line of sight can pass through */
  blocksLineOfSight: boolean;
  /** Whether creatures can move through */
  passable: boolean;
  /**
   * D&D 5e 2024 obscuration level for this cell.
   * Lightly obscured: disadvantage on Perception checks relying on sight.
   * Heavily obscured: creatures are effectively Blinded when seeing into/through.
   */
  obscured?: ObscuredLevel;
  /** Items or objects at this position */
  objects?: string[];
}

/**
 * Entity positioned on the map (creature or item).
 */
export interface MapEntity {
  id: string;
  type: "creature" | "item" | "object";
  position: Position;
  /** Size affects reach and space occupied */
  size?: "Tiny" | "Small" | "Medium" | "Large" | "Huge" | "Gargantuan";
  /** Faction for ally/enemy detection */
  faction?: string;
}

/**
 * Combat arena/battlefield map.
 */
export interface CombatMap {
  /** Unique identifier */
  id: string;
  /** Display name */
  name: string;
  /** Map dimensions in feet */
  width: number;
  height: number;
  /** Grid size in feet (typically 5) */
  gridSize: number;
  /** Terrain/obstacle data */
  cells: MapCell[];
  /** Entities on the map */
  entities: MapEntity[];
  /** Description for narrative */
  description?: string;
  /** Custom character mappings for ASCII rendering (optional) */
  characterMappings?: {
    terrain?: Record<string, string>;
    objects?: Record<string, string>;
  };
  /** Active combat zones (spell areas, auras, etc.) */
  zones?: CombatZone[];
  /** Items on the ground (thrown, dropped, pre-placed) */
  groundItems?: GroundItem[];
  /** Optional rule: when true, flanking grants advantage on melee attacks */
  flankingEnabled?: boolean;
}
