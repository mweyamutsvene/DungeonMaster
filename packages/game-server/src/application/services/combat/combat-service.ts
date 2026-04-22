import { nanoid } from "nanoid";

import { NotFoundError, ValidationError } from "../../errors.js";
import type { ICombatRepository } from "../../repositories/combat-repository.js";
import type { ICharacterRepository } from "../../repositories/character-repository.js";
import type { IMonsterRepository } from "../../repositories/monster-repository.js";
import type { INPCRepository } from "../../repositories/npc-repository.js";
import type { IEventRepository } from "../../repositories/event-repository.js";
import type { IGameSessionRepository } from "../../repositories/game-session-repository.js";
import type { PendingActionRepository } from "../../repositories/pending-action-repository.js";
import type { CombatEncounterRecord, CombatantStateRecord, CombatantType, JsonValue } from "../../types.js";
import type { DiceRoller } from "../../../domain/rules/dice-roller.js";
import { createCombatMap, type CombatMap, getMapZones, setMapZones } from "../../../domain/rules/combat-map.js";
import type { Position } from "../../../domain/rules/movement.js";

import type { CombatVictoryPolicy } from "./combat-victory-policy.js";
import type { CombatantRef } from "./helpers/combatant-ref.js";
import { findCombatantIdByRef } from "./helpers/combatant-ref.js";
import { resolveEncounterOrThrow } from "./helpers/encounter-resolver.js";
import { clearActionSpent, resetTurnResources, getActiveEffects, setActiveEffects, normalizeResources, getPosition, resetLegendaryActions, isLegendaryCreature } from "./helpers/resource-utils.js";
import { findCombatantByEntityId } from "./helpers/combatant-lookup.js";
import { shouldRageEnd } from "../../../domain/entities/classes/barbarian.js";
import { parseLegendaryTraits } from "../../../domain/entities/creatures/legendary-actions.js";
import {
  shouldRemoveAtEndOfTurn,
  shouldRemoveAtStartOfTurn,
  decrementRounds,
  getEffectsByType,
  calculateBonusFromEffects,
  hasAdvantageFromEffects,
  hasDisadvantageFromEffects,
  type ActiveEffect,
} from "../../../domain/entities/combat/effects.js";
import { getAbilityModifier, getProficiencyBonus } from "../../../domain/rules/ability-checks.js";
import { isSavingThrowSuccess } from "../../../domain/rules/advantage.js";
import type { Ability } from "../../../domain/entities/core/ability-scores.js";
import { hydrateCombat, extractCombatState, extractActionEconomy } from "./helpers/combat-hydration.js";
import { hydrateCharacter, hydrateMonster, hydrateNPC } from "./helpers/creature-hydration.js";
import type { Creature } from "../../../domain/entities/creatures/creature.js";
import { makeDeathSave, applyDeathSaveResult, needsDeathSave, type DeathSaves } from "../../../domain/rules/death-saves.js";
import { normalizeConditions, removeExpiredConditions, removeCondition, type Condition } from "../../../domain/entities/combat/conditions.js";
import {
  getTriggeredZoneEffects,
  doesZoneEffectAffect,
  isPositionInZone,
  decrementZoneRounds,
  getPassiveZoneSaveBonus,
  type CombatZone,
  type ZoneEffect,
} from "../../../domain/entities/combat/zones.js";
import { applyDamageDefenses, extractDamageDefenses, type DamageDefenses } from "../../../domain/rules/damage-defenses.js";
import { applyEvasion, creatureHasEvasion } from "../../../domain/rules/evasion.js";
import { applyKoEffectsIfNeeded } from "./helpers/ko-handler.js";
import { getClassStartupEffects } from "../../../domain/rules/class-startup-effects.js";

/**
 * Combat encounter lifecycle + turn progression orchestration for a session.
 * Layer: Application.
 * Notes: Validates session/encounter invariants and persists combat state via `ICombatRepository`.
 */
export class CombatService {
  constructor(
    private readonly sessions: IGameSessionRepository,
    private readonly combat: ICombatRepository,
    private readonly victoryPolicy: CombatVictoryPolicy,
    private readonly events: IEventRepository | undefined,
    private readonly characters: ICharacterRepository,
    private readonly monsters: IMonsterRepository,
    private readonly npcs: INPCRepository,
    private readonly diceRoller: DiceRoller,
    private readonly pendingActions?: PendingActionRepository,
  ) {}

  async getEncounterState(
    sessionId: string,
    input?: { encounterId?: string },
  ): Promise<{ encounter: CombatEncounterRecord; combatants: unknown[]; activeCombatant: unknown }> {
    const encounter = await resolveEncounterOrThrow(
      this.sessions,
      this.combat,
      sessionId,
      input?.encounterId,
    );

    const combatants = await this.combat.listCombatants(encounter.id);
    if (combatants.length === 0) {
      throw new ValidationError(`Encounter has no combatants: ${encounter.id}`);
    }

    const active = combatants[encounter.turn] ?? null;
    if (!active) {
      throw new ValidationError(
        `Encounter turn index out of range: turn=${encounter.turn} combatants=${combatants.length}`,
      );
    }

    return { encounter, combatants, activeCombatant: active };
  }

