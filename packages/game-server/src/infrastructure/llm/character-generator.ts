import { extractFirstJsonObject } from "./json.js";
import { llmDebugLog } from "./debug.js";
import { PromptBuilder } from "./prompt-builder.js";
import type { LlmProvider } from "./types.js";

export interface GeneratedCharacterSheet {
  hp: number;
  maxHp: number;
  armorClass: number;
  abilityScores: {
    strength: number;
    dexterity: number;
    constitution: number;
    intelligence: number;
    wisdom: number;
    charisma: number;
  };
  background: string;
  species: string;
  skills: string[];
  proficiencies: {
    armor: string[];
    weapons: string[];
    tools: string[];
    savingThrows: string[];
  };
  equipment: Array<{
    name: string;
    quantity: number;
    type: "weapon" | "armor" | "gear" | "tool";
  }>;
  personality: {
    traits: string[];
    ideals: string[];
    bonds: string[];
    flaws: string[];
  };
  preparedSpells?: Array<{
    name: string;
    level: number;
    [key: string]: unknown;
  }>;
}

export interface ICharacterGenerator {
  generateCharacter(input: { className: string; level?: number; seed?: number }): Promise<GeneratedCharacterSheet>;
}

/**
 * LLM-powered character sheet generator.
 * Layer: Infrastructure (LLM adapter).
 * Notes: Produces suggested sheet JSON for player characters; server remains authoritative for rules.
 */
export class CharacterGenerator implements ICharacterGenerator {
  constructor(
    private readonly llm: LlmProvider,
    private readonly config: { model: string; temperature?: number; timeoutMs?: number },
  ) {}

  async generateCharacter(input: { className: string; level?: number; seed?: number }): Promise<GeneratedCharacterSheet> {
    const level = input.level ?? 1;
    const className = input.className.toLowerCase();

    const systemPrompt = `You are a D&D 5e character creation expert. Generate optimized character sheets following the 2024 rules.

Rules:
1. Ability scores: Use point buy or standard array (15, 14, 13, 12, 10, 8) optimized for the class
2. Background: Choose from Acolyte, Criminal, Sage, or Soldier based on class synergy
3. Species: Choose the most thematic species for the class (Human, Elf, Dwarf, Halfling, Dragonborn, Gnome, Orc, Tiefling)
4. Skills: Select skills that complement the class and background
5. Equipment: Use standard PHB starting equipment for the class
6. HP: Calculate correctly (class hit die + CON modifier per level, max at 1st level)
7. AC: Base 10 + DEX modifier (adjust for armor in equipment)
8. Personality: Generate traits/ideals/bonds/flaws fitting the background

Output ONLY valid JSON matching this schema:
{
  "hp": number,
  "maxHp": number,
  "armorClass": number,
  "abilityScores": {
    "strength": number,
    "dexterity": number,
    "constitution": number,
    "intelligence": number,
    "wisdom": number,
    "charisma": number
  },
  "background": string,
  "species": string,
  "skills": string[],
  "proficiencies": {
    "armor": string[],
    "weapons": string[],
    "tools": string[],
    "savingThrows": string[]
  },
  "equipment": [
    {
      "name": string,
      "quantity": number,
      "type": "weapon" | "armor" | "gear" | "tool"
    }
  ],
  "personality": {
    "traits": string[],
    "ideals": string[],
    "bonds": string[],
    "flaws": string[]
  }
}`;

    const userPrompt = `Create a level ${level} ${className} character. Optimize ability scores for this class, choose the best background, select appropriate species, and provide standard starting equipment from the PHB.`;

    const prompt = new PromptBuilder('v1')
      .addSection('system', systemPrompt)
      .addSection('request', userPrompt);

    const messages = prompt.buildAsMessages();

    const options = {
      model: this.config.model,
      temperature: this.config.temperature ?? 0.7,
      seed: input.seed,
      timeoutMs: this.config.timeoutMs,
    };

    llmDebugLog("character-gen.request", { input, messages, options });

    const raw = await this.llm.chat({ messages, options });
    llmDebugLog("character-gen.response", { raw });

    const json = extractFirstJsonObject(raw);
    llmDebugLog("character-gen.parsed_json", { json });

    // Validate the structure
    const sheet = json as GeneratedCharacterSheet;
    
    if (!sheet.abilityScores || !sheet.background || !sheet.species || !sheet.equipment) {
      throw new Error("Invalid character sheet structure from LLM");
    }

    return sheet;
  }
}
