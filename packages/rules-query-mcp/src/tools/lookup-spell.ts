import { getCanonicalSpell } from '../catalog-bridge.js';

/**
 * Tool: lookup_spell
 *
 * Returns the canonical entry for a spell by exact name (case-insensitive).
 * Replaces SMEs grep'ing through `domain/entities/spells/catalog/level-N.ts`
 * to find a spell's level, slots, components, damage, save DC source, duration,
 * concentration flag, etc.
 */
export const lookupSpellTool = {
  name: 'lookup_spell',
  description:
    'Look up a D&D 5e 2024 spell by exact name (case-insensitive). Returns the canonical catalog entry with level, school, casting time, range, components, class lists, concentration, ritual flag, effects, and upcast scaling. Returns null if not found.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Spell name, e.g. "Fireball" or "fireball"' },
    },
    required: ['name'],
  },
} as const;

export function lookupSpell(args: { name: string }): unknown {
  const spell = getCanonicalSpell(args.name);
  if (!spell) {
    return { found: false, name: args.name };
  }
  return { found: true, spell };
}
