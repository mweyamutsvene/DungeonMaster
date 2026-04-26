/**
 * Session Combat Routes
 *
 * Handles core combat flow (start, next turn, state).
 *
 * Endpoints:
 * - POST /sessions/:id/combat/start - Start a combat encounter
 * - POST /sessions/:id/combat/next - Advance to next turn
 * - GET /sessions/:id/combat - Get current encounter state
 * - GET /sessions/:id/combat/:encounterId/combatants - List combatants
 * - PATCH /sessions/:id/combat/terrain - Set terrain zones on the combat map
 * - PATCH /sessions/:id/combat/surprise - Set surprise state on encounter (DM override)
 * - PATCH /sessions/:id/combat/ground-items - Place items on the battlefield
 */

import type { FastifyInstance } from "fastify";
import type { SessionRouteDeps } from "./types.js";
import { setTerrainAt, addGroundItem, type CombatMap, type TerrainType } from "../../../../domain/rules/combat-map.js";
import type { GroundItem } from "../../../../domain/entities/items/ground-item.js";
import { normalizeConditions, getExhaustionLevel, isExhaustionLethal } from "../../../../domain/entities/combat/conditions.js";
import { isConcentrationBreakingCondition } from "../../../../domain/rules/concentration.js";
import { ValidationError } from "../../../../application/errors.js";
import { breakConcentration, getConcentrationSpellName } from "../../../../application/services/combat/helpers/concentration-helper.js";
import type { JsonValue } from "../../../../application/types.js";
import { nanoid } from "nanoid";

function isAliveForCombatResolution(combatant: { combatantType: string; hpCurrent: number; resources: unknown }): boolean {
  if (combatant.hpCurrent > 0) return true;
  if (combatant.combatantType !== "Character") return false;
  const resources = (combatant.resources ?? {}) as Record<string, unknown>;
  const deathSaves = resources.deathSaves as { failures?: number } | undefined;
  if (!deathSaves) return true;
  return (deathSaves.failures ?? 0) < 3;
}

