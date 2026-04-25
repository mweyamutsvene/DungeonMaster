/**
 * Shared types for the tabletop combat flow.
 *
 * All types/interfaces that were previously defined inline in
 * TabletopCombatService are gathered here for reuse by sub-modules.
 */

import type {
  SessionCharacterRecord,
  SessionMonsterRecord,
  SessionNPCRecord,
  CombatEncounterRecord,
} from "../../../types.js";
import type { GameCommand, LlmRoster } from "../../../commands/game-command.js";
import type { ICharacterRepository } from "../../../repositories/character-repository.js";
import type { IMonsterRepository } from "../../../repositories/monster-repository.js";
import type { INPCRepository } from "../../../repositories/npc-repository.js";
import type { ICombatRepository } from "../../../repositories/combat-repository.js";
import type { IEventRepository } from "../../../repositories/event-repository.js";
import type { PendingActionRepository } from "../../../repositories/pending-action-repository.js";
import type { CombatService } from "../combat-service.js";
import type { InventoryService } from "../../entities/inventory-service.js";
import type { ActionService } from "../action-service.js";
import type { TwoPhaseActionService } from "../two-phase-action-service.js";
import type { CombatantResolver } from "../helpers/combatant-resolver.js";
import type { AiTurnOrchestrator } from "../ai/index.js";
import type { IIntentParser } from "../../../../infrastructure/llm/intent-parser.js";
import type { INarrativeGenerator } from "../../../../infrastructure/llm/narrative-generator.js";
import type { CombatVictoryPolicy, CombatVictoryStatus } from "../combat-victory-policy.js";
import type { DiceRoller } from "../../../../domain/rules/dice-roller.js";
import type { AbilityRegistry } from "../abilities/ability-registry.js";
import type { DeathSaves } from "../../../../domain/rules/death-saves.js";
import type { WeaponMasteryProperty } from "../../../../domain/rules/weapon-mastery.js";
import type { SpellEffectDeclaration } from "../../../../domain/entities/spells/prepared-spell-definition.js";

// ----- Pending action types -----

/**
 * All valid pending action types as a const tuple.
 * Adding a new entry here will cause a TypeScript compile error in RollStateMachine
 * until a corresponding handler is added to the rollHandlers map
 * (Record<PendingActionType, ...> enforces exhaustive coverage).
 */
export const PENDING_ACTION_TYPES = [
  "INITIATIVE",
  "INITIATIVE_SWAP",
  "ATTACK",
  "DAMAGE",
  "DEATH_SAVE",
  "SAVING_THROW",
] as const;

/** Derived from PENDING_ACTION_TYPES for exhaustive handler map coverage. */
export type PendingActionType = (typeof PENDING_ACTION_TYPES)[number];

/**
 * Outcome to apply when a saving throw succeeds or fails.
 */
export interface SaveOutcome {
  readonly conditions?: { add?: string[]; remove?: string[] };
  readonly damage?: { diceCount: number; diceSides: number; modifier: number };
  readonly movement?: { push?: number; direction?: { x: number; y: number } };
  readonly speedModifier?: number; // 0.5 = halved
  readonly summary: string;
}

/**
 * D&D 5e 2024 surprise:
 * - "enemies" — all enemy combatants roll initiative with disadvantage
 * - "party" — all party combatants (PCs + NPCs) roll initiative with disadvantage
 * - { surprised: string[] } — specific creature IDs are surprised (per-creature model)
 */
export type SurpriseSpec = "enemies" | "party" | { surprised: string[] };

export interface InitiatePendingAction {
  type: "INITIATIVE";
  timestamp: Date;
  actorId: string;
  initiator: string;
  intendedTarget?: string;
  intendedTargets?: string[];
  /** D&D 5e 2024: Which side or creature(s) are surprised (disadvantage on initiative rolls) */
  surprise?: SurpriseSpec;
}

