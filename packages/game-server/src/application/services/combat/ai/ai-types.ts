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
    | "moveToward"
    | "moveAwayFrom"
    | "dash"
    | "dodge"
    | "disengage"
    | "help"
    | "hide"
    | "grapple"
    | "escapeGrapple"
    | "shove"
    | "search"
    | "useObject"
    | "castSpell"
    | "useFeature"
    | "endTurn";
  target?: string;
  attackName?: string;
  destination?: { x: number; y: number };
  desiredRange?: number;
  bonusAction?: string;
  endTurn?: boolean;
  intentNarration?: string; // Brief description of what the AI plans to do (before action execution)
  reasoning?: string;
  spellName?: string;
  spellLevel?: number;
  featureId?: string; // For useFeature: ability/feature identifier (e.g., "turnUndead", "layOnHands")
  seed?: number;
};

/**
 * Port interface for AI decision making.
 * Infrastructure layer provides LLM implementation; test harness provides mocks.
 */
/**
 * Compact view of an item in the AI combatant's inventory. Surfaced via
 * `AiCombatContext.usableItems` so the decision layer can pick by expected
 * heal, effect type, or action-economy cost without re-fetching item
 * definitions.
 */
export interface AiItemSummary {
  readonly name: string;
  /** Reference into `magic-item-catalog` when the instance is a known magic item. */
  readonly magicItemId?: string;
  /** Remaining stack count (>= 1 when surfaced; 0-count items are filtered out). */
  readonly quantity: number;
  /** Primary effect classification; drives AI branching. */
  readonly effectKind: "healing" | "buff" | "utility" | "harmful" | "other";
  /**
   * Average HP restored when consumed — flat-heal items contribute their
   * modifier directly; dice-heal items use expected value (diceCount * (diceSides+1)/2 + modifier).
   * Absent when the item does not heal.
   */
  readonly estimatedHeal?: number;
  /**
   * Action-economy cost for SELF-USE (`use`). Callers compare against
   * available action/bonus-action slots before branching. Defaults to
   * 'action' when `actionCosts.use` is undefined.
   */
  readonly useCost: "action" | "bonus" | "utilize" | "none";
}

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
    spellLevel?: number;
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
    conditions?: string[];
    position?: { x: number; y: number };
    economy?: {
      actionSpent: boolean;
      bonusActionSpent: boolean;
      reactionSpent: boolean;
      movementSpent: boolean;
      movementRemaining?: number;
    };
    ac?: number;
    speed?: number;
    size?: string;
    abilityScores?: {
      strength: number;
      dexterity: number;
      constitution: number;
      intelligence: number;
      wisdom: number;
      charisma: number;
    };
    spellSaveDC?: number;
    spellAttackBonus?: number;
    initiative?: number | null;
    resourcePools?: Array<{
      name: string;
      current: number;
      max: number;
    }>;
    concentrationSpell?: string;
    damageResistances?: string[];
    damageImmunities?: string[];
    damageVulnerabilities?: string[];
    activeBuffs?: string[];
    traits?: unknown[];
    attacks?: unknown[];
    actions?: unknown[];
    bonusActions?: unknown[];
    reactions?: unknown[];
    spells?: unknown[];
    abilities?: unknown[];
    features?: unknown[];
    classAbilities?: Array<{
      name: string;
      economy: string;
      resourceCost?: string;
      effect?: string;
    }>;
    /** Number of attacks per Attack action (Extra Attack, Multiattack). Defaults to 1. */
    attacksPerAction?: number;
    /** Prepared spells available to this caster, enriched from canonical catalog. */
    preparedSpells?: Array<{
      name: string;
      level: number;
      school?: string;
      concentration?: boolean;
      castingTime?: string;
      range?: number | string;
    }>;
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
    conditions?: string[];
    position?: { x: number; y: number };
    distanceFeet?: number;
    ac?: number;
    speed?: number;
    size?: string;
    class?: string;
    level?: number;
    initiative: number | null;
    knownAbilities?: string[];
    damageResistances?: string[];
    damageImmunities?: string[];
    damageVulnerabilities?: string[];
    deathSaves?: { successes: number; failures: number };
    concentrationSpell?: string;
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
    conditions?: string[];
    position?: { x: number; y: number };
    distanceFeet?: number;
    ac?: number;
    speed?: number;
    size?: string;
    spellSaveDC?: number;
    initiative: number | null;
    knownAbilities?: string[];
    damageResistances?: string[];
    damageImmunities?: string[];
    damageVulnerabilities?: string[];
    concentrationSpell?: string;
    deathSaves?: { successes: number; failures: number };
    /** Cover level this enemy has from the AI combatant's position */
    coverFromMe?: "none" | "half" | "three-quarters" | "full";
  }>;
  battlefield?: {
    grid: string;
    legend: string;
    size: { width: number; height: number };
  };
  zones?: Array<{
    id: string;
    center: { x: number; y: number };
    radiusFeet: number;
    shape: string;
    source: string;
    type: string;
    effects: Array<{
      trigger: string;
      damageType?: string;
      damage?: string;
      saveAbility?: string;
      saveDC?: number;
    }>;
  }>;
  /**
   * Whether the AI combatant has at least one healing potion available in inventory.
   * Used by the decision maker to pre-filter the useObject action.
   *
   * @deprecated Use `canUseItems && usableItems.length > 0` instead. Retained
   * for backward compatibility with LLM prompt snapshots; compute via the same
   * logic in the context builder.
   */
  hasPotions: boolean;
  /**
   * D&D 5e 2024: certain creature types cannot drink potions or use item actions
   * (beast forms, undead, constructs, oozes, plants). Derived from the AI
   * combatant's `creatureType` (character/NPC sheet or monster stat block).
   * When false, the deterministic AI and the LLM are both gated away from
   * useObject even if `usableItems.length > 0`.
   */
  canUseItems: boolean;
  /**
   * Items in the combatant's inventory that have a `potionEffects` definition
   * and at least 1 remaining stack. Populated only when `canUseItems === true`;
   * otherwise returned as an empty array. Replaces the older boolean
   * `hasPotions`; retains full item metadata so the AI can compare items by
   * expected healing, effect type, and action-economy cost.
   */
  usableItems: AiItemSummary[];
  /**
   * Average HP recovered by the best available bonus-action healing spell
   * (e.g. Healing Word, Mass Healing Word). Absent when no BA heal spell is
   * prepared or known. Used by `UseObjectHandler.findBestUsableItem` to skip
   * the potion branch when a spell would heal more.
   */
  bestBonusHealSpellEV?: number;
  recentNarrative: string[];
  actionHistory: string[];
  turnResults: TurnStepResult[];
  lastActionResult: TurnStepResult | null;
  /**
   * Raw combat map data (optional). Used by deterministic AI for cover-seeking
   * position evaluation. Not serialized to LLM prompts.
   */
  mapData?: unknown;
  battlePlan?: {
    priority: string;
    focusTarget?: string;
    yourRole?: string;
    tacticalNotes: string;
    retreatCondition?: string;
  };
  /**
   * AI-L2: Flee threshold as a fraction of max HP (e.g. 0.25 = flee when HP ≤ 25%).
   * Opt-in per creature type — undefined means never flee (backward compatible).
   * Undead, constructs, etc. should leave this undefined.
   */
  fleeThreshold?: number;
}

/**
 * Typed reference to a combatant actor.
 */
export type ActorRef =
  | { type: "Monster"; monsterId: string }
  | { type: "NPC"; npcId: string }
  | { type: "Character"; characterId: string };
