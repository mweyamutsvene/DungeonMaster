/**
 * LLM E2E Test Harness
 *
 * Runs LLM accuracy tests against real Ollama for intent parsing,
 * narration, and AI decision making. Includes prompt snapshot testing.
 *
 * Usage:
 *   pnpm -C packages/game-server test:llm:e2e                        # all scenarios
 *   pnpm -C packages/game-server test:llm:e2e:intent                 # intent only
 *   pnpm -C packages/game-server test:llm:e2e:narration              # narration only
 *   pnpm -C packages/game-server test:llm:e2e:ai                     # AI decisions only
 *   pnpm -C packages/game-server test:llm:e2e:snapshot-update        # regenerate snapshots
 *
 * Direct invocation:
 *   tsx scripts/test-harness/llm-e2e.ts --all
 *   tsx scripts/test-harness/llm-e2e.ts --scenario=intent/basic-attack
 *   tsx scripts/test-harness/llm-e2e.ts --category=intent --all
 *   tsx scripts/test-harness/llm-e2e.ts --all --update-snapshots
 *   tsx scripts/test-harness/llm-e2e.ts --all --verbose
 */

import * as fs from "fs";
import * as path from "path";
import { createLlmProviderFromEnv, getDefaultModelFromEnv } from "../../src/infrastructure/llm/factory.js";
import { SpyLlmProvider } from "../../src/infrastructure/llm/spy-provider.js";
import { IntentParser } from "../../src/infrastructure/llm/intent-parser.js";
import { NarrativeGenerator } from "../../src/infrastructure/llm/narrative-generator.js";
import { LlmAiDecisionMaker } from "../../src/infrastructure/llm/ai-decision-maker.js";
import { runLlmScenario } from "./llm-scenario-runner.js";
import type { LlmScenario, ScenarioResult } from "./llm-scenario-types.js";

// ─── Minimal .env loader (no external deps) ────────────────────────────────────

function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

// ─── Colours ────────────────────────────────────────────────────────────────────

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

// ─── CLI Args ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const scenarioArg = args.find((a) => a.startsWith("--scenario="));
const categoryArg = args.find((a) => a.startsWith("--category="));
const runAll = args.includes("--all");
const verbose = args.includes("--verbose") || args.includes("-v");
const updateSnapshots = args.includes("--update-snapshots");

const scenarioName = scenarioArg?.split("=")[1];
const categoryFilter = categoryArg?.split("=")[1];

// ─── Scenario Discovery ─────────────────────────────────────────────────────────

const SCENARIOS_DIR = path.join(import.meta.dirname, "llm-scenarios");

function getAllScenarioNames(): string[] {
  if (!fs.existsSync(SCENARIOS_DIR)) return [];

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
  scanDir(SCENARIOS_DIR, "");
  return names.sort();
}

function loadScenario(name: string): LlmScenario {
  const filePath = path.join(SCENARIOS_DIR, `${name}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Scenario not found: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as LlmScenario;
}

// ─── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🧠 DungeonMaster LLM E2E Test Harness");
  console.log("======================================\n");

  // Load .env from workspace root
  loadEnvFile(path.resolve(import.meta.dirname, "../../../../.env"));

  // Create real LLM provider
  const realProvider = createLlmProviderFromEnv();
  const model = getDefaultModelFromEnv();

  if (!realProvider || !model) {
    console.error(`${RED}❌ LLM not configured.${RESET}`);
    console.error("   Set DM_OLLAMA_MODEL in .env or environment, and ensure Ollama is running.");
    process.exit(1);
  }

  console.log(`📡 Using model: ${model}`);
  console.log(`📸 Snapshot mode: ${updateSnapshots ? "UPDATE" : "compare"}\n`);

  // Wrap in spy for prompt capture
  const spy = new SpyLlmProvider(realProvider);

  const llmConfig = {
    model,
    temperature: 0.1, // Low temp for deterministic testing
    timeoutMs: 60000, // 60s — AI decisions with large system prompts need extra time
  };

  const intentParser = new IntentParser(spy, llmConfig);
  const narrativeGenerator = new NarrativeGenerator(spy, llmConfig);
  const aiDecisionMaker = new LlmAiDecisionMaker(spy, llmConfig);

  const deps = { intentParser, narrativeGenerator, aiDecisionMaker, spy };
  const options = { verbose, updateSnapshots };

  // Determine which scenarios to run
  let scenarioNames: string[];

  if (scenarioName) {
    scenarioNames = [scenarioName];
  } else if (runAll) {
    scenarioNames = getAllScenarioNames();
    if (categoryFilter) {
      scenarioNames = scenarioNames.filter((n) => n.startsWith(categoryFilter + "/"));
    }
  } else {
    console.error("Specify --scenario=<name> or --all (optionally with --category=intent|narration|ai-decision)");
    process.exit(1);
  }

  if (scenarioNames.length === 0) {
    console.error(`${YELLOW}⚠ No scenarios found.${RESET}`);
    console.error(`  Looked in: ${SCENARIOS_DIR}`);
    process.exit(1);
  }

  console.log(`📋 Running ${scenarioNames.length} scenario(s)\n`);

  // ─── Execute ────────────────────────────────────────────────────────────────

  let totalPassed = 0;
  let totalFailed = 0;
  const results: ScenarioResult[] = [];

  for (const name of scenarioNames) {
    let scenario: LlmScenario;
    try {
      scenario = loadScenario(name);
    } catch (err) {
      console.error(`${RED}❌ Failed to load scenario "${name}":${RESET}`, err);
      totalFailed++;
      results.push({
        name,
        success: false,
        passedSteps: 0,
        totalSteps: 0,
        error: String(err),
        steps: [],
        totalDurationMs: 0,
      });
      continue;
    }

    console.log(`🎯 ${scenario.name} ${DIM}(${name})${RESET}`);
    if (scenario.description) {
      console.log(`   ${DIM}${scenario.description}${RESET}`);
    }

    spy.clearCaptures();
    const result = await runLlmScenario(scenario, deps, options);
    results.push(result);

    if (result.success) {
      console.log(`  ${GREEN}✅ PASSED${RESET} ${result.passedSteps}/${result.totalSteps} steps ${DIM}(${result.totalDurationMs}ms)${RESET}\n`);
      totalPassed++;
    } else {
      console.log(`  ${RED}❌ FAILED${RESET} at step ${result.failedAtStep}: ${result.error}`);
      console.log(`  ${DIM}${result.passedSteps}/${result.totalSteps} steps passed (${result.totalDurationMs}ms)${RESET}\n`);
      totalFailed++;
    }
  }

  // ─── Summary ──────────────────────────────────────────────────────────────

  if (scenarioNames.length > 1) {
    console.log("\n═══════════════════════════════════════");
    console.log("📊 SUMMARY");
    console.log("═══════════════════════════════════════");
    for (const r of results) {
      const icon = r.success ? "✅" : "❌";
      const timing = `${DIM}(${r.totalDurationMs}ms)${RESET}`;
      console.log(`  ${icon} ${r.name}: ${r.passedSteps}/${r.totalSteps} ${timing}`);
    }
    console.log("───────────────────────────────────────");
    console.log(`  Total: ${GREEN}${totalPassed} passed${RESET}, ${totalFailed > 0 ? RED : ""}${totalFailed} failed${RESET}`);
    console.log("═══════════════════════════════════════\n");
  }

  process.exit(totalFailed > 0 ? 1 : 0);
}

// ─── Run ────────────────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