  async startEncounter(
    sessionId: string,
    input: {
      encounterId?: string;
      status?: string;
      combatants: Array<{
        combatantType: CombatantType;
        characterId?: string;
        monsterId?: string;
        npcId?: string;
        initiative?: number | null;
        hpCurrent: number;
        hpMax: number;
        conditions?: JsonValue;
        resources?: JsonValue;
      }>;
      map?: {
        name?: string;
        width?: number;
        height?: number;
        gridSize?: number;
      };
    },
  ): Promise<CombatEncounterRecord> {
    const session = await this.sessions.getById(sessionId);
    if (!session) throw new NotFoundError(`Session not found: ${sessionId}`);

    if (input.combatants.length === 0) {
      throw new ValidationError("Encounter requires at least one combatant");
    }

    const encounterId = input.encounterId ?? nanoid();

    // Create combat map (always create for positioning support)
    const mapWidth = input.map?.width ?? 100;
    const mapHeight = input.map?.height ?? 100;
    const gridSize = input.map?.gridSize ?? 5;
    
    const map = createCombatMap({
      id: `${encounterId}-map`,
      name: input.map?.name ?? "Combat Arena",
      width: mapWidth,
      height: mapHeight,
      gridSize,
    });
    const mapData = map as JsonValue;

    const encounter = await this.combat.createEncounter(sessionId, {
      id: encounterId,
      status: input.status ?? "Active",
      round: 1,
      turn: 0,
      mapData,
    });

    // Determine factions for positioning + collect monster stat blocks for legendary traits
    const factionsMap = new Map<string, string>();
    const monsterStatBlocks = new Map<string, Record<string, unknown>>();
    const characterClassInfo = new Map<string, { classId: string; level: number }>();
    if (this.characters && this.monsters && this.npcs) {
      for (const c of input.combatants) {
        const cid = c.characterId;
        const mid = c.monsterId;
        const nid = c.npcId;
        
        if (c.combatantType === "Character" && cid) {
          const char = await this.characters.getById(cid);
          if (char) {
            factionsMap.set(cid, char.faction);
            const sheet = (char.sheet && typeof char.sheet === "object")
              ? (char.sheet as Record<string, unknown>)
              : {};
            const classIdRaw = sheet.classId ?? char.className;
            const classId = typeof classIdRaw === "string" ? classIdRaw.toLowerCase() : "";
            const level = typeof char.level === "number" ? char.level : 1;
            if (classId) {
              characterClassInfo.set(cid, { classId, level });
            }
          }
        } else if (c.combatantType === "Monster" && mid) {
          const mon = await this.monsters.getById(mid);
          if (mon) {
            factionsMap.set(mid, mon.faction);
            if (mon.statBlock && typeof mon.statBlock === "object") {
              monsterStatBlocks.set(mid, mon.statBlock as Record<string, unknown>);
            }
          }
        } else if (c.combatantType === "NPC" && nid) {
          const npc = await this.npcs.getById(nid);
          if (npc) factionsMap.set(nid, npc.faction);
        }
      }
    }

    // Auto-assign starting positions if not provided
    const friendlies: Array<{ index: number; ref: string }> = [];
    const hostiles: Array<{ index: number; ref: string }> = [];
    
    const firstCombatantRef = input.combatants[0]?.characterId || input.combatants[0]?.monsterId || input.combatants[0]?.npcId || '';
    const firstFaction = factionsMap.get(firstCombatantRef);
    
    input.combatants.forEach((c, i) => {
      const ref = c.characterId || c.monsterId || c.npcId || '';
      const faction = factionsMap.get(ref) || 'unknown';
      
      // Assume first faction is "friendly", rest are hostile
      if (i === 0 || faction === firstFaction) {
        friendlies.push({ index: i, ref });
      } else {
        hostiles.push({ index: i, ref });
      }
    });

    await this.combat.createCombatants(
      encounterId,
      input.combatants.map((c, combatantIndex) => {
        const id = nanoid();

        const characterId = c.combatantType === "Character" ? (c.characterId ?? null) : null;
        const monsterId = c.combatantType === "Monster" ? (c.monsterId ?? null) : null;
        const npcId = c.combatantType === "NPC" ? (c.npcId ?? null) : null;

        if (c.combatantType === "Character" && !characterId) {
          throw new ValidationError("Character combatant requires characterId");
        }
        if (c.combatantType === "Monster" && !monsterId) {
          throw new ValidationError("Monster combatant requires monsterId");
        }
        if (c.combatantType === "NPC" && !npcId) {
          throw new ValidationError("NPC combatant requires npcId");
        }

        // Assign default starting position if not provided
        let resources = normalizeResources(c.resources);
        
        if (!resources.position) {
          const friendlyIndex = friendlies.findIndex(f => f.index === combatantIndex);
          const hostileIndex = hostiles.findIndex(h => h.index === combatantIndex);
          
          let position: Position;
          if (friendlyIndex !== -1) {
            // Place friendlies on the left side in a vertical line
            const y = 10 + (friendlyIndex * 10);
            position = { x: 10, y: Math.min(y, mapHeight - 10) };
          } else {
            // Place hostiles within ~30ft of friendlies by default.
            // (The previous far-right placement made small skirmishes feel non-interactive.)
            const y = 10 + (hostileIndex * 10);
            const friendlyX = 10;
            const desiredSeparationFeet = 30;
            const hostileX = Math.min(mapWidth - 10, friendlyX + desiredSeparationFeet);
            position = { x: hostileX, y: Math.min(y, mapHeight - 10) };
          }
          resources.position = position;
        }
        
        // Set default speed if not provided (30ft for most creatures)
        if (resources.speed === undefined) {
          resources.speed = 30;
        }

        // Initialize legendary action resources from monster stat block
        if (c.combatantType === "Monster" && monsterId) {
          const statBlock = monsterStatBlocks.get(monsterId);
          if (statBlock) {
            const legendary = parseLegendaryTraits(statBlock);
            if (legendary) {
              resources.legendaryActionCharges = legendary.legendaryActionCharges;
              resources.legendaryActionsRemaining = legendary.legendaryActionCharges;
              resources.legendaryActions = legendary.legendaryActions;
              if (legendary.lairActions) {
                resources.lairActions = legendary.lairActions;
              }
              if (legendary.isInLair) {
                resources.isInLair = true;
              }
            }
          }
        }

        // Install class-level passive ActiveEffects (Barbarian L2 Danger Sense,
        // Barbarian L5 Fast Movement, Monk L2 Unarmored Movement, etc.). These
        // are always-on passives that other combat systems query via ActiveEffect
        // lookups; installing them at combat start keeps the rest of the engine
        // data-driven.
        if (c.combatantType === "Character" && characterId) {
          const classInfo = characterClassInfo.get(characterId);
          if (classInfo) {
            const startupEffects = getClassStartupEffects(classInfo);
            if (startupEffects.length > 0) {
              const existing = Array.isArray(resources.activeEffects) ? resources.activeEffects : [];
              resources.activeEffects = [...existing, ...startupEffects] as JsonValue;
            }
          }
        }

        return {
          id,
          combatantType: c.combatantType,
          characterId,
          monsterId,
          npcId,
          initiative: c.initiative ?? null,
          hpCurrent: c.hpCurrent,
          hpMax: c.hpMax,
          conditions: c.conditions ?? [],
          resources,
        };
      }),
    );

    if (this.events) {
      await this.events.append(sessionId, {
        id: nanoid(),
        type: "CombatStarted",
        payload: { encounterId },
      });
    }

    return encounter;
  }

