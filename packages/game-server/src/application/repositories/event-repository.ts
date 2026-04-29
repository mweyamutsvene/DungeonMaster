import type { GameEventRecord } from "../types.js";
import type { ReactionOpportunity } from "../../domain/entities/combat/pending-action.js";
import type { CombatantRef } from "../services/combat/helpers/combatant-ref.js";
import type { Position } from "../../domain/rules/movement.js";

// ---------------------------------------------------------------------------
// Per-event payload interfaces
// ---------------------------------------------------------------------------

// --- Session / Entity events ---

export interface SessionCreatedPayload {
  sessionId: string;
}

export interface SessionDeletedPayload {
  sessionId: string;
}

export interface CharacterAddedPayload {
  characterId: string;
  name: string;
  level: number;
}

export interface CharacterUpdatedPayload {
  characterId: string;
  name: string;
}

export interface CharacterDeletedPayload {
  characterId: string;
  name: string;
}

export interface RestCompletedPayload {
  restType: string;
  characters: Array<{ id: string; name: string }>;
}

export interface MonsterAddedPayload {
  monsterId: string;
  name: string;
}

export interface NPCAddedPayload {
  npcId: string;
  name: string;
}

export interface InventoryChangedPayload {
  characterId: string;
  characterName: string;
  action:
    | "add"
    | "remove"
    | "equip"
    | "use-charge"
    | "use"
    | "create"
    | "expire"
    | "transfer-in"
    | "transfer-out";
  itemName: string;
  quantity?: number;
  fromCharacterId?: string;
  fromCharacterName?: string;
  toCharacterId?: string;
  toCharacterName?: string;
}

export interface RestStartedPayload {
  restType: string;
  restId: string;
}

// --- Combat lifecycle events ---

export interface CombatStartedPayload {
  encounterId: string;
}

export interface CombatEndedPayload {
  encounterId: string;
  result: string;
  reason?: string;
}

export interface TurnAdvancedPayload {
  encounterId: string;
  round: number;
  turn: number;
}

export interface DeathSavePayload {
  encounterId: string;
  roll: number;
  result: string;
  deathSaves: { successes: number; failures: number };
  /** Present for auto-rolled death saves (turn-start path). */
  combatantId?: string;
  /** Present for manual death saves (tabletop roll-result path). */
  actor?: CombatantRef;
  hpRestored?: number;
}

// --- Combat action events ---

/**
 * Multi-caller event — attacker/target shapes vary; index signature allows extras.
 * Required core: encounterId + hit.
 */
export interface AttackResolvedPayload {
  encounterId: string;
  attacker?: CombatantRef;
  target?: CombatantRef;
  attackerName?: string;
  targetName?: string;
  hit?: boolean;
  [key: string]: unknown;
}

/**
 * Damage applied to a combatant. Extra fields (targetName, damageType, source)
 * present in some callers; index signature allows them.
 */
export interface DamageAppliedPayload {
  encounterId: string;
  target: CombatantRef;
  amount: number;
  hpCurrent: number;
  [key: string]: unknown;
}

/**
 * Generic resolved action (Hide, Search, Help, CastSpell, Grapple, Shove, EscapeGrapple…).
 * `action` identifies which action; extra fields are action-specific.
 */
export interface ActionResolvedPayload {
  encounterId: string;
  actor: CombatantRef;
  action: string;
  [key: string]: unknown;
}

/**
 * Opportunity attack executed during movement. Shape varies by caller.
 */
export interface OpportunityAttackPayload {
  encounterId: string;
  attackerId: string;
  targetId: string;
  [key: string]: unknown;
}

export interface MovePayload {
  encounterId: string;
  actorId: string;
  actorName?: string;
  from: Position;
  to: Position;
  distanceMoved: number;
  interrupted?: boolean;
}

export interface HealingAppliedPayload {
  encounterId: string;
  healer: CombatantRef;
  target: CombatantRef;
  amount: number;
  hpCurrent: number;
}

export interface NarrativeTextPayload {
  encounterId: string;
  /** Optional — not present in AI orchestrator's incapacitated/downed narrations. */
  actor?: CombatantRef;
  actorName?: string;
  text: string;
}

export interface ConcentrationCheckPayload {
  encounterId: string;
  combatant: CombatantRef;
  spellName: string;
  dc: number;
  roll: number;
  damage: number;
}

