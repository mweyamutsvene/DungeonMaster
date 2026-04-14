import type { CombatantStateRecord } from "../../types.js";
import type { FactionService } from "./helpers/faction-service.js";

export type CombatVictoryStatus = "Victory" | "Defeat";

/** Reason combat ended — used in CombatEnded event payloads. */
export type CombatEndReason = "elimination" | "flee" | "surrender" | "dm_end";

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
 * Check if a combatant has fled the battlefield.
 * Fled combatants are alive but no longer participating in combat.
 */
export function hasFled(combatant: CombatantStateRecord): boolean {
  const resources = (combatant.resources ?? {}) as Record<string, unknown>;
  return resources.fled === true;
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
      // A combatant is "alive" if (HP > 0 OR dying) AND has not fled
      if ((combatant.hpCurrent > 0 || isDying(combatant)) && !hasFled(combatant)) stats.alive += 1;
      factions.set(faction, stats);
    }

    // Generic faction-based victory: group factions into opposing sides using
    // FactionService.getRelationship(). Pick the first faction as the "reference"
    // faction for the player side (characters default to "party"). All factions
    // that are allies of the reference are grouped together; all enemy factions
    // form the opposing side. Neutral factions are ignored for victory checks.
    const factionNames = Array.from(factions.keys()).filter(f => f !== "unknown");
    if (factionNames.length < 2) return null; // Need at least 2 factions for a fight

    // Find the reference faction: first character's faction, or first faction alphabetically
    const firstCharFaction = input.combatants
      .filter(c => c.combatantType === "Character")
      .map(c => factionMap.get(c.id))
      .find(f => f !== undefined);
    const referenceFaction = firstCharFaction ?? factionNames[0]!;

    const allies = { alive: 0, total: 0 };
    const enemies = { alive: 0, total: 0 };

    for (const [faction, stats] of factions) {
      if (faction === "unknown") continue;
      const rel = this.factionService.getRelationship(referenceFaction, faction);
      if (rel === "ally") {
        allies.alive += stats.alive;
        allies.total += stats.total;
      } else if (rel === "enemy") {
        enemies.alive += stats.alive;
        enemies.total += stats.total;
      }
      // "neutral" factions are ignored for victory/defeat
    }

    if (enemies.total > 0 && enemies.alive === 0) return "Victory";
    if (allies.total > 0 && allies.alive === 0) return "Defeat";

    return null;
  }
}