  async addCombatantsToEncounter(
    sessionId: string,
    encounterId: string,
    combatants: Array<{
      combatantType: CombatantType;
      characterId?: string;
      monsterId?: string;
      npcId?: string;
      initiative?: number | null;
      hpCurrent: number;
      hpMax: number;
      conditions?: JsonValue;
      resources?: JsonValue;
    }>,
  ): Promise<void> {
    const session = await this.sessions.getById(sessionId);
    if (!session) throw new NotFoundError(`Session not found: ${sessionId}`);

    if (combatants.length === 0) {
      throw new ValidationError("Must provide at least one combatant");
    }

    const existingEncounter = await this.combat.getEncounterById(encounterId);
    if (!existingEncounter) throw new NotFoundError(`Encounter not found: ${encounterId}`);

    // Ensure encounter has a map for positioning.
    let mapWidth = 100;
    let mapHeight = 100;
    let gridSize = 5;

    const mapDataRaw = existingEncounter.mapData;
    if (mapDataRaw && typeof mapDataRaw === "object" && mapDataRaw !== null) {
      const md = mapDataRaw as Record<string, unknown>;
      if (typeof md.width === "number") mapWidth = md.width;
      if (typeof md.height === "number") mapHeight = md.height;
      if (typeof md.gridSize === "number") gridSize = md.gridSize;
    } else {
      const map = createCombatMap({
        id: `${encounterId}-map`,
        name: "Combat Arena",
        width: mapWidth,
        height: mapHeight,
        gridSize,
      });
      await this.combat.updateEncounter(encounterId, { mapData: map as unknown as JsonValue });
    }

    // Determine factions for positioning (if repos available).
    const factionsMap = new Map<string, string>();
    if (this.characters && this.monsters && this.npcs) {
      for (const c of combatants) {
        const cid = c.combatantType === "Character" ? c.characterId : undefined;
        const mid = c.combatantType === "Monster" ? c.monsterId : undefined;
        const nid = c.combatantType === "NPC" ? c.npcId : undefined;

        if (cid) {
          const ch = await this.characters.getById(cid);
          if (ch) factionsMap.set(cid, ch.faction);
        }
        if (mid) {
          const mo = await this.monsters.getById(mid);
          if (mo) factionsMap.set(mid, mo.faction);
        }
        if (nid) {
          const npc = await this.npcs.getById(nid);
          if (npc) factionsMap.set(nid, npc.faction);
        }
      }
    }

    // Auto-assign positions similar to startEncounter.
    const friendlies: Array<{ index: number; ref: string }> = [];
    const hostiles: Array<{ index: number; ref: string }> = [];

    const firstRef =
      combatants[0]?.characterId || combatants[0]?.monsterId || combatants[0]?.npcId || "";
    const firstFaction = factionsMap.get(firstRef);

    combatants.forEach((c, i) => {
      const ref = c.characterId || c.monsterId || c.npcId || "";
      const faction = factionsMap.get(ref) || "unknown";

      if (i === 0 || (firstFaction !== undefined && faction === firstFaction)) {
        friendlies.push({ index: i, ref });
      } else {
        hostiles.push({ index: i, ref });
      }
    });

    await this.combat.createCombatants(
      encounterId,
      combatants.map((c) => {
        const id = nanoid();
        const characterId = c.combatantType === "Character" ? (c.characterId ?? null) : null;
        const monsterId = c.combatantType === "Monster" ? (c.monsterId ?? null) : null;
        const npcId = c.combatantType === "NPC" ? (c.npcId ?? null) : null;

        if (c.combatantType === "Character" && !characterId) {
          throw new ValidationError("Character combatant requires characterId");
        }
        if (c.combatantType === "Monster" && !monsterId) {
          throw new ValidationError("Monster combatant requires monsterId");
        }
        if (c.combatantType === "NPC" && !npcId) {
          throw new ValidationError("NPC combatant requires npcId");
        }

        // Default resources, speed, and starting position.
        const resources = normalizeResources(c.resources);

        if (resources.speed === undefined) {
          resources.speed = 30;
        }

        if (!resources.position) {
          const combatantIndex = combatants.indexOf(c);
          const friendlyIndex = friendlies.findIndex((f) => f.index === combatantIndex);
          const hostileIndex = hostiles.findIndex((h) => h.index === combatantIndex);

          let position: Position;
          if (friendlyIndex !== -1) {
            const y = 10 + friendlyIndex * 10;
            position = { x: 10, y: Math.min(y, mapHeight - 10) };
          } else {
            const y = 10 + hostileIndex * 10;
            const friendlyX = 10;
            const desiredSeparationFeet = 30;
            const hostileX = Math.min(mapWidth - 10, friendlyX + desiredSeparationFeet);
            position = { x: hostileX, y: Math.min(y, mapHeight - 10) };
          }
          resources.position = position;
        }

        return {
          id,
          combatantType: c.combatantType,
          characterId,
          monsterId,
          npcId,
          initiative: c.initiative ?? null,
          hpCurrent: c.hpCurrent,
          hpMax: c.hpMax,
          conditions: c.conditions ?? [],
          resources: resources as JsonValue,
        };
      }),
    );

    // Update encounter status to Active and align round/turn defaults.
    await this.combat.updateEncounter(encounterId, { status: "Active", round: 1, turn: 0 });
  }

  /**
   * Manually end combat with a reason (dm_end, flee, surrender).
   * Sets encounter status and emits CombatEnded event.
   */
  async endCombat(
    sessionId: string,
    input: {
      encounterId?: string;
      reason: "dm_end" | "flee" | "surrender";
      result?: "Victory" | "Defeat" | "Draw";
    },
  ): Promise<CombatEncounterRecord> {
    const encounter = await resolveEncounterOrThrow(
      this.sessions,
      this.combat,
      sessionId,
      input.encounterId,
    );

    if (encounter.status !== "Active") {
      throw new ValidationError(`Encounter is not active: status=${encounter.status}`);
    }

    const status = input.result ?? "Victory";
    const updated = await this.combat.updateEncounter(encounter.id, { status });

    if (this.events) {
      await this.events.append(sessionId, {
        id: nanoid(),
        type: "CombatEnded",
        payload: { encounterId: encounter.id, result: status, reason: input.reason },
      });
    }

    return updated;
  }

  async nextTurn(
    sessionId: string,
    input?: { encounterId?: string; skipDeathSaveAutoRoll?: boolean },
  ): Promise<CombatEncounterRecord> {
    const encounter = await resolveEncounterOrThrow(
      this.sessions,
      this.combat,
      sessionId,
      input?.encounterId,
    );

    // Fire-and-forget cleanup of expired pending actions
    if (this.pendingActions) {
      this.pendingActions.cleanupExpired().catch((err) =>
        console.warn("[CombatService] cleanupExpired failed (non-critical):", err),
      );
    }

    const combatantRecords = await this.combat.listCombatants(encounter.id);
    if (combatantRecords.length === 0) {
      throw new ValidationError(`Encounter has no combatants: ${encounter.id}`);
    }

    // Evaluate victory before advancing turn
    const victoryStatus = await this.victoryPolicy.evaluate({ combatants: combatantRecords });
    if (victoryStatus) {
      const updated = await this.combat.updateEncounter(encounter.id, { status: victoryStatus });
      
      if (this.events) {
        await this.events.append(sessionId, {
          id: nanoid(),
          type: "CombatEnded",
          payload: { encounterId: encounter.id, result: victoryStatus },
        });
      }
      
      return updated;
    }

    // Hydrate creatures from records
    const creatures = await this.hydrateCreatures(combatantRecords);

    if (creatures.size === 0) {
      throw new ValidationError("Failed to hydrate any creatures for combat");
    }

    // Hydrate Combat domain instance
    const combat = hydrateCombat(encounter, combatantRecords, creatures, this.diceRoller);

    // Phase 1: End-of-turn effects for the outgoing combatant
    await this.processEndOfTurnEffects(encounter, combat, combatantRecords);

    // Phase 2: Advance turn order (domain logic + skip defeated non-characters)
    const { round, turn, updated } = await this.advanceTurnOrder(encounter, combat, combatantRecords);

    // Phase 3: Incoming combatant effects (rage end, legendary reset, action economy)
    const freshRecords = await this.combat.listCombatants(encounter.id);
    await this.processIncomingCombatantEffects(encounter, combat, freshRecords);

    // Phase 4: Start-of-turn effects for the newly active combatant
    await this.processStartOfTurnEffects(encounter, combat, combatantRecords);

    // Phase 5: Emit TurnAdvanced event
    if (this.events) {
      await this.events.append(sessionId, {
        id: nanoid(),
        type: "TurnAdvanced",
        payload: { encounterId: encounter.id, round, turn },
      });
    }

    // Phase 6: Death save auto-roll if needed
    if (!input?.skipDeathSaveAutoRoll) {
      await this.processDeathSaveIfNeeded(sessionId, encounter, combat);
    }

    return updated;
  }

