/**
 * Session Routes - Shared Types
 *
 * Common type definitions and dependencies shared across session route modules.
 */

import type { GameSessionService } from "../../../../application/services/entities/game-session-service.js";
import type { CharacterService } from "../../../../application/services/entities/character-service.js";
import type { ItemLookupService } from "../../../../application/services/entities/item-lookup-service.js";
import type { InventoryService } from "../../../../application/services/entities/inventory-service.js";
import type { CombatService } from "../../../../application/services/combat/combat-service.js";
import type { ActionService } from "../../../../application/services/combat/action-service.js";
import type { TwoPhaseActionService } from "../../../../application/services/combat/two-phase-action-service.js";
import type { AiTurnOrchestrator } from "../../../../application/services/combat/ai/index.js";
import type { TacticalViewService } from "../../../../application/services/combat/tactical-view-service.js";
import type { TabletopCombatService } from "../../../../application/services/combat/tabletop-combat-service.js";
import type { CombatantResolver } from "../../../../application/services/combat/helpers/combatant-resolver.js";
import type { PendingActionRepository } from "../../../../application/repositories/pending-action-repository.js";
import type { IEventRepository } from "../../../../application/repositories/event-repository.js";
import type { ICombatRepository } from "../../../../application/repositories/combat-repository.js";
import type { ICharacterRepository } from "../../../../application/repositories/character-repository.js";
import type { IMonsterRepository } from "../../../../application/repositories/monster-repository.js";
import type { INPCRepository } from "../../../../application/repositories/npc-repository.js";
import type { PrismaUnitOfWork, RepositoryBundle } from "../../../db/unit-of-work.js";
import type { IStoryGenerator } from "../../../llm/story-generator.js";
import type { IIntentParser } from "../../../llm/intent-parser.js";
import type { INarrativeGenerator } from "../../../llm/narrative-generator.js";
import type { ICharacterGenerator } from "../../../llm/character-generator.js";
import type { DiceRoller } from "../../../../domain/rules/dice-roller.js";

/**
 * Dependencies injected into session route modules.
 */
export interface SessionRouteDeps {
  // Core services
  sessions: GameSessionService;
  characters: CharacterService;
  combat: CombatService;
  actions: ActionService;
  twoPhaseActions: TwoPhaseActionService;
  tacticalView: TacticalViewService;
  tabletopCombat: TabletopCombatService;
  combatants: CombatantResolver;
  itemLookup: ItemLookupService;
  inventoryService: InventoryService;

  // Repositories
  pendingActions: PendingActionRepository;
  events: IEventRepository;
  combatRepo: ICombatRepository;
  charactersRepo: ICharacterRepository;
  monsters: IMonsterRepository;
  npcs: INPCRepository;

  // Optional services
  aiOrchestrator?: AiTurnOrchestrator;
  unitOfWork?: PrismaUnitOfWork;
  diceRoller?: DiceRoller;

  // LLM services
  storyGenerator?: IStoryGenerator;
  intentParser?: IIntentParser;
  narrativeGenerator?: INarrativeGenerator;
  characterGenerator?: ICharacterGenerator;

  // Factory for transactional service instances
  createServicesForRepos: (repos: RepositoryBundle) => {
    sessions: GameSessionService;
    characters: CharacterService;
    combat: CombatService;
    actions: ActionService;
    aiOrchestrator: AiTurnOrchestrator;
  };
}

/**
 * Debug logging helper - only logs when DM_DEBUG_LOGS is enabled.
 */
export function createDebugLogger() {
  const enabled =
    process.env.DM_DEBUG_LOGS === "1" ||
    process.env.DM_DEBUG_LOGS === "true" ||
    process.env.DM_DEBUG_LOGS === "yes";

  return {
    log: (...args: unknown[]) => {
      if (enabled) console.log(...args);
    },
    error: (...args: unknown[]) => {
      if (enabled) console.error(...args);
    },
    enabled,
  };
}
