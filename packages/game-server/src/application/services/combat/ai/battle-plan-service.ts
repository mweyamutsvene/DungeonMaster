/**
 * BattlePlanService — Application-layer service for faction-level battle planning.
 *
 * Layer: Application
 * Responsibility: Determine when re-planning is needed, delegate plan generation
 * to an AI planner, and persist plans on the encounter record.
 */

import type { ICombatRepository } from "../../../repositories/index.js";
import type { CombatantStateRecord, CombatEncounterRecord } from "../../../types.js";
import type { FactionService } from "../helpers/faction-service.js";
import type { ICombatantResolver } from "../helpers/combatant-resolver.js";
import type { BattlePlan } from "./battle-plan-types.js";

/**
 * Port: AI battle plan generator.
 * Infrastructure provides the LLM-backed implementation.
 */
export interface IAiBattlePlanner {
  generatePlan(input: {
    faction: string;
    factionCreatures: Array<{
      name: string;
      hp: { current: number; max: number };
      ac?: number;
      speed?: number;
      abilities?: string[];
      position?: { x: number; y: number };
    }>;
    enemies: Array<{
      name: string;
      hp: { current: number; max: number };
      ac?: number;
      speed?: number;
      position?: { x: number; y: number };
      conditions?: string[];
      class?: string;
      level?: number;
    }>;
    round: number;
  }): Promise<BattlePlan | null>;
}

export class BattlePlanService {
  constructor(
    private readonly combatRepo: ICombatRepository,
    private readonly factionService: FactionService,
    private readonly combatantResolver: ICombatantResolver,
    private readonly planner?: IAiBattlePlanner,
  ) {}

  /**
   * Check if a faction needs a new battle plan and generate one if so.
   * Returns the current plan (either existing or newly generated).
   */
  async ensurePlan(
    encounterId: string,
    encounter: CombatEncounterRecord,
    combatant: CombatantStateRecord,
    allCombatants: CombatantStateRecord[],
  ): Promise<BattlePlan | null> {
    if (!this.planner) return null;

    const faction = await this.factionService.getFaction(combatant);
    if (!faction) return null;

    // Load existing plan
    const raw = await this.combatRepo.getBattlePlan(encounterId, faction);
    const existingPlan = raw as BattlePlan | null;

    // Check if we need to re-plan
    if (existingPlan && !this.shouldReplan(existingPlan, encounter, allCombatants)) {
      return existingPlan;
    }

    // Generate new plan
    const allies = await this.factionService.getAllies(allCombatants, combatant);
    const enemies = await this.factionService.getEnemies(allCombatants, combatant);
    const nameMap = await this.combatantResolver.getNames([...allies, combatant, ...enemies]);

    const factionCreatures = [combatant, ...allies.filter(a => a.id !== combatant.id)]
      .filter(c => c.hpCurrent > 0)
      .map(c => ({
        name: nameMap.get(c.id) || "Unknown",
        hp: { current: c.hpCurrent, max: c.hpMax },
        ac: (c.resources as Record<string, unknown>)?.armorClass as number | undefined,
        speed: (c.resources as Record<string, unknown>)?.speed as number | undefined,
        position: (c.resources as Record<string, unknown>)?.position as { x: number; y: number } | undefined,
      }));

    const enemyList = enemies
      .filter(e => e.hpCurrent > 0)
      .map(e => ({
        name: nameMap.get(e.id) || "Unknown",
        hp: { current: e.hpCurrent, max: e.hpMax },
        ac: undefined as number | undefined,
        speed: undefined as number | undefined,
        position: (e.resources as Record<string, unknown>)?.position as { x: number; y: number } | undefined,
        conditions: undefined as string[] | undefined,
      }));

    const newPlan = await this.planner.generatePlan({
      faction,
      factionCreatures,
      enemies: enemyList,
      round: encounter.round,
    });

    if (newPlan) {
      await this.combatRepo.updateBattlePlan(encounterId, faction, newPlan as unknown as Record<string, unknown>);
    }

    return newPlan;
  }

  /**
   * Determine if the current plan should be regenerated.
   */
  private shouldReplan(
    plan: BattlePlan,
    encounter: CombatEncounterRecord,
    combatants: CombatantStateRecord[],
  ): boolean {
    // Plan is stale (generated >= 2 rounds ago)
    if (encounter.round - plan.generatedAtRound >= 2) return true;

    // Focus target is dead
    if (plan.focusTarget) {
      const living = combatants.filter(c => c.hpCurrent > 0);
      // We don't have names here easily, but we can check if the total living count dropped significantly
      // This is a heuristic — proper name resolution would need async. For now, we trust stale-round check.
    }

    return false;
  }

  /**
   * Get the battle plan view for a specific combatant.
   */
  getPlanViewForCombatant(plan: BattlePlan, combatantName: string): {
    priority: string;
    focusTarget?: string;
    yourRole?: string;
    tacticalNotes: string;
    retreatCondition?: string;
  } {
    return {
      priority: plan.priority,
      focusTarget: plan.focusTarget,
      yourRole: plan.creatureRoles[combatantName],
      tacticalNotes: plan.tacticalNotes,
      retreatCondition: plan.retreatCondition,
    };
  }
}
