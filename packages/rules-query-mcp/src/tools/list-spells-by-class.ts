import { listSpellsByClass } from '../catalog-bridge.js';

/**
 * Tool: list_spells_by_class
 *
 * Returns all canonical spells available to a given class, optionally filtered
 * by level. Replaces SMEs reading multiple level-N.ts catalog files to compose
 * a class spell list.
 */
export const listSpellsByClassTool = {
  name: 'list_spells_by_class',
  description:
    'List all D&D 5e 2024 spells available to a class, optionally filtered by level. Useful when designing a new class feature, validating a spell list, or finding upcast candidates.',
  inputSchema: {
    type: 'object',
    properties: {
      classId: {
        type: 'string',
        description: 'Class identifier (case-insensitive): wizard, sorcerer, cleric, warlock, bard, druid, ranger, paladin, etc.',
      },
      level: {
        type: 'number',
        description: 'Optional: filter to spells of this level (0 = cantrip, 1-5 supported today).',
      },
    },
    required: ['classId'],
  },
} as const;

export function listSpellsByClassFn(args: { classId: string; level?: number }): unknown {
  const spells = listSpellsByClass(args.classId);
  const filtered = args.level !== undefined ? spells.filter(s => s.level === args.level) : spells;
  return {
    classId: args.classId,
    level: args.level,
    count: filtered.length,
    spells: filtered.map(s => ({
      name: s.name,
      level: s.level,
      school: s.school,
      castingTime: s.castingTime,
      concentration: s.concentration ?? false,
      ritual: s.ritual ?? false,
    })),
  };
}
