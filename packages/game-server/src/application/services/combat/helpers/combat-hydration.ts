/**
 * Combat Hydration Layer
 * 
 * Bridges the gap between database records (CombatEncounterRecord, CombatantStateRecord)
 * and rich domain entities (Combat, Creature). Enables services to work with domain logic
 * instead of manual state manipulation.
 */

import type { DiceRoller } from "../../../../domain/rules/dice-roller.js";
import { Combat, type CombatState } from "../../../../domain/combat/combat.js";
import type { Creature } from "../../../../domain/entities/creatures/creature.js";
import type { CombatEncounterRecord, CombatantStateRecord } from "../../../types.js";
import { freshActionEconomy, type ActionEconomy } from "../../../../domain/entities/combat/action-economy.js";

/**
 * Hydrate a Combat domain instance from database records.
 * 
 * Note: Currently requires pre-hydrated Creature instances. Step 3 of the refactoring
 * will add creature hydration from records (hydrateCharacter/Monster/NPC).
 * 
 * @param encounter - Database encounter record with round/turn state
 * @param combatants - Ordered array of combatant state records (turn order)
 * @param creatures - Pre-hydrated domain Creature instances, indexed by combatantState.id
 * @param diceRoller - Dice roller for domain Combat instance
 * @returns Combat domain instance with state restored from database
 */
export function hydrateCombat(
  encounter: CombatEncounterRecord,
  combatants: readonly CombatantStateRecord[],
  creatures: Map<string, Creature>,
  diceRoller: DiceRoller,
): Combat {
  // Extract creatures in turn order
  const orderedCreatures: Creature[] = [];
  const initiativeMap = new Map<string, number>();
  
  for (const combatant of combatants) {
    const creature = creatures.get(combatant.id);
    if (!creature) {
      throw new Error(`Missing creature for combatant ${combatant.id}`);
    }
    orderedCreatures.push(creature);
    initiativeMap.set(creature.getId(), combatant.initiative ?? 0);
  }

  if (orderedCreatures.length === 0) {
    throw new Error("Cannot hydrate Combat with zero combatants");
  }

  // Create Combat instance (will roll fresh initiative)
  const combat = new Combat(diceRoller, orderedCreatures);

  // Override initiative with database values
  const order = combat.getOrder().map((entry) => ({
    ...entry,
    initiative: initiativeMap.get(entry.creature.getId()) ?? entry.initiative,
  }));

  // Sort by initiative (descending)
  order.sort((a, b) => b.initiative - a.initiative);

  // Restore state from database
  const state: CombatState = {
    round: encounter.round,
    turnIndex: encounter.turn,
    order,
  };

  // Use reflection to restore state (Combat doesn't expose setState)
  (combat as any).state = state;

  // Restore action economy from resources JSON
  const combatantsMap = (combat as any).combatants as Map<string, { creature: Creature; actionEconomy: ActionEconomy }>;
  
  for (const combatant of combatants) {
    const creature = creatures.get(combatant.id);
    if (!creature) continue;

    const creatureId = creature.getId();
    const combatantEntry = combatantsMap.get(creatureId);
    if (!combatantEntry) continue;

    // Parse action economy from resources JSON
    const actionEconomy = parseActionEconomy(combatant.resources, creature.getSpeed());
    combatantEntry.actionEconomy = actionEconomy;
  }

  return combat;
}

/**
 * Extract dirty state from Combat domain instance for persistence.
 * 
 * @param combat - Domain Combat instance
 * @returns Partial update for CombatEncounterRecord (round/turn)
 */
export function extractCombatState(combat: Combat): { round: number; turn: number } {
  return {
    round: combat.getRound(),
    turn: combat.getTurnIndex(),
  };
}

/**
 * Extract action economy state for a combatant for persistence.
 * 
 * @param combat - Domain Combat instance
 * @param creatureId - Creature ID to extract economy for
 * @param existingResources - Existing resources JSON to merge with
 * @returns Updated resources JSON with action economy serialized
 */
export function extractActionEconomy(
  combat: Combat,
  creatureId: string,
  existingResources: unknown,
): unknown {
  const economy = combat.getActionEconomy(creatureId);
  
  const resources = typeof existingResources === 'object' && existingResources !== null
    ? { ...existingResources as Record<string, unknown> }
    : {};

  // Determine if this is a fresh economy (new turn)
  // A fresh economy has full actions available - if action is available, movement should be reset too
  const isFreshEconomy = economy.actionAvailable && economy.bonusActionAvailable && economy.reactionAvailable;
  
  return {
    ...resources,
    actionSpent: !economy.actionAvailable,
    bonusActionSpent: !economy.bonusActionAvailable,
    reactionSpent: !economy.reactionAvailable,
    movementRemaining: economy.movementRemainingFeet,
    // Reset turn-based flags when economy is fresh (new turn)
    movementSpent: isFreshEconomy ? false : (resources as any).movementSpent ?? false,
    dashed: isFreshEconomy ? false : (resources as any).dashed ?? false,
    disengaged: isFreshEconomy ? false : (resources as any).disengaged ?? false,
    attacksUsedThisTurn: isFreshEconomy ? 0 : (resources as any).attacksUsedThisTurn ?? 0,
    sneakAttackUsedThisTurn: isFreshEconomy ? false : (resources as any).sneakAttackUsedThisTurn ?? false,
    stunningStrikeUsedThisTurn: isFreshEconomy ? false : (resources as any).stunningStrikeUsedThisTurn ?? false,
    rageAttackedThisTurn: isFreshEconomy ? false : (resources as any).rageAttackedThisTurn ?? false,
    rageDamageTakenThisTurn: isFreshEconomy ? false : (resources as any).rageDamageTakenThisTurn ?? false,
    // Also reset the "Used" variants (set by resource-utils useBonusAction/useReaction)
    // to match the domain economy's fresh state
    bonusActionUsed: isFreshEconomy ? false : (resources as any).bonusActionUsed ?? false,
    reactionUsed: isFreshEconomy ? false : (resources as any).reactionUsed ?? false,
    // D&D 5e 2024: Free Object Interaction resets each turn
    objectInteractionUsed: isFreshEconomy ? false : (resources as any).objectInteractionUsed ?? false,
  };
}

/**
 * Parse action economy from resources JSON.
 * Falls back to fresh economy if parsing fails.
 */
function parseActionEconomy(resources: unknown, speed: number): ActionEconomy {
  if (typeof resources !== 'object' || resources === null) {
    return freshActionEconomy(speed);
  }

  const r = resources as Record<string, unknown>;
  
  // Convert stored 'spent' flags back to 'available' booleans
  const actionSpent = typeof r.actionSpent === 'boolean' ? r.actionSpent : false;
  const bonusActionSpent = typeof r.bonusActionSpent === 'boolean' ? r.bonusActionSpent : false;
  const reactionSpent = typeof r.reactionSpent === 'boolean' ? r.reactionSpent : false;
  const movementRemaining = typeof r.movementRemaining === 'number' ? r.movementRemaining : speed;
  
  return {
    actionAvailable: !actionSpent,
    bonusActionAvailable: !bonusActionSpent,
    reactionAvailable: !reactionSpent,
    movementRemainingFeet: movementRemaining,
    actionsUsed: [], // Initialize empty - actions are tracked per-turn in Combat domain
  };
}