  /**
   * Hydrate creatures from combatant records into a Map<combatantId, Creature>.
   */
  private async hydrateCreatures(combatantRecords: CombatantStateRecord[]): Promise<Map<string, Creature>> {
    const creatures = new Map<string, Creature>();
    for (const record of combatantRecords) {
      if (record.characterId && this.characters) {
        const char = await this.characters.getById(record.characterId);
        if (char) {
          creatures.set(record.id, hydrateCharacter(char, record));
        }
      } else if (record.monsterId && this.monsters) {
        const mon = await this.monsters.getById(record.monsterId);
        if (mon) {
          creatures.set(record.id, hydrateMonster(mon, record));
        }
      } else if (record.npcId && this.npcs) {
        const npc = await this.npcs.getById(record.npcId);
        if (npc) {
          creatures.set(record.id, hydrateNPC(npc, record));
        }
      }
    }
    return creatures;
  }

  /**
   * Phase 1: Process end-of-turn effects for the outgoing (current) combatant.
   * - Condition expiry (end_of_turn)
   * - ActiveEffect cleanup
   * - Zone triggers (Cloud of Daggers, Spirit Guardians, etc.)
   */
  private async processEndOfTurnEffects(
    encounter: CombatEncounterRecord,
    combat: ReturnType<typeof hydrateCombat>,
    combatantRecords: CombatantStateRecord[],
  ): Promise<void> {
    const outgoingCreatureId = combat.getActiveCreature().getId();
    const outgoingRecord = combatantRecords.find(c => c.id === outgoingCreatureId);
    const outgoingEntityId = outgoingRecord?.characterId ?? outgoingRecord?.monsterId ?? outgoingRecord?.npcId;
    if (!outgoingEntityId) return;

    for (const record of combatantRecords) {
      const structuredConditions = normalizeConditions(record.conditions);
      const { remaining, removed } = removeExpiredConditions(structuredConditions, "end_of_turn", outgoingEntityId);
      if (removed.length > 0) {
        await this.combat.updateCombatantState(record.id, {
          conditions: remaining as JsonValue,
        });
        console.log(`[CombatService] Removed expired conditions [${removed.join(", ")}] from combatant ${record.id} at end of ${outgoingEntityId}'s turn`);
      }
    }

    await this.processActiveEffectsAtTurnEvent(combatantRecords, "end_of_turn", outgoingEntityId, encounter);
    await this.processZoneTurnTriggers(encounter, combatantRecords, "on_end_turn", outgoingCreatureId, outgoingEntityId);
  }

  /**
   * Phase 2: Advance turn order via domain logic, skip defeated non-characters, persist.
   */
  private async advanceTurnOrder(
    encounter: CombatEncounterRecord,
    combat: ReturnType<typeof hydrateCombat>,
    combatantRecords: CombatantStateRecord[],
  ): Promise<{ round: number; turn: number; updated: CombatEncounterRecord }> {
    combat.endTurn();

    // Skip over defeated non-characters (monsters die at 0 HP; characters get death saves)
    for (let i = 0; i < combatantRecords.length; i++) {
      const activeId = combat.getActiveCreature().getId();
      const activeRecord = combatantRecords.find((c) => c.id === activeId) ?? null;
      if (!activeRecord) break;

      const isDefeated = activeRecord.hpCurrent <= 0;
      const isCharacter = Boolean(activeRecord.characterId);

      if (isDefeated && !isCharacter) {
        combat.endTurn();
        continue;
      }
      break;
    }

    const { round, turn } = extractCombatState(combat);
    const updated = await this.combat.updateEncounter(encounter.id, { round, turn });
    return { round, turn, updated };
  }

  /**
   * Phase 3: Process incoming combatant effects at the start of their turn.
   * - Rage end check (barbarian)
   * - Legendary action charge reset
   * - Action economy persistence for all creatures
   */
  private async processIncomingCombatantEffects(
    encounter: CombatEncounterRecord,
    combat: ReturnType<typeof hydrateCombat>,
    freshRecords: CombatantStateRecord[],
  ): Promise<void> {
    const incomingCreatureId = combat.getActiveCreature().getId();
    const incomingRecord = freshRecords.find(c => c.id === incomingCreatureId);

    // Rage End Check — must read flags BEFORE extractActionEconomy resets them
    if (incomingRecord) {
      const inRes = normalizeResources(incomingRecord.resources);
      if (inRes.raging === true) {
        const attacked = inRes.rageAttackedThisTurn === true;
        const tookDamage = inRes.rageDamageTakenThisTurn === true;
        const isUnconscious = incomingRecord.hpCurrent <= 0;
        if (shouldRageEnd(attacked, tookDamage, isUnconscious)) {
          const effects = getActiveEffects(incomingRecord.resources ?? {});
          const nonRageEffects = effects.filter((e) => e.source !== "Rage");
          let updatedRes: JsonValue = { ...inRes, raging: false, rageAttackedThisTurn: false, rageDamageTakenThisTurn: false };
          updatedRes = setActiveEffects(updatedRes, nonRageEffects);
          await this.combat.updateCombatantState(incomingRecord.id, { resources: updatedRes });
          incomingRecord.resources = updatedRes;
          console.log(`[CombatService] Rage ended for combatant ${incomingRecord.id} (attacked=${attacked}, tookDamage=${tookDamage}, unconscious=${isUnconscious})`);
        }
      }
    }

    // Legendary Action Charge Reset
    if (incomingRecord && isLegendaryCreature(incomingRecord.resources)) {
      const updatedRes = resetLegendaryActions(incomingRecord.resources);
      await this.combat.updateCombatantState(incomingRecord.id, { resources: updatedRes as JsonValue });
      incomingRecord.resources = updatedRes as JsonValue;
      console.log(`[CombatService] Legendary action charges reset for combatant ${incomingRecord.id}`);
    }

    // Persist action economy for all creatures
    const order = combat.getOrder();
    await Promise.all(
      order.map((entry) => {
        const creatureId = entry.creature.getId();
        const record = freshRecords.find((c) => c.id === creatureId);
        if (!record) return Promise.resolve();

        const resources = extractActionEconomy(combat, creatureId, record.resources);
        return this.combat.updateCombatantState(creatureId, { resources });
      }),
    );
  }