export interface AttackPendingAction {
  type: "ATTACK";
  timestamp: Date;
  actorId: string;
  attacker: string;
  target?: string;
  targetId?: string;
  weaponSpec?: WeaponSpec;
  rollMode?: "normal" | "advantage" | "disadvantage";
  bonusAction?: string;
  flurryStrike?: 1 | 2;
  /** AC bonus from cover between attacker and target (D&D 5e 2024) */
  coverACBonus?: number;
  /** Prevents offering Lucky more than once for the same attack roll sequence. */
  luckyPrompted?: boolean;
  /** Current spell strike index (1-based) for multi-attack spells (Eldritch Blast beams, Scorching Ray rays) */
  spellStrike?: number;
  /** Total spell strikes for multi-attack spells */
  spellStrikeTotal?: number;
  /** On-hit spell effects to apply to target after damage (e.g. Guiding Bolt advantage on next attack) */
  spellOnHitEffects?: SpellEffectDeclaration[];
  /** Grapple/shove contest type — when set, HIT path resolves saving throw inline instead of DAMAGE */
  contestType?: "grapple" | "shove_push" | "shove_prone";
  /** Pre-computed contest DC (8 + attacker STR mod + proficiency bonus) for the saving throw step */
  contestDC?: number;
  /**
   * Rogue Cunning Strike option (D&D 5e 2024 L5+).
   * When set, one Sneak Attack die is forgone and the named effect is applied
   * after damage resolves (poison/trip=save; withdraw=free half-speed, no-OA move).
   */
  cunningStrike?: "poison" | "trip" | "withdraw";

  // ── Roll-interrupt resume fields ──────────────────────────────────────────
  // Set by the resolve endpoint so handleAttackRoll can skip the interrupt check
  // and apply the player's choice without duplicating hit/miss logic.

  /** True when a roll interrupt was already resolved — suppresses further interrupt checks. */
  interruptResolved?: boolean;
  /**
   * Additive bonus to attack total from interrupt resolution.
   * Example: Bardic Inspiration die rolled a 4 → interruptBonusAdjustment = 4.
   */
  interruptBonusAdjustment?: number;
  /**
   * Override the d20 value used for hit/miss determination.
   * Set when Lucky feat rerolls or Portent replaces the d20.
   */
  interruptForcedRoll?: number;
}

export interface DamagePendingAction {
  type: "DAMAGE";
  timestamp: Date;
  actorId: string;
  targetId: string;
  weaponSpec?: WeaponSpec;
  attackRollResult: number;
  isCritical?: boolean;
  bonusAction?: string;
  flurryStrike?: 1 | 2;
  rollMode?: "normal" | "advantage" | "disadvantage";
  /** Number of Sneak Attack d6s included in the damage formula */
  sneakAttackDice?: number;
  /** Post-damage enhancements to resolve (built at damage time from player opt-in keywords) */
  enhancements?: HitRiderEnhancement[];
  /** Current spell strike index (1-based) for multi-attack spells */
  spellStrike?: number;
  /** Total spell strikes for multi-attack spells */
  spellStrikeTotal?: number;
  /** On-hit spell effects to apply to target after damage (e.g. Guiding Bolt advantage on next attack) */
  spellOnHitEffects?: SpellEffectDeclaration[];
  /**
   * Rogue Cunning Strike option (D&D 5e 2024 L5+).
   * Carried through from the AttackPendingAction so damage-resolver can
   * trigger the poison/trip/withdraw effect after damage resolves.
   */
  cunningStrike?: "poison" | "trip" | "withdraw";
}

/**
 * A hit-rider enhancement attached to a damage pending action.
 * Resolved after damage is applied.
 */
export interface HitRiderEnhancement {
  readonly abilityId: string;
  readonly displayName: string;
  /** Bonus damage dice to add to the damage total */
  readonly bonusDice?: { diceCount: number; diceSides: number; damageType?: string };
  /**
   * Post-damage effect type to trigger after damage is applied.
   * - "saving-throw" → resolve via SavingThrowResolver (context must include save params)
   * - "apply-condition" → auto-apply a condition without a save
   */
  readonly postDamageEffect?: string;
  /** Context for the post-damage effect (save params, condition name, resource costs, etc.) */
  readonly context?: Record<string, unknown>;
}

/**
 * Result of resolving a hit-rider enhancement after damage.
 * Carries full save details for backward compatibility with legacy response fields
 * (`stunningStrike`, `openHandTechnique`) in the API response.
 */
