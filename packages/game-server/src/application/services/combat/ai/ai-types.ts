/**
 * AI Module Type Definitions
 *
 * Consolidated types and interfaces for AI-controlled combatant decision making.
 * Layer: Application (ports for infrastructure adapters)
 */

/**
 * Represents a decision made by the AI for a combatant's turn.
 */
export type AiDecision = {
  action:
    | "attack"
    | "move"
    | "dash"
    | "dodge"
    | "disengage"
    | "help"
    | "hide"
    | "grapple"
    | "shove"
    | "search"
    | "useObject"
    | "castSpell"
    | "endTurn";
  target?: string;
  attackName?: string;
  destination?: { x: number; y: number };
  bonusAction?: string;
  endTurn?: boolean;
  intentNarration?: string; // Brief description of what the AI plans to do (before action execution)
  reasoning?: string;
  spellName?: string;
  seed?: number;
};

/**
 * Port interface for AI decision making.
 * Infrastructure layer provides LLM implementation; test harness provides mocks.
 */
export interface IAiDecisionMaker {
  decide(input: {
    combatantName: string;
    combatantType: string;
    context: unknown;
  }): Promise<AiDecision | null>;
}

/**
 * Result of a single action step during an AI turn.
 */
export type TurnStepResult = {
  step: number;
  action: AiDecision["action"];
  ok: boolean;
  intentNarration?: string;
  reasoning?: string;
  decision?: {
    target?: string;
    attackName?: string;
    destination?: { x: number; y: number };
    bonusAction?: string;
    spellName?: string;
    seed?: number;
    endTurn?: boolean;
  };
  summary: string;
  data?: Record<string, unknown>;
};

/**
 * Combat context passed to AI decision maker.
 * Contains all information needed for tactical decisions.
 */
export interface AiCombatContext {
  combatant: {
    name: string;
    type?: string;
    alignment?: string;
    cr?: number;
    class?: string;
    level?: number;
    hp: {
      current: number;
      max: number;
      percentage: number;
    };
    position?: { x: number; y: number };
    economy?: {
      actionSpent: boolean;
      bonusActionSpent: boolean;
      reactionSpent: boolean;
      movementRemaining?: number;
    };
    traits?: unknown[];
    attacks?: unknown[];
    actions?: unknown[];
    bonusActions?: unknown[];
    reactions?: unknown[];
    spells?: unknown[];
    abilities?: unknown[];
  };
  combat: {
    round: number;
    turn: number;
    totalCombatants: number;
  };
  allies: Array<{
    name: string;
    hp: {
      current: number;
      max: number;
      percentage: number;
    };
    position?: { x: number; y: number };
    initiative: number | null;
  }>;
  enemies: Array<{
    name: string;
    class?: string;
    level?: number;
    hp: {
      current: number;
      max: number;
      percentage: number;
    };
    position?: { x: number; y: number };
    ac?: number;
    initiative: number | null;
    knownAbilities?: string[];
  }>;
  battlefield?: {
    grid: string;
    legend: string;
    size: { width: number; height: number };
  };
  recentNarrative: string[];
  actionHistory: string[];
  turnResults: TurnStepResult[];
  lastActionResult: TurnStepResult | null;
}

/**
 * Typed reference to a combatant actor.
 */
export type ActorRef =
  | { type: "Monster"; monsterId: string }
  | { type: "NPC"; npcId: string }
  | { type: "Character"; characterId: string };
