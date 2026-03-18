/**
 * Scenario Loader for the Player CLI
 *
 * Loads setup-only scenario JSON files from `scenarios/` (with subfolder support).
 * Orchestrates session + character + monster + NPC creation via GameClient.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { GameClient } from "./game-client.js";
import type {
  CliScenario,
  SessionCharacterRecord,
  SessionMonsterRecord,
  SessionNPCRecord,
} from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCENARIOS_DIR = join(__dirname, "..", "scenarios");

// ============================================================================
// Scenario Discovery
// ============================================================================

/**
 * List all available scenario names (supports subfolder structure).
 * Returns paths like "solo-fighter" or "advanced/party-dungeon".
 */
export async function listScenarios(): Promise<string[]> {
  const names: string[] = [];
  await scanDir(SCENARIOS_DIR, "", names);
  return names.sort();
}

async function scanDir(dir: string, prefix: string, names: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // Directory doesn't exist
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      await scanDir(join(dir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name, names);
    } else if (entry.name.endsWith(".json")) {
      const name = entry.name.replace(".json", "");
      names.push(prefix ? `${prefix}/${name}` : name);
    }
  }
}

// ============================================================================
// Scenario Loading
// ============================================================================

export async function loadScenario(name: string): Promise<CliScenario> {
  const scenarioPath = join(SCENARIOS_DIR, `${name}.json`);
  const content = await readFile(scenarioPath, "utf-8");
  return JSON.parse(content) as CliScenario;
}

// ============================================================================
// Setup Orchestration
// ============================================================================

export interface SetupResult {
  sessionId: string;
  characterId: string;
  characters: SessionCharacterRecord[];
  monsters: SessionMonsterRecord[];
  npcs: SessionNPCRecord[];
}

/**
 * Execute scenario setup: create session, character, monsters, and NPCs.
 */
export async function setupFromScenario(
  client: GameClient,
  scenario: CliScenario,
): Promise<SetupResult> {
  // 1. Create session
  const session = await client.createSession();

  // 2. Create character
  const charSetup = scenario.setup.character;
  const charSheet = {
    ...(charSetup.sheet ?? {
      abilityScores: { strength: 16, dexterity: 14, constitution: 15, intelligence: 10, wisdom: 12, charisma: 8 },
      maxHp: 42,
      armorClass: 18,
      speed: 30,
      proficiencyBonus: 3,
    }),
    ...(charSetup.position ? { position: charSetup.position } : {}),
  };

  const character = await client.addCharacter(session.id, {
    name: charSetup.name,
    level: charSetup.level,
    className: charSetup.className,
    sheet: charSheet,
  });

  // 3. Create monsters
  const monsters: SessionMonsterRecord[] = [];
  for (const m of scenario.setup.monsters) {
    const statBlock = {
      ...m.statBlock,
      ...(m.position ? { position: m.position } : {}),
    };
    const monster = await client.addMonster(session.id, {
      name: m.name,
      statBlock,
    });
    monsters.push(monster);
  }

  // 4. Create NPCs
  const npcs: SessionNPCRecord[] = [];
  if (scenario.setup.npcs) {
    for (const n of scenario.setup.npcs) {
      const statBlock = {
        ...n.statBlock,
        ...(n.position ? { position: n.position } : {}),
      };
      const npc = await client.addNpc(session.id, {
        name: n.name,
        statBlock,
        faction: n.faction ?? "party",
        aiControlled: n.aiControlled ?? true,
      });
      npcs.push(npc);
    }
  }

  return {
    sessionId: session.id,
    characterId: character.id,
    characters: [character],
    monsters,
    npcs,
  };
}
