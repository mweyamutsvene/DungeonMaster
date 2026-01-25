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

export interface TestScenario {
  name: string;
  description?: string;
  setup: ScenarioSetup;
  actions: ScenarioAction[];
}

export interface ScenarioSetup {
  character: {
    name: string;
    className: string;
    level: number;
    position?: { x: number; y: number };
    sheet?: Record<string, unknown>;
  };
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
}

export type ScenarioAction =
  | InitiateAction
  | RollResultAction
  | CombatAction
  | MoveCompleteAction
  | ReactionRespondAction
  | AssertStateAction
  | EndTurnAction
  | WaitForTurnAction;

interface InitiateAction {
  type: "initiate";
  input: { text: string };
  expect?: {
    rollType?: string;
    requiresPlayerInput?: boolean;
  };
}

interface RollResultAction {
  type: "rollResult";
  input: { text: string };
  expect?: {
    rollType?: string;
    hit?: boolean;
    combatStarted?: boolean;
    actionComplete?: boolean;
    requiresPlayerInput?: boolean;
  };
}

interface CombatAction {
  type: "action";
  input: { text: string };
  comment?: string;
  expect?: {
    rollType?: string;
    requiresPlayerInput?: boolean;
    actionComplete?: boolean;
    type?: string;
  };
}

interface MoveCompleteAction {
  type: "moveComplete";
  comment?: string;
  expect?: {
    success?: boolean;
  };
}

interface ReactionRespondAction {
  type: "reactionRespond";
  input: { choice: "use" | "decline" };
  comment?: string;
}

interface AssertStateAction {
  type: "assertState";
  expect: {
    monstersAlive?: number;
    characterHp?: { min?: number; max?: number };
    combatStatus?: "Pending" | "Active" | "Complete";
  };
}

interface EndTurnAction {
  type: "endTurn";
  expect?: {
    nextCombatant?: string;
  };
}

interface WaitForTurnAction {
  type: "waitForTurn";
  comment?: string;
  timeout?: number; // ms, default 5000
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

export async function runScenario(
  scenario: TestScenario,
  baseUrl: string,
  options: RunOptions = {},
): Promise<ScenarioResult> {
  const { verbose, detailed } = options;
  let passedSteps = 0;
  const totalSteps = scenario.actions.length + 2; // +2 for setup steps (create session, create entities)

  // Track IDs for variable substitution
  let sessionId: string | undefined;
  let characterId: string | undefined;
  let encounterId: string | undefined;
  const monsterIds: string[] = [];
  
  // Track pending action state for move reactions
  let pendingActionId: string | undefined;
  let opportunityAttacks: Array<{ combatantId: string; opportunityId: string; canAttack: boolean }> = [];
  
  // Track last event timestamp for fetching new events
  let lastEventTime: string | undefined;

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
    // Step 2: Create Character and Monsters
    // ========================================================================
    logStep(2, "setup", "Creating character, monsters, and NPCs");
    
    // Merge position into sheet if provided
    const charSheet = {
      ...(scenario.setup.character.sheet ?? {
        abilityScores: { strength: 16, dexterity: 14, constitution: 15, intelligence: 10, wisdom: 12, charisma: 8 },
        maxHp: 42,
        armorClass: 18,
        speed: 30,
        proficiencyBonus: 3,
      }),
      ...(scenario.setup.character.position ? { position: scenario.setup.character.position } : {}),
    };
    
    const charPayload = {
      name: scenario.setup.character.name,
      level: scenario.setup.character.level,
      className: scenario.setup.character.className,
      sheet: charSheet,
    };
    logRequest("POST", `${baseUrl}/sessions/${sessionId}/characters`, charPayload);
    const charRes = await httpPost(`${baseUrl}/sessions/${sessionId}/characters`, charPayload);
    logResponse(charRes.status, charRes.body);
    if (charRes.status !== 200) {
      throw new Error(`Failed to create character: ${JSON.stringify(charRes.body)}`);
    }
    characterId = (charRes.body as any).id;
    log(`${colors.green}✓${colors.reset} Character created: ${scenario.setup.character.name} (${characterId})`);

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
          const payload = { text: action.input.text, actorId: characterId };
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

          // Validate expectations
          if (action.expect) {
            if (action.expect.rollType && body.rollType !== action.expect.rollType) {
              throw new Error(`Expected rollType=${action.expect.rollType}, got ${body.rollType}`);
            }
            if (action.expect.requiresPlayerInput !== undefined && body.requiresPlayerInput !== action.expect.requiresPlayerInput) {
              throw new Error(`Expected requiresPlayerInput=${action.expect.requiresPlayerInput}, got ${body.requiresPlayerInput}`);
            }
          }
          break;
        }

