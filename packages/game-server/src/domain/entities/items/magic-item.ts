/**
 * Magic item type system for D&D 5e 2024.
 *
 * Designed to support items that can:
 * - Add flat bonuses to attacks, damage, and AC
 * - Grant additional abilities/actions
 * - Impose conditions or effects on hit
 * - Grant access to spells (with charges or at-will)
 * - Require attunement (with optional prerequisites)
 * - Have charges that recharge on a schedule
 * - Apply ActiveEffects when consumed (potions)
 *
 * This module defines the DATA MODEL only — no runtime behavior.
 * Application-layer services interpret these definitions to modify combat operations.
 */

import type { EffectType, EffectTarget, EffectDuration, DiceValue } from '../combat/effects.js';
import type { Ability } from '../core/ability-scores.js';

// ─── Rarity ──────────────────────────────────────────────────────────────

export type ItemRarity = "common" | "uncommon" | "rare" | "very-rare" | "legendary" | "artifact";

// ─── Magic item categories (per PHB) ─────────────────────────────────────

export type MagicItemCategory =
  | "armor"
  | "potion"
  | "ring"
  | "rod"
  | "scroll"
  | "staff"
  | "wand"
  | "weapon"
  | "wondrous-item";

// ─── Attunement ──────────────────────────────────────────────────────────

export interface AttunementRequirement {
  /** Whether the item requires attunement at all. */
  required: boolean;
  /** Optional prerequisite: must be one of these classes. */
  classRestriction?: string[];
  /** Optional prerequisite: must be a spellcaster. */
  requiresSpellcasting?: boolean;
  /** Optional prerequisite: minimum level. */
  minimumLevel?: number;
}

// ─── Action costs (per D&D 5e 2024) ──────────────────────────────────────

/**
 * Declares the combat action-economy cost for using / giving / administering /
 * equipping an item. Per-item values override category defaults from
 * `getCategoryActionCostDefaults()` in `item-action-defaults.ts`.
 *
 * D&D 5e 2024 references:
 * - Potion of Healing (self-drink): Bonus Action (PHB/Equipment).
 * - Goodberry (eat one berry): Bonus Action (spell text).
 * - Administer potion to another creature: Utilize Action (default); spells may override.
 * - Hand an item to a willing ally within reach: free object interaction (1/turn).
 * - Draw / stow weapon: free object interaction OR piggybacked on Attack action.
 * - Shield: Utilize action to don/doff mid-combat.
 * - Armor: out-of-combat only (minute-scale don/doff per table).
 * - Generic magic item: Utilize action unless item description overrides.
 */
export interface ItemActionCosts {
  /**
   * Self-use cost (drink potion, eat berry, read scroll).
   * - `'action'` / `'utilize'` → consume action slot.
   * - `'bonus'` → consume bonus action.
   * - `'none'` → item cannot be self-used in combat.
   */
  use?: 'action' | 'bonus' | 'utilize' | 'none';

  /**
   * Hand to a willing, conscious ally within reach.
   * - `'free-object-interaction'` → consume the per-turn free object interaction (degrades to Utilize action when already used).
   * - `'utilize'` → always costs an action.
   * - `'none'` → item cannot be transferred in combat.
   */
  give?: 'free-object-interaction' | 'utilize' | 'none';

  /**
   * Force-feed / administer to ally (works on unconscious).
   * 2024 RAW default for potions = Utilize action. Spells may override
   * (e.g., Goodberry = Bonus Action per spell text).
   */
  administer?: 'action' | 'bonus' | 'utilize' | 'none';

  /**
   * Equip cost in combat.
   * - `'free-object-interaction'` → weapons (draw / stow).
   * - `'utilize'` → shields.
   * - `'out-of-combat-only'` → armor (rejected mid-combat).
   */
  equip?: 'free-object-interaction' | 'utilize' | 'out-of-combat-only';

  /** Armor only: minutes required to don (equip). */
  donMinutes?: number;
  /** Armor only: minutes required to doff (unequip). */
  doffMinutes?: number;
}

// ─── Stat modifiers ──────────────────────────────────────────────────────

/**
 * A numeric modifier applied to a specific game stat.
 *
 * Examples:
 * - +1 weapon: `{ target: "attackRolls", value: 1 }` + `{ target: "damageRolls", value: 1 }`
 * - Cloak of Protection: `{ target: "ac", value: 1 }` + `{ target: "savingThrows", value: 1 }`
 * - Amulet of Health: `{ target: "abilityScore", ability: "constitution", setTo: 19 }`
 */
