/**
 * Display utilities for the DungeonMaster Player CLI
 *
 * Provides colored terminal output, combat state rendering, event display,
 * and formatting helpers. Combines patterns from the old CLI display module
 * and the test harness's event rendering.
 */

import { stdout as output } from "node:process";
import type { TacticalState, TacticalCombatant, ActionResponse, GameEvent, CombatQueryResponse } from "./types.js";

// ============================================================================
// ANSI Color Codes
// ============================================================================

export const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",

  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",

  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
};

// ============================================================================
// Basic Output
// ============================================================================

export function print(msg: string): void {
  output.write(msg + "\n");
}

export function printColored(msg: string, color: string): void {
  output.write(`${color}${msg}${colors.reset}\n`);
}

export function banner(msg: string): void {
  print("\n" + "=".repeat(60));
  print(msg);
  print("=".repeat(60) + "\n");
}

export function printSuccess(msg: string): void {
  printColored(`✓ ${msg}`, colors.green);
}

export function printError(msg: string): void {
  printColored(`✗ ${msg}`, colors.red);
}

export function printWarning(msg: string): void {
  printColored(`⚠ ${msg}`, colors.yellow);
}

export function printInfo(msg: string): void {
  printColored(`ℹ ${msg}`, colors.cyan);
}

// ============================================================================
// Narration & Roll Requests
// ============================================================================

export function printNarration(narration: string | undefined, opts?: { suppress?: boolean }): void {
  if (!narration || opts?.suppress) return;
  print("");
  printColored(`📖 ${narration}`, colors.magenta + colors.italic);
}

export function printRollRequest(
  response: { message: string; narration?: string; diceNeeded?: string; advantage?: boolean; disadvantage?: boolean },
  opts?: { suppress?: boolean },
): void {
  if (response.narration && !opts?.suppress) {
    printNarration(response.narration, opts);
  }
  print("");
  if (response.advantage) {
    printColored("  ⬆ Advantage! Roll 2d20 and take the higher.", colors.green);
  }
  if (response.disadvantage) {
    printColored("  ⬇ Disadvantage! Roll 2d20 and take the lower.", colors.yellow);
  }
  print(response.message);
}

export function printActionResult(
  response: { message: string; narration?: string; hit?: boolean; success?: boolean },
  opts?: { suppress?: boolean; suppressNarration?: boolean },
): void {
  if (response.hit !== undefined) {
    const hitColor = response.hit ? colors.green : colors.red;
    printColored(response.message, hitColor);
  } else if (response.success !== undefined) {
    const successColor = response.success ? colors.green : colors.red;
    printColored(response.message, successColor);
  } else {
    print(response.message);
  }
  if (response.narration && !opts?.suppress && !opts?.suppressNarration) {
    printNarration(response.narration, opts);
  }
}

// ============================================================================
// Turn Order
// ============================================================================

export function printTurnOrder(turnOrder: Array<{ actorName: string; initiative: number }>): void {
  print("\n=== TURN ORDER ===");
  for (const turn of turnOrder) {
    print(`  ${turn.actorName} (Initiative: ${turn.initiative})`);
  }
}

// ============================================================================
// Tactical State
// ============================================================================

export function printTacticalState(tactical: TacticalState): void {
  print("\n=== COMBATANTS ===");

  const active = tactical.combatants.find((c) => c.id === tactical.activeCombatantId) ?? null;

  if (active?.position) {
    print(`Active position: (${active.position.x}, ${active.position.y})`);
  }

  if (active?.actionEconomy) {
    const ae = active.actionEconomy;
    const flags = active.turnFlags;

    const attacksUsed = ae.attacksUsed ?? 0;
    const attacksAllowed = ae.attacksAllowed ?? 1;
    const attacksRemaining = Math.max(0, attacksAllowed - attacksUsed);

    let actionDisplay: string;
    if (attacksAllowed > 1) {
      const attackColor = attacksRemaining > 0 ? colors.green : colors.dim;
      actionDisplay = `Action ${attackColor}${attacksRemaining}/${attacksAllowed} attacks${colors.reset}`;
    } else {
      actionDisplay = `Action ${ae.actionAvailable ? colors.green + "ready" + colors.reset : colors.dim + "spent" + colors.reset}`;
    }

    print(
      [
        `Turn economy:`,
        actionDisplay,
        `Bonus ${ae.bonusActionAvailable ? colors.green + "ready" + colors.reset : colors.dim + "used" + colors.reset}`,
        `Reaction ${ae.reactionAvailable ? colors.green + "ready" + colors.reset : colors.dim + "used" + colors.reset}`,
        `Move ${Math.round(ae.movementRemainingFeet)} ft`,
        flags?.disengaged ? colors.cyan + "(disengaged)" + colors.reset : "",
      ]
        .filter(Boolean)
        .join(" | "),
    );
  }

  if (active?.resourcePools && active.resourcePools.length > 0) {
    const summary = active.resourcePools
      .map((p) => `${p.name}: ${p.current}/${p.max}`)
      .join(" | ");
    print(`Resources: ${summary}`);
  }

  if (active?.conditions && active.conditions.length > 0) {
    print(`Conditions: ${active.conditions.join(", ")}`);
  }

  // Show last move path if present
  if (tactical.lastMovePath && tactical.lastMovePath.cells.length > 0) {
    printMovePath(tactical.lastMovePath);
  }

  print("");
  for (const c of tactical.combatants) {
    printCombatantLine(c, tactical.activeCombatantId);
  }
}