  /**
   * Phase 4: Process start-of-turn effects for the newly active combatant.
   * - Condition expiry (start_of_turn)
   * - StunningStrikePartial removal
   * - ActiveEffect start-of-turn processing
   * - Zone triggers (Moonbeam, Spirit Guardians, etc.)
   */
  private async processStartOfTurnEffects(
    encounter: CombatEncounterRecord,
    combat: ReturnType<typeof hydrateCombat>,
    combatantRecords: CombatantStateRecord[],
  ): Promise<void> {
    const activeCreatureId = combat.getActiveCreature().getId();
    const activeRecord = combatantRecords.find((c) => c.id === activeCreatureId);
    const activeEntityId = activeRecord?.characterId ?? activeRecord?.monsterId ?? activeRecord?.npcId;
    if (!activeEntityId) return;

    const latestRecords = await this.combat.listCombatants(encounter.id);
    for (const record of latestRecords) {
      const structuredConditions = normalizeConditions(record.conditions);
      const recordEntityId = record.characterId ?? record.monsterId ?? record.npcId;
      const { remaining, removed } = removeExpiredConditions(structuredConditions, "start_of_turn", activeEntityId);
      if (removed.length > 0) {
        await this.combat.updateCombatantState(record.id, {
          conditions: remaining as JsonValue,
        });
        console.log(`[CombatService] Removed expired conditions [${removed.join(", ")}] from combatant ${record.id} at start of ${activeEntityId}'s turn`);
      }

      // Remove StunningStrikePartial at start of target's own turn
      if (recordEntityId === activeEntityId) {
        if (structuredConditions.some(c => c.condition === "StunningStrikePartial")) {
          const updatedConditions = removeCondition(structuredConditions, "StunningStrikePartial" as Condition);
          // Also clear speedModifier that was set alongside the condition
          const res = typeof record.resources === "object" && record.resources !== null
            ? { ...(record.resources as Record<string, unknown>) }
            : {};
          delete res.speedModifier;
          await this.combat.updateCombatantState(record.id, {
            conditions: updatedConditions as JsonValue,
            resources: res as JsonValue,
          });
          console.log(`[CombatService] Removed StunningStrikePartial from active combatant ${record.id}`);
        }
      }
    }

    const latestRecordsForEffects = await this.combat.listCombatants(encounter.id);
    await this.processActiveEffectsAtTurnEvent(latestRecordsForEffects, "start_of_turn", activeEntityId, encounter);
    await this.processZoneTurnTriggers(encounter, latestRecordsForEffects, "on_start_turn", activeCreatureId, activeEntityId);
  }

  /**
   * Phase 6: Auto-roll death save for the active combatant if needed.
   */
  private async processDeathSaveIfNeeded(
    sessionId: string,
    encounter: CombatEncounterRecord,
    combat: ReturnType<typeof hydrateCombat>,
  ): Promise<void> {
    const activeCombatantId = combat.getActiveCreature().getId();
    const postAdvanceCombatants = await this.combat.listCombatants(encounter.id);
    const activeCombatant = postAdvanceCombatants.find((c) => c.id === activeCombatantId);
    if (!activeCombatant || !activeCombatant.characterId) return;

    const resources = normalizeResources(activeCombatant.resources);
    const currentDeathSaves: DeathSaves = (resources.deathSaves as DeathSaves) || { successes: 0, failures: 0 };
    const isStabilized = resources.stabilized === true;

    if (!needsDeathSave(activeCombatant.hpCurrent, currentDeathSaves, isStabilized)) return;

    // Automatically make death saving throw
    const roll = this.diceRoller.rollDie(20).total;
    const saveResult = makeDeathSave(roll, currentDeathSaves);

    let updatedDeathSaves = currentDeathSaves;
    let updatedHp = activeCombatant.hpCurrent;
    let updatedStabilized = isStabilized;
    let resultType: 'success' | 'failure' | 'stabilized' | 'dead' | 'revived' = 'success';

    if (saveResult.outcome === 'dead') {
      resultType = 'dead';
      updatedDeathSaves = { ...currentDeathSaves, failures: 3 };
    } else if (saveResult.outcome === 'stabilized') {
      resultType = 'stabilized';
      updatedStabilized = true;
      updatedDeathSaves = applyDeathSaveResult(currentDeathSaves, saveResult);
    } else if (saveResult.outcome === 'success' && saveResult.criticalSuccess) {
      resultType = 'revived';
      updatedHp = 1;
      updatedDeathSaves = { successes: 0, failures: 0 };
      updatedStabilized = false;
    } else {
      resultType = saveResult.outcome;
      updatedDeathSaves = applyDeathSaveResult(currentDeathSaves, saveResult);
    }

    const updatedResources = {
      ...resources,
      deathSaves: updatedDeathSaves,
      stabilized: updatedStabilized,
    };

    await this.combat.updateCombatantState(activeCombatant.id, {
      hpCurrent: updatedHp,
      resources: updatedResources,
    });

    if (this.events) {
      await this.events.append(sessionId, {
        id: nanoid(),
        type: "DeathSave",
        payload: {
          encounterId: encounter.id,
          combatantId: activeCombatant.id,
          roll,
          result: resultType,
          deathSaves: updatedDeathSaves,
          ...(updatedHp > 0 ? { hpRestored: 1 } : {}),
        },
      });
    }

    if (resultType === 'dead') {
      const updatedCombatants = await this.combat.listCombatants(encounter.id);
      const victoryAfterDeath = await this.victoryPolicy.evaluate({ combatants: updatedCombatants });
      if (victoryAfterDeath) {
        await this.combat.updateEncounter(encounter.id, { status: victoryAfterDeath });

        if (this.events) {
          await this.events.append(sessionId, {
            id: nanoid(),
            type: "CombatEnded",
            payload: { encounterId: encounter.id, result: victoryAfterDeath },
          });
        }
      }
    }
  }

  async endTurn(
    sessionId: string,
    input: { encounterId?: string; actor: CombatantRef },
  ): Promise<CombatEncounterRecord> {
    const encounter = await resolveEncounterOrThrow(
      this.sessions,
      this.combat,
      sessionId,
      input.encounterId,
    );

    const combatants = await this.combat.listCombatants(encounter.id);
    if (combatants.length === 0) {
      throw new ValidationError(`Encounter has no combatants: ${encounter.id}`);
    }

    const active = combatants[encounter.turn] ?? null;
    if (!active) {
      throw new ValidationError(
        `Encounter turn index out of range: turn=${encounter.turn} combatants=${combatants.length}`,
      );
    }

    const actorCombatantId = findCombatantIdByRef(combatants, input.actor);
    if (!actorCombatantId) throw new ValidationError("Actor is not in encounter");
    if (actorCombatantId !== active.id) {
      throw new ValidationError("It is not the actor's turn");
    }

    return this.nextTurn(sessionId, { encounterId: encounter.id, skipDeathSaveAutoRoll: true });
  }