export function registerSessionCombatRoutes(app: FastifyInstance, deps: SessionRouteDeps): void {
  /**
   * POST /sessions/:id/combat/start
   * Start a new combat encounter with specified combatants.
   */
  app.post<{
    Params: { id: string };
    Body: {
      combatants: Array<{
        combatantType: "Character" | "Monster" | "NPC";
        characterId?: string;
        monsterId?: string;
        npcId?: string;
        initiative?: number | null;
        hpCurrent: number;
        hpMax: number;
        conditions?: unknown;
        resources?: unknown;
      }>;
    };
  }>("/sessions/:id/combat/start", async (req) => {
    const sessionId = req.params.id;

    const input = { combatants: req.body.combatants };

    // Sweep expired items (e.g. Goodberry berries whose longRestsRemaining === 0)
    // from all participating characters' sheets BEFORE the encounter is built,
    // so combatant.resources.inventory reflects the cleaned state.
    const characterIds = input.combatants
      .filter((c) => c.combatantType === "Character" && c.characterId)
      .map((c) => c.characterId as string);
    if (characterIds.length > 0) {
      await deps.inventoryService.sweepExpiredItems(sessionId, characterIds);
    }

    if (deps.unitOfWork) {
      return deps.unitOfWork.run(async (repos) => {
        const services = deps.createServicesForRepos(repos);
        return services.combat.startEncounter(sessionId, input);
      });
    }

    return deps.combat.startEncounter(sessionId, input);
  });

  /**
   * POST /sessions/:id/combat/next
   * Advance to the next turn in the current encounter.
   */
  app.post<{
    Params: { id: string };
    Body: { encounterId?: string };
  }>("/sessions/:id/combat/next", async (req) => {
    const sessionId = req.params.id;
    const input = { encounterId: req.body?.encounterId };

    if (deps.unitOfWork) {
      return deps.unitOfWork.run(async (repos) => {
        const services = deps.createServicesForRepos(repos);
        return services.combat.nextTurn(sessionId, input);
      });
    }

    return deps.combat.nextTurn(sessionId, input);
  });

  /**
   * GET /sessions/:id/combat
   * Get the current encounter state.
   */
  app.get<{
    Params: { id: string };
    Querystring: { encounterId?: string };
  }>("/sessions/:id/combat", async (req) => {
    const sessionId = req.params.id;
    const input = { encounterId: req.query.encounterId };
    return deps.combat.getEncounterState(sessionId, input);
  });

  /**
   * GET /sessions/:id/combat/:encounterId/combatants
   * List all combatants in an encounter.
   */
  app.get<{
    Params: { id: string; encounterId: string };
  }>("/sessions/:id/combat/:encounterId/combatants", async (req) => {
    const encounterId = req.params.encounterId;
    return deps.combatRepo.listCombatants(encounterId);
  });

  /**
   * PATCH /sessions/:id/combat/terrain
   * Set terrain zones on the current encounter's combat map.
   * Body: {
   *   terrainZones: Array<{
   *     x: number;
   *     y: number;
   *     terrain: TerrainType;
   *     terrainElevation?: number;
   *     terrainDepth?: number;
   *   }>
   * }
   */
  app.patch<{
    Params: { id: string };
    Body: {
      encounterId?: string;
      terrainZones: Array<{
        x: number;
        y: number;
        terrain: string;
        terrainElevation?: number;
        terrainDepth?: number;
      }>;
    };
  }>("/sessions/:id/combat/terrain", async (req) => {
    const sessionId = req.params.id;
    const { terrainZones, encounterId } = req.body;

    if (!terrainZones || !Array.isArray(terrainZones) || terrainZones.length === 0) {
      throw new ValidationError("terrainZones array is required");
    }

    // Find the encounter
    const encounters = await deps.combatRepo.listEncountersBySession(sessionId);
    const encounter = encounterId
      ? encounters.find(e => e.id === encounterId)
      : encounters.find(e => e.status === "Active") ?? encounters[0];

    if (!encounter) {
      throw new ValidationError("No encounter found for session");
    }

    // Get or create map
    let map = (encounter.mapData as unknown as CombatMap) ?? undefined;
    if (!map || !map.cells) {
      throw new ValidationError("Encounter has no combat map");
    }

    // Apply terrain zones
    for (const zone of terrainZones) {
      map = setTerrainAt(
        map,
        { x: zone.x, y: zone.y },
        zone.terrain as TerrainType,
        {
          terrainElevation: zone.terrainElevation,
          terrainDepth: zone.terrainDepth,
        },
      );
    }

    // Save updated map
    await deps.combatRepo.updateEncounter(encounter.id, { mapData: map as unknown as JsonValue });

    return { success: true, zonesApplied: terrainZones.length };
  });

  /**
   * PATCH /sessions/:id/combat/flanking
   * Toggle the optional flanking rule for the current encounter.
   * When enabled, melee attackers with an ally on the opposite side of a target gain advantage.
   * Body: { enabled: boolean, encounterId?: string }
   */
  app.patch<{
    Params: { id: string };
    Body: { encounterId?: string; enabled: boolean };
  }>("/sessions/:id/combat/flanking", async (req) => {
    const sessionId = req.params.id;
    const { enabled, encounterId } = req.body;

    if (typeof enabled !== "boolean") {
      throw new ValidationError("enabled must be a boolean");
    }

    const encounters = await deps.combatRepo.listEncountersBySession(sessionId);
    const encounter = encounterId
      ? encounters.find(e => e.id === encounterId)
      : encounters.find(e => e.status === "Active") ?? encounters[0];

    if (!encounter) {
      throw new ValidationError("No encounter found for session");
    }

    let map = (encounter.mapData ?? {}) as Record<string, unknown>;
    map = { ...map, flankingEnabled: enabled };

    await deps.combatRepo.updateEncounter(encounter.id, { mapData: map as unknown as JsonValue });

    return { success: true, flankingEnabled: enabled };
  });

  /**
   * PATCH /sessions/:id/combat/surprise
   * Set surprise state on the current encounter (DM override).
   * Creates a new "Pending" encounter if none exists for the session.
   * Body: { surprise: "enemies" | "party" | { surprised: string[] } }
   */
  app.patch<{
    Params: { id: string };
    Body: { encounterId?: string; surprise: "enemies" | "party" | { surprised: string[] } };
  }>("/sessions/:id/combat/surprise", async (req) => {
    const sessionId = req.params.id;
    const { surprise, encounterId } = req.body;

    // Validate surprise format
    if (surprise === undefined || surprise === null) {
      throw new ValidationError("surprise is required");
    }
    if (typeof surprise === "string") {
      if (surprise !== "enemies" && surprise !== "party") {
        throw new ValidationError("surprise must be 'enemies', 'party', or { surprised: string[] }");
      }
    } else if (typeof surprise === "object") {
      if (!Array.isArray((surprise as any).surprised)) {
        throw new ValidationError("surprise.surprised must be an array of creature IDs");
      }
    } else {
      throw new ValidationError("surprise must be 'enemies', 'party', or { surprised: string[] }");
    }

    // Find existing encounter or create a new Pending one
    const encounters = await deps.combatRepo.listEncountersBySession(sessionId);
    let encounter = encounterId
      ? encounters.find(e => e.id === encounterId)
      : encounters.find(e => e.status === "Active") ?? encounters.find(e => e.status === "Pending") ?? encounters[0];

    if (!encounter) {
      const { nanoid } = await import("nanoid");
      const { createCombatMap } = await import("../../../../domain/rules/combat-map.js");
      const map = createCombatMap({
        id: `${nanoid()}-map`,
        name: "Combat Arena",
        width: 100,
        height: 100,
        gridSize: 5,
      });
      encounter = await deps.combatRepo.createEncounter(sessionId, {
        id: nanoid(),
        status: "Pending",
        round: 0,
        turn: 0,
        mapData: map as unknown as JsonValue,
        surprise: surprise as unknown as JsonValue,
      });
      return { success: true, encounterId: encounter.id, surprise, created: true };
    }

    // Update existing encounter with surprise
    await deps.combatRepo.updateEncounter(encounter.id, { surprise: surprise as unknown as JsonValue });

    return { success: true, encounterId: encounter.id, surprise };
  });

  /**
   * PATCH /sessions/:id/combat/ground-items
   * Place items on the battlefield. Can be used to pre-place items or add them dynamically.
   * Body: { items: Array<{ name, position, weaponStats? }> }
   */
  app.patch<{
    Params: { id: string };
    Body: {
      encounterId?: string;
      items: Array<{
        name: string;
        position: { x: number; y: number };
        weaponStats?: {
          name: string;
          kind: "melee" | "ranged";
          range?: string;
          attackBonus: number;
          damage: { diceCount: number; diceSides: number; modifier: number };
          damageType?: string;
          properties?: string[];
        };
      }>;
    };
  }>("/sessions/:id/combat/ground-items", async (req) => {
    const sessionId = req.params.id;
    const { items, encounterId } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new ValidationError("items array is required");
    }

    const encounters = await deps.combatRepo.listEncountersBySession(sessionId);
    const encounter = encounterId
      ? encounters.find(e => e.id === encounterId)
      : encounters.find(e => e.status === "Active") ?? encounters.find(e => e.status === "Pending") ?? encounters[0];

    if (!encounter) {
      throw new ValidationError("No encounter found for session");
    }

    let map = encounter.mapData as unknown as CombatMap | undefined;
    if (!map || !map.cells) {
      throw new ValidationError("Encounter has no combat map");
    }

    for (const item of items) {
      const groundItem: GroundItem = {
        id: nanoid(),
        name: item.name,
        position: { x: item.position.x, y: item.position.y },
        source: "preplaced",
        ...(item.weaponStats ? { weaponStats: item.weaponStats } : {}),
      };
      map = addGroundItem(map, groundItem);
    }

    await deps.combatRepo.updateEncounter(encounter.id, { mapData: map as unknown as JsonValue });

    return { success: true, itemsPlaced: items.length };
  });

  /**
   * POST /sessions/:id/combat/end
   * Manually end combat with a reason (dm_end, flee, surrender).
   * Body: { encounterId?: string; reason: "dm_end" | "flee" | "surrender"; result?: "Victory" | "Defeat" | "Draw" }
   */
  app.post<{
    Params: { id: string };
    Body: {
      encounterId?: string;
      reason: "dm_end" | "flee" | "surrender";
      result?: "Victory" | "Defeat" | "Draw";
    };
  }>("/sessions/:id/combat/end", async (req) => {
    const sessionId = req.params.id;
    const { reason, result, encounterId } = req.body;

    if (!reason || !["dm_end", "flee", "surrender"].includes(reason)) {
      throw new ValidationError("reason must be 'dm_end', 'flee', or 'surrender'");
    }

    if (result && !["Victory", "Defeat", "Draw"].includes(result)) {
      throw new ValidationError("result must be 'Victory', 'Defeat', or 'Draw'");
    }

    if (deps.unitOfWork) {
      return deps.unitOfWork.run(async (repos) => {
        const services = deps.createServicesForRepos(repos);
        return services.combat.endCombat(sessionId, { encounterId, reason, result });
      });
    }

    return deps.combat.endCombat(sessionId, { encounterId, reason, result });
  });

  /**
   * PATCH /sessions/:id/combat/:encounterId/combatants/:combatantId
   * DM override: patch combatant state (conditions, HP, resources).
   * Body: { conditions?: unknown; hpCurrent?: number; resources?: unknown }
   */
  app.patch<{
    Params: { id: string; encounterId: string; combatantId: string };
    Body: {
      conditions?: unknown;
      hpCurrent?: number;
      resources?: unknown;
    };
  }>("/sessions/:id/combat/:encounterId/combatants/:combatantId", async (req) => {
    const { encounterId, combatantId } = req.params;

    // Verify the combatant exists in this encounter
    const combatants = await deps.combatRepo.listCombatants(encounterId);
    const target = combatants.find((c) => c.id === combatantId);
    if (!target) {
      throw new ValidationError(`Combatant ${combatantId} not found in encounter ${encounterId}`);
    }

    const patch: Record<string, unknown> = {};
    if (req.body.conditions !== undefined) patch.conditions = req.body.conditions;
    if (req.body.hpCurrent !== undefined) patch.hpCurrent = req.body.hpCurrent;
    if (req.body.resources !== undefined) patch.resources = req.body.resources;

    if (Object.keys(patch).length === 0) {
      throw new ValidationError("No fields to patch");
    }

    let updated = await deps.combatRepo.updateCombatantState(combatantId, patch as any);

    const normalizedConditions = normalizeConditions(updated.conditions);
    const exhaustionLevel = getExhaustionLevel(normalizedConditions);
    if (isExhaustionLethal(exhaustionLevel) && updated.hpCurrent > 0) {
      const currentResources = ((updated.resources ?? {}) as Record<string, unknown>);
      const lethalResources = updated.combatantType === "Character"
        ? {
            ...currentResources,
            deathSaves: { successes: 0, failures: 3 },
            stabilized: false,
          }
        : currentResources;
      updated = await deps.combatRepo.updateCombatantState(combatantId, {
        hpCurrent: 0,
        resources: lethalResources as JsonValue,
      });

      const combatants = await deps.combatRepo.listCombatants(encounterId);
      const partyAlive = combatants.some((combatant) =>
        (combatant.combatantType === "Character" || combatant.combatantType === "NPC")
        && isAliveForCombatResolution(combatant),
      );
      const enemyAlive = combatants.some((combatant) =>
        combatant.combatantType === "Monster" && isAliveForCombatResolution(combatant),
      );
      if (!partyAlive || !enemyAlive) {
        await deps.combatRepo.updateEncounter(encounterId, { status: "Complete" });
      }
    }

    // D&D 5e 2024: concentration ends on Incapacitated (and implied conditions)
    // and when HP drops to 0 (dying/dead). DM overrides must enforce the same rules.
    const hasConcentration = !!getConcentrationSpellName(updated.resources);
    if (hasConcentration) {
      const hasBreakingCondition = normalizeConditions(updated.conditions).some((c) =>
        isConcentrationBreakingCondition(c.condition),
      );
      const droppedToZeroHp = typeof updated.hpCurrent === "number" && updated.hpCurrent <= 0;
      if (hasBreakingCondition || droppedToZeroHp) {
        const broken = await breakConcentration(updated, encounterId, deps.combatRepo);
        if (broken) {
          const refreshed = (await deps.combatRepo.listCombatants(encounterId)).find((c) => c.id === combatantId);
          if (refreshed) return refreshed;
        }
      }
    }

    return updated;
  });
}
