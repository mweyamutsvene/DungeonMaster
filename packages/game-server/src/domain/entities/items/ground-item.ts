import type { Position } from "../../rules/movement.js";
import type { CharacterItemInstance } from "./magic-item.js";

/**
 * How this item ended up on the ground.
 */
export type GroundItemSource = "thrown" | "dropped" | "preplaced" | "loot";

/**
 * A weapon or item on the battlefield ground that can be picked up.
 * Stored as a MapEntity (type: "item") with extended metadata.
 */
export interface GroundItem {
  /** Unique ID for this ground item instance */
  id: string;
  /** Display name (e.g. "Javelin", "Dart") */
  name: string;
  /** Position on the map grid */
  position: Position;
  /** How it ended up on the ground */
  source: GroundItemSource;
  /** Combatant ID that dropped/threw it (undefined for preplaced) */
  droppedBy?: string;
  /** Combat round in which it was dropped */
  round?: number;
  /**
   * Weapon stats so the item can be used as a weapon when picked up.
   * Matches the shape stored in character sheet attacks[].
   */
  weaponStats?: {
    name: string;
    kind: "melee" | "ranged";
    range?: string;
    attackBonus: number;
    damage: { diceCount: number; diceSides: number; modifier: number };
    versatileDamage?: { diceSides: number };
    damageType?: string;
    properties?: string[];
    mastery?: string;
  };
  /**
   * Non-weapon item data so the item goes into inventory when picked up.
   * Used for consumables, potions, and other loot.
   */
  inventoryItem?: CharacterItemInstance;
}
