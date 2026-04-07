/**
 * TacticalViewService - Builds tactical combat views and LLM context for combat queries.
 *
 * This service extracts the tactical view computation and combat query context building
 * that was previously embedded in route handlers.
 */

import type { ICharacterRepository } from "../../repositories/character-repository.js";
import type { IMonsterRepository } from "../../repositories/monster-repository.js";
import type { INPCRepository } from "../../repositories/npc-repository.js";
import type { ICombatRepository } from "../../repositories/combat-repository.js";
import type { CombatService } from "./combat-service.js";
import { calculateDistance, crossesThroughReach } from "../../../domain/rules/movement.js";
import { getMapZones } from "../../../domain/rules/combat-map.js";
import type { CombatMap } from "../../../domain/rules/combat-map.js";
import { getGroundItems, getGroundItemsNearPosition } from "../../../domain/rules/combat-map.js";
import {
  getPosition,
  getResourcePools,
  normalizeResources,
  readBoolean,
  getEffectiveSpeed,
} from "./helpers/resource-utils.js";
import { ClassFeatureResolver } from "../../../domain/entities/classes/class-feature-resolver.js";
import { readConditionNames } from "../../../domain/entities/combat/conditions.js";
import { checkFlanking } from "../../../domain/rules/flanking.js";

export interface TacticalCombatant {
  id: string;
  name: string;
  combatantType: "Character" | "Monster" | "NPC";
  hp: { current: number; max: number };
  conditions: string[];
  deathSaves?: { successes: number; failures: number };
  position: { x: number; y: number } | null;
  distanceFromActive: number | null;
  actionEconomy: {
    actionAvailable: boolean;
    bonusActionAvailable: boolean;
    reactionAvailable: boolean;
    movementRemainingFeet: number;
  };
  resourcePools: Array<{ name: string; current: number; max: number }>;
  movement: {
    speed: number;
    dashed: boolean;
    movementSpent: boolean;
  };
  turnFlags: {
    actionSpent: boolean;
    bonusActionUsed: boolean;
    reactionUsed: boolean;
    disengaged: boolean;
  };
  /** IDs of enemies this combatant is currently flanking (only populated when flankingEnabled) */
  flankingTargets?: string[];
}

export interface TacticalView {
  encounterId: string;
  status: string;
  activeCombatantId: string;
  combatants: TacticalCombatant[];
  pendingAction?: { type: string; actorId?: string };
  map: unknown | null;
  /** Last move path for the active combatant (cleared on turn change). Rich clients can use this for animated tokens, trail rendering, and cost overlays. */
  lastMovePath?: {
    combatantId: string;
    cells: Array<{ x: number; y: number; terrain: string; stepCostFeet: number; cumulativeCostFeet: number }>;
    costFeet: number;
  } | null;
  /** Active combat zones on the battlefield (area effects, auras, etc.). */
  zones?: Array<{
    id: string;
    type: string;
    center: { x: number; y: number };
    radiusFeet: number;
    shape: string;
    source: string;
    sourceCombatantId?: string;
    roundsRemaining?: number;
    effects: Array<{ trigger: string; damageType?: string; damage?: unknown }>;
  }>;
  /** Items on the ground that can be picked up. */
  groundItems?: Array<{
    id: string;
    name: string;
    position: { x: number; y: number };
    distanceFromActive: number | null;
  }>;
  /** Whether the optional flanking rule is active for this encounter */
  flankingEnabled?: boolean;
}

