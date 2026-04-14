/**
 * Species Registry — look up species traits by name.
 *
 * Layer: Domain (pure data, no side effects).
 */

import type { SpeciesDefinition } from "./species.js";
import {
  HUMAN,
  ELF,
  DWARF,
  HALFLING,
  DRAGONBORN,
  GNOME,
  ORC,
  TIEFLING,
  AASIMAR,
  GOLIATH,
} from "./species.js";

const SPECIES_MAP: ReadonlyMap<string, SpeciesDefinition> = new Map(
  [HUMAN, ELF, DWARF, HALFLING, DRAGONBORN, GNOME, ORC, TIEFLING, AASIMAR, GOLIATH].map(
    (s) => [s.name.toLowerCase(), s] as const,
  ),
);

// Also register common alternative names
const ALIASES: ReadonlyMap<string, SpeciesDefinition> = new Map([
  ["half-elf", ELF],       // half-elves share elven darkvision + Fey Ancestry
  ["half-orc", ORC],       // half-orcs share orcish darkvision
  ["halfelf", ELF],
  ["halforc", ORC],
]);

/**
 * Look up species traits by name. Case-insensitive.
 * Returns undefined if the species is not in the registry.
 */
export function getSpeciesTraits(speciesName: string): SpeciesDefinition | undefined {
  const key = speciesName.trim().toLowerCase();
  return SPECIES_MAP.get(key) ?? ALIASES.get(key);
}

/**
 * Get all registered species definitions.
 */
export function getAllSpecies(): readonly SpeciesDefinition[] {
  return [...SPECIES_MAP.values()];
}
