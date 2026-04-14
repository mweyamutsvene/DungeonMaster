#!/usr/bin/env node
/**
 * Agent Session Setup
 *
 * Creates a session from a player-cli scenario JSON and prints the IDs so the
 * agent can drive combat interactively with direct HTTP calls.
 *
 * Uses the tabletop flow (initiate / roll-result) which exercises the full
 * LLM intent-parsing pipeline — same code path as the player CLI.
 *
 * Usage:
 *   pnpm -C packages/player-cli agent:setup -- --scenario solo-fighter
 *   pnpm -C packages/player-cli agent:setup -- --scenario solo-monk
 *   pnpm -C packages/player-cli agent:setup -- --scenario boss-fight
 *
 * Output (printed to stdout):
 *   SESSION=<id>
 *   CHARACTER=<id>
 *   ENCOUNTER=<id>   (if combat auto-started)
 *
 * After running this, drive combat directly:
 *   Invoke-WebRequest http://127.0.0.1:3001/sessions/$SESSION/combat/initiate ...
 */

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const scenarioDir = resolve(__dirname, "..", "scenarios");
const SERVER = process.env.AGENT_SERVER ?? "http://127.0.0.1:3001";

// ---------------------------------------------------------------------------
// Types (minimal — only what we need to read from scenario files)
// ---------------------------------------------------------------------------

interface ScenarioFile {
  name: string;
  setup: {
    character: {
      name: string;
      className: string;
      level: number;
      sheet: Record<string, unknown>;
    };
    monsters: Array<{
      name: string;
      statBlock: Record<string, unknown>;
    }>;
  };
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function post(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${SERVER}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`POST ${path} → ${res.status}: ${text}`);
  }
  return JSON.parse(text);
}

async function get(path: string): Promise<unknown> {
  const res = await fetch(`${SERVER}${path}`);
  const text = await res.text();
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${text}`);
  return JSON.parse(text);
}

// ---------------------------------------------------------------------------

function parseArgs(): { scenarioName: string } {
  const args = process.argv.slice(2);
  const idx = args.indexOf("--scenario");
  if (idx === -1 || !args[idx + 1]) {
    console.error(
      "Usage: agent:setup -- --scenario <name>\n" +
        "  Available: solo-fighter, solo-monk, boss-fight, monk-vs-monk, party-dungeon"
    );
    process.exit(1);
  }
  return { scenarioName: args[idx + 1] };
}

async function loadScenario(name: string): Promise<ScenarioFile> {
  const candidates = [
    join(scenarioDir, `${name}.json`),
    join(scenarioDir, "agent-player", `${name}.json`),
  ];
  for (const p of candidates) {
    try {
      return JSON.parse(await readFile(p, "utf8")) as ScenarioFile;
    } catch {
      // try next
    }
  }
  throw new Error(`Scenario "${name}" not found. Looked in:\n${candidates.join("\n")}`);
}

// ---------------------------------------------------------------------------

async function main() {
  const { scenarioName } = parseArgs();

  // Health check
  const health = (await get("/health")) as { ok?: boolean; status?: string };
  if (!health.ok && health.status !== "ok") throw new Error(`Server unhealthy: ${JSON.stringify(health)}`);

  const scenario = await loadScenario(scenarioName);
  const { character, monsters } = scenario.setup;

  console.error(`\n📖 Scenario: ${scenario.name}`);
  console.error(`🎭 Character: ${character.name} (${character.className} ${character.level})`);
  console.error(`👹 Enemies:   ${monsters.map((m) => m.name).join(", ")}\n`);

  // 1. Create session (pass empty storyFramework to skip LLM story generation)
  const session = (await post("/sessions", { storyFramework: {} })) as { id: string };
  const sessionId = session.id;
  console.error(`✅ Session created: ${sessionId}`);

  // 2. Add character
  const char = (await post(`/sessions/${sessionId}/characters`, {
    name: character.name,
    level: character.level,
    className: character.className,
    sheet: character.sheet,
  })) as { id: string };
  const characterId = char.id;
  console.error(`✅ Character created: ${characterId} (${character.name})`);

  // 3. Add monsters
  const monsterEntries: Array<{ id: string; hp: number }> = [];
  for (const m of monsters) {
    const hp = (m.statBlock as Record<string, number>)["maxHp"] ?? 10;
    const monster = (await post(`/sessions/${sessionId}/monsters`, {
      name: m.name,
      statBlock: {
        armorClass: m.statBlock["armorClass"],
        hitPoints: { current: hp, max: hp },
        speed: (m.statBlock as Record<string, number>)["speed"],
        abilityScores: m.statBlock["abilityScores"],
        attacks: m.statBlock["attacks"],
        bonusActions: m.statBlock["bonusActions"],
      },
    })) as { id: string };
    monsterEntries.push({ id: monster.id, hp });
    console.error(`✅ Monster created: ${monster.id} (${m.name})`);
  }

  // 4. Start combat
  const combatants = [
    {
      combatantType: "Character",
      characterId,
      hpCurrent: (character.sheet as Record<string, number>)["currentHp"] ?? (character.sheet as Record<string, number>)["maxHp"],
      hpMax: (character.sheet as Record<string, number>)["maxHp"],
    },
    ...monsterEntries.map(({ id, hp }) => ({
      combatantType: "Monster",
      monsterId: id,
      hpCurrent: hp,
      hpMax: hp,
    })),
  ];
  const combat = (await post(`/sessions/${sessionId}/combat/start`, { combatants })) as {
    encounterId: string;
    combatants: Array<{ id: string; name?: string; initiative: number }>;
  };
  console.error(`✅ Combat started: encounter ${combat.encounterId}`);
  console.error(`📋 Combatants: ${combat.combatants.map((c) => `${c.name ?? c.id} (init: ${c.initiative})`).join(", ")}`);

  // ---------------------------------------------------------------------------
  // Print IDs to stdout for easy use in shell variables
  // ---------------------------------------------------------------------------
  console.log(`SESSION=${sessionId}`);
  console.log(`CHARACTER=${characterId}`);
  console.log(`ENCOUNTER=${combat.encounterId}`);
  console.log(`SERVER=${SERVER}`);

  console.error(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Ready! Drive combat with the tabletop flow (tests LLM):

  # Start an action (LLM parses the text → initiative, then attack)
  Invoke-WebRequest "$SERVER/sessions/$SESSION/combat/initiate" \`
    -Method POST -ContentType "application/json" \`
    -Body '{"text":"I attack the Goblin Warrior with my longsword","actorId":"$CHARACTER"}'

  # Provide a roll result
  Invoke-WebRequest "$SERVER/sessions/$SESSION/combat/roll-result" \`
    -Method POST -ContentType "application/json" \`
    -Body '{"text":"15","actorId":"$CHARACTER"}'

  # Tactical view (see HP, action economy, positions)
  Invoke-WebRequest "$SERVER/sessions/$SESSION/combat/$ENCOUNTER/tactical"

  # End your turn
  Invoke-WebRequest "$SERVER/sessions/$SESSION/actions" \`
    -Method POST -ContentType "application/json" \`
    -Body '{"kind":"endTurn","encounterId":"$ENCOUNTER","actor":{"type":"Character","characterId":"$CHARACTER"}}'
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

main().catch((err) => {
  console.error("❌", err.message);
  process.exit(1);
});
