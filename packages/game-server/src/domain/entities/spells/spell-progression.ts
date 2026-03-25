/**
 * Spell Slot Progression Tables — D&D 5e 2024.
 *
 * Pure data: spell slots per class level for full casters, half casters, and Warlock Pact Magic.
 *
 * Layer: Domain (pure data, no side effects).
 */

import type { CharacterClassId } from "../classes/class-definition.js";

/** Spell slots keyed by spell level (1–9) → number of slots. */
export type SpellSlotTable = Readonly<Record<number, number>>;

// ── Full Caster Table (Wizard, Cleric, Bard, Druid, Sorcerer) ──────────
// Row index = class level (1–20), columns = spell levels 1–9
const FULL_CASTER_SLOTS: readonly SpellSlotTable[] = [
  /* placeholder index 0 */ {},
  /* Level  1 */ { 1: 2 },
  /* Level  2 */ { 1: 3 },
  /* Level  3 */ { 1: 4, 2: 2 },
  /* Level  4 */ { 1: 4, 2: 3 },
  /* Level  5 */ { 1: 4, 2: 3, 3: 2 },
  /* Level  6 */ { 1: 4, 2: 3, 3: 3 },
  /* Level  7 */ { 1: 4, 2: 3, 3: 3, 4: 1 },
  /* Level  8 */ { 1: 4, 2: 3, 3: 3, 4: 2 },
  /* Level  9 */ { 1: 4, 2: 3, 3: 3, 4: 3, 5: 1 },
  /* Level 10 */ { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2 },
  /* Level 11 */ { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1 },
  /* Level 12 */ { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1 },
  /* Level 13 */ { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1, 7: 1 },
  /* Level 14 */ { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1, 7: 1 },
  /* Level 15 */ { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1, 7: 1, 8: 1 },
  /* Level 16 */ { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1, 7: 1, 8: 1 },
  /* Level 17 */ { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1, 7: 1, 8: 1, 9: 1 },
  /* Level 18 */ { 1: 4, 2: 3, 3: 3, 4: 3, 5: 3, 6: 1, 7: 1, 8: 1, 9: 1 },
  /* Level 19 */ { 1: 4, 2: 3, 3: 3, 4: 3, 5: 3, 6: 2, 7: 1, 8: 1, 9: 1 },
  /* Level 20 */ { 1: 4, 2: 3, 3: 3, 4: 3, 5: 3, 6: 2, 7: 2, 8: 1, 9: 1 },
];

// ── Half Caster Table (Paladin, Ranger) ─────────────────────────────────
// Spellcasting starts at level 2
const HALF_CASTER_SLOTS: readonly SpellSlotTable[] = [
  /* placeholder index 0 */ {},
  /* Level  1 */ {},
  /* Level  2 */ { 1: 2 },
  /* Level  3 */ { 1: 3 },
  /* Level  4 */ { 1: 3 },
  /* Level  5 */ { 1: 4, 2: 2 },
  /* Level  6 */ { 1: 4, 2: 2 },
  /* Level  7 */ { 1: 4, 2: 3 },
  /* Level  8 */ { 1: 4, 2: 3 },
  /* Level  9 */ { 1: 4, 2: 3, 3: 2 },
  /* Level 10 */ { 1: 4, 2: 3, 3: 2 },
  /* Level 11 */ { 1: 4, 2: 3, 3: 3 },
  /* Level 12 */ { 1: 4, 2: 3, 3: 3 },
  /* Level 13 */ { 1: 4, 2: 3, 3: 3, 4: 1 },
  /* Level 14 */ { 1: 4, 2: 3, 3: 3, 4: 1 },
  /* Level 15 */ { 1: 4, 2: 3, 3: 3, 4: 2 },
  /* Level 16 */ { 1: 4, 2: 3, 3: 3, 4: 2 },
  /* Level 17 */ { 1: 4, 2: 3, 3: 3, 4: 3, 5: 1 },
  /* Level 18 */ { 1: 4, 2: 3, 3: 3, 4: 3, 5: 1 },
  /* Level 19 */ { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2 },
  /* Level 20 */ { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2 },
];

// ── Warlock Pact Magic ──────────────────────────────────────────────────
// Warlock uses a unique pact magic system: fewer slots but all at the same level.
interface PactMagicEntry {
  /** Number of pact magic slots. */
  readonly slots: number;
  /** Spell slot level (all slots are the same level). */
  readonly slotLevel: number;
}