export interface HitRiderEnhancementResult {
  abilityId: string;
  displayName: string;
  summary: string;
  saved?: boolean;
  saveRoll?: number;
  saveTotal?: number;
  saveDC?: number;
  conditionApplied?: string;
  pushedTo?: { x: number; y: number };
}

export interface DeathSavePendingAction {
  type: "DEATH_SAVE";
  timestamp: Date;
  actorId: string;
  encounterId: string;
  currentDeathSaves: DeathSaves;
}

/**
 * Pending saving throw — target must roll or server auto-resolves.
 * Used by Stunning Strike, spell saves, Open Hand Technique, etc.
 */
export interface SavingThrowPendingAction {
  type: "SAVING_THROW";
  timestamp: Date;
  /** Who must make the save */
  actorId: string;
  /** Who forced the save (for DC calculation context) */
  sourceId: string;
  /** Ability score used for the save */
  ability: string; // AbilityType from domain
  /** Pre-calculated DC */
  dc: number;
  /** Human-readable reason for the save */
  reason: string;
  /** What happens on a successful save */
  onSuccess: SaveOutcome;
  /** What happens on a failed save */
  onFailure: SaveOutcome;
  /** Ability-specific context data */
  context?: Record<string, unknown>;
  /** When true, target auto-fails (e.g., Stunned/Paralyzed auto-fail STR/DEX saves) — skip d20 roll */
  autoFail?: boolean;
  /** True when a roll interrupt was already resolved — suppresses further interrupt checks. */
  interruptResolved?: boolean;
  /**
   * Override the d20 value used for save determination.
   * Set when Lucky feat rerolls, Portent replaces, or Halfling Lucky rerolls nat-1.
   */
  interruptForcedRoll?: number;
  /**
   * Additive bonus to save total from interrupt resolution.
   * Example: Bardic Inspiration die rolled a 4 → interruptBonusAdjustment = 4.
   */
  interruptBonusAdjustment?: number;
}

/**
 * D&D 5e 2024 Alert feat: after rolling initiative, the Alert holder can swap
 * initiative with a willing ally. Stored as pending action between initiative roll
 * and combat truly starting.
 */
export interface InitiativeSwapPendingAction {
  type: "INITIATIVE_SWAP";
  timestamp: Date;
  /** The character with Alert feat who can swap */
  actorId: string;
  encounterId: string;
  sessionId: string;
  eligibleTargets: Array<{ actorId: string; actorName: string; initiative: number }>;
}

export type TabletopPendingAction =
  | InitiatePendingAction
  | AttackPendingAction
  | DamagePendingAction
  | DeathSavePendingAction
  | SavingThrowPendingAction
  | InitiativeSwapPendingAction;

export interface WeaponSpec {
  name: string;
  kind: "melee" | "ranged";
  attackBonus: number;
  damage?: { diceCount: number; diceSides: number; modifier: number };
  damageFormula?: string;
  /** Damage type (e.g. "slashing", "fire") for resistance/immunity calculations */
  damageType?: string;
  /** Weapon properties (e.g. ["finesse", "light"]) for eligibility checks */
  properties?: string[];
  /** Normal range in feet for ranged weapons */
  normalRange?: number;
  /** Long range in feet for ranged weapons (shots beyond this auto-miss) */
  longRange?: number;
  /** D&D 5e 2024 weapon mastery property (e.g. "graze", "vex") — only active if wielder has Weapon Mastery feature */
  mastery?: WeaponMasteryProperty;
  /** How many hands the weapon is being wielded with (1 or 2). Relevant for Versatile weapons & GWF. */
  hands?: 1 | 2;
  /** Whether this attack is a thrown weapon attack (for inventory consumption + ground drop) */
  isThrownAttack?: boolean;
}

// ----- Result types -----

/**
 * All valid roll types used by RollRequest.
 */
export type RollRequestType = "initiative" | "attack" | "damage" | "deathSave";

/**
 * Roll types used in ActionParseResult contexts (dispatch handlers, OA flow, ability executors).
 */
export type ActionRollType = "attack" | "damage" | "initiative" | "opportunity_attack" | "opportunity_attack_damage";

export interface RollRequest {
  requiresPlayerInput: true;
  type: "REQUEST_ROLL";
  rollType: RollRequestType;
  message: string;
  narration?: string;
  diceNeeded: string;
  pendingAction?: TabletopPendingAction;
  advantage?: boolean;
  disadvantage?: boolean;
}

