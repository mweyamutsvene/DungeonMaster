/**
 * Material Component Helpers — D&D 5e 2024.
 *
 * Parse the loose `MaterialComponent` declaration into a structured form
 * suitable for inventory enforcement at cast time.
 *
 * Backward compatibility: existing string values like
 *   "a diamond worth 300+ GP, consumed"
 *   "a pinch of diamond dust"
 *   "a small piece of phosphorus"
 * are parsed via simple regex into structured form. New entries should use
 * the structured form directly.
 *
 * Layer: Domain (pure functions).
 */

import type { MaterialComponent, StructuredMaterialComponent } from './types.js';

/**
 * Parse a MaterialComponent declaration into structured form.
 *
 * - If already structured, returns as-is (with `componentPouchSatisfies` defaulted).
 * - If a string, attempts to extract:
 *    - `costGp` from "worth N GP" or "worth N+ GP"
 *    - `consumed` from "consumed" anywhere in the string
 *    - `itemKeyword` from common item nouns (diamond, ruby, pearl, etc.)
 *
 * Returns `null` if input is undefined.
 */
export function parseMaterialComponent(
  m: MaterialComponent | undefined,
): StructuredMaterialComponent | null {
  if (!m) return null;
  if (typeof m !== 'string') {
    return {
      ...m,
      componentPouchSatisfies: m.componentPouchSatisfies ?? (m.costGp ? false : true),
    };
  }

  const description = m;
  const lower = m.toLowerCase();

  // Cost: match "worth N GP", "worth N+ GP", "N gp", etc.
  const costMatch = lower.match(/worth\s+(\d+)\+?\s*gp/i)
    ?? lower.match(/(\d+)\+?\s*gp\s+(?:worth|item|component)/i)
    ?? lower.match(/(\d{2,})\s*gp/i);  // bare "300gp" fallback
  const costGp = costMatch ? parseInt(costMatch[1]!, 10) : undefined;

  const consumed = /\bconsumed\b/i.test(lower);

  // Common costed components — match item keyword for inventory lookup.
  // Order matters: more specific keywords first.
  const itemKeywords = [
    'holy symbol',
    'diamond',
    'ruby',
    'pearl',
    'sapphire',
    'emerald',
    'opal',
    'amber',
    'jade',
    'quartz',
    'mistletoe',
    'phosphorus',
    'incense',
  ];
  const itemKeyword = itemKeywords.find((k) => lower.includes(k));

  return {
    description,
    itemKeyword,
    costGp,
    consumed,
    componentPouchSatisfies: costGp === undefined,
  };
}
