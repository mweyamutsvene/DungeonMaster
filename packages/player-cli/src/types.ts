/**
 * Type definitions for the DungeonMaster Player CLI
 *
 * Response shapes match the game-server API. Scenario types are setup-only
 * (no scripted actions) — the CLI always drops into an interactive REPL.
 */

// ============================================================================
// Utility Types
// ============================================================================

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface CombatantRef {
  type: "Character" | "Monster" | "NPC";
  characterId?: string;
  monsterId?: string;
  npcId?: string;
}

// ============================================================================
// Session & Entity Records
// ============================================================================

export interface GameSessionRecord {
  id: string;
  storyFramework: JsonValue;
  createdAt: string;
  updatedAt: string;
}

export interface SessionCharacterRecord {
  id: string;
  sessionId: string;
  name: string;
  level: number;
  className: string | null;
  sheet: JsonValue;
  createdAt: string;
  updatedAt: string;
}

export interface SessionMonsterRecord {
  id: string;
  sessionId: string;
  name: string;
  monsterDefinitionId: string | null;
  statBlock: JsonValue;
  createdAt: string;
  updatedAt: string;
}

export interface SessionNPCRecord {
  id: string;
  sessionId: string;
  name: string;
  faction: string | null;
  aiControlled: boolean;
  statBlock: JsonValue;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Combat State
// ============================================================================

export interface EncounterState {
  encounter: {
    id: string;
    status: string;
    round: number;
    turn: number;
    pendingAction?: PendingAction | null;
  };
  combatants: CombatantState[];
  activeCombatant: CombatantState | null;
}

export interface CombatantState {
  id: string;
  combatantType: "Character" | "Monster" | "NPC";
  characterId?: string;
  monsterId?: string;
  npcId?: string;
  hpCurrent: number;
  hpMax: number;
  initiative: number;
  resources?: Record<string, unknown>;
}

export interface PendingAction {
  id: string;
  type: string;
  rollType?: string;
  actor?: CombatantRef;
  target?: CombatantRef;
  opportunities?: Array<{
    opportunityId: string;
    combatantId: string;
    combatantName: string;
    canAttack: boolean;
    hasReaction: boolean;
    reactionType?: string;
  }>;
  [key: string]: unknown;
}

// ============================================================================
// Tactical View
// ============================================================================

export interface TacticalCombatant {
  id: string;
  name: string;
  combatantType: "Character" | "Monster" | "NPC";
  hp: { current: number; max: number };
  position: { x: number; y: number } | null;
  distanceFromActive: number | null;
  actionEconomy: {
    actionAvailable: boolean;
    bonusActionAvailable: boolean;
    reactionAvailable: boolean;
    movementRemainingFeet: number;
    attacksUsed?: number;
    attacksAllowed?: number;
  };
  resourcePools: Array<{ name: string; current: number; max: number }>;
  movement: {
    speed: number;
    dashed: boolean;
    movementSpent: boolean;
  };
  turnFlags: {
    actionSpent: boolean;
    bonusActionUsed: boolean;
    reactionUsed: boolean;
    disengaged: boolean;
  };
  conditions?: string[];
  deathSaves?: { successes: number; failures: number };
}

export interface TacticalState {
  encounterId: string;
  activeCombatantId: string;
  status?: string;
  combatants: TacticalCombatant[];
  map: JsonValue | null;
  pendingAction?: PendingAction | null;
  /** Last move path for the active combatant — for trail rendering / animation. */
  lastMovePath?: {
    combatantId: string;
    cells: Array<{ x: number; y: number; terrain: string; stepCostFeet: number; cumulativeCostFeet: number }>;
    costFeet: number;
  } | null;
}

// ============================================================================
// Action / Roll Responses
// ============================================================================

export interface ActionResponse {
  requiresPlayerInput: boolean;
  actionComplete: boolean;
  type: string;
  action?: string;
  message: string;
  narration?: string;
  success?: boolean;
  movedTo?: { x: number; y: number };
  pendingActionId?: string;
  rollType?: string;
  diceNeeded?: string;
  opportunityAttacks?: Array<{
    combatantId: string;
    opportunityId: string;
    combatantName?: string;
    canAttack: boolean;
    reactionType?: string;
  }>;
  advantage?: boolean;
  disadvantage?: boolean;
  /** Per-cell path metadata from A* pathfinding. */
  pathCells?: Array<{ x: number; y: number; terrain: string; stepCostFeet: number; cumulativeCostFeet: number }>;
  /** Total movement cost for the path in feet. */
  pathCostFeet?: number;

