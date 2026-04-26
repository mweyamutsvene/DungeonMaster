import { describe, expect, it } from "vitest";
import { applyDamageWhileUnconscious } from "./ko-handler.js";
import type { CombatantStateRecord } from "../../../types.js";

class TestCombatRepo {
  public updated: Partial<Pick<CombatantStateRecord, "hpCurrent" | "conditions" | "resources">> | null = null;

  async updateCombatantState(
    _id: string,
    patch: Partial<Pick<CombatantStateRecord, "hpCurrent" | "conditions" | "resources">>,
  ): Promise<CombatantStateRecord> {
    this.updated = patch;
    return {
      id: "cbt-1",
      encounterId: "enc-1",
      combatantType: "Character",
      characterId: "char-1",
      monsterId: null,
      npcId: null,
      initiative: 10,
      hpCurrent: 0,
      hpMax: 12,
      conditions: [],
      resources: patch.resources ?? {},
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
  }
}

describe("applyDamageWhileUnconscious", () => {
  it("restarts death saves when a stabilized creature at 0 HP takes damage", async () => {
    const combatant: CombatantStateRecord = {
      id: "cbt-1",
      encounterId: "enc-1",
      combatantType: "Character",
      characterId: "char-1",
      monsterId: null,
      npcId: null,
      initiative: 10,
      hpCurrent: 0,
      hpMax: 12,
      conditions: [],
      resources: { deathSaves: { successes: 3, failures: 0 }, stabilized: true },
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    const combatRepo = new TestCombatRepo();

    const result = await applyDamageWhileUnconscious(combatant, 4, false, combatRepo);

    expect(result).toEqual({
      deathSaves: { successes: 0, failures: 1 },
      instantDeath: false,
    });
    expect(combatRepo.updated).toMatchObject({
      resources: { deathSaves: { successes: 0, failures: 1 }, stabilized: false },
    });
  });
});
