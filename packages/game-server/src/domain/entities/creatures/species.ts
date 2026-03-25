/**
 * Species definitions for D&D 5e 2024.
 *
 * Focused on combat-relevant traits only:
 * - Darkvision range
 * - Damage resistances
 * - Saving throw advantages (condition-specific or ability-specific)
 *
 * Layer: Domain (pure data, no side effects).
 */

/** A saving throw advantage granted by a species trait. */
export interface SpeciesSaveAdvantage {
  /** The condition the advantage applies against (e.g. "charmed", "frightened", "poisoned"). */
  readonly againstCondition?: string;
  /** For broader advantages (e.g. Gnome Cunning: INT/WIS/CHA saves vs magic). */
  readonly abilities?: readonly string[];
  /** Optional qualifier (e.g. "magic" for Gnome Cunning). */
  readonly qualifier?: string;
}

/** Combat-relevant species definition. */
export interface SpeciesDefinition {
  readonly name: string;
  readonly size: "Small" | "Medium";
  readonly speed: number;
  readonly darkvisionRange: number;
  readonly damageResistances: readonly string[];
  readonly saveAdvantages: readonly SpeciesSaveAdvantage[];
}

// ── Human ─────────────────────────────────────────────────
export const HUMAN: SpeciesDefinition = {
  name: "Human",
  size: "Medium",
  speed: 30,
  darkvisionRange: 0,
  damageResistances: [],
  saveAdvantages: [],
};

// ── Elf ───────────────────────────────────────────────────
export const ELF: SpeciesDefinition = {
  name: "Elf",
  size: "Medium",
  speed: 30,
  darkvisionRange: 60,
  damageResistances: [],
  saveAdvantages: [
    { againstCondition: "charmed" },
  ],
};

// ── Dwarf ─────────────────────────────────────────────────
export const DWARF: SpeciesDefinition = {
  name: "Dwarf",
  size: "Medium",
  speed: 30,
  darkvisionRange: 60,
  damageResistances: ["poison"],
  saveAdvantages: [
    { againstCondition: "poisoned" },
  ],
};

// ── Halfling ──────────────────────────────────────────────
export const HALFLING: SpeciesDefinition = {
  name: "Halfling",
  size: "Small",
  speed: 30,
  darkvisionRange: 0,
  damageResistances: [],
  saveAdvantages: [
    { againstCondition: "frightened" },
  ],
};

// ── Dragonborn ────────────────────────────────────────────
// D&D 2024: Dragonborn pick an ancestry which determines damage type.
// Default to fire; the actual ancestry would be stored on the sheet.
export const DRAGONBORN: SpeciesDefinition = {
  name: "Dragonborn",
  size: "Medium",
  speed: 30,
  darkvisionRange: 60,
  damageResistances: [], // ancestry-dependent, applied from sheet.dragonbornAncestry
  saveAdvantages: [],
};

// ── Gnome ─────────────────────────────────────────────────
export const GNOME: SpeciesDefinition = {
  name: "Gnome",
  size: "Small",
  speed: 30,
  darkvisionRange: 60,
  damageResistances: [],
  saveAdvantages: [
    { abilities: ["intelligence", "wisdom", "charisma"], qualifier: "magic" },
  ],
};

// ── Orc ───────────────────────────────────────────────────
export const ORC: SpeciesDefinition = {
  name: "Orc",
  size: "Medium",
  speed: 30,
  darkvisionRange: 120,
  damageResistances: [],
  saveAdvantages: [],
};

// ── Tiefling ──────────────────────────────────────────────
export const TIEFLING: SpeciesDefinition = {
  name: "Tiefling",
  size: "Medium",
  speed: 30,
  darkvisionRange: 60,
  damageResistances: ["fire"],
  saveAdvantages: [],
};
