/**
 * Scenario Runner
 *
 * Loads and executes test scenarios defined in JSON files.
 * Each scenario describes a sequence of API calls and expected responses.
 */

import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================================
// Types
// ============================================================================

/** AI behavior options for the mock decision maker */
export type AiBehavior = "attack" | "endTurn" | "flee" | "castSpell" | "approach" | "grapple" | "escapeGrapple" | "hide" | "usePotion" | "help";

export interface TestScenario {
  name: string;
  description?: string;
  setup: ScenarioSetup;
  actions: ScenarioAction[];
}

export interface CharacterSetup {
  name: string;
  className: string;
  level: number;
  /** Optional subclass identifier (e.g. "draconic-sorcery-red", "Hunter"). Merged into sheet. */
  subclass?: string;
  position?: { x: number; y: number };
  sheet?: Record<string, unknown>;
}

export interface ScenarioSetup {
  /** Single character (legacy, still supported) */
  character?: CharacterSetup;
  /** Multi-PC: array of characters. Overrides `character` if both present. */
  characters?: CharacterSetup[];
  monsters: Array<{
    name: string;
    position?: { x: number; y: number };
    statBlock: Record<string, unknown>;
  }>;
  npcs?: Array<{
    name: string;
    position?: { x: number; y: number };
    faction?: string;
    aiControlled?: boolean;
    statBlock: Record<string, unknown>;
  }>;
  /** Configure mock AI behavior */
  aiConfig?: {
    defaultBehavior?: AiBehavior;
    defaultBonusAction?: string;
    /** Per-monster behavior overrides by name */
    monsterBehaviors?: Record<string, AiBehavior>;
  };
  /** Pre-placed ground items on the battlefield at combat start */
  groundItems?: Array<{
    name: string;
    position: { x: number; y: number };
    weaponStats?: {
      name: string;
      kind: "melee" | "ranged";
      range?: string;
      attackBonus: number;
      damage: { diceCount: number; diceSides: number; modifier: number };
      damageType?: string;
      properties?: string[];
    };
  }>;
  /** Enable the optional flanking rule for this encounter */
  flankingEnabled?: boolean;
}

export type ScenarioAction =
  | InitiateAction
  | RollResultAction
  | CombatAction
  | MoveCompleteAction
  | ReactionRespondAction
  | PlayerOaRollAction
  | ConfigureAiAction
  | AssertStateAction
  | EndTurnAction
  | WaitForTurnAction
  | WaitForPlayerOaAction
  | WaitForShieldReactionAction
  | WaitForReactionAction
  | SetTerrainAction
  | SetSurpriseAction
  | RestAction
  | QueryAction
  | NpcActionAction
  | ApplyConditionAction
  | QueueMonsterActionsAction
  | QueueDiceRollsAction;

interface InitiateAction {
  type: "initiate";
  /** Which character initiates (name). Default: first character. */
  actor?: string;
  input: { text: string };
  expect?: {
    rollType?: string;
    requiresPlayerInput?: boolean;
    /** Expect the roll request to signal disadvantage */
    disadvantage?: boolean;
    /** Expect the roll request to signal advantage */
    advantage?: boolean;
  };
}

interface RollResultAction {
  type: "rollResult";
  /** Which character submits the roll (name). Default: first character. */
  actor?: string;
  input: { text: string };
  expect?: {
    rollType?: string;
    hit?: boolean;
    isCritical?: boolean;
    combatStarted?: boolean;
    actionComplete?: boolean;
    requiresPlayerInput?: boolean;
    combatEnded?: boolean;
    victoryStatus?: string;
    /** For death save rolls */
    deathSaveResult?: "success" | "failure" | "stabilized" | "dead" | "revived";
    deathSaves?: { successes: number; failures: number };
    /** Uncanny Metabolism auto-trigger on initiative */
    uncannyMetabolism?: {
      kiRestored?: { min?: number; max?: number };
      healAmount?: { min?: number; max?: number };
    };
    /** Open Hand Technique result on flurry hit */
    openHandTechnique?: {
      saved?: boolean;
      conditionApplied?: string;
    };
    /** Stunning Strike result on melee hit */
    stunningStrike?: {
      saved?: boolean;
      conditionApplied?: string;
    };
    /** Eligible on-hit enhancements returned on a hit (2024 post-hit flow) */
    eligibleEnhancements?: Array<{
      keyword: string;
      displayName?: string;
      choiceOptions?: string[];
    }>;
    /** Alert feat initiative swap offer */
    initiativeSwapOffer?: boolean;
    /** Assert current turn actor name in responses that include turn state */
    currentTurnActor?: string;
    /** Expect an error response (non-200 status) */
    error?: boolean;
    /** Error message should contain this string */
    errorContains?: string;
  };
}

interface CombatAction {
  type: "action";
  /** Which character performs the action (name). Default: first character. */
  actor?: string;
  input: { text: string };
  comment?: string;
  expect?: {
    rollType?: string;
    requiresPlayerInput?: boolean;
    actionComplete?: boolean;
    type?: string;
    /** Expect an error response (non-200 status) */
    error?: boolean;
    /** Error message should contain this string */
    errorContains?: string;
    /** Expect advantage on the resulting attack roll */
    advantage?: boolean;
    /** Expect disadvantage on the resulting attack roll */
    disadvantage?: boolean;
  };
}

/** Execute a combat action as an NPC (uses NPC's ID as actorId) */
interface NpcActionAction {
  type: "npcAction";
  input: { text: string; npcIndex: number };
  comment?: string;
  expect?: {
    rollType?: string;
    requiresPlayerInput?: boolean;
    actionComplete?: boolean;
    type?: string;
    error?: boolean;
    errorContains?: string;
  };
}

/**
 * Directly apply a condition to a combatant via DM override PATCH endpoint.
 * Useful for testing condition-dependent mechanics (Frightened movement, etc.)
 * without relying on spell casting or other complex flows.
 */
interface ApplyConditionAction {
  type: "applyCondition";
  input: {
    /** Target: "character" (first PC), "character:Name", "monster:Name", or "monster:0" (index) */
    target: string;
    /** Condition name, e.g. "Frightened", "Prone", "Stunned" */
    condition: string;
    /** Duration type */
    duration: string;
    /** Optional source (combatant ID or description) */
    source?: string;
    /** If source is "monster:Name", resolve to that monster's combatant ID */
    sourceMonster?: string;
  };
  comment?: string;
}

interface MoveCompleteAction {
  type: "moveComplete";
  comment?: string;
  /** Optional rolls for player OA (attack roll, damage roll) */
  rolls?: number[];
  expect?: {
    success?: boolean;
    /** Expect OA to hit */
    hit?: boolean;
    /** Expect damage dealt */
    damageDealt?: number;
  };
}

interface PlayerOaRollAction {
  type: "playerOaRoll";
  input: {
    /** D20 attack roll value */
    attackRoll: number;
    /** Damage roll value (only used if attack hits) */
    damageRoll?: number;
  };
  comment?: string;
  expect?: {
    hit?: boolean;
  };
}

/** Wait for an AI move that triggers a player opportunity attack */
interface WaitForPlayerOaAction {
  type: "waitForPlayerOa";
  comment?: string;
  timeout?: number;
}

/** Wait for an AI attack that triggers a Shield reaction prompt */
interface WaitForShieldReactionAction {
  type: "waitForShieldReaction";
  comment?: string;
  timeout?: number;
}

/** Wait for an AI attack that triggers a specific reaction prompt (generic version) */
interface WaitForReactionAction {
  type: "waitForReaction";
  input: { reactionType: string };
  comment?: string;
  timeout?: number;
}

/** Configure mock AI behavior mid-scenario */
interface ConfigureAiAction {
  type: "configureAi";
  input: {
    defaultBehavior: AiBehavior;
    defaultBonusAction?: string;
    monsterBehaviors?: Record<string, AiBehavior>;
  };
  comment?: string;
}

/**
 * Queue specific AiDecision objects for the mock AI decision maker.
 * Decisions are consumed in FIFO order. When the queue is empty,
 * the mock falls back to its configured behavior (defaultBehavior / monsterBehaviors).
 *
 * Use this to replicate exact monster action sequences observed in live play
 * (e.g., from AgentTestPlayer bug reports) for deterministic reproduction.
 */
interface QueueMonsterActionsAction {
  type: "queueMonsterActions";
  input: {
    decisions: Array<{
      action: string;
      target?: string;
      attackName?: string;
      destination?: { x: number; y: number };
      desiredRange?: number;
      bonusAction?: string;
      endTurn?: boolean;
      spellName?: string;
      spellLevel?: number;
      featureId?: string;
      seed?: number;
    }>;
  };
  comment?: string;
}

interface ReactionRespondAction {
  type: "reactionRespond";
  input: {
    choice: "use" | "decline";
    /** For War Caster spell-as-OA: which spell to cast */
    spellName?: string;
    /** For War Caster spell-as-OA: optional upcast level */
    castAtLevel?: number;
  };
  comment?: string;
}

/**
 * Queue specific raw d20/die values into the server's DiceRoller queue.
 * These values are consumed FIFO by the NEXT server-side die rolls
 * (e.g., CON saves for Stunning Strike, monster attack rolls, damage rolls).
 * When the queue is empty, the server falls back to its seeded roller.
 *
 * Use this to make server-side rolls deterministic in E2E scenarios
 * (e.g., force a natural 1 on a CON save so Stunning Strike always lands).
 */
interface QueueDiceRollsAction {
  type: "queueDiceRolls";
  input: {
    /** Raw die values to queue (no modifiers applied — these are the die face values) */
    values: number[];
    /** Optional label for verbose logging */
    label?: string;
  };
  comment?: string;
}

interface AssertStateAction {
  type: "assertState";
  /** Which character to assert on (name). Default: first character. */
  actor?: string;
  expect: {
    monstersAlive?: number;
    characterHp?: { min?: number; max?: number };
    /** Assert HP of a specific monster by name */
    monsterHp?: { name: string; min?: number; max?: number; exact?: number };
    /** Assert position of a specific monster by name */
    monsterPosition?: { name: string; x?: number; y?: number };
    combatStatus?: "Pending" | "Active" | "Complete";
    /** Assert conditions on a combatant by name or type */
    monsterConditions?: { name: string; hasConditions?: string[]; doesNotHaveConditions?: string[] };
    /** Assert ActiveEffect sources on a specific monster */
    monsterActiveEffects?: { name: string; hasSources?: string[]; doesNotHaveSources?: string[] };
    characterConditions?: { hasConditions?: string[]; doesNotHaveConditions?: string[] };
    /** Assert a resource pool value on the player character */
    characterResource?: { poolName: string; current?: number; max?: number };
    /** Assert the player character's position */
    characterPosition?: { x?: number; y?: number };
    /** Assert the player character is concentrating on a specific spell (null = not concentrating) */
    characterConcentration?: string | null;
    /** Assert a monster is concentrating on a specific spell (null = not concentrating) */
    monsterConcentration?: { name: string; spell: string | null };
    /** Assert ground items on the map */
    groundItemCount?: number;
    /** Assert a specific ground item exists on the map */
    groundItemExists?: { name: string; nearPosition?: { x: number; y: number } };
    /** Assert multiple ground items exist on the map */
    groundItemsHas?: string[];
    /** Assert a specific ground item does NOT exist on the map */
    groundItemNotExists?: { name: string };
    /** Assert drawn weapons on the player character (case-insensitive) */
    characterDrawnWeapons?: { has?: string[]; doesNotHave?: string[] };
    /** Assert inventory items on the player character */
    characterInventory?: {
      has?: Array<{ name: string; quantity?: number }>;
      doesNotHave?: string[];
    };
    /** Assert temporary HP on the player character (stored in resources.tempHp) */
    characterTempHp?: { min?: number; max?: number; exact?: number };
    /** Assert temporary HP on a specific monster (stored in resources.tempHp) */
    monsterTempHp?: { name: string; min?: number; max?: number; exact?: number };
  };
}

interface EndTurnAction {
  type: "endTurn";
  /** Which character ends their turn (name). Default: first character. */
  actor?: string;
  expect?: {
    nextCombatant?: string;
  };
}

interface WaitForTurnAction {
  type: "waitForTurn";
  /** Which character's turn to wait for (name). Default: any character. */
  actor?: string;
  comment?: string;
  timeout?: number; // ms, default 5000
}

/**
 * Query action for testing LLM intent parsing and question handling.
 * Tests the /llm/intent endpoint to verify question classification.
 */
interface QueryAction {
  type: "query";
  input: { text: string };
  comment?: string;
  expect?: {
    /** Expected query subject from intent parsing */
    subject?: "hp" | "weapons" | "spells" | "features" | "party" | "stats" | "equipment" | "ac" | "actions" | "tactical" | "environment";
    /** If true, expect the query to be classified as a query (kind="query") */
    isQuery?: boolean;
  };
}

/**
 * Set terrain zones on the combat map.
 * Must be used AFTER combat is initiated (encounter exists with a map).
 */
interface SetTerrainAction {
  type: "setTerrain";
  input: {
    terrainZones: Array<{
      x: number;
      y: number;
      terrain: string;
      terrainElevation?: number;
      terrainDepth?: number;
    }>;
  };
  comment?: string;
}

/**
 * Set surprise state on the encounter (DM override).
 * Should be used BEFORE combat initiate to ensure the server uses the surprise state.
 * Creates the encounter if it doesn't exist yet.
 */
interface SetSurpriseAction {
  type: "setSurprise";
  input: {
    surprise: "enemies" | "party" | { surprised: string[] };
  };
  comment?: string;
}

/**
 * Take a short or long rest for all characters in the session.
 * Refreshes class resource pools; long rest also restores HP.
 */
interface RestAction {
  type: "rest";
  input: {
    restType: "short" | "long";
    /**
     * Short rest only: map of character name → number of Hit Dice to spend.
     * The runner translates names to IDs before calling the API.
     */
    hitDiceSpending?: Record<string, number>;
    /**
     * Short rest only: Wizard Arcane Recovery — map of character name → {slotLevel → count}.
     * Pass-through to /sessions/:id/rest body. Server validates cap + L6+ rule.
     */
    arcaneRecovery?: Record<string, Record<number, number>>;
  };
  comment?: string;
  expect?: {
    /** Expected pool names that were refreshed */
    poolsRefreshed?: string[];
    /** Verify character HP after rest (by name) */
    characterHp?: { name: string; min?: number; max?: number; exact?: number };
    /** Verify remaining Hit Dice after rest (by character name) */
    characterHitDice?: { name: string; remaining: number };
    /** Verify HP recovered from Hit Dice spending (short rest only) */
    hpRecovered?: { name: string; min?: number; max?: number; exact?: number };
  };
}