/**
 * Render the last move path as a compact trail with terrain annotations.
 */
function printMovePath(path: NonNullable<TacticalState["lastMovePath"]>): void {
  const segments = path.cells.map((cell) => {
    const coord = `(${cell.x},${cell.y})`;
    if (cell.terrain !== "normal") {
      return `${coord} ${colors.yellow}[${cell.terrain}]${colors.reset}`;
    }
    return coord;
  });
  const trail = segments.join(` ${colors.dim}\u2192${colors.reset} `);
  print(`${colors.dim}Path:${colors.reset} ${trail} ${colors.cyan}[${Math.round(path.costFeet)}ft]${colors.reset}`);
}

function printCombatantLine(c: TacticalCombatant, activeCombatantId: string): void {
  const hp = `${c.hp.current}/${c.hp.max}`;
  const isActive = c.id === activeCombatantId;
  const isDead = c.hp.current <= 0;

  const pos = c.position ? `(${c.position.x}, ${c.position.y})` : "(no position)";
  const dist = c.distanceFromActive !== null ? ` | ${Math.round(c.distanceFromActive)} ft` : "";

  let statusTag = "";
  if (isDead) statusTag = colors.red + " [DEFEATED]" + colors.reset;
  if (isActive) statusTag += colors.yellow + " [ACTIVE]" + colors.reset;

  const conditionsTag =
    c.conditions && c.conditions.length > 0
      ? ` ${colors.magenta}[${c.conditions.join(", ")}]${colors.reset}`
      : "";

  const nameColor =
    c.combatantType === "Character" ? colors.cyan :
    c.combatantType === "Monster" ? colors.red :
    colors.blue;

  const hpColor =
    c.hp.current <= c.hp.max * 0.25 ? colors.red :
    c.hp.current <= c.hp.max * 0.5 ? colors.yellow :
    colors.green;

  print(`  ${nameColor}${c.name}${colors.reset}: HP ${hpColor}${hp}${colors.reset} | ${pos}${dist}${statusTag}${conditionsTag}`);
}

// ============================================================================
// Player Turn Prompt
// ============================================================================

export function printPlayerTurnPrompt(): void {
  print("\n🎲 YOUR TURN");
  print("What would you like to do?");
  print(colors.dim + "Examples:" + colors.reset);
  print(colors.dim + "  - 'I attack the Goblin Warrior with my sword'" + colors.reset);
  print(colors.dim + "  - 'I cast fireball at the goblins'" + colors.reset);
  print(colors.dim + "  - 'move to (20, 10)'" + colors.reset);
  print(colors.dim + "  - 'dash' / 'dodge' / 'disengage'" + colors.reset);
  print(colors.dim + "  - 'action surge' (Fighter) / 'flurry of blows' (Monk)" + colors.reset);
  print(colors.dim + "  - 'which goblin is nearest?' (tactical query)" + colors.reset);
  print(colors.dim + "  - 'end turn'" + colors.reset);
}

// ============================================================================
// SSE Event Display (real-time rendering during AI turns)
// ============================================================================

