/**
 * Session Routes - Barrel Index
 *
 * Composes all session route modules into a single registration function.
 * This replaces the monolithic 2,400+ line sessions.ts with focused modules.
 *
 * Route Modules:
 * - session-crud.ts: Session creation and retrieval
 * - session-characters.ts: Character management
 * - session-creatures.ts: Monster and NPC management
 * - session-combat.ts: Core combat flow
 * - session-tactical.ts: Tactical view and queries
 * - session-tabletop.ts: Tabletop combat with manual dice
 * - session-actions.ts: Programmatic action execution
 * - session-llm.ts: LLM intent parsing and narrative
 * - session-events.ts: Event streaming (SSE)
 * - session-inventory.ts: Character inventory management
 */

import type { FastifyInstance } from "fastify";
import type { SessionRouteDeps } from "./types.js";

import { registerSessionCrudRoutes } from "./session-crud.js";
import { registerSessionCharacterRoutes } from "./session-characters.js";
import { registerSessionCreatureRoutes } from "./session-creatures.js";
import { registerSessionCombatRoutes } from "./session-combat.js";
import { registerSessionTacticalRoutes } from "./session-tactical.js";
import { registerSessionTabletopRoutes } from "./session-tabletop.js";
import { registerSessionActionsRoutes } from "./session-actions.js";
import { registerSessionLlmRoutes } from "./session-llm.js";
import { registerSessionEventsRoutes } from "./session-events.js";
import { registerSessionInventoryRoutes } from "./session-inventory.js";

// Re-export types for external use
export type { SessionRouteDeps } from "./types.js";

/**
 * Register all session-related routes.
 *
 * This function composes all the focused route modules, maintaining the same
 * external API as the original monolithic sessions.ts file.
 */
export function registerSessionRoutes(app: FastifyInstance, deps: SessionRouteDeps): void {
  registerSessionCrudRoutes(app, deps);
  registerSessionCharacterRoutes(app, deps);
  registerSessionCreatureRoutes(app, deps);
  registerSessionCombatRoutes(app, deps);
  registerSessionTacticalRoutes(app, deps);
  registerSessionTabletopRoutes(app, deps);
  registerSessionActionsRoutes(app, deps);
  registerSessionLlmRoutes(app, deps);
  registerSessionEventsRoutes(app, deps);
  registerSessionInventoryRoutes(app, deps);
}
