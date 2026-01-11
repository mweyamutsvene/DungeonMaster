import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi } from "vitest";
import { ActionService } from "./action-service.js";
import { CombatantResolver } from "./helpers/combatant-resolver.js";
import {
  createLlmProviderFromEnv,
  getDefaultModelFromEnv,
  NarrativeGenerator,
} from "../../../infrastructure/llm/index.js";
import type { INarrativeGenerator } from "../../../infrastructure/llm/narrative-generator.js";
import type { CombatEncounterRecord, CombatantStateRecord } from "../../types.js";

function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (!key) continue;
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined || process.env[key] === "") {
      process.env[key] = value;
    }
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Vitest's transform layer can make `import.meta.url` resolution behave differently across files.
// Load from both CWD (when running `pnpm -C packages/game-server ...`) and from this test's location.
loadEnvFile(path.resolve(process.cwd(), ".env"));
loadEnvFile(path.resolve(__dirname, "../../../../.env"));

const llmProvider = createLlmProviderFromEnv();
const llmModel = getDefaultModelFromEnv();
const isLlmAvailable = Boolean(llmProvider && llmModel);
const runLlmTests =
  process.env.DM_RUN_LLM_TESTS === "1" ||
  process.env.DM_RUN_LLM_TESTS === "true" ||
  process.env.DM_RUN_LLM_TESTS === "yes";

const debugPrint =
  process.env.DM_LLM_DEBUG === "1" ||
  process.env.DM_LLM_DEBUG?.toLowerCase() === "true" ||
  process.env.DM_LLM_DEBUG?.toLowerCase() === "yes";

function now(): Date {
  return new Date();
}

class MockCombatRepository {
  combatants: CombatantStateRecord[];
  encounterTurn: number;

  constructor(params?: { combatants?: CombatantStateRecord[]; encounterTurn?: number }) {
    this.combatants =
      params?.combatants ??
      [
        {
          id: "comb1",
          encounterId: "enc1",
          combatantType: "Character",
          characterId: "char1",
          monsterId: null,
          npcId: null,
          initiative: 20,
          hpCurrent: 30,
          hpMax: 30,
          conditions: {},
          resources: { actionSpent: false },
          createdAt: now(),
          updatedAt: now(),
        },
        {
          id: "comb2",
          encounterId: "enc1",
          combatantType: "Monster",
          characterId: null,
          monsterId: "mon1",
          npcId: null,
          initiative: 10,
          hpCurrent: 7,
          hpMax: 7,
          conditions: {},
          resources: { actionSpent: false },
          createdAt: now(),
          updatedAt: now(),
        },
      ];

    this.encounterTurn = params?.encounterTurn ?? 0;
  }

  async getEncounterById(id: string): Promise<CombatEncounterRecord | null> {
    return {
      id,
      sessionId: "session1",
      status: "Active",
      round: 1,
      turn: this.encounterTurn,
      createdAt: now(),
      updatedAt: now(),
    };
  }

  async listCombatants(encounterId: string): Promise<CombatantStateRecord[]> {
    return this.combatants;
  }

  async updateCombatantState(id: string, update: any): Promise<CombatantStateRecord> {
    const existing = this.combatants.find((c) => c.id === id);
    if (!existing) throw new Error("Combatant not found");
    Object.assign(existing, update);
    return existing;
  }
}

