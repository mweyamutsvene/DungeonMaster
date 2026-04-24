/**
 * Bridge to the canonical spell catalog in @dungeonmaster/game-server.
 *
 * Imports the source TypeScript directly via relative path. This works because
 * tsx resolves `.js` import specifiers to `.ts` files at runtime. Keeps the
 * MCP server in sync with the game-server engine without a build step.
 *
 * If you need data from a different domain area (class features, creatures,
 * etc.), add a sibling bridge file rather than reaching into game-server source
 * from each tool file.
 */

export {
  getCanonicalSpell,
  listSpellsByLevel,
  listSpellsByClass,
  listSpellsBySchool,
  type CanonicalSpell,
  type SpellSchool,
} from '../../game-server/src/domain/entities/spells/catalog/index.js';
