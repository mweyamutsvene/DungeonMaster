/**
 * Shared multiattack parsing for AI modules.
 *
 * Extracts the attack count from a monster's Multiattack action description.
 * Used by both AiContextBuilder and AiTurnOrchestrator to avoid duplicated logic.
 */

const WORD_MAP: Record<string, number> = {
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
};

/**
 * Parse the number of attacks from a monster's Multiattack action description.
 * Returns the count if a Multiattack action is found, otherwise 1.
 *
 * @param actions - Array of action objects (typically from a monster stat block).
 *                  Each action should have a `name` and optionally a `description`.
 */
export function parseMultiattackCount(actions: unknown[]): number {
  if (!Array.isArray(actions)) return 1;

  const multiattack = actions.find(
    (a: any) => typeof a?.name === "string" && a.name.toLowerCase() === "multiattack",
  ) as { description?: string } | undefined;

  if (!multiattack?.description) return 1;

  const desc = multiattack.description.toLowerCase();

  for (const [word, count] of Object.entries(WORD_MAP)) {
    if (desc.includes(word)) return count;
  }

  // Try numeric: "makes 2 attacks"
  const numMatch = desc.match(/(\d+)\s*(?:attacks|strikes)/);
  if (numMatch) return parseInt(numMatch[1]!, 10);

  return 1;
}