  /**
   * Make a death saving throw for an unconscious combatant.
   * Called automatically at the start of their turn if at 0 HP.
   */
  async makeDeathSavingThrow(
    sessionId: string,
    input: { encounterId?: string; actor: CombatantRef }
  ): Promise<{
    combatant: unknown;
    roll: number;
    result: 'success' | 'failure' | 'stabilized' | 'dead' | 'revived';
    deathSaves: DeathSaves;
    hpRestored?: number;
  }> {
    const encounter = await resolveEncounterOrThrow(
      this.sessions,
      this.combat,
      sessionId,
      input.encounterId,
    );

    const combatants = await this.combat.listCombatants(encounter.id);
    const actorId = findCombatantIdByRef(combatants, input.actor);
    if (!actorId) throw new ValidationError("Actor not found in encounter");

    const combatant = combatants.find((c) => c.id === actorId);
    if (!combatant) throw new ValidationError("Combatant not found");

    // Monsters/NPCs die immediately at 0 HP - only Characters make death saves
    if (!combatant.characterId) {
      throw new ValidationError("Only player characters can make death saving throws");
    }

    // Parse current death saves from resources
    const resources = normalizeResources(combatant.resources);
    const currentDeathSaves: DeathSaves = (resources.deathSaves as DeathSaves) || { successes: 0, failures: 0 };
    const isStabilized = resources.stabilized === true;

    // Check if death save is needed
    if (!needsDeathSave(combatant.hpCurrent, currentDeathSaves, isStabilized)) {
      throw new ValidationError("Combatant does not need a death saving throw");
    }

    // Roll d20 for death save
    const roll = this.diceRoller ? this.diceRoller.rollDie(20).total : Math.floor(Math.random() * 20) + 1;
    const saveResult = makeDeathSave(roll, currentDeathSaves);

    let updatedDeathSaves = currentDeathSaves;
    let updatedHp = combatant.hpCurrent;
    let updatedStabilized = isStabilized;
    let resultType: 'success' | 'failure' | 'stabilized' | 'dead' | 'revived' = 'success';

    if (saveResult.outcome === 'dead') {
      resultType = 'dead';
      // Mark as dead (could add a 'dead' condition here)
      updatedDeathSaves = { ...currentDeathSaves, failures: 3 };
    } else if (saveResult.outcome === 'stabilized') {
      resultType = 'stabilized';
      updatedStabilized = true;
      updatedDeathSaves = applyDeathSaveResult(currentDeathSaves, saveResult);
    } else if (saveResult.outcome === 'success' && saveResult.criticalSuccess) {
      resultType = 'revived';
      updatedHp = 1; // Regain 1 HP
      updatedDeathSaves = { successes: 0, failures: 0 }; // Reset
      updatedStabilized = false;
    } else {
      // Normal success or failure
      resultType = saveResult.outcome;
      updatedDeathSaves = applyDeathSaveResult(currentDeathSaves, saveResult);
    }

    // Update combatant state
    const updatedResources = {
      ...resources,
      deathSaves: updatedDeathSaves,
      stabilized: updatedStabilized,
    };

    await this.combat.updateCombatantState(combatant.id, {
      hpCurrent: updatedHp,
      resources: updatedResources,
    });

    // Emit event
    if (this.events) {
      await this.events.append(sessionId, {
        id: nanoid(),
        type: "DeathSave",
        payload: {
          encounterId: encounter.id,
          actor: input.actor,
          roll,
          result: resultType,
          deathSaves: updatedDeathSaves,
          ...(updatedHp > 0 ? { hpRestored: 1 } : {}),
        },
      });
    }

    return {
      combatant,
      roll,
      result: resultType,
      deathSaves: updatedDeathSaves,
      ...(updatedHp > 0 ? { hpRestored: 1 } : {}),
    };
  }