export function displayEvent(event: GameEvent, opts?: { suppress?: boolean }): void {
  const payload = event.payload ?? {};

  switch (event.type) {
    case "AiDecision": {
      const decision = payload.decision as Record<string, unknown> | undefined;
      if (!decision) break;
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

      print(`   ${colors.cyan}🤖 [AI]${colors.reset} ${actionDesc}`);
      break;
    }

    case "NarrativeText": {
      if (opts?.suppress) break;
      const text = payload.text as string | undefined;
      if (text) {
        print(`   ${colors.italic}${colors.gray}${text}${colors.reset}`);
      }
      break;
    }

    case "AttackResolved": {
      const attackName = payload.attackName ?? "attack";
      const attackRoll = payload.attackRoll
        ?? ((payload.result as Record<string, unknown> | undefined)?.attack
          ? ((payload.result as Record<string, unknown>).attack as Record<string, unknown>)?.d20
          : "?");
      const attackBonus = payload.attackBonus ?? 0;
      const attackTotal = payload.attackTotal ?? "?";
      const targetAC = payload.targetAC ?? "?";
      const hit = payload.hit ?? (payload.result as Record<string, unknown> | undefined)?.hit;
      const critical = payload.critical ?? (payload.result as Record<string, unknown> | undefined)?.critical;
      const damageApplied = payload.damageApplied
        ?? ((payload.result as Record<string, unknown> | undefined)?.damage
          ? ((payload.result as Record<string, unknown>).damage as Record<string, unknown>)?.applied
          : undefined);

      const criticalStr = critical ? ` ${colors.bright}${colors.yellow}CRITICAL!${colors.reset}` : "";
      const hitStatus = hit ? `${colors.green}Hit!${colors.reset}${criticalStr}` : `${colors.yellow}Miss!${colors.reset}`;
      const damageStr = hit && damageApplied ? ` (${damageApplied} damage)` : "";
      print(`   ${colors.magenta}⚔️ [Attack]${colors.reset} ${attackName}: ${attackRoll} + ${attackBonus} = ${attackTotal} vs AC ${targetAC} - ${hitStatus}${damageStr}`);
      break;
    }

    case "DamageApplied": {
      const amount = payload.amount ?? 0;
      const hpCurrent = payload.hpCurrent ?? "?";
      const downed = typeof hpCurrent === "number" && hpCurrent <= 0;
      const downedNote = downed ? ` ${colors.yellow}⚠ DOWN!${colors.reset}` : "";
      const source = payload.source ? ` (${payload.source})` : "";
      print(`   ${colors.magenta}💥 [Damage]${colors.reset} ${amount} damage dealt${source} (HP now: ${hpCurrent})${downedNote}`);
      break;
    }

    case "HealingApplied": {
      const amount = payload.amount ?? 0;
      const hpCurrent = payload.hpCurrent ?? "?";
      print(`   ${colors.green}💚 [Heal]${colors.reset} ${amount} HP restored (HP now: ${hpCurrent})`);
      break;
    }

    case "Move": {
      const actorName = payload.actorName ?? "Combatant";
      const to = payload.to as { x: number; y: number } | undefined;
      const distance = payload.distanceMoved ?? payload.distance ?? "?";
      if (to) {
        print(`   ${colors.blue}🏃 [Move]${colors.reset} ${actorName} moves to (${to.x}, ${to.y}) [${distance}ft]`);
      }
      break;
    }

    case "TurnAdvanced": {
      const nextCombatant = payload.nextCombatantName ?? "Next combatant";
      print(`   ${colors.dim}[Turn → ${nextCombatant}]${colors.reset}`);
      break;
    }

    case "DeathSave": {
      const result = payload.result as string | undefined;
      const roll = payload.roll ?? "?";
      const deathSaves = payload.deathSaves as { successes: number; failures: number } | undefined;
      const resultColor = result === "success" || result === "stabilized" || result === "revived"
        ? colors.green : colors.red;
      const savesStr = deathSaves ? ` (${deathSaves.successes}✓ / ${deathSaves.failures}✗)` : "";
      print(`   ${resultColor}💀 [Death Save]${colors.reset} Rolled ${roll} → ${result}${savesStr}`);
      break;
    }

    case "ActionResolved": {
      const action = payload.action as string ?? "Action";
      const success = payload.success;
      const successStr = success === true ? ` → ${colors.green}Success${colors.reset}`
        : success === false ? ` → ${colors.red}Failed${colors.reset}` : "";
      print(`   ${colors.cyan}🎯 [${action}]${colors.reset}${successStr}`);
      break;
    }

    case "OpportunityAttack": {
      const attackerName = payload.attackerName ?? "Attacker";
      const hit = payload.hit;
      const damage = payload.damage;
      const hitStr = hit ? `${colors.green}Hit!${colors.reset}` : `${colors.yellow}Miss!${colors.reset}`;
      const dmgStr = hit && damage ? ` (${damage} damage)` : "";
      print(`   ${colors.red}⚡ [Opportunity Attack]${colors.reset} ${attackerName}: ${hitStr}${dmgStr}`);
      break;
    }

    case "ShieldCast": {
      const casterName = payload.casterName ?? "Caster";
      const newAC = payload.newAC ?? "?";
      print(`   ${colors.cyan}🛡️ [Shield]${colors.reset} ${casterName} casts Shield! AC → ${newAC}`);
      break;
    }

    case "DeflectAttacks": {
      const deflectorName = payload.deflectorName ?? "Monk";
      const reduction = payload.totalReduction ?? "?";
      print(`   ${colors.cyan}🤚 [Deflect]${colors.reset} ${deflectorName} deflects! Reduced by ${reduction}`);
      break;
    }

    case "ConcentrationBroken": {
      const spellId = payload.spellId ?? "spell";
      print(`   ${colors.yellow}💫 [Concentration]${colors.reset} Lost concentration on ${spellId}!`);
      break;
    }

    case "ConcentrationMaintained": {
      const spellId = payload.spellId ?? "spell";
      const roll = payload.roll ?? "?";
      const dc = payload.dc ?? "?";
      print(`   ${colors.green}💫 [Concentration]${colors.reset} Maintained ${spellId} (rolled ${roll} vs DC ${dc})`);
      break;
    }

    case "CombatEnded": {
      const result = payload.result as string ?? "ended";
      if (result === "Victory" || result === "victory") {
        print(`\n   ${colors.bright}${colors.green}🎉 VICTORY!${colors.reset}`);
      } else {
        print(`\n   ${colors.bright}${colors.red}💀 DEFEAT${colors.reset}`);
      }
      break;
    }

    case "ReactionPrompt": {
      // Displayed by the REPL's reaction handler, not here
      break;
    }

    case "ReactionResolved": {
      const combatantName = payload.combatantName ?? "Combatant";
      const reactionType = payload.reactionType ?? "reaction";
      const choice = payload.choice as string ?? "?";
      const icon = choice === "use" ? "✅" : "❌";
      print(`   ${colors.dim}${icon} [Reaction] ${combatantName} ${choice === "use" ? "uses" : "declines"} ${reactionType}${colors.reset}`);
      break;
    }

    default:
      // Unknown event types — show raw in verbose mode, skip silently otherwise
      break;
  }
}

