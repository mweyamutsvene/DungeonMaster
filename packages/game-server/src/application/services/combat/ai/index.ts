/**
 * AI Module - LLM-driven tactical decision making for AI-controlled combatants.
 *
 * Structure:
 * - ai-types.ts: Consolidated type definitions (AiDecision, TurnStepResult, etc.)
 * - ai-context-builder.ts: Builds rich combat context for LLM
 * - ai-action-executor.ts: Executes AI decisions via game services
 * - ai-turn-orchestrator.ts: Main orchestrator (formerly MonsterAIService)
 */

// Types
export * from "./ai-types.js";

// Extracted modules
export * from "./ai-context-builder.js";
export * from "./ai-action-executor.js";

// Main orchestrator (with backward-compatible alias)
export * from "./ai-turn-orchestrator.js";