  /**
   * Process ActiveEffects at a turn transition event (start_of_turn or end_of_turn).
   * 
   * Phase A: Execute ongoing effects (ongoing_damage, recurring_temp_hp) for the active combatant.
   * Phase B: Clean up expired effects for all combatants.
   */
  private async processActiveEffectsAtTurnEvent(
    combatantRecords: CombatantStateRecord[],
    event: "start_of_turn" | "end_of_turn",
    activeEntityId: string,
    encounter: CombatEncounterRecord,
  ): Promise<void> {
    const round = encounter.round ?? 1;
    const turn = encounter.turn ?? 0;
    const map = encounter.mapData as unknown as CombatMap | undefined;

    for (const record of combatantRecords) {
      const entityId = record.characterId ?? record.monsterId ?? record.npcId;
      const isActiveCreatureTurn = entityId === activeEntityId;
      const effects = getActiveEffects(record.resources ?? {});
      if (effects.length === 0) continue;

      let updatedEffects = [...effects];
      let resourcesChanged = false;
      let currentResources = record.resources;

      // Phase A: Execute ongoing effects
      // Two triggers: (1) effects on the active creature that fire on their own turn,
      // (2) effects on OTHER creatures where sourceCombatantId is the active creature
      //     (caster-turn-triggered, e.g. Heat Metal fires on caster's turn, not victim's)
      {
        // Ongoing damage — own-turn effects OR caster-turn-triggered effects
        const ongoingDamage = updatedEffects.filter(
          e => e.type === "ongoing_damage" && e.triggerAt === event && (
            isActiveCreatureTurn
              ? !e.sourceCombatantId || e.sourceCombatantId === entityId  // own-turn: fire if no source or self-applied
              : e.sourceCombatantId === activeEntityId                    // caster-turn: fire only if caster is the active creature
          )
        );
        for (const eff of ongoingDamage) {
          if (record.hpCurrent <= 0) break; // Don't apply to dead/KO'd creatures
          let dmg = eff.value ?? 0;
          if (eff.diceValue && this.diceRoller) {
            for (let i = 0; i < eff.diceValue.count; i++) {
              dmg += this.diceRoller.rollDie(eff.diceValue.sides).total;
            }
          }
          if (dmg > 0) {
            const hpBefore = record.hpCurrent;
            const hpAfter = Math.max(0, hpBefore - dmg);
            await this.combat.updateCombatantState(record.id, { hpCurrent: hpAfter });
            record.hpCurrent = hpAfter; // Update local copy
            console.log(`[CombatService] Ongoing damage (${eff.source ?? "effect"}): ${dmg} ${eff.damageType ?? ""} to ${record.id} (HP: ${hpBefore} → ${hpAfter})`);
          }
        }

        // Recurring temp HP (same own-turn vs caster-turn logic)
        const recurringTempHp = updatedEffects.filter(
          e => e.type === "recurring_temp_hp" && e.triggerAt === event && (
            isActiveCreatureTurn
              ? !e.sourceCombatantId || e.sourceCombatantId === entityId
              : e.sourceCombatantId === activeEntityId
          )
        );
        for (const eff of recurringTempHp) {
          let tempHp = eff.value ?? 0;
          if (eff.diceValue && this.diceRoller) {
            for (let i = 0; i < eff.diceValue.count; i++) {
              tempHp += this.diceRoller.rollDie(eff.diceValue.sides).total;
            }
          }
          if (tempHp > 0) {
            const res = typeof currentResources === "object" && currentResources !== null
              ? currentResources as Record<string, unknown>
              : {};
            const currentTempHp = typeof res.tempHp === "number" ? res.tempHp : 0;
            // Temp HP doesn't stack — only apply if higher
            if (tempHp > currentTempHp) {
              currentResources = { ...res, tempHp } as JsonValue;
              resourcesChanged = true;
              console.log(`[CombatService] Recurring temp HP (${eff.source ?? "effect"}): ${tempHp} to ${record.id}`);
            }
          }
        }

        // Save-to-end: effects with saveToEnd get a saving throw
        for (let i = updatedEffects.length - 1; i >= 0; i--) {
          const eff = updatedEffects[i];
          if (!eff.saveToEnd || !this.diceRoller) continue;
          // Only process save-to-end at the timing matching the effect's trigger
          // (default: end_of_turn for most effects)
          if (eff.triggerAt && eff.triggerAt !== event) continue;
          // Caster-turn-triggered: only process if the caster is the active creature
          if (!isActiveCreatureTurn) {
            if (!eff.sourceCombatantId || eff.sourceCombatantId !== activeEntityId) continue;
          }
          if (!eff.triggerAt && event !== "end_of_turn") continue;

          // Look up real ability score from sheet/statBlock.
          // CombatantStateRecord does NOT carry .sheet/.statBlock — we must load
          // the backing character/monster/npc record to get real ability scores
          // and save proficiencies. Falling back to {} gave ability=10/mod=0 and
          // no proficiencies, which silently broke save-to-end for Hold Person etc.
          const saveAbility = eff.saveToEnd.ability as Ability;
          let sheetOrStatBlock: Record<string, unknown> = {};
          if (record.characterId) {
            const ch = await this.characters.getById(record.characterId);
            if (ch?.sheet && typeof ch.sheet === "object") {
              sheetOrStatBlock = ch.sheet as Record<string, unknown>;
              if (typeof sheetOrStatBlock.level !== "number" && typeof ch.level === "number") {
                sheetOrStatBlock = { ...sheetOrStatBlock, level: ch.level };
              }
            }
          } else if (record.monsterId) {
            const mo = await this.monsters.getById(record.monsterId);
            if (mo?.statBlock && typeof mo.statBlock === "object") {
              sheetOrStatBlock = mo.statBlock as Record<string, unknown>;
            }
          } else if (record.npcId) {
            const npc = await this.npcs.getById(record.npcId);
            if (npc?.statBlock && typeof npc.statBlock === "object") {
              sheetOrStatBlock = npc.statBlock as Record<string, unknown>;
            }
          }
          const abilityScoresRaw = (typeof sheetOrStatBlock === "object" && sheetOrStatBlock !== null)
            ? (sheetOrStatBlock as Record<string, unknown>).abilityScores ?? {}
            : {};
          const abilityScoreVal = (typeof abilityScoresRaw === "object" && abilityScoresRaw !== null)
            ? (abilityScoresRaw as Record<string, unknown>)[saveAbility]
            : undefined;
          const abilityScore = typeof abilityScoreVal === "number" ? abilityScoreVal : 10;
          const abilityMod = getAbilityModifier(abilityScore);

          // Check save proficiency
          const level = typeof sheetOrStatBlock.level === "number" ? sheetOrStatBlock.level : 1;
          const profBonus = getProficiencyBonus(level);
          const saveProficiencies: string[] = Array.isArray(sheetOrStatBlock.saveProficiencies)
            ? sheetOrStatBlock.saveProficiencies
            : Array.isArray(sheetOrStatBlock.proficiencies)
              ? sheetOrStatBlock.proficiencies
              : [];
          const isProficient = saveProficiencies.includes(`${saveAbility}_save`) || saveProficiencies.includes(saveAbility);
          const profMod = isProficient ? profBonus : 0;

          // ActiveEffect bonuses on saving throws (e.g., Bless +1d4)
          let effectBonus = 0;
          const combatantEffects = getActiveEffects(record.resources ?? {});
          const saveBonusResult = calculateBonusFromEffects(combatantEffects, 'saving_throws', saveAbility);
          effectBonus += saveBonusResult.flatBonus;
          for (const dr of saveBonusResult.diceRolls) {
            const count = Math.abs(dr.count);
            const sign = dr.count < 0 ? -1 : 1;
            for (let j = 0; j < count; j++) {
              effectBonus += sign * this.diceRoller.rollDie(dr.sides).total;
            }
          }

          // Passive zone aura bonuses (e.g., Paladin Aura of Protection)
          const zones = map ? getMapZones(map) : [];
          if (zones.length > 0) {
            const recordEntityId = record.characterId ?? record.monsterId ?? record.npcId;
            const recordPosition = getPosition(record.resources);
            if (recordEntityId && recordPosition) {
              const recordIsPC = record.combatantType === "Character" || record.combatantType === "NPC";
              const zoneBonus = getPassiveZoneSaveBonus(zones, recordPosition, recordEntityId, (srcId) => {
                const src = findCombatantByEntityId(combatantRecords, srcId);
                return src ? (src.combatantType === "Character" || src.combatantType === "NPC") === recordIsPC : false;
              }, saveAbility);
              if (zoneBonus !== 0) {
                effectBonus += zoneBonus;
                console.log(`[CombatService] Passive zone aura bonus for ${recordEntityId}: +${zoneBonus} to ${saveAbility} save`);
              }
            }
          }

          // Advantage/disadvantage from effects
          const hasAdvantage = hasAdvantageFromEffects(combatantEffects, 'saving_throws', saveAbility);
          const hasDisadvantage = hasDisadvantageFromEffects(combatantEffects, 'saving_throws', saveAbility);

          let roll;
          if (hasAdvantage && !hasDisadvantage) {
            const roll1 = this.diceRoller.d20();
            const roll2 = this.diceRoller.d20();
            roll = roll1.total >= roll2.total ? roll1 : roll2;
          } else if (hasDisadvantage && !hasAdvantage) {
            const roll1 = this.diceRoller.d20();
            const roll2 = this.diceRoller.d20();
            roll = roll1.total <= roll2.total ? roll1 : roll2;
          } else {
            roll = this.diceRoller.d20();
          }

          const totalMod = abilityMod + profMod + effectBonus;
          const total = roll.total + totalMod;
          const success = isSavingThrowSuccess(roll.total, total, eff.saveToEnd.dc);

          console.log(`[CombatService] Save-to-end (${eff.source ?? "effect"}): d20(${roll.total}) + ${totalMod} (${saveAbility} ${abilityMod}${profMod ? ` + prof ${profMod}` : ""}${effectBonus ? ` + effects ${effectBonus}` : ""}) = ${total} vs DC ${eff.saveToEnd.dc} → ${success ? "SUCCESS (removed)" : "FAILURE (persists)"}`);

          if (success) {
            updatedEffects.splice(i, 1);
            resourcesChanged = true;

            // Remove linked conditions on successful save (e.g., Paralyzed from Hold Person)
            if (eff.saveToEnd.removeConditions && eff.saveToEnd.removeConditions.length > 0) {
              let conditions = normalizeConditions(record.conditions);
              for (const condName of eff.saveToEnd.removeConditions) {
                conditions = removeCondition(conditions, condName as Condition);
                console.log(`[CombatService] Save-to-end success: removed condition "${condName}" from ${record.id}`);
              }
              await this.combat.updateCombatantState(record.id, {
                conditions: conditions as JsonValue,
              });
              record.conditions = conditions as JsonValue; // Update local copy
            }
          }
        }
      }

      // Phase B: Cleanup expired effects
      const cleanedEffects: ActiveEffect[] = [];
      for (const eff of updatedEffects) {
        let shouldRemove = false;

        // expiresAt targeting takes precedence over generic duration checks.
        if (eff.expiresAt) {
          shouldRemove = eff.expiresAt.event === event && eff.expiresAt.combatantId === activeEntityId;
        } else {
          shouldRemove = event === "end_of_turn"
            ? shouldRemoveAtEndOfTurn(eff, round, turn, isActiveCreatureTurn)
            : shouldRemoveAtStartOfTurn(eff, round, turn, isActiveCreatureTurn);
        }

        if (shouldRemove) {
          console.log(`[CombatService] Removing expired effect "${eff.source ?? eff.id}" from ${record.id} at ${event}`);
          resourcesChanged = true;
          continue;
        }

        // Decrement rounds for round-based effects
        const decremented = event === "end_of_turn" && isActiveCreatureTurn
          ? decrementRounds(eff)
          : eff;
        if (decremented !== eff) resourcesChanged = true;
        cleanedEffects.push(decremented);
      }

      if (resourcesChanged) {
        const finalResources = setActiveEffects(currentResources, cleanedEffects);
        await this.combat.updateCombatantState(record.id, {
          resources: finalResources,
        });
      }
    }
  }