// ============================================================================
// Tactical Query Response
// ============================================================================

export function printQueryResponse(response: CombatQueryResponse): void {
  print("\n=== TACTICAL ANALYSIS ===");
  printColored(response.answer, colors.cyan);

  const ctx = response.context as Record<string, unknown> | undefined;
  if (!ctx) return;

  const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;

  const distances = ctx.distances;
  if (Array.isArray(distances) && distances.length > 0) {
    print("\n--- Distances ---");
    for (const d of distances) {
      if (!isRecord(d)) continue;
      const targetName = d.targetName;
      const targetId = d.targetId;
      const distance = d.distance;
      const label = typeof targetName === "string" ? targetName : typeof targetId === "string" ? targetId : "unknown";
      if (typeof distance === "number") {
        print(`  - ${label}: ${Math.round(distance)} ft`);
      }
    }
  }

  const oa = ctx.oaPrediction;
  if (isRecord(oa)) {
    const destination = oa.destination;
    const movementRequiredFeet = oa.movementRequiredFeet;
    const movementRemainingFeet = oa.movementRemainingFeet;

    const hasAnyOaFields =
      destination !== undefined || movementRequiredFeet !== undefined || movementRemainingFeet !== undefined;
    if (hasAnyOaFields) {
      print("\n--- OA Prediction ---");
      if (isRecord(destination) && typeof destination.x === "number" && typeof destination.y === "number") {
        print(`  destination: (${destination.x}, ${destination.y})`);
      }
      if (typeof movementRequiredFeet === "number") {
        print(`  movementRequired: ${Math.round(movementRequiredFeet)} ft`);
      }
      if (typeof movementRemainingFeet === "number") {
        print(`  movementRemaining: ${Math.round(movementRemainingFeet)} ft`);
      }

      const oaRisks = oa.oaRisks;
      if (Array.isArray(oaRisks) && oaRisks.length > 0) {
        print("  risks:");
        for (const r of oaRisks) {
          if (!isRecord(r)) continue;
          const name = r.combatantName;
          const reach = r.reach;
          const hasReaction = r.hasReaction;
          const label = typeof name === "string" ? name : "(unknown)";
          const reachText = typeof reach === "number" ? `${Math.round(reach)}ft reach` : "unknown reach";
          const reactionText =
            typeof hasReaction === "boolean"
              ? hasReaction ? "reaction available" : "no reaction"
              : "reaction unknown";
          print(`    - ${label}: ${reachText}, ${reactionText}`);
        }
      }
    }
  }
}

// ============================================================================
// Victory / Defeat
// ============================================================================

export function printVictory(): void {
  banner("🎉 VICTORY!");
  printColored("All enemies have been defeated!", colors.green + colors.bright);
}

export function printDefeat(): void {
  banner("💀 DEFEAT");
  printColored("Your character has fallen...", colors.red + colors.bright);
}
