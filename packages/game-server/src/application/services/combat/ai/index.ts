/**
 * AI Module - LLM-driven tactical decision making for AI-controlled combatants.
 *
 * Structure:
 * - ai-types.ts: Consolidated type definitions (AiDecision, TurnStepResult, etc.)
 * - ai-action-handler.ts: AiActionHandler interface + AiActionHandlerContext/Deps types
 * - ai-action-registry.ts: AiActionRegistry for handler registration + dispatch
 * - handlers/: One handler class per AI action type
 * - ai-context-builder.ts: Builds rich combat context for LLM
 * - ai-action-executor.ts: Thin facade over AiActionRegistry
 * - ai-turn-orchestrator.ts: Main orchestrator (formerly MonsterAIService)
 */

// Types
export * from "./ai-types.js";

// Registry/strategy types (for extension points)
export * from "./ai-action-handler.js";
export * from "./ai-action-registry.js";

// Extracted modules
export * from "./ai-context-builder.js";
export * from "./ai-action-executor.js";

// Main orchestrator (with backward-compatible alias)
export * from "./ai-turn-orchestrator.js";

// Target scorer
export * from "./ai-target-scorer.js";

// Deterministic fallback AI
export * from "./deterministic-ai.js";
