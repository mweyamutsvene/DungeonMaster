/**
 * Domain: Ability Execution Interface
 * 
 * Defines the contract for executing class features, monster abilities, and bonus actions.
 * Executors are registered in the application layer and handle the full lifecycle of ability execution.
 */

// ─── Narrow protocol interfaces ────────────────────────────────────────
// Replace concrete Creature / Combat class requirements with minimal
// interfaces that match what executors **actually** use.  The real domain
// classes satisfy these structurally — no adapters needed for them.

/**
 * Minimal actor interface that ability executors actually need.
 * Both the domain `Creature` class and tabletop adapters satisfy this.
 */
export interface AbilityActor {
  getId(): string;
  getName(): string;
  getCurrentHP(): number;
  getMaxHP(): number;
  getSpeed(): number;
  modifyHP(amount: number): { actualChange: number; [key: string]: unknown };
}

/**
 * Minimal combat-context interface that ability executors actually need.
 * Both the domain `Combat` class and tabletop adapters satisfy this.
 */
export interface AbilityCombatContext {
  hasUsedAction(creatureId: string, actionType: string): boolean;
  getRound(): number;
  getTurnIndex(): number;
  addEffect(creatureId: string, effect: any): void;
  getPosition(creatureId: string): { x: number; y: number; elevation?: number } | undefined;
  setPosition(creatureId: string, pos: { x: number; y: number; elevation?: number }): void;
  getMovementState?(creatureId: string): any;
  initializeMovementState?(creatureId: string, pos: any, speed: number): void;
  setJumpMultiplier?(creatureId: string, multiplier: number): void;
}

/**
 * Context provided to ability executors containing all information needed for execution.
 */
export interface AbilityExecutionContext {
  /** Session ID for event/persistence operations */
  sessionId: string;
  
  /** Encounter ID */
  encounterId: string;
  
  /** The creature using the ability */
  actor: AbilityActor;
  
  /** Combat instance (for action economy, positioning, etc.) */
  combat: AbilityCombatContext;
  
  /** Ability ID being executed (e.g., "monster:bonus:nimble-escape") */
  abilityId: string;
  
  /** Optional target creature (for targeted abilities) */
  target?: AbilityActor;
  
  /** Optional parameters from LLM decision (e.g., choice selection) */
  params?: Record<string, unknown>;
  
  /** Services available for delegation */
  services: {
    attack?: (params: any) => Promise<any>;
    move?: (params: any) => Promise<any>;
    disengage?: (params: any) => Promise<any>;
    dash?: (params: any) => Promise<any>;
    dodge?: (params: any) => Promise<any>;
    hide?: (params: any) => Promise<any>;
    help?: (params: any) => Promise<any>;
    castSpell?: (params: any) => Promise<any>;
    [key: string]: ((params: any) => Promise<any>) | undefined;
  };
}

/**
 * Result of ability execution.
 */
export interface AbilityExecutionResult {
  /** Whether execution succeeded */
  success: boolean;
  
  /** Human-readable summary of what happened */
  summary: string;
  
  /** Structured data about the execution (for events/logging) */
  data?: Record<string, unknown>;
  
  /** Error message if execution failed */
  error?: string;

  /** 
   * Whether the ability requires player input (e.g., dice roll) before completing.
   * When true, the caller should prompt for input and continue execution.
   */
  requiresPlayerInput?: boolean;

  /**
   * Pending action state for tabletop flow.
   * Contains attack/damage/initiative details for multi-step dice resolution.
   */
  pendingAction?: {
    type: string;
    timestamp: Date;
    actorId: string;
    targetId?: string;
    weaponSpec?: Record<string, unknown>;
    bonusAction?: string;
    flurryStrike?: number;
    [key: string]: unknown;
  };

  /**
   * Roll type needed for player input (e.g., "attack", "damage").
   */
  rollType?: "attack" | "damage";

  /**
   * Dice formula needed (e.g., "d20", "1d6+3").
   */
  diceNeeded?: string;

  /**
   * Resources consumed by the ability (e.g., ki points, spell slots).
   */
  resourcesSpent?: {
    kiPoints?: number;
    spellSlot?: number;
    hitDice?: number;
    [key: string]: number | undefined;
  };
}

/**
 * Ability executor interface.
 * 
 * Each executor handles one or more related abilities (e.g., all Cunning Action variants).
 * Executors are responsible for:
 * - Validating prerequisites (resources, action economy, conditions)
 * - Spending costs (ki points, spell slots, etc.)
 * - Delegating to core action services
 * - Returning structured results
 */
export interface AbilityExecutor {
  /**
   * Check if this executor can handle the given ability ID.
   * 
   * @param abilityId - Structured ability ID (e.g., "monster:bonus:nimble-escape")
   * @returns True if this executor handles this ability
   */
  canExecute(abilityId: string): boolean;
  
  /**
   * Execute the ability.
   * 
   * @param context - Full execution context
   * @returns Result of execution
   */
  execute(context: AbilityExecutionContext): Promise<AbilityExecutionResult>;
}
