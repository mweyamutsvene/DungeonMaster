/**
 * Context Budget Manager — Token estimation and progressive truncation for LLM payloads.
 *
 * Ensures AI combat context fits within LLM model context windows.
 * Only affects LLM serialization — the in-memory AiCombatContext used by
 * DeterministicAiDecisionMaker is never modified.
 *
 * Layer: Infrastructure (LLM utility)
 */

import type { AiCombatContext } from "../../application/services/combat/ai/ai-types.js";

/** Default max token budget for the combat-state section of the prompt. */
const DEFAULT_MAX_CONTEXT_TOKENS = 6000;

/**
 * Rough token estimation: ~4 characters per token for English text/JSON.
 * This is a heuristic — actual tokenization varies by model.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Summarize a stat block array (traits, abilities, features, etc.) to name-only entries.
 * If entries have a `name` field, returns `[{ name }]`; otherwise returns `["..."]`.
 */
function summarizeStatBlockArray(arr: unknown[]): unknown[] {
  if (arr.length === 0) return [];
  return arr.map((item) => {
    if (typeof item === "object" && item !== null && "name" in item) {
      return { name: (item as Record<string, unknown>).name };
    }
    if (typeof item === "string") return item;
    return "...";
  });
}

/**
 * Create a reduced-detail version of an ally/enemy entry (HP, AC, conditions only).
 */
function reduceCreatureDetail(
  creature: AiCombatContext["allies"][number] | AiCombatContext["enemies"][number],
): Record<string, unknown> {
  return {
    name: creature.name,
    hp: creature.hp,
    ac: creature.ac,
    ...(creature.conditions && creature.conditions.length > 0 ? { conditions: creature.conditions } : {}),
    ...(creature.position ? { position: creature.position } : {}),
    ...("distanceFeet" in creature && creature.distanceFeet !== undefined ? { distanceFeet: creature.distanceFeet } : {}),
  };
}

export interface TruncationResult {
  /** The truncated context (deep-cloned — original untouched). */
  context: AiCombatContext;
  /** Whether any truncation was applied. */
  wasTruncated: boolean;
  /** Human-readable summary of what was truncated. */
  truncationNote?: string;
}

/**
 * Progressively truncate an AiCombatContext to fit within a token budget.
 *
 * Truncation priority (highest savings first):
 *   1. Reduce stat block arrays (traits, abilities, features, spells) to name-only summaries
 *   2. Limit ally/enemy detail for distant/less relevant creatures
 *   3. Limit recentNarrative to last 3 entries
 *   4. Add truncation note so LLM knows information was omitted
 *
 * The returned context is a deep clone — the input is never mutated.
 */
export function truncateContextForLlm(
  context: AiCombatContext,
  maxTokens: number = DEFAULT_MAX_CONTEXT_TOKENS,
): TruncationResult {
  // Fast path: serialize compactly and check if within budget
  const compact = JSON.stringify(context);
  const tokens = estimateTokens(compact);
  if (tokens <= maxTokens) {
    return { context, wasTruncated: false };
  }

  // Deep clone for mutation
  const ctx: AiCombatContext = JSON.parse(compact);
  const notes: string[] = [];

  // Phase 1: Summarize stat block arrays on the AI combatant
  const statBlockKeys = ["traits", "abilities", "features", "spells", "actions", "bonusActions", "reactions"] as const;
  for (const key of statBlockKeys) {
    const arr = (ctx.combatant as Record<string, unknown>)[key];
    if (Array.isArray(arr) && arr.length > 3) {
      (ctx.combatant as Record<string, unknown>)[key] = summarizeStatBlockArray(arr);
    }
  }

  let phase1Tokens = estimateTokens(JSON.stringify(ctx));
  if (phase1Tokens <= maxTokens) {
    notes.push("Stat block arrays summarized to names only");
    (ctx as unknown as Record<string, unknown>)._truncated = notes.join("; ");
    return { context: ctx, wasTruncated: true, truncationNote: notes.join("; ") };
  }
  notes.push("Stat block arrays summarized");

  // Phase 2: Reduce ally/enemy detail — keep closest N at full detail, rest reduced
  const maxFullDetailCount = 4;

  // Sort enemies by distance (closest first), reduce far ones
  if (ctx.enemies.length > maxFullDetailCount) {
    const sorted = [...ctx.enemies].sort((a, b) => (a.distanceFeet ?? 999) - (b.distanceFeet ?? 999));
    const kept = sorted.slice(0, maxFullDetailCount);
    const reduced = sorted.slice(maxFullDetailCount).map(reduceCreatureDetail);
    ctx.enemies = [...kept, ...reduced] as AiCombatContext["enemies"];
    notes.push(`Enemy detail reduced: ${kept.length} full, ${reduced.length} summary`);
  }

  if (ctx.allies.length > maxFullDetailCount) {
    const sorted = [...ctx.allies].sort((a, b) => (a.distanceFeet ?? 999) - (b.distanceFeet ?? 999));
    const kept = sorted.slice(0, maxFullDetailCount);
    const reduced = sorted.slice(maxFullDetailCount).map(reduceCreatureDetail);
    ctx.allies = [...kept, ...reduced] as AiCombatContext["allies"];
    notes.push(`Ally detail reduced: ${kept.length} full, ${reduced.length} summary`);
  }

  let phase2Tokens = estimateTokens(JSON.stringify(ctx));
  if (phase2Tokens <= maxTokens) {
    (ctx as unknown as Record<string, unknown>)._truncated = notes.join("; ");
    return { context: ctx, wasTruncated: true, truncationNote: notes.join("; ") };
  }

  // Phase 3: Limit recent narrative
  if (ctx.recentNarrative.length > 3) {
    const originalCount = ctx.recentNarrative.length;
    ctx.recentNarrative = ctx.recentNarrative.slice(-3);
    notes.push(`Narrative trimmed from ${originalCount} to 3 entries`);
  }

  // Phase 4: Remove attacks array details (keep name only) even for small arrays
  for (const key of statBlockKeys) {
    const arr = (ctx.combatant as Record<string, unknown>)[key];
    if (Array.isArray(arr) && arr.length > 0) {
      (ctx.combatant as Record<string, unknown>)[key] = summarizeStatBlockArray(arr);
    }
  }

  (ctx as unknown as Record<string, unknown>)._truncated = notes.join("; ");
  return { context: ctx, wasTruncated: true, truncationNote: notes.join("; ") };
}
