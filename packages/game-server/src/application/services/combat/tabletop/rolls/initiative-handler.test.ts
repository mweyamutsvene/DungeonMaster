import { beforeEach, describe, expect, it } from "vitest";
import { InitiativeHandler } from "./initiative-handler.js";
import { MemoryCombatRepository } from "../../../../../infrastructure/testing/memory-repos.js";
import { ValidationError } from "../../../../errors.js";
import type { InitiatePendingAction, InitiativeSwapPendingAction } from "../tabletop-types.js";

type AnyRecord = Record<string, unknown>;

function makeCombatServiceMock(combatRepo: MemoryCombatRepository) {
  return {
    async addCombatantsToEncounter(
      _sessionId: string,
      encounterId: string,
      combatants: Array<AnyRecord>,
    ): Promise<void> {
      await combatRepo.createCombatants(
        encounterId,
        combatants.map((c, idx) => ({
          id: `cbt-${idx + 1}`,
          combatantType: c.combatantType as "Character" | "Monster" | "NPC",
          characterId: (c.characterId as string | undefined) ?? null,
          monsterId: (c.monsterId as string | undefined) ?? null,
          npcId: (c.npcId as string | undefined) ?? null,
          initiative: (c.initiative as number | undefined) ?? null,
          hpCurrent: (c.hpCurrent as number | undefined) ?? 1,
          hpMax: (c.hpMax as number | undefined) ?? 1,
          hpTemp: 0,
          conditions: [],
          resources: (c.resources as AnyRecord | undefined) ?? {},
        })),
      );
      await combatRepo.updateEncounter(encounterId, { status: "Active" });
    },
  };
}

describe("InitiativeHandler Alert swap eligibility", () => {
  const sessionId = "sess-alert";
  const encounterId = "enc-alert";
  const actorId = "char-vanguard";

  let combatRepo: MemoryCombatRepository;
  let handler: InitiativeHandler;

  beforeEach(async () => {
    combatRepo = new MemoryCombatRepository();
    await combatRepo.createEncounter(sessionId, {
      id: encounterId,
      status: "Pending",
      round: 0,
      turn: 0,
    });

    const deps: any = {
      combatRepo,
      combat: makeCombatServiceMock(combatRepo),
      diceRoller: {
        d20: () => ({ total: 2 }),
      },
    };

    const eventEmitter: any = {
      generateNarration: async () => "",
    };

    handler = new InitiativeHandler(deps, eventEmitter, false);
  });

  function makeInitiateAction(): InitiatePendingAction {
    return {
      type: "INITIATIVE",
      timestamp: new Date(),
      actorId,
      initiator: "Vanguard",
      surprise: "party",
    };
  }

  it("offers swap only to willing allies (excludes unconscious)", async () => {
    const encounter = await combatRepo.findById(encounterId);
    if (!encounter) throw new Error("Encounter setup failed");

    const characters = [
      {
        id: actorId,
        name: "Vanguard",
        className: "Fighter",
        level: 5,
        sheet: {
          abilityScores: { dexterity: 14 },
          currentHp: 44,
          maxHp: 44,
          featIds: ["feat_alert"],
        },
      },
      {
        id: "char-ready",
        name: "Ready Ally",
        className: "Rogue",
        level: 5,
        sheet: {
          abilityScores: { dexterity: 16 },
          currentHp: 32,
          maxHp: 32,
          conditions: [],
        },
      },
      {
        id: "char-fallen",
        name: "Fallen Ally",
        className: "Wizard",
        level: 5,
        sheet: {
          abilityScores: { dexterity: 10 },
          currentHp: 30,
          maxHp: 30,
          conditions: ["Unconscious"],
        },
      },
    ];

    const monsters = [
      {
        id: "mon-raider",
        name: "Raider",
        statBlock: {
          abilityScores: { dexterity: 12 },
          hp: 20,
          maxHp: 20,
        },
      },
    ];

    const result = await handler.handleInitiativeRoll(
      sessionId,
      encounter,
      makeInitiateAction(),
      { kind: "rollResult", value: 14, rollType: "initiative" },
      actorId,
      characters,
      monsters,
      [],
    );

    expect(result.requiresPlayerInput).toBe(true);
    const eligibleNames = (result.initiativeSwapOffer?.eligibleTargets ?? []).map((t) => t.actorName);
    expect(eligibleNames).toEqual(["Ready Ally"]);
  });

  it("does not offer swap when all allies are non-willing", async () => {
    const encounter = await combatRepo.findById(encounterId);
    if (!encounter) throw new Error("Encounter setup failed");

    const characters = [
      {
        id: actorId,
        name: "Vanguard",
        className: "Fighter",
        level: 5,
        sheet: {
          abilityScores: { dexterity: 14 },
          currentHp: 44,
          maxHp: 44,
          featIds: ["feat_alert"],
        },
      },
      {
        id: "char-fallen",
        name: "Fallen Ally",
        className: "Wizard",
        level: 5,
        sheet: {
          abilityScores: { dexterity: 10 },
          currentHp: 30,
          maxHp: 30,
          conditions: ["Unconscious"],
        },
      },
    ];

    const monsters = [
      {
        id: "mon-raider",
        name: "Raider",
        statBlock: {
          abilityScores: { dexterity: 10 },
          hp: 20,
          maxHp: 20,
        },
      },
    ];

    const result = await handler.handleInitiativeRoll(
      sessionId,
      encounter,
      makeInitiateAction(),
      { kind: "rollResult", value: 14, rollType: "initiative" },
      actorId,
      characters,
      monsters,
      [],
    );

    expect(result.initiativeSwapOffer).toBeUndefined();
    expect(result.requiresPlayerInput).toBeUndefined();
  });

  it("rejects swap if target becomes non-willing before resolution", async () => {
    const action: InitiativeSwapPendingAction = {
      type: "INITIATIVE_SWAP",
      timestamp: new Date(),
      actorId,
      encounterId,
      sessionId,
      eligibleTargets: [{ actorId: "char-ready", actorName: "Ready Ally", initiative: 12 }],
    };

    const characters = [
      {
        id: actorId,
        name: "Vanguard",
        sheet: { currentHp: 44, maxHp: 44, conditions: [] },
      },
      {
        id: "char-ready",
        name: "Ready Ally",
        sheet: { currentHp: 18, maxHp: 32, conditions: ["Unconscious"] },
      },
    ];

    await expect(
      handler.handleInitiativeSwap(action, "swap with Ready Ally", characters, [], []),
    ).rejects.toThrowError(ValidationError);
    await expect(
      handler.handleInitiativeSwap(action, "swap with Ready Ally", characters, [], []),
    ).rejects.toThrow(/not willing\/capable/i);
  });
});