// --- Reaction events ---

export interface ReactionPromptEventPayload {
  encounterId: string;
  pendingActionId: string;
  combatantId: string;
  combatantName: string;
  reactionOpportunity: ReactionOpportunity;
  actor: CombatantRef;
  actorName: string;
  expiresAt: string; // ISO timestamp
}

export interface ReactionResolvedEventPayload {
  encounterId: string;
  pendingActionId: string;
  combatantId: string;
  combatantName: string;
  reactionType: string;
  choice: "use" | "decline";
  result?: unknown;
}

export interface CounterspellPayload {
  encounterId: string;
  counterspellerId: string;
  counterspellerName: string;
  targetSpell: string;
  counterspellLevel: number;
  targetSpellLevel: number;
  abilityCheckDC?: number;
  abilityCheckRoll?: number;
  success: boolean;
}

export interface ShieldCastPayload {
  encounterId: string;
  casterId: string;
  casterName: string;
  previousAC: number;
  newAC: number;
}

export interface DeflectAttacksPayload {
  encounterId: string;
  deflectorId: string;
  deflectorName: string;
  deflectRoll: number;
  dexMod: number;
  monkLevel: number;
  totalReduction: number;
  damageAfterReduction: number;
}

export interface CuttingWordsPayload {
  encounterId: string;
  bardId: string;
  bardName: string;
  attackerId: string;
  dieSize: number;
  roll: number;
  previousAttackRoll: number;
  newAttackRoll: number;
}

export interface DeflectAttacksRedirectPayload {
  encounterId: string;
  deflectorId: string;
  deflectorName: string;
  targetId: string;
  targetName: string;
  attackRoll: number;
  attackerAC: number;
  hit: boolean;
  damage: number;
  martialArtsDieSize: number;
  dexMod: number;
  proficiencyBonus: number;
}

export interface UncannyDodgePayload {
  encounterId: string;
  dodgerId: string;
  dodgerName: string;
  damageAfterReduction: number;
}

export interface AbsorbElementsPayload {
  encounterId: string;
  casterId: string;
  casterName: string;
  damageType: string;
  healBack: number;
  hpAfter: number;
}

export interface HellishRebukePayload {
  encounterId: string;
  casterId: string;
  casterName: string;
  targetId: CombatantRef;
  damage: number;
  saved: boolean;
}

export interface AiDecisionPayload {
  encounterId: string;
  actor: CombatantRef;
  decision: Record<string, unknown>;
}

export interface LegendaryActionPayload {
  encounterId: string;
  combatantId: string;
  actionName: string;
  actionType: "attack" | "move" | "special";
  cost: number;
  targetId?: string;
}

export interface LairActionPayload {
  encounterId: string;
  combatantId: string;
  actionName: string;
  description: string;
  damage?: number;
  damageType?: string;
}

export interface SentinelReactionAttackPayload {
  encounterId: string;
  sentinelId: string;
  sentinelName: string;
  targetId: string;
  targetName: string;
  attackName: string;
  attackRoll: number;
  targetAC: number;
  hit: boolean;
  damage: number;
}

export interface ReadiedActionTriggeredPayload {
  encounterId: string;
  reactorId: string;
  reactorName: string;
  triggerType: string;
  targetId: string;
  targetName: string;
  attackName: string;
  attackRoll: number;
  targetAC: number;
  hit: boolean;
  damage: number;
}

/**
 * Protection fighting style applied — protector re-rolled the attack's d20 to
 * impose disadvantage (or collapsed adv + disadv to a straight d20).
 */
export interface ProtectionAppliedPayload {
  encounterId: string;
  protectorId: string;
  protectorName: string;
  targetId: string;
  originalMode: "normal" | "advantage" | "disadvantage";
  originalRoll: number;
  newRoll: number;
  originalAttackTotal: number;
  newAttackTotal: number;
  hitBecameMiss: boolean;
}

/**
 * Protection attempted but the attack was already at disadvantage — no effect,
 * reaction was NOT consumed. Diagnostic event for transparency.
 */
export interface ProtectionRedundantPayload {
  encounterId: string;
  protectorId: string;
  protectorName: string;
  targetId: string;
  reason: string;
}

/**
 * Interception fighting style applied — protector reduced damage by
 * 1d10 + proficiency bonus (minimum 0).
 */