  // Roll result fields
  rawRoll?: number;
  modifier?: number;
  total?: number;
  hit?: boolean;
  isCritical?: boolean;
  targetAC?: number;
  totalDamage?: number;
  targetName?: string;
  hpBefore?: number;
  hpAfter?: number;
  targetHpRemaining?: number;

  // Initiative result fields
  combatStarted?: boolean;
  encounterId?: string;
  turnOrder?: Array<{ actorId: string; actorName: string; initiative: number }>;
  currentTurn?: { actorId: string; actorName: string; initiative: number } | null;

  // Combat end fields
  combatEnded?: boolean;
  victoryStatus?: string;

  // Death save fields
  deathSaveResult?: "success" | "failure" | "stabilized" | "dead" | "revived";
  deathSaves?: { successes: number; failures: number };

  // Hit rider enhancement results (Stunning Strike, Open Hand Technique, etc.)
  stunningStrike?: HitRiderResult;
  openHandTechnique?: HitRiderResult;
  enhancements?: HitRiderResult[];

  // On-hit enhancements available after a hit (2024 post-hit opt-in flow)
  eligibleEnhancements?: Array<{
    keyword: string;
    displayName: string;
    choiceOptions?: string[];
  }>;
}

export interface HitRiderResult {
  abilityId: string;
  displayName: string;
  summary: string;
  saved?: boolean;
  saveRoll?: number;
  saveTotal?: number;
  saveDC?: number;
  conditionApplied?: string;
}

// ============================================================================
// Reactions
// ============================================================================

export interface ReactionPendingAction {
  id: string;
  type: string;
  actor: CombatantRef;
  status: string;
  reactionOpportunities: Array<{
    opportunityId?: string;
    combatantId: string;
    combatantName?: string;
    canAttack?: boolean;
    hasReaction?: boolean;
    reactionType: string;
    context?: Record<string, unknown>;
  }>;
  resolvedReactions: Array<{
    combatantId: string;
    choice: "use" | "decline";
  }>;
  expiresAt?: string;
}

export interface ReactionResponse {
  success: boolean;
  pendingActionId: string;
  status: string;
  message: string;
  attackResult?: Record<string, unknown>;
  spellCastResult?: Record<string, unknown>;
  damageReactionResult?: Record<string, unknown>;
}

// ============================================================================
// LLM / Query
// ============================================================================

export interface IntentResult {
  command: {
    kind: string;
    subject?: string;
    [key: string]: unknown;
  };
}

export interface CombatQueryResponse {
  answer: string;
  context?: JsonValue;
}

// ============================================================================
// Inventory
// ============================================================================

export interface InventoryItem {
  name: string;
  magicItemId?: string;
  equipped: boolean;
  attuned: boolean;
  quantity: number;
  slot?: string;
}

export interface InventoryResponse {
  characterId: string;
  characterName: string;
  inventory: InventoryItem[];
  attunedCount: number;
  maxAttunementSlots: number;
}

// ============================================================================
// Rest
// ============================================================================

export interface RestResponse {
  characters: Array<{
    id?: string;
    name: string;
    poolsRefreshed: string[];
  }>;
}

// ============================================================================
// SSE Events
// ============================================================================

export interface GameEvent {
  type: string;
  payload: Record<string, unknown>;
  createdAt?: string;
}

// ============================================================================
// Scenario Types (setup-only — CLI drops into interactive REPL)
// ============================================================================

export interface CliScenario {
  name: string;
  description?: string;
  setup: ScenarioSetup;
}

export interface ScenarioSetup {
  character: CharacterSetup;
  monsters: MonsterSetup[];
  npcs?: NPCSetup[];
  aiConfig?: {
    defaultBehavior?: string;
    defaultBonusAction?: string;
  };
}

export interface CharacterSetup {
  name: string;
  className: string;
  level: number;
  position?: { x: number; y: number };
  sheet?: Record<string, unknown>;
}

export interface MonsterSetup {
  name: string;
  position?: { x: number; y: number };
  statBlock: Record<string, unknown>;
}

export interface NPCSetup {
  name: string;
  position?: { x: number; y: number };
  faction?: string;
  aiControlled?: boolean;
  statBlock: Record<string, unknown>;
}

// ============================================================================
// CLI Options
// ============================================================================

export interface CLIOptions {
  serverUrl: string;
  scenarioName?: string;
  verbose: boolean;
  noNarration: boolean;
}