export interface CombatQueryContext {
  actor: {
    id: string;
    name: string;
    character: { id: string; name: string; className: string | null; level: number } | null;
    capabilities: { classFeatures: ReadonlyArray<{ name: string; economy: string; cost?: string; requires?: string; effect: string }> };
    attackOptions: Array<{ name: string; kind: string; reachFeet: number; attackBonus: number; damageFormula: string }>;
    position: { x: number; y: number };
    speed: number;
    movementRemainingFeet: number;
    resources: { resourcePools: Array<{ name: string; current: number; max: number }> };
    sheet: unknown | null;
  };
  encounter: {
    id: string;
    round: number;
    turn: number;
    activeCombatantId: string | null;
  };
  distances: Array<{ targetId: string; targetName: string; distance: number; position: { x: number; y: number } | null; combatantType: string }>;
  oaPrediction: {
    destination: { x: number; y: number } | null;
    movementRequiredFeet: number | null;
    oaRisks: Array<{ combatantId: string; combatantName: string; reach: number; hasReaction: boolean; wouldProvoke: boolean }>;
  };
  nearbyItems?: Array<{ id: string; name: string; distance: number; position: { x: number; y: number } }>;
}

export interface TacticalViewServiceDeps {
  combat: CombatService;
  characters: ICharacterRepository;
  monsters: IMonsterRepository;
  npcs: INPCRepository;
  combatRepo: ICombatRepository;
}

export class TacticalViewService {
  constructor(private readonly deps: TacticalViewServiceDeps) {}

