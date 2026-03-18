/**
 * LLM Scenario Runner
 *
 * Executes LLM test scenarios by calling real LLM service classes and
 * validating outputs against expectations. Optionally compares captured
 * prompts against stored snapshots via SpyLlmProvider.
 */

import type { IIntentParser } from "../../src/infrastructure/llm/intent-parser.js";
import type { INarrativeGenerator } from "../../src/infrastructure/llm/narrative-generator.js";
import type { IAiDecisionMaker, AiDecision } from "../../src/application/services/combat/ai/ai-types.js";
import { buildGameCommandSchemaHint } from "../../src/application/commands/game-command.js";
import type { SpyLlmProvider } from "../../src/infrastructure/llm/spy-provider.js";
import { saveSnapshot, compareSnapshot } from "./llm-snapshot.js";
import type {
  LlmScenario,
  LlmScenarioStep,
  IntentStep,
  NarrationStep,
  AiDecisionStep,
  StepResult,
  ScenarioResult,
} from "./llm-scenario-types.js";

export type LlmRunnerDeps = {
  intentParser: IIntentParser;
  narrativeGenerator: INarrativeGenerator;
  aiDecisionMaker: IAiDecisionMaker;
  spy: SpyLlmProvider;
};

export type LlmRunnerOptions = {
  verbose: boolean;
  updateSnapshots: boolean;
};

// ─── Colours ────────────────────────────────────────────────────────────────────

const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

// ─── Runner ─────────────────────────────────────────────────────────────────────

export async function runLlmScenario(
  scenario: LlmScenario,
  deps: LlmRunnerDeps,
  options: LlmRunnerOptions,
): Promise<ScenarioResult> {
  const steps: StepResult[] = [];
  const t0 = Date.now();
  let passedSteps = 0;

  for (let i = 0; i < scenario.steps.length; i++) {
    const step = scenario.steps[i];
    const desc = step.description ?? `${step.type} step ${i + 1}`;

    if (options.verbose) {
      console.log(`  ${DIM}[${i + 1}/${scenario.steps.length}]${RESET} ${desc}`);
    }

    deps.spy.clearCaptures();
    const stepT0 = Date.now();

    let result: StepResult;
    try {
      result = await executeStep(step, deps, options, scenario.category);
    } catch (err) {
      result = {
        stepIndex: i,
        description: desc,
        success: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - stepT0,
      };
    }

    result.stepIndex = i;
    result.description = desc;
    result.durationMs = Date.now() - stepT0;
    steps.push(result);

    if (result.success) {
      passedSteps++;
      if (options.verbose) {
        console.log(`    ${GREEN}✓${RESET} passed ${DIM}(${result.durationMs}ms)${RESET}`);
      }
    } else {
      console.log(`    ${RED}✗${RESET} ${result.error}`);
      // Stop on first failure
      return {
        name: scenario.name,
        success: false,
        passedSteps,
        totalSteps: scenario.steps.length,
        failedAtStep: i + 1,
        error: result.error,
        steps,
        totalDurationMs: Date.now() - t0,
      };
    }
  }

  return {
    name: scenario.name,
    success: true,
    passedSteps,
    totalSteps: scenario.steps.length,
    steps,
    totalDurationMs: Date.now() - t0,
  };
}

// ─── Step Dispatch ──────────────────────────────────────────────────────────────

async function executeStep(
  step: LlmScenarioStep,
  deps: LlmRunnerDeps,
  options: LlmRunnerOptions,
  category: string,
): Promise<StepResult> {
  switch (step.type) {
    case "intent":
      return runIntentStep(step, deps, options, category);
    case "narration":
      return runNarrationStep(step, deps, options, category);
    case "ai-decision":
      return runAiDecisionStep(step, deps, options, category);
    default:
      return { stepIndex: 0, description: "", success: false, error: `Unknown step type: ${(step as LlmScenarioStep).type}`, durationMs: 0 };
  }
}

// ─── Intent ─────────────────────────────────────────────────────────────────────

