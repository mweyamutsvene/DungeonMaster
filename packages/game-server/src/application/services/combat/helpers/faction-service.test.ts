import { describe, it, expect, vi } from "vitest";
import { FactionService } from "./faction-service.js";
import type { CombatantStateRecord } from "../../../types.js";

function makeCombatant(overrides: Partial<CombatantStateRecord> & { id: string }): CombatantStateRecord {
  return {
    id: overrides.id,
    encounterId: "enc-1",
    combatantType: "Character",
    characterId: "char-current",
    monsterId: null,
    npcId: null,
    initiative: 10,
    hpCurrent: 20,
    hpMax: 20,
    conditions: [],
    resources: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("FactionService allies/enemies (AI-L1)", () => {
  it("uses the provided combatants snapshot and does not call listCombatants", async () => {
    const current = makeCombatant({
      id: "c-current",
      combatantType: "Character",
      characterId: "char-current",
    });
    const ally = makeCombatant({
      id: "c-ally",
      combatantType: "Character",
      characterId: "char-ally",
    });
    const enemy = makeCombatant({
      id: "m-enemy",
      combatantType: "Monster",
      characterId: null,
      monsterId: "mon-enemy",
    });

    const combat = {
      listCombatants: vi.fn().mockResolvedValue([]),
    } as any;

    const service = new FactionService({
      combat,
      characters: {
        getById: vi.fn(),
        getManyByIds: vi.fn().mockResolvedValue([
          { id: "char-current", faction: "party" },
          { id: "char-ally", faction: "party" },
        ]),
      } as any,
      monsters: {
        getById: vi.fn(),
        getManyByIds: vi.fn().mockResolvedValue([{ id: "mon-enemy", faction: "enemy" }]),
      } as any,
      npcs: {
        getById: vi.fn(),
        getManyByIds: vi.fn().mockResolvedValue([]),
      } as any,
    });

    const allCombatants = [current, ally, enemy];
    const allies = await service.getAllies(allCombatants, current);
    const enemies = await service.getEnemies(allCombatants, current);

    expect(allies.map(c => c.id)).toEqual(["c-ally"]);
    expect(enemies.map(c => c.id)).toEqual(["m-enemy"]);
    expect(combat.listCombatants).not.toHaveBeenCalled();
  });
});