export interface ItemStatModifier {
  target:
    | "ac"
    | "attackRolls"
    | "damageRolls"
    | "savingThrows"
    | "abilityScore"
    | "spellAttack"
    | "spellSaveDC"
    | "speed"
    | "hp"
    | "initiative";
  /** Additive bonus (e.g. +1, +2). */
  value?: number;
  /** Set the stat to this value (e.g. Amulet of Health sets CON to 19). */
  setTo?: number;
  /** For abilityScore target, which ability. */
  ability?: string;
  /** Scope limiter: "melee" | "ranged" | "spell" | "all". Default: "all". */
  scope?: "melee" | "ranged" | "spell" | "all";
}

// ─── Granted abilities ───────────────────────────────────────────────────

/**
 * An ability granted by wearing/attuning to a magic item.
 *
 * Examples:
 * - Boots of Speed: action to activate, doubles speed for 10 minutes
 * - Staff of the Magi: grants multiple spell castings
 * - Helm of Brilliance: can cast specific spells
 */
export interface ItemGrantedAbility {
  /** Display name (e.g. "Boots of Speed — Activate"). */
  name: string;
  /** Description text. */
  description: string;
  /** Action economy: "action" | "bonus" | "reaction" | "free". */
  economy: "action" | "bonus" | "reaction" | "free";
  /** How many charges this ability costs (0 = unlimited). */
  chargeCost: number;
  /** Per-rest usage limits (if not charge-based). */
  usesPerRest?: { count: number; restType: "short" | "long" };
}

// ─── Granted spells ──────────────────────────────────────────────────────

/**
 * A spell that can be cast from a magic item.
 *
 * Examples:
 * - Staff of Fire: Fireball (3 charges), Wall of Fire (4 charges)
 * - Wand of Magic Missiles: Magic Missile at various levels
 * - Ring of Spell Storing: stores spells cast into it
 */
export interface ItemGrantedSpell {
  /** Spell name (must match spell definitions in the system). */
  spellName: string;
  /** Spell level when cast from this item (may differ from base level). */
  castLevel: number;
  /** Charges consumed to cast (0 = at-will). */
  chargeCost: number;
  /** Override the save DC (if not provided, uses item's DC or user's DC). */
  saveDC?: number;
  /** Override the attack bonus (if not provided, uses item's bonus or user's bonus). */
  attackBonus?: number;
}

// ─── On-hit effects ──────────────────────────────────────────────────────

/**
 * An effect that triggers on a successful hit with a magic weapon.
 *
 * Examples:
 * - Flame Tongue: extra 2d6 fire damage
 * - Sword of Wounding: prevents HP recovery until short rest
 * - Mace of Disruption: extra 2d6 radiant damage vs undead + fiends
 */
export interface ItemOnHitEffect {
  /** Extra damage dice. */
  extraDamage?: {
    diceCount: number;
    diceSides: number;
    type: string;
  };
  /** Only triggers against these creature types (empty = all). */
  creatureTypeRestriction?: string[];
  /** Condition to apply on hit. */
  applyCondition?: string;
  /** Save to avoid the effect. */
  save?: { ability: string; dc: number };
  /** Description of special behavior not captured by structured fields. */
  description?: string;
}

// ─── Charges ─────────────────────────────────────────────────────────────

export interface ItemCharges {
  /** Maximum charges. */
  max: number;
  /** Recharge amount (e.g. "1d6 + 1" → use rechargeRoll). */
  rechargeAmount?: number;
  /** Dice-based recharge (e.g. 1d6+1 at dawn). */
  rechargeRoll?: { diceCount: number; diceSides: number; modifier: number };
  /** When charges recharge. */
  rechargeTiming: "dawn" | "dusk" | "shortRest" | "longRest" | "never";
  /** If all charges spent, roll d20: on 1, item is destroyed. */
  destroyOnEmpty?: boolean;
}

// ─── Damage resistances/immunities from items ────────────────────────────

export interface ItemDamageModifier {
  type: string;
  modifier: "resistance" | "immunity" | "vulnerability";
}

// ─── Potion effects (consumed-item effects) ──────────────────────────────

/**
 * Template for an ActiveEffect that a potion applies when consumed.
 * Omits runtime fields (id, appliedAtRound, appliedAtTurnIndex) since those
 * are filled in at application time.
 */
export interface PotionEffectTemplate {
  type: EffectType;
  target: EffectTarget;
  value?: number;
  diceValue?: DiceValue;
  ability?: Ability;
  damageType?: string;
  duration: EffectDuration;
  roundsRemaining?: number;
  source?: string;
  description?: string;
  conditionName?: string;
  triggerAt?: 'start_of_turn' | 'end_of_turn' | 'on_voluntary_move';
}

