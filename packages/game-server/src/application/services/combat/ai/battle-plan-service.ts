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

// ──────────────────────────────────────────────────────────────────────────────
// Replan thresholds — named constants, no magic numbers.
// ──────────────────────────────────────────────────────────────────────────────

/** Number of rounds after which a plan is considered stale regardless of other signals. */
const REPLAN_STALE_ROUNDS = 2;

/**
 * Fraction of a combatant's max HP that must be lost since the plan was generated
 * before the faction is triggered to re-plan.  0.25 = 25%.
 */
const REPLAN_HP_LOSS_THRESHOLD = 0.25;

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
      // Capture a battlefield snapshot so shouldReplan() heuristics can run
      // synchronously (without needing async faction-service calls).
      const livingAllies = [combatant, ...allies].filter(c => c.hpCurrent > 0);
      const livingEnemies = enemies.filter(e => e.hpCurrent > 0);

      const allyHpAtGeneration: Record<string, number> = {};
      for (const ally of livingAllies) {
        allyHpAtGeneration[ally.id] = ally.hpCurrent;
      }

      const planWithSnapshot: BattlePlan = {
        ...newPlan,
        allyHpAtGeneration,
        livingAllyIdsAtGeneration: livingAllies.map(a => a.id),
        livingEnemyIdsAtGeneration: livingEnemies.map(e => e.id),
      };

      await this.combatRepo.updateBattlePlan(encounterId, faction, planWithSnapshot as unknown as Record<string, unknown>);
      return planWithSnapshot;
    }

    return newPlan;
  }

  /**
   * Determine if the current plan should be regenerated.
   *
   * Heuristics (evaluated in order; first true wins):
   *  1. Stale plan  — generated ≥ REPLAN_STALE_ROUNDS ago.
   *  2. Ally died   — any ally that was alive at plan generation is now dead.
   *  3. HP crisis   — any ally has lost > REPLAN_HP_LOSS_THRESHOLD of their max HP
   *                   since the plan was generated.
   *  4. New threat  — a living combatant is present whose ID was unknown at
   *                   plan generation (i.e., a reinforcement joined the fight).
   *
   * All snapshot-based heuristics (2-4) are silently skipped when the plan
   * lacks snapshot fields (e.g., plans stored before this feature was added) —
   * heuristic 1 always applies as a safety fallback.
   */
  private shouldReplan(
    plan: BattlePlan,
    encounter: CombatEncounterRecord,
    combatants: CombatantStateRecord[],
  ): boolean {
    // ── 1. Stale plan ────────────────────────────────────────────────────────
    if (encounter.round - plan.generatedAtRound >= REPLAN_STALE_ROUNDS) return true;

    // ── 2. Ally died since last plan ─────────────────────────────────────────
    if (plan.livingAllyIdsAtGeneration) {
      const allyIdSet = new Set(plan.livingAllyIdsAtGeneration);
      const allyDied = combatants.some(c => allyIdSet.has(c.id) && c.hpCurrent <= 0);
      if (allyDied) return true;
    }

    // ── 3. Significant HP loss (any ally lost > 25 % of their max HP) ────────
    if (plan.allyHpAtGeneration) {
      const combatantById = new Map(combatants.map(c => [c.id, c]));
      for (const [id, hpAtGen] of Object.entries(plan.allyHpAtGeneration)) {
        const current = combatantById.get(id);
        if (!current) continue; // combatant may have been removed already
        const hpLost = hpAtGen - current.hpCurrent;
        if (hpLost > REPLAN_HP_LOSS_THRESHOLD * current.hpMax) return true;
      }
    }

    // ── 4. New threat entered combat (reinforcements) ────────────────────────
    if (plan.livingAllyIdsAtGeneration && plan.livingEnemyIdsAtGeneration) {
      const knownIds = new Set([
        ...plan.livingAllyIdsAtGeneration,
        ...plan.livingEnemyIdsAtGeneration,
      ]);
      const newThreat = combatants.some(c => c.hpCurrent > 0 && !knownIds.has(c.id));
      if (newThreat) return true;
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
