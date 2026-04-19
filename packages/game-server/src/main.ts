import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function loadEnvFile(filePath: string, opts?: { override: boolean }): void {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    if (!key) continue;

    // Strip optional surrounding quotes.
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }

    if (opts?.override || process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

// Load environment variables from packages/game-server/.env (and .env.local if present)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnvFile(path.resolve(__dirname, "../.env"), { override: false });
loadEnvFile(path.resolve(__dirname, "../.env.local"), { override: true });

import { buildApp } from "./infrastructure/api/app.js";
import {
  PrismaCharacterRepository,
  PrismaCombatRepository,
  PrismaEventRepository,
  PrismaGameSessionRepository,
  PrismaItemDefinitionRepository,
  PrismaMonsterRepository,
  PrismaNPCRepository,
  PrismaSpellRepository,
  PublishingEventRepository,
  PrismaUnitOfWork,
  createPrismaClient,
} from "./infrastructure/db/index.js";

import {
  createLlmProviderFromEnv,
  getDefaultModelFromEnv,
  IntentParser,
  NarrativeGenerator,
  StoryGenerator,
  CharacterGenerator,
} from "./infrastructure/llm/index.js";

import { RandomDiceRoller } from "./domain/rules/dice-roller.js";

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";

const prisma = createPrismaClient();
const unitOfWork = new PrismaUnitOfWork(prisma);

const sessionsRepo = new PrismaGameSessionRepository(prisma);
const charactersRepo = new PrismaCharacterRepository(prisma);
const monstersRepo = new PrismaMonsterRepository(prisma);
const npcsRepo = new PrismaNPCRepository(prisma);
const combatRepo = new PrismaCombatRepository(prisma);
const eventsRepo = new PublishingEventRepository(new PrismaEventRepository(prisma));
const spellsRepo = new PrismaSpellRepository(prisma);
const itemDefinitionsRepo = new PrismaItemDefinitionRepository(prisma);

const llmProvider = createLlmProviderFromEnv();
const llmModel = getDefaultModelFromEnv();
const llmTemperature = Number(process.env.DM_LLM_TEMPERATURE ?? 0.7);
const llmConfig = llmProvider && llmModel ? { model: llmModel, temperature: llmTemperature, timeoutMs: 180000 } : undefined;
const storyGenerator = llmProvider && llmModel ? new StoryGenerator(llmProvider, { model: llmModel }) : undefined;
const intentParser = llmProvider && llmModel ? new IntentParser(llmProvider, { model: llmModel }) : undefined;
const narrativeGenerator =
  llmProvider && llmModel ? new NarrativeGenerator(llmProvider, { model: llmModel }) : undefined;
const characterGenerator =
  llmProvider && llmModel ? new CharacterGenerator(llmProvider, { model: llmModel }) : undefined;

// ── Process-level crash handlers ──────────────────────────────────────────
// Catch unhandled promise rejections and uncaught exceptions so the server
// logs the error instead of silently crashing. This is critical for debugging
// async failures in AI turn orchestration, LLM calls, and fire-and-forget
// narration/event emits.
process.on("unhandledRejection", (reason, promise) => {
  console.error("🔥 Unhandled Promise Rejection:");
  console.error("  Reason:", reason);
  if (reason instanceof Error) {
    console.error("  Stack:", reason.stack);
  }
  // Don't exit — keep the server running so we can diagnose.
  // Node.js will emit a warning but won't crash.
});

process.on("uncaughtException", (error, origin) => {
  console.error("🔥 Uncaught Exception:");
  console.error("  Error:", error);
  console.error("  Origin:", origin);
  console.error("  Stack:", error.stack);
  // For uncaughtException the process state may be corrupt — exit after logging.
  // Give a moment for the log to flush.
  setTimeout(() => process.exit(1), 500);
});

const app = buildApp({
  sessionsRepo,
  charactersRepo,
  monstersRepo,
  npcsRepo,
  combatRepo,
  eventsRepo,
  spellsRepo,
  itemDefinitionsRepo,
  unitOfWork,
  prismaClient: prisma,
  diceRoller: new RandomDiceRoller(),
  storyGenerator,
  intentParser,
  narrativeGenerator,
  characterGenerator,
  llmProvider,
  llmConfig,
});

try {
  await app.listen({ port, host });
  console.log(`\n🎲 game-server listening on http://${host === "0.0.0.0" ? "localhost" : host}:${port}\n`);
} catch (error) {
  console.error("failed to start game-server:", error);
  process.exit(1);
} finally {
  // fastify handles shutdown hooks; keep prisma open while server is running
}
