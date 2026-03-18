/**
 * LLM Scenario Types
 *
 * Defines the JSON schema for LLM E2E test scenarios.
 * Each scenario tests a specific LLM capability (intent parsing, narration, or AI decision).
 */

import type { JsonValue } from "../../src/application/types.js";

// ─── Roster (shared by intent scenarios) ───────────────────────────────────────

export type ScenarioRoster = {
  characters: Array<{ id: string; name: string }>;
  monsters: Array<{ id: string; name: string }>;
  npcs?: Array<{ id: string; name: string }>;
};

// ─── Intent Step ────────────────────────────────────────────────────────────────

export type IntentStepExpect = {
  /** Required: expected command kind. */
  kind: string;
  /** Optional: expected actor type (Character, Monster, NPC). */
  actorType?: string;
  /** Optional: expected target name (fuzzy substring match). */
  targetName?: string;
  /** Optional: expected target type (Character, Monster, NPC). */
  targetType?: string;
  /** Optional: for move commands — expected destination. */
  destination?: { x: number; y: number };
  /** Optional: for query commands — expected subject. */
  subject?: string;
  /** Optional: for rollResult — expected value. */
  value?: number;
  /** Optional: for rollResult — expected rollType. */
  rollType?: string;
  /** Optional: snapshot name for prompt comparison. */
  promptSnapshot?: string;
};

export type IntentStep = {
  type: "intent";
  description?: string;
  input: {
    text: string;
    roster: ScenarioRoster;
  };
  expect: IntentStepExpect;
};

// ─── Narration Step ─────────────────────────────────────────────────────────────

export type NarrationStepExpect = {
  /** At least one of these words/phrases must appear (case-insensitive). */
  containsAny?: string[];
  /** None of these words/phrases may appear (case-insensitive). */
  doesNotContain?: string[];
  /** Maximum character length for the narration. */
  maxLength?: number;
  /** Minimum character length for the narration. */
  minLength?: number;
  /** Snapshot name for prompt comparison. */
  promptSnapshot?: string;
};

export type NarrationStep = {
  type: "narration";
  description?: string;
  input: {
    events: JsonValue[];
    storyFramework?: JsonValue;
  };
  expect: NarrationStepExpect;
};

// ─── AI Decision Step ───────────────────────────────────────────────────────────

export type AiDecisionStepExpect = {
  /** Required: expected primary action. */
  action: string;
  /** Optional: expected target name (fuzzy substring match). */
  targetName?: string;
  /** Optional: one of these target names is acceptable (fuzzy substring match). */
  targetOneOf?: string[];
  /** Optional: expected attack name. */
  attackName?: string;
  /** Optional: expected bonus action. */
  bonusAction?: string;
  /** Optional: expected resource pool consumed. */
  usesResource?: string;
  /** Optional: one of these actions is acceptable (for flexible AI). */
  actionOneOf?: string[];
  /** Optional: expected spell name. */
  spellName?: string;
  /** Snapshot name for prompt comparison. */
  promptSnapshot?: string;
};

export type AiDecisionStep = {
  type: "ai-decision";
  description?: string;
  input: {
    combatantName: string;
    combatantType: string;
    context: Record<string, unknown>;
  };
  expect: AiDecisionStepExpect;
};

// ─── Scenario ───────────────────────────────────────────────────────────────────

export type LlmScenarioStep = IntentStep | NarrationStep | AiDecisionStep;

export type LlmScenario = {
  name: string;
  description?: string;
  category: "intent" | "narration" | "ai-decision";
  steps: LlmScenarioStep[];
};

// ─── Results ────────────────────────────────────────────────────────────────────

export type StepResult = {
  stepIndex: number;
  description: string;
  success: boolean;
  error?: string;
  /** Raw LLM output for debugging. */
  llmOutput?: unknown;
  /** Prompt snapshot diff (if snapshot was checked). */
  snapshotDiff?: { match: boolean; differences: string[] };
  /** Duration in ms. */
  durationMs: number;
};

export type ScenarioResult = {
  name: string;
  success: boolean;
  passedSteps: number;
  totalSteps: number;
  failedAtStep?: number;
  error?: string;
  steps: StepResult[];
  totalDurationMs: number;
};