  /**
   * Decrement zone round counters at round boundary and remove expired zones.
   */
  private async cleanupExpiredZones(encounter: CombatEncounterRecord): Promise<void> {
    const map = encounter.mapData as unknown as CombatMap | undefined;
    if (!map) return;
    const zones = getMapZones(map);
    if (zones.length === 0) return;

    const remaining = zones
      .map((z) => decrementZoneRounds(z))
      .filter((z): z is NonNullable<typeof z> => z !== null);

    if (remaining.length !== zones.length) {
      const removedCount = zones.length - remaining.length;
      const updatedMap = setMapZones(map, remaining);
      await this.combat.updateEncounter(encounter.id, {
        mapData: updatedMap as unknown as Record<string, unknown>,
      });
      console.log(
        `[CombatService] Round cleanup: removed ${removedCount} expired zone(s), ${remaining.length} remaining`,
      );
    }
  }

  /**
   * Process zone triggers at turn start/end for a specific combatant.
   * Checks if the combatant is inside any zones and applies:
   * - on_start_turn / on_end_turn damage (with saves if applicable)
   * - Condition application from zones
   */
  private async processZoneTurnTriggers(
    encounter: CombatEncounterRecord,
    combatantRecords: CombatantStateRecord[],
    trigger: "on_start_turn" | "on_end_turn",
    combatantId: string,
    entityId: string | undefined,
  ): Promise<void> {
    if (!entityId) return;

    const map = encounter.mapData as unknown as CombatMap | undefined;
    if (!map) return;
    const zones = getMapZones(map);
    if (zones.length === 0) return;

    // Find the combatant's position
    const record = combatantRecords.find((c) => c.id === combatantId);
    if (!record) return;
    const resources = normalizeResources(record.resources);
    const position = getPosition(resources);
    if (!position) return;

    const combatantIsPC = record.combatantType === "Character" || record.combatantType === "NPC";

    // Get all triggered effects at this position for this combatant
    const triggered = getTriggeredZoneEffects(
      zones,
      trigger,
      position,
      entityId,
      (sourceCombatantId: string) => {
        const src = findCombatantByEntityId(combatantRecords, sourceCombatantId);
        const srcIsPC = src
          ? src.combatantType === "Character" || src.combatantType === "NPC"
          : false;
        return combatantIsPC === srcIsPC;
      },
    );

    if (triggered.length === 0) return;

    // Calculate passive zone save bonus (e.g., Paladin Aura of Protection)
    const isSameFactionFn = (sourceCombatantId: string): boolean => {
      const src = findCombatantByEntityId(combatantRecords, sourceCombatantId);
      const srcIsPC = src ? (src.combatantType === "Character" || src.combatantType === "NPC") : false;
      return combatantIsPC === srcIsPC;
    };
    const passiveSaveBonus = getPassiveZoneSaveBonus(zones, position, entityId, isSameFactionFn);

    // Look up creature data for Evasion and damage defenses
    let hasEvasion = false;
    let damageDefenses: DamageDefenses = {};
    if (record.characterId) {
      const char = await this.characters.getById(record.characterId);
      if (char) {
        hasEvasion = creatureHasEvasion(char.className ?? undefined, char.level);
      }
    } else if (record.monsterId) {
      const mon = await this.monsters.getById(record.monsterId);
      if (mon?.statBlock) {
        damageDefenses = extractDamageDefenses(mon.statBlock);
      }
    }

    let totalDamage = 0;
    for (const { zone, effect } of triggered) {
      if (!effect.damage) continue;

      // Roll saving throw if applicable
      let saveSuccess = false;
      if (effect.saveAbility && effect.saveDC !== undefined && this.diceRoller) {
        const saveRoll = this.diceRoller.d20();
        const saveTotal = saveRoll.total + passiveSaveBonus;
        saveSuccess = isSavingThrowSuccess(saveRoll.total, saveTotal, effect.saveDC);
        console.log(
          `[CombatService] Zone ${zone.source} ${trigger} save: ${saveRoll.total}${passiveSaveBonus ? ` + ${passiveSaveBonus} (aura)` : ""} = ${saveTotal} vs DC ${effect.saveDC} → ${saveSuccess ? "save" : "fail"}`,
        );
      }

      // Roll damage
      let rawDamage = 0;
      if (this.diceRoller) {
        rawDamage = this.diceRoller.rollDie(
          effect.damage.diceSides,
          effect.damage.diceCount,
          effect.damage.modifier ?? 0,
        ).total;
      } else {
        rawDamage =
          Math.floor(effect.damage.diceCount * ((effect.damage.diceSides + 1) / 2)) +
          (effect.damage.modifier ?? 0);
      }

      // Apply Evasion for DEX saves, or normal save damage reduction
      if (effect.saveAbility === "dexterity" && hasEvasion) {
        rawDamage = applyEvasion(rawDamage, saveSuccess, true, effect.halfDamageOnSave ?? true);
      } else if (saveSuccess) {
        rawDamage = effect.halfDamageOnSave ? Math.floor(rawDamage / 2) : 0;
      }

      // Apply damage defenses (immunities/resistances from creature stat block)
      const defenseResult = applyDamageDefenses(rawDamage, effect.damageType, damageDefenses);
      totalDamage += defenseResult.adjustedDamage;

      console.log(
        `[CombatService] Zone "${zone.source}" ${trigger}: ${defenseResult.adjustedDamage} ${effect.damageType ?? ""} damage to ${entityId}${saveSuccess ? " (saved)" : ""}`,
      );
    }

    if (totalDamage > 0) {
      const hpBefore = record.hpCurrent;
      const newHP = Math.max(0, hpBefore - totalDamage);
      await this.combat.updateCombatantState(record.id, {
        hpCurrent: newHP,
      });
      await applyKoEffectsIfNeeded(record, hpBefore, newHP, this.combat);
    }
  }
}
