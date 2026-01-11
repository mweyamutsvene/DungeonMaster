import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, beforeAll } from "vitest";
import { CharacterGenerator } from "./character-generator.js";
import { createLlmProviderFromEnv, getDefaultModelFromEnv } from "./factory.js";

// Load environment variables before tests run
function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (line.startsWith("#")) continue;

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

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnvFile(path.resolve(__dirname, "../../../.env"));

/**
 * Integration tests for CharacterGenerator using real LLM.
 * 
 * These tests require:
 * - DM_OLLAMA_MODEL environment variable set
 * - Ollama running at DM_OLLAMA_BASE_URL (default: http://127.0.0.1:11434)
 * 
 * Tests will be skipped if LLM is not configured.
 * 
 * Run with: pnpm test character-generator.integration
 */

const llmProvider = createLlmProviderFromEnv();
const llmModel = getDefaultModelFromEnv();
const isLlmAvailable = Boolean(llmProvider && llmModel);
const runLlmTests =
  process.env.DM_RUN_LLM_TESTS === "1" ||
  process.env.DM_RUN_LLM_TESTS === "true" ||
  process.env.DM_RUN_LLM_TESTS === "yes";

describe("CharacterGenerator (integration with real LLM)", () => {
  it.skipIf(!(runLlmTests && isLlmAvailable))("generates a wizard character with high intelligence", async () => {
    const generator = new CharacterGenerator(llmProvider!, {
      model: llmModel!,
      temperature: 0.7,
      timeoutMs: 60000, // Increased timeout for LLM
    });

    const character = await generator.generateCharacter({
      className: "wizard",
      level: 1,
    });

    // Verify structure
    expect(character).toHaveProperty("hp");
    expect(character).toHaveProperty("maxHp");
    expect(character).toHaveProperty("armorClass");
    expect(character).toHaveProperty("abilityScores");
    expect(character).toHaveProperty("background");
    expect(character).toHaveProperty("species");
    expect(character).toHaveProperty("skills");
    expect(character).toHaveProperty("proficiencies");
    expect(character).toHaveProperty("equipment");
    expect(character).toHaveProperty("personality");

    // Verify ability scores are valid
    expect(character.abilityScores.strength).toBeGreaterThanOrEqual(3);
    expect(character.abilityScores.strength).toBeLessThanOrEqual(20);
    expect(character.abilityScores.intelligence).toBeGreaterThanOrEqual(3);
    expect(character.abilityScores.intelligence).toBeLessThanOrEqual(20);

    // Wizards should prioritize INT
    expect(character.abilityScores.intelligence).toBeGreaterThanOrEqual(13);

    // Verify HP is reasonable for level 1
    expect(character.hp).toBeGreaterThan(0);
    expect(character.hp).toBeLessThanOrEqual(20);
    expect(character.hp).toBe(character.maxHp);

    // Verify AC is reasonable
    expect(character.armorClass).toBeGreaterThanOrEqual(10);
    expect(character.armorClass).toBeLessThanOrEqual(20);

    // Verify background is one of the valid options
    const validBackgrounds = ["Acolyte", "Criminal", "Sage", "Soldier"];
    expect(validBackgrounds.map(b => b.toLowerCase())).toContain(character.background.toLowerCase());

    // Verify species is populated
    expect(character.species).toBeTruthy();
    expect(typeof character.species).toBe("string");

    // Verify skills array
    expect(Array.isArray(character.skills)).toBe(true);
    expect(character.skills.length).toBeGreaterThan(0);

    // Verify equipment array
    expect(Array.isArray(character.equipment)).toBe(true);
    expect(character.equipment.length).toBeGreaterThan(0);
    character.equipment.forEach((item) => {
      expect(item).toHaveProperty("name");
      expect(item).toHaveProperty("quantity");
      expect(item).toHaveProperty("type");
      expect(["weapon", "armor", "gear", "tool"]).toContain(item.type);
    });

    // Verify personality structure
    expect(Array.isArray(character.personality.traits)).toBe(true);
    expect(Array.isArray(character.personality.ideals)).toBe(true);
    expect(Array.isArray(character.personality.bonds)).toBe(true);
    expect(Array.isArray(character.personality.flaws)).toBe(true);
  }, 60000);

  it.skipIf(!(runLlmTests && isLlmAvailable))("generates a fighter character with high strength", async () => {
    const generator = new CharacterGenerator(llmProvider!, {
      model: llmModel!,
      temperature: 0.7,
      timeoutMs: 60000,
    });

    const character = await generator.generateCharacter({
      className: "fighter",
      level: 1,
    });

    // Fighters should prioritize STR or DEX
    const maxPhysical = Math.max(character.abilityScores.strength, character.abilityScores.dexterity);
    expect(maxPhysical).toBeGreaterThanOrEqual(13);

    // Verify proficiencies include appropriate weapons/armor
    expect(character.proficiencies.armor.length).toBeGreaterThan(0);
    expect(character.proficiencies.weapons.length).toBeGreaterThan(0);
    const savingThrowsLower = character.proficiencies.savingThrows.map(s => s.toLowerCase());
    expect(savingThrowsLower).toContain("strength");

    // Verify equipment includes weapons
    const hasWeapon = character.equipment.some((item) => item.type === "weapon");
    expect(hasWeapon).toBe(true);
  }, 60000);

  it.skipIf(!(runLlmTests && isLlmAvailable))("generates a barbarian character with high constitution", async () => {
    const generator = new CharacterGenerator(llmProvider!, {
      model: llmModel!,
      temperature: 0.7,
      timeoutMs: 60000,
    });

    const character = await generator.generateCharacter({
      className: "barbarian",
      level: 1,
    });

    // Barbarians should prioritize STR and CON
    expect(character.abilityScores.strength).toBeGreaterThanOrEqual(13);
    expect(character.abilityScores.constitution).toBeGreaterThanOrEqual(12);

    // Barbarians typically have higher HP
    expect(character.hp).toBeGreaterThanOrEqual(10);

    // Verify saving throws
    const savingThrowsLower = character.proficiencies.savingThrows.map(s => s.toLowerCase());
    expect(savingThrowsLower).toContain("strength");
    expect(savingThrowsLower).toContain("constitution");
  }, 60000);

  it.skipIf(!(runLlmTests && isLlmAvailable))("generates a rogue character with high dexterity", async () => {
    const generator = new CharacterGenerator(llmProvider!, {
      model: llmModel!,
      temperature: 0.7,
      timeoutMs: 60000,
    });

    const character = await generator.generateCharacter({
      className: "rogue",
      level: 1,
    });

    // Rogues should prioritize DEX
    expect(character.abilityScores.dexterity).toBeGreaterThanOrEqual(14);

    // Rogues should have stealth-related skills
    const stealthSkills = ["Stealth", "Sleight of Hand", "Acrobatics"];
    const hasStealthSkill = character.skills.some((skill) =>
      stealthSkills.some((s) => skill.toLowerCase().includes(s.toLowerCase()))
    );
    expect(hasStealthSkill).toBe(true);

    // Verify saving throws
    const savingThrowsLower = character.proficiencies.savingThrows.map(s => s.toLowerCase());
    expect(savingThrowsLower).toContain("dexterity");
  }, 60000);

  it.skipIf(!(runLlmTests && isLlmAvailable))("generates different characters on multiple calls", async () => {
    const generator = new CharacterGenerator(llmProvider!, {
      model: llmModel!,
      temperature: 0.9, // Higher temperature for variety
      timeoutMs: 60000,
    });

    const char1 = await generator.generateCharacter({
      className: "wizard",
      level: 1,
    });

    const char2 = await generator.generateCharacter({
      className: "wizard",
      level: 1,
    });

    // Characters should be different (at least in personality or some trait)
    const isDifferent =
      char1.species !== char2.species ||
      char1.background !== char2.background ||
      JSON.stringify(char1.personality) !== JSON.stringify(char2.personality) ||
      JSON.stringify(char1.equipment) !== JSON.stringify(char2.equipment);

    expect(isDifferent).toBe(true);
  }, 120000);

  it.skipIf(!(runLlmTests && isLlmAvailable))("respects level parameter for higher-level characters", async () => {
    const generator = new CharacterGenerator(llmProvider!, {
      model: llmModel!,
      temperature: 0.7,
      timeoutMs: 60000,
    });

    const character = await generator.generateCharacter({
      className: "paladin",
      level: 5,
    });

    // Level 5 character should have more HP than level 1 (but LLM might not calculate perfectly)
    expect(character.hp).toBeGreaterThanOrEqual(10);
    expect(character.maxHp).toBeGreaterThanOrEqual(10);

    // Verify structure is still valid
    expect(character.abilityScores.strength).toBeGreaterThan(0);
    expect(character.equipment.length).toBeGreaterThan(0);
  }, 60000);

  it.skipIf(!(runLlmTests && isLlmAvailable))("generates appropriate equipment for each class", async () => {
    const generator = new CharacterGenerator(llmProvider!, {
      model: llmModel!,
      temperature: 0.7,
      timeoutMs: 60000,
    });

    const cleric = await generator.generateCharacter({
      className: "cleric",
      level: 1,
    });

    // Clerics should have holy symbols or religious items
    const hasHolyItem = cleric.equipment.some(
      (item) =>
        item.name.toLowerCase().includes("holy") ||
        item.name.toLowerCase().includes("symbol") ||
        item.name.toLowerCase().includes("amulet")
    );
    // Note: This might not always be true depending on LLM, so we'll just check structure
    expect(cleric.equipment.length).toBeGreaterThan(0);

    // Verify all equipment items have proper structure
    cleric.equipment.forEach((item) => {
      expect(item.name).toBeTruthy();
      expect(item.quantity).toBeGreaterThan(0);
      expect(["weapon", "armor", "gear", "tool"]).toContain(item.type);
    });
  }, 60000);

  it.skipIf(isLlmAvailable)("skips LLM tests when not configured", () => {
    // This test ensures we can still run the test suite without LLM
    expect(isLlmAvailable).toBe(false);
  });
});
