import { nanoid } from "nanoid";

import { assertArray, assertString, extractFirstJsonObject, isRecord } from "./json.js";
import { llmDebugLog } from "./debug.js";
import { PromptBuilder } from "./prompt-builder.js";
import type { LlmProvider } from "./types.js";

export type StoryCheckpoint = {
  id: string;
  description: string;
  trigger: string;
};

export type StoryFramework = {
  opening: string;
  arc: string;
  ending: string;
  checkpoints: StoryCheckpoint[];
};

export interface IStoryGenerator {
  generateStoryFramework(input?: { seed?: number }): Promise<StoryFramework>;
}

function parseStoryFramework(value: unknown): StoryFramework {
  if (!isRecord(value)) throw new Error("Expected storyFramework to be an object");

  const opening = assertString(value.opening, "opening");
  const arc = assertString(value.arc, "arc");
  const ending = assertString(value.ending, "ending");

  const checkpointsRaw = assertArray(value.checkpoints, "checkpoints");
  const checkpoints: StoryCheckpoint[] = checkpointsRaw.map((c, idx) => {
    if (!isRecord(c)) throw new Error(`Expected checkpoints[${idx}] to be an object`);

    return {
      id: typeof c.id === "string" && c.id.length > 0 ? c.id : nanoid(8),
      description: assertString(c.description, `checkpoints[${idx}].description`),
      trigger: assertString(c.trigger, `checkpoints[${idx}].trigger`),
    };
  });

  return { opening, arc, ending, checkpoints };
}

/**
 * LLM-backed story framework generator (opening/arc/ending/checkpoints).
 * Layer: Infrastructure (LLM adapter).
 * Notes: Produces narrative scaffolding stored on `GameSession`; must not decide rules.
 */
export class StoryGenerator implements IStoryGenerator {
  constructor(
    private readonly llm: LlmProvider,
    private readonly config: {
      model: string;
      temperature?: number;
      timeoutMs?: number;
    },
  ) {}

  async generateStoryFramework(input?: { seed?: number }): Promise<StoryFramework> {
    const prompt = new PromptBuilder('v1')
      .addSection('system', 'You are a D&D 5e story generator. Output ONLY a single JSON object. No markdown. No code fences.')
      .addSection('instructions', [
        "Create a short adventure framework with:",
        "- opening: concrete starting scenario (1-2 paragraphs)",
        "- arc: loose middle arc toward the ending (3-6 bullet points in a single string)",
        "- ending: concrete ending scenario (1 paragraph)",
        "- checkpoints: 3-5 checkpoints, each with description + trigger",
        "",
        "Return JSON of shape:",
        "{",
        '  "opening": string,',
        '  "arc": string,',
        '  "ending": string,',
        '  "checkpoints": [{"id": string, "description": string, "trigger": string}]',
        "}",
      ].join("\n"));

    const messages = prompt.buildAsMessages();

    const options = {
      model: this.config.model,
      temperature: this.config.temperature,
      seed: input?.seed,
      timeoutMs: this.config.timeoutMs,
    };

    llmDebugLog("story.request", { input, messages, options });
    const raw = await this.llm.chat({ messages, options });
    llmDebugLog("story.response", { raw });

    const json = extractFirstJsonObject(raw);
    llmDebugLog("story.parsed_json", { json });
    return parseStoryFramework(json);
  }
}