export interface InterceptionAppliedPayload {
  encounterId: string;
  protectorId: string;
  protectorName: string;
  targetId: string;
  targetName: string;
  interceptRoll: number;
  profBonus: number;
  reduction: number;
  rawDamage: number;
  finalDamage: number;
}

// ---------------------------------------------------------------------------
// Discriminated union of all game events
// ---------------------------------------------------------------------------

export type GameEventInput =
  | { type: "SessionCreated"; payload: SessionCreatedPayload }
  | { type: "SessionDeleted"; payload: SessionDeletedPayload }
  | { type: "CharacterAdded"; payload: CharacterAddedPayload }
  | { type: "CharacterUpdated"; payload: CharacterUpdatedPayload }
  | { type: "CharacterDeleted"; payload: CharacterDeletedPayload }
  | { type: "MonsterAdded"; payload: MonsterAddedPayload }
  | { type: "NPCAdded"; payload: NPCAddedPayload }
  | { type: "InventoryChanged"; payload: InventoryChangedPayload }
  | { type: "RestStarted"; payload: RestStartedPayload }
  | { type: "RestCompleted"; payload: RestCompletedPayload }
  | { type: "CombatStarted"; payload: CombatStartedPayload }
  | { type: "CombatEnded"; payload: CombatEndedPayload }
  | { type: "TurnAdvanced"; payload: TurnAdvancedPayload }
  | { type: "DeathSave"; payload: DeathSavePayload }
  | { type: "AttackResolved"; payload: AttackResolvedPayload }
  | { type: "DamageApplied"; payload: DamageAppliedPayload }
  | { type: "ActionResolved"; payload: ActionResolvedPayload }
  | { type: "OpportunityAttack"; payload: OpportunityAttackPayload }
  | { type: "Move"; payload: MovePayload }
  | { type: "HealingApplied"; payload: HealingAppliedPayload }
  | { type: "NarrativeText"; payload: NarrativeTextPayload }
  | { type: "ConcentrationMaintained"; payload: ConcentrationCheckPayload }
  | { type: "ConcentrationBroken"; payload: ConcentrationCheckPayload }
  | { type: "ReactionPrompt"; payload: ReactionPromptEventPayload }
  | { type: "ReactionResolved"; payload: ReactionResolvedEventPayload }
  | { type: "Counterspell"; payload: CounterspellPayload }
  | { type: "ShieldCast"; payload: ShieldCastPayload }
  | { type: "DeflectAttacks"; payload: DeflectAttacksPayload }
  | { type: "CuttingWords"; payload: CuttingWordsPayload }
  | { type: "DeflectAttacksRedirect"; payload: DeflectAttacksRedirectPayload }
  | { type: "UncannyDodge"; payload: UncannyDodgePayload }
  | { type: "AbsorbElements"; payload: AbsorbElementsPayload }
  | { type: "HellishRebuke"; payload: HellishRebukePayload }
  | { type: "AiDecision"; payload: AiDecisionPayload }
  | { type: "LegendaryAction"; payload: LegendaryActionPayload }
  | { type: "LairAction"; payload: LairActionPayload }
  | { type: "SentinelReactionAttack"; payload: SentinelReactionAttackPayload }
  | { type: "ReadiedActionTriggered"; payload: ReadiedActionTriggeredPayload }
  | { type: "ProtectionApplied"; payload: ProtectionAppliedPayload }
  | { type: "ProtectionRedundant"; payload: ProtectionRedundantPayload }
  | { type: "InterceptionApplied"; payload: InterceptionAppliedPayload };

/** All valid event type strings — use for exhaustive switch checks or filtering. */
export type GameEventType = GameEventInput["type"];

// ---------------------------------------------------------------------------
// Repository interface
// ---------------------------------------------------------------------------

export interface IEventRepository {
  append(
    sessionId: string,
    input: { id: string } & GameEventInput,
    combatContext?: { encounterId: string; round: number; turnNumber: number },
  ): Promise<GameEventRecord>;

  listBySession(
    sessionId: string,
    input?: { limit?: number; since?: Date },
  ): Promise<GameEventRecord[]>;

  listByEncounter(
    encounterId: string,
    input?: { limit?: number; round?: number },
  ): Promise<GameEventRecord[]>;
}