export interface CombatStartedResult {
  rollType: "initiative";
  rawRoll: number;
  modifier: number;
  total: number;
  combatStarted: true;
  encounterId: string;
  turnOrder: Array<{ actorId: string; actorName: string; initiative: number }>;
  currentTurn: { actorId: string; actorName: string; initiative: number } | null;
  message: string;
  narration?: string;
  /** Uncanny Metabolism results if triggered on initiative */
  uncannyMetabolism?: {
    kiRestored: number;
    healAmount: number;
    martialArtsDieRoll: number;
    hpAfter: number;
  };
  /** When true, server expects another input (e.g. initiative swap decision) */
  requiresPlayerInput?: boolean;
  /** Alert feat initiative swap offer — present when the rolling PC has Alert and allies exist */
  initiativeSwapOffer?: {
    alertHolderId: string;
    alertHolderName: string;
    eligibleTargets: Array<{ actorId: string; actorName: string; initiative: number }>;
  };
}

export interface AttackResult {
  rollType: "attack" | "damage";
  rawRoll: number;
  modifier: number;
  total: number;
  targetAC: number;
  hit: boolean;
  isCritical?: boolean;
  targetHpRemaining?: number;
  requiresPlayerInput: boolean;
  actionComplete: boolean;
  message: string;
  narration?: string;
  type?: "REQUEST_ROLL";
  diceNeeded?: string;
  pendingActionId?: string;
  luckyPrompt?: {
    pendingActionId: string;
    reactionType: "lucky_reroll";
    rollType: "attack";
    originalRoll: number;
    originalTotal: number;
    targetAC: number;
  };
  /** Eligible on-hit enhancements the player can opt into with damage roll text (2024 rules). */
  eligibleEnhancements?: Array<{
    keyword: string;
    displayName: string;
    resourceCost?: { pool: string; amount: number };
    choiceOptions?: readonly string[];
  }>;
  /**
   * Present when the attack roll is paused for a roll interrupt.
   * Client should present the options and call the resolve endpoint.
   */
  rollInterrupt?: {
    options: import("../../../../domain/entities/combat/pending-action.js").RollInterruptOption[];
    totalBeforeInterrupt: number;
    targetAC: number;
  };
}

/**
 * Detailed save result for grapple/shove contest resolution.
 * Returned as part of ContestResult when a contest's saving throw step is resolved.
 */
export interface ContestSaveDetail {
  ability: string;
  dc: number;
  rawRoll: number;
  modifier: number;
  total: number;
  success: boolean;
  outcomeSummary: string;
  conditionsApplied?: string[];
}

/**
 * Extended attack result for grapple/shove contests.
 * Includes the optional `contestSave` field with saving throw details.
 * Backward-compatible — clients that don't know about `contestSave` see a valid AttackResult.
 */
export interface ContestResult extends AttackResult {
  contestSave?: ContestSaveDetail;
}

export interface DamageResult {
  rollType: "damage" | "attack";
  nextRollType?: "attack";
  rawRoll: number;
  modifier: number;
  total: number;
  totalDamage: number;
  targetName: string;
  hpBefore: number;
  hpAfter: number;
  targetHpRemaining: number;
  actionComplete: boolean;
  requiresPlayerInput: boolean;
  message: string;
  narration?: string;
  type?: "REQUEST_ROLL";
  diceNeeded?: string;
  combatEnded?: boolean;
  victoryStatus?: CombatVictoryStatus;
}

/** Result of a death saving throw roll. */
export interface DeathSaveResult {
  rollType: "deathSave";
  rawRoll: number;
  deathSaveResult: string;
  deathSaves: DeathSaves;
  actionComplete: boolean;
  requiresPlayerInput: boolean;
  message: string;
  narration?: string;
  combatEnded?: boolean;
  victoryStatus?: CombatVictoryStatus;
}

/**
 * Result of an auto-resolved saving throw (server rolls for the target).
 */
