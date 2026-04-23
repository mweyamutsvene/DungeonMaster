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
  
  for (const combatant of combatants) {
    const creature = creatures.get(combatant.id);
    if (!creature) {
      throw new Error(`Missing creature for combatant ${combatant.id}`);
    }
    orderedCreatures.push(creature);
  }

  if (orderedCreatures.length === 0) {
    throw new Error("Cannot hydrate Combat with zero combatants");
  }

  // Create Combat instance. The constructor rolls fresh initiative internally,
  // but the result is immediately discarded by restoreState() below. If the
  // diceRoller is a QueueableDiceRoller (E2E test harness), bypass its queue
  // for this throwaway roll so we don't drain test-injected dice values --
  // while still consuming N dice from the underlying seeded roller so that
  // every other deterministic dice consumer downstream sees the same seeded
  // sequence as before.
  const ctorRoller: DiceRoller =
    typeof (diceRoller as { getBypassRoller?: () => DiceRoller }).getBypassRoller === "function"
      ? (diceRoller as { getBypassRoller: () => DiceRoller }).getBypassRoller()
      : diceRoller;
  const combat = new Combat(ctorRoller, orderedCreatures);

  // Build the turn order sorted deterministically: initiative DESC, then createdAt ASC, then id.
  // We sort here rather than trusting the caller's order, because some ICombatRepository
  // implementations (e.g. test stubs) may return combatants in insertion order.
  // Using createdAt as the tiebreaker ensures equal-initiative combatants have a stable,
  // consistent order across every call — eliminating the non-deterministic swap that occurred
  // when combat.getOrder() (backed by rollInitiative()) was used as the stable-sort base.
  const order = [...combatants]
    .sort((a, b) => {
      const ai = a.initiative ?? -Infinity;
      const bi = b.initiative ?? -Infinity;
      if (bi !== ai) return bi - ai;
      const ac = a.createdAt.getTime();
      const bc = b.createdAt.getTime();
      if (ac !== bc) return ac - bc;
      return a.id.localeCompare(b.id);
    })
    .map((combatant) => {
      const creature = creatures.get(combatant.id)!;
      return { creature, initiative: combatant.initiative ?? 0 };
    });

  // Restore state from database
  const state: CombatState = {
    round: encounter.round,
    turnIndex: encounter.turn,
    order,
  };

  combat.restoreState(state);

  // Restore action economy from resources JSON
  for (const combatant of combatants) {
    const creature = creatures.get(combatant.id);
    if (!creature) continue;

    const actionEconomy = parseActionEconomy(combatant.resources, creature.getSpeed());
    combat.restoreActionEconomy(creature.getId(), actionEconomy);
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
    attacksAllowedThisTurn: isFreshEconomy ? 1 : (resources as any).attacksAllowedThisTurn ?? 1,
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
    // Bonus action spell restriction (D&D 5e 2024)
    bonusActionSpellCastThisTurn: isFreshEconomy ? false : (resources as any).bonusActionSpellCastThisTurn ?? false,
    actionSpellCastThisTurn: isFreshEconomy ? false : (resources as any).actionSpellCastThisTurn ?? false,
    // D&D 5e 2024: "If the trigger doesn't occur before the start of your next turn, you lose the action"
    readiedAction: isFreshEconomy ? undefined : (resources as any).readiedAction,
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
