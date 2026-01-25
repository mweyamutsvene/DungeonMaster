import type { JsonValue } from "../../application/types.js";
import { llmDebugLog } from "./debug.js";
import type { LlmProvider } from "./types.js";

export interface INarrativeGenerator {
  narrate(input: { storyFramework: JsonValue; events: JsonValue[]; seed?: number }): Promise<string>;
}

/**
 * Minimal narration wrapper.
 *
 * This will eventually become the "events -> narrative" step used by the CLI/UI.
 *
 * Layer: Infrastructure (LLM adapter).
 * Notes: Generates prose only; must not invent or decide rule outcomes.
 */
export class NarrativeGenerator implements INarrativeGenerator {
  constructor(
    private readonly llm: LlmProvider,
    private readonly config: { model: string; temperature?: number; timeoutMs?: number },
  ) {}

  async narrate(input: { storyFramework: JsonValue; events: JsonValue[]; seed?: number }): Promise<string> {
    const messages = [
        {
          role: "system",
          content:
            [
              "You are the narrator for a D&D session.",
              "Write 1-2 concise, vivid sentences describing ONLY what is explicitly present in the events.",
              "CRITICAL: Do not invent rule outcomes. If a roll has not happened yet, do not claim success/failure.",
              "CRITICAL: Do not invent weapons (no blades/swords/daggers unless explicitly specified). If an attack is unarmed or uses fists, say 'fists' or 'strike'\u2014never 'blade' or 'weapon'.",
              "CRITICAL: Do not invent spells, NPCs, locations, scenery (forests/tunnels/shadows/dust), or backstory beyond the event payload.",
              "CRITICAL: Use pronouns that match established character gender consistently (no swapping he/she).",
              "CRITICAL: Never refer to yourself as 'the narrator' or say lines like 'the narrator intones'.",
              "If the payload includes constraints, follow them.",
            ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              storyFramework: input.storyFramework,
              events: input.events,
            },
            null,
            2,
          ),
        },
      ] as const;

    const options = {
      model: this.config.model,
      temperature: this.config.temperature,
      seed: input.seed,
      timeoutMs: this.config.timeoutMs,
    };

    llmDebugLog("narrate.request", { input: { seed: input.seed }, messages, options });
    const raw = await this.llm.chat({ messages: [...messages], options });
    llmDebugLog("narrate.response", { raw });
    return raw;
  }
}