export interface SavingThrowAutoResult {
  rollType: "savingThrow";
  ability: string;
  dc: number;
  rawRoll: number;
  modifier: number;
  total: number;
  success: boolean;
  reason: string;
  outcomeSummary: string;
  /** Conditions applied as a result of the save */
  conditionsApplied?: string[];
  conditionsRemoved?: string[];
  actionComplete: boolean;
  requiresPlayerInput: boolean;
  message: string;
  narration?: string;
  /** If further action is needed (e.g., flurry strike 2) */
  type?: "REQUEST_ROLL";
  diceNeeded?: string;
}

export const ACTION_RESULT_TYPES = [
  "move",
  "move_towards",
  "MOVE_COMPLETE",
  "JUMP_COMPLETE",
  "REACTION_CHECK",
  "REQUEST_ROLL",
  "SIMPLE_ACTION_COMPLETE",
] as const;
export type ActionResultType = (typeof ACTION_RESULT_TYPES)[number];

export interface ActionParseResult {
  requiresPlayerInput: boolean;
  actionComplete: boolean;
  type: ActionResultType;
  action?: string;
  message: string;
  narration?: string;
  success?: boolean;
  pendingAction?: TabletopPendingAction;
  movedTo?: { x: number; y: number };
  to?: { x: number; y: number };
  movedFeet?: number | null;
  opportunityAttacks?: unknown[];
  pendingActionId?: string;
  rollType?: ActionRollType;
  diceNeeded?: string;
  advantage?: boolean;
  disadvantage?: boolean;
  /** Per-cell path metadata from A* pathfinding (for visualization). */
  pathCells?: Array<{ x: number; y: number; terrain: string; stepCostFeet: number; cumulativeCostFeet: number }>;
  /** Total movement cost for the path in feet. */
  pathCostFeet?: number;
  /** Pathfinding summary (terrain encountered, detour info, etc.). */
  pathfinding?: {
    totalCostFeet: number;
    terrainEncountered: string[];
    narrationHints: string[];
    wasBlocked: boolean;
  };
}

// ----- Dependency interface -----

// ----- State machine handler types -----

/**
 * Unified context passed to every roll handler in the pending action state machine.
 * All fields that any handler may need are present; handlers ignore irrelevant ones.
 * `command` is undefined for SAVING_THROW (auto-resolved) and INITIATIVE_SWAP (text choice).
 */
export interface RollProcessingCtx {
  sessionId: string;
  text: string;
  actorId: string;
  encounter: CombatEncounterRecord;
  characters: SessionCharacterRecord[];
  monsters: SessionMonsterRecord[];
  npcs: SessionNPCRecord[];
  roster: LlmRoster;
  /** Pre-parsed roll command — undefined for SAVING_THROW and INITIATIVE_SWAP. */
  command?: GameCommand;
}

/** Uniform signature for all handlers in the pending action state machine. */
export type RollHandlerFn = (
  action: TabletopPendingAction,
  ctx: RollProcessingCtx,
) => Promise<CombatStartedResult | AttackResult | DamageResult | DeathSaveResult | SavingThrowAutoResult>;

/**
 * Handler map for all pending action types.
 * Using Record<PendingActionType, RollHandlerFn> guarantees exhaustive coverage —
 * adding a new entry to PENDING_ACTION_TYPES produces a compile error here until
 * the corresponding handler is wired in.
 */
export type PendingActionHandlerMap = Record<PendingActionType, RollHandlerFn>;

export interface TabletopCombatServiceDeps {
  characters: ICharacterRepository;
  monsters: IMonsterRepository;
  npcs: INPCRepository;
  combatRepo: ICombatRepository;
  combat: CombatService;
  actions: ActionService;
  twoPhaseActions: TwoPhaseActionService;
  combatants: CombatantResolver;
  pendingActions: PendingActionRepository;
  events?: IEventRepository;
  aiOrchestrator?: AiTurnOrchestrator;
  intentParser?: IIntentParser;
  narrativeGenerator?: INarrativeGenerator;
  victoryPolicy?: CombatVictoryPolicy;
  abilityRegistry: AbilityRegistry;
  diceRoller?: DiceRoller;
  /**
   * Optional — required by `InteractionHandlers.handleGiveItemAction` and
   * `handleAdministerItemAction`. When absent, give/administer fail loud.
   * Wired in production by `app.ts`; test harnesses construct it directly.
   */
  inventoryService?: InventoryService;
}
