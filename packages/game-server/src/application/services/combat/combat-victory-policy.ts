import type { CombatantStateRecord } from "../../types.js";
import type { FactionService } from "./helpers/faction-service.js";

export type CombatVictoryStatus = "Victory" | "Defeat";

export interface CombatVictoryPolicy {
  evaluate(input: { combatants: CombatantStateRecord[] }): Promise<CombatVictoryStatus | null>;
}

/**
 * Check if a combatant at 0 HP is "dying" (making death saves) rather than truly dead.
 * Characters at 0 HP with fewer than 3 death save failures and not yet stabilized + dead
 * are considered dying, not dead. Monsters/NPCs at 0 HP are always dead.
 */
function isDying(combatant: CombatantStateRecord): boolean {
  if (combatant.hpCurrent > 0) return false;
  if (combatant.combatantType !== "Character") return false;
  const resources = (combatant.resources ?? {}) as Record<string, unknown>;
  const deathSaves = resources.deathSaves as { successes: number; failures: number } | undefined;
  // If no death saves initialized yet (just dropped to 0), they're dying
  if (!deathSaves) return true;
  return deathSaves.failures < 3;
}

/**
 * Default victory policy for tabletop-style combat in this project.
 *
 * - Characters are treated as "party"
 * - Enemies are factions "enemy" or "hostile"
 * - NPCs default to "neutral"
 * - Characters at 0 HP still making death saves (failures < 3) count as "alive" (dying)
 */
export class BasicCombatVictoryPolicy implements CombatVictoryPolicy {
  constructor(private readonly factionService: FactionService) {}

  async evaluate(input: { combatants: CombatantStateRecord[] }): Promise<CombatVictoryStatus | null> {
    const factionMap = await this.factionService.getFactions(input.combatants);
    const factions = new Map<string, { alive: number; total: number }>();

    for (const combatant of input.combatants) {
      const faction = factionMap.get(combatant.id) || "unknown";

      const stats = factions.get(faction) || { alive: 0, total: 0 };
      stats.total += 1;
      // A combatant is "alive" if HP > 0 OR if they are dying (making death saves)
      if (combatant.hpCurrent > 0 || isDying(combatant)) stats.alive += 1;
      factions.set(faction, stats);
    }

    const party = factions.get("party") || { alive: 0, total: 0 };

    const enemies = Array.from(factions.entries())
      .filter(([faction]) => faction === "enemy" || faction === "hostile")
      .reduce((sum, [, stats]) => sum + stats.alive, 0);

    const totalEnemies = Array.from(factions.entries())
      .filter(([faction]) => faction === "enemy" || faction === "hostile")
      .reduce((sum, [, stats]) => sum + stats.total, 0);

    if (totalEnemies > 0 && enemies === 0) return "Victory";
    if (party.total > 0 && party.alive === 0) return "Defeat";

    return null;
  }
}