/**
 * Declares what a potion does when consumed.
 * Used by the generic item-use applicator in the application layer.
 */
export interface PotionEffect {
  /** ActiveEffects to apply to the drinker. */
  effects?: PotionEffectTemplate[];
  /** Instant healing (dice + modifier). */
  healing?: { diceCount: number; diceSides: number; modifier: number };
  /** Instant damage (e.g. Potion of Poison). */
  damage?: { diceCount: number; diceSides: number; damageType: string };
  /** Conditions to apply on the drinker. */
  applyConditions?: Array<{ condition: string; duration: string; roundsRemaining?: number }>;
  /** Conditions to remove from the drinker. */
  removeConditions?: string[];
  /** Saving throw to resist the damage/conditions (e.g. Potion of Poison). */
  save?: { ability: Ability; dc: number; effectOnFail: string };
  /** Temporary HP to grant (added to resources.tempHp, not stacking). */
  tempHp?: number;
}

// ─── Main magic item definition ──────────────────────────────────────────

/**
 * Complete magic item definition.
 *
 * This is the static definition of what a magic item CAN do.
 * Runtime state (current charges, attunement status) is tracked
 * separately on the character's inventory.
 */
export interface MagicItemDefinition {
  /** Unique identifier (slug). */
  id: string;
  /** Display name. */
  name: string;
  /** Item category. */
  category: MagicItemCategory;
  /** Rarity tier. */
  rarity: ItemRarity;
  /** Attunement requirements. */
  attunement: AttunementRequirement;
  /** Description/flavor text. */
  description: string;

  // ── What the item does ──

  /** Flat stat modifiers (e.g. +1 to attack/damage). */
  modifiers?: ItemStatModifier[];
  /** Abilities granted by the item. */
  grantedAbilities?: ItemGrantedAbility[];
  /** Spells that can be cast from the item. */
  grantedSpells?: ItemGrantedSpell[];
  /** Effects that trigger on weapon hit. */
  onHitEffects?: ItemOnHitEffect[];
  /** Charge system (if the item uses charges). */
  charges?: ItemCharges;
  /** Damage resistances/immunities granted by the item. */
  damageModifiers?: ItemDamageModifier[];
  /** Potion effects applied when this item is consumed. */
  potionEffects?: PotionEffect;
  /**
   * Action-economy costs for use / give / administer / equip.
   * Per-item values override category defaults from `resolveItemActionCosts`.
   */
  actionCosts?: ItemActionCosts;

  // ── Base item reference (for weapons/armor) ──

  /** If this is a weapon variant, the base weapon name (e.g. "Longsword" for "+1 Longsword"). */
  baseWeapon?: string;
  /** If this is an armor variant, the base armor name (e.g. "Plate" for "Adamantine Plate"). */
  baseArmor?: string;

  /** Whether this item is cursed (curse details in description). */
  cursed?: boolean;
}

// ─── Runtime item state (on a character's inventory) ─────────────────────

/**
 * An item instance that a character owns.
 * Combines the static definition with mutable runtime state.
 */
export interface CharacterItemInstance {
  /** Reference to the magic item definition ID (or undefined for mundane items). */
  magicItemId?: string;
  /** Display name (may differ from definition for custom names). */
  name: string;
  /** Whether this item is currently equipped. */
  equipped: boolean;
  /** Whether this item is currently attuned. */
  attuned: boolean;
  /** Current charges remaining (undefined if item has no charge system). */
  currentCharges?: number;
  /** Quantity (for stackable items like potions, ammunition). */
  quantity: number;
  /** Item slot: where this item is equipped. */
  slot?: ItemSlot;
  /**
   * For runtime-created items with expiry (e.g., Goodberry berries).
   * Decremented by `sweepExpiredItems` on long rest and at combat start;
   * item is removed from inventory when this reaches 0.
   * Absent = never expires.
   *
   * D&D 5e 2024 Goodberry RAW: 24 hours. We approximate via `1` long rest
   * until an in-world clock is implemented.
   */
  longRestsRemaining?: number;
}

/**
 * Equipment slots for tracking what's equipped where.
 */
export type ItemSlot =
  | "main-hand"
  | "off-hand"
  | "armor"
  | "shield"
  | "head"
  | "neck"
  | "ring-1"
  | "ring-2"
  | "cloak"
  | "boots"
  | "gloves"
  | "belt"
  | "ammunition"
  | "pack";