  /**
   * Build tactical view for an encounter.
   */
  async getTacticalView(sessionId: string, encounterId: string): Promise<TacticalView> {
    const { encounter, combatants, activeCombatant } = await this.deps.combat.getEncounterState(sessionId, {
      encounterId,
    });

    const characters = await this.deps.characters.listBySession(sessionId);
    const monsters = await this.deps.monsters.listBySession(sessionId);
    const npcs = await this.deps.npcs.listBySession(sessionId);

    const characterById = new Map(characters.map((c) => [c.id, c] as const));

    const activeResourcesRaw = (activeCombatant as any)?.resources ?? {};
    const activePos = getPosition(activeResourcesRaw);

    const nameFor = (c: any): string => {
      if (c.combatantType === "Character" && c.characterId) {
        return characters.find((x) => x.id === c.characterId)?.name ?? c.characterId;
      }
      if (c.combatantType === "Monster" && c.monsterId) {
        return monsters.find((x) => x.id === c.monsterId)?.name ?? c.monsterId;
      }
      if (c.combatantType === "NPC" && c.npcId) {
        return npcs.find((x) => x.id === c.npcId)?.name ?? c.npcId;
      }
      return c.id;
    };

    const tacticalCombatants: TacticalCombatant[] = (combatants as any[]).map((c) => {
      const resourcesRaw = c.resources ?? {};
      const resources = normalizeResources(resourcesRaw);
      const pos = getPosition(resourcesRaw);
      const distanceFromActive = activePos && pos ? calculateDistance(activePos, pos) : null;

      const sheetPools =
        c.combatantType === "Character" && c.characterId
          ? this.deriveResourcePoolsFromSheet(characterById.get(c.characterId)?.sheet)
          : [];
      const storedPools = getResourcePools(resourcesRaw);
      const resourcePools = this.mergePools(sheetPools, storedPools);

      const actionEconomy = this.parseActionEconomy(resourcesRaw);

      const conditions: string[] = readConditionNames(c.conditions);
      const deathSaves = (resources as any).deathSaves as { successes: number; failures: number } | undefined;

      return {
        id: c.id,
        name: nameFor(c),
        combatantType: c.combatantType,
        hp: { current: c.hpCurrent, max: c.hpMax },
        conditions,
        ...(deathSaves ? { deathSaves } : {}),
        position: pos ?? null,
        distanceFromActive,
        actionEconomy,
        resourcePools,
        movement: {
          speed: getEffectiveSpeed(c.resources),
          dashed: readBoolean(resources, "dashed") ?? false,
          movementSpent: readBoolean(resources, "movementSpent") ?? false,
        },
        turnFlags: {
          actionSpent: readBoolean(resources, "actionSpent") ?? false,
          bonusActionUsed:
            (readBoolean(resources, "bonusActionUsed") ?? false) ||
            (readBoolean(resources, "bonusActionSpent") ?? false),
          reactionUsed:
            (readBoolean(resources, "reactionUsed") ?? false) ||
            (readBoolean(resources, "reactionSpent") ?? false),
          disengaged: readBoolean(resources, "disengaged") ?? false,
        },
      };
    });

    // Get pending action info
    let pendingAction: { type: string; actorId?: string } | undefined;
    try {
      const pa = await this.deps.combatRepo.getPendingAction(encounterId);
      if (pa) {
        pendingAction = { type: (pa as any).type, actorId: (pa as any).actorId };
      }
    } catch { /* no pending action */ }

    // Extract lastMovePath from the active combatant's resources (if present)
    let lastMovePath: TacticalView["lastMovePath"] = null;
    if (activeCombatant) {
      const activeRes = (activeCombatant as any)?.resources ?? {};
      const storedPath = activeRes.lastMovePath;
      if (storedPath && Array.isArray(storedPath.cells) && storedPath.cells.length > 0) {
        lastMovePath = {
          combatantId: (activeCombatant as any).id,
          cells: storedPath.cells,
          costFeet: typeof storedPath.costFeet === "number" ? storedPath.costFeet : 0,
        };
      }
    }

    // Extract zones from map data
    const mapData = (encounter as any).mapData;
    const zoneList = mapData ? getMapZones(mapData as CombatMap) : [];
    const zones = zoneList.length > 0
      ? zoneList.map((z) => ({
          id: z.id,
          type: z.type,
          center: z.center,
          radiusFeet: z.radiusFeet,
          shape: z.shape,
          source: z.source,
          sourceCombatantId: z.sourceCombatantId,
          roundsRemaining: z.roundsRemaining,
          effects: z.effects.map((e) => ({
            trigger: e.trigger,
            damageType: e.damageType,
            damage: e.damage,
          })),
        }))
      : undefined;

    // Extract ground items from map data
    const groundItemsList = mapData ? getGroundItems(mapData as CombatMap) : [];
    const groundItems = groundItemsList.length > 0
      ? groundItemsList.map((gi) => ({
          id: gi.id,
          name: gi.name,
          position: gi.position,
          distanceFromActive: activePos ? calculateDistance(activePos, gi.position) : null,
        }))
      : undefined;

    // Flanking computation
    const flankingEnabled = !!(mapData as unknown as CombatMap | undefined)?.flankingEnabled;
    if (flankingEnabled) {
      // Build faction map for each combatant
      const factionOf = (c: any): string => {
        if (c.character?.faction) return c.character.faction;
        if (c.monster?.faction) return c.monster.faction;
        if (c.npc?.faction) return c.npc.faction;
        const rf = (c.resources ?? {}).faction;
        if (typeof rf === "string") return rf;
        if (c.combatantType === "Character" || c.combatantType === "NPC") return "party";
        return "enemies";
      };
      const combatantArray = combatants as any[];
      for (const tc of tacticalCombatants) {
        if (!tc.position || tc.hp.current <= 0) continue;
        const rawCombatant = combatantArray.find((c: any) => c.id === tc.id);
        if (!rawCombatant) continue;
        const myFaction = factionOf(rawCombatant);
        const targets: string[] = [];
        // Check each enemy for flanking
        for (const enemy of combatantArray) {
          if (enemy.id === tc.id) continue;
          if (enemy.hpCurrent <= 0) continue;
          if (factionOf(enemy) === myFaction) continue;
          const enemyPos = getPosition(enemy.resources ?? {});
          if (!enemyPos) continue;
          // Gather ally positions
          const allyPositions: Array<{ x: number; y: number }> = [];
          for (const ally of combatantArray) {
            if (ally.id === tc.id || ally.id === enemy.id) continue;
            if (ally.hpCurrent <= 0) continue;
            if (factionOf(ally) !== myFaction) continue;
            const aPos = getPosition(ally.resources ?? {});
            if (aPos) allyPositions.push(aPos);
          }
          if (checkFlanking(tc.position, enemyPos, allyPositions)) {
            targets.push(enemy.id);
          }
        }
        if (targets.length > 0) tc.flankingTargets = targets;
      }
    }

    return {
      encounterId: encounter.id,
      status: (encounter as any).status ?? "Active",
      activeCombatantId: (activeCombatant as any)?.id ?? "",
      combatants: tacticalCombatants,
      pendingAction,
      map: (encounter as any).mapData ?? null,
      lastMovePath,
      zones,
      groundItems,
      ...(flankingEnabled ? { flankingEnabled } : {}),
    };
  }

