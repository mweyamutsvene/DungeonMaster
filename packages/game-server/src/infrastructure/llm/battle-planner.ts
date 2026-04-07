/**
 * LLM-backed battle plan generator.
 *
 * Layer: Infrastructure
 * Purpose: Generates faction-level battle plans using LLM.
 */

import type { LlmProvider } from "./types.js";
import type { IAiBattlePlanner } from "../../application/services/combat/ai/battle-plan-service.js";
import type { BattlePlan } from "../../application/services/combat/ai/battle-plan-types.js";
import { extractFirstJsonObject } from "./json.js";
import { PromptBuilder } from "./prompt-builder.js";

export class LlmBattlePlanner implements IAiBattlePlanner {
  constructor(
    private readonly llm: LlmProvider,
    private readonly config: {
      model: string;
      temperature?: number;
      seed?: number;
      timeoutMs?: number;
    },
  ) {}

  async generatePlan(input: {
    faction: string;
    factionCreatures: Array<{
      name: string;
      hp: { current: number; max: number };
      ac?: number;
      speed?: number;
      abilities?: string[];
      position?: { x: number; y: number };
    }>;
    enemies: Array<{
      name: string;
      hp: { current: number; max: number };
      ac?: number;
      speed?: number;
      position?: { x: number; y: number };
      conditions?: string[];
      class?: string;
      level?: number;
      /** AI-H6: Known abilities/resources of this enemy. */
      abilities?: string[];
    }>;
    round: number;
  }): Promise<BattlePlan | null> {
    const prompt = new PromptBuilder('v1')
      .addSection('system', this.buildSystemPrompt(input.faction))
      .addSection('battle-state', this.buildUserMessage(input));

    try {
      const raw = await this.llm.chat({
        messages: prompt.buildAsMessages(),
        options: {
          model: this.config.model,
          temperature: this.config.temperature ?? 0.5,
          seed: this.config.seed,
          timeoutMs: this.config.timeoutMs ?? 15000,
        },
      });

      return this.parsePlan(raw, input.faction, input.round);
    } catch (error) {
      console.warn("[LlmBattlePlanner] Plan generation failed:", error);
      return null;
    }
  }

  private buildSystemPrompt(faction: string): string {
    return `You are a tactical commander for the "${faction}" faction in a D&D combat encounter.
Analyze the battlefield and create a concise battle plan for your forces.

Respond with ONLY a single JSON object (no prose, no markdown, no code fences):
{
  "priority": "offensive|defensive|retreat|protect|ambush",
  "focusTarget": "enemy name to focus on, or null",
  "creatureRoles": { "creature name": "brief role (1-5 words)" },
  "tacticalNotes": "1-2 sentence overall strategy",
  "retreatCondition": "condition to retreat, or null"
}

Guidelines:
- "offensive": all-out attack, focus fire on one target
- "defensive": protect key allies, use cover, avoid overextending
- "retreat": disengage and flee when condition is met
- "protect": guard a specific ally or position
- "ambush": set up flanking positions, wait for optimal moment
- Focus fire is usually optimal: pick the squishiest or most dangerous target
- Assign roles based on creature strengths (high HP → tank, ranged → striker, etc.)
- Keep retreat conditions simple: "if [creature] drops below 50% HP"`;
  }

  private buildUserMessage(input: {
    faction: string;
    factionCreatures: Array<{
      name: string;
      hp: { current: number; max: number };
      ac?: number;
      speed?: number;
      abilities?: string[];
      position?: { x: number; y: number };
    }>;
    enemies: Array<{
      name: string;
      hp: { current: number; max: number };
      ac?: number;
      speed?: number;
      position?: { x: number; y: number };
      conditions?: string[];
      class?: string;
      level?: number;
      abilities?: string[];
    }>;
    round: number;
  }): string {
    let msg = `Round ${input.round}. Plan for faction "${input.faction}".\n\nYOUR FORCES:\n`;

    for (const c of input.factionCreatures) {
      const parts = [`${c.name} (HP: ${c.hp.current}/${c.hp.max}`];
      if (c.ac) parts.push(`, AC: ${c.ac}`);
      if (c.speed) parts.push(`, Speed: ${c.speed}ft`);
      if (c.position) parts.push(`, at (${c.position.x},${c.position.y})`);
      parts.push(")");
      if (c.abilities && c.abilities.length > 0) {
        parts.push(`\n  Abilities: ${c.abilities.join(", ")}`);
      }
      msg += `- ${parts.join("")}\n`;
    }

    msg += "\nENEMIES:\n";
    for (const e of input.enemies) {
      const parts = [`${e.name} (HP: ${e.hp.current}/${e.hp.max}`];
      if (e.ac) parts.push(`, AC: ${e.ac}`);
      if (e.speed) parts.push(`, Speed: ${e.speed}ft`);
      if (e.class) parts.push(`, ${e.class}${e.level ? ` L${e.level}` : ""}`);
      if (e.position) parts.push(`, at (${e.position.x},${e.position.y})`);
      if (e.conditions && e.conditions.length > 0) parts.push(`, conditions: ${e.conditions.join(", ")}`);
      parts.push(")");
      // AI-H6: Show enemy abilities so the LLM planner can account for both sides' capabilities
      if (e.abilities && e.abilities.length > 0) {
        parts.push(`\n  Abilities: ${e.abilities.join(", ")}`);
      }
      msg += `- ${parts.join("")}\n`;
    }

    return msg;
  }

  private parsePlan(raw: string, faction: string, round: number): BattlePlan | null {
    try {
      const json = extractFirstJsonObject(raw) as Record<string, unknown> | null;
      if (!json) return null;

      const priority = json.priority as string;
      if (!["offensive", "defensive", "retreat", "protect", "ambush"].includes(priority)) {
        return null;
      }

      const creatureRoles = (json.creatureRoles && typeof json.creatureRoles === "object")
        ? json.creatureRoles as Record<string, string>
        : {};

      return {
        faction,
        generatedAtRound: round,
        priority: priority as BattlePlan["priority"],
        focusTarget: typeof json.focusTarget === "string" ? json.focusTarget : undefined,
        creatureRoles,
        tacticalNotes: typeof json.tacticalNotes === "string" ? json.tacticalNotes : "Attack the nearest enemy.",
        retreatCondition: typeof json.retreatCondition === "string" ? json.retreatCondition : undefined,
      };
    } catch {
      return null;
    }
  }
}