        case "rollResult": {
          const payload = { text: action.input.text, actorId: characterId };
          logRequest("POST", `${baseUrl}/sessions/${sessionId}/combat/roll-result`, payload);
          const res = await httpPost(`${baseUrl}/sessions/${sessionId}/combat/roll-result`, payload);
          logResponse(res.status, res.body);
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

          // Validate expectations
          if (action.expect) {
            if (action.expect.rollType && body.rollType !== action.expect.rollType) {
              throw new Error(`Expected rollType=${action.expect.rollType}, got ${body.rollType}`);
            }
            if (action.expect.hit !== undefined && body.hit !== action.expect.hit) {
              throw new Error(`Expected hit=${action.expect.hit}, got ${body.hit}`);
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
          }
          break;
        }

        case "action": {
          const payload = { text: action.input.text, actorId: characterId, encounterId };
          logRequest("POST", `${baseUrl}/sessions/${sessionId}/combat/action`, payload);
          const res = await httpPost(`${baseUrl}/sessions/${sessionId}/combat/action`, payload);
          logResponse(res.status, res.body);
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
            const char = body.combatants?.find((c: any) => c.characterId === characterId);
            if (!char) {
              throw new Error("Character not found in combatants");
            }
            if (action.expect.characterHp.min !== undefined && char.hpCurrent < action.expect.characterHp.min) {
              throw new Error(`Expected characterHp >= ${action.expect.characterHp.min}, got ${char.hpCurrent}`);
            }
            if (action.expect.characterHp.max !== undefined && char.hpCurrent > action.expect.characterHp.max) {
              throw new Error(`Expected characterHp <= ${action.expect.characterHp.max}, got ${char.hpCurrent}`);
            }
          }
          break;
        }

        case "moveComplete": {
          if (!pendingActionId) {
            throw new Error("Cannot moveComplete: no pendingActionId (move did not trigger REACTION_CHECK)");
          }
          const payload = { pendingActionId };
          logRequest("POST", `${baseUrl}/sessions/${sessionId}/combat/move/complete`, payload);
          const res = await httpPost(`${baseUrl}/sessions/${sessionId}/combat/move/complete`, payload);
          logResponse(res.status, res.body);
          if (res.status !== 200) {
            throw new Error(`moveComplete failed: ${JSON.stringify(res.body)}`);
          }
          const body = res.body as any;
          
          // Show player-facing message
          logPlayerMessage(body.message, body.narration, "Move Complete");
          
          log(`${colors.green}✓${colors.reset} Move completed to (${body.to?.x}, ${body.to?.y})`);
          
          // Clear pendingActionId after move completes
          pendingActionId = undefined;
          
          // Validate expectations
          if ((action as MoveCompleteAction).expect?.success !== undefined) {
            if (body.success !== (action as MoveCompleteAction).expect?.success) {
              throw new Error(`Expected success=${(action as MoveCompleteAction).expect?.success}, got ${body.success}`);
            }
          }
          break;
        }

        case "reactionRespond": {
          if (!pendingActionId || opportunityAttacks.length === 0) {
            throw new Error("Cannot reactionRespond: no pending opportunity attacks");
          }
          const oa = opportunityAttacks.shift()!;
          const payload = {
            combatantId: oa.combatantId,
            opportunityId: oa.opportunityId,
            choice: (action as ReactionRespondAction).input.choice,
          };
          logRequest("POST", `${baseUrl}/encounters/${encounterId}/reactions/${pendingActionId}/respond`, payload);
          const res = await httpPost(`${baseUrl}/encounters/${encounterId}/reactions/${pendingActionId}/respond`, payload);
          logResponse(res.status, res.body);
          if (res.status !== 200) {
            throw new Error(`reactionRespond failed: ${JSON.stringify(res.body)}`);
          }
          const body = res.body as any;
          
          // Show player-facing message
          logPlayerMessage(body.message, body.narration, (action as ReactionRespondAction).input.choice === "use" ? "Opportunity Attack" : "Declined");
          
          log(`${colors.green}✓${colors.reset} Reaction response: ${(action as ReactionRespondAction).input.choice}`);
          break;
        }

        case "endTurn": {
          // Capture current time before ending turn so we can fetch events that happen after
          lastEventTime = new Date().toISOString();
          
          const payload = { kind: "endTurn", encounterId, actor: { type: "Character", characterId } };
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
          const startTime = Date.now();
          let isPlayerTurn = false;
          let lastTurn = -1;
          let pollCount = 0;
          
          log(`   ${colors.gray}Waiting for player turn (timeout: ${timeout}ms)...${colors.reset}`);
          
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
              }
            }
            
            if (tacticalRes.status === 200) {
              const tactical = tacticalRes.body as any;
              const activeCombatantId = tactical.activeCombatantId;
              const combatants = tactical.combatants || [];
              const activeCombatant = combatants.find((c: any) => c.id === activeCombatantId);
              
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
              if (activeCombatant && activeCombatant.combatantType === "Character") {
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
            
            if (!isPlayerTurn) {
              await new Promise((resolve) => setTimeout(resolve, 100)); // Poll every 100ms
            }
          }
          
          if (!isPlayerTurn) {
            throw new Error(`Timeout waiting for player turn after ${timeout}ms (polled ${pollCount} times)`);
          }
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