export interface ScenarioResult {
  success: boolean;
  totalSteps: number;
  passedSteps: number;
  failedAtStep?: number;
  error?: string;
}

interface RunOptions {
  verbose?: boolean;
  detailed?: boolean;
}

// ANSI color codes for pretty output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
  gray: "\x1b[90m",
};

// ============================================================================
// Scenario Loader
// ============================================================================

export async function loadScenario(name: string): Promise<TestScenario> {
  // Support both flat names ("happy-path") and subfolder paths ("fighter/action-surge")
  const scenarioPath = join(__dirname, "scenarios", `${name}.json`);
  const content = await readFile(scenarioPath, "utf-8");
  return JSON.parse(content) as TestScenario;
}

// ============================================================================
// HTTP Helpers
// ============================================================================

async function httpPost(url: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

async function httpGet(url: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url);
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

async function httpPatch(url: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

/**
 * Format and display combat events (monster attacks, damage, etc.)
 * Returns the timestamp of the last event processed
 */
function displayCombatEvents(
  events: Array<{ type: string; payload?: Record<string, unknown>; createdAt?: string }>,
  colors: Record<string, string>,
): void {
  for (const event of events) {
    const payload = event.payload ?? {};
    
    switch (event.type) {
      case "AiDecision": {
        // Show what the AI decided to do
        const decision = payload.decision as Record<string, unknown> | undefined;
        if (decision) {
          const action = decision.action ?? "unknown";
          const target = decision.target;
          const attackName = decision.attackName;
          const destination = decision.destination as { x: number; y: number } | undefined;
          
          let actionDesc = `${action}`;
          if (action === "attack" && target) {
            actionDesc = attackName ? `attacks ${target} with ${attackName}` : `attacks ${target}`;
          } else if (action === "move" && destination) {
            actionDesc = `moves to (${destination.x}, ${destination.y})`;
          } else if (action === "endTurn") {
            actionDesc = "ends turn";
          }
          
          console.log(`   ${colors.cyan}🤖 [AI Decision]${colors.reset} ${actionDesc}`);
        }
        break;
      }
      
      case "NarrativeText": {
        const text = payload.text as string | undefined;
        if (text) {
          console.log(`   ${colors.italic}${colors.gray}${text}${colors.reset}`);
        }
        break;
      }
      
      case "AttackResolved": {
        // Payload now has flattened fields: attackRoll, attackBonus, attackTotal, targetAC, hit, critical, damageApplied
        const attackName = payload.attackName ?? "attack";
        const attackRoll = payload.attackRoll ?? "?";
        const attackBonus = payload.attackBonus ?? 0;
        const attackTotal = payload.attackTotal ?? "?";
        const targetAC = payload.targetAC ?? "?";
        const hit = payload.hit;
        const critical = payload.critical;
        const damageApplied = payload.damageApplied;
        
        const criticalStr = critical ? ` ${colors.bright}${colors.yellow}CRITICAL!${colors.reset}` : "";
        const hitStatus = hit ? `${colors.green}Hit!${colors.reset}${criticalStr}` : `${colors.yellow}Miss!${colors.reset}`;
        const damageStr = hit && damageApplied ? ` (${damageApplied} damage)` : "";
        console.log(`   ${colors.magenta}⚔️ [Attack]${colors.reset} ${attackName}: ${attackRoll} + ${attackBonus} = ${attackTotal} vs AC ${targetAC} - ${hitStatus}${damageStr}`);
        break;
      }
      
      case "DamageApplied": {
        // Payload has: target, amount, hpCurrent
        const amount = payload.amount ?? 0;
        const hpCurrent = payload.hpCurrent ?? "?";
        const downed = typeof hpCurrent === "number" && hpCurrent <= 0;
        const downedNote = downed ? ` ${colors.yellow}⚠ DOWN!${colors.reset}` : "";
        console.log(`   ${colors.magenta}💥 [Damage]${colors.reset} ${amount} damage dealt (HP now: ${hpCurrent})${downedNote}`);
        break;
      }
      
      case "Move": {
        const actorName = payload.actorName ?? "Combatant";
        const to = payload.to as { x: number; y: number } | undefined;
        const distance = payload.distance ?? "?";
        if (to) {
          console.log(`   ${colors.blue}🏃 [Move]${colors.reset} ${actorName} moves to (${to.x}, ${to.y}) [${distance}ft]`);
        }
        break;
      }
      
      case "TurnAdvanced": {
        const nextCombatant = payload.nextCombatantName ?? "Next combatant";
        console.log(`   ${colors.dim}[Turn → ${nextCombatant}]${colors.reset}`);
        break;
      }
    }
  }
}

// ============================================================================
// Scenario Runner
// ============================================================================

export interface RunScenarioCallbacks {
  /** Configure the mock AI decision maker */
  configureAi?: (config: { defaultBehavior: AiBehavior; defaultBonusAction?: string; monsterBehaviors?: Record<string, AiBehavior> }) => void;
  /** Queue specific AiDecision objects for deterministic monster turn reproduction */
  queueDecisions?: (decisions: Array<Record<string, unknown>>) => void;
  /** Queue specific raw die values into the server's DiceRoller FIFO queue */
  queueDiceRolls?: (values: number[]) => void;
}

export async function runScenario(
  scenario: TestScenario,
  baseUrl: string,
  options: RunOptions = {},
  callbacks: RunScenarioCallbacks = {},
): Promise<ScenarioResult> {
  const { verbose, detailed } = options;
  let passedSteps = 0;
  const totalSteps = scenario.actions.length + 2; // +2 for setup steps (create session, create entities)

  // Track IDs for variable substitution
  let sessionId: string | undefined;
  let characterId: string | undefined; // Default (first) character ID — legacy compat
  let encounterId: string | undefined;
  const monsterIds: string[] = [];

  // Multi-PC tracking: name → ID mapping
  const characterMap = new Map<string, string>(); // name → characterId
  const characterIdToName = new Map<string, string>(); // characterId → name

  /** Resolve actor ID from an optional actor name. Falls back to first (default) character. */
  const resolveActorId = (actorName?: string): string => {
    if (!actorName) return characterId!;
    const id = characterMap.get(actorName);
    if (!id) {
      throw new Error(`Actor "${actorName}" not found. Available characters: [${[...characterMap.keys()].join(", ")}]`);
    }
    return id;
  };
  
  // Track pending action state for move reactions
  let pendingActionId: string | undefined;
  let opportunityAttacks: Array<{ combatantId: string; opportunityId: string; canAttack: boolean }> = [];
  
  // Track last event timestamp for fetching new events
  let lastEventTime: string | undefined;

  // Apply initial AI config from scenario setup if provided
  if (scenario.setup.aiConfig && callbacks.configureAi) {
    callbacks.configureAi({
      defaultBehavior: scenario.setup.aiConfig.defaultBehavior ?? "attack",
      defaultBonusAction: scenario.setup.aiConfig.defaultBonusAction,
      monsterBehaviors: scenario.setup.aiConfig.monsterBehaviors,
    });
  }

  const log = (msg: string) => {
    if (verbose || detailed) console.log(`   ${msg}`);
  };

  // Always show player-facing messages (the narrative/DM text)
  const logPlayerMessage = (message: string | undefined, narration: string | undefined, label?: string) => {
    if (narration) {
      // Show narration first (the flavor text)
      console.log(`\n   ${colors.bright}${colors.cyan}📖 Narration:${colors.reset} ${colors.italic}${narration}${colors.reset}`);
    }
    if (message) {
      const prefix = label ? `${colors.yellow}[${label}]${colors.reset} ` : "";
      console.log(`   ${colors.bright}${colors.magenta}🎲 DM:${colors.reset} ${prefix}${message}`);
    }
  };

  const logRequest = (method: string, url: string, body?: unknown) => {
    if (detailed) {
      console.log(`\n   ${colors.cyan}${colors.bright}→ ${method}${colors.reset} ${colors.blue}${url}${colors.reset}`);
      if (body) {
        console.log(`   ${colors.gray}Request:${colors.reset}`);
        const lines = JSON.stringify(body, null, 2).split("\n");
        lines.forEach((line) => console.log(`     ${colors.dim}${line}${colors.reset}`));
      }
    }
  };

  const logResponse = (status: number, body: unknown) => {
    if (detailed) {
      const statusColor = status >= 200 && status < 300 ? colors.green : colors.yellow;
      console.log(`   ${colors.magenta}${colors.bright}← ${statusColor}${status}${colors.reset}`);
      console.log(`   ${colors.gray}Response:${colors.reset}`);
      const lines = JSON.stringify(body, null, 2).split("\n");
      lines.forEach((line) => console.log(`     ${colors.dim}${line}${colors.reset}`));
    }
  };

  const logStep = (stepNum: number, actionType: string, description?: string) => {
    if (verbose || detailed) {
      console.log(`\n${colors.bright}━━━ Step ${stepNum}: ${actionType.toUpperCase()} ━━━${colors.reset}`);
      if (description) {
        console.log(`   ${colors.gray}${description}${colors.reset}`);
      }
    }
  };

  try {
    // ========================================================================
    // Step 1: Create Session
    // ========================================================================
    logStep(1, "setup", "Creating game session");
    const sessionPayload = { storyFramework: {} };
    logRequest("POST", `${baseUrl}/sessions`, sessionPayload);
    const sessionRes = await httpPost(`${baseUrl}/sessions`, sessionPayload);
    logResponse(sessionRes.status, sessionRes.body);
    if (sessionRes.status !== 200) {
      throw new Error(`Failed to create session: ${JSON.stringify(sessionRes.body)}`);
    }
    sessionId = (sessionRes.body as any).id;
    log(`${colors.green}✓${colors.reset} Session created: ${sessionId}`);
    passedSteps++;

    // ========================================================================
    // Step 2: Create Character(s) and Monsters
    // ========================================================================
    logStep(2, "setup", "Creating character(s), monsters, and NPCs");

    // Normalize characters: support both `characters` array and legacy `character` single
    const charSetups: CharacterSetup[] = scenario.setup.characters
      ? scenario.setup.characters
      : scenario.setup.character
        ? [scenario.setup.character]
        : [];
    if (charSetups.length === 0) {
      throw new Error("Scenario setup must define `character` or `characters`");
    }

    for (const charSetup of charSetups) {
      // Merge position + subclass into sheet if provided
      const charSheet = {
        ...(charSetup.sheet ?? {
          abilityScores: { strength: 16, dexterity: 14, constitution: 15, intelligence: 10, wisdom: 12, charisma: 8 },
          maxHp: 42,
          armorClass: 18,
          speed: 30,
          proficiencyBonus: 3,
        }),
        ...(charSetup.subclass ? { subclass: charSetup.subclass } : {}),
        ...(charSetup.position ? { position: charSetup.position } : {}),
      };

      const charPayload = {
        name: charSetup.name,
        level: charSetup.level,
        className: charSetup.className,
        sheet: charSheet,
      };
      logRequest("POST", `${baseUrl}/sessions/${sessionId}/characters`, charPayload);
      const charRes = await httpPost(`${baseUrl}/sessions/${sessionId}/characters`, charPayload);
      logResponse(charRes.status, charRes.body);
      if (charRes.status !== 200) {
        throw new Error(`Failed to create character "${charSetup.name}": ${JSON.stringify(charRes.body)}`);
      }
      const thisCharId = (charRes.body as any).id;
      characterMap.set(charSetup.name, thisCharId);
      characterIdToName.set(thisCharId, charSetup.name);
      // First character is the default (backward compat)
      if (!characterId) characterId = thisCharId;
      log(`${colors.green}✓${colors.reset} Character created: ${charSetup.name} (${thisCharId})`);
    }

    for (const monster of scenario.setup.monsters) {
      // Merge position into statBlock if provided
      const monsterStatBlock = {
        ...monster.statBlock,
        ...(monster.position ? { position: monster.position } : {}),
      };
      const monPayload = { name: monster.name, statBlock: monsterStatBlock };
      logRequest("POST", `${baseUrl}/sessions/${sessionId}/monsters`, monPayload);
      const monRes = await httpPost(`${baseUrl}/sessions/${sessionId}/monsters`, monPayload);
      logResponse(monRes.status, monRes.body);
      if (monRes.status !== 200) {
        throw new Error(`Failed to create monster: ${JSON.stringify(monRes.body)}`);
      }
      monsterIds.push((monRes.body as any).id);
      log(`${colors.green}✓${colors.reset} Monster created: ${monster.name} (${(monRes.body as any).id})`);
    }
    
    // Create NPCs if defined
    const npcIds: string[] = [];
    if (scenario.setup.npcs) {
      for (const npc of scenario.setup.npcs) {
        // Merge position into statBlock if provided
        const npcStatBlock = {
          ...npc.statBlock,
          ...(npc.position ? { position: npc.position } : {}),
        };
        const npcPayload = {
          name: npc.name,
          statBlock: npcStatBlock,
          faction: npc.faction ?? "party",
          aiControlled: npc.aiControlled ?? true,
        };
        logRequest("POST", `${baseUrl}/sessions/${sessionId}/npcs`, npcPayload);
        const npcRes = await httpPost(`${baseUrl}/sessions/${sessionId}/npcs`, npcPayload);
        logResponse(npcRes.status, npcRes.body);
        if (npcRes.status !== 200) {
          throw new Error(`Failed to create NPC: ${JSON.stringify(npcRes.body)}`);
        }
        npcIds.push((npcRes.body as any).id);
        log(`${colors.green}✓${colors.reset} NPC created: ${npc.name} (${(npcRes.body as any).id})`);
      }
    }
    passedSteps++;

    // ========================================================================
    // Execute Actions
    // ========================================================================
    for (let i = 0; i < scenario.actions.length; i++) {
      const action = scenario.actions[i]!;
      const stepNum = i + 3; // +2 for setup, +1 for 1-indexed

      logStep(stepNum, action.type, (action as any).comment || (action as any).input?.text);

      switch (action.type) {
        case "initiate": {
          const actorId = resolveActorId(action.actor);
          const payload: Record<string, unknown> = { text: action.input.text, actorId };
          logRequest("POST", `${baseUrl}/sessions/${sessionId}/combat/initiate`, payload);
          const res = await httpPost(`${baseUrl}/sessions/${sessionId}/combat/initiate`, payload);
          logResponse(res.status, res.body);
          if (res.status !== 200) {
            throw new Error(`initiate failed: ${JSON.stringify(res.body)}`);
          }
          const body = res.body as any;
          
          // Show player-facing message
          logPlayerMessage(body.message, body.narration, body.rollType);
          
          log(`${colors.green}✓${colors.reset} rollType=${body.rollType}, requiresPlayerInput=${body.requiresPlayerInput}`);

          // Store encounterId if returned
          if (body.encounterId) {
            encounterId = body.encounterId;
          }

          // Place pre-placed ground items on the map if configured in setup
          if (encounterId && scenario.setup.groundItems && scenario.setup.groundItems.length > 0) {
            const giPayload = { items: scenario.setup.groundItems };
            logRequest("PATCH", `${baseUrl}/sessions/${sessionId}/combat/ground-items`, giPayload);
            const giRes = await httpPatch(`${baseUrl}/sessions/${sessionId}/combat/ground-items`, giPayload);
            logResponse(giRes.status, giRes.body);
            if (giRes.status !== 200) {
              throw new Error(`Failed to place ground items: ${JSON.stringify(giRes.body)}`);
            }
            log(`${colors.green}✓${colors.reset} Placed ${scenario.setup.groundItems.length} ground item(s) on the map`);
            // Clear so they're only placed once
            scenario.setup.groundItems = [];
          }

          // Enable flanking if configured in setup
          if (encounterId && scenario.setup.flankingEnabled) {
            const flankPayload = { enabled: true };
            logRequest("PATCH", `${baseUrl}/sessions/${sessionId}/combat/flanking`, flankPayload);
            const flankRes = await httpPatch(`${baseUrl}/sessions/${sessionId}/combat/flanking`, flankPayload);
            logResponse(flankRes.status, flankRes.body);
            if (flankRes.status !== 200) {
              throw new Error(`Failed to enable flanking: ${JSON.stringify(flankRes.body)}`);
            }
            log(`${colors.green}✓${colors.reset} Flanking rule enabled for encounter`);
            // Mark as consumed so we don't repeat
            scenario.setup.flankingEnabled = false;
          }

          // Validate expectations
          if (action.expect) {
            if (action.expect.rollType && body.rollType !== action.expect.rollType) {
              throw new Error(`Expected rollType=${action.expect.rollType}, got ${body.rollType}`);
            }
            if (action.expect.requiresPlayerInput !== undefined && body.requiresPlayerInput !== action.expect.requiresPlayerInput) {
              throw new Error(`Expected requiresPlayerInput=${action.expect.requiresPlayerInput}, got ${body.requiresPlayerInput}`);
            }
            if (action.expect.disadvantage !== undefined && (body.disadvantage ?? false) !== action.expect.disadvantage) {
              throw new Error(`Expected disadvantage=${action.expect.disadvantage}, got ${body.disadvantage ?? false}`);
            }
            if (action.expect.advantage !== undefined && (body.advantage ?? false) !== action.expect.advantage) {
              throw new Error(`Expected advantage=${action.expect.advantage}, got ${body.advantage ?? false}`);
            }
          }
          break;
        }

        case "rollResult": {
          const actorId = resolveActorId(action.actor);
          const payload = { text: action.input.text, actorId };
          logRequest("POST", `${baseUrl}/sessions/${sessionId}/combat/roll-result`, payload);
          const res = await httpPost(`${baseUrl}/sessions/${sessionId}/combat/roll-result`, payload);
          logResponse(res.status, res.body);

          if (action.expect?.error) {
            if (res.status === 200) {
              throw new Error("Expected error response but got success (status 200)");
            }
            const errorBody = res.body as any;
            const errorMessage = errorBody?.message ?? errorBody?.error ?? JSON.stringify(errorBody);
            if (action.expect.errorContains) {
              if (!errorMessage.toLowerCase().includes(action.expect.errorContains.toLowerCase())) {
                throw new Error(`Expected error containing "${action.expect.errorContains}" but got: ${errorMessage}`);
              }
            }
            log(`${colors.green}✓${colors.reset} Got expected rollResult error: ${errorMessage}`);
            break;
          }

          if (res.status !== 200) {
            throw new Error(`rollResult failed: ${JSON.stringify(res.body)}`);
          }
          const body = res.body as any;
          
          // Show player-facing message
          logPlayerMessage(body.message, body.narration, body.hit === true ? "Hit!" : body.hit === false ? "Miss!" : body.rollType);
          
          log(`${colors.green}✓${colors.reset} rollType=${body.rollType}, hit=${body.hit}, actionComplete=${body.actionComplete}`);

          // Store encounterId if returned
          if (body.encounterId) {
            encounterId = body.encounterId;
            log(`   ${colors.cyan}Captured encounterId: ${encounterId}${colors.reset}`);
          }

          // Place pre-placed ground items once we have an encounterId
          if (encounterId && scenario.setup.groundItems && scenario.setup.groundItems.length > 0) {
            const giPayload = { items: scenario.setup.groundItems };
            logRequest("PATCH", `${baseUrl}/sessions/${sessionId}/combat/ground-items`, giPayload);
            const giRes = await httpPatch(`${baseUrl}/sessions/${sessionId}/combat/ground-items`, giPayload);
            logResponse(giRes.status, giRes.body);
            if (giRes.status !== 200) {
              throw new Error(`Failed to place ground items: ${JSON.stringify(giRes.body)}`);
            }
            log(`${colors.green}✓${colors.reset} Placed ${scenario.setup.groundItems.length} ground item(s) on the map`);
            scenario.setup.groundItems = [];
          }

          // Enable flanking once we have an encounterId (fallback path)
          if (encounterId && scenario.setup.flankingEnabled) {
            const flankPayload = { enabled: true };
            logRequest("PATCH", `${baseUrl}/sessions/${sessionId}/combat/flanking`, flankPayload);
            const flankRes = await httpPatch(`${baseUrl}/sessions/${sessionId}/combat/flanking`, flankPayload);
            logResponse(flankRes.status, flankRes.body);
            if (flankRes.status !== 200) {
              throw new Error(`Failed to enable flanking: ${JSON.stringify(flankRes.body)}`);
            }
            log(`${colors.green}✓${colors.reset} Flanking rule enabled for encounter`);
            // Mark as consumed
            scenario.setup.flankingEnabled = false;
          }

          // ── Auto-complete Extra Attack chains ──
          // When the server chains to the next Extra Attack (actionComplete=false, requiresPlayerInput=true,
          // and message contains "Extra Attack") and the step did NOT explicitly opt into testing the chain
          // (expect.actionComplete !== false), automatically consume the remaining attacks by sending
          // natural-1 rolls (guaranteed miss). This keeps existing scenarios working transparently
          // after Extra Attack chaining was added to damage-resolver and roll-state-machine.
          //
          // Also handles the target-dead case: when the target dies from damage but attacks remain,
          // the server returns actionComplete=false, requiresPlayerInput=false with "remaining" in message.
          // We silently absorb this by patching actionComplete to true.
          if (body.actionComplete === false) {
            const explicitlyExpectsChaining = action.expect?.actionComplete === false;
            if (!explicitlyExpectsChaining) {
              if (body.requiresPlayerInput === true
                  && typeof body.message === "string" && body.message.includes("Extra Attack")) {
                // Active chain: consume remaining attacks with natural-1 misses
                let autoBody = body as any;
                let autoCount = 0;
                const maxAutoRolls = 20; // safety valve
                while (autoBody.actionComplete === false && autoBody.requiresPlayerInput === true && autoCount < maxAutoRolls) {
                  autoCount++;
                  const autoPayload = { text: "I rolled 1", actorId };
                  log(`   ${colors.yellow}⚡ Auto-completing Extra Attack #${autoCount}: natural 1 → miss${colors.reset}`);
                  logRequest("POST", `${baseUrl}/sessions/${sessionId}/combat/roll-result`, autoPayload);
                  const autoRes = await httpPost(`${baseUrl}/sessions/${sessionId}/combat/roll-result`, autoPayload);
                  logResponse(autoRes.status, autoRes.body);
                  if (autoRes.status !== 200) {
                    throw new Error(`Extra Attack auto-complete failed (roll #${autoCount}): ${JSON.stringify(autoRes.body)}`);
                  }
                  autoBody = autoRes.body as any;
                }
                body.actionComplete = autoBody.actionComplete;
                body.requiresPlayerInput = autoBody.requiresPlayerInput;
                log(`   ${colors.yellow}⚡ Extra Attack chain consumed (${autoCount} auto-miss roll${autoCount !== 1 ? "s" : ""})${colors.reset}`);
              } else if (body.requiresPlayerInput === false
                         && typeof body.message === "string" && body.message.includes("remaining")) {
                // Target died but attacks remain — absorb silently
                log(`   ${colors.yellow}⚡ Target defeated with Extra Attacks remaining — absorbing${colors.reset}`);
                body.actionComplete = true;
              }
            }
          }

          // Validate expectations
          if (action.expect) {
            if (action.expect.rollType && body.rollType !== action.expect.rollType) {
              throw new Error(`Expected rollType=${action.expect.rollType}, got ${body.rollType}`);
            }
            if (action.expect.hit !== undefined && body.hit !== action.expect.hit) {
              throw new Error(`Expected hit=${action.expect.hit}, got ${body.hit}`);
            }
            if (action.expect.isCritical !== undefined && body.isCritical !== action.expect.isCritical) {
              throw new Error(`Expected isCritical=${action.expect.isCritical}, got ${body.isCritical}`);
            }
            if (action.expect.combatStarted !== undefined && body.combatStarted !== action.expect.combatStarted) {
              throw new Error(`Expected combatStarted=${action.expect.combatStarted}, got ${body.combatStarted}`);
            }
            if (action.expect.actionComplete !== undefined && body.actionComplete !== action.expect.actionComplete) {
              throw new Error(`Expected actionComplete=${action.expect.actionComplete}, got ${body.actionComplete}`);
            }
            if (action.expect.requiresPlayerInput !== undefined && body.requiresPlayerInput !== action.expect.requiresPlayerInput) {
              throw new Error(`Expected requiresPlayerInput=${action.expect.requiresPlayerInput}, got ${body.requiresPlayerInput}`);
            }
            if (action.expect.combatEnded !== undefined && body.combatEnded !== action.expect.combatEnded) {
              throw new Error(`Expected combatEnded=${action.expect.combatEnded}, got ${body.combatEnded}`);
            }
            if (action.expect.victoryStatus && body.victoryStatus !== action.expect.victoryStatus) {
              throw new Error(`Expected victoryStatus=${action.expect.victoryStatus}, got ${body.victoryStatus}`);
            }
            if (action.expect.deathSaveResult && body.deathSaveResult !== action.expect.deathSaveResult) {
              throw new Error(`Expected deathSaveResult=${action.expect.deathSaveResult}, got ${body.deathSaveResult}`);
            }
            if (action.expect.deathSaves) {
              const ds = body.deathSaves as { successes: number; failures: number } | undefined;
              if (!ds) {
                throw new Error(`Expected deathSaves but response has none`);
              }
              if (ds.successes !== action.expect.deathSaves.successes) {
                throw new Error(`Expected deathSaves.successes=${action.expect.deathSaves.successes}, got ${ds.successes}`);
              }
              if (ds.failures !== action.expect.deathSaves.failures) {
                throw new Error(`Expected deathSaves.failures=${action.expect.deathSaves.failures}, got ${ds.failures}`);
              }
            }
            // Validate Uncanny Metabolism auto-trigger
            if (action.expect.uncannyMetabolism) {
              const um = body.uncannyMetabolism as { kiRestored?: number; healAmount?: number } | undefined;
              if (!um) {
                throw new Error(`Expected uncannyMetabolism data but response has none`);
              }
              const expectUM = action.expect.uncannyMetabolism;
              if (expectUM.kiRestored) {
                if (expectUM.kiRestored.min !== undefined && (um.kiRestored ?? 0) < expectUM.kiRestored.min) {
                  throw new Error(`Expected uncannyMetabolism.kiRestored >= ${expectUM.kiRestored.min}, got ${um.kiRestored}`);
                }
                if (expectUM.kiRestored.max !== undefined && (um.kiRestored ?? 0) > expectUM.kiRestored.max) {
                  throw new Error(`Expected uncannyMetabolism.kiRestored <= ${expectUM.kiRestored.max}, got ${um.kiRestored}`);
                }
              }
              if (expectUM.healAmount) {
                if (expectUM.healAmount.min !== undefined && (um.healAmount ?? 0) < expectUM.healAmount.min) {
                  throw new Error(`Expected uncannyMetabolism.healAmount >= ${expectUM.healAmount.min}, got ${um.healAmount}`);
                }
                if (expectUM.healAmount.max !== undefined && (um.healAmount ?? 0) > expectUM.healAmount.max) {
                  throw new Error(`Expected uncannyMetabolism.healAmount <= ${expectUM.healAmount.max}, got ${um.healAmount}`);
                }
              }
              log(`   ${colors.green}✓${colors.reset} Uncanny Metabolism: ki restored=${um.kiRestored}, heal=${um.healAmount}`);
            }
            // Validate Open Hand Technique result
            if (action.expect.openHandTechnique) {
              const oht = body.openHandTechnique as { saved?: boolean; conditionApplied?: string; summary?: string } | undefined;
              if (!oht) {
                throw new Error(`Expected openHandTechnique data but response has none`);
              }
              const expectOHT = action.expect.openHandTechnique;
              if (expectOHT.saved !== undefined && oht.saved !== expectOHT.saved) {
                throw new Error(`Expected openHandTechnique.saved=${expectOHT.saved}, got ${oht.saved}`);
              }
              if (expectOHT.conditionApplied && oht.conditionApplied !== expectOHT.conditionApplied) {
                throw new Error(`Expected openHandTechnique.conditionApplied="${expectOHT.conditionApplied}", got "${oht.conditionApplied}"`);
              }
              log(`   ${colors.green}✓${colors.reset} Open Hand Technique: saved=${oht.saved}, condition=${oht.conditionApplied ?? "none"}`);
            }
            // Validate Stunning Strike result
            if (action.expect.stunningStrike) {
              const ss = body.stunningStrike as { saved?: boolean; conditionApplied?: string; summary?: string } | undefined;
              if (!ss) {
                throw new Error(`Expected stunningStrike data but response has none`);
              }
              const expectSS = action.expect.stunningStrike;
              if (expectSS.saved !== undefined && ss.saved !== expectSS.saved) {
                throw new Error(`Expected stunningStrike.saved=${expectSS.saved}, got ${ss.saved}`);
              }
              if (expectSS.conditionApplied && ss.conditionApplied !== expectSS.conditionApplied) {
                throw new Error(`Expected stunningStrike.conditionApplied="${expectSS.conditionApplied}", got "${ss.conditionApplied}"`);
              }
              log(`   ${colors.green}✓${colors.reset} Stunning Strike: saved=${ss.saved}, condition=${ss.conditionApplied ?? "none"}`);
            }
            // Validate eligible on-hit enhancements (2024 post-hit flow)
            if (action.expect.eligibleEnhancements) {
              const eligibles = body.eligibleEnhancements as Array<{ keyword: string; displayName?: string; choiceOptions?: string[] }> | undefined;
              if (!eligibles || !Array.isArray(eligibles)) {
                throw new Error(`Expected eligibleEnhancements array but response has none`);
              }
              for (const expected of action.expect.eligibleEnhancements) {
                const match = eligibles.find((e) => e.keyword === expected.keyword);
                if (!match) {
                  throw new Error(`Expected eligibleEnhancement with keyword="${expected.keyword}" not found in response: ${JSON.stringify(eligibles.map(e => e.keyword))}`);
                }
                if (expected.displayName && match.displayName !== expected.displayName) {
                  throw new Error(`Expected eligibleEnhancement "${expected.keyword}" displayName="${expected.displayName}", got "${match.displayName}"`);
                }
                if (expected.choiceOptions) {
                  if (!match.choiceOptions || JSON.stringify(match.choiceOptions.sort()) !== JSON.stringify(expected.choiceOptions.sort())) {
                    throw new Error(`Expected eligibleEnhancement "${expected.keyword}" choiceOptions=${JSON.stringify(expected.choiceOptions)}, got ${JSON.stringify(match.choiceOptions)}`);
                  }
                }
              }
              log(`   ${colors.green}✓${colors.reset} Eligible enhancements: ${eligibles.map(e => e.keyword).join(", ")}`);
            }
            // Validate Alert feat initiative swap offer
            if (action.expect.initiativeSwapOffer !== undefined) {
              const hasOffer = !!(body as any).initiativeSwapOffer;
              if (hasOffer !== action.expect.initiativeSwapOffer) {
                throw new Error(`Expected initiativeSwapOffer=${action.expect.initiativeSwapOffer}, got ${hasOffer}`);
              }
              if (hasOffer) {
                log(`   ${colors.green}✓${colors.reset} Initiative swap offer: eligible targets = ${((body as any).initiativeSwapOffer.eligibleTargets ?? []).map((t: any) => t.actorName).join(", ")}`);
              }
            }
            if (action.expect.currentTurnActor) {
              const actual = (body as any).currentTurn?.actorName;
              if (actual !== action.expect.currentTurnActor) {
                throw new Error(`Expected currentTurnActor=${action.expect.currentTurnActor}, got ${actual}`);
              }
              log(`   ${colors.green}✓${colors.reset} currentTurnActor=${actual}`);
            }
          }
          break;
        }

        case "action": {
          const actorId = resolveActorId(action.actor);
          const payload = { text: action.input.text, actorId, encounterId };
          logRequest("POST", `${baseUrl}/sessions/${sessionId}/combat/action`, payload);
          const res = await httpPost(`${baseUrl}/sessions/${sessionId}/combat/action`, payload);
          logResponse(res.status, res.body);
          
          // Handle expected error responses
          if (action.expect?.error) {
            if (res.status === 200) {
              throw new Error(`Expected error response but got success (status 200)`);
            }
            const errorBody = res.body as any;
            const errorMessage = errorBody?.message ?? errorBody?.error ?? JSON.stringify(errorBody);
            if (action.expect.errorContains) {
              if (!errorMessage.toLowerCase().includes(action.expect.errorContains.toLowerCase())) {
                throw new Error(`Expected error containing "${action.expect.errorContains}" but got: ${errorMessage}`);
              }
            }
            log(`${colors.green}✓${colors.reset} Got expected error: ${errorMessage}`);
            break;
          }
          
          if (res.status !== 200) {
            throw new Error(`action failed: ${JSON.stringify(res.body)}`);
          }
          const body = res.body as any;
          
          // Show player-facing message
          logPlayerMessage(body.message, body.narration, body.type);
          
          log(`${colors.green}✓${colors.reset} type=${body.type}, rollType=${body.rollType}, actionComplete=${body.actionComplete}`);
          
          // Capture pending action state for move reactions
          if (body.type === "REACTION_CHECK" && body.pendingActionId) {
            pendingActionId = body.pendingActionId;
            opportunityAttacks = (body.opportunityAttacks || []).filter((oa: any) => oa.canAttack === true);
            log(`   ${colors.cyan}Move triggered ${opportunityAttacks.length} opportunity attack(s), pendingActionId: ${pendingActionId}${colors.reset}`);
          }

          // Validate expectations
          if (action.expect) {
            if (action.expect.rollType && body.rollType !== action.expect.rollType) {
              throw new Error(`Expected rollType=${action.expect.rollType}, got ${body.rollType}`);
            }
            if (action.expect.requiresPlayerInput !== undefined && body.requiresPlayerInput !== action.expect.requiresPlayerInput) {
              throw new Error(`Expected requiresPlayerInput=${action.expect.requiresPlayerInput}, got ${body.requiresPlayerInput}`);
            }
            if (action.expect.actionComplete !== undefined && body.actionComplete !== action.expect.actionComplete) {
              throw new Error(`Expected actionComplete=${action.expect.actionComplete}, got ${body.actionComplete}`);
            }
            if (action.expect.type && body.type !== action.expect.type) {
              throw new Error(`Expected type=${action.expect.type}, got ${body.type}`);
            }
            if (action.expect.advantage !== undefined && body.advantage !== action.expect.advantage) {
              throw new Error(`Expected advantage=${action.expect.advantage}, got ${body.advantage}`);
            }
            if (action.expect.disadvantage !== undefined && body.disadvantage !== action.expect.disadvantage) {
              throw new Error(`Expected disadvantage=${action.expect.disadvantage}, got ${body.disadvantage}`);
            }
          }
          break;
        }

        case "npcAction": {
          const npcAction = action as NpcActionAction;
          const npcActorId = npcIds[npcAction.input.npcIndex];
          if (!npcActorId) {
            throw new Error(`npcAction: no NPC at index ${npcAction.input.npcIndex} (have ${npcIds.length} NPCs)`);
          }
          const npcPayload = { text: npcAction.input.text, actorId: npcActorId, encounterId };
          logRequest("POST", `${baseUrl}/sessions/${sessionId}/combat/action`, npcPayload);
          const npcRes = await httpPost(`${baseUrl}/sessions/${sessionId}/combat/action`, npcPayload);
          logResponse(npcRes.status, npcRes.body);

          if (npcAction.expect?.error) {
            if (npcRes.status === 200) {
              throw new Error(`Expected error response but got success (status 200)`);
            }
            const errorBody = npcRes.body as any;
            const errorMessage = errorBody?.message ?? errorBody?.error ?? JSON.stringify(errorBody);
            if (npcAction.expect.errorContains) {
              if (!errorMessage.toLowerCase().includes(npcAction.expect.errorContains.toLowerCase())) {
                throw new Error(`Expected error containing "${npcAction.expect.errorContains}" but got: ${errorMessage}`);
              }
            }
            log(`${colors.green}✓${colors.reset} Got expected NPC error: ${errorMessage}`);
            break;
          }

          if (npcRes.status !== 200) {
            throw new Error(`npcAction failed: ${JSON.stringify(npcRes.body)}`);
          }
          const npcBody = npcRes.body as any;
          logPlayerMessage(npcBody.message, npcBody.narration, npcBody.type);
          log(`${colors.green}✓${colors.reset} NPC action: type=${npcBody.type}, rollType=${npcBody.rollType}, actionComplete=${npcBody.actionComplete}`);

          if (npcAction.expect) {
            if (npcAction.expect.rollType && npcBody.rollType !== npcAction.expect.rollType) {
              throw new Error(`Expected rollType=${npcAction.expect.rollType}, got ${npcBody.rollType}`);
            }
            if (npcAction.expect.requiresPlayerInput !== undefined && npcBody.requiresPlayerInput !== npcAction.expect.requiresPlayerInput) {
              throw new Error(`Expected requiresPlayerInput=${npcAction.expect.requiresPlayerInput}, got ${npcBody.requiresPlayerInput}`);
            }
            if (npcAction.expect.actionComplete !== undefined && npcBody.actionComplete !== npcAction.expect.actionComplete) {
              throw new Error(`Expected actionComplete=${npcAction.expect.actionComplete}, got ${npcBody.actionComplete}`);
            }
            if (npcAction.expect.type && npcBody.type !== npcAction.expect.type) {
              throw new Error(`Expected type=${npcAction.expect.type}, got ${npcBody.type}`);
            }
          }
          break;
        }

        case "assertState": {
          if (!encounterId) {
            throw new Error("Cannot assertState: no active encounter");
          }
          const url = `${baseUrl}/sessions/${sessionId}/combat?encounterId=${encounterId}`;
          logRequest("GET", url);
          const res = await httpGet(url);
          logResponse(res.status, res.body);
          if (res.status !== 200) {
            throw new Error(`Failed to get combat state: ${JSON.stringify(res.body)}`);
          }
          const body = res.body as any;
          log(`${colors.green}✓${colors.reset} Combat status=${body.encounter?.status}, combatants=${body.combatants?.length}`);

          // Validate expectations
          if (action.expect.combatStatus && body.encounter?.status !== action.expect.combatStatus) {
            throw new Error(`Expected combatStatus=${action.expect.combatStatus}, got ${body.encounter?.status}`);
          }
          if (action.expect.monstersAlive !== undefined) {
            const aliveMonsters = body.combatants?.filter(
              (c: any) => c.combatantType === "Monster" && c.hpCurrent > 0,
            ).length ?? 0;
            if (aliveMonsters !== action.expect.monstersAlive) {
              throw new Error(`Expected monstersAlive=${action.expect.monstersAlive}, got ${aliveMonsters}`);
            }
          }
          if (action.expect.characterHp) {
            const assertActorId = resolveActorId(action.actor);
            const char = body.combatants?.find((c: any) => c.characterId === assertActorId);
            if (!char) {
              throw new Error(`Character "${action.actor ?? "default"}" not found in combatants (id: ${assertActorId})`);
            }
            if (action.expect.characterHp.min !== undefined && char.hpCurrent < action.expect.characterHp.min) {
              throw new Error(`Expected characterHp >= ${action.expect.characterHp.min}, got ${char.hpCurrent}`);
            }
            if (action.expect.characterHp.max !== undefined && char.hpCurrent > action.expect.characterHp.max) {
              throw new Error(`Expected characterHp <= ${action.expect.characterHp.max}, got ${char.hpCurrent}`);
            }
          }
          // Assert HP of a specific monster by name
          if (action.expect.monsterHp) {
            const { name, min, max, exact } = action.expect.monsterHp;
            const monsterIndex = scenario.setup.monsters.findIndex(m => m.name.toLowerCase() === name.toLowerCase());
            if (monsterIndex === -1) throw new Error(`Monster "${name}" not found in scenario setup`);
            const matchMonsterId = monsterIds[monsterIndex];
            const monster = body.combatants?.find((c: any) => c.monsterId === matchMonsterId);
            if (!monster) throw new Error(`Monster "${name}" not found in combatants (id: ${matchMonsterId})`);
            if (exact !== undefined && monster.hpCurrent !== exact) {
              throw new Error(`Expected monster "${name}" HP = ${exact}, got ${monster.hpCurrent}`);
            }
            if (min !== undefined && monster.hpCurrent < min) {
              throw new Error(`Expected monster "${name}" HP >= ${min}, got ${monster.hpCurrent}`);
            }
            if (max !== undefined && monster.hpCurrent > max) {
              throw new Error(`Expected monster "${name}" HP <= ${max}, got ${monster.hpCurrent}`);
            }
            log(`   ${colors.green}✓${colors.reset} Monster "${name}" HP = ${monster.hpCurrent}`);
          }
          // Assert monster position by name
          if (action.expect.monsterPosition) {
            const { name, x: expectX, y: expectY } = action.expect.monsterPosition;
            const monsterIndex = scenario.setup.monsters.findIndex(m => m.name.toLowerCase() === name.toLowerCase());
            if (monsterIndex === -1) throw new Error(`Monster "${name}" not found in scenario setup`);
            const matchMonsterId = monsterIds[monsterIndex];
            const monster = body.combatants?.find((c: any) => c.monsterId === matchMonsterId);
            if (!monster) throw new Error(`Monster "${name}" not found in combatants (id: ${matchMonsterId})`);

            const resources = (monster.resources ?? {}) as Record<string, unknown>;
            const pos = resources.position as { x?: number; y?: number } | undefined;
            if (!pos || typeof pos.x !== "number" || typeof pos.y !== "number") {
              throw new Error(`Monster "${name}" has no position in resources`);
            }
            if (expectX !== undefined && pos.x !== expectX) {
              throw new Error(`Expected monster "${name}" position.x=${expectX}, got ${pos.x}`);
            }
            if (expectY !== undefined && pos.y !== expectY) {
              throw new Error(`Expected monster "${name}" position.y=${expectY}, got ${pos.y}`);
            }
            log(`   ${colors.green}✓${colors.reset} Monster "${name}" position: (${pos.x}, ${pos.y})`);
          }
          // Assert conditions on a monster (match by name → monsterId from setup)
          if (action.expect.monsterConditions) {
            const { name, hasConditions, doesNotHaveConditions } = action.expect.monsterConditions;
            const monsterIndex = scenario.setup.monsters.findIndex(m => m.name.toLowerCase() === name.toLowerCase());
            if (monsterIndex === -1) throw new Error(`Monster "${name}" not found in scenario setup`);
            const matchMonsterId = monsterIds[monsterIndex];
            const monster = body.combatants?.find((c: any) => c.monsterId === matchMonsterId);
            if (!monster) throw new Error(`Monster "${name}" not found in combatants (id: ${matchMonsterId})`);
            const monsterConds: string[] = Array.isArray(monster.conditions) ? monster.conditions.map((c: any) => (typeof c === 'string' ? c : c.condition ?? '').toLowerCase()) : [];
            if (hasConditions) {
              for (const cond of hasConditions) {
                if (!monsterConds.includes(cond.toLowerCase())) {
                  throw new Error(`Expected monster "${name}" to have condition "${cond}", found: [${monsterConds.join(", ")}]`);
                }
              }
            }
            if (doesNotHaveConditions) {
              for (const cond of doesNotHaveConditions) {
                if (monsterConds.includes(cond.toLowerCase())) {
                  throw new Error(`Expected monster "${name}" to NOT have condition "${cond}", found: [${monsterConds.join(", ")}]`);
                }
              }
            }
            log(`   ${colors.green}✓${colors.reset} Monster "${name}" conditions: [${monsterConds.join(", ")}]`);
          }
          // Assert ActiveEffect sources on a monster
          if (action.expect.monsterActiveEffects) {
            const { name, hasSources, doesNotHaveSources } = action.expect.monsterActiveEffects;
            const monsterIndex = scenario.setup.monsters.findIndex(m => m.name.toLowerCase() === name.toLowerCase());
            if (monsterIndex === -1) throw new Error(`Monster "${name}" not found in scenario setup`);
            const matchMonsterId = monsterIds[monsterIndex];
            const monster = body.combatants?.find((c: any) => c.monsterId === matchMonsterId);
            if (!monster) throw new Error(`Monster "${name}" not found in combatants (id: ${matchMonsterId})`);

            const resources = (monster.resources ?? {}) as Record<string, unknown>;
            const activeEffects = Array.isArray(resources.activeEffects)
              ? resources.activeEffects as Array<Record<string, unknown>>
              : [];
            const sources = activeEffects
              .map((e) => (typeof e.source === "string" ? e.source : ""))
              .filter((s) => s.length > 0);

            if (hasSources) {
              for (const expectedSource of hasSources) {
                if (!sources.some((s) => s.toLowerCase().includes(expectedSource.toLowerCase()))) {
                  throw new Error(`Expected monster "${name}" to have ActiveEffect source containing "${expectedSource}", found: [${sources.join(", ")}]`);
                }
              }
            }
            if (doesNotHaveSources) {
              for (const source of doesNotHaveSources) {
                if (sources.some((s) => s.toLowerCase().includes(source.toLowerCase()))) {
                  throw new Error(`Expected monster "${name}" to NOT have ActiveEffect source containing "${source}", found: [${sources.join(", ")}]`);
                }
              }
            }
            log(`   ${colors.green}✓${colors.reset} Monster "${name}" active effect sources: [${sources.join(", ")}]`);
          }
          // Assert conditions on the player character
          if (action.expect.characterConditions) {
            const { hasConditions, doesNotHaveConditions } = action.expect.characterConditions;
            const assertActorId = resolveActorId(action.actor);
            const char = body.combatants?.find((c: any) => c.characterId === assertActorId);
            if (!char) {
              throw new Error(`Character "${action.actor ?? "default"}" not found in combatants (id: ${assertActorId})`);
            }
            const charConds: string[] = Array.isArray(char.conditions) ? char.conditions.map((c: any) => (typeof c === 'string' ? c : c.condition ?? '').toLowerCase()) : [];
            if (hasConditions) {
              for (const cond of hasConditions) {
                if (!charConds.includes(cond.toLowerCase())) {
                  throw new Error(`Expected character to have condition "${cond}", found: [${charConds.join(", ")}]`);
                }
              }
            }
            if (doesNotHaveConditions) {
              for (const cond of doesNotHaveConditions) {
                if (charConds.includes(cond.toLowerCase())) {
                  throw new Error(`Expected character to NOT have condition "${cond}", found: [${charConds.join(", ")}]`);
                }
              }
            }
          }
          // Assert a resource pool value on the player character
          if (action.expect.characterResource) {
            const { poolName, current: expectCurrent, max: expectMax } = action.expect.characterResource;
            const assertActorId = resolveActorId(action.actor);
            const char = body.combatants?.find((c: any) => c.characterId === assertActorId);
            if (!char) {
              throw new Error(`Character "${action.actor ?? "default"}" not found in combatants (id: ${assertActorId})`);
            }
            const resources = char.resources as Record<string, unknown> | undefined;
            const pools: Array<{ name: string; current: number; max: number }> = Array.isArray((resources as any)?.resourcePools)
              ? (resources as any).resourcePools
              : [];
            const pool = pools.find(p => p.name === poolName);
            if (!pool) {
              throw new Error(`Resource pool "${poolName}" not found on character. Available: [${pools.map(p => p.name).join(", ")}]`);
            }
            if (expectCurrent !== undefined && pool.current !== expectCurrent) {
              throw new Error(`Expected resource "${poolName}" current=${expectCurrent}, got ${pool.current}`);
            }
            if (expectMax !== undefined && pool.max !== expectMax) {
              throw new Error(`Expected resource "${poolName}" max=${expectMax}, got ${pool.max}`);
            }
            log(`   ${colors.green}✓${colors.reset} Resource "${poolName}": current=${pool.current}, max=${pool.max}`);
          }
          // Assert concentration on the player character
          if (action.expect.characterConcentration !== undefined) {
            const expectedSpell = action.expect.characterConcentration;
            const assertActorId = resolveActorId(action.actor);
            const char = body.combatants?.find((c: any) => c.characterId === assertActorId);
            if (!char) {
              throw new Error(`Character "${action.actor ?? "default"}" not found in combatants (id: ${assertActorId})`);
            }
            const resources = char.resources as Record<string, unknown> | undefined;
            const actualSpell = typeof resources?.concentrationSpellName === "string" && resources.concentrationSpellName.length > 0
              ? resources.concentrationSpellName
              : null;
            if (expectedSpell === null) {
              if (actualSpell !== null) {
                throw new Error(`Expected character NOT concentrating, but found concentration on "${actualSpell}"`);
              }
              log(`   ${colors.green}✓${colors.reset} Character not concentrating (as expected)`);
            } else {
              if (actualSpell === null) {
                throw new Error(`Expected character concentrating on "${expectedSpell}", but not concentrating`);
              }
              if (actualSpell.toLowerCase() !== expectedSpell.toLowerCase()) {
                throw new Error(`Expected concentration on "${expectedSpell}", got "${actualSpell}"`);
              }
              log(`   ${colors.green}✓${colors.reset} Character concentrating on "${actualSpell}"`);
            }
          }
          // Assert concentration on a monster
          if (action.expect.monsterConcentration) {
            const { name: monsterName, spell: expectedSpell } = action.expect.monsterConcentration;
            const monsterIndex = scenario.setup.monsters.findIndex(m => m.name.toLowerCase() === monsterName.toLowerCase());
            if (monsterIndex === -1) throw new Error(`Monster "${monsterName}" not found in scenario setup`);
            const matchMonsterId = monsterIds[monsterIndex];
            const monsterCombatant = body.combatants?.find((c: any) => c.monsterId === matchMonsterId);
            if (!monsterCombatant) {
              throw new Error(`Monster "${monsterName}" not found in combatants (id: ${matchMonsterId})`);
            }
            const resources = monsterCombatant.resources as Record<string, unknown> | undefined;
            const actualSpell = typeof resources?.concentrationSpellName === "string" && resources.concentrationSpellName.length > 0
              ? resources.concentrationSpellName
              : null;
            if (expectedSpell === null) {
              if (actualSpell !== null) {
                throw new Error(`Expected monster "${monsterName}" NOT concentrating, but found concentration on "${actualSpell}"`);
              }
              log(`   ${colors.green}✓${colors.reset} Monster "${monsterName}" not concentrating (as expected)`);
            } else {
              if (actualSpell === null) {
                throw new Error(`Expected monster "${monsterName}" concentrating on "${expectedSpell}", but not concentrating`);
              }
              if (actualSpell.toLowerCase() !== expectedSpell.toLowerCase()) {
                throw new Error(`Expected monster "${monsterName}" concentration on "${expectedSpell}", got "${actualSpell}"`);
              }
              log(`   ${colors.green}✓${colors.reset} Monster "${monsterName}" concentrating on "${actualSpell}"`);
            }
          }
          // Assert position of the player character
          if (action.expect.characterPosition) {
            const { x: expectX, y: expectY } = action.expect.characterPosition;
            const assertActorId = resolveActorId(action.actor);
            const char = body.combatants?.find((c: any) => c.characterId === assertActorId);
            if (!char) {
              throw new Error(`Character "${action.actor ?? "default"}" not found in combatants (id: ${assertActorId})`);
            }
            const resources = char.resources as Record<string, unknown> | undefined;
            const pos = (resources as any)?.position as { x: number; y: number } | undefined;
            if (!pos) {
              throw new Error(`Character has no position in resources`);
            }
            if (expectX !== undefined && pos.x !== expectX) {
              throw new Error(`Expected character position.x=${expectX}, got ${pos.x}`);
            }
            if (expectY !== undefined && pos.y !== expectY) {
              throw new Error(`Expected character position.y=${expectY}, got ${pos.y}`);
            }
            log(`   ${colors.green}✓${colors.reset} Character position: (${pos.x}, ${pos.y})`);
          }
          // Assert ground items on the map
          if (action.expect.groundItemCount !== undefined || action.expect.groundItemExists || action.expect.groundItemNotExists || action.expect.groundItemsHas) {
            // Fetch tactical view which includes groundItems
            const tvUrl = `${baseUrl}/sessions/${sessionId}/combat/${encounterId}/tactical`;
            logRequest("GET", tvUrl);
            const tvRes = await httpGet(tvUrl);
            if (tvRes.status !== 200) {
              throw new Error(`Failed to get tactical view for ground item assertion: ${JSON.stringify(tvRes.body)}`);
            }
            const tvBody = tvRes.body as any;
            const groundItems: Array<{ id: string; name: string; position: { x: number; y: number } }> = tvBody.groundItems ?? [];

            if (action.expect.groundItemCount !== undefined) {
              if (groundItems.length !== action.expect.groundItemCount) {
                const names = groundItems.map((i: any) => i.name).join(", ");
                throw new Error(`Expected groundItemCount=${action.expect.groundItemCount}, got ${groundItems.length} [${names}]`);
              }
              log(`   ${colors.green}✓${colors.reset} Ground items count: ${groundItems.length}`);
            }
            if (action.expect.groundItemExists) {
              const { name, nearPosition } = action.expect.groundItemExists;
              const found = groundItems.find((i: any) => i.name.toLowerCase() === name.toLowerCase());
              if (!found) {
                const names = groundItems.map((i: any) => i.name).join(", ");
                throw new Error(`Expected ground item "${name}" to exist, found: [${names}]`);
              }
              if (nearPosition) {
                const dx = found.position.x - nearPosition.x;
                const dy = found.position.y - nearPosition.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > 5) {
                  throw new Error(`Expected ground item "${name}" near (${nearPosition.x},${nearPosition.y}), but it's at (${found.position.x},${found.position.y}) — ${dist.toFixed(1)}ft away`);
                }
              }
              log(`   ${colors.green}✓${colors.reset} Ground item "${name}" exists at (${found.position.x}, ${found.position.y})`);
            }
            if (action.expect.groundItemNotExists) {
              const { name } = action.expect.groundItemNotExists;
              const found = groundItems.find((i: any) => i.name.toLowerCase() === name.toLowerCase());
              if (found) {
                throw new Error(`Expected ground item "${name}" to NOT exist, but found at (${found.position.x}, ${found.position.y})`);
              }
              log(`   ${colors.green}✓${colors.reset} Ground item "${name}" does not exist (as expected)`);
            }
            if (action.expect.groundItemsHas) {
              for (const name of action.expect.groundItemsHas) {
                const found = groundItems.find((i: any) => i.name.toLowerCase() === name.toLowerCase());
                if (!found) {
                  const names = groundItems.map((i: any) => i.name).join(", ");
                  throw new Error(`Expected ground item "${name}" to exist, found: [${names}]`);
                }
              }
              log(`   ${colors.green}✓${colors.reset} Ground items has: [${action.expect.groundItemsHas.join(", ")}]`);
            }
          }
          // Assert drawn weapons on the player character
          if (action.expect.characterDrawnWeapons) {
            const { has: expectHas, doesNotHave: expectNotHave } = action.expect.characterDrawnWeapons;
            const assertActorId = resolveActorId(action.actor);
            const char = body.combatants?.find((c: any) => c.characterId === assertActorId);
            if (!char) {
              throw new Error(`Character "${action.actor ?? "default"}" not found in combatants (id: ${assertActorId})`);
            }
            const resources = char.resources as Record<string, unknown> | undefined;
            const drawnWeapons: string[] = Array.isArray(resources?.drawnWeapons) ? (resources!.drawnWeapons as string[]) : [];
            const drawnLower = drawnWeapons.map(w => w.toLowerCase());
            if (expectHas) {
              for (const wp of expectHas) {
                if (!drawnLower.includes(wp.toLowerCase())) {
                  throw new Error(`Expected drawn weapon "${wp}", found: [${drawnWeapons.join(", ")}]`);
                }
              }
            }
            if (expectNotHave) {
              for (const wp of expectNotHave) {
                if (drawnLower.includes(wp.toLowerCase())) {
                  throw new Error(`Expected "${wp}" NOT drawn, but found in: [${drawnWeapons.join(", ")}]`);
                }
              }
            }
            log(`   ${colors.green}✓${colors.reset} Drawn weapons: [${drawnWeapons.join(", ")}]`);
          }
          // Assert inventory items on the player character
          if (action.expect.characterInventory) {
            const { has: expectItems, doesNotHave: expectMissing } = action.expect.characterInventory;
            const assertActorId = resolveActorId(action.actor);
            const char = body.combatants?.find((c: any) => c.characterId === assertActorId);
            if (!char) {
              throw new Error(`Character "${action.actor ?? "default"}" not found in combatants (id: ${assertActorId})`);
            }
            const resources = char.resources as Record<string, unknown> | undefined;
            const inventory: Array<{ name: string; quantity: number }> = Array.isArray(resources?.inventory) ? (resources!.inventory as any[]) : [];
            if (expectItems) {
              for (const expectedItem of expectItems) {
                const found = inventory.find(i => i.name.toLowerCase() === expectedItem.name.toLowerCase());
                if (!found) {
                  const names = inventory.map(i => `${i.name}(x${i.quantity})`).join(", ");
                  throw new Error(`Expected inventory item "${expectedItem.name}", found: [${names}]`);
                }
                if (expectedItem.quantity !== undefined && found.quantity !== expectedItem.quantity) {
                  throw new Error(`Expected "${expectedItem.name}" quantity=${expectedItem.quantity}, got ${found.quantity}`);
                }
              }
            }
            if (expectMissing) {
              for (const missingName of expectMissing) {
                const found = inventory.find(i => i.name.toLowerCase() === missingName.toLowerCase());
                if (found) {
                  throw new Error(`Expected "${missingName}" NOT in inventory, but found with quantity=${found.quantity}`);
                }
              }
            }
            log(`   ${colors.green}✓${colors.reset} Inventory: [${inventory.map(i => `${i.name}(x${i.quantity})`).join(", ")}]`);
          }
          // Assert temporary HP on the player character
          if (action.expect.characterTempHp !== undefined) {
            const { min, max, exact } = action.expect.characterTempHp;
            const assertActorId = resolveActorId(action.actor);
            const char = body.combatants?.find((c: any) => c.characterId === assertActorId);
            if (!char) {
              throw new Error(`Character "${action.actor ?? "default"}" not found in combatants (id: ${assertActorId})`);
            }
            const charResources = char.resources as Record<string, unknown> | undefined;
            const actualTempHp = typeof charResources?.tempHp === "number" ? charResources.tempHp : 0;
            if (exact !== undefined && actualTempHp !== exact) {
              throw new Error(`Expected characterTempHp = ${exact}, got ${actualTempHp}`);
            }
            if (min !== undefined && actualTempHp < min) {
              throw new Error(`Expected characterTempHp >= ${min}, got ${actualTempHp}`);
            }
            if (max !== undefined && actualTempHp > max) {
              throw new Error(`Expected characterTempHp <= ${max}, got ${actualTempHp}`);
            }
            log(`   ${colors.green}✓${colors.reset} Character tempHp = ${actualTempHp}`);
          }
          // Assert temporary HP on a specific monster
          if (action.expect.monsterTempHp !== undefined) {
            const { name: monsterName, min, max, exact } = action.expect.monsterTempHp;
            const monsterIndex = scenario.setup.monsters.findIndex(m => m.name.toLowerCase() === monsterName.toLowerCase());
            if (monsterIndex === -1) throw new Error(`Monster "${monsterName}" not found in scenario setup`);
            const matchMonsterId = monsterIds[monsterIndex];
            const monsterCombatant = body.combatants?.find((c: any) => c.monsterId === matchMonsterId);
            if (!monsterCombatant) throw new Error(`Monster "${monsterName}" not found in combatants (id: ${matchMonsterId})`);
            const monsterResources = monsterCombatant.resources as Record<string, unknown> | undefined;
            const actualTempHp = typeof monsterResources?.tempHp === "number" ? monsterResources.tempHp : 0;
            if (exact !== undefined && actualTempHp !== exact) {
              throw new Error(`Expected monster "${monsterName}" tempHp = ${exact}, got ${actualTempHp}`);
            }
            if (min !== undefined && actualTempHp < min) {
              throw new Error(`Expected monster "${monsterName}" tempHp >= ${min}, got ${actualTempHp}`);
            }
            if (max !== undefined && actualTempHp > max) {
              throw new Error(`Expected monster "${monsterName}" tempHp <= ${max}, got ${actualTempHp}`);
            }
            log(`   ${colors.green}✓${colors.reset} Monster "${monsterName}" tempHp = ${actualTempHp}`);
          }
          break;
        }

        case "moveComplete": {
          if (!pendingActionId) {
            throw new Error("Cannot moveComplete: no pendingActionId (move did not trigger REACTION_CHECK)");
          }
          
          const moveAction = action as MoveCompleteAction;
          const rolls = moveAction.rolls ?? [];
          let rollIndex = 0;
          let lastBody: any = null;
          
          // Loop to handle multi-roll sequences (attack roll, then damage roll if hit)
          while (true) {
            const payload: { pendingActionId: string; roll?: number; rollType?: string } = { pendingActionId };
            
            // If we have a roll to submit
            if (lastBody?.requiresPlayerInput && lastBody?.type === "REQUEST_ROLL" && rollIndex < rolls.length) {
              payload.roll = rolls[rollIndex];
              payload.rollType = lastBody.rollType;
              rollIndex++;
              log(`   ${colors.cyan}Submitting roll: ${payload.roll} for ${payload.rollType}${colors.reset}`);
            }
            
            logRequest("POST", `${baseUrl}/sessions/${sessionId}/combat/move/complete`, payload);
            const res = await httpPost(`${baseUrl}/sessions/${sessionId}/combat/move/complete`, payload);
            logResponse(res.status, res.body);
            
            if (res.status !== 200) {
              throw new Error(`moveComplete failed: ${JSON.stringify(res.body)}`);
            }
            
            lastBody = res.body as any;
            
            // Show player-facing message
            if (lastBody.message) {
              logPlayerMessage(lastBody.message, lastBody.narration, lastBody.requiresPlayerInput ? "Roll Request" : "Move Complete");
            }
            
            // If no more player input required, we're done
            if (!lastBody.requiresPlayerInput) {
              log(`${colors.green}✓${colors.reset} Move completed to (${lastBody.to?.x}, ${lastBody.to?.y})`);
              break;
            }
            
            // If we need a roll but don't have one, request from scenario
            if (lastBody.type === "REQUEST_ROLL" && rollIndex >= rolls.length) {
              throw new Error(`moveComplete requires roll for ${lastBody.rollType} but no rolls provided in scenario`);
            }
          }
          
          // Clear pendingActionId after move completes
          pendingActionId = undefined;
          
          // Validate expectations
          if (moveAction.expect?.success !== undefined) {
            if (lastBody.success !== moveAction.expect.success) {
              throw new Error(`Expected success=${moveAction.expect.success}, got ${lastBody.success}`);
            }
          }
          break;
        }

        case "reactionRespond": {
          if (!pendingActionId || opportunityAttacks.length === 0) {
            throw new Error("Cannot reactionRespond: no pending opportunity attacks");
          }
          const oa = opportunityAttacks.shift()!;
          const reactAction = action as ReactionRespondAction;
          const payload: Record<string, unknown> = {
            combatantId: oa.combatantId,
            opportunityId: oa.opportunityId,
            choice: reactAction.input.choice,
          };
          // War Caster spell-as-OA: include spell selection
          if (reactAction.input.spellName) {
            payload.spellName = reactAction.input.spellName;
          }
          if (reactAction.input.castAtLevel != null) {
            payload.castAtLevel = reactAction.input.castAtLevel;
          }
          logRequest("POST", `${baseUrl}/encounters/${encounterId}/reactions/${pendingActionId}/respond`, payload);
          const res = await httpPost(`${baseUrl}/encounters/${encounterId}/reactions/${pendingActionId}/respond`, payload);
          logResponse(res.status, res.body);
          if (res.status !== 200) {
            throw new Error(`reactionRespond failed: ${JSON.stringify(res.body)}`);
          }
          const body = res.body as any;
          
          // Show player-facing message
          logPlayerMessage(body.message, body.narration, reactAction.input.choice === "use" ? "Opportunity Attack" : "Declined");
          
          log(`${colors.green}✓${colors.reset} Reaction response: ${reactAction.input.choice}`);
          break;
        }

        case "query": {
          // Test LLM intent parsing for questions
          const queryAction = action as QueryAction;
          const text = queryAction.input.text;
          
          const payload = { text };
          logRequest("POST", `${baseUrl}/sessions/${sessionId}/llm/intent`, payload);
          const res = await httpPost(`${baseUrl}/sessions/${sessionId}/llm/intent`, payload);
          logResponse(res.status, res.body);
          
          if (res.status !== 200) {
            throw new Error(`query intent parsing failed: ${JSON.stringify(res.body)}`);
          }
          
          const body = res.body as { command?: { kind?: string; subject?: string } };
          const command = body.command;
          
          if (queryAction.expect?.isQuery !== undefined) {
            if (queryAction.expect.isQuery && command?.kind !== "query") {
              throw new Error(`Expected kind=query, got ${command?.kind}`);
            }
          }
          
          if (queryAction.expect?.subject) {
            if (command?.subject !== queryAction.expect.subject) {
              throw new Error(`Expected subject=${queryAction.expect.subject}, got ${command?.subject}`);
            }
          }
          
          log(`${colors.green}✓${colors.reset} Query parsed: kind=${command?.kind}, subject=${command?.subject}`);
          break;
        }

        case "setSurprise": {
          const surpriseAction = action as SetSurpriseAction;
          let surprisePayload: Record<string, unknown>;
          // Resolve per-creature surprise: translate monster/npc/character names → IDs
          if (typeof surpriseAction.input.surprise === "object" && "surprised" in surpriseAction.input.surprise) {
            const resolvedIds = surpriseAction.input.surprise.surprised.map((nameOrId: string) => {
              // Try monster name lookup
              const monIdx = scenario.setup.monsters.findIndex(m => m.name.toLowerCase() === nameOrId.toLowerCase());
              if (monIdx >= 0 && monsterIds[monIdx]) return monsterIds[monIdx]!;
              // Try character name lookup
              const charId = characterMap.get(nameOrId);
              if (charId) return charId;
              // Try NPC name lookup
              if (scenario.setup.npcs) {
                const npcIdx = scenario.setup.npcs.findIndex((n: any) => n.name.toLowerCase() === nameOrId.toLowerCase());
                if (npcIdx >= 0 && npcIds[npcIdx]) return npcIds[npcIdx]!;
              }
              // Assume it's already a raw ID
              return nameOrId;
            });
            surprisePayload = { surprise: { surprised: resolvedIds } };
          } else {
            surprisePayload = { surprise: surpriseAction.input.surprise };
          }
          logRequest("PATCH", `${baseUrl}/sessions/${sessionId}/combat/surprise`, surprisePayload);
          const res = await httpPatch(`${baseUrl}/sessions/${sessionId}/combat/surprise`, surprisePayload);
          logResponse(res.status, res.body);
          if (res.status !== 200) {
            throw new Error(`setSurprise failed: ${JSON.stringify(res.body)}`);
          }
          const surpriseBody = res.body as any;
          if (surpriseBody.encounterId) {
            encounterId = surpriseBody.encounterId;
            log(`   ${colors.cyan}Captured encounterId: ${encounterId}${colors.reset}`);
          }
          log(`${colors.green}✓${colors.reset} Surprise set: ${JSON.stringify(surpriseAction.input.surprise)}`);
          break;
        }

        case "setTerrain": {
          const terrainAction = action as SetTerrainAction;
          const terrainPayload = { terrainZones: terrainAction.input.terrainZones };
          logRequest("PATCH", `${baseUrl}/sessions/${sessionId}/combat/terrain`, terrainPayload);
          const res = await httpPatch(`${baseUrl}/sessions/${sessionId}/combat/terrain`, terrainPayload);
          logResponse(res.status, res.body);
          if (res.status !== 200) {
            throw new Error(`setTerrain failed: ${JSON.stringify(res.body)}`);
          }
          log(`${colors.green}✓${colors.reset} Terrain zones set: ${terrainAction.input.terrainZones.length} zones`);
          break;
        }

        case "rest": {
          const restAction = action as RestAction;

          // Translate name-keyed hitDiceSpending to character-ID-keyed (API expects IDs)
          let hitDiceSpending: Record<string, number> | undefined;
          if (restAction.input.hitDiceSpending) {
            hitDiceSpending = {};
            for (const [charName, count] of Object.entries(restAction.input.hitDiceSpending)) {
              const charId = characterMap.get(charName);
              if (!charId) {
                throw new Error(`hitDiceSpending: character "${charName}" not found. Available: [${[...characterMap.keys()].join(", ")}]`);
              }
              hitDiceSpending[charId] = count;
            }
          }

          const restPayload: Record<string, unknown> = { type: restAction.input.restType };
          if (hitDiceSpending) restPayload.hitDiceSpending = hitDiceSpending;
          // Arcane Recovery: pass-through by character NAME (server looks up by name in takeSessionRest).
          if (restAction.input.arcaneRecovery) restPayload.arcaneRecovery = restAction.input.arcaneRecovery;

          logRequest("POST", `${baseUrl}/sessions/${sessionId}/rest`, restPayload);
          const res = await httpPost(`${baseUrl}/sessions/${sessionId}/rest`, restPayload);
          logResponse(res.status, res.body);
          if (res.status !== 200) {
            throw new Error(`rest failed: ${JSON.stringify(res.body)}`);
          }
          const restBody = res.body as {
            characters?: Array<{
              name: string;
              poolsRefreshed: string[];
              hitDiceSpent?: number;
              hpRecovered?: number;
            }>;
          };
          const charSummaries = restBody.characters?.map(c => `${c.name}: [${c.poolsRefreshed.join(", ")}]`).join("; ") ?? "none";
          log(`${colors.green}✓${colors.reset} ${restAction.input.restType} rest: ${charSummaries}`);

          // Validate expected refreshed pools if specified
          if (restAction.expect?.poolsRefreshed) {
            const allRefreshed = restBody.characters?.flatMap(c => c.poolsRefreshed) ?? [];
            for (const expectedPool of restAction.expect.poolsRefreshed) {
              if (!allRefreshed.includes(expectedPool)) {
                throw new Error(`Expected pool "${expectedPool}" to be refreshed, but it wasn't. Refreshed: [${allRefreshed.join(", ")}]`);
              }
            }
          }

          // Validate HP recovered from Hit Dice spending (from response body)
          if (restAction.expect?.hpRecovered) {
            const expHpRec = restAction.expect.hpRecovered;
            const charResult = restBody.characters?.find(c => c.name === expHpRec.name);
            if (!charResult) {
              throw new Error(`hpRecovered check: character "${expHpRec.name}" not found in rest result`);
            }
            const actual = charResult.hpRecovered ?? 0;
            if (expHpRec.exact !== undefined && actual !== expHpRec.exact) {
              throw new Error(`Expected "${expHpRec.name}" hpRecovered = ${expHpRec.exact}, got ${actual}`);
            }
            if (expHpRec.min !== undefined && actual < expHpRec.min) {
              throw new Error(`Expected "${expHpRec.name}" hpRecovered >= ${expHpRec.min}, got ${actual}`);
            }
            if (expHpRec.max !== undefined && actual > expHpRec.max) {
              throw new Error(`Expected "${expHpRec.name}" hpRecovered <= ${expHpRec.max}, got ${actual}`);
            }
            log(`${colors.green}✓${colors.reset} hpRecovered check: ${expHpRec.name} recovered ${actual} HP`);
          }

          // Validate character HP after rest if specified (fetch session for ground truth)
          if (restAction.expect?.characterHp || restAction.expect?.characterHitDice) {
            const sessionRes = await httpGet(`${baseUrl}/sessions/${sessionId}`);
            const sessionBody = sessionRes.body as {
              characters?: Array<{ name: string; sheet?: { currentHp?: number; maxHp?: number; hitDiceRemaining?: number } }>;
            };

            if (restAction.expect?.characterHp) {
              const expectHp = restAction.expect.characterHp;
              const char = sessionBody.characters?.find(c => c.name === expectHp.name);
              if (!char) {
                throw new Error(`Character "${expectHp.name}" not found in session for HP check`);
              }
              const hp = char.sheet?.currentHp ?? 0;
              if (expectHp.exact !== undefined && hp !== expectHp.exact) {
                throw new Error(`Expected "${expectHp.name}" HP = ${expectHp.exact}, got ${hp}`);
              }
              if (expectHp.min !== undefined && hp < expectHp.min) {
                throw new Error(`Expected "${expectHp.name}" HP >= ${expectHp.min}, got ${hp}`);
              }
              if (expectHp.max !== undefined && hp > expectHp.max) {
                throw new Error(`Expected "${expectHp.name}" HP <= ${expectHp.max}, got ${hp}`);
              }
              log(`${colors.green}✓${colors.reset} HP check: ${expectHp.name} HP = ${hp}`);
            }

            if (restAction.expect?.characterHitDice) {
              const expHd = restAction.expect.characterHitDice;
              const char = sessionBody.characters?.find(c => c.name === expHd.name);
              if (!char) {
                throw new Error(`Character "${expHd.name}" not found in session for hitDiceRemaining check`);
              }
              const remaining = char.sheet?.hitDiceRemaining;
              if (remaining !== expHd.remaining) {
                throw new Error(`Expected "${expHd.name}" hitDiceRemaining = ${expHd.remaining}, got ${remaining}`);
              }
              log(`${colors.green}✓${colors.reset} hitDiceRemaining check: ${expHd.name} has ${remaining} HD`);
            }
          }
          break;
        }

        case "endTurn": {
          // Capture current time before ending turn so we can fetch events that happen after
          lastEventTime = new Date().toISOString();
          
          const endActorId = resolveActorId(action.actor);
          const payload = { kind: "endTurn", encounterId, actor: { type: "Character", characterId: endActorId } };
          logRequest("POST", `${baseUrl}/sessions/${sessionId}/actions`, payload);
          const res = await httpPost(`${baseUrl}/sessions/${sessionId}/actions`, payload);
          logResponse(res.status, res.body);
          if (res.status !== 200) {
            throw new Error(`endTurn failed: ${JSON.stringify(res.body)}`);
          }
          log(`${colors.green}✓${colors.reset} Turn ended - monster's turn begins...`);
          break;
        }

        case "waitForTurn": {
          const timeout = (action as WaitForTurnAction).timeout ?? 5000;
          const waitActorName = (action as WaitForTurnAction).actor;
          const waitActorId = waitActorName ? resolveActorId(waitActorName) : undefined;
          const startTime = Date.now();
          let isPlayerTurn = false;
          let lastTurn = -1;
          let pollCount = 0;
          
          log(`   ${colors.gray}Waiting for ${waitActorName ?? "any"} player turn (timeout: ${timeout}ms)...${colors.reset}`);
          
          while (!isPlayerTurn && (Date.now() - startTime) < timeout) {
            pollCount++;
            // Poll encounter state
            const tacticalUrl = `${baseUrl}/sessions/${sessionId}/combat/${encounterId}/tactical`;
            logRequest("GET", tacticalUrl, undefined);
            const tacticalRes = await httpGet(tacticalUrl);
            logResponse(tacticalRes.status, tacticalRes.body);
            
            // Debug: Print first few poll attempts
            if (pollCount <= 3 && verbose) {
              log(`   ${colors.gray}[poll ${pollCount}] status=${tacticalRes.status}${colors.reset}`);
              if (tacticalRes.status !== 200) {
                log(`   ${colors.cyan}Error: ${JSON.stringify(tacticalRes.body)}${colors.reset}`);
              } else {
                const tactical = tacticalRes.body as any;
                log(`   ${colors.gray}Keys: ${Object.keys(tactical ?? {}).join(", ")}${colors.reset}`);
                // Debug combatant types - tactical view returns hp: { current, max }
                const combatantsDebug = (tactical.combatants || []).map((c: any) => 
                  `${c.name}(${c.combatantType}, HP:${c.hp?.current ?? "?"}/${c.hp?.max ?? "?"})`
                );
                log(`   ${colors.gray}Combatants: ${combatantsDebug.join(", ") || "none"}${colors.reset}`);
              }
            }
            
            if (tacticalRes.status === 200) {
              const tactical = tacticalRes.body as any;
              const activeCombatantId = tactical.activeCombatantId;
              const combatants = tactical.combatants || [];
              const activeCombatant = combatants.find((c: any) => c.id === activeCombatantId);
              
              // Check for combat end conditions (Victory/Defeat) - combat may end during AI turn
              // e.g., monster dies from opportunity attack during their move
              if (tactical.status === "Victory" || tactical.status === "Defeat") {
                log(`${colors.green}✓${colors.reset} Combat ended during waitForTurn: ${tactical.status}`);
                isPlayerTurn = true; // Exit the wait loop
                break;
              }
              
              // Check for pending DEATH_SAVE action — player's character is dying and needs a roll
              if (tactical.pendingAction?.type === "DEATH_SAVE") {
                isPlayerTurn = true;
                log(`${colors.green}✓${colors.reset} Player's character is dying — death save required`);
                break;
              }

              // Auto-decline pending Shield/Deflect reactions that this scenario doesn't handle.
              // Without this, the AI turn stays frozen waiting for a reaction response that never comes.
              if (activeCombatant && activeCombatant.combatantType !== "Character") {
                try {
                  const reactionsUrl = `${baseUrl}/encounters/${encounterId}/reactions`;
                  const reactionsRes = await httpGet(reactionsUrl);
                  if (reactionsRes.status === 200) {
                    const reactionsBody = reactionsRes.body as any;
                    const pendingActions = reactionsBody.pendingActions ?? [];
                    for (const pa of pendingActions) {
                      const reactionOpps = (pa.reactionOpportunities ?? []) as any[];
                      for (const opp of reactionOpps) {
                        const rType = opp.reactionType ?? "unknown";
                        log(`   ${colors.yellow}⚠ Auto-declining unhandled ${rType} reaction for ${opp.combatantId}${colors.reset}`);
                        const declinePayload = {
                          combatantId: opp.combatantId,
                          opportunityId: opp.id,
                          choice: "decline",
                        };
                        await httpPost(`${baseUrl}/encounters/${encounterId}/reactions/${pa.id}/respond`, declinePayload);
                      }
                    }
                  }
                } catch {
                  // Non-fatal: continue polling
                }
              }
              
              // Also check via combatant HP (fallback), but only if no characters are dying
              // A character at 0 HP with death saves is NOT dead yet
              const monsters = combatants.filter((c: any) => c.combatantType === "Monster");
              const players = combatants.filter((c: any) => c.combatantType === "Character");
              const allMonstersDead = monsters.length > 0 && monsters.every((c: any) => (c.hp?.current ?? 0) <= 0);
              const anyPlayerDying = players.some((c: any) =>
                (c.hp?.current ?? 0) <= 0 && c.deathSaves && c.deathSaves.failures < 3
              );
              const allPlayersDead = !anyPlayerDying && players.length > 0 && players.every((c: any) => (c.hp?.current ?? 0) <= 0);
              
              if (allMonstersDead || allPlayersDead) {
                const reason = allMonstersDead ? "Victory (all monsters dead)" : "Defeat (all players dead)";
                log(`${colors.green}✓${colors.reset} Combat ended during waitForTurn: ${reason}`);
                isPlayerTurn = true; // Exit the wait loop
                break;
              }
              
              if (activeCombatantId !== lastTurn) {
                lastTurn = activeCombatantId;
                log(`   ${colors.cyan}Active: ${activeCombatant?.name ?? activeCombatantId ?? "unknown"} (combatantId: ${activeCombatant?.id ?? "none"})${colors.reset}`);
                if (pollCount <= 3 && activeCombatant) {
                  log(`   ${colors.gray}movement: ${JSON.stringify(activeCombatant.movement)}${colors.reset}`);
                  log(`   ${colors.gray}Looking for characterId: ${characterId}${colors.reset}`);
                }
              }
              
              // Check if active combatant is a player character AND their movement is reset
              // The tactical view uses combatantType = "Character" for player characters
              // We also need to wait for movementSpent to be reset to false for a new turn
              // Multi-PC: if waitActorName is set, only match that specific character by name
              // (tactical view does NOT expose characterId, only combatant record id)
              if (activeCombatant && activeCombatant.combatantType === "Character") {
                // If we're waiting for a specific character, skip if this isn't them (match by name)
                if (waitActorName && activeCombatant.name !== waitActorName) {
                  // Not the character we're waiting for — keep polling
                  if (pollCount <= 3 && verbose) {
                    log(`   ${colors.gray}Active is ${activeCombatant.name} but waiting for ${waitActorName}...${colors.reset}`);
                  }
                } else {
                  const movement = activeCombatant.movement || {};
                  const movementReset = movement.movementSpent === false;
                
                  if (movementReset) {
                    isPlayerTurn = true;
                    log(`${colors.green}✓${colors.reset} Player's turn (${activeCombatant.name}) - movement reset`);
                  
                    // Fetch and display events that happened during the monster's turn
                    try {
                      const eventsUrl = `${baseUrl}/sessions/${sessionId}/events-json?limit=20`;
                      const eventsRes = await httpGet(eventsUrl);
                      if (eventsRes.status === 200) {
                        const allEvents = eventsRes.body as Array<{ type: string; payload?: Record<string, unknown>; createdAt?: string }>;
                        // Filter to events after we ended our turn
                        const monsterEvents = lastEventTime
                          ? allEvents.filter(e => e.createdAt && e.createdAt > lastEventTime!)
                          : allEvents.slice(-10);
                      
                        // Filter to combat-relevant events
                        const relevantTypes = ["AiDecision", "NarrativeText", "AttackResolved", "DamageApplied", "Move", "TurnAdvanced"];
                        const combatEvents = monsterEvents.filter(e => relevantTypes.includes(e.type));
                      
                        if (combatEvents.length > 0) {
                          console.log(`\n   ${colors.bright}${colors.yellow}━━━ Monster Turn Events ━━━${colors.reset}`);
                          displayCombatEvents(combatEvents, colors);
                          console.log(`   ${colors.dim}━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
                        }
                      }
                    } catch (err) {
                      // Non-fatal: continue even if event fetch fails
                      log(`${colors.yellow}⚠ Could not fetch monster turn events${colors.reset}`);
                    }
                  } else if (pollCount <= 3 && verbose) {
                    log(`   ${colors.yellow}Player's turn but movementSpent=${movement.movementSpent}, waiting for reset...${colors.reset}`);
                  }
                }
              }
            }
            
            if (!isPlayerTurn) {
              await new Promise((resolve) => setTimeout(resolve, 100)); // Poll every 100ms
            }
          }
          
          if (!isPlayerTurn) {
            throw new Error(`Timeout waiting for player turn after ${timeout}ms (polled ${pollCount} times)`);
          }
          break;
        }

        case "waitForPlayerOa": {
          // Wait for an AI move that triggers a player opportunity attack
          const timeout = (action as WaitForPlayerOaAction).timeout ?? 10000;
          const startTime = Date.now();
          let foundOa = false;
          let pollCount = 0;
          
          log(`   ${colors.gray}Waiting for player OA opportunity (timeout: ${timeout}ms)...${colors.reset}`);
          
          while (!foundOa && (Date.now() - startTime) < timeout) {
            pollCount++;
            
            // Check if there's a pending action with player OA opportunities
            const reactionsUrl = `${baseUrl}/encounters/${encounterId}/reactions`;
            logRequest("GET", reactionsUrl, undefined);
            const reactionsRes = await httpGet(reactionsUrl);
            logResponse(reactionsRes.status, reactionsRes.body);
            
            if (reactionsRes.status === 200) {
              const reactionsBody = reactionsRes.body as any;
              const pendingActions = reactionsBody.pendingActions ?? [];
              
              for (const pa of pendingActions) {
                // Look for OA opportunities where the combatant is the player
                const playerOpps = (pa.reactionOpportunities ?? []).filter((opp: any) => {
                  // Check if this opportunity is for our character's combatant
                  return opp.reactionType === "opportunity_attack";
                });
                
                if (playerOpps.length > 0) {
                  // Found a player OA opportunity!
                  pendingActionId = pa.id;
                  opportunityAttacks = playerOpps.map((opp: any) => ({
                    combatantId: opp.combatantId,
                    opportunityId: opp.id,
                    combatantName: opp.combatantId, // Will be resolved later
                    canAttack: true,
                    hasReaction: true,
                  }));
                  
                  foundOa = true;
                  log(`${colors.green}✓${colors.reset} Found player OA opportunity - pendingActionId: ${pendingActionId}, ${opportunityAttacks.length} OA(s)`);
                  break;
                }
              }
            }
            
            if (!foundOa) {
              await new Promise((resolve) => setTimeout(resolve, 200)); // Poll every 200ms
            }
          }
          
          if (!foundOa) {
            throw new Error(`Timeout waiting for player OA after ${timeout}ms (polled ${pollCount} times)`);
          }
          break;
        }

        case "waitForShieldReaction": {
          // Wait for an AI attack that triggers a Shield reaction prompt
          const timeout = (action as WaitForShieldReactionAction).timeout ?? 10000;
          const startTime = Date.now();
          let foundShield = false;
          let pollCount = 0;
          
          log(`   ${colors.gray}Waiting for Shield reaction opportunity (timeout: ${timeout}ms)...${colors.reset}`);
          
          while (!foundShield && (Date.now() - startTime) < timeout) {
            pollCount++;
            
            const reactionsUrl = `${baseUrl}/encounters/${encounterId}/reactions`;
            logRequest("GET", reactionsUrl, undefined);
            const reactionsRes = await httpGet(reactionsUrl);
            logResponse(reactionsRes.status, reactionsRes.body);
            
            if (reactionsRes.status === 200) {
              const reactionsBody = reactionsRes.body as any;
              const pendingActions = reactionsBody.pendingActions ?? [];
              
              for (const pa of pendingActions) {
                const shieldOpps = (pa.reactionOpportunities ?? []).filter((opp: any) => {
                  return opp.reactionType === "shield";
                });
                
                if (shieldOpps.length > 0) {
                  pendingActionId = pa.id;
                  // Store Shield opportunities using the same opportunityAttacks array
                  opportunityAttacks = shieldOpps.map((opp: any) => ({
                    combatantId: opp.combatantId,
                    opportunityId: opp.id,
                    combatantName: opp.combatantId,
                    canAttack: false,
                    hasReaction: true,
                  }));
                  
                  foundShield = true;
                  log(`${colors.green}✓${colors.reset} Found Shield reaction opportunity - pendingActionId: ${pendingActionId}, attackRoll: ${(pa as any).data?.attackRoll ?? "unknown"}`);
                  break;
                }
              }
            }
            
            if (!foundShield) {
              await new Promise((resolve) => setTimeout(resolve, 200));
            }
          }
          
          if (!foundShield) {
            throw new Error(`Timeout waiting for Shield reaction after ${timeout}ms (polled ${pollCount} times)`);
          }
          break;
        }

        case "waitForReaction": {
          // Generic: wait for an AI attack that triggers a specific reaction type
          const reactionType = (action as WaitForReactionAction).input.reactionType;
          const timeout = (action as WaitForReactionAction).timeout ?? 10000;
          const startTime = Date.now();
          let found = false;
          let pollCount = 0;
          
          log(`   ${colors.gray}Waiting for ${reactionType} reaction opportunity (timeout: ${timeout}ms)...${colors.reset}`);
          
          while (!found && (Date.now() - startTime) < timeout) {
            pollCount++;
            
            const reactionsUrl = `${baseUrl}/encounters/${encounterId}/reactions`;
            logRequest("GET", reactionsUrl, undefined);
            const reactionsRes = await httpGet(reactionsUrl);
            logResponse(reactionsRes.status, reactionsRes.body);
            
            if (reactionsRes.status === 200) {
              const reactionsBody = reactionsRes.body as any;
              const pendingActions = reactionsBody.pendingActions ?? [];
              
              for (const pa of pendingActions) {
                const matchingOpps = (pa.reactionOpportunities ?? []).filter(
                  (opp: any) => opp.reactionType === reactionType
                );
                
                if (matchingOpps.length > 0) {
                  pendingActionId = pa.id;
                  opportunityAttacks = matchingOpps.map((opp: any) => ({
                    combatantId: opp.combatantId,
                    opportunityId: opp.id,
                    combatantName: opp.combatantId,
                    canAttack: false,
                    hasReaction: true,
                  }));
                  
                  found = true;
                  log(`${colors.green}✓${colors.reset} Found ${reactionType} reaction opportunity - pendingActionId: ${pendingActionId}`);
                  break;
                }
              }
            }
            
            if (!found) {
              await new Promise((resolve) => setTimeout(resolve, 200));
            }
          }
          
          if (!found) {
            throw new Error(`Timeout waiting for ${reactionType} reaction after ${timeout}ms (polled ${pollCount} times)`);
          }
          break;
        }

        case "playerOaRoll": {
          // Submit player opportunity attack rolls via moveComplete
          if (!pendingActionId) {
            throw new Error("Cannot playerOaRoll: no pendingActionId");
          }
          
          const rollAction = action as PlayerOaRollAction;
          const rolls = [rollAction.input.attackRoll];
          if (rollAction.input.damageRoll !== undefined) {
            rolls.push(rollAction.input.damageRoll);
          }
          
          let lastBody: any = null;
          let rollIndex = 0;
          
          // First call to get the initial roll request
          let payload: { pendingActionId: string; roll?: number; rollType?: string } = { pendingActionId };
          logRequest("POST", `${baseUrl}/sessions/${sessionId}/combat/move/complete`, payload);
          let res = await httpPost(`${baseUrl}/sessions/${sessionId}/combat/move/complete`, payload);
          logResponse(res.status, res.body);
          
          if (res.status !== 200) {
            throw new Error(`playerOaRoll moveComplete failed: ${JSON.stringify(res.body)}`);
          }
          lastBody = res.body as any;
          
          // Submit rolls as requested
          while (lastBody.requiresPlayerInput && lastBody.type === "REQUEST_ROLL" && rollIndex < rolls.length) {
            const roll = rolls[rollIndex];
            rollIndex++;
            
            log(`   ${colors.cyan}Submitting OA roll: ${roll} for ${lastBody.rollType}${colors.reset}`);
            logPlayerMessage(lastBody.message, lastBody.narration, "Roll Request");
            
            payload = { pendingActionId, roll, rollType: lastBody.rollType };
            logRequest("POST", `${baseUrl}/sessions/${sessionId}/combat/move/complete`, payload);
            res = await httpPost(`${baseUrl}/sessions/${sessionId}/combat/move/complete`, payload);
            logResponse(res.status, res.body);
            
            if (res.status !== 200) {
              throw new Error(`playerOaRoll roll submission failed: ${JSON.stringify(res.body)}`);
            }
            lastBody = res.body as any;
          }
          
          // Final message
          if (lastBody.message) {
            logPlayerMessage(lastBody.message, lastBody.narration, "OA Result");
          }
          
          // If move is complete, clear pendingActionId
          if (!lastBody.requiresPlayerInput) {
            log(`${colors.green}✓${colors.reset} Player OA completed, move finished`);
            pendingActionId = undefined;
          }
          
          // Validate hit expectation
          if (rollAction.expect?.hit !== undefined) {
            // The hit status is embedded in the message typically
            // For now, we trust the scenario author to provide correct rolls
            log(`   ${colors.gray}Hit expectation: ${rollAction.expect.hit} (validation not implemented)${colors.reset}`);
          }
          break;
        }

        case "configureAi": {
          const configAction = action as ConfigureAiAction;
          if (callbacks.configureAi) {
            callbacks.configureAi({
              defaultBehavior: configAction.input.defaultBehavior,
              defaultBonusAction: configAction.input.defaultBonusAction,
              monsterBehaviors: configAction.input.monsterBehaviors,
            });
            log(`${colors.green}✓${colors.reset} AI configured to: ${configAction.input.defaultBehavior}${configAction.input.defaultBonusAction ? ` + bonus: ${configAction.input.defaultBonusAction}` : ""}${configAction.input.monsterBehaviors ? ` + per-monster: ${JSON.stringify(configAction.input.monsterBehaviors)}` : ""}`);
          } else {
            log(`${colors.yellow}⚠${colors.reset} AI configuration not available (no callback provided)`);
          }
          break;
        }

        case "queueMonsterActions": {
          const queueAction = action as QueueMonsterActionsAction;
          if (callbacks.queueDecisions) {
            callbacks.queueDecisions(queueAction.input.decisions as Array<Record<string, unknown>>);
            log(`${colors.green}✓${colors.reset} Queued ${queueAction.input.decisions.length} AI decision(s)`);
            for (const d of queueAction.input.decisions) {
              log(`   ${colors.cyan}→ ${d.action}${d.target ? ` → ${d.target}` : ""}${d.attackName ? ` (${d.attackName})` : ""}${d.spellName ? ` [${d.spellName}]` : ""}${d.endTurn !== false ? " [end turn]" : ""}${colors.reset}`);
            }
          } else {
            log(`${colors.yellow}⚠${colors.reset} Decision queueing not available (no callback provided)`);
          }
          break;
        }

        case "queueDiceRolls": {
          const diceAction = action as QueueDiceRollsAction;
          if (callbacks.queueDiceRolls) {
            callbacks.queueDiceRolls(diceAction.input.values);
            const label = diceAction.input.label ?? "server-side rolls";
            log(`${colors.green}✓${colors.reset} Queued ${diceAction.input.values.length} die value(s) for ${label}: [${diceAction.input.values.join(", ")}]`);
          } else {
            log(`${colors.yellow}⚠${colors.reset} Dice roll queueing not available (no callback provided)`);
          }
          break;
        }

        case "applyCondition": {
          if (!encounterId) throw new Error("Cannot applyCondition: no active encounter");
          const condAction = action as ApplyConditionAction;
          const { target, condition, duration, source, sourceMonster } = condAction.input;

          // Resolve target combatant ID
          let targetCombatantId: string | undefined;
          if (target === "character" || target.startsWith("character:")) {
            const charName = target === "character" ? undefined : target.slice("character:".length);
            const actorId = charName ? resolveActorId(charName) : characterId;
            // Find the combatant with this characterId
            const combatantsRes = await httpGet(`${baseUrl}/sessions/${sessionId}/combat/${encounterId}/combatants`);
            const combatantsList = combatantsRes.body as any[];
            const charCombatant = combatantsList.find((c: any) => c.characterId === actorId);
            targetCombatantId = charCombatant?.id;
          } else if (target.startsWith("monster:")) {
            const monsterRef = target.slice("monster:".length);
            // Try as index first, then as name
            const idx = parseInt(monsterRef, 10);
            if (!isNaN(idx) && idx >= 0 && idx < monsterIds.length) {
              // Index-based: find combatant by monsterId
              const combatantsRes = await httpGet(`${baseUrl}/sessions/${sessionId}/combat/${encounterId}/combatants`);
              const combatantsList = combatantsRes.body as any[];
              const monCombatant = combatantsList.find((c: any) => c.monsterId === monsterIds[idx]);
              targetCombatantId = monCombatant?.id;
            } else {
              // Name-based: find by matching monster name in setup
              const monIndex = scenario.setup.monsters.findIndex(m => m.name.toLowerCase() === monsterRef.toLowerCase());
              if (monIndex >= 0) {
                const combatantsRes = await httpGet(`${baseUrl}/sessions/${sessionId}/combat/${encounterId}/combatants`);
                const combatantsList = combatantsRes.body as any[];
                const monCombatant = combatantsList.find((c: any) => c.monsterId === monsterIds[monIndex]);
                targetCombatantId = monCombatant?.id;
              }
            }
          }

          if (!targetCombatantId) {
            throw new Error(`applyCondition: could not resolve target "${target}"`);
          }

          // Resolve source combatant ID if sourceMonster is provided
          let resolvedSource = source;
          if (sourceMonster) {
            const monIndex = scenario.setup.monsters.findIndex(m => m.name.toLowerCase() === sourceMonster.toLowerCase());
            if (monIndex >= 0) {
              const combatantsRes = await httpGet(`${baseUrl}/sessions/${sessionId}/combat/${encounterId}/combatants`);
              const combatantsList = combatantsRes.body as any[];
              const srcCombatant = combatantsList.find((c: any) => c.monsterId === monsterIds[monIndex]);
              resolvedSource = srcCombatant?.id;
            }
            if (!resolvedSource) {
              throw new Error(`applyCondition: could not resolve sourceMonster "${sourceMonster}"`);
            }
          }

          // Get current conditions then add the new one
          const combatantsRes = await httpGet(`${baseUrl}/sessions/${sessionId}/combat/${encounterId}/combatants`);
          const combatantsList = combatantsRes.body as any[];
          const targetCombatant = combatantsList.find((c: any) => c.id === targetCombatantId);
          const currentConditions = Array.isArray(targetCombatant?.conditions) ? targetCombatant.conditions : [];

          const newCondition: Record<string, unknown> = {
            condition,
            duration,
          };
          if (resolvedSource) newCondition.source = resolvedSource;

          const updatedConditions = [...currentConditions, newCondition];

          const patchUrl = `${baseUrl}/sessions/${sessionId}/combat/${encounterId}/combatants/${targetCombatantId}`;
          logRequest("PATCH", patchUrl);
          const patchRes = await httpPatch(patchUrl, { conditions: updatedConditions });
          logResponse(patchRes.status, patchRes.body);

          if (patchRes.status !== 200) {
            throw new Error(`applyCondition failed: ${JSON.stringify(patchRes.body)}`);
          }

          log(`${colors.green}✓${colors.reset} Applied "${condition}" condition to ${target}${resolvedSource ? ` (source: ${resolvedSource})` : ""}`);
          break;
        }

        default:
          throw new Error(`Unknown action type: ${(action as any).type}`);
      }

      passedSteps++;
    }

    return {
      success: true,
      totalSteps,
      passedSteps,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      totalSteps,
      passedSteps,
      failedAtStep: passedSteps + 1,
      error: errorMessage,
    };
  }
}
