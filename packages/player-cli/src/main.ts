#!/usr/bin/env node
/**
 * player-cli — Interactive text-based D&D 5e combat client
 *
 * Connects to a running game-server and drives combat through
 * the tabletop HTTP API + SSE event stream.
 *
 * Usage:
 *   npx tsx src/main.ts [--server URL] [--scenario NAME] [--verbose] [--no-narration]
 */

import { createInterface } from "node:readline/promises";
import { stdin, stdout, argv } from "node:process";
import { GameClient } from "./game-client.js";
import { listScenarios, loadScenario, setupFromScenario } from "./scenario-loader.js";
import { CombatREPL, type CombatContext } from "./combat-repl.js";
import type { CLIOptions, CliScenario } from "./types.js";
import {
  print,
  printColored,
  colors,
  banner,
  printSuccess,
  printError,
  printWarning,
} from "./display.js";

// ============================================================================
// Arg Parsing
// ============================================================================

function parseArgs(): CLIOptions {
  const args = argv.slice(2);
  const opts: CLIOptions = {
    serverUrl: "http://127.0.0.1:3001",
    verbose: false,
    noNarration: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--server":
      case "-s":
        opts.serverUrl = args[++i] ?? opts.serverUrl;
        break;
      case "--scenario":
        opts.scenarioName = args[++i];
        break;
      case "--verbose":
      case "-v":
        opts.verbose = true;
        break;
      case "--no-narration":
        opts.noNarration = true;
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
    }
  }

  return opts;
}

function printUsage(): void {
  print(`
${colors.bold}player-cli${colors.reset} — Interactive D&D 5e Combat

${colors.bold}Usage:${colors.reset}
  npx tsx src/main.ts [options]

${colors.bold}Options:${colors.reset}
  --server URL, -s URL    Game server URL (default: http://127.0.0.1:3001)
  --scenario NAME         Load a scenario directly by name
  --verbose, -v           Show HTTP request/response details
  --no-narration          Suppress LLM narration text
  --help, -h              Show this help
`);
}

// ============================================================================
// Main Menu
// ============================================================================

async function mainMenu(
  rl: ReturnType<typeof createInterface>,
  client: GameClient,
  opts: CLIOptions,
): Promise<void> {
  banner("DUNGEON MASTER — PLAYER CLI");
  print(`Server: ${opts.serverUrl}\n`);

  // Health check
  try {
    await client.healthCheck();
    printSuccess("Server is online.");
  } catch {
    printError(`Cannot reach server at ${opts.serverUrl}`);
    printWarning("Make sure game-server is running: pnpm -C packages/game-server dev");
    return;
  }

  while (true) {
    print(`
${colors.bold}Main Menu${colors.reset}
  ${colors.cyan}1${colors.reset}) Load a scenario
  ${colors.cyan}2${colors.reset}) Quick encounter (create session manually)
  ${colors.cyan}3${colors.reset}) Exit
`);

    const choice = (await rl.question("Choose: ")).trim();

    switch (choice) {
      case "1":
        if (await scenarioFlow(rl, client, opts) === "quit") return;
        break;
      case "2":
        if (await quickEncounterFlow(rl, client, opts) === "quit") return;
        break;
      case "3":
      case "exit":
      case "quit":
        printColored("Farewell, adventurer.", colors.dim);
        return;
      default:
        printWarning("Invalid choice.");
    }
  }
}

// ============================================================================
// Scenario Flow
// ============================================================================

async function scenarioFlow(
  rl: ReturnType<typeof createInterface>,
  client: GameClient,
  opts: CLIOptions,
): Promise<"quit" | "menu" | undefined> {
  const scenarios = await listScenarios();

  if (scenarios.length === 0) {
    printWarning("No scenarios found in the scenarios/ folder.");
    return;
  }

  print(`\n${colors.bold}Available Scenarios:${colors.reset}`);
  for (let i = 0; i < scenarios.length; i++) {
    print(`  ${colors.cyan}${i + 1}${colors.reset}) ${scenarios[i]}`);
  }

  const choice = (await rl.question("\nSelect scenario (number or name): ")).trim();
  let scenarioName: string;

  const idx = parseInt(choice, 10) - 1;
  if (!isNaN(idx) && idx >= 0 && idx < scenarios.length) {
    scenarioName = scenarios[idx];
  } else {
    // Try to match by name (fuzzy)
    const match = scenarios.find((s) =>
      s.toLowerCase().includes(choice.toLowerCase()),
    );
    if (!match) {
      printError(`Scenario "${choice}" not found.`);
      return;
    }
    scenarioName = match;
  }

  const scenario = await loadScenario(scenarioName);
  print(`\nLoading scenario: ${colors.bold}${scenario.name}${colors.reset}`);
  if (scenario.description) {
    printColored(scenario.description, colors.dim);
  }

  return await runScenario(rl, client, opts, scenario);
}