const PACT_MAGIC: readonly PactMagicEntry[] = [
  /* placeholder index 0 */ { slots: 0, slotLevel: 0 },
  /* Level  1 */ { slots: 1, slotLevel: 1 },
  /* Level  2 */ { slots: 2, slotLevel: 1 },
  /* Level  3 */ { slots: 2, slotLevel: 2 },
  /* Level  4 */ { slots: 2, slotLevel: 2 },
  /* Level  5 */ { slots: 2, slotLevel: 3 },
  /* Level  6 */ { slots: 2, slotLevel: 3 },
  /* Level  7 */ { slots: 2, slotLevel: 4 },
  /* Level  8 */ { slots: 2, slotLevel: 4 },
  /* Level  9 */ { slots: 2, slotLevel: 5 },
  /* Level 10 */ { slots: 2, slotLevel: 5 },
  /* Level 11 */ { slots: 3, slotLevel: 5 },
  /* Level 12 */ { slots: 3, slotLevel: 5 },
  /* Level 13 */ { slots: 3, slotLevel: 5 },
  /* Level 14 */ { slots: 3, slotLevel: 5 },
  /* Level 15 */ { slots: 3, slotLevel: 5 },
  /* Level 16 */ { slots: 3, slotLevel: 5 },
  /* Level 17 */ { slots: 4, slotLevel: 5 },
  /* Level 18 */ { slots: 4, slotLevel: 5 },
  /* Level 19 */ { slots: 4, slotLevel: 5 },
  /* Level 20 */ { slots: 4, slotLevel: 5 },
];

// ── Cantrips Known ──────────────────────────────────────────────────────
// Standard cantrip progression for full casters
const FULL_CASTER_CANTRIPS: readonly number[] = [
  /* placeholder index 0 */ 0,
  /* Level  1 */ 3,
  /* Level  2 */ 3,
  /* Level  3 */ 3,
  /* Level  4 */ 4,
  /* Level  5 */ 4,
  /* Level  6 */ 4,
  /* Level  7 */ 4,
  /* Level  8 */ 4,
  /* Level  9 */ 4,
  /* Level 10 */ 5,
  /* Level 11 */ 5,
  /* Level 12 */ 5,
  /* Level 13 */ 5,
  /* Level 14 */ 5,
  /* Level 15 */ 5,
  /* Level 16 */ 5,
  /* Level 17 */ 5,
  /* Level 18 */ 5,
  /* Level 19 */ 5,
  /* Level 20 */ 5,
];

const WARLOCK_CANTRIPS: readonly number[] = [
  /* placeholder index 0 */ 0,
  /* Level  1 */ 2,
  /* Level  2 */ 2,
  /* Level  3 */ 2,
  /* Level  4 */ 3,
  /* Level  5 */ 3,
  /* Level  6 */ 3,
  /* Level  7 */ 3,
  /* Level  8 */ 3,
  /* Level  9 */ 3,
  /* Level 10 */ 4,
  /* Level 11 */ 4,
  /* Level 12 */ 4,
  /* Level 13 */ 4,
  /* Level 14 */ 4,
  /* Level 15 */ 4,
  /* Level 16 */ 4,
  /* Level 17 */ 4,
  /* Level 18 */ 4,
  /* Level 19 */ 4,
  /* Level 20 */ 4,
];

// ── Class → Caster Type Mapping ─────────────────────────────────────────

type CasterType = "full" | "half" | "pact" | "none";

const CASTER_TYPE: Record<CharacterClassId, CasterType> = {
  wizard: "full",
  cleric: "full",
  bard: "full",
  druid: "full",
  sorcerer: "full",
  paladin: "half",
  ranger: "half",
  warlock: "pact",
  fighter: "none",
  barbarian: "none",
  monk: "none",
  rogue: "none",
};

function clampLevel(level: number): number {
  return Math.max(1, Math.min(20, Math.floor(level)));
}

/**
 * Get spell slots for a class at a given level.
 *
 * Returns a record mapping spell level (1–9) → number of slots.
 * Non-casters return an empty record.
 * Warlock Pact Magic returns all slots at the same level.
 */
export function getSpellSlots(classId: CharacterClassId, level: number): SpellSlotTable {
  const clamped = clampLevel(level);
  const type = CASTER_TYPE[classId];

  switch (type) {
    case "full":
      return FULL_CASTER_SLOTS[clamped] ?? {};
    case "half":
      return HALF_CASTER_SLOTS[clamped] ?? {};
    case "pact": {
      const entry = PACT_MAGIC[clamped];
      if (!entry || entry.slots === 0) return {};
      return { [entry.slotLevel]: entry.slots };
    }
    case "none":
      return {};
  }
}

/**
 * Get the number of cantrips known for a class at a given level.
 * Non-casters return 0.
 */
export function getCantripsKnown(classId: CharacterClassId, level: number): number {
  const clamped = clampLevel(level);
  const type = CASTER_TYPE[classId];

  switch (type) {
    case "full":
      return FULL_CASTER_CANTRIPS[clamped] ?? 0;
    case "pact":
      return WARLOCK_CANTRIPS[clamped] ?? 0;
    case "half":
      return 0; // Half casters learn cantrips differently or not at all in Basic Rules
    case "none":
      return 0;
  }
}

/**
 * Get the Warlock pact slot level at a given warlock level.
 * Returns 0 for non-warlocks or invalid levels.
 */
export function getPactSlotLevel(level: number): number {
  const clamped = clampLevel(level);
  return PACT_MAGIC[clamped]?.slotLevel ?? 0;
}

/**
 * Get the caster type for a class.
 */
export function getCasterType(classId: CharacterClassId): CasterType {
  return CASTER_TYPE[classId];
}