describe("ActionService - Narrative Equipment Context", () => {
  const testFn = runLlmTests && isLlmAvailable ? it : it.skip;

  testFn("should pass weapon name and armor info to narrator", async () => {
    const capturedEvents: any[] = [];
    let llmText = "";
    let llmInput: unknown = null;

    const realNarrative = new NarrativeGenerator(llmProvider!, {
      model: llmModel!,
      temperature: 0.2,
      timeoutMs: 60_000,
    });

    const narrativeGenerator: INarrativeGenerator = {
      narrate: async (input: any) => {
        llmInput = input;
        capturedEvents.push(...input.events);
        llmText = await realNarrative.narrate(input);
        return llmText;
      },
    };

    const mockCharacters = {
      getById: async () => ({
        id: "char1",
        name: "Fighter",
        sheet: {
          armorClass: 18,
          abilityScores: { strength: 16, dexterity: 14, constitution: 14, intelligence: 10, wisdom: 10, charisma: 10 },
          equipment: {
            armor: { name: "Chain Mail", category: "medium" as const, armorClass: { base: 16, addDexterityModifier: true, dexterityModifierMax: 2 } },
            shield: { name: "Shield", armorClassBonus: 2 },
          },
        },
      }),
    };

    const mockMonsters = {
      getById: async () => ({
        id: "mon1",
        name: "Goblin",
        statBlock: {
          armorClass: 15,
          abilityScores: { strength: 8, dexterity: 14, constitution: 10, intelligence: 10, wisdom: 8, charisma: 8 },
        },
      }),
    };

    const mockCombat = new MockCombatRepository();
    
    const mockSessions = {
      getById: async () => ({ id: "session1", storyFramework: {} }),
    };

    const mockEvents = {
      append: async () => {},
    };

    const mockNpcs = {
      getById: async () => null,
    };

    const combatants = new CombatantResolver(mockCharacters as any, mockMonsters as any, mockNpcs as any);
    const narrator = {
      narrate: (input: { storyFramework: unknown; events: unknown[]; seed: number }) =>
        narrativeGenerator.narrate({
          storyFramework: input.storyFramework as any,
          events: input.events as any,
          seed: input.seed,
        }),
    };

    const actionService = new ActionService(
      mockSessions as any,
      mockCombat as any,
      combatants,
      mockEvents as any,
      narrator,
    );

    await actionService.attack("session1", {
      encounterId: "enc1",
      attacker: { type: "Character", characterId: "char1" },
      target: { type: "Monster", monsterId: "mon1" },
      spec: {
        name: "Greataxe",
        kind: "melee",
        attackBonus: 5,
        damage: { diceCount: 1, diceSides: 12, modifier: 3 },
      },
      seed: 12345,
    });

    expect(capturedEvents.length).toBeGreaterThan(0);
    const outcomeEvent = capturedEvents[0];
    
    expect(outcomeEvent.weaponName).toBe("Greataxe");
    expect(outcomeEvent.attacker).toBe("Fighter");
    expect(outcomeEvent.target).toBe("Goblin");
    expect(outcomeEvent.attackerAC).toBe(18);
    expect(outcomeEvent.targetAC).toBe(15);
    expect(outcomeEvent.attackerArmor).toBe("Chain Mail and Shield");

    if (debugPrint) {
      // Print for manual inspection when running with a real LLM.
      // eslint-disable-next-line no-console
      console.log(
        `\n--- LLM narrate() input ---\n${JSON.stringify(llmInput, null, 2)}\n--------------------------\n`,
      );

      // eslint-disable-next-line no-console
      console.log(`\n--- LLM narrative output ---\n${llmText.trim()}\n---------------------------\n`);

      // If the model returns JSON, print the parsed form too.
      try {
        const parsed = JSON.parse(llmText);
        // eslint-disable-next-line no-console
        console.log(
          `\n--- LLM output as JSON ---\n${JSON.stringify(parsed, null, 2)}\n--------------------------\n`,
        );
      } catch {
        // Not JSON; ignore.
      }
    }
  }, 120_000);

  testFn("should narrate when monster attacks a character", async () => {
    const capturedEvents: any[] = [];

    const realNarrative = new NarrativeGenerator(llmProvider!, {
      model: llmModel!,
      temperature: 0.2,
      timeoutMs: 60_000,
    });

    const narrativeGenerator: INarrativeGenerator = {
      narrate: async (input: any) => {
        capturedEvents.push(...input.events);
        const out = await realNarrative.narrate(input);
        if (debugPrint) {
          // eslint-disable-next-line no-console
          console.log(`\n--- LLM narrative (monster attacker) ---\n${out.trim()}\n-------------------------------\n`);
        }
        return out;
      },
    };

    const mockCharacters = {
      getById: async () => ({
        id: "char1",
        name: "Fighter",
        sheet: {
          armorClass: 18,
          abilityScores: {
            strength: 16,
            dexterity: 14,
            constitution: 14,
            intelligence: 10,
            wisdom: 10,
            charisma: 10,
          },
          equipment: {
            armor: {
              name: "Chain Mail",
              category: "medium" as const,
              armorClass: { base: 16, addDexterityModifier: true, dexterityModifierMax: 2 },
            },
            shield: { name: "Shield", armorClassBonus: 2 },
          },
        },
      }),
    };

    const mockMonsters = {
      getById: async () => ({
        id: "mon1",
        name: "Goblin",
        statBlock: {
          armorClass: 15,
          abilityScores: {
            strength: 8,
            dexterity: 14,
            constitution: 10,
            intelligence: 10,
            wisdom: 8,
            charisma: 8,
          },
        },
      }),
    };

    const mockCombat = new MockCombatRepository({ encounterTurn: 1 });
    const mockSessions = {
      getById: async () => ({ id: "session1", storyFramework: {} }),
    };
    const mockEvents = { append: async () => {} };

    const mockNpcs = {
      getById: async () => null,
    };

    const combatants = new CombatantResolver(mockCharacters as any, mockMonsters as any, mockNpcs as any);
    const narrator = {
      narrate: (input: { storyFramework: unknown; events: unknown[]; seed: number }) =>
        narrativeGenerator.narrate({
          storyFramework: input.storyFramework as any,
          events: input.events as any,
          seed: input.seed,
        }),
    };

    const actionService = new ActionService(
      mockSessions as any,
      mockCombat as any,
      combatants,
      mockEvents as any,
      narrator,
    );

    await actionService.attack("session1", {
      encounterId: "enc1",
      attacker: { type: "Monster", monsterId: "mon1" },
      target: { type: "Character", characterId: "char1" },
      spec: {
        name: "Scimitar",
        kind: "melee",
        attackBonus: 4,
        damage: { diceCount: 1, diceSides: 6, modifier: 2 },
      },
      seed: 999,
    });

    expect(capturedEvents.length).toBeGreaterThan(0);
    const outcomeEvent = capturedEvents[0];
    expect(outcomeEvent.attacker).toBe("Goblin");
    expect(outcomeEvent.target).toBe("Fighter");
    expect(outcomeEvent.weaponName).toBe("Scimitar");
  }, 120_000);

  testFn("should narrate Dodge action", async () => {
    const capturedEvents: any[] = [];

    const realNarrative = new NarrativeGenerator(llmProvider!, {
      model: llmModel!,
      temperature: 0.2,
      timeoutMs: 60_000,
    });

    const narrativeGenerator: INarrativeGenerator = {
      narrate: async (input: any) => {
        capturedEvents.push(...input.events);
        return realNarrative.narrate(input);
      },
    };

    const mockCharacters = {
      getById: async () => ({
        id: "char1",
        name: "Fighter",
        sheet: {
          armorClass: 18,
          abilityScores: {
            strength: 16,
            dexterity: 14,
            constitution: 14,
            intelligence: 10,
            wisdom: 10,
            charisma: 10,
          },
          equipment: {},
        },
      }),
    };

    const mockMonsters = {
      getById: async () => ({
        id: "mon1",
        name: "Goblin",
        statBlock: {
          armorClass: 15,
          abilityScores: {
            strength: 8,
            dexterity: 14,
            constitution: 10,
            intelligence: 10,
            wisdom: 8,
            charisma: 8,
          },
        },
      }),
    };

    const mockCombat = new MockCombatRepository();
    const mockSessions = { getById: async () => ({ id: "session1", storyFramework: {} }) };
    const mockEvents = { append: async () => {} };

    const mockNpcs = {
      getById: async () => null,
    };

    const combatants = new CombatantResolver(mockCharacters as any, mockMonsters as any, mockNpcs as any);
    const narrator = {
      narrate: (input: { storyFramework: unknown; events: unknown[]; seed: number }) =>
        narrativeGenerator.narrate({
          storyFramework: input.storyFramework as any,
          events: input.events as any,
          seed: input.seed,
        }),
    };

    const actionService = new ActionService(
      mockSessions as any,
      mockCombat as any,
      combatants,
      mockEvents as any,
      narrator,
    );

    await actionService.dodge("session1", {
      encounterId: "enc1",
      actor: { type: "Character", characterId: "char1" },
      seed: 2024,
    });

    expect(capturedEvents.length).toBeGreaterThan(0);
    expect(capturedEvents[0].action).toBe("Dodge");
    expect(capturedEvents[0].actor).toBe("Fighter");
  }, 120_000);

  testFn("should narrate Dash action", async () => {
    const capturedEvents: any[] = [];

    const realNarrative = new NarrativeGenerator(llmProvider!, {
      model: llmModel!,
      temperature: 0.2,
      timeoutMs: 60_000,
    });

    const narrativeGenerator: INarrativeGenerator = {
      narrate: async (input: any) => {
        capturedEvents.push(...input.events);
        return realNarrative.narrate(input);
      },
    };

    const mockCharacters = {
      getById: async () => ({
        id: "char1",
        name: "Fighter",
        sheet: {
          armorClass: 18,
          abilityScores: {
            strength: 16,
            dexterity: 14,
            constitution: 14,
            intelligence: 10,
            wisdom: 10,
            charisma: 10,
          },
          equipment: {},
        },
      }),
    };

    const mockMonsters = {
      getById: async () => ({
        id: "mon1",
        name: "Goblin",
        statBlock: {
          armorClass: 15,
          abilityScores: {
            strength: 8,
            dexterity: 14,
            constitution: 10,
            intelligence: 10,
            wisdom: 8,
            charisma: 8,
          },
        },
      }),
    };

    const mockCombat = new MockCombatRepository();
    const mockSessions = { getById: async () => ({ id: "session1", storyFramework: {} }) };
    const mockEvents = { append: async () => {} };

    const mockNpcs = {
      getById: async () => null,
    };

    const combatants = new CombatantResolver(mockCharacters as any, mockMonsters as any, mockNpcs as any);
    const narrator = {
      narrate: (input: { storyFramework: unknown; events: unknown[]; seed: number }) =>
        narrativeGenerator.narrate({
          storyFramework: input.storyFramework as any,
          events: input.events as any,
          seed: input.seed,
        }),
    };

    const actionService = new ActionService(
      mockSessions as any,
      mockCombat as any,
      combatants,
      mockEvents as any,
      narrator,
    );

    await actionService.dash("session1", {
      encounterId: "enc1",
      actor: { type: "Character", characterId: "char1" },
      seed: 2025,
    });

    expect(capturedEvents.length).toBeGreaterThan(0);
    expect(capturedEvents[0].action).toBe("Dash");
    expect(capturedEvents[0].actor).toBe("Fighter");
  }, 120_000);

  testFn("should narrate Disengage action", async () => {
    const capturedEvents: any[] = [];

    const realNarrative = new NarrativeGenerator(llmProvider!, {
      model: llmModel!,
      temperature: 0.2,
      timeoutMs: 60_000,
    });

    const narrativeGenerator: INarrativeGenerator = {
      narrate: async (input: any) => {
        capturedEvents.push(...input.events);
        return realNarrative.narrate(input);
      },
    };

    const mockCharacters = {
      getById: async () => ({
        id: "char1",
        name: "Fighter",
        sheet: {
          armorClass: 18,
          abilityScores: {
            strength: 16,
            dexterity: 14,
            constitution: 14,
            intelligence: 10,
            wisdom: 10,
            charisma: 10,
          },
          equipment: {},
        },
      }),
    };

    const mockMonsters = {
      getById: async () => ({
        id: "mon1",
        name: "Goblin",
        statBlock: {
          armorClass: 15,
          abilityScores: {
            strength: 8,
            dexterity: 14,
            constitution: 10,
            intelligence: 10,
            wisdom: 8,
            charisma: 8,
          },
        },
      }),
    };

    const mockCombat = new MockCombatRepository();
    const mockSessions = { getById: async () => ({ id: "session1", storyFramework: {} }) };
    const mockEvents = { append: async () => {} };

    const mockNpcs = {
      getById: async () => null,
    };

    const combatants = new CombatantResolver(mockCharacters as any, mockMonsters as any, mockNpcs as any);
    const narrator = {
      narrate: (input: { storyFramework: unknown; events: unknown[]; seed: number }) =>
        narrativeGenerator.narrate({
          storyFramework: input.storyFramework as any,
          events: input.events as any,
          seed: input.seed,
        }),
    };

    const actionService = new ActionService(
      mockSessions as any,
      mockCombat as any,
      combatants,
      mockEvents as any,
      narrator,
    );

    await actionService.disengage("session1", {
      encounterId: "enc1",
      actor: { type: "Character", characterId: "char1" },
      seed: 2026,
    });

    expect(capturedEvents.length).toBeGreaterThan(0);
    expect(capturedEvents[0].action).toBe("Disengage");
    expect(capturedEvents[0].actor).toBe("Fighter");
  }, 120_000);

  testFn("should narrate Help action (with target)", async () => {
    const capturedEvents: any[] = [];

    const realNarrative = new NarrativeGenerator(llmProvider!, {
      model: llmModel!,
      temperature: 0.2,
      timeoutMs: 60_000,
    });

    const narrativeGenerator: INarrativeGenerator = {
      narrate: async (input: any) => {
        capturedEvents.push(...input.events);
        return realNarrative.narrate(input);
      },
    };

    const mockCharacters = {
      getById: async () => ({
        id: "char1",
        name: "Fighter",
        sheet: {
          armorClass: 18,
          abilityScores: {
            strength: 16,
            dexterity: 14,
            constitution: 14,
            intelligence: 10,
            wisdom: 10,
            charisma: 10,
          },
          equipment: {},
        },
      }),
    };

    const mockMonsters = {
      getById: async () => ({
        id: "mon1",
        name: "Goblin",
        statBlock: {
          armorClass: 15,
          abilityScores: {
            strength: 8,
            dexterity: 14,
            constitution: 10,
            intelligence: 10,
            wisdom: 8,
            charisma: 8,
          },
        },
      }),
    };

    const mockCombat = new MockCombatRepository();
    const mockSessions = { getById: async () => ({ id: "session1", storyFramework: {} }) };
    const mockEvents = { append: async () => {} };

    const mockNpcs = {
      getById: async () => null,
    };

    const combatants = new CombatantResolver(mockCharacters as any, mockMonsters as any, mockNpcs as any);
    const narrator = {
      narrate: (input: { storyFramework: unknown; events: unknown[]; seed: number }) =>
        narrativeGenerator.narrate({
          storyFramework: input.storyFramework as any,
          events: input.events as any,
          seed: input.seed,
        }),
    };

    const actionService = new ActionService(
      mockSessions as any,
      mockCombat as any,
      combatants,
      mockEvents as any,
      narrator,
    );

    await actionService.help("session1", {
      encounterId: "enc1",
      actor: { type: "Character", characterId: "char1" },
      target: { type: "Monster", monsterId: "mon1" },
      seed: 2027,
    });

    expect(capturedEvents.length).toBeGreaterThan(0);
    expect(capturedEvents[0].action).toBe("Help");
    expect(capturedEvents[0].actor).toBe("Fighter");
    expect(capturedEvents[0].target).toBe("Goblin");
  }, 120_000);

  testFn("should narrate CastSpell action", async () => {
    const capturedEvents: any[] = [];

    const realNarrative = new NarrativeGenerator(llmProvider!, {
      model: llmModel!,
      temperature: 0.2,
      timeoutMs: 60_000,
    });

    const narrativeGenerator: INarrativeGenerator = {
      narrate: async (input: any) => {
        capturedEvents.push(...input.events);
        return realNarrative.narrate(input);
      },
    };

    const mockCharacters = {
      getById: async () => ({
        id: "char1",
        name: "Fighter",
        sheet: {
          armorClass: 18,
          abilityScores: {
            strength: 16,
            dexterity: 14,
            constitution: 14,
            intelligence: 10,
            wisdom: 10,
            charisma: 10,
          },
          equipment: {},
        },
      }),
    };

    const mockMonsters = {
      getById: async () => ({
        id: "mon1",
        name: "Goblin",
        statBlock: {
          armorClass: 15,
          abilityScores: {
            strength: 8,
            dexterity: 14,
            constitution: 10,
            intelligence: 10,
            wisdom: 8,
            charisma: 8,
          },
        },
      }),
    };

    const mockCombat = new MockCombatRepository();
    const mockSessions = { getById: async () => ({ id: "session1", storyFramework: {} }) };
    const mockEvents = { append: async () => {} };

    const mockNpcs = {
      getById: async () => null,
    };

    const combatants = new CombatantResolver(mockCharacters as any, mockMonsters as any, mockNpcs as any);
    const narrator = {
      narrate: (input: { storyFramework: unknown; events: unknown[]; seed: number }) =>
        narrativeGenerator.narrate({
          storyFramework: input.storyFramework as any,
          events: input.events as any,
          seed: input.seed,
        }),
    };

    const actionService = new ActionService(
      mockSessions as any,
      mockCombat as any,
      combatants,
      mockEvents as any,
      narrator,
    );

    await actionService.castSpell("session1", {
      encounterId: "enc1",
      actor: { type: "Character", characterId: "char1" },
      spellName: "Magic Missile",
      seed: 2028,
    });

    expect(capturedEvents.length).toBeGreaterThan(0);
    expect(capturedEvents[0].action).toBe("CastSpell");
    expect(capturedEvents[0].actor).toBe("Fighter");
    expect(capturedEvents[0].spellName).toBe("Magic Missile");
  }, 120_000);

  it("should not fail the attack if narration throws", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const mockCharacters = {
      getById: async () => ({
        id: "char1",
        name: "Fighter",
        sheet: {
          armorClass: 18,
          abilityScores: {
            strength: 16,
            dexterity: 14,
            constitution: 14,
            intelligence: 10,
            wisdom: 10,
            charisma: 10,
          },
          equipment: {},
        },
      }),
    };

    const mockMonsters = {
      getById: async () => ({
        id: "mon1",
        name: "Goblin",
        statBlock: {
          armorClass: 15,
          abilityScores: {
            strength: 8,
            dexterity: 14,
            constitution: 10,
            intelligence: 10,
            wisdom: 8,
            charisma: 8,
          },
        },
      }),
    };

    const mockCombat = new MockCombatRepository();
    const mockSessions = {
      getById: async () => ({ id: "session1", storyFramework: {} }),
    };

    const mockNpcs = {
      getById: async () => null,
    };

    const combatants = new CombatantResolver(mockCharacters as any, mockMonsters as any, mockNpcs as any);

    const actionService = new ActionService(
      mockSessions as any,
      mockCombat as any,
      combatants,
      { append: async () => {} } as any,
      {
        narrate: async () => {
          throw new Error("boom");
        },
      },
    );

    await expect(
      actionService.attack("session1", {
        encounterId: "enc1",
        attacker: { type: "Character", characterId: "char1" },
        target: { type: "Monster", monsterId: "mon1" },
        spec: {
          name: "Greataxe",
          kind: "melee",
          attackBonus: 5,
          damage: { diceCount: 1, diceSides: 12, modifier: 3 },
        },
        seed: 12345,
      }),
    ).resolves.toBeTruthy();

    errSpy.mockRestore();
  });
});
