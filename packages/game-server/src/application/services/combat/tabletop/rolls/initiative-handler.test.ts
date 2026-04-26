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

describe("InitiativeHandler — class-backed NPC resource initialization", () => {
  const sessionId = "sess-npc-class";
  const encounterId = "enc-npc-class";

  let addedCombatants: AnyRecord[] = [];
  let handler: InitiativeHandler;

  beforeEach(async () => {
    addedCombatants = [];
    const combatRepo = new MemoryCombatRepository();
    await combatRepo.createEncounter(sessionId, {
      id: encounterId,
      status: "Pending",
      round: 0,
      turn: 0,
    });

    const capturedCombatants = addedCombatants;
    const deps: any = {
      combatRepo,
      combat: {
        async addCombatantsToEncounter(_sid: string, eid: string, combatants: AnyRecord[]) {
          capturedCombatants.push(...combatants);
          await combatRepo.createCombatants(
            eid,
            combatants.map((c, idx) => ({
              id: `cbt-npc-${idx + 1}`,
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
          await combatRepo.updateEncounter(eid, { status: "Active" });
        },
      },
      diceRoller: {
        d20: () => ({ total: 10 }),
      },
    };

    const eventEmitter: any = {
      generateNarration: async () => "",
    };

    handler = new InitiativeHandler(deps, eventEmitter, false);
  });

  it("class-backed NPC gets resourcePools initialized from className and level", async () => {
    const encounter = { id: encounterId, status: "Pending", round: 0, turn: 0, sessionId };

    const playerChar = {
      id: "char-fighter-1",
      name: "Boram",
      className: "Fighter",
      level: 3,
      sheet: {
        abilityScores: { dexterity: 14 },
        maxHP: 28,
        currentHP: 28,
      },
    };

    // Class-backed NPC: Paladin level 3 should get layOnHands resource pool
    const classBackedNpc = {
      id: "npc-paladin-1",
      name: "Allied Paladin",
      statBlock: null,
      className: "Paladin",
      level: 3,
      sheet: {
        classId: "paladin",
        level: 3,
        abilityScores: { strength: 16, dexterity: 10, constitution: 14, intelligence: 10, wisdom: 14, charisma: 16 },
        maxHP: 24,
        currentHP: 24,
        armorClass: 18,
        speed: 30,
      },
    };

    const initiateAction: InitiatePendingAction = {
      type: "INITIATIVE",
      timestamp: new Date(),
      actorId: playerChar.id,
      initiator: playerChar.name,
      surprise: undefined,
    };

    await handler.handleInitiativeRoll(
      sessionId,
      encounter as any,
      initiateAction,
      { kind: "rollResult", value: 15, rollType: "initiative" },
      playerChar.id,
      [playerChar],
      [],
      [classBackedNpc],
    );

    // Find the NPC combatant entry from addedCombatants
    const npcEntry = addedCombatants.find((c) => c.npcId === classBackedNpc.id);
    expect(npcEntry, "NPC combatant entry must be created").toBeDefined();

    const resources = npcEntry!.resources as AnyRecord;
    expect(resources).toBeDefined();

    // Paladin level 3 should have a layOnHands resource pool
    const pools = resources.resourcePools as Array<{ name: string; current: number; max: number }>;
    expect(pools, "class-backed NPC should have resourcePools").toBeDefined();
    const layOnHands = pools.find((p) => p.name === "layOnHands");
    expect(layOnHands, "Paladin level 3 must have layOnHands pool").toBeDefined();
    expect(layOnHands!.max).toBe(15); // Paladin 3: 3 * 5 = 15
  });

  it("stat-block NPC gets empty resourcePools (no class data)", async () => {
    const encounter = { id: encounterId, status: "Pending", round: 0, turn: 0, sessionId };

    const playerChar = {
      id: "char-fighter-2",
      name: "Garen",
      className: "Fighter",
      level: 3,
      sheet: {
        abilityScores: { dexterity: 12 },
        maxHP: 28,
        currentHP: 28,
      },
    };

    const statBlockNpc = {
      id: "npc-guard-1",
      name: "Town Guard",
      statBlock: {
        abilityScores: { strength: 13, dexterity: 12, constitution: 12, intelligence: 10, wisdom: 10, charisma: 9 },
        maxHP: 15,
        currentHP: 15,
        armorClass: 14,
        speed: 30,
      },
      className: null,
      level: null,
      sheet: null,
    };

    const initiateAction: InitiatePendingAction = {
      type: "INITIATIVE",
      timestamp: new Date(),
      actorId: playerChar.id,
      initiator: playerChar.name,
      surprise: undefined,
    };

    await handler.handleInitiativeRoll(
      sessionId,
      encounter as any,
      initiateAction,
      { kind: "rollResult", value: 12, rollType: "initiative" },
      playerChar.id,
      [playerChar],
      [],
      [statBlockNpc],
    );

    const npcEntry = addedCombatants.find((c) => c.npcId === statBlockNpc.id);
    expect(npcEntry, "Stat-block NPC combatant entry must be created").toBeDefined();

    const resources = (npcEntry!.resources ?? {}) as AnyRecord;
    // No resourcePools for a stat-block NPC without class info
    const pools = resources.resourcePools as Array<{ name: string }> | undefined;
    expect(pools).toBeUndefined();
  });
});