  /**
   * Build context for LLM combat queries.
   */
  async buildCombatQueryContext(
    sessionId: string,
    encounterId: string,
    actorCharacterId: string,
    query: string,
  ): Promise<CombatQueryContext> {
    const { encounter, combatants, activeCombatant } = await this.deps.combat.getEncounterState(sessionId, {
      encounterId,
    });

    const characters = await this.deps.characters.listBySession(sessionId);
    const monsters = await this.deps.monsters.listBySession(sessionId);
    const npcs = await this.deps.npcs.listBySession(sessionId);

    const characterById = new Map(characters.map((c) => [c.id, c] as const));
    const monsterById = new Map(monsters.map((m) => [m.id, m] as const));
    const npcById = new Map(npcs.map((n) => [n.id, n] as const));

    const nameFor = (c: any): string => {
      if (c.combatantType === "Character" && c.characterId) {
        return characterById.get(c.characterId)?.name ?? c.characterId;
      }
      if (c.combatantType === "Monster" && c.monsterId) {
        return monsterById.get(c.monsterId)?.name ?? c.monsterId;
      }
      if (c.combatantType === "NPC" && c.npcId) {
        return npcById.get(c.npcId)?.name ?? c.npcId;
      }
      return c.id;
    };

    const actorCombatant = (combatants as any[]).find(
      (c) => c.combatantType === "Character" && c.characterId === actorCharacterId,
    );
    if (!actorCombatant) {
      throw new Error("actorId not found in encounter");
    }

    const actorResourcesRaw = actorCombatant.resources ?? {};
    const actorResources = normalizeResources(actorResourcesRaw);
    const actorPos = getPosition(actorResourcesRaw);
    if (!actorPos) {
      throw new Error("actor does not have a position set");
    }

    const actorSpeed = getEffectiveSpeed(actorCombatant.resources);
    const actorDashed = readBoolean(actorResources, "dashed") ?? false;
    const actorMovementSpent = readBoolean(actorResources, "movementSpent") ?? false;
    const actorMovementRemainingRaw = (actorResources as any).movementRemaining;
    const actorMovementRemainingFeet =
      typeof actorMovementRemainingRaw === "number"
        ? actorMovementRemainingRaw
        : actorMovementSpent
          ? 0
          : actorDashed
            ? actorSpeed * 2
            : actorSpeed;

    // Calculate distances to all other combatants
    const distances = (combatants as any[])
      .filter((c) => c.id !== actorCombatant.id)
      .map((c) => {
        const pos = getPosition(c.resources ?? {});
        const distance = pos ? calculateDistance(actorPos, pos) : null;
        return {
          targetId: c.id,
          targetName: nameFor(c),
          combatantType: c.combatantType,
          position: pos,
          distance,
        };
      })
      .filter((d) => d.distance !== null)
      .sort((a, b) => (a.distance as number) - (b.distance as number))
      .map((d) => ({
        targetId: d.targetId,
        targetName: d.targetName,
        distance: d.distance as number,
        position: d.position,
        combatantType: d.combatantType,
      }));

    // OA prediction based on query
    const { destination, movementRequiredFeet, oaRisks } = this.predictOpportunityAttacks(
      query,
      actorPos,
      actorCombatant,
      combatants as any[],
      nameFor,
    );

    // Build actor info
    const actorChar = characterById.get(actorCharacterId);
    const actorSheet = (actorChar?.sheet ?? {}) as any;
    const actorLevel = ClassFeatureResolver.getLevel(actorSheet, actorChar?.level);
    const actorClassName = typeof actorChar?.className === "string" ? actorChar.className : null;

    const unarmedStats = ClassFeatureResolver.getUnarmedStrikeStats(actorSheet, actorClassName, actorLevel);
    const classCapabilities = ClassFeatureResolver.getClassCapabilities(actorSheet, actorClassName, actorLevel);

    return {
      actor: {
        id: actorCombatant.id,
        name: nameFor(actorCombatant),
        character: actorChar
          ? {
              id: actorCharacterId,
              name: actorChar.name,
              className: actorChar.className ?? null,
              level: actorChar.level,
            }
          : null,
        capabilities: {
          classFeatures: classCapabilities,
        },
        attackOptions: [
          {
            name: "Unarmed Strike",
            kind: "melee",
            reachFeet: 5,
            attackBonus: unarmedStats.attackBonus,
            damageFormula: unarmedStats.damageFormula,
          },
        ],
        position: actorPos,
        speed: actorSpeed,
        movementRemainingFeet: actorMovementRemainingFeet,
        resources: {
          resourcePools: getResourcePools(actorResourcesRaw),
        },
        sheet: actorChar?.sheet ?? null,
      },
      encounter: {
        id: encounter.id,
        round: encounter.round,
        turn: encounter.turn,
        activeCombatantId: (activeCombatant as any)?.id ?? null,
      },
      distances,
      oaPrediction: {
        destination,
        movementRequiredFeet,
        oaRisks,
      },
      ...((() => {
        const mapDataForItems = (encounter as any).mapData as CombatMap | undefined;
        if (!mapDataForItems) return {};
        const nearby = getGroundItemsNearPosition(mapDataForItems, actorPos, 30);
        if (nearby.length === 0) return {};
        return {
          nearbyItems: nearby.map(gi => ({
            id: gi.id,
            name: gi.name,
            distance: calculateDistance(actorPos, gi.position),
            position: gi.position,
          })).sort((a, b) => a.distance - b.distance),
        };
      })()),
    };
  }

