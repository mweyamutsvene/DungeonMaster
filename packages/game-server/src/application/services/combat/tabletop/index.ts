/**
 * tabletop/ barrel – re-exports for clean imports from outside the module.
 *
 * Most consumers only need TabletopCombatService (from the parent facade file).
 * This barrel is for code that needs direct access to sub-modules.
 */

export { ActionDispatcher } from "./action-dispatcher.js";
export { RollStateMachine, loadRoster } from "./roll-state-machine.js";
export { SpellActionHandler } from "./spell-action-handler.js";
export { TabletopEventEmitter } from "./tabletop-event-emitter.js";
export { SavingThrowResolver } from "./saving-throw-resolver.js";

// Action parser chain types
export type { ActionParserEntry, DispatchContext } from "./action-parser-chain.js";

// Spell delivery strategy components
export type {
  SpellCastingContext,
  SpellDeliveryDeps,
  SpellDeliveryHandler,
} from "./spell-delivery/index.js";
export {
  SpellAttackDeliveryHandler,
  SaveSpellDeliveryHandler,
  HealingSpellDeliveryHandler,
  BuffDebuffSpellDeliveryHandler,
  ZoneSpellDeliveryHandler,
} from "./spell-delivery/index.js";
export { isCreatureSurprised, computeInitiativeModifiers, computeInitiativeRollMode } from "./tabletop-utils.js";
export { buildPathNarration } from "./path-narrator.js";
export type { PathNarrationInput } from "./path-narrator.js";

// All types
export type {
  PendingActionType,
  InitiatePendingAction,
  AttackPendingAction,
  DamagePendingAction,
  DeathSavePendingAction,
  SavingThrowPendingAction,
  SaveOutcome,
  HitRiderEnhancement,
  HitRiderEnhancementResult,
  SavingThrowAutoResult,
  TabletopPendingAction,
  WeaponSpec,
  RollRequest,
  CombatStartedResult,
  AttackResult,
  DamageResult,
  ActionParseResult,
  TabletopCombatServiceDeps,
} from "./tabletop-types.js";

// Text parsers (pure functions)
export {
  deriveRollModeFromConditions,
  tryParseMoveText,
  tryParseSimpleActionText,
  tryParseHideText,
  tryParseOffhandAttackText,
  tryParseHelpText,
  tryParseShoveText,
  tryParseGrappleText,
  tryParseCastSpellText,
  tryParseMoveTowardText,
  inferActorRef,
  findCombatantByName,
  getActorNameFromRoster,
} from "./combat-text-parser.js";
