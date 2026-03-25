import { nanoid } from "nanoid";

import { NotFoundError, ValidationError } from "../../errors.js";
import type { ICombatRepository } from "../../repositories/combat-repository.js";
import type { ICharacterRepository } from "../../repositories/character-repository.js";
import type { IMonsterRepository } from "../../repositories/monster-repository.js";
import type { INPCRepository } from "../../repositories/npc-repository.js";
import type { IEventRepository } from "../../repositories/event-repository.js";
import type { IGameSessionRepository } from "../../repositories/game-session-repository.js";
import type { CombatEncounterRecord, CombatantType, JsonValue } from "../../types.js";
import type { DiceRoller } from "../../../domain/rules/dice-roller.js";
import { createCombatMap, type CombatMap, getMapZones, setMapZones } from "../../../domain/rules/combat-map.js";
import type { Position } from "../../../domain/rules/movement.js";

import type { CombatVictoryPolicy } from "./combat-victory-policy.js";
import type { CombatantRef } from "./helpers/combatant-ref.js";
import { findCombatantIdByRef } from "./helpers/combatant-ref.js";
import { resolveEncounterOrThrow } from "./helpers/encounter-resolver.js";
import { clearActionSpent, resetTurnResources, getActiveEffects, setActiveEffects, normalizeResources, getPosition } from "./helpers/resource-utils.js";
import { shouldRageEnd } from "../../../domain/entities/classes/barbarian.js";
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
import { applyDamageDefenses } from "../../../domain/rules/damage-defenses.js";
import { applyKoEffectsIfNeeded } from "./helpers/ko-handler.js";

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

    // Determine factions for positioning
    const factionsMap = new Map<string, string>();
    if (this.characters && this.monsters && this.npcs) {
      for (const c of input.combatants) {
        const cid = c.characterId;
        const mid = c.monsterId;
        const nid = c.npcId;
        
        if (c.combatantType === "Character" && cid) {
          const char = await this.characters.getById(cid);
          if (char) factionsMap.set(cid, char.faction);
        } else if (c.combatantType === "Monster" && mid) {
          const mon = await this.monsters.getById(mid);
          if (mon) factionsMap.set(mid, mon.faction);
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
        let resources = c.resources ? { ...(c.resources as any) } : {};
        
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
      const md = mapDataRaw as any;
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
        const resources = c.resources && typeof c.resources === "object" && c.resources !== null
          ? { ...(c.resources as any) }
          : {};

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

    if (creatures.size === 0) {
      throw new ValidationError("Failed to hydrate any creatures for combat");
    }

    // Hydrate Combat domain instance
    const combat = hydrateCombat(encounter, combatantRecords, creatures, this.diceRoller);

    // --- End-of-turn condition expiry for the outgoing combatant ---
    const outgoingCreatureId = combat.getActiveCreature().getId();
    const outgoingRecord = combatantRecords.find(c => c.id === outgoingCreatureId);
    const outgoingEntityId = outgoingRecord?.characterId ?? outgoingRecord?.monsterId ?? outgoingRecord?.npcId;
    if (outgoingEntityId) {
      for (const record of combatantRecords) {
        const structuredConditions = normalizeConditions(record.conditions);
        const { remaining, removed } = removeExpiredConditions(structuredConditions, "end_of_turn", outgoingEntityId);
        if (removed.length > 0) {
          await this.combat.updateCombatantState(record.id, {
            conditions: remaining as any,
          });
          console.log(`[CombatService] Removed expired conditions [${removed.join(", ")}] from combatant ${record.id} at end of ${outgoingEntityId}'s turn`);
        }
      }

      // ── ActiveEffect: end-of-turn processing ──
      await this.processActiveEffectsAtTurnEvent(combatantRecords, "end_of_turn", outgoingEntityId, encounter);

      // ── Zone: end-of-turn triggers (Cloud of Daggers, Spirit Guardians, etc.) ──
      await this.processZoneTurnTriggers(encounter, combatantRecords, "on_end_turn", outgoingCreatureId, outgoingEntityId);
    }

    // Advance turn via domain logic
    combat.endTurn();

    // Skip over defeated non-characters (monsters typically don't act at 0 HP).
    // Characters at 0 HP are handled via death saves.
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

    // Extract dirty state for persistence
    const { round, turn } = extractCombatState(combat);
    const updated = await this.combat.updateEncounter(encounter.id, { round, turn });

    // Re-fetch combatant records to get the latest state after effect cleanup
    // (the original combatantRecords may have stale activeEffects that were
    // removed during end-of-turn processing above)
    const freshRecords = await this.combat.listCombatants(encounter.id);

    // ── Rage End Check (incoming combatant — start of their turn) ──
    // D&D 5e 2024: Rage ends "if you haven't made an attack roll or taken damage
    // since the end of your last turn." The check must happen at the START of the
    // raging barbarian's turn, giving the gap between turns (other creatures' turns)
    // for the barbarian to take damage or make opportunity attacks.
    // Must read flags BEFORE extractActionEconomy resets them (isFreshEconomy=true).
    {
      const incomingCreatureId = combat.getActiveCreature().getId();
      const incomingRecord = freshRecords.find(c => c.id === incomingCreatureId);
      if (incomingRecord) {
        const inRes = normalizeResources(incomingRecord.resources);
        if (inRes.raging === true) {
          const attacked = inRes.rageAttackedThisTurn === true;
          const tookDamage = inRes.rageDamageTakenThisTurn === true;
          const isUnconscious = incomingRecord.hpCurrent <= 0;
          if (shouldRageEnd(attacked, tookDamage, isUnconscious)) {
            const effects = getActiveEffects(incomingRecord.resources ?? {});
            const nonRageEffects = effects.filter((e: any) => e.source !== "Rage");
            let updatedRes = { ...inRes, raging: false, rageAttackedThisTurn: false, rageDamageTakenThisTurn: false };
            updatedRes = setActiveEffects(updatedRes, nonRageEffects) as any;
            await this.combat.updateCombatantState(incomingRecord.id, { resources: updatedRes as any });
            // Update in-memory record so extractActionEconomy doesn't overwrite with stale data
            (incomingRecord as any).resources = updatedRes;
            console.log(`[CombatService] Rage ended for combatant ${incomingRecord.id} (attacked=${attacked}, tookDamage=${tookDamage}, unconscious=${isUnconscious})`);
          }
        }
      }
    }

    // Persist action economy for all creatures
    // Note: In a new round, all action economies are reset by endTurn()
    // In a regular turn, only the new active combatant's economy is reset
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

    // Condition expiry: Remove "Stunned" from combatants whose stun expires
    // at the start of the newly active combatant's turn.
    const activeCreatureId = combat.getActiveCreature().getId();
    const activeRecord = combatantRecords.find(
      (c) => c.id === activeCreatureId,
    );
    // Determine the entity ID (characterId/monsterId/npcId) of the active combatant
    const activeEntityId = activeRecord?.characterId ?? activeRecord?.monsterId ?? activeRecord?.npcId;
    if (activeEntityId) {
      // Re-fetch combatants to get latest state (action economy may have been updated above)
      const latestRecords = await this.combat.listCombatants(encounter.id);
      for (const record of latestRecords) {
        const res = typeof record.resources === "object" && record.resources !== null
          ? record.resources as Record<string, unknown>
          : {};

        // General-purpose structured condition expiry (System 4)
        // Check for conditions with expiresAt tracking
        const structuredConditions = normalizeConditions(record.conditions);
        const recordEntityId = record.characterId ?? record.monsterId ?? record.npcId;
        const { remaining, removed } = removeExpiredConditions(structuredConditions, "start_of_turn", activeEntityId);
        if (removed.length > 0) {
          await this.combat.updateCombatantState(record.id, {
            conditions: remaining as any,
          });
          console.log(`[CombatService] Removed expired conditions [${removed.join(", ")}] from combatant ${record.id} at start of ${activeEntityId}'s turn`);
        }

        // Also remove StunningStrikePartial (speed halved + adv on next attack) at start of any of target's own turns
        if (recordEntityId === activeEntityId) {
          if (structuredConditions.some(c => c.condition === "StunningStrikePartial")) {
            const updatedConditions = removeCondition(structuredConditions, "StunningStrikePartial" as Condition);
            await this.combat.updateCombatantState(record.id, {
              conditions: updatedConditions as any,
            });
            console.log(`[CombatService] Removed StunningStrikePartial from active combatant ${record.id}`);
          }
        }
      }

      // ── ActiveEffect: start-of-turn processing ──
      const latestRecordsForEffects = await this.combat.listCombatants(encounter.id);
      await this.processActiveEffectsAtTurnEvent(latestRecordsForEffects, "start_of_turn", activeEntityId, encounter);

      // ── Zone: start-of-turn triggers (Moonbeam, Spirit Guardians, etc.) ──
      await this.processZoneTurnTriggers(encounter, latestRecordsForEffects, "on_start_turn", activeCreatureId, activeEntityId);
    }

    if (this.events) {
      await this.events.append(sessionId, {
        id: nanoid(),
        type: "TurnAdvanced",
        payload: { encounterId: encounter.id, round, turn },
      });
    }

    // Check if the newly active combatant needs a death saving throw.
    // By default, only Characters make death saves (monsters typically die at 0 HP).
    // When skipDeathSaveAutoRoll is true (tabletop mode), skip auto-rolling.
    if (!input?.skipDeathSaveAutoRoll) {
    const activeCombatant = combatantRecords[turn];
    if (activeCombatant && activeCombatant.characterId) {
      const resources = (activeCombatant.resources as any) || {};
      const currentDeathSaves: DeathSaves = resources.deathSaves || { successes: 0, failures: 0 };
      const isStabilized = resources.stabilized === true;

      if (needsDeathSave(activeCombatant.hpCurrent, currentDeathSaves, isStabilized)) {
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
        } else if (saveResult.outcome === 'success' && (saveResult as any).criticalSuccess) {
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

        await this.combat.updateCombatantState(activeCombatant.id, {
          hpCurrent: updatedHp,
          resources: updatedResources,
        });

        // Emit death save event
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

        // If the combatant died, check victory again
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
    }
    } // end skipDeathSaveAutoRoll guard (nextTurnDomain)

    return updated;
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
    const resources = (combatant.resources as any) || {};
    const currentDeathSaves: DeathSaves = resources.deathSaves || { successes: 0, failures: 0 };
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
    } else if (saveResult.outcome === 'success' && (saveResult as any).criticalSuccess) {
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
    combatantRecords: any[],
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
              currentResources = { ...res, tempHp } as any;
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

          // Look up real ability score from sheet/statBlock
          const saveAbility = eff.saveToEnd.ability as Ability;
          const sheetOrStatBlock = (record as any).sheet ?? (record as any).statBlock ?? {};
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
                const src = combatantRecords.find((c: any) =>
                  (c.characterId ?? c.monsterId ?? c.npcId) === srcId,
                );
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
          const success = total >= eff.saveToEnd.dc;

          console.log(`[CombatService] Save-to-end (${eff.source ?? "effect"}): d20(${roll.total}) + ${totalMod} (${saveAbility} ${abilityMod}${profMod ? ` + prof ${profMod}` : ""}${effectBonus ? ` + effects ${effectBonus}` : ""}) = ${total} vs DC ${eff.saveToEnd.dc} → ${success ? "SUCCESS (removed)" : "FAILURE (persists)"}`);

          if (success) {
            updatedEffects.splice(i, 1);
            resourcesChanged = true;
          }
        }
      }

      // Phase B: Cleanup expired effects
      const cleanedEffects: ActiveEffect[] = [];
      for (const eff of updatedEffects) {
        const shouldRemove = event === "end_of_turn"
          ? shouldRemoveAtEndOfTurn(eff, round, turn, isActiveCreatureTurn)
          : shouldRemoveAtStartOfTurn(eff, round, turn, isActiveCreatureTurn);

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
          resources: finalResources as any,
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
    combatantRecords: any[],
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
    const record = combatantRecords.find((c: any) => c.id === combatantId);
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
        const src = combatantRecords.find((c: any) =>
          (c.characterId ?? c.monsterId ?? c.npcId) === sourceCombatantId,
        );
        const srcIsPC = src
          ? src.combatantType === "Character" || src.combatantType === "NPC"
          : false;
        return combatantIsPC === srcIsPC;
      },
    );

    if (triggered.length === 0) return;

    // Calculate passive zone save bonus (e.g., Paladin Aura of Protection)
    const isSameFactionFn = (sourceCombatantId: string): boolean => {
      const src = combatantRecords.find((c: any) =>
        (c.characterId ?? c.monsterId ?? c.npcId) === sourceCombatantId,
      );
      const srcIsPC = src ? (src.combatantType === "Character" || src.combatantType === "NPC") : false;
      return combatantIsPC === srcIsPC;
    };
    const passiveSaveBonus = getPassiveZoneSaveBonus(zones, position, entityId, isSameFactionFn);

    let totalDamage = 0;
    for (const { zone, effect } of triggered) {
      if (!effect.damage) continue;

      // Roll saving throw if applicable
      let saveSuccess = false;
      if (effect.saveAbility && effect.saveDC !== undefined && this.diceRoller) {
        const saveRoll = this.diceRoller.d20();
        const saveTotal = saveRoll.total + passiveSaveBonus;
        saveSuccess = saveTotal >= effect.saveDC;
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

      // Half damage on save or zero on save
      if (saveSuccess) {
        rawDamage = effect.halfDamageOnSave ? Math.floor(rawDamage / 2) : 0;
      }

      // Apply damage defenses
      const defenseResult = applyDamageDefenses(rawDamage, effect.damageType, {
        damageResistances: [],
        damageImmunities: [],
        damageVulnerabilities: [],
      });
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