async function runScenario(
  rl: ReturnType<typeof createInterface>,
  client: GameClient,
  opts: CLIOptions,
  scenario: CliScenario,
): Promise<"quit" | "menu"> {
  print("\nSetting up session...");
  const setupResult = await setupFromScenario(client, scenario);

  printSuccess(`Session created: ${setupResult.sessionId}`);
  print(`  Characters: ${setupResult.characters.map((c) => c.name).join(", ")}`);
  print(`  Monsters: ${setupResult.monsters.map((m) => m.name).join(", ")}`);
  if (setupResult.npcs.length > 0) {
    print(`  NPCs: ${setupResult.npcs.map((n) => n.name).join(", ")}`);
  }

  // For now we take the first character as the player
  const playerChar = setupResult.characters[0];
  if (!playerChar) {
    printError("No characters in scenario!");
    return "menu";
  }

  const ctx: CombatContext = {
    sessionId: setupResult.sessionId,
    characterId: playerChar.id,
    encounterId: null,
    characters: setupResult.characters,
    monsters: setupResult.monsters,
    npcs: setupResult.npcs,
  };

  const repl = new CombatREPL(client, ctx, opts, rl);
  return await repl.run();
}

// ============================================================================
// Quick Encounter Flow
// ============================================================================

async function quickEncounterFlow(
  rl: ReturnType<typeof createInterface>,
  client: GameClient,
  opts: CLIOptions,
): Promise<"quit" | "menu" | undefined> {
  print(`\n${colors.bold}Quick Encounter${colors.reset}`);
  print("Create a session with a character and some monsters.\n");

  // Create session
  const sessionName = (await rl.question("Session name (or Enter for default): ")).trim() || "Quick Battle";
  const session = await client.createSession({ name: sessionName });
  printSuccess(`Session: ${session.id}`);

  // Character — use the generate endpoint (works with or without LLM if we supply a sheet)
  const charName = (await rl.question("Character name: ")).trim() || "Hero";
  const charClass = (await rl.question("Class (fighter/monk/wizard/rogue): ")).trim() || "fighter";
  const charLevel = parseInt((await rl.question("Level (1-20): ")).trim(), 10) || 5;

  const defaultSheet = makeDefaultCharacterSheet(charClass, charLevel);
  const character = await client.addCharacter(session.id, {
    name: charName,
    className: charClass,
    level: charLevel,
    sheet: defaultSheet,
  });
  printSuccess(`Character: ${character.name} (Level ${charLevel} ${charClass})`);

  // Fetch available monsters from the server's catalog (graceful fallback if unavailable)
  const catalog = await client.listMonsterCatalog(undefined, 200);
  if (catalog && catalog.monsters.length > 0) {
    const examples = catalog.monsters.slice(0, 12);
    print(`\n${colors.dim}Available monsters (${catalog.total} in catalog, shown by CR):${colors.reset}`);
    for (const m of examples) {
      const crStr = m.cr === null ? "?" : m.cr < 1 ? `1/${Math.round(1 / m.cr)}` : String(m.cr);
      print(`  ${m.name.padEnd(24)} CR ${crStr.padStart(4)}   ${m.size} ${m.kind}`);
    }
    if (catalog.total > examples.length) {
      print(`  ${colors.dim}...and ${catalog.total - examples.length} more. Type any name to use it.${colors.reset}`);
    }
  } else {
    print(`\n${colors.dim}Available presets: goblin, wolf, skeleton, ogre, orc${colors.reset}`);
  }

  // Monsters — look up in catalog first, then fall back to hardcoded presets
  const monstersInput = (await rl.question("\nMonster(s) - comma separated (e.g., goblin, goblin, wolf): ")).trim() || "goblin";
  const monsterNames = monstersInput.split(",").map((s) => s.trim()).filter(Boolean);

  const monsters = [];
  for (const name of monsterNames) {
    let statBlock: Record<string, unknown> | null = null;
    let monsterDefinitionId: string | undefined;

    // Search the catalog for this monster by name
    if (catalog && catalog.monsters.length > 0) {
      const found = catalog.monsters.find((m) => m.name.toLowerCase() === name.toLowerCase())
        ?? catalog.monsters.find((m) => m.name.toLowerCase().includes(name.toLowerCase()));
      if (found) {
        statBlock = found.statBlock;
        monsterDefinitionId = found.id;
      } else {
        // Fetch with a targeted search in case our initial 200-entry window missed it
        const searchResult = await client.listMonsterCatalog(name, 5);
        const searchFound = searchResult?.monsters.find(
          (m) => m.name.toLowerCase() === name.toLowerCase(),
        ) ?? searchResult?.monsters[0];
        if (searchFound) {
          statBlock = searchFound.statBlock;
          monsterDefinitionId = searchFound.id;
        }
      }
    }

    // Fall back to hardcoded presets if catalog lookup failed
    if (!statBlock) {
      statBlock = getQuickMonsterStatBlock(name);
    }

    try {
      const m = await client.addMonster(session.id, { name, statBlock, monsterDefinitionId });
      monsters.push(m);
      const source = monsterDefinitionId ? `${colors.dim}(catalog)${colors.reset}` : `${colors.dim}(preset)${colors.reset}`;
      printSuccess(`Monster: ${m.name} ${source}`);
    } catch (err) {
      printError(`Failed to add ${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (monsters.length === 0) {
    printError("No monsters added. Cannot start combat.");
    return;
  }

  const ctx: CombatContext = {
    sessionId: session.id,
    characterId: character.id,
    encounterId: null,
    characters: [character],
    monsters,
    npcs: [],
  };

  const repl = new CombatREPL(client, ctx, opts, rl);
  return await repl.run();
}

// ============================================================================
// Default Stat Blocks (for Quick Encounter)
// ============================================================================

function makeDefaultCharacterSheet(className: string, level: number): Record<string, unknown> {
  const profBonus = Math.floor((level - 1) / 4) + 2;
  const baseHp = className === "wizard" ? 6 : className === "rogue" ? 8 : 10;
  const hpPerLevel = className === "wizard" ? 4 : className === "rogue" ? 5 : 6;
  const maxHp = baseHp + (level - 1) * hpPerLevel + level * 2; // +2 CON mod per level

  const sheets: Record<string, Record<string, unknown>> = {
    fighter: {
      abilityScores: { strength: 16, dexterity: 14, constitution: 15, intelligence: 10, wisdom: 12, charisma: 8 },
      maxHp, currentHp: maxHp, armorClass: 18, speed: 30, proficiencyBonus: profBonus,
      attacks: [{ name: "Longsword", kind: "melee", range: "melee", attackBonus: 3 + profBonus, damage: { diceCount: 1, diceSides: 8, modifier: 3 }, damageType: "slashing", properties: ["versatile"], mastery: "sap", versatileDamage: { diceSides: 10 } }],
    },
    monk: {
      abilityScores: { strength: 12, dexterity: 16, constitution: 14, intelligence: 10, wisdom: 16, charisma: 8 },
      maxHp: 8 + (level - 1) * 5 + level * 2, currentHp: 8 + (level - 1) * 5 + level * 2, armorClass: 16, speed: level >= 10 ? 50 : level >= 6 ? 45 : level >= 2 ? 40 : 30, proficiencyBonus: profBonus,
      attacks: [{ name: "Unarmed Strike", kind: "melee", range: "melee", attackBonus: 3 + profBonus, damage: { diceCount: 1, diceSides: level >= 5 ? 6 : 4, modifier: 3 }, damageType: "bludgeoning" }],
    },
    wizard: {
      abilityScores: { strength: 8, dexterity: 14, constitution: 14, intelligence: 16, wisdom: 12, charisma: 10 },
      maxHp, currentHp: maxHp, armorClass: 12, speed: 30, proficiencyBonus: profBonus,
      attacks: [{ name: "Fire Bolt", kind: "ranged", range: "120 ft", attackBonus: 3 + profBonus, damage: { diceCount: Math.ceil(level / 5), diceSides: 10, modifier: 0 }, damageType: "fire" }],
    },
    rogue: {
      abilityScores: { strength: 10, dexterity: 16, constitution: 14, intelligence: 12, wisdom: 12, charisma: 14 },
      maxHp, currentHp: maxHp, armorClass: 15, speed: 30, proficiencyBonus: profBonus,
      attacks: [{ name: "Shortsword", kind: "melee", range: "melee", attackBonus: 3 + profBonus, damage: { diceCount: 1, diceSides: 6, modifier: 3 }, damageType: "piercing", properties: ["finesse", "light"], mastery: "vex" }],
    },
  };

  return sheets[className.toLowerCase()] ?? sheets.fighter;
}

function getQuickMonsterStatBlock(name: string): Record<string, unknown> {
  const lower = name.toLowerCase();

  const presets: Record<string, Record<string, unknown>> = {
    goblin: {
      abilityScores: { strength: 8, dexterity: 14, constitution: 10, intelligence: 10, wisdom: 8, charisma: 8 },
      maxHp: 7, hp: 7, armorClass: 15, speed: 30, challengeRating: 0.25,
      attacks: [{ name: "Scimitar", kind: "melee", attackBonus: 4, damage: { diceCount: 1, diceSides: 6, modifier: 2 }, damageType: "slashing" }],
    },
    wolf: {
      abilityScores: { strength: 12, dexterity: 15, constitution: 12, intelligence: 3, wisdom: 12, charisma: 6 },
      maxHp: 11, hp: 11, armorClass: 13, speed: 40, challengeRating: 0.25,
      attacks: [{ name: "Bite", kind: "melee", attackBonus: 4, damage: { diceCount: 2, diceSides: 4, modifier: 2 }, damageType: "piercing" }],
    },
    skeleton: {
      abilityScores: { strength: 10, dexterity: 14, constitution: 15, intelligence: 6, wisdom: 8, charisma: 5 },
      maxHp: 13, hp: 13, armorClass: 13, speed: 30, challengeRating: 0.25,
      attacks: [{ name: "Shortsword", kind: "melee", attackBonus: 4, damage: { diceCount: 1, diceSides: 6, modifier: 2 }, damageType: "piercing" }],
    },
    ogre: {
      abilityScores: { strength: 19, dexterity: 8, constitution: 16, intelligence: 5, wisdom: 7, charisma: 7 },
      maxHp: 59, hp: 59, armorClass: 11, speed: 40, challengeRating: 2,
      attacks: [{ name: "Greatclub", kind: "melee", attackBonus: 6, damage: { diceCount: 2, diceSides: 8, modifier: 4 }, damageType: "bludgeoning" }],
    },
    orc: {
      abilityScores: { strength: 16, dexterity: 12, constitution: 16, intelligence: 7, wisdom: 11, charisma: 10 },
      maxHp: 15, hp: 15, armorClass: 13, speed: 30, challengeRating: 0.5,
      attacks: [{ name: "Greataxe", kind: "melee", attackBonus: 5, damage: { diceCount: 1, diceSides: 12, modifier: 3 }, damageType: "slashing" }],
    },
  };

  // Exact match or fuzzy match
  if (presets[lower]) return presets[lower];
  const key = Object.keys(presets).find((k) => lower.includes(k));
  if (key) return presets[key];

  // Fallback: generic weak monster
  return {
    abilityScores: { strength: 10, dexterity: 10, constitution: 10, intelligence: 10, wisdom: 10, charisma: 10 },
    maxHp: 10, hp: 10, armorClass: 12, speed: 30, challengeRating: 0.25,
    attacks: [{ name: "Attack", kind: "melee", attackBonus: 2, damage: { diceCount: 1, diceSides: 6, modifier: 0 }, damageType: "bludgeoning" }],
  };
}

// ============================================================================
// Entry Point
// ============================================================================

async function main(): Promise<void> {
  const opts = parseArgs();
  const client = new GameClient(opts.serverUrl, { verbose: opts.verbose });
  const rl = createInterface({ input: stdin, output: stdout, historySize: 100 });

  try {
    // If --scenario was provided, jump straight to it
    if (opts.scenarioName) {
      const scenario = await loadScenario(opts.scenarioName);
      await runScenario(rl, client, opts, scenario);
    } else {
      await mainMenu(rl, client, opts);
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("readline was closed")) {
      // User pressed Ctrl+C
      print("\nGoodbye!");
    } else {
      printError(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
      if (opts.verbose && err instanceof Error) {
        print(err.stack ?? "");
      }
    }
  } finally {
    rl.close();
  }
}

main();
