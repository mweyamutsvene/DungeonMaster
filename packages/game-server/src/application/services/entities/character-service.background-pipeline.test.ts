import { describe, expect, it } from "vitest";

import { CharacterService } from "./character-service.js";
import {
  MemoryCharacterRepository,
  MemoryGameSessionRepository,
} from "../../../infrastructure/testing/memory-repos.js";
import { listBackgroundDefinitions } from "../../../domain/entities/backgrounds/registry.js";

describe("CharacterService background pipeline", () => {
  it("applies all 16 backgrounds with +2/+1/+1 ASI split", async () => {
    const sessions = new MemoryGameSessionRepository();
    const characters = new MemoryCharacterRepository();
    const service = new CharacterService(sessions, characters);

    await sessions.create({ id: "session-1", storyFramework: {} });

    const backgrounds = listBackgroundDefinitions();
    expect(backgrounds).toHaveLength(16);

    for (const background of backgrounds) {
      const [a, b, c] = background.abilityScoreOptions;
      const created = await service.addCharacter("session-1", {
        name: `Split-${background.id}`,
        level: 1,
        className: "Rogue",
        background: background.id,
        asiChoice: { [a]: 2, [b]: 1, [c]: 1 },
        sheet: {
          abilityScores: {
            strength: 10,
            dexterity: 10,
            constitution: 10,
            intelligence: 10,
            wisdom: 10,
            charisma: 10,
          },
          maxHp: 10,
          currentHp: 10,
          armorClass: 14,
          speed: 30,
        },
      });

      const sheet = created.sheet as Record<string, unknown>;
      const abilityScores = sheet.abilityScores as Record<string, number>;
      const featIds = sheet.featIds as string[];
      const skillProficiencies = sheet.skillProficiencies as string[];

      expect(sheet.background).toBe(background.id);
      expect(abilityScores[a]).toBe(12);
      expect(abilityScores[b]).toBe(11);
      expect(abilityScores[c]).toBe(11);
      expect(featIds).toContain(background.originFeat);
      expect(skillProficiencies).toEqual(expect.arrayContaining([...background.skillProficiencies]));
    }
  });

  it("applies +1/+1/+1 ASI split", async () => {
    const sessions = new MemoryGameSessionRepository();
    const characters = new MemoryCharacterRepository();
    const service = new CharacterService(sessions, characters);

    await sessions.create({ id: "session-1", storyFramework: {} });

    const created = await service.addCharacter("session-1", {
      name: "AllOnes",
      level: 1,
      className: "Rogue",
      background: "criminal",
      asiChoice: { dexterity: 1, constitution: 1, intelligence: 1 },
      sheet: {
        abilityScores: {
          strength: 10,
          dexterity: 10,
          constitution: 10,
          intelligence: 10,
          wisdom: 10,
          charisma: 10,
        },
        maxHp: 10,
        currentHp: 10,
        armorClass: 14,
        speed: 30,
      },
    });

    const abilityScores = (created.sheet as any).abilityScores as Record<string, number>;
    expect(abilityScores.dexterity).toBe(11);
    expect(abilityScores.constitution).toBe(11);
    expect(abilityScores.intelligence).toBe(11);
  });

  it("rejects background ASI choice that does not match the selected background", async () => {
    const sessions = new MemoryGameSessionRepository();
    const characters = new MemoryCharacterRepository();
    const service = new CharacterService(sessions, characters);

    await sessions.create({ id: "session-1", storyFramework: {} });

    await expect(
      service.addCharacter("session-1", {
        name: "Invalid",
        level: 1,
        className: "Rogue",
        background: "criminal",
        asiChoice: { strength: 2, constitution: 1, intelligence: 1 },
        sheet: {
          abilityScores: {
            strength: 10,
            dexterity: 14,
            constitution: 12,
            intelligence: 10,
            wisdom: 10,
            charisma: 10,
          },
          maxHp: 10,
          currentHp: 10,
          armorClass: 14,
          speed: 30,
        },
      }),
    ).rejects.toThrow(/background|ASI/i);
  });
});