async function runIntentStep(
  step: IntentStep,
  deps: LlmRunnerDeps,
  options: LlmRunnerOptions,
  category: string,
): Promise<StepResult> {
  const roster = {
    characters: step.input.roster.characters,
    monsters: step.input.roster.monsters,
    npcs: step.input.roster.npcs ?? [],
  };
  const schemaHint = buildGameCommandSchemaHint(roster);

  const result = await deps.intentParser.parseIntent({
    text: step.input.text,
    schemaHint,
  });

  if (options.verbose) {
    console.log(`    ${CYAN}LLM output:${RESET}`, JSON.stringify(result, null, 2).split("\n").slice(0, 6).join("\n"));
  }

  const errors: string[] = [];
  const parsed = result as Record<string, unknown>;

  // Validate kind
  if (parsed.kind !== step.expect.kind) {
    errors.push(`Expected kind="${step.expect.kind}", got "${parsed.kind}"`);
  }

  // Validate target name (fuzzy match)
  if (step.expect.targetName) {
    const targetStr = JSON.stringify(parsed.target ?? parsed.attacker ?? parsed).toLowerCase();
    if (!targetStr.includes(step.expect.targetName.toLowerCase())) {
      // Also check if target/attacker resolves through IDs
      const targetIdFound = findTargetName(parsed, roster, step.expect.targetName);
      if (!targetIdFound) {
        errors.push(`Expected target containing "${step.expect.targetName}", got ${JSON.stringify(parsed.target ?? parsed)}`);
      }
    }
  }

  // Validate target type
  if (step.expect.targetType) {
    const target = (parsed.target ?? {}) as Record<string, unknown>;
    if (target.type !== step.expect.targetType) {
      errors.push(`Expected target type "${step.expect.targetType}", got "${target.type}"`);
    }
  }

  // Validate destination
  if (step.expect.destination) {
    const dest = (parsed.destination ?? {}) as Record<string, unknown>;
    if (dest.x !== step.expect.destination.x || dest.y !== step.expect.destination.y) {
      errors.push(`Expected destination (${step.expect.destination.x},${step.expect.destination.y}), got (${dest.x},${dest.y})`);
    }
  }

  // Validate subject (query)
  if (step.expect.subject) {
    if (parsed.subject !== step.expect.subject) {
      errors.push(`Expected subject="${step.expect.subject}", got "${parsed.subject}"`);
    }
  }

  // Validate value (rollResult)
  if (step.expect.value !== undefined) {
    if (parsed.value !== step.expect.value) {
      errors.push(`Expected value=${step.expect.value}, got ${parsed.value}`);
    }
  }

  // Validate rollType
  if (step.expect.rollType) {
    if (parsed.rollType !== step.expect.rollType) {
      errors.push(`Expected rollType="${step.expect.rollType}", got "${parsed.rollType}"`);
    }
  }

  // Prompt snapshot
  const snapshotResult = handleSnapshot(step.expect.promptSnapshot, deps.spy, options, category);

  if (errors.length > 0) {
    return { stepIndex: 0, description: "", success: false, error: errors.join("; "), llmOutput: result, snapshotDiff: snapshotResult, durationMs: 0 };
  }

  return { stepIndex: 0, description: "", success: true, llmOutput: result, snapshotDiff: snapshotResult, durationMs: 0 };
}

/** Try to find a target name by looking up the ID in the roster. */
function findTargetName(
  parsed: Record<string, unknown>,
  roster: { characters: Array<{ id: string; name: string }>; monsters: Array<{ id: string; name: string }>; npcs: Array<{ id: string; name: string }> },
  expectedName: string,
): boolean {
  const target = (parsed.target ?? {}) as Record<string, unknown>;
  const allEntities = [...roster.characters, ...roster.monsters, ...roster.npcs];

  for (const idField of ["characterId", "monsterId", "npcId"]) {
    const id = target[idField] as string | undefined;
    if (id) {
      const entity = allEntities.find((e) => e.id === id);
      if (entity && entity.name.toLowerCase().includes(expectedName.toLowerCase())) {
        return true;
      }
    }
  }
  return false;
}

// ─── Narration ──────────────────────────────────────────────────────────────────

async function runNarrationStep(
  step: NarrationStep,
  deps: LlmRunnerDeps,
  options: LlmRunnerOptions,
  category: string,
): Promise<StepResult> {
  const narrative = await deps.narrativeGenerator.narrate({
    storyFramework: step.input.storyFramework ?? null,
    events: step.input.events,
  });

  if (options.verbose) {
    console.log(`    ${CYAN}Narration:${RESET} "${narrative.substring(0, 120)}${narrative.length > 120 ? "..." : ""}"`);
  }

  const errors: string[] = [];
  const lower = narrative.toLowerCase();

  // containsAny
  if (step.expect.containsAny && step.expect.containsAny.length > 0) {
    const found = step.expect.containsAny.some((kw) => lower.includes(kw.toLowerCase()));
    if (!found) {
      errors.push(`Narration must contain at least one of: [${step.expect.containsAny.join(", ")}]`);
    }
  }

  // doesNotContain
  if (step.expect.doesNotContain) {
    for (const forbidden of step.expect.doesNotContain) {
      if (lower.includes(forbidden.toLowerCase())) {
        errors.push(`Narration must NOT contain "${forbidden}" but did`);
      }
    }
  }

  // Length bounds
  if (step.expect.maxLength !== undefined && narrative.length > step.expect.maxLength) {
    errors.push(`Narration too long: ${narrative.length} chars (max ${step.expect.maxLength})`);
  }
  if (step.expect.minLength !== undefined && narrative.length < step.expect.minLength) {
    errors.push(`Narration too short: ${narrative.length} chars (min ${step.expect.minLength})`);
  }

  const snapshotResult = handleSnapshot(step.expect.promptSnapshot, deps.spy, options, category);

  if (errors.length > 0) {
    return { stepIndex: 0, description: "", success: false, error: errors.join("; "), llmOutput: narrative, snapshotDiff: snapshotResult, durationMs: 0 };
  }

  return { stepIndex: 0, description: "", success: true, llmOutput: narrative, snapshotDiff: snapshotResult, durationMs: 0 };
}

