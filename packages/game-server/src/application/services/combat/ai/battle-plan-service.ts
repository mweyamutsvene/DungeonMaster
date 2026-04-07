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
import { getResourcePools } from "../helpers/resource-utils.js";

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
      /** AI-H6: Known abilities/resources extracted from enemy combatant state. */
      abilities?: string[];
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

/** Map resource pool names to human-readable ability names for the battle planner. */
const POOL_NAME_MAP: Record<string, string> = {
  ki: "Ki",
  rage: "Rage",
  actionSurge: "Action Surge",
  secondWind: "Second Wind",
  layOnHands: "Lay on Hands",
  channelDivinity: "Channel Divinity",
  bardicInspiration: "Bardic Inspiration",
  wholenessOfBody: "Wholeness of Body",
};

function extractAbilitiesFromResources(c: CombatantStateRecord): string[] {
  const res = c.resources as Record<string, unknown> | undefined;
  if (!res) return [];

  const abilities: string[] = [];

  // 1. Named abilities from resource pools (ki, rage, action surge, etc.)
  const pools = getResourcePools(c.resources);
  for (const pool of pools) {
    if (pool.current <= 0) continue;
    const friendly = POOL_NAME_MAP[pool.name];
    if (friendly) {
      abilities.push(friendly);
    } else if (pool.name.startsWith("spellSlot_")) {
      // Spell slots → "Spell Slots (level N)"
      const level = pool.name.replace("spellSlot_", "");
      abilities.push(`Spell Slots (level ${level})`);
    }
  }

  // 2. Prepared spell flags
  if (res.hasShieldPrepared === true) abilities.push("Shield (spell)");
  if (res.hasCounterspellPrepared === true) abilities.push("Counterspell");
  if (res.hasAbsorbElementsPrepared === true) abilities.push("Absorb Elements");
  if (res.hasHellishRebukePrepared === true) abilities.push("Hellish Rebuke");

  // 3. Legendary actions
  if (Array.isArray(res.legendaryActions) && res.legendaryActions.length > 0) {
    abilities.push("Legendary Actions");
  }

  return abilities;
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
    const faction = await this.factionService.getFaction(combatant);
    if (!faction) return null;

    // Load existing plan
    const raw = await this.combatRepo.getBattlePlan(encounterId, faction);
    const existingPlan = raw as BattlePlan | null;

    // Check if we need to re-plan
    if (existingPlan && !this.shouldReplan(existingPlan, encounter, allCombatants)) {
      return existingPlan;
    }

    // Gather faction context (shared by both LLM and deterministic paths)
    const allies = await this.factionService.getAllies(allCombatants, combatant);
    const enemies = await this.factionService.getEnemies(allCombatants, combatant);
    const nameMap = await this.combatantResolver.getNames([...allies, combatant, ...enemies]);

    const factionCreatures = [combatant, ...allies.filter(a => a.id !== combatant.id)]
      .filter(c => c.hpCurrent > 0)
      .map(c => {
        const res = c.resources as Record<string, unknown> | undefined;
        const abilities = extractAbilitiesFromResources(c);
        return {
          name: nameMap.get(c.id) || "Unknown",
          hp: { current: c.hpCurrent, max: c.hpMax },
          ac: res?.armorClass as number | undefined,
          speed: res?.speed as number | undefined,
          position: res?.position as { x: number; y: number } | undefined,
          ...(abilities.length > 0 ? { abilities } : {}),
        };
      });

    const enemyList = enemies
      .filter(e => e.hpCurrent > 0)
      .map(e => {
        // AI-H6: Extract enemy abilities from resource pools so the LLM planner
        // knows what abilities BOTH sides have (not just faction creatures).
        const enemyAbilities = extractAbilitiesFromResources(e);
        return {
          name: nameMap.get(e.id) || "Unknown",
          hp: { current: e.hpCurrent, max: e.hpMax },
          ac: (e.resources as Record<string, unknown>)?.armorClass as number | undefined,
          speed: (e.resources as Record<string, unknown>)?.speed as number | undefined,
          position: (e.resources as Record<string, unknown>)?.position as { x: number; y: number } | undefined,
          conditions: e.conditions as string[] | undefined,
          ...(enemyAbilities.length > 0 ? { abilities: enemyAbilities } : {}),
        };
      });

    // Try LLM planner first, fall back to deterministic
    let newPlan: BattlePlan | null = null;
    if (this.planner) {
      newPlan = await this.planner.generatePlan({
        faction,
        factionCreatures,
        enemies: enemyList,
        round: encounter.round,
      });
    }

    // Deterministic fallback when LLM is unavailable or returns null
    if (!newPlan) {
      newPlan = this.buildDeterministicPlan(
        faction, encounter.round, combatant, factionCreatures, enemyList, nameMap,
      );
    }

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

    return null;
  }

  /**
   * Build a simple deterministic battle plan when LLM is unavailable.
   *
   * Heuristics:
   * - Priority: offensive unless faction HP ratio is below 25%
   * - Focus target: lowest-HP living enemy
   * - Retreat: below 25% HP
   */
  private buildDeterministicPlan(
    faction: string,
    round: number,
    combatant: CombatantStateRecord,
    factionCreatures: Array<{ name: string; hp: { current: number; max: number } }>,
    enemies: Array<{ name: string; hp: { current: number; max: number } }>,
    nameMap: Map<string, string>,
  ): BattlePlan {
    // AI-M2: Determine priority using 3-tier HP ratio
    // - Below 30% HP: defensive (conserve resources, protect remaining members)
    // - 30-70% HP: tactical (balanced attack/defense based on battlefield)
    // - Above 70% HP: offensive (press the attack)
    const factionTotalCurrent = factionCreatures.reduce((sum, c) => sum + c.hp.current, 0);
    const factionTotalMax = factionCreatures.reduce((sum, c) => sum + c.hp.max, 0);
    const factionHpRatio = factionTotalMax > 0 ? factionTotalCurrent / factionTotalMax : 0;
    const priority: BattlePlan["priority"] =
      factionHpRatio < 0.30 ? "defensive"
      : factionHpRatio < 0.70 ? "offensive" // "tactical" not in the BattlePlan type; use offensive as default mid-tier
      : "offensive";

    // Focus target: lowest-HP living enemy
    const livingEnemies = enemies.filter(e => e.hp.current > 0);
    let focusTarget: string | undefined;
    if (livingEnemies.length > 0) {
      const lowestHp = livingEnemies.reduce((prev, curr) =>
        curr.hp.current < prev.hp.current ? curr : prev,
      );
      focusTarget = lowestHp.name;
    }

    // Assign simple roles to each creature
    const creatureRoles: Record<string, string> = {};
    for (const c of factionCreatures) {
      creatureRoles[c.name] = "Attack the nearest enemy";
    }

    return {
      faction,
      generatedAtRound: round,
      priority,
      focusTarget,
      creatureRoles,
      tacticalNotes: focusTarget
        ? `Focus fire on ${focusTarget}. Engage nearest enemy if target is unreachable.`
        : "Engage the nearest enemy.",
      retreatCondition: "Below 25% HP and outnumbered",
    };
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
