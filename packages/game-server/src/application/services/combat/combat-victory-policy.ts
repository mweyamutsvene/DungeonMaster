import type { CombatantStateRecord } from "../../types.js";
import type { FactionService } from "./helpers/faction-service.js";

export type CombatVictoryStatus = "Victory" | "Defeat";

export interface CombatVictoryPolicy {
  evaluate(input: { combatants: CombatantStateRecord[] }): Promise<CombatVictoryStatus | null>;
}

/**
 * Default victory policy for tabletop-style combat in this project.
 *
 * - Characters are treated as "party"
 * - Enemies are factions "enemy" or "hostile"
 * - NPCs default to "neutral"
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
      if (combatant.hpCurrent > 0) stats.alive += 1;
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