// ─── AI Decision ────────────────────────────────────────────────────────────────

async function runAiDecisionStep(
  step: AiDecisionStep,
  deps: LlmRunnerDeps,
  options: LlmRunnerOptions,
  category: string,
): Promise<StepResult> {
  const decision = await deps.aiDecisionMaker.decide({
    combatantName: step.input.combatantName,
    combatantType: step.input.combatantType,
    context: step.input.context,
  });

  if (options.verbose) {
    console.log(`    ${CYAN}AI Decision:${RESET}`, JSON.stringify(decision, null, 2).split("\n").slice(0, 6).join("\n"));
  }

  if (!decision) {
    return { stepIndex: 0, description: "", success: false, error: "AI returned null decision", durationMs: 0 };
  }

  const errors: string[] = [];

  // Validate action (supports flexible matching with actionOneOf)
  if (step.expect.actionOneOf && step.expect.actionOneOf.length > 0) {
    if (!step.expect.actionOneOf.includes(decision.action)) {
      errors.push(`Expected action one of [${step.expect.actionOneOf.join(", ")}], got "${decision.action}"`);
    }
  } else if (decision.action !== step.expect.action) {
    errors.push(`Expected action="${step.expect.action}", got "${decision.action}"`);
  }

  // Validate target name
  if (step.expect.targetName) {
    if (!decision.target?.toLowerCase().includes(step.expect.targetName.toLowerCase())) {
      errors.push(`Expected target containing "${step.expect.targetName}", got "${decision.target}"`);
    }
  }

  // Validate target one of (fuzzy substring match)
  if (step.expect.targetOneOf && step.expect.targetOneOf.length > 0) {
    const targetLower = decision.target?.toLowerCase() ?? "";
    const matched = step.expect.targetOneOf.some(t => targetLower.includes(t.toLowerCase()));
    if (!matched) {
      errors.push(`Expected target matching one of [${step.expect.targetOneOf.join(", ")}], got "${decision.target}"`);
    }
  }

  // Validate attack name
  if (step.expect.attackName) {
    if (!decision.attackName?.toLowerCase().includes(step.expect.attackName.toLowerCase())) {
      errors.push(`Expected attackName containing "${step.expect.attackName}", got "${decision.attackName}"`);
    }
  }

  // Validate bonus action
  if (step.expect.bonusAction) {
    if (!decision.bonusAction?.toLowerCase().includes(step.expect.bonusAction.toLowerCase())) {
      errors.push(`Expected bonusAction containing "${step.expect.bonusAction}", got "${decision.bonusAction}"`);
    }
  }

  // Validate spell name
  if (step.expect.spellName) {
    if (!decision.spellName?.toLowerCase().includes(step.expect.spellName.toLowerCase())) {
      errors.push(`Expected spellName containing "${step.expect.spellName}", got "${decision.spellName}"`);
    }
  }

  const snapshotResult = handleSnapshot(step.expect.promptSnapshot, deps.spy, options, category);

  if (errors.length > 0) {
    return { stepIndex: 0, description: "", success: false, error: errors.join("; "), llmOutput: decision, snapshotDiff: snapshotResult, durationMs: 0 };
  }

  return { stepIndex: 0, description: "", success: true, llmOutput: decision, snapshotDiff: snapshotResult, durationMs: 0 };
}

// ─── Snapshot Helpers ───────────────────────────────────────────────────────────

function handleSnapshot(
  snapshotName: string | undefined,
  spy: SpyLlmProvider,
  options: LlmRunnerOptions,
  category: string,
): { match: boolean; differences: string[] } | undefined {
  if (!snapshotName) return undefined;

  const lastCall = spy.getLastCall();
  if (!lastCall) return { match: false, differences: ["No LLM call captured (spy empty)"] };

  const messages = lastCall.input.messages.map((m) => ({ role: m.role, content: m.content }));

  if (options.updateSnapshots) {
    saveSnapshot(category, snapshotName, messages);
    if (options.verbose) {
      console.log(`    ${YELLOW}📸 Updated snapshot:${RESET} ${category}/${snapshotName}`);
    }
    return { match: true, differences: [] };
  }

  const diff = compareSnapshot(category, snapshotName, messages);
  if (!diff.match) {
    console.log(`    ${YELLOW}⚠ Snapshot mismatch:${RESET} ${category}/${snapshotName}`);
    for (const d of diff.differences) {
      console.log(`      ${DIM}${d}${RESET}`);
    }
  }
  return diff;
}