  // ----- Private helpers -----

  private isRecord(x: unknown): x is Record<string, unknown> {
    return typeof x === "object" && x !== null;
  }

  private deriveResourcePoolsFromSheet(sheet: unknown): Array<{ name: string; current: number; max: number }> {
    if (!this.isRecord(sheet)) return [];

    const out: Array<{ name: string; current: number; max: number }> = [];

    const kiPoints = (sheet as any).kiPoints;
    if (typeof kiPoints === "number" && Number.isFinite(kiPoints)) {
      out.push({ name: "Ki", current: kiPoints, max: kiPoints });
    }

    const spellSlots = (sheet as any).spellSlots;
    if (this.isRecord(spellSlots)) {
      for (const [levelKey, raw] of Object.entries(spellSlots)) {
        const poolName = `spellSlots${levelKey}`;
        if (typeof raw === "number" && Number.isFinite(raw)) {
          out.push({ name: poolName, current: raw, max: raw });
          continue;
        }
        if (this.isRecord(raw) && typeof (raw as any).current === "number" && typeof (raw as any).max === "number") {
          out.push({ name: poolName, current: (raw as any).current, max: (raw as any).max });
        }
      }
    }

    return out;
  }

  private mergePools(
    fromSheet: Array<{ name: string; current: number; max: number }>,
    fromResources: Array<{ name: string; current: number; max: number }>,
  ): Array<{ name: string; current: number; max: number }> {
    const byName = new Map<string, { name: string; current: number; max: number }>();
    for (const p of fromSheet) byName.set(p.name, p);
    for (const p of fromResources) byName.set(p.name, p);
    return Array.from(byName.values());
  }

