/**
 * Combat E2E Test Harness
 *
 * Runs deterministic combat tests using mock LLM implementations.
 * This harness starts the Fastify app with in-memory repos and mock LLM,
 * then executes test scenarios via real HTTP calls.
 *
 * Usage:
 *   pnpm -C packages/game-server test:e2e:combat:mock
 *   pnpm -C packages/game-server test:e2e:combat:mock -- --scenario=happy-path
 *   pnpm -C packages/game-server test:e2e:combat:mock -- --all   (run all scenarios)
 *   pnpm -C packages/game-server test:e2e:combat:mock -- --verbose
 *   pnpm -C packages/game-server test:e2e:combat:mock -- --detailed  (shows full request/response JSON)
 */

import * as fs from "fs";
import * as path from "path";
import { buildApp } from "../../src/infrastructure/api/app.js";
import { FixedDiceRoller, SeededDiceRoller } from "../../src/domain/rules/dice-roller.js";
import { createInMemoryRepos, clearAllRepos } from "../../src/infrastructure/testing/memory-repos.js";
import {
  MockIntentParser,
  MockNarrativeGenerator,
  MockStoryGenerator,
  MockCharacterGenerator,
  MockAiDecisionMaker,
} from "../../src/infrastructure/llm/mocks/index.js";
import { runScenario, loadScenario, type TestScenario } from "./scenario-runner.js";

const PORT = 3099;
const BASE_URL = `http://localhost:${PORT}`;

// Parse CLI args
const args = process.argv.slice(2);
const scenarioArg = args.find((a) => a.startsWith("--scenario="));
const runAll = args.includes("--all");
const scenarioName = scenarioArg?.split("=")[1] ?? "core/happy-path";
const verbose = args.includes("--verbose") || args.includes("-v");
const detailed = args.includes("--detailed") || args.includes("-d");

// Get all available scenarios (supports subfolder organization)
function getAllScenarioNames(): string[] {
  const scenariosDir = path.join(import.meta.dirname, "scenarios");
  const names: string[] = [];

  function scanDir(dir: string, prefix: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        scanDir(path.join(dir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name);
      } else if (entry.name.endsWith(".json")) {
        names.push(prefix ? `${prefix}/${entry.name.replace(".json", "")}` : entry.name.replace(".json", ""));
      }
    }
  }

  scanDir(scenariosDir, "");
  return names.sort();
}

async function main() {
  console.log("🎲 DungeonMaster Combat E2E Test Harness");
  console.log("=========================================\n");

  // Create in-memory repos
  const repos = createInMemoryRepos();

  // Create mock LLM implementations
  const intentParser = new MockIntentParser();
  const narrativeGenerator = new MockNarrativeGenerator();
  const storyGenerator = new MockStoryGenerator();
  const characterGenerator = new MockCharacterGenerator();
  const aiDecisionMaker = new MockAiDecisionMaker();

  // Use a seeded dice roller for deterministic results
  const diceRoller = new SeededDiceRoller(42);

  // Build the app with mocks (suppress logs unless detailed mode)
  const app = buildApp({
    ...repos,
    diceRoller,
    intentParser,
    narrativeGenerator,
    storyGenerator,
    characterGenerator,
    aiDecisionMaker,
    logger: detailed ? { level: "info" } : false,
  });

  try {
    // Start the server
    await app.listen({ port: PORT, host: "0.0.0.0" });
    console.log(`✅ Server started on ${BASE_URL}\n`);

    // Determine which scenarios to run
    const scenarioNames = runAll ? getAllScenarioNames() : [scenarioName];
    
    let totalPassed = 0;
    let totalFailed = 0;
    const results: { name: string; success: boolean; passedSteps: number; totalSteps: number }[] = [];

    for (const name of scenarioNames) {
      // Clear repos between scenarios
      clearAllRepos(repos);
      
      // Reset dice roller to ensure deterministic results per-scenario
      diceRoller.reset();
      
      // Reset AI behavior to default for each scenario
      aiDecisionMaker.setDefaultBehavior("attack");
      aiDecisionMaker.setDefaultBonusAction(undefined);
      aiDecisionMaker.clearMonsterBehaviors();
      
      console.log(`📋 Loading scenario: ${name}\n`);

      let scenario: TestScenario;
      try {
        scenario = await loadScenario(name);
      } catch (err) {
        console.error(`❌ Failed to load scenario "${name}":`, err);
        totalFailed++;
        results.push({ name, success: false, passedSteps: 0, totalSteps: 0 });
        continue;
      }

      console.log(`🎯 Running: ${scenario.name}\n`);
      console.log(`   ${scenario.description ?? ""}\n`);

      // Create AI configuration callback
      const configureAi = (config: { defaultBehavior: string; defaultBonusAction?: string; monsterBehaviors?: Record<string, string> }) => {
        aiDecisionMaker.setDefaultBehavior(config.defaultBehavior as any);
        aiDecisionMaker.setDefaultBonusAction(config.defaultBonusAction);
        aiDecisionMaker.clearMonsterBehaviors();
        if (config.monsterBehaviors) {
          for (const [name, behavior] of Object.entries(config.monsterBehaviors)) {
            aiDecisionMaker.setMonsterBehavior(name, behavior as any);
          }
        }
      };

      const result = await runScenario(scenario, BASE_URL, { verbose, detailed }, { configureAi });
      results.push({ name, success: result.success, passedSteps: result.passedSteps, totalSteps: result.totalSteps });

      // Print results for this scenario
      console.log("\n=========================================");
      if (result.success) {
        console.log(`✅ PASSED: ${result.passedSteps}/${result.totalSteps} steps`);
        totalPassed++;
      } else {
        console.log(`❌ FAILED: ${result.passedSteps}/${result.totalSteps} steps`);
        console.log(`\n   Failed at step ${result.failedAtStep}:`);
        console.log(`   ${result.error}`);
        totalFailed++;
      }
      console.log("=========================================\n");
    }

    // Print summary if running multiple scenarios
    if (scenarioNames.length > 1) {
      console.log("\n═══════════════════════════════════════");
      console.log("📊 SUMMARY");
      console.log("═══════════════════════════════════════");
      for (const r of results) {
        const icon = r.success ? "✅" : "❌";
        console.log(`  ${icon} ${r.name}: ${r.passedSteps}/${r.totalSteps}`);
      }
      console.log("───────────────────────────────────────");
      console.log(`  Total: ${totalPassed} passed, ${totalFailed} failed`);
      console.log("═══════════════════════════════════════\n");
    }

    // Clean up before exiting
    await app.close();
    clearAllRepos(repos);

    // Small delay to let event loop settle before exit
    await new Promise((resolve) => setTimeout(resolve, 50));
    process.exit(totalFailed > 0 ? 1 : 0);
  } catch (err) {
    console.error("❌ Fatal error:", err);
    await app.close().catch(() => {});
    clearAllRepos(repos);
    await new Promise((resolve) => setTimeout(resolve, 50));
    process.exit(1);
  }
}

// Run the harness
main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
