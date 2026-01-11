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
import { createCombatMap, type CombatMap } from "../../../domain/rules/combat-map.js";
import type { Position } from "../../../domain/rules/movement.js";

import type { CombatVictoryPolicy } from "./combat-victory-policy.js";
import type { CombatantRef } from "./helpers/combatant-ref.js";
import { findCombatantIdByRef } from "./helpers/combatant-ref.js";
import { resolveEncounterOrThrow } from "./helpers/encounter-resolver.js";
import { clearActionSpent, resetTurnResources } from "./helpers/resource-utils.js";
import { hydrateCombat, extractCombatState, extractActionEconomy } from "./helpers/combat-hydration.js";
import { hydrateCharacter, hydrateMonster, hydrateNPC } from "./helpers/creature-hydration.js";
import type { Creature } from "../../../domain/entities/creatures/creature.js";
import { makeDeathSave, applyDeathSaveResult, needsDeathSave, type DeathSaves } from "../../../domain/rules/death-saves.js";

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
    private readonly events?: IEventRepository,
    private readonly characters?: ICharacterRepository,
    private readonly monsters?: IMonsterRepository,
    private readonly npcs?: INPCRepository,
    private readonly diceRoller?: DiceRoller,
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
            // Place hostiles on the right side in a vertical line
            const y = 10 + (hostileIndex * 10);
            position = { x: mapWidth - 10, y: Math.min(y, mapHeight - 10) };
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
          resources: c.resources ?? {},
        };
      }),
    );

    // Update encounter status to Active
    await this.combat.updateEncounter(encounterId, { status: "Active" });
  }

  async nextTurn(
    sessionId: string,
    input?: { encounterId?: string },
  ): Promise<CombatEncounterRecord> {
    // Use domain-based implementation if dependencies available
    if (this.characters && this.monsters && this.npcs && this.diceRoller) {
      return this.nextTurnDomain(sessionId, input);
    }

    // Fallback for tests without full dependencies
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

    const victoryStatus = await this.victoryPolicy.evaluate({ combatants });
    if (victoryStatus) {
      // End the encounter
      const updated = await this.combat.updateEncounter(encounter.id, {
        status: victoryStatus,
      });
      
      if (this.events) {
        await this.events.append(sessionId, {
          id: nanoid(),
          type: "CombatEnded",
          payload: { encounterId: encounter.id, result: victoryStatus },
        });
      }
      
      return updated;
    }

    const nextTurn = encounter.turn + 1;
    const wraps = nextTurn >= combatants.length;

    const updated = await this.combat.updateEncounter(encounter.id, {
      turn: wraps ? 0 : nextTurn,
      round: wraps ? encounter.round + 1 : encounter.round,
    });

    // Reset action availability at start of a combatant's turn.
    // Resets: actionSpent, reactionUsed, disengaged flags
    if (wraps) {
      // New round: clear for everyone.
      await Promise.all(
        combatants.map((c) =>
          this.combat.updateCombatantState(c.id, { resources: resetTurnResources(c.resources) }),
        ),
      );
    } else {
      const active = combatants[updated.turn];
      if (!active) {
        throw new ValidationError(
          `Encounter turn index out of range: turn=${updated.turn} combatants=${combatants.length}`,
        );
      }
      await this.combat.updateCombatantState(active.id, { resources: resetTurnResources(active.resources) });
    }

    if (this.events) {
      await this.events.append(sessionId, {
        id: nanoid(),
        type: "TurnAdvanced",
        payload: { encounterId: encounter.id, round: updated.round, turn: updated.turn },
      });
    }

    // Check if the newly active combatant needs a death saving throw
    const updatedCombatants = await this.combat.listCombatants(encounter.id);
    const activeCombatant = updatedCombatants[updated.turn];
    if (activeCombatant) {
      const resources = (activeCombatant.resources as any) || {};
      const currentDeathSaves: DeathSaves = resources.deathSaves || { successes: 0, failures: 0 };
      const isStabilized = resources.stabilized === true;

      if (needsDeathSave(activeCombatant.hpCurrent, currentDeathSaves, isStabilized)) {
        // Automatically make death saving throw
        const roll = this.diceRoller ? this.diceRoller.rollDie(20).total : Math.floor(Math.random() * 20) + 1;
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
          const finalCombatants = await this.combat.listCombatants(encounter.id);
          const victoryAfterDeath = await this.victoryPolicy.evaluate({ combatants: finalCombatants });
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

    return updated;
  }

  /**
   * Domain-driven turn advancement using Combat domain class.
   */
  private async nextTurnDomain(
    sessionId: string,
    input?: { encounterId?: string },
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
    const combat = hydrateCombat(encounter, combatantRecords, creatures, this.diceRoller!);

    // Advance turn via domain logic
    combat.endTurn();

    // Extract dirty state for persistence
    const { round, turn } = extractCombatState(combat);
    const updated = await this.combat.updateEncounter(encounter.id, { round, turn });

    // Persist action economy for all creatures
    // Note: In a new round, all action economies are reset by endTurn()
    // In a regular turn, only the new active combatant's economy is reset
    const order = combat.getOrder();
    await Promise.all(
      order.map((entry) => {
        const creatureId = entry.creature.getId();
        const record = combatantRecords.find((c) => c.id === creatureId);
        if (!record) return Promise.resolve();

        const resources = extractActionEconomy(combat, creatureId, record.resources);
        return this.combat.updateCombatantState(creatureId, { resources });
      }),
    );

    if (this.events) {
      await this.events.append(sessionId, {
        id: nanoid(),
        type: "TurnAdvanced",
        payload: { encounterId: encounter.id, round, turn },
      });
    }

    // Check if the newly active combatant needs a death saving throw
    const activeCombatant = combatantRecords[turn];
    if (activeCombatant) {
      const resources = (activeCombatant.resources as any) || {};
      const currentDeathSaves: DeathSaves = resources.deathSaves || { successes: 0, failures: 0 };
      const isStabilized = resources.stabilized === true;

      if (needsDeathSave(activeCombatant.hpCurrent, currentDeathSaves, isStabilized)) {
        // Automatically make death saving throw
        const roll = this.diceRoller!.rollDie(20).total;
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

    return this.nextTurn(sessionId, { encounterId: encounter.id });
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
}
