import { Prisma } from "@prisma/client";
import type { PrismaClient, CombatantType as PrismaCombatantType } from "@prisma/client";

import type { ICombatRepository } from "../../application/repositories/combat-repository.js";
import type {
  CombatantStateRecord,
  CombatEncounterRecord,
  CombatantType,
  JsonValue,
} from "../../application/types.js";

function toPrismaCombatantType(type: CombatantType): PrismaCombatantType {
  return type as unknown as PrismaCombatantType;
}

/**
 * Prisma-backed persistence for encounters + combatant state.
 * Layer: Infrastructure (DB adapter).
 * Notes: Implements `ICombatRepository` used by combat/action services.
 */
export class PrismaCombatRepository implements ICombatRepository {
  constructor(private readonly prisma: PrismaClient | Prisma.TransactionClient) {}

  async createEncounter(
    sessionId: string,
    input: { id: string; status: string; round: number; turn: number; mapData?: JsonValue },
  ): Promise<CombatEncounterRecord> {
    const created = await this.prisma.combatEncounter.create({
      data: {
        id: input.id,
        sessionId,
        status: input.status,
        round: input.round,
        turn: input.turn,
        mapData: input.mapData ?? undefined,
      },
    });

    return created;
  }

  async listEncountersBySession(sessionId: string): Promise<CombatEncounterRecord[]> {
    return this.prisma.combatEncounter.findMany({
      where: { sessionId },
      orderBy: { createdAt: "desc" },
    });
  }

  async getEncounterById(id: string): Promise<CombatEncounterRecord | null> {
    return this.prisma.combatEncounter.findUnique({ where: { id } });
  }

  async updateEncounter(
    id: string,
    patch: Partial<Pick<CombatEncounterRecord, "status" | "round" | "turn" | "mapData">>,
  ): Promise<CombatEncounterRecord> {
    const updated = await this.prisma.combatEncounter.update({
      where: { id },
      data: {
        ...patch,
        mapData: patch.mapData === undefined ? undefined : (patch.mapData as any),
      },
    });

    return updated;
  }

  async listCombatants(encounterId: string): Promise<CombatantStateRecord[]> {
    return this.prisma.combatantState.findMany({
      where: { encounterId },
      // Deterministic turn order: higher initiative first, then creation order.
      orderBy: [{ initiative: "desc" }, { createdAt: "asc" }, { id: "asc" }],
      include: {
        character: true,
        monster: true,
        npc: true,
      },
    });
  }

  async updateCombatantState(
    id: string,
    patch: Partial<Pick<CombatantStateRecord, "hpCurrent" | "hpMax" | "initiative" | "conditions" | "resources">>,
  ): Promise<CombatantStateRecord> {
    const data: Prisma.CombatantStateUpdateInput = {
      ...("hpCurrent" in patch ? { hpCurrent: patch.hpCurrent } : undefined),
      ...("hpMax" in patch ? { hpMax: patch.hpMax } : undefined),
      ...("initiative" in patch ? { initiative: patch.initiative } : undefined),
      ...("conditions" in patch ? { conditions: patch.conditions as Prisma.InputJsonValue } : undefined),
      ...("resources" in patch ? { resources: patch.resources as Prisma.InputJsonValue } : undefined),
    };

    return this.prisma.combatantState.update({ where: { id }, data });
  }

  async createCombatants(
    encounterId: string,
    combatants: Array<{
      id: string;
      combatantType: CombatantType;
      characterId: string | null;
      monsterId: string | null;
      npcId: string | null;
      initiative: number | null;
      hpCurrent: number;
      hpMax: number;
      conditions: JsonValue;
      resources: JsonValue;
    }>,
  ): Promise<CombatantStateRecord[]> {
    // Ensure deterministic ordering when initiatives tie by forcing unique timestamps.
    const baseTime = Date.now();

    const ops = combatants.map((c, i) =>
      this.prisma.combatantState.create({
        data: {
          id: c.id,
          encounterId,
          combatantType: toPrismaCombatantType(c.combatantType),
          characterId: c.characterId,
          monsterId: c.monsterId,
          npcId: c.npcId,
          initiative: c.initiative,
          hpCurrent: c.hpCurrent,
          hpMax: c.hpMax,
          conditions: c.conditions as Prisma.InputJsonValue,
          resources: c.resources as Prisma.InputJsonValue,
          createdAt: new Date(baseTime + i),
          updatedAt: new Date(baseTime + i),
        },
      }),
    );

    const created = await Promise.all(ops);
    return created;
  }

  // Tabletop combat flow - pending actions
  async setPendingAction(encounterId: string, action: JsonValue): Promise<void> {
    await this.prisma.combatEncounter.update({
      where: { id: encounterId },
      data: {
        pendingAction: action as Prisma.InputJsonValue,
        pendingActionAt: new Date(),
      },
    });
  }

  async getPendingAction(encounterId: string): Promise<JsonValue | null> {
    const encounter = await this.prisma.combatEncounter.findUnique({
      where: { id: encounterId },
      select: { pendingAction: true },
    });
    return (encounter?.pendingAction as JsonValue) ?? null;
  }

  async clearPendingAction(encounterId: string): Promise<void> {
    await this.prisma.combatEncounter.update({
      where: { id: encounterId },
      data: {
        pendingAction: Prisma.DbNull,
        pendingActionAt: null,
      },
    });
  }

  // Helper methods for tabletop flow
  async findActiveEncounter(sessionId: string): Promise<CombatEncounterRecord | null> {
    const encounters = await this.listEncountersBySession(sessionId);
    return encounters.find(e => e.status === 'Active') ?? encounters[0] ?? null;
  }

  async findById(encounterId: string): Promise<CombatEncounterRecord | null> {
    return this.getEncounterById(encounterId);
  }

  async startCombat(encounterId: string, initiatives: Record<string, number>): Promise<CombatEncounterRecord> {
    // Update initiatives for all combatants
    const combatants = await this.listCombatants(encounterId);
    
    await Promise.all(
      combatants.map(c => {
        const initiative = initiatives[c.id];
        if (initiative !== undefined) {
          return this.updateCombatantState(c.id, { initiative });
        }
        return Promise.resolve();
      })
    );

    // Get updated encounter with turn order
    const encounter = await this.getEncounterById(encounterId);
    if (!encounter) {
      throw new Error(`Encounter ${encounterId} not found`);
    }

    // Update encounter status
    return this.updateEncounter(encounterId, {
      status: 'Active',
    });
  }
}
