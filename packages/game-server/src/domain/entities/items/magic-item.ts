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
 *
 * This module defines the DATA MODEL only — no runtime behavior.
 * Application-layer services interpret these definitions to modify combat operations.
 */

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