  private parseActionEconomy(resourcesRaw: unknown): {
    actionAvailable: boolean;
    bonusActionAvailable: boolean;
    reactionAvailable: boolean;
    movementRemainingFeet: number;
    attacksUsed: number;
    attacksAllowed: number;
  } {
    const resources = normalizeResources(resourcesRaw);

    const actionSpent = readBoolean(resources, "actionSpent") ?? false;
    const bonusActionUsed =
      (readBoolean(resources, "bonusActionUsed") ?? false) ||
      (readBoolean(resources, "bonusActionSpent") ?? false);
    const reactionUsed =
      (readBoolean(resources, "reactionUsed") ?? false) ||
      (readBoolean(resources, "reactionSpent") ?? false);

    const movementSpent = readBoolean(resources, "movementSpent") ?? false;
    const dashed = readBoolean(resources, "dashed") ?? false;

    const speed = getEffectiveSpeed(resourcesRaw);
    const effectiveSpeed = dashed ? speed * 2 : speed;
    const movementRemainingRaw = (resources as any).movementRemaining;
    const movementRemainingFeet =
      typeof movementRemainingRaw === "number"
        ? movementRemainingRaw
        : movementSpent
          ? 0
          : effectiveSpeed;

    // Parse attack tracking for Extra Attack / Action Surge visibility
    const attacksUsed = typeof (resources as any).attacksUsedThisTurn === "number"
      ? (resources as any).attacksUsedThisTurn
      : 0;
    const attacksAllowed = typeof (resources as any).attacksAllowedThisTurn === "number"
      ? (resources as any).attacksAllowedThisTurn
      : 1;

    return {
      actionAvailable: !actionSpent,
      bonusActionAvailable: !bonusActionUsed,
      reactionAvailable: !reactionUsed,
      movementRemainingFeet,
      attacksUsed,
      attacksAllowed,
    };
  }

  private predictOpportunityAttacks(
    query: string,
    actorPos: { x: number; y: number },
    actorCombatant: any,
    combatants: any[],
    nameFor: (c: any) => string,
  ): {
    destination: { x: number; y: number } | null;
    movementRequiredFeet: number | null;
    oaRisks: Array<{ combatantId: string; combatantName: string; reach: number; hasReaction: boolean; wouldProvoke: boolean }>;
  } {
    // Parse destination from query
    const coordMatch = query.match(/\((\s*-?\d+(?:\.\d+)?\s*),\s*(-?\d+(?:\.\d+)?\s*)\)/);
    const destinationFromQuery = coordMatch
      ? { x: Number(coordMatch[1]), y: Number(coordMatch[2]) }
      : null;

    const findTargetByName = (q: string): any | null => {
      const qLower = q.toLowerCase();
      for (const c of combatants) {
        if (c.id === actorCombatant.id) continue;
        const n = nameFor(c).toLowerCase();
        if (n && qLower.includes(n)) return c;
      }
      return null;
    };

    const targetCombatant = destinationFromQuery ? null : findTargetByName(query);
    const destination = destinationFromQuery
      ? destinationFromQuery
      : targetCombatant
        ? getPosition(targetCombatant.resources ?? {})
        : null;

    const oaRisks: Array<{
      combatantId: string;
      combatantName: string;
      reach: number;
      hasReaction: boolean;
      wouldProvoke: boolean;
    }> = [];

    let movementRequiredFeet: number | null = null;
    if (destination) {
      movementRequiredFeet = calculateDistance(actorPos, destination);

      for (const other of combatants) {
        if (other.id === actorCombatant.id) continue;
        if (other.hpCurrent <= 0) continue;

        const otherResources = normalizeResources(other.resources ?? {});
        const otherPos = getPosition(other.resources ?? {});
        if (!otherPos) continue;

        const reachValue = otherResources.reach;
        const reach = typeof reachValue === "number" ? reachValue : 5;

        const wouldProvoke = crossesThroughReach({ from: actorPos, to: destination }, otherPos, reach);

        const reactionUsed =
          (readBoolean(otherResources, "reactionUsed") ?? false) ||
          (readBoolean(otherResources, "reactionSpent") ?? false);
        const hasReaction = !reactionUsed;

        oaRisks.push({
          combatantId: other.id,
          combatantName: nameFor(other),
          reach,
          hasReaction,
          wouldProvoke,
        });
      }
    }

    return { destination, movementRequiredFeet, oaRisks };
  }
}
